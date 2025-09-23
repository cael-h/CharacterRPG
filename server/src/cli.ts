#!/usr/bin/env node
import 'dotenv/config';
import readline from 'readline';

const BASE = process.env.CLI_BASE || `http://localhost:${process.env.PORT || 4000}`;

type Character = { id: string; name: string; system_prompt?: string };

function rl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function question(q: string): Promise<string> {
  const i = rl();
  return new Promise((resolve) => i.question(q, (ans) => { i.close(); resolve(ans); }));
}

function keypress(): Promise<Buffer> {
  return new Promise((resolve) => {
    const onData = (b: Buffer) => { process.stdin.off('data', onData); resolve(b); };
    process.stdin.once('data', onData);
  });
}

async function singleSelect(title: string, items: string[], initial = 0): Promise<number> {
  if (!process.stdin.isTTY) return 0;
  let idx = Math.min(Math.max(0, initial), Math.max(items.length - 1, 0));
  process.stdout.write(`\n${title}\n`);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  const render = () => {
    // Move cursor up to redraw
    const lines = items.length;
    process.stdout.write(`\x1b[${lines}F`); // move up N lines
    for (let i = 0; i < items.length; i++) {
      const prefix = i === idx ? '› ' : '  ';
      const line = i === idx ? `\x1b[36m${items[i]}\x1b[0m` : items[i];
      process.stdout.write(`${prefix}${line}\x1b[K\n`);
    }
  };
  // Initial paint
  for (let i = 0; i < items.length; i++) process.stdout.write(`  ${items[i]}\n`);
  render();
  while (true) {
    const b = await keypress();
    const s = b.toString();
    if (s === '\u0003') { // Ctrl+C
      process.stdout.write('\n');
      process.exit(1);
    }
    if (s === '\r') { // Enter
      process.stdin.setRawMode?.(false); process.stdout.write('\n');
      return idx;
    }
    if (s === '\u001b[A') { // Up
      idx = (idx - 1 + items.length) % items.length; render();
    } else if (s === '\u001b[B') { // Down
      idx = (idx + 1) % items.length; render();
    }
  }
}

async function multiSelect(title: string, items: string[], initiallyChecked: Set<number> = new Set()): Promise<Set<number>> {
  if (!process.stdin.isTTY) return initiallyChecked;
  let idx = 0; const checked = new Set<number>(initiallyChecked);
  process.stdout.write(`\n${title}\n`);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  const render = () => {
    const lines = items.length;
    process.stdout.write(`\x1b[${lines}F`);
    for (let i = 0; i < items.length; i++) {
      const sel = checked.has(i) ? '[x]' : '[ ]';
      const cursor = i === idx ? '›' : ' ';
      const line = i === idx ? `\x1b[36m${items[i]}\x1b[0m` : items[i];
      process.stdout.write(`${cursor} ${sel} ${line}\x1b[K\n`);
    }
  };
  for (let i = 0; i < items.length; i++) process.stdout.write(`  [ ] ${items[i]}\n`);
  render();
  while (true) {
    const b = await keypress();
    const s = b.toString();
    if (s === '\u0003') { process.stdout.write('\n'); process.exit(1); }
    if (s === '\r') { process.stdin.setRawMode?.(false); process.stdout.write('\n'); return checked; }
    if (s === ' ') { checked.has(idx) ? checked.delete(idx) : checked.add(idx); render(); }
    else if (s === '\u001b[A') { idx = (idx - 1 + items.length) % items.length; render(); }
    else if (s === '\u001b[B') { idx = (idx + 1) % items.length; render(); }
  }
}

async function getCharacters(): Promise<Character[]> {
  const res = await fetch(`${BASE}/api/characters`);
  if (!res.ok) throw new Error(`characters request failed (${res.status})`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.filter((c): c is Character => typeof c?.id === 'string' && typeof c?.name === 'string');
}

async function addCharacter(name: string, system_prompt: string) {
  await fetch(`${BASE}/api/characters`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, system_prompt }) });
}

interface SessionResponse { id?: string }

async function startSession(provider: string, participants: { id: string }[]): Promise<string> {
  const res = await fetch(`${BASE}/api/sessions`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ title: 'CLI', provider, participants })
  });
  if (!res.ok) throw new Error(`session create failed (${res.status})`);
  const data = (await res.json()) as SessionResponse;
  if (!data.id) throw new Error('session id missing');
  return data.id;
}

async function endSession(id: string) {
  await fetch(`${BASE}/api/sessions/${id}/end`, { method:'POST' });
}

type Turn = { speaker: string; text: string };

async function sendTurn(opts: { session_id: string; text: string; provider: string; model?: string; mature?: boolean; tweakMode?: 'off'|'suggest'|'auto'; chars: Character[]; }): Promise<Turn[]> {
  const body = {
    session_id: opts.session_id,
    player_text: opts.text,
    scene_context: {},
    characters: opts.chars.map(c => ({ name: c.name, system_prompt: c.system_prompt || `You are ${c.name}.` })),
    provider: opts.provider,
    model: opts.model,
    mature: opts.mature,
    tweakMode: opts.tweakMode || 'off',
  };
  const res = await fetch(`${BASE}/api/convo/turn`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`turn failed (${res.status})`);
  const data = (await res.json()) as { turns?: Turn[] };
  return Array.isArray(data.turns) ? data.turns : [];
}

async function main() {
  console.log(`CharacterRPG CLI — Server: ${BASE}`);
  const argv = process.argv.slice(2);
  const opt = new Map<string,string|boolean>();
  for (let i=0;i<argv.length;i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k,v] = a.replace(/^--/,'').split('=');
      opt.set(k, v ?? true);
    }
  }
  let chars = await getCharacters();
  if (!chars.length) {
    console.log('No characters found. Let\'s add one.');
    const name = (await question('Name [Olive]: ')) || 'Olive';
    const sys = (await question('System prompt [You are Olive.]: ')) || 'You are Olive.';
    await addCharacter(name, sys);
    chars = await getCharacters();
  }

  // Select characters (multi)
  const names = chars.map(c => c.name);
  const selIdx = await multiSelect('Select characters (Space to toggle, Enter to confirm)', names);
  const chosen = chars.filter((_, i) => selIdx.has(i));
  if (!chosen.length) { console.log('No characters selected. Exiting.'); process.exit(0); }

  // Provider select
  const providers = ['mock', 'ollama', 'openai'];
  const pIdx = await singleSelect('Provider (↑/↓, Enter)', providers);
  const provider = providers[pIdx];
  let model: string | undefined = undefined;
  if (provider === 'ollama' || provider === 'openai') {
    const m = await question('Model (blank uses OLLAMA_MODEL) [deepseek-r1:1.5b]: ');
    model = m || undefined;
  }
  const useRag = String(opt.get('rag') ?? 'true') !== 'false';
  const short = String(opt.get('short') ?? 'true') !== 'false';
  const mature = ((await question('Mature language? (y/N): ')).trim().toLowerCase().startsWith('y'));
  const tweakAns = (await question('Tweaker (off/suggest/auto) [off]: ')).trim().toLowerCase();
  const tweakMode = (['off','suggest','auto'].includes(tweakAns) ? tweakAns : 'off') as 'off'|'suggest'|'auto';

  const sessionId = await startSession(provider, chosen.map(c => ({ id: c.id })));
  console.log(`Session: ${sessionId}`);
  console.log('Type messages. Commands: /end to end session, /exit to quit.');

  const i = rl();
  const prompt = () => { i.setPrompt('> '); i.prompt(); };
  i.on('line', async (line) => {
    const text = line.trim();
    if (!text) { prompt(); return; }
    if (text === '/end') { await endSession(sessionId); console.log('Session ended.'); prompt(); return; }
    if (text === '/exit') { await endSession(sessionId).catch(()=>{}); i.close(); return; }
    console.log(`You: ${text}`);
    try {
      const turns = await sendTurn({ session_id: sessionId, text, provider, model, mature, tweakMode, chars: chosen });
      for (const t of turns) console.log(`${t.speaker}: ${t.text}`);
    } catch (e) {
      console.log('Error:', e);
    }
    prompt();
  }).on('close', () => {
    process.stdout.write('\n');
    process.exit(0);
  });
  prompt();
}

main().catch((e) => { console.error(e); process.exit(1); });
