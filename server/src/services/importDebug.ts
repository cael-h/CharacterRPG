import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export type DropinEntry = {
  entry: string;
  profileMd: string | null;
  longMd: string | null;
};

export type DropinScan = {
  base: string;
  abs: string;
  cwd: string;
  exists: boolean;
  entries: DropinEntry[];
};

export function scanDropin(): DropinScan {
  const base = (config.dirs && (config.dirs as any).profilesDropin) || 'character_profiles';
  const cwd = process.cwd();
  const abs = path.resolve(base);
  let exists = false;
  try {
    exists = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  } catch {
    exists = false;
  }

  const entries: DropinEntry[] = [];
  if (exists) {
    try {
      for (const entry of fs.readdirSync(abs)) {
        const dropDir = path.join(abs, entry);
        try {
          if (!fs.statSync(dropDir).isDirectory()) continue;
        } catch {
          continue;
        }
        const profileMd = fs.existsSync(path.join(dropDir, 'profile.md'))
          ? path.join(dropDir, 'profile.md')
          : null;
        let longMd: string | null = null;
        const lcd = path.join(dropDir, 'long_char_profile');
        try {
          if (fs.existsSync(lcd) && fs.statSync(lcd).isDirectory()) {
            const files = fs.readdirSync(lcd).filter((f) => /\.md$/i.test(f));
            if (files.length) longMd = path.join(lcd, files[0]);
          }
        } catch {
          // ignore
        }
        entries.push({ entry, profileMd, longMd });
      }
    } catch {
      // ignore
    }
  }

  return { base, abs, cwd, exists, entries };
}
