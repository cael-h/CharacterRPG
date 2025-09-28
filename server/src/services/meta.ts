import fs from 'fs';
import path from 'path';
<<<<<<< HEAD
import { profileDirFor } from './paths.js';
=======
>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2

export type CharacterFacts = {
  name: string;
  nicknames?: string[];
  aliases?: string[];
  age?: number | null;
  birth_year?: number | null;
  reviewer_hints?: { prefer_brief?: boolean; tone?: string[] };
  boundaries?: { pg_13?: boolean; disallow_minors_content?: boolean };
  provider_pref?: { provider?: string; model?: string };
  story_start?: string; // ISO date
  provenance?: { generated_at?: string; reason?: string; sources?: any[] };
};

export function metaPathFor(characterId: string) {
<<<<<<< HEAD
  const root = profileDirFor(characterId);
  return path.join(root, 'meta.json');
=======
  const base = process.env.PROFILES_DIR || 'profiles';
  return path.join(base, characterId, 'meta.json');
>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2
}

export function loadFacts(characterId: string): CharacterFacts | null {
  const p = metaPathFor(characterId);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as CharacterFacts;
  } catch {}
  return null;
}

export function saveFacts(characterId: string, facts: CharacterFacts) {
  const p = metaPathFor(characterId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(facts, null, 2));
}

// Very lightweight rules extractor: scans prompt and docs for simple keys.
export function extractFactsRules(characterId: string, name: string): CharacterFacts {
  const base = process.env.PROFILES_DIR || 'profiles';
<<<<<<< HEAD
  const root = profileDirFor(characterId);
=======
  const root = path.join(base, characterId);
>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2
  const facts: CharacterFacts = {
    name,
    reviewer_hints: { prefer_brief: true },
    boundaries: { pg_13: true, disallow_minors_content: true },
    provenance: { generated_at: new Date().toISOString(), reason: 'rules' },
  };
  function scan(text: string) {
    const lines = String(text || '').split(/\r?\n/);
    for (const ln of lines) {
      const mAge = ln.match(/\bAge\s*:\s*(\d{1,3})\b/i);
      if (mAge) facts.age = Number(mAge[1]);
      const mBY = ln.match(/\bBirth\s*Year\s*:\s*(\d{4})\b/i);
      if (mBY) facts.birth_year = Number(mBY[1]);
      const mNick = ln.match(/\bNicknames?\s*:\s*(.+)$/i);
      if (mNick) facts.nicknames = mNick[1].split(/[;,]/).map(s=>s.trim()).filter(Boolean);
      const mAli = ln.match(/\bAliases?\s*:\s*(.+)$/i);
      if (mAli) facts.aliases = mAli[1].split(/[;,]/).map(s=>s.trim()).filter(Boolean);
    }
  }
  try {
    const pPrompt = path.join(root, 'prompt', 'system.md');
    if (fs.existsSync(pPrompt)) scan(fs.readFileSync(pPrompt, 'utf-8'));
  } catch {}
  try {
    const ddir = path.join(root, 'docs');
    if (fs.existsSync(ddir)) {
      for (const f of fs.readdirSync(ddir)) if (/\.(md|txt)$/i.test(f)) scan(fs.readFileSync(path.join(ddir, f), 'utf-8'));
    }
  } catch {}
  // First-time default story start
  if (!facts.story_start) facts.story_start = new Date().toISOString().slice(0,10);
  return facts;
}

export async function extractFactsLLM(characterId: string, name: string, opts?: { model?: string, apiKey?: string }) {
  const base = process.env.PROFILES_DIR || 'profiles';
  const root = path.join(base, characterId);
  let corpus = `Name: ${name}\n`;
  try {
    const pPrompt = path.join(root, 'prompt', 'system.md');
    if (fs.existsSync(pPrompt)) corpus += `\n[system.md]\n` + fs.readFileSync(pPrompt, 'utf-8');
  } catch {}
  try {
    const ddir = path.join(root, 'docs');
    if (fs.existsSync(ddir)) {
      for (const f of fs.readdirSync(ddir)) if (/\.(md|txt)$/i.test(f)) {
        corpus += `\n[${f}]\n` + fs.readFileSync(path.join(ddir, f), 'utf-8');
      }
    }
  } catch {}
  const sys = 'Extract structured character facts from the given notes as strict JSON matching this TypeScript type: {"name":string,"nicknames?":string[],"aliases?":string[],"age?":number|null,"birth_year?":number|null,"reviewer_hints?":{"prefer_brief?":boolean,"tone?":string[]},"boundaries?":{"pg_13?":boolean,"disallow_minors_content?":boolean},"provider_pref?":{"provider?":string,"model?":string},"story_start?":string,"provenance?":{"generated_at":string,"reason":string,"sources":any[]}}. Only include fields you can infer.';
  const user = corpus.slice(0, 12000); // guard
  const { openaiJson } = await import('../providers/openai/json.js');
  const obj = await openaiJson(sys, user, opts?.model, opts?.apiKey);
  const facts: CharacterFacts = {
    name,
    ...obj,
    provenance: { ...(obj?.provenance||{}), generated_at: new Date().toISOString(), reason: 'llm' }
  };
  if (!facts.story_start) facts.story_start = new Date().toISOString().slice(0,10);
  return facts;
}
