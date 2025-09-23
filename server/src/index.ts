import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { router as characterRouter } from './routes/characters.js';
import { router as sessionRouter } from './routes/sessions.js';
import { router as convoRouter } from './routes/convo.js';
import { stripSensitiveHeaders } from './middleware/stripHeaders.js';
import { cors } from './middleware/cors.js';
import { router as exportRouter } from './routes/exports.js';
import { router as docsRouter } from './routes/docs.js';
import { router as ragRouter } from './routes/rag.js';
import { router as providersRouter } from './routes/providers.js';
import { router as promptsRouter } from './routes/prompts.js';
import { router as debugRouter } from './routes/debug.js';
import { router as storiesRouter } from './routes/stories.js';
import { importSeeds, importFromDocs, importFromProfiles } from './services/seeds.js';
import { config } from './config.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use(stripSensitiveHeaders());

// Ensure storage directories exist (from config.json)
const UPLOADS_DIR = config.dirs.uploads;
const TRANSCRIPTS_DIR = config.dirs.transcripts;
const MEMORIES_DIR = config.dirs.memories;
const TIMELINES_DIR = config.dirs.timelines;
const PROFILES_DIR = config.dirs.profiles;
[UPLOADS_DIR, TRANSCRIPTS_DIR, MEMORIES_DIR, TIMELINES_DIR, PROFILES_DIR].forEach((p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Simple health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Static files for generated assets
app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)));
// Static Playground
app.use('/playground', express.static(path.resolve('public')));

// Feature routers
app.use('/api/characters', characterRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/convo', convoRouter);
app.use('/api/stories', storiesRouter);
app.use('/api/exports', exportRouter);
app.use('/api/characters/:id/docs', docsRouter);
app.use('/api/characters/:id/prompt', promptsRouter);
app.use('/api/rag', ragRouter);
app.use('/api/providers', providersRouter);
app.use('/api/debug', debugRouter);

// Asset upload (avatars)
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });
app.post('/api/assets/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const mime = req.file.mimetype;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
    return res.status(415).json({ error: 'Unsupported type' });
  }
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const hash = Buffer.from(req.file.originalname + Date.now()).toString('base64url').slice(0, 16);
  const filename = `${hash}.${ext}`;
  const dest = path.join(UPLOADS_DIR, 'avatars');
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, filename), req.file.buffer);
  res.json({ uri: `/uploads/avatars/${filename}` });
});

const port = Number(config.port || 4000);
// Import seeds on boot (if any)
try { importSeeds(); } catch {}
try { importFromDocs(); } catch {}
try { if (config.flags.autoImportProfiles) importFromProfiles(); } catch {}
app.listen(port, () => {
  console.log('Server listening on', port);
});
