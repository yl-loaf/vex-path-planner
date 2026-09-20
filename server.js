import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Dynamic config endpoint for firebase-config.js if environment variable provided
app.get('/firebase-config.js', (req, res) => {
  const apiKey = process.env.FIREBASE_API_KEY || '';
  const enabled = Boolean(apiKey);
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
window.FIREBASE_CONFIG = {
  apiKey: ${JSON.stringify(apiKey)},
  authDomain: "vex-path-planner.firebaseapp.com",
  projectId: "vex-path-planner",
  storageBucket: "vex-path-planner.firebasestorage.app",
  messagingSenderId: "279801221836",
  appId: "1:279801221836:web:465abca3acc11df3ada869",
  measurementId: "G-XGTSE1D700"
};
window.FIREBASE_ENABLED = ${enabled};
`);
});

// Serve static assets from root
app.use(express.static(__dirname));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
