import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

export const router = Router();

router.get('/config', (_req, res) => {
  try {
    const cwd = process.cwd();
    const dirs = config.dirs as any;
    const resolved = {
      uploads: path.resolve(dirs.uploads),
      transcripts: path.resolve(dirs.transcripts),
      memories: path.resolve(dirs.memories),
      timelines: path.resolve(dirs.timelines),
      profiles: path.resolve(dirs.profiles),
      profilesDropin: path.resolve(dirs.profilesDropin),
    };
    res.json({ cwd, dirs: config.dirs, resolved, flags: config.flags, port: config.port });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get('/health', (_req, res) => {
  try {
    const cwd = process.cwd();
    const pid = process.pid;
    const node = process.version;
    let started = (global as any).__crpg_started_at as number | undefined;
    if (!started) {
      started = Date.now();
      (global as any).__crpg_started_at = started;
    }
    res.json({ ok: true, pid, node, cwd, uptime_ms: Date.now() - started });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
