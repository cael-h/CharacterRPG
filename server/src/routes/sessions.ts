import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../db.js';
import { appendSessionToStory } from '../services/story.js';
import { exportToDropin } from '../services/export.js';
import { randomUUID as uuid } from 'crypto';
import { config } from '../config.js';
import { writeCharacterProfileBundle } from '../services/fileIO.js';
import { loadFacts, extractFactsRules, saveFacts } from '../services/meta.js';
import type { CharacterIdNameRow, CharacterNameRow } from '../types.js';

export const router = Router();

type SessionController = 'player' | 'llm';
type StoryRow = { id: string; name: string };

interface SessionCreateBody {
  title?: string;
  provider?: string;
  participants?: { id: string }[];
  story?: string;
  story_mode?: 'new' | 'continue';
  user_name?: string;
  player?: string;
  confirm_create_player?: boolean;
}

router.post('/', (req: Request<unknown, unknown, SessionCreateBody>, res: Response) => {
  const id = uuid();
  const { title, provider, participants, story, story_mode, user_name, player, confirm_create_player } = req.body || {};
  const participantsList = Array.isArray(participants) ? participants.filter((p): p is { id: string } => typeof p?.id === 'string') : [];

  // Resolve player identity
  let player_name: string | null = null;
  let player_character_id: string | null = null;
  const spec: string | undefined = (typeof player === 'string' && player.trim()) ? player.trim() : (config.user?.defaultPlayer || undefined);
  const defaultUserName = (typeof user_name === 'string' && user_name.trim()) ? user_name.trim() : (config.user?.name || null);
  if (spec && spec.toLowerCase().startsWith('char:')) {
    const key = spec.slice(5).trim();
    // Try id first, then name
    const byId = db.prepare('SELECT id,name FROM characters WHERE id=?').get(key) as CharacterIdNameRow | undefined;
    const byName = byId || (db.prepare('SELECT id,name FROM characters WHERE name=?').get(key) as CharacterIdNameRow | undefined);
    if (byName?.id) {
      player_character_id = byName.id;
      player_name = byName.name; // visible name when acting as a character
    }
  } else if (spec && spec.toLowerCase().startsWith('new:')) {
    player_name = spec.slice(4).trim() || defaultUserName || 'Player';
  } else if (typeof spec === 'string' && spec.trim()) {
    // Treat as a character name the player wishes to control
    const byName = db.prepare('SELECT id,name FROM characters WHERE name=?').get(spec.trim()) as CharacterIdNameRow | undefined;
    if (byName?.id) {
      player_character_id = byName.id;
      player_name = byName.name;
    } else {
      // Not found: require confirmation to create a new character record
      if (!confirm_create_player) {
        return res.status(409).json({ error: 'confirm_new_character', name: spec.trim() });
      }
      const nid = uuid();
      const now = Date.now();
      const nm = spec.trim();
      db.prepare('INSERT INTO characters (id,name,system_prompt,memory_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(nid, nm, '', '{}', now, now);
      try {
        writeCharacterProfileBundle(nid, { name: nm, system_prompt: '' });
        if (config.flags.autoExportProfilesBack) {
          try { exportToDropin(nid); } catch {}
        }
      } catch {}
      player_character_id = nid;
      player_name = nm;
    }
  } else if (defaultUserName) {
    player_name = defaultUserName;
  }

  db.prepare('INSERT INTO sessions (id,title,provider,participants_json,started_at,ended_at,user_id,player_name,player_character_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, title ?? 'Scene', provider ?? 'gemini', JSON.stringify(participantsList), Date.now(), null, null, player_name, player_character_id);

  // If player is controlling a character, mark control map
  try {
    if (player_character_id) {
      db.prepare('INSERT OR REPLACE INTO session_control (session_id, character_id, controller) VALUES (?,?,?)')
        .run(id, player_character_id, 'player');
    }
  } catch {}
  // Auto-extract facts if missing and write story mapping
  try {
    const first = Array.isArray(participants) && participants[0]?.id;
    if (first) {
      const facts = loadFacts(first);
      if (!facts) {
        const c = db.prepare('SELECT name FROM characters WHERE id=?').get(first) as CharacterNameRow | undefined;
        if (c?.name) saveFacts(first, extractFactsRules(first, c.name));
      }
      // Create or attach to a Story record
      let sname = story;
      if (!sname || typeof sname !== 'string' || !sname.trim()) sname = 'story1';
      sname = sname.trim();
      let storyRow: StoryRow;
      if (story_mode === 'continue') {
        const existing = db
          .prepare('SELECT id,name FROM stories WHERE name=?')
          .get(sname) as StoryRow | undefined;
        if (existing) {
          storyRow = existing;
        } else {
          storyRow = { id: uuid(), name: sname };
          db.prepare('INSERT INTO stories (id,name,meta_json,created_at,updated_at) VALUES (?,?,?,?,?)')
            .run(storyRow.id, storyRow.name, '{}', Date.now(), Date.now());
        }
      } else {
        // New story: ensure unique name by suffixing -2, -3 if needed
        let base = sname;
        let candidate = base;
        let i = 2;
        while (db.prepare('SELECT 1 FROM stories WHERE name=?').get(candidate)) {
          candidate = `${base}-${i++}`;
        }
        storyRow = { id: uuid(), name: candidate };
        db.prepare('INSERT INTO stories (id,name,meta_json,created_at,updated_at) VALUES (?,?,?,?,?)')
          .run(storyRow.id, storyRow.name, '{}', Date.now(), Date.now());
      }
      // Link session to story
      db.prepare('INSERT OR REPLACE INTO session_story (session_id, story_id) VALUES (?,?)').run(id, storyRow.id);
      // Track participants at story level (id-based)
      for (const p of participantsList) {
        db.prepare('INSERT OR IGNORE INTO story_participants (story_id, character_id, aware_of_json) VALUES (?,?,NULL)')
          .run(storyRow.id, p.id);
      }
      // Maintain legacy per-character story index for backward-compat
      appendSessionToStory(first, storyRow.name, id);
    }
  } catch {}
  res.json({ id });
});

// Change control of a character within a session: controller = 'player'|'llm'
router.post('/:id/control', (req: Request<{ id: string }, unknown, { character_id?: string; controller?: SessionController }>, res: Response) => {
  const sessionId = req.params.id;
  const { character_id, controller } = req.body || {};
  if (!character_id || !controller || !['player','llm'].includes(String(controller))) {
    return res.status(400).json({ error: 'bad_request' });
  }
  try {
    const ctrl = controller as SessionController;
    db.prepare('INSERT OR REPLACE INTO session_control (session_id, character_id, controller) VALUES (?,?,?)')
      .run(sessionId, character_id, ctrl);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post('/:id/end', (req: Request<{ id: string }>, res: Response) => {
  db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(Date.now(), req.params.id);
  res.json({ ok: true });
});
