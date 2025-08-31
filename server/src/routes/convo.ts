import { Router } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import { llmTurn } from '../services/llmRouter.js';
import { appendTranscript } from '../services/fileIO.js';
import { extractAndStoreMemories } from '../services/memory.js';
import { snapshotTurn } from '../services/snapshot.js';

export const router = Router();

router.post('/turn', async (req, res) => {
  const { session_id, player_text, scene_context, characters, provider } = req.body || {};
  if (!session_id || !player_text || !characters) return res.status(400).json({ error: 'bad_request' });

  // Persist player turn
  const playerTurnId = uuid();
  db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)')
    .run(playerTurnId, session_id, 'player', 'player', player_text, null, Date.now(), null);
  appendTranscript(session_id, `player: ${player_text}`);

  // Call LLM (mock by default in this environment)
  const npc = await llmTurn({ provider: provider ?? 'mock', scene_context, characters, player_text, providerKey: (req as any).providerKey });

  const out: any[] = [];
  for (const t of npc.turns) {
    const id = uuid();
    db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)')
      .run(id, session_id, 'npc', t.speaker, t.text, null, Date.now(), JSON.stringify({ emotion: t.emotion ?? null }));
    appendTranscript(session_id, `${t.speaker}: ${t.text}`);
    out.push({ speaker: t.speaker, text: t.text, speak: t.speak !== false });
  }

  // Memory extraction (placeholder) + snapshot pointer
  extractAndStoreMemories(session_id, out);
  snapshotTurn(session_id, playerTurnId, { characters, provider });

  res.json({ turns: out });
});

