import { Router } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import { llmTurn } from '../services/llmRouter.js';
import { appendTranscript } from '../services/fileIO.js';
import { extractAndStoreMemories } from '../services/memory.js';
import { snapshotTurn } from '../services/snapshot.js';
import { parseMessage } from '../services/commands.js';
import { addEvent } from '../services/timeline.js';
import { updateSetting } from '../services/setting.js';
import { recordUsage } from '../services/usage.js';
import { tweakUserText, TweakMode } from '../services/tweak.js';

export const router = Router();

router.post('/turn', async (req, res) => {
  const { session_id, player_text, scene_context, characters, provider, model, mature, tweakMode } = req.body || {};
  if (!session_id || !player_text || !characters) return res.status(400).json({ error: 'bad_request' });

  // Parse slash commands
  const parsed = parseMessage(player_text);

  // Persist player turn
  const playerTurnId = uuid();
  db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)')
    .run(playerTurnId, session_id, 'player', 'player', parsed.remainder || player_text, null, Date.now(), JSON.stringify({ commands: parsed.commands }));
  let playerFinal = parsed.remainder || player_text;
  // Load ages/birth years for mentioned characters
  const ages: Record<string, number|null> = {};
  const enriched: any[] = [];
  try {
    if (Array.isArray(characters)) {
      for (const c of characters) {
        const row = db.prepare('SELECT age, birth_year FROM characters WHERE name=?').get(c.name);
        ages[c.name] = row?.age ?? null;
        enriched.push({ ...c, age: row?.age ?? null, birth_year: row?.birth_year ?? null });
      }
    }
  } catch {}

  // Prompt tweaker
  const mode = (tweakMode as TweakMode) ?? 'off';
  const tweak = tweakUserText(playerFinal, mode, { ages, mature });
  if (tweak.action === 'block') {
    // Do not call the LLM; return a system message
    appendTranscript(session_id, `system: Blocked input: ${tweak.reason}`);
    return res.json({ turns: [{ speaker: 'System', text: `Blocked: ${tweak.reason}`, speak: false }] });
  }
  if (tweak.action === 'rewrite') {
    playerFinal = tweak.text;
    appendTranscript(session_id, `system: ${tweak.note}`);
    // Echo tweaked prompt
    appendTranscript(session_id, `system: Tweaked input -> ${playerFinal}`);
  }
  appendTranscript(session_id, `player: ${playerFinal}`);
  recordUsage(session_id, provider ?? 'mock', 'player', playerFinal);

  // Apply scene command (if any) — update setting and optional time
  for (const c of parsed.commands) {
    if (c.kind === 'scene') {
      addEvent({ scope: 'global', ownerId: null, title: 'Scene note', summary: c.text, sources: { session_id } });
      // Detect time changes like "time: YYYY-MM-DD" or "year: YYYY"
      const m1 = c.text.match(/time\s*:\s*([0-9]{4}(?:-[0-9]{2}(?:-[0-9]{2})?)?)/i);
      const m2 = c.text.match(/year\s*:\s*([0-9]{4})/i);
      const delta: any = { note: c.text };
      if (m1) delta.time = m1[1];
      else if (m2) delta.time = `${m2[1]}-01-01`;
      try { updateSetting(session_id, delta); } catch {}
    }
  }

  // Call LLM (mock by default in this environment)
  // Determine narrative time from scene_state if available
  let narrativeIso: string | undefined;
  try {
    const row = db.prepare('SELECT current_json FROM scene_state WHERE session_id=? ORDER BY updated_at DESC LIMIT 1').get(session_id);
    if (row) {
      const cur = JSON.parse(row.current_json);
      if (cur?.time) narrativeIso = cur.time;
    }
  } catch {}
  const npc = await llmTurn({ provider: provider ?? 'mock', scene_context, characters: enriched.length? enriched: characters, player_text: playerFinal, providerKey: (req as any).providerKey, model, mature, narrativeTimeIso: narrativeIso });

  const out: any[] = [];
  // If suggest mode, prepend a system suggestion
  if (tweak.action === 'suggest' && tweak.suggestion) {
    out.push({ speaker: 'System', text: tweak.suggestion, speak: false });
  }
  for (const t of npc.turns) {
    const id = uuid();
    db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)')
      .run(id, session_id, 'npc', t.speaker, t.text, null, Date.now(), JSON.stringify({ emotion: t.emotion ?? null }));
    appendTranscript(session_id, `${t.speaker}: ${t.text}`);
    recordUsage(session_id, provider ?? 'mock', 'npc', t.text);
    out.push({ speaker: t.speaker, text: t.text, speak: t.speak !== false });
  }

  // Memory extraction (placeholder) + snapshot pointer
  extractAndStoreMemories(session_id, out);
  // Add rough timeline events for each NPC reply (placeholder)
  out.forEach(t => addEvent({ scope: 'character', ownerId: t.speaker, title: 'Said something', summary: t.text.slice(0,120), participants: [t.speaker, 'player'], sources: { session_id } }));
  snapshotTurn(session_id, playerTurnId, { characters, provider });

  res.json({ turns: out });
});
