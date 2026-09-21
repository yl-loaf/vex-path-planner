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

// Visitor Statistics Tracking Store
const statsFilePath = path.join(__dirname, 'data', 'stats.json');
function getStats() {
  try {
    if (fs.existsSync(statsFilePath)) {
      return JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading stats:', e);
  }
  return {
    totalViews: 0,
    uniqueVisitors: 0,
    pages: { home: 0, ide: 0, translator: 0, stats: 0, other: 0 },
    visitors: [],
    ips: []
  };
}

function saveStats(stats) {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving stats:', e);
  }
}

function maskIp(ip) {
  if (!ip) return '***.***.***';
  const cleanIp = ip.replace(/^::ffff:/, '');
  const parts = cleanIp.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.***.***`;
  }
  if (cleanIp.includes(':')) {
    const segs = cleanIp.split(':');
    return segs.slice(0, 2).join(':') + ':****:****';
  }
  return '***.***.***';
}

// Middleware to track page visits
app.use((req, res, next) => {
  const pathUrl = req.path;
  // Track page views and HTML document requests
  if (
    pathUrl.endsWith('.html') ||
    pathUrl === '/' ||
    pathUrl === '/ide' ||
    pathUrl === '/translator' ||
    pathUrl === '/stats' ||
    pathUrl === '/api/track'
  ) {
    const stats = getStats();
    stats.totalViews = (stats.totalViews || 0) + 1;

    let pageKey = 'other';
    if (pathUrl === '/' || pathUrl === '/index.html') pageKey = 'home';
    else if (pathUrl.includes('ide')) pageKey = 'ide';
    else if (pathUrl.includes('translator')) pageKey = 'translator';
    else if (pathUrl.includes('stats')) pageKey = 'stats';

    stats.pages[pageKey] = (stats.pages[pageKey] || 0) + 1;

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    if (!stats.ips) stats.ips = [];
    if (!stats.ips.includes(clientIp)) {
      stats.ips.push(clientIp);
      stats.uniqueVisitors = stats.ips.length;
    }

    if (!stats.visitors) stats.visitors = [];
    stats.visitors.unshift({
      ip: clientIp,
      page: pageKey,
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent'] || 'Unknown'
    });
    if (stats.visitors.length > 50) stats.visitors.pop();

    saveStats(stats);
  }
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/stats', (req, res) => {
  const stats = getStats();
  const maskedVisitors = (stats.visitors || []).slice(0, 30).map(v => ({
    ...v,
    ip: maskIp(v.ip)
  }));
  res.json({
    totalViews: stats.totalViews || 0,
    uniqueVisitors: stats.uniqueVisitors || 0,
    pages: stats.pages || {},
    visitors: maskedVisitors
  });
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

app.get('/stats', (req, res) => {
  res.sendFile(path.join(__dirname, 'stats.html'));
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

