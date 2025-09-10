import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { listDocs, pathForDoc, docsDirFor } from '../services/docs.js';

export const router = Router({ mergeParams: true });

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });

// List
router.get('/', (req, res) => {
  const { id } = req.params as any;
  res.json(listDocs(id));
});

// Upload (multipart/form-data, field: file)
router.post('/', upload.single('file'), (req, res) => {
  const { id } = req.params as any;
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const destDir = docsDirFor(id);
  const filename = req.file.originalname.replace(/[^A-Za-z0-9_\-. ]/g, '_');
  const dest = path.join(destDir, filename);
  fs.writeFileSync(dest, req.file.buffer);
  res.json({ ok: true, name: filename });
});

// Download
router.get('/:filename', (req, res) => {
  const { id, filename } = req.params as any;
  const p = pathForDoc(id, filename);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.sendFile(path.resolve(p));
});

// Delete
router.delete('/:filename', (req, res) => {
  const { id, filename } = req.params as any;
  const p = pathForDoc(id, filename);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

