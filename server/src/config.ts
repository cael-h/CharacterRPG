import fs from 'fs';
import path from 'path';

export type AppConfig = {
  port: number;
  dirs: {
    uploads: string;
    transcripts: string;
    memories: string;
    timelines: string;
    profiles: string;        // server-managed canonical bundles
    profilesDropin: string;  // user-managed drop-in source folders
  };
  flags: {
    autoImportProfiles: boolean;
    syncCharacterBundles: boolean;
    groupTranscriptsByStory?: boolean;
    autoExportProfilesBack?: boolean; // export server/profiles -> profilesDropin on profile updates/creation
    autoRestartOnLaunch?: boolean;    // launcher (crpg) hint to restart server on startup
    autoShutdownOnExit?: boolean;     // launcher (crpg) hint to shutdown server when CLI exits (if it started it)
  };
  user?: {
    name?: string;
    nicknames?: string[];
    defaultPlayer?: string; // e.g., "Ellis" or "char:Olive"
  };
  storyDefaults?: {
    name?: string;
    mode?: 'new'|'continue';
    participantsByName?: string[]; // convenience boot option
    autoStartOnBoot?: boolean;
  };
};

const defaultConfig: AppConfig = {
  port: 4000,
  dirs: {
    uploads: 'uploads',
    transcripts: 'transcripts',
    memories: 'memories',
    timelines: 'timelines',
    profiles: 'profiles',
    profilesDropin: 'character_profiles',
  },
  flags: {
    autoImportProfiles: false,
    syncCharacterBundles: true,
    groupTranscriptsByStory: true,
    autoExportProfilesBack: false,
    autoRestartOnLaunch: false,
    autoShutdownOnExit: true,
  },
  user: {
    name: undefined,
    nicknames: [],
    defaultPlayer: undefined,
  },
};

function readJson(p: string): Partial<AppConfig> | null {
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {}
  return null;
}

function deepMerge<T>(a: T, b: Partial<T>): T {
  const out: any = Array.isArray(a) ? [...(a as any)] : { ...(a as any) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge((a as any)[k] ?? {}, v as any);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

// Try to read config regardless of working directory: prefer repo-root/server/config.json,
// fall back to ./config.json when running with cwd=server
let localConfig: Partial<AppConfig> | null = null;
for (const p of [path.join('server','config.json'), path.join('.', 'config.json')]) {
  const got = readJson(p);
  if (got) { localConfig = got; break; }
}
localConfig = localConfig || {};

export const config: AppConfig = deepMerge(defaultConfig, localConfig as AppConfig);
