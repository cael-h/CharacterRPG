import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';

export function snapshotTurn(sessionId: string, turnId: string, payload: any) {
  db.prepare('INSERT INTO snapshots VALUES (?,?,?, ?, ?)')
    .run(uuid(), sessionId, turnId, JSON.stringify(payload), Date.now());
}

