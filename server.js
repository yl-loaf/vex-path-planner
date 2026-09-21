import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Cloud Project Storage Store for cross-device sync
const projectsDir = path.join(__dirname, 'data', 'projects');
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}

function getProjectFilePaths(uid, email) {
  const paths = [];
  if (email && typeof email === 'string') {
    const cleanEmail = email.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
    if (cleanEmail) paths.push(path.join(projectsDir, `email_${cleanEmail}.json`));
  }
  if (uid && typeof uid === 'string') {
    const cleanUid = uid.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (cleanUid) paths.push(path.join(projectsDir, `uid_${cleanUid}.json`));
  }
  return paths;
}

function saveUserProject(uid, email, project, pathPayload = null) {
  try {
    const filePaths = getProjectFilePaths(uid, email);
    if (!filePaths.length) return false;
    const payload = {
      uid: uid || '',
      email: email || '',
      updatedAt: (project && project.updatedAt) || Date.now(),
      savedAt: Date.now(),
      project: project,
      pathPayload: pathPayload
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    for (const fp of filePaths) {
      fs.writeFileSync(fp, jsonStr, 'utf8');
    }
    return true;
  } catch (err) {
    console.error('Error saving user project on server:', err);
    return false;
  }
}

function getUserProject(uid, email) {
  try {
    const filePaths = getProjectFilePaths(uid, email);
    for (const fp of filePaths) {
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf8');
        return JSON.parse(raw);
      }
    }
  } catch (err) {
    console.error('Error reading user project from server:', err);
  }
  return null;
}

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

// Cloud Project Synchronization Endpoints (Cross-Device Cloud Sync)
app.post('/api/project', (req, res) => {
  const { uid, email, project, pathPayload } = req.body || {};
  if (!uid && !email) {
    return res.status(400).json({ error: 'Missing user identification (uid or email required)' });
  }
  if (!project || typeof project !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid project payload' });
  }

  const success = saveUserProject(uid, email, project, pathPayload);
  if (!success) {
    return res.status(500).json({ error: 'Failed to persist project on server' });
  }

  const fileCount = project.files && typeof project.files === 'object' ? Object.keys(project.files).length : 0;
  console.log(`[CloudProjectServer] Saved project "${project.name}" (${fileCount} files) for user ${email || uid}`);
  res.json({
    success: true,
    savedAt: Date.now(),
    updatedAt: project.updatedAt || Date.now(),
    name: project.name,
    fileCount: fileCount
  });
});

app.get('/api/project', (req, res) => {
  const { uid, email } = req.query;
  if (!uid && !email) {
    return res.status(400).json({ error: 'Missing user identification (uid or email required)' });
  }

  const data = getUserProject(uid, email);
  if (!data || !data.project) {
    return res.json({ exists: false });
  }

  res.json({
    exists: true,
    savedAt: data.savedAt,
    updatedAt: data.updatedAt,
    email: data.email,
    uid: data.uid,
    project: data.project,
    pathPayload: data.pathPayload || null
  });
});

app.get('/api/project/status', (req, res) => {
  const { uid, email } = req.query;
  if (!uid && !email) {
    return res.status(400).json({ error: 'Missing user identification (uid or email required)' });
  }

  const data = getUserProject(uid, email);
  if (!data || !data.project) {
    return res.json({ exists: false });
  }

  const files = data.project.files || {};
  res.json({
    exists: true,
    savedAt: data.savedAt,
    updatedAt: data.updatedAt || data.project.updatedAt,
    name: data.project.name,
    fileCount: Object.keys(files).length
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

