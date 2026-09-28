import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable CORS for all routes (important for web view/iframe environments)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
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
    pages: { home: 0, ide: 0, translator: 0, stats: 0, tools: 0, team: 0, other: 0 },
    visitors: [],
    ips: []
  };
}

// ============================================================================
// REAL-TIME TEAM COLLABORATION & CLOUD SYNC STORAGE ENGINE (BETA)
// Enforces 1 Gmail Account = 1 Team Rule; Stores up to 500 Version Histories
// ============================================================================
const teamsDir = path.join(__dirname, 'data', 'teams');
if (!fs.existsSync(teamsDir)) {
  fs.mkdirSync(teamsDir, { recursive: true });
}
const userTeamsIndexFile = path.join(teamsDir, 'user_teams.json');

function cleanEmailKey(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
}

function getUserTeamsIndex() {
  try {
    if (fs.existsSync(userTeamsIndexFile)) {
      return JSON.parse(fs.readFileSync(userTeamsIndexFile, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading user_teams index:', e);
  }
  return {};
}

function saveUserTeamsIndex(index) {
  try {
    fs.writeFileSync(userTeamsIndexFile, JSON.stringify(index, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving user_teams index:', e);
  }
}

function getTeamFilePath(teamId) {
  const cleanId = String(teamId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = cleanId.startsWith('team_') ? `${cleanId}.json` : `team_${cleanId}.json`;
  return path.join(teamsDir, fileName);
}

function getTeam(teamId) {
  try {
    const fp = getTeamFilePath(teamId);
    if (fs.existsSync(fp)) {
      const team = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (team && !team.joinSecret) {
        team.joinSecret = crypto.randomBytes(16).toString('hex');
        saveTeam(team);
      }
      return team;
    }
  } catch (e) {
    console.error(`Error reading team ${teamId}:`, e);
  }
  return null;
}

function saveTeam(team) {
  try {
    if (!team || !team.teamId) return false;
    const fp = getTeamFilePath(team.teamId);
    fs.writeFileSync(fp, JSON.stringify(team, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving team:', e);
    return false;
  }
}

// ----------------------------------------------------------------------------
// 5-Minute Constantly Changing Join OTP Engine
// ----------------------------------------------------------------------------
function getTeamJoinOtp(team, timestamp = Date.now()) {
  if (!team) return '000000';
  const secret = team.joinSecret || (String(team.teamId) + '_' + String(team.teamCode || 'VEX') + '_otp_secret');
  // 5-minute rolling time window (300,000 ms)
  const windowIndex = Math.floor(timestamp / (5 * 60 * 1000));
  const hmac = crypto.createHmac('sha256', secret).update(String(windowIndex)).digest('hex');
  // Generate a distinct 6-digit numeric OTP (100000 - 999999)
  const num = (parseInt(hmac.substring(0, 8), 16) % 900000) + 100000;
  return String(num);
}

function verifyTeamJoinOtp(team, otpCandidate) {
  if (!team || !otpCandidate) return false;
  const clean = String(otpCandidate).replace(/\s+/g, '').trim();
  const now = Date.now();
  // Check current window and previous window (grace period for rollover)
  const currentOtp = getTeamJoinOtp(team, now);
  const prevOtp = getTeamJoinOtp(team, now - 5 * 60 * 1000);
  return clean === currentOtp || clean === prevOtp;
}

function getTeamOtpInfo(team) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const currentOtp = getTeamJoinOtp(team, now);
  const remainingMs = windowMs - (now % windowMs);
  const remainingSeconds = Math.max(1, Math.floor(remainingMs / 1000));
  return {
    otp: currentOtp,
    remainingSeconds,
    expiresAt: now + remainingMs,
    intervalSeconds: 300
  };
}

function findTeamByOtp(otpCandidate) {
  if (!otpCandidate) return null;
  const clean = String(otpCandidate).replace(/\s+/g, '').trim();
  try {
    const files = fs.readdirSync(teamsDir);
    for (const f of files) {
      if (f.startsWith('team_') && f.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(path.join(teamsDir, f), 'utf8');
          const data = JSON.parse(raw);
          if (data && verifyTeamJoinOtp(data, clean)) {
            return data;
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error('Error scanning teams by OTP:', e);
  }
  return null;
}

function findTeamByCode(code) {
  if (!code) return null;
  const cleanCode = String(code).trim().toUpperCase();
  try {
    const files = fs.readdirSync(teamsDir);
    for (const f of files) {
      if (f.startsWith('team_') && f.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(path.join(teamsDir, f), 'utf8');
          const data = JSON.parse(raw);
          if (data && String(data.teamCode || '').toUpperCase() === cleanCode) {
            return data;
          }
          if (data && String(data.teamId || '').toLowerCase() === cleanCode.toLowerCase()) {
            return data;
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error('Error scanning teams by code:', e);
  }
  return null;
}

// In-Memory Real-Time Rooms for Live Cursor & SSE Synchronization
const teamRooms = new Map(); // teamId -> Set of res objects
const teamPresences = new Map(); // teamId -> Map of email -> presence object

const ROLE_COLORS = {
  Programmer: '#38bdf8', // Cyan
  Driver: '#10b981',     // Emerald Green
  Coach: '#f59e0b',      // Amber
  Strategist: '#a855f7', // Purple
  Builder: '#ec4899',    // Pink
  Scout: '#6366f1'       // Indigo
};

function getRoleColor(role) {
  return ROLE_COLORS[role] || '#38bdf8';
}

function broadcastToTeam(teamId, eventName, payload, excludeEmail = null) {
  const room = teamRooms.get(teamId);
  if (!room || room.size === 0) return;
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of room) {
    if (excludeEmail && client.userEmail === excludeEmail) continue;
    try {
      client.write(msg);
    } catch (_) {
      room.delete(client);
    }
  }
}

// Clean stale presences every 10 seconds
setInterval(() => {
  const now = Date.now();
  for (const [teamId, pMap] of teamPresences.entries()) {
    let changed = false;
    for (const [email, presence] of pMap.entries()) {
      if (now - presence.lastSeen > 20000) {
        pMap.delete(email);
        changed = true;
      }
    }
    if (changed) {
      broadcastToTeam(teamId, 'presence', {
        activeMembers: Array.from(pMap.values())
      });
    }
  }
}, 10000);

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
    pathUrl === '/tools' ||
    pathUrl === '/api/track'
  ) {
    const stats = getStats();
    stats.totalViews = (stats.totalViews || 0) + 1;

    let pageKey = 'other';
    if (pathUrl === '/' || pathUrl === '/index.html') pageKey = 'home';
    else if (pathUrl.includes('ide')) pageKey = 'ide';
    else if (pathUrl.includes('translator')) pageKey = 'translator';
    else if (pathUrl.includes('stats')) pageKey = 'stats';
    else if (pathUrl.includes('tools')) pageKey = 'tools';
    else if (pathUrl.includes('team')) pageKey = 'team';

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

// ============================================================================
// TEAM COLLABORATION REST & SSE ENDPOINTS
// - 1 Gmail account belongs to exactly 1 team
// - Multiple members per team with roles (Programmer, Driver, Coach, Strategist)
// - Real-time sync, live presence & cursors
// - Collaborative pin comments & strategy consensus voting
// - Up to 500 version history snapshots with author attribution
// ============================================================================

// 1. Get current user's team
app.get(['/api/team/my-team', '/vex-path-planner/api/team/my-team'], (req, res) => {
  const { email } = req.query;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Missing email parameter' });
  }

  const clean = cleanEmailKey(email);
  const userTeams = getUserTeamsIndex();
  const teamId = userTeams[clean];

  if (!teamId) {
    return res.json({ hasTeam: false });
  }

  const team = getTeam(teamId);
  if (!team) {
    // Stale index reference cleanup
    delete userTeams[clean];
    saveUserTeamsIndex(userTeams);
    return res.json({ hasTeam: false });
  }

  const pMap = teamPresences.get(team.teamId) || new Map();
  team.otpInfo = getTeamOtpInfo(team);
  res.json({
    hasTeam: true,
    teamId: team.teamId,
    team,
    activeMembers: Array.from(pMap.values())
  });
});

// 2. Create a new team (Enforces 1 Gmail = 1 Team rule)
app.post(['/api/team/create', '/vex-path-planner/api/team/create'], (req, res) => {
  const { email, displayName, teamName, vexTeamNumber, role, photoURL, projectData, pathsData } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid Gmail address is required to create a team' });
  }

  const clean = cleanEmailKey(email);
  const userTeams = getUserTeamsIndex();

  if (userTeams[clean]) {
    const existingTeam = getTeam(userTeams[clean]);
    if (existingTeam) {
      return res.status(400).json({
        error: `This Google account (${email}) already belongs to team "${existingTeam.teamName}". Each Gmail account can belong to only 1 team at a time. Please leave your current team first.`,
        currentTeamId: existingTeam.teamId,
        currentTeamName: existingTeam.teamName
      });
    }
  }

  const teamId = 'team_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  // Generate friendly 6-char team code (e.g. VEX-742)
  const teamCode = 'VEX-' + Math.floor(100 + Math.random() * 900);
  const now = Date.now();
  const userRole = role || 'Programmer';
  const userDisp = (displayName && String(displayName).trim()) || email.split('@')[0];

  const initialMember = {
    email: email.trim().toLowerCase(),
    displayName: userDisp,
    role: userRole,
    color: getRoleColor(userRole),
    joinedAt: now,
    photoURL: photoURL || '',
    isOwner: true
  };

  const initialSnapshot = {
    id: 'v_' + now + '_init',
    timestamp: now,
    dateStr: new Date(now).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    authorEmail: email.trim().toLowerCase(),
    authorName: userDisp,
    authorRole: userRole,
    authorColor: getRoleColor(userRole),
    actionSummary: 'Team initialized & autonomous workspace created',
    editType: 'team_init',
    snapshot: pathsData || null
  };

  const newTeam = {
    teamId,
    teamCode,
    joinSecret: crypto.randomBytes(16).toString('hex'),
    teamName: (teamName && String(teamName).trim()) || 'VEX High Stakes Team',
    vexTeamNumber: (vexTeamNumber && String(vexTeamNumber).trim().toUpperCase()) || '99999X',
    ownerEmail: email.trim().toLowerCase(),
    createdAt: now,
    updatedAt: now,
    members: [initialMember],
    pathPayload: pathsData || {
      paths: [
        {
          id: 'p_default',
          name: 'Red Left Mogo Rush',
          pose: { x: -60, y: -60, theta: 0 },
          actions: [
            { id: 'a_1', type: 'moveToPoint', x: -24, y: -24, timeout: 2000, maxSpeed: 115, earlyExitRange: 2, comment: 'Rush alliance goal' },
            { id: 'a_2', type: 'moveToPose', x: 0, y: 48, theta: 90, timeout: 2500, lead: 0.6, comment: 'Score preload in corner' }
          ]
        }
      ]
    },
    project: projectData || null,
    versionHistory: [initialSnapshot],
    comments: [
      {
        id: 'cmt_welcome',
        x: -24,
        y: -24,
        text: '📍 Strategy Tip: Clamp preload here before 12s mark. Drop pin comments anywhere on field to discuss routines!',
        authorEmail: email.trim().toLowerCase(),
        authorName: userDisp,
        authorRole: userRole,
        authorColor: getRoleColor(userRole),
        timestamp: now,
        resolved: false,
        replies: []
      }
    ],
    strategies: [
      {
        id: 'strat_plan_a',
        title: 'Plan A: Center Mobile Goal Rush',
        description: 'Primary match routine: Rush center goal, clamp alliance mogo, sweep 3 side rings, park before 14.5s.',
        targetRoutine: 'Red Left Mogo Rush',
        authorEmail: email.trim().toLowerCase(),
        authorName: userDisp,
        createdAt: now,
        status: 'active',
        votes: {
          [email.trim().toLowerCase()]: 'rocket'
        }
      }
    ]
  };

  saveTeam(newTeam);
  userTeams[clean] = teamId;
  saveUserTeamsIndex(userTeams);

  console.log(`[TeamCollab] Created team "${newTeam.teamName}" (${newTeam.teamCode}) for ${email}`);
  newTeam.otpInfo = getTeamOtpInfo(newTeam);
  res.json({ success: true, team: newTeam });
});

// 2.5 Get current live 5-minute rolling OTP for team authorization
app.get(['/api/team/otp', '/vex-path-planner/api/team/otp'], (req, res) => {
  const { teamId, email } = req.query || {};
  if (!teamId) {
    return res.status(400).json({ error: 'Missing teamId parameter' });
  }
  const team = getTeam(teamId);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }
  if (email) {
    const clean = cleanEmailKey(email);
    const isMember = (team.members || []).some(m => cleanEmailKey(m.email) === clean);
    if (!isMember) {
      return res.status(403).json({ error: 'Only authorized team members can view the live join OTP' });
    }
  }
  res.json({
    success: true,
    teamId: team.teamId,
    teamCode: team.teamCode,
    ...getTeamOtpInfo(team)
  });
});

// 2.7 Get available teams looking for teammates (supports testing & open collaboration)
app.get(['/api/team/available', '/vex-path-planner/api/team/available'], (req, res) => {
  try {
    const files = fs.readdirSync(teamsDir);
    const teams = [];
    for (const f of files) {
      if (f.startsWith('team_') && f.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(path.join(teamsDir, f), 'utf8');
          const data = JSON.parse(raw);
          if (data && data.teamId && data.teamCode) {
            const otpInfo = getTeamOtpInfo(data);
            teams.push({
              teamId: data.teamId,
              teamName: data.teamName || 'VEX Team Workspace',
              vexTeamNumber: data.vexTeamNumber || 'VEX',
              teamCode: data.teamCode,
              memberCount: (data.members || []).length,
              ownerEmail: data.ownerEmail ? data.ownerEmail.replace(/(?<=.{3}).(?=.*@)/g, '*') : '',
              createdAt: data.createdAt,
              otpInfo
            });
          }
        } catch (_) {}
      }
    }
    // Sort recently created/active first
    teams.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ success: true, teams });
  } catch (err) {
    console.error('Error fetching available teams:', err);
    res.status(500).json({ error: 'Failed to load available teams' });
  }
});

// 3. Join an existing team by Team Code & 5-minute OTP (Enforces 1 Gmail = 1 Team rule)
app.post(['/api/team/join', '/vex-path-planner/api/team/join'], (req, res) => {
  const { email, displayName, teamCode, otp, role, photoURL } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid Gmail address is required to join a team' });
  }
  if (!teamCode || !String(teamCode).trim()) {
    return res.status(400).json({ error: 'Team Code is required (e.g. VEX-742)' });
  }

  const clean = cleanEmailKey(email);
  const userTeams = getUserTeamsIndex();

  let team = findTeamByCode(teamCode);
  if (!team && otp) {
    team = findTeamByCode(otp);
  }
  if (!team) {
    team = findTeamByOtp(otp || teamCode);
  }
  if (!team) {
    return res.status(404).json({ error: `Team with code "${teamCode}" not found. Please verify the 6-character code with your teammate.` });
  }

  // Enforce 5-Minute Constantly Changing OTP requirement
  const rawOtp = String(otp || (teamCode && /^\d{6}$/.test(String(teamCode).trim()) ? teamCode : '')).trim();
  if (!rawOtp) {
    return res.status(400).json({
      error: `Security Authorization Required: You must enter the live 5-minute Join OTP code. Ask an active teammate on team "${team.teamName}" for the code displayed on their workspace.`
    });
  }

  if (!verifyTeamJoinOtp(team, rawOtp)) {
    return res.status(403).json({
      error: `Invalid or expired Join OTP for team "${team.teamName}". Join codes rotate every 5 minutes for security. Please request the current live OTP from an active teammate.`
    });
  }

  // Check if user is already registered in a different team
  if (userTeams[clean] && userTeams[clean] !== team.teamId) {
    const existingTeam = getTeam(userTeams[clean]);
    return res.status(400).json({
      error: `This Google account (${email}) already belongs to team "${existingTeam?.teamName || userTeams[clean]}". A Google account can only belong to 1 team at a time. Please leave your current team before joining a new one.`,
      currentTeamId: userTeams[clean]
    });
  }

  const userRole = role || 'Driver';
  const userDisp = (displayName && String(displayName).trim()) || email.split('@')[0];
  const userEmailNorm = email.trim().toLowerCase();
  const now = Date.now();

  // Check if member already in roster
  let member = team.members.find(m => m.email.toLowerCase() === userEmailNorm);
  if (!member) {
    member = {
      email: userEmailNorm,
      displayName: userDisp,
      role: userRole,
      color: getRoleColor(userRole),
      joinedAt: now,
      photoURL: photoURL || '',
      isOwner: false
    };
    team.members.push(member);

    // Record join in version history with author attribution (stores up to 500)
    team.versionHistory.unshift({
      id: 'v_' + now + '_join',
      timestamp: now,
      dateStr: new Date(now).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      authorEmail: userEmailNorm,
      authorName: userDisp,
      authorRole: userRole,
      authorColor: getRoleColor(userRole),
      actionSummary: `${userDisp} joined the team as ${userRole}`,
      editType: 'member_join',
      snapshot: null
    });
    if (team.versionHistory.length > 500) {
      team.versionHistory.length = 500;
    }

    team.updatedAt = now;
    saveTeam(team);
    broadcastToTeam(team.teamId, 'member_joined', { member, team });
  }

  userTeams[clean] = team.teamId;
  saveUserTeamsIndex(userTeams);

  console.log(`[TeamCollab] User ${email} joined team "${team.teamName}" (${team.teamCode}) as ${userRole}`);
  team.otpInfo = getTeamOtpInfo(team);
  res.json({ success: true, team });
});

// 4. Leave team
app.post(['/api/team/leave', '/vex-path-planner/api/team/leave'], (req, res) => {
  const { email, teamId } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  const clean = cleanEmailKey(email);
  const userTeams = getUserTeamsIndex();
  const targetTeamId = teamId || userTeams[clean];
  if (!targetTeamId) {
    return res.json({ success: true, message: 'User was not in any team' });
  }

  delete userTeams[clean];
  saveUserTeamsIndex(userTeams);

  const team = getTeam(targetTeamId);
  if (team) {
    const userEmailNorm = email.trim().toLowerCase();
    const removedMember = team.members.find(m => m.email.toLowerCase() === userEmailNorm);
    team.members = team.members.filter(m => m.email.toLowerCase() !== userEmailNorm);

    if (team.members.length > 0) {
      if (removedMember && removedMember.isOwner) {
        team.members[0].isOwner = true;
        team.ownerEmail = team.members[0].email;
      }
      const now = Date.now();
      team.versionHistory.unshift({
        id: 'v_' + now + '_leave',
        timestamp: now,
        dateStr: new Date(now).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        authorEmail: userEmailNorm,
        authorName: removedMember?.displayName || email.split('@')[0],
        authorRole: removedMember?.role || 'Member',
        authorColor: removedMember?.color || '#94a3b8',
        actionSummary: `${removedMember?.displayName || email} left the team`,
        editType: 'member_leave',
        snapshot: null
      });
      if (team.versionHistory.length > 500) team.versionHistory.length = 500;
      team.updatedAt = now;
      saveTeam(team);
      broadcastToTeam(teamId, 'member_left', { email: userEmailNorm, team });
    }
  }

  console.log(`[TeamCollab] User ${email} left team ${teamId}`);
  res.json({ success: true });
});

// 5. Get full team data & active presences
app.get(['/api/team/data', '/vex-path-planner/api/team/data'], (req, res) => {
  const { teamId } = req.query;
  if (!teamId) {
    return res.status(400).json({ error: 'Missing teamId parameter' });
  }

  const team = getTeam(teamId);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }

  const pMap = teamPresences.get(team.teamId) || new Map();
  res.json({
    success: true,
    team,
    activeMembers: Array.from(pMap.values())
  });
});

// 6. Real-time path & action sync edit (Stores up to 500 version history entries with author attribution)
app.post(['/api/team/sync-edit', '/vex-path-planner/api/team/sync-edit'], (req, res) => {
  const { teamId, email, authorName, authorRole, editType, changeSummary, pathPayload, projectPayload, createSnapshot } = req.body || {};
  if (!teamId) {
    return res.status(400).json({ error: 'Missing teamId parameter' });
  }

  const team = getTeam(teamId);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }

  const now = Date.now();
  team.updatedAt = now;

  if (pathPayload !== undefined && pathPayload !== null) {
    team.pathPayload = pathPayload;
  }
  if (projectPayload !== undefined && projectPayload !== null) {
    team.project = projectPayload;
  }

  const userEmailNorm = (email && String(email).trim().toLowerCase()) || '';
  const member = team.members.find(m => m.email.toLowerCase() === userEmailNorm);
  const finalRole = authorRole || member?.role || 'Programmer';
  const finalName = authorName || member?.displayName || (email ? email.split('@')[0] : 'Teammate');
  const finalColor = member?.color || getRoleColor(finalRole);

  if (createSnapshot !== false) {
    const linesCount = (pathPayload && Array.isArray(pathPayload.paths))
      ? pathPayload.paths.reduce((acc, p) => acc + (p.actions ? p.actions.length : 0), 0)
      : 0;

    const snapshotItem = {
      id: 'v_' + now + '_' + Math.random().toString(36).substring(2, 6),
      timestamp: now,
      dateStr: new Date(now).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      authorEmail: userEmailNorm,
      authorName: finalName,
      authorRole: finalRole,
      authorColor: finalColor,
      actionSummary: changeSummary || 'Modified autonomous routine',
      editType: editType || 'waypoint_edit',
      snapshot: pathPayload || null,
      linesCount
    };

    if (!team.versionHistory) team.versionHistory = [];
    team.versionHistory.unshift(snapshotItem);

    // Enforce up to 500 team version histories!
    if (team.versionHistory.length > 500) {
      team.versionHistory.length = 500;
    }
  }

  saveTeam(team);

  // Broadcast change immediately to all other connected team members
  broadcastToTeam(teamId, 'sync', {
    email: userEmailNorm,
    authorName: finalName,
    authorRole: finalRole,
    editType: editType || 'waypoint_edit',
    changeSummary: changeSummary || 'Modified autonomous routine',
    pathPayload: team.pathPayload,
    projectPayload: team.project,
    versionCount: team.versionHistory ? team.versionHistory.length : 0,
    updatedAt: now
  }, userEmailNorm);

  res.json({
    success: true,
    versionCount: team.versionHistory ? team.versionHistory.length : 0,
    updatedAt: now
  });
});

// 7. Presence Heartbeat & Live Cursor Sharing
app.post(['/api/team/presence', '/vex-path-planner/api/team/presence'], (req, res) => {
  const { teamId, email, displayName, role, cursor, activeWaypoint, activeRoutine } = req.body || {};
  if (!teamId || !email) {
    return res.status(400).json({ error: 'Missing teamId or email' });
  }

  let pMap = teamPresences.get(teamId);
  if (!pMap) {
    pMap = new Map();
    teamPresences.set(teamId, pMap);
  }

  const clean = email.trim().toLowerCase();
  const userRole = role || 'Programmer';
  const userDisp = displayName || email.split('@')[0];

  pMap.set(clean, {
    email: clean,
    displayName: userDisp,
    role: userRole,
    color: getRoleColor(userRole),
    cursor: cursor || null,
    activeWaypoint: activeWaypoint || null,
    activeRoutine: activeRoutine || null,
    lastSeen: Date.now()
  });

  const activeMembers = Array.from(pMap.values());

  // Broadcast presence & cursor to all other clients in the room
  broadcastToTeam(teamId, 'presence', { activeMembers }, clean);

  res.json({ success: true, activeMembers });
});

// 8. Server-Sent Events (SSE) Stream for Instant Multi-User Sync
app.get(['/api/team/events', '/vex-path-planner/api/team/events'], (req, res) => {
  const { teamId, email } = req.query;
  if (!teamId) {
    return res.status(400).send('Missing teamId');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  let room = teamRooms.get(teamId);
  if (!room) {
    room = new Set();
    teamRooms.set(teamId, room);
  }

  res.userEmail = email ? email.trim().toLowerCase() : '';
  room.add(res);

  // Send initial connection event
  const pMap = teamPresences.get(teamId) || new Map();
  res.write(`event: connected\ndata: ${JSON.stringify({ connected: true, activeMembers: Array.from(pMap.values()) })}\n\n`);

  // Heartbeat ping every 15s to keep connection alive through reverse proxies
  const pingTimer = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      clearInterval(pingTimer);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(pingTimer);
    room.delete(res);
    if (res.userEmail) {
      const p = teamPresences.get(teamId);
      if (p) {
        p.delete(res.userEmail);
        broadcastToTeam(teamId, 'presence', { activeMembers: Array.from(p.values()) });
      }
    }
  });
});

// 9. Collaborative Field Pin Comments
app.post(['/api/team/comment/add', '/vex-path-planner/api/team/comment/add'], (req, res) => {
  const { teamId, email, authorName, authorRole, x, y, text } = req.body || {};
  if (!teamId || !text || text.trim() === '') {
    return res.status(400).json({ error: 'Missing comment text or teamId' });
  }

  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const now = Date.now();
  const userRole = authorRole || 'Coach';
  const newComment = {
    id: 'cmt_' + now + '_' + Math.random().toString(36).substring(2, 6),
    x: Number(x) || 0,
    y: Number(y) || 0,
    text: text.trim(),
    authorEmail: (email || '').trim().toLowerCase(),
    authorName: authorName || (email ? email.split('@')[0] : 'Teammate'),
    authorRole: userRole,
    authorColor: getRoleColor(userRole),
    timestamp: now,
    resolved: false,
    replies: []
  };

  if (!team.comments) team.comments = [];
  team.comments.unshift(newComment);
  team.updatedAt = now;
  saveTeam(team);

  broadcastToTeam(teamId, 'comment_update', { comments: team.comments, newComment });
  res.json({ success: true, comments: team.comments, comment: newComment });
});

app.post(['/api/team/comment/reply', '/vex-path-planner/api/team/comment/reply'], (req, res) => {
  const { teamId, commentId, email, authorName, authorRole, text } = req.body || {};
  if (!teamId || !commentId || !text || text.trim() === '') {
    return res.status(400).json({ error: 'Missing reply text or commentId' });
  }

  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const target = (team.comments || []).find(c => c.id === commentId);
  if (!target) return res.status(404).json({ error: 'Comment not found' });

  const now = Date.now();
  const userRole = authorRole || 'Programmer';
  const reply = {
    id: 'rep_' + now + '_' + Math.random().toString(36).substring(2, 6),
    text: text.trim(),
    authorEmail: (email || '').trim().toLowerCase(),
    authorName: authorName || (email ? email.split('@')[0] : 'Teammate'),
    authorRole: userRole,
    authorColor: getRoleColor(userRole),
    timestamp: now
  };

  if (!target.replies) target.replies = [];
  target.replies.push(reply);
  team.updatedAt = now;
  saveTeam(team);

  broadcastToTeam(teamId, 'comment_update', { comments: team.comments });
  res.json({ success: true, comments: team.comments });
});

app.post(['/api/team/comment/resolve', '/vex-path-planner/api/team/comment/resolve'], (req, res) => {
  const { teamId, commentId, resolved } = req.body || {};
  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const target = (team.comments || []).find(c => c.id === commentId);
  if (target) {
    target.resolved = resolved !== undefined ? Boolean(resolved) : !target.resolved;
    team.updatedAt = Date.now();
    saveTeam(team);
    broadcastToTeam(teamId, 'comment_update', { comments: team.comments });
  }
  res.json({ success: true, comments: team.comments || [] });
});

app.post(['/api/team/comment/delete', '/vex-path-planner/api/team/comment/delete'], (req, res) => {
  const { teamId, commentId } = req.body || {};
  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  team.comments = (team.comments || []).filter(c => c.id !== commentId);
  team.updatedAt = Date.now();
  saveTeam(team);
  broadcastToTeam(teamId, 'comment_update', { comments: team.comments });
  res.json({ success: true, comments: team.comments });
});

// 10. Autonomous Strategy Consensus & Voting Board
app.post(['/api/team/strategy/add', '/vex-path-planner/api/team/strategy/add'], (req, res) => {
  const { teamId, email, authorName, title, description, targetRoutine } = req.body || {};
  if (!teamId || !title || title.trim() === '') {
    return res.status(400).json({ error: 'Missing strategy title or teamId' });
  }

  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const now = Date.now();
  const userEmailNorm = (email || '').trim().toLowerCase();
  const newStrategy = {
    id: 'strat_' + now + '_' + Math.random().toString(36).substring(2, 6),
    title: title.trim(),
    description: (description && description.trim()) || '',
    targetRoutine: targetRoutine || '',
    authorEmail: userEmailNorm,
    authorName: authorName || (email ? email.split('@')[0] : 'Teammate'),
    createdAt: now,
    status: 'active',
    votes: {
      [userEmailNorm]: 'rocket'
    }
  };

  if (!team.strategies) team.strategies = [];
  team.strategies.unshift(newStrategy);
  team.updatedAt = now;
  saveTeam(team);

  broadcastToTeam(teamId, 'strategy_update', { strategies: team.strategies });
  res.json({ success: true, strategies: team.strategies, strategy: newStrategy });
});

app.post(['/api/team/strategy/vote', '/vex-path-planner/api/team/strategy/vote'], (req, res) => {
  const { teamId, strategyId, email, vote } = req.body || {};
  if (!teamId || !strategyId || !email) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const target = (team.strategies || []).find(s => s.id === strategyId);
  if (target) {
    if (!target.votes) target.votes = {};
    const userEmailNorm = email.trim().toLowerCase();
    if (target.votes[userEmailNorm] === vote) {
      delete target.votes[userEmailNorm]; // toggle off
    } else {
      target.votes[userEmailNorm] = vote; // 'yes' | 'no' | 'rocket'
    }
    team.updatedAt = Date.now();
    saveTeam(team);
    broadcastToTeam(teamId, 'strategy_update', { strategies: team.strategies });
  }

  res.json({ success: true, strategies: team.strategies || [] });
});

app.post(['/api/team/strategy/delete', '/vex-path-planner/api/team/strategy/delete'], (req, res) => {
  const { teamId, strategyId } = req.body || {};
  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  team.strategies = (team.strategies || []).filter(s => s.id !== strategyId);
  team.updatedAt = Date.now();
  saveTeam(team);
  broadcastToTeam(teamId, 'strategy_update', { strategies: team.strategies });
  res.json({ success: true, strategies: team.strategies });
});

// 11. Restore any of the up to 500 Version Histories
app.post(['/api/team/version/restore', '/vex-path-planner/api/team/version/restore'], (req, res) => {
  const { teamId, versionId, email, authorName, authorRole } = req.body || {};
  if (!teamId || !versionId) {
    return res.status(400).json({ error: 'Missing teamId or versionId' });
  }

  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const targetVersion = (team.versionHistory || []).find(v => v.id === versionId);
  if (!targetVersion || !targetVersion.snapshot) {
    return res.status(404).json({ error: 'Version snapshot payload not found' });
  }

  const now = Date.now();
  const userEmailNorm = (email || '').trim().toLowerCase();
  const userDisp = authorName || (email ? email.split('@')[0] : 'Teammate');
  const userRole = authorRole || 'Programmer';

  // Restore path payload
  team.pathPayload = targetVersion.snapshot;
  team.updatedAt = now;

  // Record restoration snapshot in version history with full attribution
  const restoreSnapshot = {
    id: 'v_' + now + '_restored',
    timestamp: now,
    dateStr: new Date(now).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    authorEmail: userEmailNorm,
    authorName: userDisp,
    authorRole: userRole,
    authorColor: getRoleColor(userRole),
    actionSummary: `Restored version from ${targetVersion.dateStr} (${targetVersion.actionSummary})`,
    editType: 'version_restore',
    snapshot: targetVersion.snapshot,
    restoredFromId: versionId
  };

  team.versionHistory.unshift(restoreSnapshot);
  if (team.versionHistory.length > 500) team.versionHistory.length = 500;

  saveTeam(team);

  broadcastToTeam(teamId, 'sync', {
    email: userEmailNorm,
    authorName: userDisp,
    authorRole: userRole,
    editType: 'version_restore',
    changeSummary: restoreSnapshot.actionSummary,
    pathPayload: team.pathPayload,
    versionCount: team.versionHistory.length,
    updatedAt: now
  });

  res.json({ success: true, team });
});

// 12. Owner Project Import (from Visual Planner or GitHub)
app.post(['/api/team/import-project', '/vex-path-planner/api/team/import-project'], (req, res) => {
  const { teamId, email, authorName, authorRole, source, projectData, pathPayload, repoInfo } = req.body || {};
  if (!teamId || !email) {
    return res.status(400).json({ error: 'Missing teamId or email' });
  }

  const team = getTeam(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const cleanEmail = email.trim().toLowerCase();
  const ownerEmail = (team.ownerEmail || '').trim().toLowerCase();

  // Enforce: only the owner can import projects into the team workspace
  const member = (team.members || []).find(m => (m.email || '').trim().toLowerCase() === cleanEmail);
  const isOwner = cleanEmail === ownerEmail || Boolean(member && member.isOwner);

  if (!isOwner) {
    return res.status(403).json({
      error: `Permission Denied: Only the team owner (${team.ownerEmail || 'Team Creator'}) has permission to import projects into this team workspace.`
    });
  }

  const now = Date.now();
  const userDisp = authorName || member?.displayName || email.split('@')[0];
  const userRole = authorRole || member?.role || 'Programmer';

  if (pathPayload && pathPayload.paths) {
    team.pathPayload = pathPayload;
  }
  if (projectData) {
    team.project = projectData;
  }

  let summary = 'Imported project into team workspace';
  let editType = 'project_import';
  if (source === 'github') {
    const repoStr = repoInfo?.repo || repoInfo?.name || 'GitHub repository';
    const branchStr = repoInfo?.branch ? ` (${repoInfo.branch})` : '';
    summary = `Imported GitHub repo "${repoStr}"${branchStr}`;
    editType = 'import_github';
  } else if (source === 'planner') {
    const projName = projectData?.name || 'Visual Planner';
    const numRoutines = pathPayload?.paths?.length || 0;
    summary = `Imported active project "${projName}" (${numRoutines} routines) from Visual Planner`;
    editType = 'import_planner';
  }

  const importSnapshot = {
    id: 'v_' + now + '_import',
    timestamp: now,
    dateStr: new Date(now).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    authorEmail: cleanEmail,
    authorName: userDisp,
    authorRole: userRole,
    authorColor: getRoleColor(userRole),
    actionSummary: summary,
    editType,
    snapshot: team.pathPayload,
    project: team.project ? { name: team.project.name, fileCount: Object.keys(team.project.files || {}).length } : null
  };

  if (!team.versionHistory) team.versionHistory = [];
  team.versionHistory.unshift(importSnapshot);
  if (team.versionHistory.length > 500) team.versionHistory.length = 500;

  team.updatedAt = now;
  saveTeam(team);

  // Broadcast to all team members in real-time
  broadcastToTeam(teamId, 'sync', {
    email: cleanEmail,
    authorName: userDisp,
    authorRole: userRole,
    editType,
    changeSummary: summary,
    pathPayload: team.pathPayload,
    projectPayload: team.project,
    versionCount: team.versionHistory.length,
    updatedAt: now
  });

  console.log(`[TeamCollab] Owner ${cleanEmail} imported project (${source}) for team "${team.teamName}"`);
  res.json({ success: true, team });
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
  res.type('application/json');
  const { token, repo, branch, files, commitMessage } = req.body || {};
  if (!token || !repo || !files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Missing token, repo, or files payload' });
  }

  const targetBranch = branch || 'main';
  const msg = commitMessage || 'Sync from VEX Path Planner Workspace 🚀';

  let cleanRepo = String(repo).trim();
  cleanRepo = cleanRepo.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  cleanRepo = cleanRepo.replace(/\.git$/i, '');
  cleanRepo = cleanRepo.replace(/\/+$/, '');
  if (cleanRepo.includes('/tree/')) cleanRepo = cleanRepo.split('/tree/')[0];

  const parts = cleanRepo.split('/').filter(Boolean);
  if (parts.length < 2) {
    return res.status(400).json({ error: 'Invalid repo name format. Must be "owner/repo" or GitHub URL' });
  }
  const owner = parts[0];
  const repoName = parts[1];

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

// Git Integration API - Direct Repository Cloning
app.post('/api/github/clone', async (req, res) => {
  res.type('application/json');
  const { repo, branch, token } = req.body || {};
  if (!repo) {
    return res.status(400).json({ error: 'Missing repository parameter (e.g. "owner/repo" or full GitHub URL)' });
  }

  // Sanitize repo input
  let cleanRepo = String(repo).trim();
  cleanRepo = cleanRepo.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  cleanRepo = cleanRepo.replace(/\.git$/i, '');
  cleanRepo = cleanRepo.replace(/\/+$/, '');

  let urlBranch = null;
  if (cleanRepo.includes('/tree/')) {
    const parts = cleanRepo.split('/tree/');
    cleanRepo = parts[0];
    urlBranch = parts[1] ? parts[1].trim() : null;
  }

  const parts = cleanRepo.split('/').filter(Boolean);
  if (parts.length < 2) {
    return res.status(400).json({ error: 'Invalid repository name. Format must be "owner/repo" or GitHub URL' });
  }
  const owner = parts[0];
  const repoName = parts[1];

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'VEX-Path-Planner-Cloud-Sync'
  };
  if (token && String(token).trim()) {
    headers['Authorization'] = `token ${String(token).trim()}`;
  }

  try {
    let targetBranch = branch ? String(branch).trim() : (urlBranch || null);

    // If branch is not specified, query repository metadata to determine default branch
    if (!targetBranch) {
      const repoMetaUrl = `https://api.github.com/repos/${owner}/${repoName}`;
      const repoMetaRes = await fetch(repoMetaUrl, { headers });
      if (!repoMetaRes.ok) {
        const errTxt = await repoMetaRes.text();
        return res.status(repoMetaRes.status).json({ error: `Failed to fetch GitHub repo metadata (${repoMetaRes.status}): ${errTxt}` });
      }
      const repoMetaData = await repoMetaRes.json();
      targetBranch = repoMetaData.default_branch || 'main';
    }

    // Download repository ZIP archive
    const zipUrl = `https://api.github.com/repos/${owner}/${repoName}/zipball/${targetBranch}`;
    const zipRes = await fetch(zipUrl, { headers, redirect: 'follow' });
    if (!zipRes.ok) {
      const errTxt = await zipRes.text();
      return res.status(zipRes.status).json({ error: `Failed to download repository zip archive (${zipRes.status}): ${errTxt}` });
    }

    const arrayBuffer = await zipRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const zip = await JSZip.loadAsync(buffer);

    const IGNORED_PATH_PREFIXES = [
      '.cache/', '.clangd/', '.vscode/', '.git/', 'bin/', 'build/', 'firmware/', 'dist/', 'node_modules/'
    ];
    const IGNORED_EXTENSIONS = [
      '.idx', '.bin', '.elf', '.o', '.a', '.d', '.map', '.gch', '.pch', '.so', '.dylib', '.dll', '.exe', '.zip', '.tar', '.gz', '.7z', '.iso', '.png', '.jpg', '.jpeg'
    ];

    const extractedFiles = {};

    // GitHub zipball has a top-level folder like owner-repo-sha/
    let prefixCut = 0;
    const entryNames = Object.keys(zip.files);
    if (entryNames.length > 0) {
      const firstEntry = entryNames[0];
      const slashIdx = firstEntry.indexOf('/');
      if (slashIdx !== -1) {
        prefixCut = slashIdx + 1;
      }
    }

    for (const [relativePath, fileObj] of Object.entries(zip.files)) {
      if (fileObj.dir) continue;

      let normPath = prefixCut > 0 ? relativePath.substring(prefixCut) : relativePath;
      if (!normPath) continue;
      normPath = normPath.replace(/\\/g, '/');

      // Check ignored prefixes
      if (IGNORED_PATH_PREFIXES.some(prefix => normPath.startsWith(prefix) || normPath.includes('/' + prefix))) {
        continue;
      }
      // Check ignored extensions
      const lower = normPath.toLowerCase();
      if (IGNORED_EXTENSIONS.some(ext => lower.endsWith(ext))) {
        continue;
      }

      const content = await fileObj.async('string');
      // Skip binary null bytes or oversized files
      if (content.indexOf('\0') !== -1) continue;
      if (content.length > 1.5 * 1024 * 1024) continue;

      extractedFiles[normPath] = content;
    }

    if (Object.keys(extractedFiles).length === 0) {
      return res.status(400).json({ error: 'No valid source/header files found in repository zip.' });
    }

    res.json({
      success: true,
      owner,
      repo: `${owner}/${repoName}`,
      repoName,
      branch: targetBranch,
      fileCount: Object.keys(extractedFiles).length,
      files: extractedFiles
    });
  } catch (err) {
    console.error('[GitHub Clone Error]:', err);
    res.status(500).json({ error: err.message || 'Internal server error while cloning repository' });
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

// Serve ads.txt directly with text/plain content type
app.get(['/ads.txt', '/vex-path-planner/ads.txt'], (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.sendFile(path.join(__dirname, 'ads.txt'));
});

// HTTP No-Cache Headers for all HTML files and version.js to ensure instant, reliable updates
const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0'
};

// Explicitly serve version.js with no-cache headers so update checks are instant
app.get('/version.js', (req, res) => {
  res.set({
    ...NO_CACHE_HEADERS,
    'Content-Type': 'application/javascript; charset=utf-8'
  });
  res.sendFile(path.join(__dirname, 'version.js'));
});

// Serve static assets from root with strict no-cache on all files
app.use(express.static(__dirname, {
  etag: false,
  lastModified: false,
  maxAge: 0,
  cacheControl: false,
  setHeaders: (res) => {
    res.set(NO_CACHE_HEADERS);
  }
}));

// Route to serve IDE directly
app.get(['/ide', '/ide.html'], (req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.sendFile(path.join(__dirname, 'ide.html'));
});

app.get(['/translator', '/translator.html'], (req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.sendFile(path.join(__dirname, 'translator.html'));
});

app.get(['/stats', '/stats.html'], (req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.sendFile(path.join(__dirname, 'stats.html'));
});

app.get(['/tools', '/tools.html'], (req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.sendFile(path.join(__dirname, 'tools.html'));
});

// Real-Time Team Collaboration & Cloud Sync Page Route (BETA)
app.get(['/team', '/team.html'], (req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.sendFile(path.join(__dirname, 'team.html'));
});

// Google Search Console & SEO Routes
app.get(['/favicon.ico'], (req, res) => {
  res.set({
    ...NO_CACHE_HEADERS,
    'Content-Type': 'image/x-icon'
  });
  res.sendFile(path.join(__dirname, 'favicon.ico'));
});

app.get(['/favicon.svg'], (req, res) => {
  res.set({
    ...NO_CACHE_HEADERS,
    'Content-Type': 'image/svg+xml'
  });
  res.sendFile(path.join(__dirname, 'favicon.svg'));
});

app.get(['/sitemap.xml', '/sitemap'], (req, res) => {
  res.set({
    ...NO_CACHE_HEADERS,
    'Content-Type': 'application/xml; charset=utf-8'
  });
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.set({
    ...NO_CACHE_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.sendFile(path.join(__dirname, 'robots.txt'));
});

// Google Search Console HTML File verification route
app.get(['/googlec50c21e43ad27747.html', '/google:code.html'], (req, res, next) => {
  const target = req.params.code ? `google${req.params.code}.html` : 'googlec50c21e43ad27747.html';
  const filePath = path.join(__dirname, target);
  if (fs.existsSync(filePath)) {
    res.set({
      ...NO_CACHE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8'
    });
    return res.sendFile(filePath);
  }
  next();
});

app.get(['/root-domain-index.html', '/root-domain-index'], (req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.sendFile(path.join(__dirname, 'root-domain-index.html'));
});

app.get(['/', '/index.html'], (req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Explicit 404 handler for API routes to never return HTML document
app.all(['/api/*', '/vex-path-planner/api/*'], (req, res) => {
  res.status(404).json({ error: `API route ${req.path} not found` });
});

// Fallback to index.html with no-cache
app.get('*', (req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

