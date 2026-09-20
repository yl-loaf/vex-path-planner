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

// Dynamically serve firebase-config.js using applet config or environment
app.get('/firebase-config.js', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Content-Type': 'application/javascript; charset=utf-8'
  });

  const appletConfigPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(appletConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(appletConfigPath, 'utf8'));
      return res.send(`window.FIREBASE_CONFIG = ${JSON.stringify(cfg)};\nwindow.FIREBASE_ENABLED = true;\n`);
    } catch (e) {
      console.error('Error reading firebase-applet-config.json:', e);
    }
  }

  const apiKey = process.env.FIREBASE_API_KEY || '';
  const defaultCfg = {
    apiKey: apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'vex-path-planner.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'vex-path-planner',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'vex-path-planner.firebasestorage.app',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '279801221836',
    appId: process.env.FIREBASE_APP_ID || '1:279801221836:web:465abca3acc11df3ada869',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || 'G-XGTSE1D700',
  };
  const isEnabled = Boolean(apiKey && apiKey !== 'YOUR_API_KEY');
  res.send(`window.FIREBASE_CONFIG = ${JSON.stringify(defaultCfg)};\nwindow.FIREBASE_ENABLED = ${isEnabled};\n`);
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
