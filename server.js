import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable CORS for all routes (important for web view/iframe environments)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

function saveUserProject(uid, email, project = null, pathPayload = null) {
  try {
    const filePaths = getProjectFilePaths(uid, email);
    if (!filePaths.length) return false;
    const existing = getUserProject(uid, email) || {};
    const finalProject = project || existing.project || null;
    const finalPathPayload = pathPayload !== null ? pathPayload : (existing.pathPayload || null);
    const payload = {
      uid: uid || existing.uid || '',
      email: email || existing.email || '',
      updatedAt: (finalProject && finalProject.updatedAt) || Date.now(),
      savedAt: Date.now(),
      project: finalProject,
      pathPayload: finalPathPayload
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
const handleSaveProject = (req, res) => {
  const { uid, email, project, pathPayload } = req.body || {};
  if (!uid && !email) {
    return res.status(400).json({ error: 'Missing user identification (uid or email required)' });
  }
  if (!project && !pathPayload) {
    return res.status(400).json({ error: 'Missing payload data (project or pathPayload required)' });
  }

  const success = saveUserProject(uid, email, project, pathPayload);
  if (!success) {
    return res.status(500).json({ error: 'Failed to persist project on server' });
  }

  const fileCount = project && project.files && typeof project.files === 'object' ? Object.keys(project.files).length : 0;
  console.log(`[CloudProjectServer] Saved project payload for user ${email || uid} (files: ${fileCount}, path: ${Boolean(pathPayload)})`);
  res.json({
    success: true,
    savedAt: Date.now(),
    updatedAt: (project && project.updatedAt) || Date.now(),
    name: project?.name || 'Project',
    fileCount: fileCount
  });
};

app.post('/api/project', handleSaveProject);
app.put('/api/project', handleSaveProject);

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

// Single-Instance Account Session Coordination
const activeSessions = new Map();
const SESSION_EXPIRY_MS = 25000; // 25s without heartbeat considered stale

function getUserSessionKey(uid, email) {
  if (uid && String(uid).trim()) return 'uid_' + String(uid).trim();
  if (email && String(email).trim()) return 'email_' + String(email).trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  return null;
}

// Clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, sess] of activeSessions.entries()) {
    if (now - sess.lastHeartbeat > SESSION_EXPIRY_MS) {
      activeSessions.delete(key);
    }
  }
}, 10000);

app.post('/api/session/register', (req, res) => {
  const { uid, email, sessionId, page, userAgent, forceTakeover } = req.body || {};
  const userKey = getUserSessionKey(uid, email);
  if (!userKey || !sessionId) {
    return res.status(400).json({ error: 'Missing user identification or sessionId' });
  }

  const now = Date.now();
  const existing = activeSessions.get(userKey);

  // Check if an existing distinct session is currently active
  if (existing && existing.sessionId !== sessionId && (now - existing.lastHeartbeat <= SESSION_EXPIRY_MS)) {
    if (!forceTakeover) {
      return res.json({
        success: false,
        conflict: true,
        activeSession: {
          sessionId: existing.sessionId,
          page: existing.page,
          userAgent: existing.userAgent,
          openedAt: existing.openedAt,
          lastHeartbeat: existing.lastHeartbeat
        }
      });
    }
  }

  // Register or Takeover as active session
  const newSession = {
    sessionId,
    uid: uid || '',
    email: email || '',
    page: page || 'App',
    userAgent: userAgent || 'Browser',
    openedAt: existing && existing.sessionId === sessionId ? existing.openedAt : now,
    lastHeartbeat: now
  };
  activeSessions.set(userKey, newSession);
  console.log(`[SessionServer] Registered active session for ${email || uid} (sess: ${sessionId.slice(0, 10)}..., page: ${newSession.page}, takeover: ${Boolean(forceTakeover)})`);

  res.json({
    success: true,
    conflict: false,
    tookOver: Boolean(forceTakeover)
  });
});

app.post('/api/session/heartbeat', (req, res) => {
  const { uid, email, sessionId, page } = req.body || {};
  const userKey = getUserSessionKey(uid, email);
  if (!userKey || !sessionId) {
    return res.status(400).json({ error: 'Missing user identification or sessionId' });
  }

  const now = Date.now();
  const existing = activeSessions.get(userKey);

  if (!existing) {
    // Re-register if still the only instance
    const newSession = {
      sessionId,
      uid: uid || '',
      email: email || '',
      page: page || 'App',
      openedAt: now,
      lastHeartbeat: now
    };
    activeSessions.set(userKey, newSession);
    return res.json({ valid: true });
  }

  if (existing.sessionId !== sessionId) {
    // Another instance took over or registered
    return res.json({
      valid: false,
      reason: 'taken_over',
      activeSession: {
        sessionId: existing.sessionId,
        page: existing.page,
        openedAt: existing.openedAt,
        lastHeartbeat: existing.lastHeartbeat
      }
    });
  }

  // Update heartbeat
  existing.lastHeartbeat = now;
  if (page) existing.page = page;
  res.json({ valid: true });
});

app.post('/api/session/release', (req, res) => {
  const { uid, email, sessionId } = req.body || {};
  const userKey = getUserSessionKey(uid, email);
  if (userKey && sessionId) {
    const existing = activeSessions.get(userKey);
    if (existing && existing.sessionId === sessionId) {
      activeSessions.delete(userKey);
      console.log(`[SessionServer] Released session for ${email || uid} (${sessionId.slice(0, 10)}...)`);
    }
  }
  res.json({ success: true });
});

// Git Integration API - Direct Commit & Push without repository cloning
app.post('/api/github/push', async (req, res) => {
  const { token, repo, branch, files, commitMessage } = req.body;
  if (!token || !repo || !files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Missing token, repo, or files payload' });
  }

  const targetBranch = branch || 'main';
  const msg = commitMessage || 'Sync from VEX Path Planner Workspace 🚀';

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    return res.status(400).json({ error: 'Invalid repo name format. Must be "owner/repo"' });
  }

  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'VEX-Path-Planner-Cloud-Sync'
  };

  try {
    // Step 1: Get reference to the target branch head
    const refUrl = `https://api.github.com/repos/${owner}/${repoName}/git/ref/heads/${targetBranch}`;
    const refRes = await fetch(refUrl, { headers });
    if (!refRes.ok) {
      const errTxt = await refRes.text();
      return res.status(refRes.status).json({ error: `Failed to fetch branch ref: ${errTxt}` });
    }
    const refData = await refRes.json();
    const lastCommitSha = refData.object.sha;

    // Get the commit details to retrieve its base tree SHA
    const commitUrl = `https://api.github.com/repos/${owner}/${repoName}/git/commits/${lastCommitSha}`;
    const commitRes = await fetch(commitUrl, { headers });
    if (!commitRes.ok) {
      const errTxt = await commitRes.text();
      return res.status(commitRes.status).json({ error: `Failed to fetch commit details: ${errTxt}` });
    }
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // Step 2: Create a tree with the modified/new files
    const treeItems = Object.entries(files).map(([pathStr, contentStr]) => ({
      path: pathStr,
      mode: '100644',
      type: 'blob',
      content: contentStr
    }));

    const createTreeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees`;
    const treeRes = await fetch(createTreeUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems
      })
    });
    if (!treeRes.ok) {
      const errTxt = await treeRes.text();
      return res.status(treeRes.status).json({ error: `Failed to create Git tree: ${errTxt}` });
    }
    const treeData = await treeRes.json();
    const newTreeSha = treeData.sha;

    // Step 3: Create the Git commit referencing the new tree and parent commit
    const createCommitUrl = `https://api.github.com/repos/${owner}/${repoName}/git/commits`;
    const createCommitRes = await fetch(createCommitUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        tree: newTreeSha,
        parents: [lastCommitSha]
      })
    });
    if (!createCommitRes.ok) {
      const errTxt = await createCommitRes.text();
      return res.status(createCommitRes.status).json({ error: `Failed to create commit: ${errTxt}` });
    }
    const newCommitData = await createCommitRes.json();
    const newCommitSha = newCommitData.sha;

    // Step 4: Update the branch reference to point to the new commit
    const updateRefUrl = `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${targetBranch}`;
    const updateRefRes = await fetch(updateRefUrl, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sha: newCommitSha,
        force: true
      })
    });
    if (!updateRefRes.ok) {
      const errTxt = await updateRefRes.text();
      return res.status(updateRefRes.status).json({ error: `Failed to update ref: ${errTxt}` });
    }

    res.json({ success: true, commitSha: newCommitSha, branch: targetBranch });
  } catch (err) {
    console.error('[GitHub Sync Error]:', err);
    res.status(500).json({ error: err.message || 'Internal server error during GitHub sync' });
  }
});

app.get('/api/session/status', (req, res) => {
  const { uid, email, sessionId } = req.query;
  const userKey = getUserSessionKey(uid, email);
  if (!userKey) {
    return res.status(400).json({ error: 'Missing user identification' });
  }
  const now = Date.now();
  const existing = activeSessions.get(userKey);
  const isAlive = existing && (now - existing.lastHeartbeat <= SESSION_EXPIRY_MS);
  res.json({
    active: isAlive && existing.sessionId === sessionId,
    conflict: isAlive && existing.sessionId !== sessionId,
    activeSession: isAlive ? existing : null
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

