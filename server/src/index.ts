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

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use(stripSensitiveHeaders());

// Ensure storage directories exist
const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';
const TRANSCRIPTS_DIR = process.env.TRANSCRIPTS_DIR || 'transcripts';
const MEMORIES_DIR = process.env.MEMORIES_DIR || 'memories';
const TIMELINES_DIR = process.env.TIMELINES_DIR || 'timelines';
[UPLOADS_DIR, TRANSCRIPTS_DIR, MEMORIES_DIR, TIMELINES_DIR].forEach((p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Simple health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Static files for generated assets
app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)));

// Feature routers
app.use('/api/characters', characterRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/convo', convoRouter);
app.use('/api/exports', exportRouter);

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

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log('Server listening on', port);
});
