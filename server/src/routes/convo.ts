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
  const { session_id, player_text, scene_context, characters, provider, model, mature, tweakMode, useRag, reviewer_provider, reviewer_model, style_short, use_responses } = req.body || {};
  // Debug short-circuit to validate transport
  try {
    if (String(req.query?.debug || '') === '1') {
      const name = (Array.isArray(characters) && characters[0]?.name) || 'Narrator';
      return res.status(200).json({ turns: [{ speaker: name, text: `(debug) echo: ${String(player_text||'')}`, speak: false }] });
    }
  } catch {}
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
    if (c.kind === 'addchar') {
      try {
        const exists = db.prepare('SELECT id FROM characters WHERE name=?').get(c.name);
        let newId = exists?.id;
        if (!newId) {
          const nid = uuid();
          db.prepare('INSERT INTO characters (id,name,system_prompt,memory_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
            .run(nid, c.name, '', '{}', Date.now(), Date.now());
          newId = nid;
        }
        // Create an initial profile doc summarizing from this session transcript end (last ~2KB)
        const fs = await import('fs');
        const path = await import('path');
        const tdir = process.env.TRANSCRIPTS_DIR || 'transcripts';
        const tpath = path.join(tdir, `${session_id}.md`);
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
        const targetName = c.name || (Array.isArray(characters) && characters[0]?.name) || 'Unknown';
        const row = db.prepare('SELECT id FROM characters WHERE name=?').get(targetName);
        if (row?.id) {
          const fs = await import('fs');
          const path = await import('path');
          const base = process.env.PROFILES_DIR || 'profiles';
          const dir = path.join(base, row.id, 'docs', 'updates');
          fs.mkdirSync(dir, { recursive: true });
          const tdir = process.env.TRANSCRIPTS_DIR || 'transcripts';
          const tpath = path.join(tdir, `${session_id}.md`);
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
  try {
    if (useRag && Array.isArray(enriched) && enriched.length > 0) {
      const charIdRow = db.prepare('SELECT id FROM characters WHERE name=?').get(enriched[0].name);
      if (charIdRow?.id) {
        const { scoreDocs } = await import('../services/rag.js');
        const { reviewerSelect, getReviewerCache, setReviewerCache } = await import('../services/reviewer.js');
        const { loadFacts } = await import('../services/meta.js');
        const docs: any[] = [];
        const fs = await import('fs');
        const path = await import('path');
        const profiles = process.env.PROFILES_DIR || 'profiles';
        const pdir = path.join(profiles, charIdRow.id);
        const pushDoc = (id: string, title: string, text: string) => { if (text?.trim()) docs.push({ id, source: title, title, text }); };
        try { const p = path.join(pdir, 'profile.md'); if (fs.existsSync(p)) pushDoc('profile', 'profile', fs.readFileSync(p, 'utf-8')); } catch {}
        try { const t = path.join(pdir, 'timeline.md'); if (fs.existsSync(t)) pushDoc('timeline', 'timeline', fs.readFileSync(t, 'utf-8')); } catch {}
        try { const ddir = path.join(pdir, 'docs'); if (fs.existsSync(ddir)) for (const f of fs.readdirSync(ddir)) if (/\.(md|txt)$/i.test(f)) pushDoc(`doc:${f}`, f, fs.readFileSync(path.join(ddir, f), 'utf-8')); } catch {}
        try { const mems = db.prepare('SELECT text FROM memories WHERE character_id=? ORDER BY created_at DESC LIMIT 200').all(enriched[0].name); for (let i=0;i<mems.length;i++) pushDoc(`mem:${i}`, 'memory', String(mems[i].text||'')); } catch {}
        const scored = scoreDocs(String(playerFinal), docs).slice(0,5);
        let selectedIds = getReviewerCache(session_id);
        if (!selectedIds) {
          const review = await reviewerSelect({ reviewer_provider, reviewer_model, x_provider_key: (req as any).providerKey, candidates: scored, style_short });
          selectedIds = review.selected?.length ? review.selected : scored.slice(0,3).map((d:any)=>d.id);
          setReviewerCache(session_id, selectedIds);
        }
        const selected = scored.filter((d:any)=> selectedIds?.includes(d.id));
        const facts = loadFacts(charIdRow.id) || { name: enriched[0].name } as any;
        const style = (style_short || facts?.reviewer_hints?.prefer_brief) ? "\nGuidelines: Keep replies brief (1–3 short sentences). Avoid long paragraphs." : '';
        const factsLine = `Facts: name=${facts.name}`
          + (facts.nicknames?.length? `; nicknames=${facts.nicknames.join('/')}`:'')
          + (facts.aliases?.length? `; aliases=${facts.aliases.join('/')}`:'')
          + (facts.age!=null? `; age=${facts.age}`:'')
          + (facts.birth_year!=null? `; birth_year=${facts.birth_year}`:'')
          + (facts.story_start? `; story_start=${facts.story_start}`:'');
        const snips = selected.map((d:any) => `- [${d.source}] ${d.title||''}\n${String(d.text).slice(0,500)}`).join('\n\n');
        extraContext = factsLine + '\n' + snips + style;
      }
    }
  } catch {}

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
  const charListForModel = enriched.length ? enriched : characters;
  const validNames = Array.isArray(charListForModel) ? charListForModel.map((c:any)=>c.name) : [];
  let npc: any;
  try {
    npc = await llmTurn({ provider: provider ?? 'mock', scene_context, characters: charListForModel, player_text: playerFinal, providerKey: (req as any).providerKey, model, mature, narrativeTimeIso: narrativeIso, extraContext, useResponses: !!use_responses || String(process.env.OPENAI_USE_RESPONSES||'').toLowerCase()==='true' });
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
  for (const t of (npcTurns.length ? npcTurns : [{ speaker: (Array.isArray(charListForModel) && charListForModel[0]?.name) || 'Narrator', text: '…', speak: false }])) {
    const speaker = normalizeSpeaker(t.speaker);
    const id = uuid();
    db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?)')
      .run(id, session_id, 'npc', speaker, t.text, null, Date.now(), JSON.stringify({ emotion: t.emotion ?? null }));
    appendTranscript(session_id, `${speaker}: ${t.text}`);
    recordUsage(session_id, provider ?? 'mock', 'npc', t.text);
    out.push({ speaker, text: t.text, speak: t.speak !== false });
  }

  // Memory extraction (placeholder) + snapshot pointer
  extractAndStoreMemories(session_id, out);
  // Add rough timeline events for each NPC reply (placeholder)
  out.forEach(t => addEvent({ scope: 'character', ownerId: t.speaker, title: 'Said something', summary: t.text.slice(0,120), participants: [t.speaker, 'player'], sources: { session_id } }));
  snapshotTurn(session_id, playerTurnId, { characters, provider });

  try {
    const payload = JSON.stringify({ turns: out });
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(payload);
  } catch (e) {
    return res.status(500).json({ error: 'serialize_error', message: String(e) });
  }
});
