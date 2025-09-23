import fs from 'fs';
import path from 'path';
import { profileDirFor } from './paths.js';

function resolveDocsPath(name: string): string | undefined {
  const override = process.env.DOCS_DIR;
  const candidates = [
    override ? path.join(override, name) : '',
    path.join('docs', name),                 // when server runs at repo root
    path.join('..', 'docs', name),           // when server runs from server/
  ].filter(Boolean) as string[];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return undefined;
}

export type CharacterPromptBits = {
  name: string;
  short?: string; // short.md content
};

function readIfExists(p: string): string | undefined {
  try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8'); } catch {}
  return undefined;
}

export function loadGenericGuidelinesFor(characterId?: string): string | undefined {
  const base = process.env.PROFILES_DIR || 'profiles';
  if (characterId) {
    const root = profileDirFor(characterId);
    // Support either prompt/generic.md or prompt/generic/index.md
    const p1 = path.join(root, 'prompt', 'generic.md');
    const p2 = path.join(root, 'prompt', 'generic', 'index.md');
    const txt = readIfExists(p1) || readIfExists(p2);
    if (txt) return txt;
  }
  // Only v3 is considered valid now
  const p = resolveDocsPath('General_Default_Char_Prompt_v3.md');
  return p ? readIfExists(p) : undefined;
}

export function loadShortPrompts(characters: { id?: string; name: string }[]): CharacterPromptBits[] {
  const out: CharacterPromptBits[] = [];
  for (const c of characters) {
    let short: string | undefined;
    if (c.id) {
      const root = profileDirFor(c.id, c.name);
      short = readIfExists(path.join(root, 'prompt', 'short.md')) || readIfExists(path.join(root, 'prompt', 'short', 'index.md'));
    }
    out.push({ name: c.name, short });
  }
  return out;
}

export function renderGuidelinesBlock(txt?: string): string | undefined {
  if (!txt) return undefined;
  // Venice-format may include angle tags and placeholders; we surface as generic style rules.
  return `Guidelines (apply to all NPCs):\n${txt}`;
}

export function renderCharacterBriefs(bits: CharacterPromptBits[], maxPer = 600): string | undefined {
  const lines: string[] = [];
  for (const b of bits) {
    const body = (b.short || '').trim();
    if (!body) continue;
    const trimmed = body.length > maxPer ? body.slice(0, maxPer) + ' …' : body;
    lines.push(`- ${b.name}:\n${trimmed}`);
  }
  if (!lines.length) return undefined;
  return `Character Briefs (short prompts):\n${lines.join('\n\n')}`;
}
