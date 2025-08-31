import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import { writeCharacterMemory } from './fileIO.js';

export function extractAndStoreMemories(sessionId: string, npcTurns: Array<{speaker:string, text:string}>) {
  // Extremely simple placeholder: store a one-line summary per turn with provenance
  const now = Date.now();
  for (const t of npcTurns) {
    const id = uuid();
    const text = `Observation: ${t.text.slice(0, 200)}`;
    const scope = JSON.stringify({ applies_to: [t.speaker] });
    const sources = JSON.stringify({ sessionId });
    db.prepare('INSERT INTO memories VALUES (?,?,?,?,?,?,?)')
      .run(id, t.speaker, sessionId, text, scope, sources, now);
    writeCharacterMemory(t.speaker, `- ${new Date(now).toISOString()} ${text}`);
  }
}

