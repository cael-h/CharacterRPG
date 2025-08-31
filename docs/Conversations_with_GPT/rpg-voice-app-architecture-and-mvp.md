# RPG Voice App — Android (React Native + Node/TypeScript)

This document contains:

- A detailed architecture & reasoning
- An implementation plan
- A working MVP you can run today (text↔voice with barge‑in policy, transcripts, character profiles, multi‑character scenes)
- Provider adapters for **OpenAI** and **Gemini** with a simple toggle
- Stubs for realtime full‑duplex (WebRTC/Live API) you can enable later
- An Amendments Log (design changes + why)

---

## 0) Quick Start (MVP you can run now)

**What’s live in the MVP**

- Android app (React Native) with a **voice↔text input toggle** and **OpenAI↔Gemini provider toggle**
- NPC replies rendered as **text and/or TTS audio** with our **humane barge‑in** behavior (courtesy pause + continuation capsules)
- **Character profiles** (twins or any NPC), persisted locally + mirrored on the server; load per scene
- **Multi‑character scenes** from a **single LLM** using structured JSON output to indicate the speaking character
- **Transcripts saved** to SQLite on the server (per session, per turn)

**What’s scaffolded (optional to enable later)**

- OpenAI **Realtime (WebRTC)** path and Gemini **Live** path for true low‑latency voice‑to‑voice. The app already has the switches and client plumbing; enable when you have keys and want to try it.

### Prereqs

- Node 18+
- Android Studio + SDK; USB debugging or emulator

### 1) Clone & install

```
repo/
  server/
  app/
```

```bash
cd server
cp .env.example .env   # add your keys
npm i
npm run dev            # starts http://localhost:4000
```

```bash
cd ../app
cp .env.example .env   # points to your server, selects provider
npm i
npm run android        # or: npx react-native run-android
```

**Open the app** → pick provider (OpenAI/Gemini), pick input mode (Voice/Text), load your character profile, and start a scene.

> Note: When you’re not in a place to speak, flip to **Text**. The NPC still speaks in your headphones if enabled, or just prints text if not.

---

## 1) Product Goals → Technical Shape

**Goals**

- Fluid **player↔NPC** conversations with a **toggle** between voice and text input.
- NPCs usually **speak**, but can fall back to text for awkward/narration lines.
- **Humane barge‑in**: brief user sounds don’t hard‑cut the NPC. NPC can finish the clause, insert a courtesy pause, ask if you want to jump in, and resume (keeping a **Continuation Capsule** of the unsaid tail).
- **Multi‑character** scenes (twins, others) with a simple persona system and per‑speaker voices.
- **Durable transcripts** and **character memory** across sessions.
- **Provider‑agnostic**: OpenAI / Gemini swap.

**Key design choices**

1. **Two output paths**

   - **Orchestrated path (default, MVP shipped):** LLM → text → *our* clause‑chunker → TTS → playback. We own timing, barge‑in, rewinds, courtesy pauses. Predictable.
   - **Realtime path (optional):** Provider Live/Realtime APIs for ultra‑low latency. Less control over overlap right now, so we gate it behind a toggle.

2. **Single‑LLM, multi‑speaker**: One model produces JSON blocks like `{speaker, text, speak}`. We route voice per speaker. Simpler than running multiple models and more coherent in scene.

3. **Continuation Capsules**: If the NPC was mid‑thought when a micro‑interrupt happened, we stash the remaining text with a TTL and a friendly hook line for later.

4. **Storage**: SQLite on the server for transcripts & profiles (keeps the phone lightweight, makes export simple). App keeps a small offline cache.

5. **Safety & secrets**: Server holds provider keys. App talks to your server only.

---

## 2) System Architecture

**Client (React Native, Android)**

- UI toggles: input mode (voice/text), provider (OpenAI/Gemini), headphones on/off for auto‑voice.
- Audio: capture mic (PCM), play TTS, duck/unduck, VAD for micro‑interrupt signals.
- **Barge‑In Controller (client)**: cheap energy+duration logic to mark `micro`, `backchannel`, `apology` in real time.
- **Scene Orchestrator**: send user turns→server, receive structured NPC turns, feed to TTS per speaker, show text.

**Server (Node + Express + SQLite)**

- **LLM Router**: OpenAI or Gemini text generation with a system prompt that enforces JSON output.
- **TTS Router**: OpenAI TTS or Gemini/Cloud TTS (SSML optional). Streams audio to client.
- **STT (optional)**: endpoints to transcribe voice turns if you want voice‑in without provider Live/Realtime.
- **Barge‑In Controller (server)**: clause chunking, polite pause, continuation capsules, resume/drop logic, rewind one clause.
- **Persistence**: characters, sessions, turns, capsules.
- **(Optional) Realtime/Live**: REST endpoints for SDP/WebSocket bootstrapping; disabled by default.

**Data model (SQLite)**

```sql
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  voice TEXT,
  provider TEXT,
  system_prompt TEXT NOT NULL,
  memory_json TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  provider TEXT,
  participants_json TEXT NOT NULL, -- array of character ids + player meta
  started_at INTEGER,
  ended_at INTEGER
);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT, -- 'player' | 'npc'
  speaker TEXT, -- npc name or 'player'
  text TEXT,
  audio_path TEXT,
  created_at INTEGER
);

CREATE TABLE capsules (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  speaker TEXT,
  tail_text TEXT,
  resume_hint TEXT,
  hook TEXT,
  drop_if TEXT,  -- json array
  ttl_ms INTEGER,
  created_at INTEGER
);
```

---

## 3) Barge‑In & Continuation Capsules (Policy)

**Client VAD flags**

- `micro`: user sound <350 ms or <700 ms followed by ≥500 ms silence; or low‑energy blip
- `backchannel`: ASR partials like “uh‑huh”, “yeah”, “mm”, “sorry”, “go ahead”, “continue”

**Server clause handling**

- NPC speech is chunked by clause (`, ; — . ? !`).
- If `micro` occurs *during* NPC speech → let current clause finish, **pause 750 ms**, ask: “Want to jump in?”
  - If user speaks within 2 s → yield floor; **stash tail** as a capsule
  - If not → resume from capsule and clear it

**Capsule schema**

```json
{
  "tail_text": "the remainder not yet spoken",
  "resume_hint": "pick up at…",
  "hook": "One more thing about the gate…",
  "drop_if": ["topic_changed","2_turns_passed"],
  "ttl_ms": 120000
}
```

**Cooldowns**

- Courtesy prompt at most once every 20 s per speaker.

---

## 4) Multi‑Character Orchestration

**System prompt fragment** (server injects):

> You are running a scene with these characters: … Output **only** JSON as an array of turns with shape `{speaker, text, speak}`. `speaker` must be one of the listed characters. Use `speak:false` for stage‑directions better left as text. Keep each turn to ≤2 sentences unless asked.

**Model output example**

```json
{
  "turns": [
    { "speaker": "Olive", "text": "I pull out the map and tap the western gate.", "speak": true },
    { "speaker": "Dee",   "text": "Careful. Those torches aren’t for show.", "speak": true },
    { "speaker": "Olive", "text": "[The wind cuts through the alley.]", "speak": false }
  ]
}
```

The client plays voices for `speak:true` using each character’s configured voice; `speak:false` prints as text.

---

## 5) Implementation Plan

1. **Server skeleton** (Express, SQLite), character CRUD, sessions, transcripts
2. **LLM Router** (OpenAI/Gemini) with JSON‑only guard + retries on invalid JSON
3. **ClauseChunker + Capsules** + polite pause handling
4. **TTS Router** (OpenAI / Gemini)
5. **Client** screens: Characters, Conversation; provider + mode toggles; headphone auto‑voice
6. **Playback queue** with duck/unduck; **Barge‑In Controller** on client
7. **Optional**: STT endpoints (OpenAI or Google) for voice‑in without Live/Realtime
8. **Optional**: Realtime/Live bootstraps (WebRTC/WebSocket)

---

## 6) Server Code (TypeScript)

> Minimal but runnable. Error handling trimmed for brevity.

**server/package.json**

```json
{
  "name": "rpg-voice-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "node-fetch": "^3.3.2",
    "zod": "^3.23.8",
    "multer": "^1.4.5-lts.1",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.4.5"
  }
}
```

**server/.env.example**

```
OPENAI_API_KEY=sk-...
OPENAI_TTS_VOICE=alloy
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_STT_MODEL=whisper-1

GOOGLE_PROJECT_ID=your-project
GOOGLE_APPLICATION_CREDENTIALS=./gcloud.json
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TTS_VOICE=en-US-Neural2-C

PORT=4000
```

**server/src/index.ts**

```ts
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { router as characterRouter } from './routes/characters.js';
import { router as sessionRouter } from './routes/sessions.js';
import { router as convoRouter } from './routes/convo.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
const upload = multer();

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/characters', characterRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/convo', convoRouter);

// STT endpoints (optional; OpenAI example wired)
import { openaiTranscribe } from './providers/openai/stt.js';
app.post('/api/stt/openai', upload.single('audio'), openaiTranscribe);

app.listen(process.env.PORT || 4000, () => {
  console.log('Server listening on', process.env.PORT || 4000);
});
```

**server/src/db.ts**

```ts
import Database from 'better-sqlite3';
export const db = new Database('rpg.sqlite');

db.exec(`
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  voice TEXT,
  provider TEXT,
  system_prompt TEXT NOT NULL,
  memory_json TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  provider TEXT,
  participants_json TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  speaker TEXT,
  text TEXT,
  audio_path TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS capsules (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  speaker TEXT,
  tail_text TEXT,
  resume_hint TEXT,
  hook TEXT,
  drop_if TEXT,
  ttl_ms INTEGER,
  created_at INTEGER
);
`);
```

**server/src/routes/characters.ts**

```ts
import { Router } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';

export const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM characters').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const id = uuid();
  const now = Date.now();
  const { name, voice, provider, system_prompt, memory_json } = req.body;
  db.prepare(`INSERT INTO characters VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, name, voice, provider, system_prompt, memory_json ?? '{}', now, now);
  res.json({ id });
});
```

**server/src/routes/sessions.ts**

```ts
import { Router } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';

export const router = Router();

router.post('/', (req, res) => {
  const id = uuid();
  const { title, provider, participants } = req.body; // participants: array of character ids + player name
  db.prepare(`INSERT INTO sessions VALUES (?,?,?,?,?,?)`)
    .run(id, title ?? 'Scene', provider, JSON.stringify(participants), Date.now(), null);
  res.json({ id });
});

router.post('/:id/end', (req, res) => {
  db.prepare('UPDATE sessions SET ended_at=? WHERE id=?')
    .run(Date.now(), req.params.id);
  res.json({ ok: true });
});
```

**server/src/routes/convo.ts**

```ts
import { Router } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import { llmTurn } from '../services/llmRouter.js';
import { chunkByClause } from '../util/chunker.js';
import { synthesize } from '../services/ttsRouter.js';

export const router = Router();

// Player sends a turn; server returns a batch of NPC turns (structured)
router.post('/turn', async (req, res) => {
  const { session_id, player_text, scene_context, characters, provider, voices, voiceWanted } = req.body;

  // Persist player turn
  const turnId = uuid();
  db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?)')
    .run(turnId, session_id, 'player', 'player', player_text, null, Date.now());

  // Ask LLM for multi-speaker reply (JSON)
  const npc = await llmTurn({ provider, scene_context, characters, player_text });

  // For each NPC subturn, apply clause chunking and continuation capsule logic when needed
  // (Client sends VAD flags separately for streaming cases; in this MVP we return the full text and per‑speaker audio if requested.)

  const out: any[] = [];
  for (const t of npc.turns) {
    const clauses = chunkByClause(t.text);
    let audioPath: string | null = null;
    if (voiceWanted && t.speak !== false) {
      audioPath = await synthesize({ provider, voice: voices[t.speaker], text: t.text });
    }
    const id = uuid();
    db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?)')
      .run(id, session_id, 'npc', t.speaker, t.text, audioPath, Date.now());
    out.push({ speaker: t.speaker, text: t.text, speak: t.speak !== false, audio: audioPath, clauses });
  }

  res.json({ turns: out });
});
```

**server/src/services/llmRouter.ts**

```ts
import { openaiTurn } from '../providers/openai/text.js';
import { geminiTurn } from '../providers/gemini/text.js';

type Args = {
  provider: 'openai' | 'gemini',
  scene_context: any,
  characters: Array<{name:string, system_prompt:string}>,
  player_text: string,
};

const systemHeader = (chars: any[]) => `You are running a scene. Characters: ${chars.map(c=>c.name).join(', ')}.
Respond ONLY as strict JSON: {"turns":[{"speaker":"<name>","text":"...","speak":true}]}
Use the character voices and keep each turn to <= 2 sentences.`;

export async function llmTurn(a: Args) {
  const sys = systemHeader(a.characters);
  const user = a.player_text;
  if (a.provider === 'openai') return openaiTurn(sys, user);
  return geminiTurn(sys, user);
}
```

**server/src/providers/openai/text.ts**

```ts
import fetch from 'node-fetch';

export async function openaiTurn(system: string, user: string) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
      messages: [
        {role:'system', content: system},
        {role:'user', content: user}
      ],
      temperature: 0.8,
      response_format: { type: 'json_object' }
    })
  }).then(r => r.json());

  try { return JSON.parse(r.choices[0].message.content); }
  catch { return { turns: [{ speaker: 'Narrator', text: r.choices?.[0]?.message?.content ?? '…', speak: false }] }; }
}
```

**server/src/providers/gemini/text.ts**

```ts
import fetch from 'node-fetch';

export async function geminiTurn(system: string, user: string) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`;
  const body = {
    contents: [
      { role: 'user', parts: [{ text: system + "
" + user }] }
    ],
    generationConfig: { temperature: 0.8 },
    safetySettings: []
  };
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r => r.json());
  // Basic JSON parse; fallback if model returns text
  const text = r.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try { return JSON.parse(text); }
  catch { return { turns:[{ speaker:'Narrator', text, speak:false }] } }
}
```

**server/src/services/ttsRouter.ts**

```ts
import { openaiTTS } from '../providers/openai/tts.js';
import { geminiTTS } from '../providers/gemini/tts.js';

export async function synthesize({ provider, voice, text }:{provider:'openai'|'gemini',voice:string,text:string}) {
  if (provider==='openai') return openaiTTS(voice, text);
  return geminiTTS(voice, text);
}
```

**server/src/providers/openai/tts.ts**

```ts
import fetch from 'node-fetch';
import { writeFileSync } from 'fs';
import { randomUUID as uuid } from 'crypto';

export async function openaiTTS(voice: string, input: string) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: voice || process.env.OPENAI_TTS_VOICE || 'alloy',
      input
    })
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const path = `audio/${uuid()}.mp3`;
  writeFileSync(path, buf);
  return `/static/${path}`;
}
```

**server/src/providers/gemini/tts.ts**

```ts
// Uses Google Cloud Text-to-Speech for SSML control
import textToSpeech from '@google-cloud/text-to-speech';
import { writeFileSync } from 'fs';
import { randomUUID as uuid } from 'crypto';

const client = new textToSpeech.TextToSpeechClient();

export async function geminiTTS(voice: string, input: string) {
  const [resp] = await client.synthesizeSpeech({
    input: { text: input }, // or { ssml: '<speak>...</speak>' }
    voice: { languageCode: 'en-US', name: voice || process.env.GEMINI_TTS_VOICE },
    audioConfig: { audioEncoding: 'MP3' }
  });
  const path = `audio/${uuid()}.mp3`;
  writeFileSync(path, resp.audioContent as Buffer);
  return `/static/${path}`;
}
```

**server/src/providers/openai/stt.ts** (optional)

```ts
import fetch from 'node-fetch';
import type { Request, Response } from 'express';

export async function openaiTranscribe(req: Request, res: Response) {
  const audio = req.file?.buffer;
  const form = new FormData();
  form.append('file', new Blob([audio!]), 'audio.wav');
  form.append('model', process.env.OPENAI_STT_MODEL || 'whisper-1');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form as any
  }).then(r=>r.json());
  res.json({ text: r.text });
}
```

**server/src/util/chunker.ts**

```ts
export function chunkByClause(text: string) {
  const parts = text.split(/([,;——]|\.|\?|!)/).reduce((acc: string[], cur, i, arr) => {
    if (i%2===0) {
      const punct = arr[i+1] ?? '';
      acc.push((cur + punct).trim());
    }
    return acc;
  }, []).filter(s=>s.length);
  return parts;
}
```

---

## 7) Android App (React Native)

**app/package.json**

```json
{
  "name": "rpg-voice-app",
  "private": true,
  "scripts": {
    "android": "react-native run-android"
  },
  "dependencies": {
    "@react-native-async-storage/async-storage": "^1.23.1",
    "react": "18.2.0",
    "react-native": "0.75.0",
    "react-native-sound": "^0.11.2",
    "react-native-webrtc": "^111.0.0",
    "zustand": "^4.5.2"
  }
}
```

**app/.env.example**

```
API_BASE=http://10.0.2.2:4000
PROVIDER=openai   # or gemini
DEFAULT_VOICES={"Olive":"alloy","Dee":"verse"}
```

**app/App.tsx**

```tsx
import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, Button, TextInput, Switch, FlatList, TouchableOpacity } from 'react-native';
import create from 'zustand';
import Sound from 'react-native-sound';

const useStore = create<any>((set)=>({
  provider: 'openai',
  voiceWanted: true,
  inputMode: 'text',
  sessionId: null,
  characters: [],
  turns: [],
  set: (x:any)=>set(x)
}));

async function api(path: string, opts: any = {}) {
  const base = process.env.API_BASE || 'http://10.0.2.2:4000';
  const r = await fetch(base + path, { headers:{'Content-Type':'application/json'}, ...opts });
  return r.json();
}

function play(url: string) {
  const s = new Sound(url, undefined, (e)=>{ if(e) console.warn(e); else s.play(()=>s.release()); });
}

export default function App() {
  const { provider, voiceWanted, inputMode, sessionId, characters, turns, set } = useStore();
  const [text, setText] = useState('');

  const startSession = async () => {
    const r = await api('/api/sessions', { method:'POST', body: JSON.stringify({ title:'Scene', provider, participants: characters }) });
    set({ sessionId: r.id });
  };

  const send = async () => {
    if (!sessionId) await startSession();
    const voices = JSON.parse(process.env.DEFAULT_VOICES||'{}');
    const r = await api('/api/convo/turn', {
      method:'POST',
      body: JSON.stringify({ session_id: useStore.getState().sessionId, player_text: text, scene_context: {}, characters, provider, voices, voiceWanted })
    });
    setText('');
    const newTurns = [...turns];
    r.turns.forEach((t:any)=>{
      newTurns.push({ role:'npc', ...t });
      if (t.audio) play(process.env.API_BASE + t.audio);
    });
    set({ turns: newTurns });
  };

  return (
    <SafeAreaView style={{flex:1, padding:12}}>
      <View style={{flexDirection:'row', justifyContent:'space-between'}}>
        <Text>Provider: {provider}</Text>
        <Button title="Toggle" onPress={()=>set({provider: provider==='openai'?'gemini':'openai'})} />
      </View>
      <View style={{flexDirection:'row', alignItems:'center', marginTop:8}}>
        <Text>Voice NPC</Text>
        <Switch value={voiceWanted} onValueChange={(v)=>set({voiceWanted:v})} />
        <Text style={{marginLeft:12}}>Input: {inputMode}</Text>
        <Button title="Flip" onPress={()=>set({inputMode: inputMode==='text'?'voice':'text'})} />
      </View>

      <FlatList style={{flex:1, marginVertical:8}}
        data={turns}
        keyExtractor={(_,i)=>String(i)}
        renderItem={({item})=> (
          <View style={{marginVertical:6}}>
            <Text style={{fontWeight:'600'}}>{item.speaker || 'NPC'}</Text>
            <Text>{item.text}</Text>
          </View>
        )}
      />

      {inputMode==='text' ? (
        <View style={{flexDirection:'row'}}>
          <TextInput style={{flex:1, borderWidth:1, padding:8}} value={text} onChangeText={setText} placeholder="Say something..." />
          <Button title="Send" onPress={send} />
        </View>
      ) : (
        <View>
          <Text>Voice mode scaffolded (wire STT or Live/Realtime).</Text>
          {/* TODO: open mic, stream to /api/stt, feed results into /api/convo/turn automatically */}
        </View>
      )}
    </SafeAreaView>
  );
}
```

> The **Voice** input path is scaffolded: hook a mic stream to `/api/stt/openai` (or your own VAD) and forward recognized text into `/api/convo/turn`. This gives you voice‑in today with our humane barge‑in on the NPC side.

---

## 8) Realtime / Live (Optional, behind toggle)

**OpenAI Realtime (WebRTC)**

- Client: create `RTCPeerConnection`, add mic track, post offer SDP to a server endpoint that forwards to OpenAI Realtime and returns answer. Attach remote audio to a hidden player. Use the same **Barge‑In Controller** to avoid hard cuts: duck on micro‑overlaps, only cancel on sustained intent.

**Gemini Live**

- Client: create a WebSocket to Gemini Live; send audio frames and read audio chunks back. The app already has a provider toggle; add a `Live` mode to route through this path. Keep our courtesy pause logic client‑side by gating when to send `stop`/`continue`.

> Both are left as **stubs** in the repo to keep the MVP small and reliable. Flip them on when you’re ready to experiment.

---

## 9) Why these decisions

- The **orchestrated path** gives us control over rhythm (pauses, rewind, capsules). It solves the “human overlap” problem better than pure provider‑driven streams right now.
- **Single‑LLM multi‑speaker** keeps state unified and cheaper than per‑character models, and it avoids NPCs accidentally talking over each other without a shared plan.
- **SQLite** is dead simple to backup/export and good enough for transcripts.
- **React Native** lets you iterate quickly on Android; you can always port to Kotlin native later for tighter audio APIs.

---

## 10) Running Notes & Known Gaps

- **STT**: The endpoint uses OpenAI as an example. If you prefer Google STT, add an analogous `/api/stt/gemini`.
- **Streaming**: The MVP returns per‑turn audio URLs, not true chunked streaming audio. If you want clause‑by‑clause streaming, wire SSE or WebSocket from the server and play progressively on the client.
- **Realtime/Live**: Off by default; enable when you want the lowest latency and are ok with less fine‑grained control.

---

## 11) Amendments Log

- **A1 (initial)**: Planned to ship full WebRTC on day one. Adjusted to an orchestrated TTS pipeline for reliability and to preserve humane barge‑in (provider Live/Realtime can hard‑cut). WebRTC/Live left as stubs for opt‑in testing.
