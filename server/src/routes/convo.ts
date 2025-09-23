import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import path from 'path';
import { llmTurn } from '../services/llmRouter.js';
import type { LlmCharacter } from '../services/llmRouter.js';
import { appendTranscript } from '../services/fileIO.js';
import { extractAndStoreMemories } from '../services/memory.js';
import { snapshotTurn } from '../services/snapshot.js';
import { parseMessage } from '../services/commands.js';
import { addEvent } from '../services/timeline.js';
import { updateSetting } from '../services/setting.js';
import { recordUsage } from '../services/usage.js';
import { tweakUserText, TweakMode } from '../services/tweak.js';
import type { AgeBirthRow, CharacterNameRow, ControlRow, CountRow, IdRow, SceneStateRow, SessionPlayerRow } from '../types.js';
import type { Candidate } from '../services/reviewer.js';

type TurnCharacter = { id?: string; name: string; system_prompt?: string; [key: string]: unknown };

type ProviderSlug = 'mock' | 'ollama' | 'openai' | 'gemini';
type ReviewerProvider = 'openai' | 'ollama' | 'stub';

interface TurnRequestBody {
  session_id: string;
  player_text: string;
  scene_context?: unknown;
  characters: TurnCharacter[];
  provider?: ProviderSlug;
  model?: string;
  mature?: boolean;
  tweakMode?: TweakMode;
  useRag?: boolean;
  reviewer_provider?: ReviewerProvider;
  reviewer_model?: string;
  style_short?: boolean;
  use_responses?: boolean;
}

type RagDoc = { id: string; source: string; title?: string; text: string; occurred_at?: number | null };

export const router = Router();

router.post('/turn', async (req: Request<unknown, unknown, TurnRequestBody, { debug?: string }>, res: Response) => {
  const { session_id, player_text, scene_context, characters, provider, model, mature, tweakMode, useRag, reviewer_provider, reviewer_model, style_short, use_responses } = (req.body ?? {}) as TurnRequestBody;
  const characterList: TurnCharacter[] = Array.isArray(characters) ? characters : [];
  // Debug short-circuit to validate transport
  try {
    if (String(req.query.debug ?? '') === '1') {
      const name = characterList[0]?.name || 'Narrator';
      return res.status(200).json({ turns: [{ speaker: name, text: `(debug) echo: ${String(player_text||'')}`, speak: false }] });
    }
  } catch {}
  if (!session_id || !player_text || !characterList.length) return res.status(400).json({ error: 'bad_request' });
  const providerSlug: ProviderSlug = provider ?? 'mock';
  const reviewerProvider: ReviewerProvider | undefined =
    reviewer_provider && ['openai', 'ollama', 'stub'].includes(reviewer_provider)
      ? (reviewer_provider as ReviewerProvider)
      : undefined;

  // Load session player identity
  let playerLabel: string | undefined;
  let playerActingAs: string | null = null;
  let playerAliases: string[] = [];
  try {
    const srow = db
      .prepare('SELECT player_name, player_character_id FROM sessions WHERE id=?')
      .get(session_id) as SessionPlayerRow | undefined;
    const configModule = await import('../config.js');
    const cfgAliases = Array.isArray(configModule.config.user?.nicknames)
      ? (configModule.config.user?.nicknames as string[])
      : [];
    playerAliases = cfgAliases;
    if (srow?.player_character_id) {
      const crow = db
        .prepare('SELECT name FROM characters WHERE id=?')
        .get(srow.player_character_id) as CharacterNameRow | undefined;
      if (crow?.name) {
        playerLabel = srow.player_name || crow.name;
        playerActingAs = crow.name;
      }
    } else if (srow?.player_name) {
      playerLabel = srow.player_name;
    } else if (configModule.config.user?.name) {
      playerLabel = configModule.config.user.name;
    }
  } catch {}

  // Parse slash commands
  const parsed = parseMessage(player_text);

  // Persist player turn
  const playerTurnId = uuid();
  db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)')
    .run(playerTurnId, session_id, 'player', 'player', parsed.remainder || player_text, null, Date.now(), JSON.stringify({ commands: parsed.commands }));
  let playerFinal = parsed.remainder || player_text;
  // Filter out player-controlled characters from NPC list to avoid conflicts
  let filteredCharacters = [...characterList];
  try {
    const ctrl = db
      .prepare('SELECT character_id FROM session_control WHERE session_id=? AND controller=?')
      .all(session_id, 'player') as ControlRow[];
    const ids = new Set<string>(ctrl.map((r) => String(r.character_id)));
    const srow = db
      .prepare('SELECT player_character_id FROM sessions WHERE id=?')
      .get(session_id) as SessionPlayerRow | undefined;
    if (srow?.player_character_id) ids.add(String(srow.player_character_id));
    if (ids.size) {
      const names: string[] = [];
      for (const id of ids) {
        const n = db.prepare('SELECT name FROM characters WHERE id=?').get(id) as CharacterNameRow | undefined;
        if (n?.name) names.push(n.name);
      }
      const before = filteredCharacters.length;
      filteredCharacters = filteredCharacters.filter(c => !(ids.has((c as any)?.id) || names.includes(c.name)));
      if (before !== filteredCharacters.length) {
        appendTranscript(session_id, `system: Player controls: ${names.join(', ')}. These will not be generated by the model.`);
      }
    }
  } catch {}

  // Load ages/birth years for mentioned characters
  const ages: Record<string, number | null> = {};
  const enriched: Array<TurnCharacter & { age: number | null; birth_year: number | null }> = [];
  try {
    if (Array.isArray(filteredCharacters)) {
      for (const c of filteredCharacters) {
        const row = db
          .prepare('SELECT age, birth_year FROM characters WHERE name=?')
          .get(c.name) as AgeBirthRow | undefined;
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
  recordUsage(session_id, providerSlug, 'player', playerFinal);
  // If the player is acting as a character, record their input as that character's memory
  try {
    if (playerActingAs) {
      const now = Date.now();
      const id = uuid();
      const text = `Observation: ${String(playerFinal).slice(0,200)}`;
      const scope = JSON.stringify({ applies_to: [playerActingAs] });
      const sources = JSON.stringify({ sessionId: session_id, by: 'player' });
      db.prepare('INSERT INTO memories VALUES (?,?,?,?,?,?,?)')
        .run(id, playerActingAs, session_id, text, scope, sources, now);
      const { writeCharacterMemory } = await import('../services/fileIO.js');
      writeCharacterMemory(playerActingAs, `- ${new Date(now).toISOString()} ${text}`);
    }
  } catch {}

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
    if (c.kind === 'addchar') {
      try {
        const exists = db
          .prepare('SELECT id FROM characters WHERE name=?')
          .get(c.name) as IdRow | undefined;
        let newId = exists?.id;
        if (!newId) {
          const nid = uuid();
          db.prepare('INSERT INTO characters (id,name,system_prompt,memory_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
            .run(nid, c.name, '', '{}', Date.now(), Date.now());
          newId = nid;
        }
        // Create an initial profile doc summarizing from this session transcript end (last ~2KB)
        const fs = await import('fs');
        const { transcriptPathFor } = await import('../services/paths.js');
        const tpath = transcriptPathFor(session_id);
        let context = '';
        try { const txt = fs.readFileSync(tpath, 'utf-8'); context = txt.slice(-2000); } catch {}
        const { openaiJson } = await import('../providers/openai/json.js');
        let md = `# ${c.name} — Profile\n`;
        try {
          const sys = 'Write a concise Markdown profile (<= 300 words) for the named character based on the conversation excerpt.';
          const obj = await openaiJson(sys, `Name: ${c.name}\nExcerpt:\n${context}`);
          if (obj && obj.text) md = String(obj.text);
        } catch {}
        const base = process.env.PROFILES_DIR || 'profiles';
        const root = path.join(base, newId);
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(root, 'docs', `${c.name.replace(/\s+/g,'_')}_profile.md`), md);
        appendTranscript(session_id, `system: Added character ${c.name}.`);
      } catch {}
    }
    if (c.kind === 'charupdate') {
      try {
        const targetName = c.name || characterList[0]?.name || 'Unknown';
        const row = db.prepare('SELECT id FROM characters WHERE name=?').get(targetName) as IdRow | undefined;
        if (row?.id) {
          const fs = await import('fs');
          const base = process.env.PROFILES_DIR || 'profiles';
          const dir = path.join(base, row.id, 'docs', 'updates');
          fs.mkdirSync(dir, { recursive: true });
          const { transcriptPathFor } = await import('../services/paths.js');
          const tpath = transcriptPathFor(session_id);
          let excerpt = '';
          try { const txt = fs.readFileSync(tpath, 'utf-8'); excerpt = txt.slice(-2000); } catch {}
          const now = new Date().toISOString().replace(/[:.]/g,'-');
          const file = path.join(dir, `${now}.md`);
          fs.writeFileSync(file, (c.note? `> ${c.note}\n\n`:'') + excerpt);
          appendTranscript(session_id, `system: Appended update for ${targetName}.`);
        }
      } catch {}
    }
  }

  // Optional facts + RAG: facts (meta.json) + reviewer-selected snippets → extra context
  let extraContext: string | undefined;
  // Build cadence-aware prompt context: include generic/short prompts every 5 player turns
  let includePromptHints = true;
  let includeProfileExcerpt = false; // Only on session start or via /reseed
  try {
    const countRow = db
      .prepare('SELECT COUNT(1) as c FROM turns WHERE session_id=? AND role=?')
      .get(session_id, 'player') as CountRow | undefined;
    const count = Number(countRow?.c ?? 0);
    // Include on 1st, 6th, 11th... player turns
    includePromptHints = !Number.isFinite(count) ? true : ((count % 5) === 1);
    // Long profile excerpt only on the first player turn of a session
    includeProfileExcerpt = !Number.isFinite(count) ? true : (count === 1);
  } catch {}
  // Slash command: /reseed prompts|profile|all to force injection
  if (parsed.commands.some(c => c.kind === 'reseed')) {
    const cmd = parsed.commands.find(c => c.kind === 'reseed') as any;
    const tgt = (cmd?.target || 'all') as 'prompts'|'profile'|'all';
    if (tgt === 'prompts' || tgt === 'all') includePromptHints = true;
    if (tgt === 'profile' || tgt === 'all') includeProfileExcerpt = true;
  }
  if (Array.isArray(enriched) && enriched.length > 0 && includePromptHints) {
    try {
      const row = db
        .prepare('SELECT id FROM characters WHERE name=?')
        .get(enriched[0].name) as IdRow | undefined;
      const charId = row?.id;
      const { loadGenericGuidelinesFor, loadShortPrompts, renderGuidelinesBlock, renderCharacterBriefs } = await import('../services/prompts.js');
      const guide = renderGuidelinesBlock(loadGenericGuidelinesFor(charId));
      const briefs = renderCharacterBriefs(loadShortPrompts(enriched));
      const blocks = [guide, briefs].filter(Boolean).join('\n\n');
      if (blocks) extraContext = blocks;
      // Add compact profile excerpt only at session start or when forced by /reseed
      if (charId) {
        const { profileDirFor } = await import('../services/paths.js');
        const fs = await import('fs');
        const root = profileDirFor(charId);
        const p = path.join(root, 'profile.md');
        if (includeProfileExcerpt && fs.existsSync(p)) {
          const prof = fs.readFileSync(p, 'utf-8');
          const excerpt = prof.slice(0, 1800);
          extraContext = (extraContext ? extraContext + '\n\n' : '') + `Profile Excerpt (for initial grounding):\n${excerpt}`;
        }
      }
    } catch {}
  }
  try {
    if (useRag && Array.isArray(enriched) && enriched.length > 0) {
      const charIdRow = db
        .prepare('SELECT id FROM characters WHERE name=?')
        .get(enriched[0].name) as IdRow | undefined;
      if (charIdRow?.id) {
        const { scoreDocs } = await import('../services/rag.js');
        const { reviewerSelect, getReviewerCache, setReviewerCache } = await import('../services/reviewer.js');
        const { loadFacts } = await import('../services/meta.js');
        const docs: RagDoc[] = [];
        const fs = await import('fs');
        const profiles = process.env.PROFILES_DIR || 'profiles';
        const pdir = path.join(profiles, charIdRow.id);
        const pushDoc = (id: string, title: string, text: string) => { if (text?.trim()) docs.push({ id, source: title, title, text }); };
        try { const p = path.join(pdir, 'profile.md'); if (fs.existsSync(p)) pushDoc('profile', 'profile', fs.readFileSync(p, 'utf-8')); } catch {}
        try { const t = path.join(pdir, 'timeline.md'); if (fs.existsSync(t)) pushDoc('timeline', 'timeline', fs.readFileSync(t, 'utf-8')); } catch {}
        try { const ddir = path.join(pdir, 'docs'); if (fs.existsSync(ddir)) for (const f of fs.readdirSync(ddir)) if (/\.(md|txt)$/i.test(f)) pushDoc(`doc:${f}`, f, fs.readFileSync(path.join(ddir, f), 'utf-8')); } catch {}
        try {
          const mems = db
            .prepare('SELECT text FROM memories WHERE character_id=? ORDER BY created_at DESC LIMIT 200')
            .all(enriched[0].name) as Array<{ text: string }>;
          for (let i = 0; i < mems.length; i++) {
            pushDoc(`mem:${i}`, 'memory', String(mems[i].text || ''));
          }
        } catch {}
        const scored = scoreDocs(String(playerFinal), docs).slice(0, 5);
        // Invalidate reviewer cache on cadence or when /reseed is used
        const reseed = parsed.commands.some(c => c.kind === 'reseed');
        let selectedIds: string[] | null = (includePromptHints || reseed) ? null : getReviewerCache(session_id);
        if (!selectedIds) {
          const candidatePayload: Candidate[] = scored.map((d) => ({
            id: d.id,
            text: d.text,
            score: d.score,
            occurred_at: d.occurred_at ?? null,
          }));
          const review = await reviewerSelect({
            character_id: charIdRow.id,
            reviewer_provider: reviewerProvider,
            reviewer_model,
            x_provider_key: (req as any).providerKey,
            candidates: candidatePayload,
            style_short,
          });
          selectedIds = review.selected?.length ? review.selected : scored.slice(0, 3).map((d) => d.id);
          if (selectedIds) setReviewerCache(session_id, selectedIds);
        }
        const selected = scored.filter((d) => selectedIds?.includes(d.id));
        const facts = loadFacts(charIdRow.id) || { name: enriched[0].name } as any;
        const style = (style_short || facts?.reviewer_hints?.prefer_brief) ? "\nGuidelines: Keep replies brief (1–3 short sentences). Avoid long paragraphs." : '';
        const factsLine = `Facts: name=${facts.name}`
          + (facts.nicknames?.length? `; nicknames=${facts.nicknames.join('/')}`:'')
          + (facts.aliases?.length? `; aliases=${facts.aliases.join('/')}`:'')
          + (facts.age!=null? `; age=${facts.age}`:'')
          + (facts.birth_year!=null? `; birth_year=${facts.birth_year}`:'')
          + (facts.story_start? `; story_start=${facts.story_start}`:'');
        const snips = selected.map((d:any) => `- [${d.source}] ${d.title||''}\n${String(d.text).slice(0,500)}`).join('\n\n');
        const ragBlock = factsLine + '\n' + snips + style;
        extraContext = extraContext ? `${extraContext}\n\n${ragBlock}` : ragBlock;
      }
    }
  } catch {}

  // Call LLM (mock by default in this environment)
  // Determine narrative time from scene_state if available
  let narrativeIso: string | undefined;
  try {
    const row = db
      .prepare('SELECT current_json FROM scene_state WHERE session_id=? ORDER BY updated_at DESC LIMIT 1')
      .get(session_id) as SceneStateRow | undefined;
    if (row?.current_json) {
      const cur = JSON.parse(row.current_json);
      if (cur?.time) narrativeIso = cur.time;
    }
  } catch {}
  const charListForModel: TurnCharacter[] = enriched.length ? enriched : filteredCharacters;
  const charactersForModel: LlmCharacter[] = charListForModel.map((c) => ({
    ...c,
    system_prompt: typeof c.system_prompt === 'string' ? c.system_prompt : `You are ${c.name}.`,
  }));
  // Append explicit control rule when multiple characters are player-controlled
  try {
    const ctrl = db
      .prepare('SELECT character_id FROM session_control WHERE session_id=? AND controller=?')
      .all(session_id, 'player') as ControlRow[];
    const ids = new Set<string>(ctrl.map((r) => String(r.character_id)));
    if (ids.size > 1) {
      const names: string[] = [];
      for (const id of ids) {
        const n = db.prepare('SELECT name FROM characters WHERE id=?').get(id) as CharacterNameRow | undefined;
        if (n?.name) names.push(n.name);
      }
      if (names.length > 1) extraContext = (extraContext ? extraContext + '\n\n' : '') + `Do not generate turns for: ${names.join(', ')} (player-controlled).`;
    }
  } catch {}
  const validNames = charListForModel.map((c) => c.name);
  let npc: any;
  try {
    npc = await llmTurn({
      provider: providerSlug,
      scene_context,
      characters: charactersForModel,
      player_text: playerFinal,
      providerKey: (req as any).providerKey,
      model,
      mature,
      narrativeTimeIso: narrativeIso,
      extraContext,
      useResponses: !!use_responses || String(process.env.OPENAI_USE_RESPONSES || '').toLowerCase() === 'true',
      playerLabel,
      playerActingAs,
      playerAliases,
    });
  } catch (e: any) {
    const msg = e?.message || String(e) || 'LLM error';
    appendTranscript(session_id, `system: Error calling model: ${msg}`);
    return res.status(500).json({ error: 'llm_error', message: msg });
  }

  const out: any[] = [];
  // If suggest mode, prepend a system suggestion
  if (tweak.action === 'suggest' && tweak.suggestion) {
    out.push({ speaker: 'System', text: tweak.suggestion, speak: false });
  }
  function normalizeSpeaker(s: string): string {
    if (!s) return validNames[0] || 'Narrator';
    const raw = String(s).trim();
    // If model used a placeholder or angle brackets, fallback
    if (raw.startsWith('<') || raw.includes('one of the characters')) return validNames[0] || 'Narrator';
    // Exact match
    if (validNames.includes(raw)) return raw;
    // Case-insensitive exact
    const ci = validNames.find(n => n.toLowerCase() === raw.toLowerCase());
    if (ci) return ci;
    return validNames[0] || 'Narrator';
  }

  // Normalize NPC output
  const npcTurns = (npc && Array.isArray(npc.turns)) ? npc.turns : [];
  if (npcTurns.length === 0) {
    appendTranscript(session_id, `system: Model returned no turns; using fallback.`);
  }
  for (const t of (npcTurns.length ? npcTurns : [{ speaker: charListForModel[0]?.name || 'Narrator', text: '…', speak: false }])) {
    const speaker = normalizeSpeaker(t.speaker);
    const id = uuid();
    db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)')
      .run(id, session_id, 'npc', speaker, t.text, null, Date.now(), JSON.stringify({ emotion: t.emotion ?? null }));
    appendTranscript(session_id, `${speaker}: ${t.text}`);
    recordUsage(session_id, providerSlug, 'npc', t.text);
    out.push({ speaker, text: t.text, speak: t.speak !== false });
  }

  // Memory extraction (placeholder) + snapshot pointer
  extractAndStoreMemories(session_id, out);
  // Add rough timeline events for each NPC reply (placeholder)
  out.forEach(t => addEvent({ scope: 'character', ownerId: t.speaker, title: 'Said something', summary: t.text.slice(0,120), participants: [t.speaker, 'player'], sources: { session_id } }));
  snapshotTurn(session_id, playerTurnId, { characters: characterList, provider: providerSlug });

  try {
    const payload = JSON.stringify({ turns: out });
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(payload);
  } catch (e) {
    return res.status(500).json({ error: 'serialize_error', message: String(e) });
  }
});
