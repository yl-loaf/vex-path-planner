import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Explicitly serve version.js with no-cache headers so update checks are instant
app.get('/version.js', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Content-Type': 'application/javascript; charset=utf-8'
  });
  res.sendFile(path.join(__dirname, 'version.js'));
});

// Serve static assets from root
app.use(express.static(__dirname));

// Route to serve IDE directly
app.get('/ide', (req, res) => {
  res.sendFile(path.join(__dirname, 'ide.html'));
});

app.get('/translator', (req, res) => {
  res.sendFile(path.join(__dirname, 'translator.html'));
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

