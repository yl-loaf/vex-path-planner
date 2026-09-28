// team.js - Real-Time Multi-User Collaboration & Cloud Sync Engine (BETA)
(function (global) {
  "use strict";

  // State
  let currentTeam = null;
  let currentUser = null; // { email, displayName, uid, photoURL, role }
  let activeRoutineIndex = 0;
  let activePaths = [];
  let selectedActionId = null;
  let selectedVersionForRestore = null;
  let isDraggingWaypoint = false;
  let draggedWaypointIndex = -1;
  let isPinDropMode = false;
  let sseEventSource = null;
  let lastCursorBroadcast = 0;
  let simTimer = null;
  let simTimeMs = 0;
  let isSimPlaying = false;

  const FIELD_INCHES = 144; // VEX Field is 144" x 144"
  const FIELD_HALF = 72;

  // DOM Elements
  const canvas = document.getElementById("teamFieldCanvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const cursorsLayer = document.getElementById("teammateCursorsLayer");
  const pinsLayer = document.getElementById("fieldPinsLayer");

  // --------------------------------------------------------------------------
  // UTILITY HELPERS
  // --------------------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(msg, icon = "✅") {
    const toast = document.getElementById("teamToast");
    const msgEl = document.getElementById("teamToastMsg");
    const iconEl = document.getElementById("teamToastIcon");
    if (!toast) return;
    if (msgEl) msgEl.textContent = msg;
    if (iconEl) iconEl.textContent = icon;
    toast.classList.add("active");
    setTimeout(() => {
      toast.classList.remove("active");
    }, 3200);
  }

  function getRoleColor(role) {
    switch (role) {
      case "Programmer": return "#38bdf8";
      case "Driver": return "#10b981";
      case "Coach": return "#f59e0b";
      case "Strategist": return "#a855f7";
      default: return "#38bdf8";
    }
  }

  function getRoleEmoji(role) {
    switch (role) {
      case "Programmer": return "💻";
      case "Driver": return "🎮";
      case "Coach": return "📋";
      case "Strategist": return "🎯";
      default: return "👤";
    }
  }

  function cleanEmailKey(email) {
    if (!email || typeof email !== "string") return "";
    return email.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
  }

  function getCleanEmailKeys(email) {
    if (!email || typeof email !== "string") return [];
    const norm = email.trim().toLowerCase();
    const k1 = norm.replace(/[^a-z0-9_.-]/g, "_");
    const k2 = norm.replace(/[^a-z0-9]/g, "_");
    return Array.from(new Set([norm, k1, k2]));
  }

  const isStaticHost = typeof window !== "undefined" && window.location && (
    window.location.hostname.includes("github.io") ||
    window.location.protocol === "file:"
  );

  function resolveApiUrl(path) {
    if (isStaticHost) return null;
    const pathname = (typeof window !== "undefined" && window.location) ? window.location.pathname : "";
    if (pathname.includes("/vex-path-planner/")) {
      return "/vex-path-planner" + path;
    }
    return path;
  }

  async function safeFetchJson(url, options = {}) {
    if (!url) return { ok: false, isBypassed: true };
    try {
      const res = await fetch(url, options);
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        if (contentType.includes("application/json")) {
          const errJson = await res.json().catch(() => ({}));
          return { ok: false, status: res.status, error: errJson.error || `HTTP ${res.status}`, isHtml: false, data: errJson };
        }
        return { ok: false, status: res.status, error: `HTTP ${res.status}`, isHtml: contentType.includes("html") };
      }
      if (!contentType.includes("application/json")) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, error: "Non-JSON response", isHtml: text.includes("<") };
      }
      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: err.message || "Network error", isNetworkError: true };
    }
  }

  // --------------------------------------------------------------------------
  // 5-MINUTE ROLLING OTP ENGINE (Pure JS SHA-256 HMAC, 100% Node Crypto Compatible)
  // --------------------------------------------------------------------------
  function sha256(ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    let i, j, result = "";
    const words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    let compositeLength = ((asciiBitLength + 64 >>> 9) << 4) + 15;
    while (words.length <= compositeLength) words.push(0);
    for (i = 0; i < ascii.length; i++) words[i >>> 2] |= (ascii.charCodeAt(i) & 255) << (24 - (i % 4) * 8);
    words[ascii.length >>> 2] |= 128 << (24 - (ascii.length % 4) * 8);
    words[compositeLength] = asciiBitLength;
    for (j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        const i2 = i + j;
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
              w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0
          );
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0, a, hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (let b = 3; b >= 0; b--) {
        const byte = (hash[i] >>> (b * 8)) & 255;
        result += (byte < 16 ? "0" : "") + byte.toString(16);
      }
    }
    return result;
  }

  function hmacSha256Hex(key, message) {
    const blockSize = 64;
    let keyBytes = [];
    if (key.length > blockSize) {
      const h = sha256(key);
      for (let i = 0; i < h.length; i += 2) keyBytes.push(parseInt(h.substr(i, 2), 16));
    } else {
      for (let i = 0; i < key.length; i++) keyBytes.push(key.charCodeAt(i) & 255);
    }
    while (keyBytes.length < blockSize) keyBytes.push(0);

    let oKeyPad = "", iKeyPad = "";
    for (let i = 0; i < blockSize; i++) {
      oKeyPad += String.fromCharCode(keyBytes[i] ^ 0x5c);
      iKeyPad += String.fromCharCode(keyBytes[i] ^ 0x36);
    }

    const innerHashHex = sha256(iKeyPad + message);
    let innerHashStr = "";
    for (let i = 0; i < innerHashHex.length; i += 2) {
      innerHashStr += String.fromCharCode(parseInt(innerHashHex.substr(i, 2), 16));
    }
    return sha256(oKeyPad + innerHashStr);
  }

  function getTeamJoinOtp(team, timestamp = Date.now()) {
    if (!team) return "000000";
    const secret = team.joinSecret || (String(team.teamId) + "_" + String(team.teamCode || "VEX") + "_otp_secret");
    const windowIndex = Math.floor(timestamp / (5 * 60 * 1000));
    const hmac = hmacSha256Hex(secret, String(windowIndex));
    const num = (parseInt(hmac.substring(0, 8), 16) % 900000) + 100000;
    return String(num);
  }

  function verifyTeamJoinOtp(team, candidate) {
    if (!team || !candidate) return false;
    const clean = String(candidate).replace(/\s+/g, "").trim();
    const now = Date.now();
    const cur = getTeamJoinOtp(team, now);
    const prev = getTeamJoinOtp(team, now - 300000);
    return clean === cur || clean === prev;
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

  // --------------------------------------------------------------------------
  // FIRESTORE DUAL-CLOUD INTEGRATION (Supports GitHub Pages & Serverless)
  // --------------------------------------------------------------------------
  let firestoreUnsub = null;

  function getFirestoreDb() {
    if (typeof firebase !== "undefined" && firebase.firestore) {
      try {
        return firebase.firestore();
      } catch (_) {}
    }
    return null;
  }

  async function fsCheckUserTeam(cleanEmail) {
    const db = getFirestoreDb();
    if (!db) return null;
    try {
      const rosterDoc = await db.collection("team_rosters").doc(cleanEmail).get();
      if (rosterDoc.exists && rosterDoc.data().teamId) {
        const teamDoc = await db.collection("teams").doc(rosterDoc.data().teamId).get();
        if (teamDoc.exists) {
          return teamDoc.data();
        }
      }
    } catch (e) {
      console.warn("[TeamCollab] Firestore check notice:", e);
    }
    return null;
  }

  async function fsCreateTeam(newTeam, cleanEmail) {
    const db = getFirestoreDb();
    if (!db) return newTeam;
    try {
      await db.collection("teams").doc(newTeam.teamId).set(newTeam);
      await db.collection("team_rosters").doc(cleanEmail).set({
        teamId: newTeam.teamId,
        email: cleanEmail,
        teamName: newTeam.teamName,
        joinedAt: Date.now()
      });
    } catch (e) {
      console.warn("[TeamCollab] Firestore team create notice:", e);
    }
    return newTeam;
  }

  async function fsJoinTeam(teamCode, otp, userObj) {
    const cleanCode = (teamCode || "").trim().toUpperCase();
    const cleanOtp = (otp || "").trim();
    const clean = cleanEmailKey(userObj.email);

    const db = getFirestoreDb();
    let team = null;
    let teamRef = null;

    if (db) {
      try {
        const query = await db.collection("teams").where("teamCode", "==", cleanCode).limit(1).get();
        if (!query.empty) {
          teamRef = query.docs[0].ref;
          team = query.docs[0].data();
        }
      } catch (e) {
        console.warn("[TeamCollab] Firestore search notice:", e);
      }
    }

    if (!team) {
      try {
        const rawLocal = localStorage.getItem("lemlib_active_team");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (parsed && parsed.teamCode?.toUpperCase() === cleanCode) {
            team = parsed;
          }
        }
      } catch (_) {}
    }

    if (!team) {
      const demoTeams = [
        {
          teamId: "team_mukoxgqg_n33t0",
          teamCode: "VEX-217",
          teamName: "99999X Apex",
          vexTeamNumber: "99999X",
          joinSecret: "5f43bb1a46546ac89481068d3719f9d5",
          ownerEmail: "owner@example.com",
          createdAt: Date.now() - 3600000,
          updatedAt: Date.now() - 3600000,
          members: [{ email: "owner@example.com", displayName: "Owner", role: "Programmer", isOwner: true }],
          versionHistory: [],
          comments: [],
          strategies: []
        },
        {
          teamId: "team_mukowlcd_4qzcs",
          teamCode: "VEX-939",
          teamName: "99999X Apex",
          vexTeamNumber: "99999X",
          joinSecret: "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
          ownerEmail: "owner@example.com",
          createdAt: Date.now() - 7200000,
          updatedAt: Date.now() - 7200000,
          members: [{ email: "owner@example.com", displayName: "Owner", role: "Programmer", isOwner: true }],
          versionHistory: [],
          comments: [],
          strategies: []
        }
      ];
      team = demoTeams.find(t => t.teamCode.toUpperCase() === cleanCode);
    }

    if (!team) {
      return { error: `Team with code "${cleanCode}" not found. Verify the code with your teammate.` };
    }

    // Enforce 5-Minute Rolling OTP validation
    if (!verifyTeamJoinOtp(team, cleanOtp)) {
      return {
        error: `Invalid or expired Join OTP for team "${team.teamName}". Join codes rotate every 5 minutes for security. Please request the current live OTP from an active teammate.`
      };
    }

    const normEmail = userObj.email.trim().toLowerCase();
    const now = Date.now();
    team.members = team.members || [];
    if (!team.members.some(m => m.email.toLowerCase() === normEmail)) {
      team.members.push({
        email: normEmail,
        displayName: userObj.displayName,
        role: userObj.role,
        color: getRoleColor(userObj.role),
        joinedAt: now,
        photoURL: userObj.photoURL || "",
        isOwner: false
      });

      team.versionHistory = team.versionHistory || [];
      team.versionHistory.unshift({
        id: "v_" + now + "_join",
        timestamp: now,
        dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        authorEmail: normEmail,
        authorName: userObj.displayName,
        authorRole: userObj.role,
        authorColor: getRoleColor(userObj.role),
        actionSummary: `${userObj.displayName} joined the team as ${userObj.role}`,
        editType: "member_join",
        snapshot: null
      });
      if (team.versionHistory.length > 500) team.versionHistory.length = 500;
      team.updatedAt = now;
    }

    if (db) {
      try {
        if (teamRef) {
          await teamRef.set(team, { merge: true });
        } else {
          await db.collection("teams").doc(team.teamId).set(team);
        }
        await db.collection("team_rosters").doc(clean).set({
          teamId: team.teamId,
          email: clean,
          teamName: team.teamName,
          joinedAt: now
        });
      } catch (e) {
        console.warn("[TeamCollab] Firestore join save warning:", e);
      }
    }

    try {
      localStorage.setItem("lemlib_active_team", JSON.stringify(team));
      localStorage.setItem("lemlib_user_team_id", team.teamId);
      const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
      uTeams[clean] = team.teamId;
      localStorage.setItem("lemlib_user_teams", JSON.stringify(uTeams));
    } catch (_) {}

    return { success: true, team };
  }

  async function fsLeaveTeam(teamId, cleanEmail) {
    const db = getFirestoreDb();
    if (!db) return true;
    try {
      await db.collection("team_rosters").doc(cleanEmail).delete();
      const teamDoc = await db.collection("teams").doc(teamId).get();
      if (teamDoc.exists) {
        const team = teamDoc.data();
        team.members = (team.members || []).filter(m => cleanEmailKey(m.email) !== cleanEmail);
        team.updatedAt = Date.now();
        await teamDoc.ref.set(team, { merge: true });
      }
    } catch (e) {
      console.warn("[TeamCollab] Firestore leave notice:", e);
    }
    return true;
  }

  async function fsSaveTeamDoc(team) {
    const db = getFirestoreDb();
    if (!db || !team || !team.teamId) return false;
    try {
      await db.collection("teams").doc(team.teamId).set(team, { merge: true });
      return true;
    } catch (e) {
      console.warn("[TeamCollab] Firestore sync error:", e);
      return false;
    }
  }

  function fsSubscribeTeam(teamId) {
    if (firestoreUnsub) {
      try { firestoreUnsub(); } catch (_) {}
      firestoreUnsub = null;
    }
    const db = getFirestoreDb();
    if (!db || !teamId) return;

    try {
      firestoreUnsub = db.collection("teams").doc(teamId).onSnapshot((doc) => {
        if (doc && doc.exists) {
          const remote = doc.data();
          if (remote && remote.updatedAt > (currentTeam?.updatedAt || 0)) {
            currentTeam = remote;
            if (remote.pathPayload && remote.pathPayload.paths) {
              activePaths = remote.pathPayload.paths;
              renderRoutinesSelector(false);
              renderActionBlocks();
              drawField();
            }
            renderStrategies();
            renderPinComments();
            renderVersionHistory();
            renderMemberList();
          }
        }
      });
    } catch (e) {
      console.warn("[TeamCollab] Firestore live listener notice:", e);
    }
  }

  // --------------------------------------------------------------------------
  // AUTHENTICATION & TEAM INITIALIZATION
  // --------------------------------------------------------------------------
  function initAuth() {
    const btnGoogleSignIn = document.getElementById("btnGoogleSignIn");
    const btnSignOut = document.getElementById("btnSignOut");
    const btnSwitchAccount = document.getElementById("btnSwitchAccount");
    const authUser = document.getElementById("authUser");
    const btnGateSignInDirect = document.getElementById("btnGateSignInDirect");
    const txtUserAccountEmail = document.getElementById("txtUserAccountEmail");
    const badgeAuthStatus = document.getElementById("badgeAuthStatus");

    function updateAuthUI(user) {
      if (user && user.email) {
        currentUser = user;
        if (btnGoogleSignIn) btnGoogleSignIn.hidden = true;
        if (btnSignOut) btnSignOut.hidden = false;
        if (btnSwitchAccount) btnSwitchAccount.hidden = false;
        if (authUser) {
          authUser.hidden = false;
          authUser.textContent = user.displayName || user.email;
        }
        if (txtUserAccountEmail) txtUserAccountEmail.value = user.email;
        if (badgeAuthStatus) {
          badgeAuthStatus.textContent = "Google Verified";
          badgeAuthStatus.style.background = "rgba(34,197,94,0.15)";
          badgeAuthStatus.style.color = "#4ade80";
        }
      } else {
        const savedEmail = (txtUserAccountEmail && txtUserAccountEmail.value.trim()) ||
          localStorage.getItem("lemlib_saved_google_email") || "rainforest.cck3@gmail.com";
        let savedObj = null;
        try { savedObj = JSON.parse(localStorage.getItem("lemlib_saved_google_user")); } catch (_) {}
        currentUser = {
          email: savedEmail.toLowerCase(),
          displayName: (savedObj && savedObj.displayName) || savedEmail.split("@")[0],
          uid: (savedObj && savedObj.uid) || "user_" + savedEmail.replace(/[^a-z0-9]/g, "_")
        };
        if (btnGoogleSignIn) btnGoogleSignIn.hidden = false;
        if (btnSignOut) btnSignOut.hidden = true;
        if (btnSwitchAccount) btnSwitchAccount.hidden = true;
        if (authUser) {
          authUser.hidden = false;
          authUser.textContent = currentUser.displayName || currentUser.email;
        }
        if (txtUserAccountEmail) txtUserAccountEmail.value = currentUser.email;
        if (badgeAuthStatus) {
          badgeAuthStatus.textContent = "Workspace Account";
          badgeAuthStatus.style.background = "rgba(56,189,248,0.15)";
          badgeAuthStatus.style.color = "#38bdf8";
        }
      }

      const gateOpts = document.getElementById("gateOptions");
      if (gateOpts) gateOpts.style.display = "block";
      checkUserTeam();
    }

    if (txtUserAccountEmail) {
      txtUserAccountEmail.addEventListener("change", () => {
        const val = txtUserAccountEmail.value.trim();
        if (val && val.includes("@")) {
          currentUser = {
            email: val.toLowerCase(),
            displayName: val.split("@")[0],
            uid: "user_" + val.replace(/[^a-z0-9]/g, "_")
          };
          localStorage.setItem("lemlib_saved_google_email", currentUser.email);
          localStorage.setItem("lemlib_saved_google_user", JSON.stringify(currentUser));
          if (authUser) {
            authUser.hidden = false;
            authUser.textContent = currentUser.email;
          }
          checkUserTeam();
        }
      });
    }

    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          try {
            localStorage.setItem("lemlib_saved_google_email", user.email);
            localStorage.setItem("lemlib_saved_google_user", JSON.stringify({
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL
            }));
          } catch (_) {}
          updateAuthUI(user);
        } else {
          updateAuthUI(null);
        }
      });
    } else {
      updateAuthUI(null);
    }

    const triggerSignIn = () => {
      if (typeof firebase !== "undefined" && firebase.auth) {
        const provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider).catch((err) => {
          showToast("Google sign-in popup closed or restricted in preview. You can enter your email directly.", "ℹ️");
        });
      } else {
        showToast("Firebase Auth not loaded; using direct workspace email.", "ℹ️");
      }
    };

    if (btnGoogleSignIn) btnGoogleSignIn.onclick = triggerSignIn;
    if (btnGateSignInDirect) btnGateSignInDirect.onclick = triggerSignIn;

    if (btnSignOut) {
      btnSignOut.onclick = () => {
        if (confirm("Sign out of team workspace?")) {
          if (typeof firebase !== "undefined" && firebase.auth) {
            firebase.auth().signOut().catch(() => {});
          }
          localStorage.removeItem("lemlib_saved_google_email");
          localStorage.removeItem("lemlib_saved_google_user");
          location.reload();
        }
      };
    }

    if (btnSwitchAccount) {
      btnSwitchAccount.onclick = triggerSignIn;
    }
  }

  // --------------------------------------------------------------------------
  // TEAM DATA REST API & SSE STREAM
  // --------------------------------------------------------------------------
  let otpIntervalTimer = null;
  function setupTeamOtpTicker(otpInfo) {
    if (otpIntervalTimer) clearInterval(otpIntervalTimer);
    if (!currentTeam) return;

    const lblTeamOtp = document.getElementById("lblTeamOtp");
    const lblTeamOtpTimer = document.getElementById("lblTeamOtpTimer");

    function renderOtpDisplay(otp, remainingSecs) {
      if (lblTeamOtp) lblTeamOtp.textContent = otp || "------";
      if (lblTeamOtpTimer) {
        const m = Math.floor(Math.max(0, remainingSecs) / 60);
        const s = Math.max(0, remainingSecs) % 60;
        lblTeamOtpTimer.textContent = `(${m}:${s < 10 ? '0' : ''}${s})`;
      }
    }

    let remaining = (otpInfo && typeof otpInfo.remainingSeconds === 'number') ? otpInfo.remainingSeconds : 300;
    let currentOtp = (otpInfo && otpInfo.otp) || "------";
    renderOtpDisplay(currentOtp, remaining);

    otpIntervalTimer = setInterval(async () => {
      remaining--;
      if (remaining <= 0) {
        // Fetch refreshed 5-minute rolling OTP from server
        if (currentTeam && currentTeam.teamId && currentUser && currentUser.email) {
          try {
            const res = await fetch(`/api/team/otp?teamId=${encodeURIComponent(currentTeam.teamId)}&email=${encodeURIComponent(currentUser.email)}`);
            const data = await res.json();
            if (data.success && data.otp) {
              currentOtp = data.otp;
              remaining = data.remainingSeconds || 300;
              currentTeam.otpInfo = data;
            } else {
              remaining = 300;
            }
          } catch (_) {
            remaining = 300;
          }
        } else {
          remaining = 300;
        }
      }
      renderOtpDisplay(currentOtp, remaining);
    }, 1000);
  }

  async function checkUserTeam() {
    if (!currentUser || !currentUser.email) {
      const emailInput = document.getElementById("txtUserAccountEmail");
      const savedEmail = (emailInput && emailInput.value.trim()) || localStorage.getItem("lemlib_saved_google_email") || "rainforest.cck3@gmail.com";
      currentUser = {
        email: savedEmail.toLowerCase(),
        displayName: savedEmail.split("@")[0],
        uid: "user_" + savedEmail.replace(/[^a-z0-9]/g, "_")
      };
    }

    const clean = cleanEmailKey(currentUser.email);
    let loadedTeam = null;

    // 1. Try server REST API (if not on static host)
    const apiRoute = resolveApiUrl(`/api/team/my-team?email=${encodeURIComponent(currentUser.email)}`);
    if (apiRoute) {
      const res = await safeFetchJson(apiRoute);
      if (res.ok && res.data) {
        if (res.data.hasTeam && res.data.team) {
          loadedTeam = res.data.team;
        }
      }
    }

    // 2. Fallback to Firestore if server unavailable or returned 404/405/HTML
    if (!loadedTeam) {
      loadedTeam = await fsCheckUserTeam(clean);
    }

    // 3. Fallback to LocalStorage
    if (!loadedTeam) {
      try {
        const rawLocal = localStorage.getItem("lemlib_active_team");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
          const userKeys = getCleanEmailKeys(currentUser.email);
          const hasMatch = userKeys.some(k => uTeams[k] === parsed.teamId) || parsed.ownerEmail?.toLowerCase() === currentUser.email.toLowerCase();
          if (parsed && parsed.teamId && hasMatch) {
            loadedTeam = parsed;
          }
        }
      } catch (_) {}
    }

    const setupView = document.getElementById("teamSetupJoinView");
    const wsView = document.getElementById("teamWorkspaceView");
    const gate = document.getElementById("modalTeamGate");
    if (gate) gate.style.display = "none";

    if (loadedTeam) {
      currentTeam = loadedTeam;
      if (!currentTeam.otpInfo) currentTeam.otpInfo = getTeamOtpInfo(currentTeam);
      if (setupView) setupView.style.display = "none";
      if (wsView) wsView.style.display = "flex";
      onTeamLoaded();
    } else {
      currentTeam = null;
      if (wsView) wsView.style.display = "none";
      if (setupView) setupView.style.display = "block";
      loadAvailableTeams();
    }
  }

  let availableTeamsInterval = null;
  async function loadAvailableTeams() {
    const listEl = document.getElementById("availableTeamsList");
    if (!listEl) return;

    let teams = [];
    const apiRoute = resolveApiUrl("/api/team/available");
    if (apiRoute) {
      const res = await safeFetchJson(apiRoute);
      if (res.ok && res.data?.teams) {
        teams = res.data.teams;
      }
    }

    // If server not available or returned empty, check Firestore
    if (teams.length === 0) {
      const db = getFirestoreDb();
      if (db) {
        try {
          const snap = await db.collection("teams").limit(10).get();
          if (!snap.empty) {
            teams = snap.docs.map(doc => {
              const d = doc.data();
              return {
                teamId: d.teamId,
                teamName: d.teamName,
                vexTeamNumber: d.vexTeamNumber,
                teamCode: d.teamCode,
                memberCount: (d.members || []).length,
                otpInfo: getTeamOtpInfo(d)
              };
            });
          }
        } catch (_) {}
      }
    }

    // Fallback to sample available teams so user can always test live 5-min OTP join
    if (teams.length === 0) {
      const demoTeams = [
        {
          teamId: "team_mukoxgqg_n33t0",
          teamCode: "VEX-217",
          teamName: "99999X Apex",
          vexTeamNumber: "99999X",
          joinSecret: "5f43bb1a46546ac89481068d3719f9d5",
          memberCount: 2
        },
        {
          teamId: "team_mukowlcd_4qzcs",
          teamCode: "VEX-939",
          teamName: "99999X Apex",
          vexTeamNumber: "99999X",
          joinSecret: "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
          memberCount: 1
        }
      ];
      teams = demoTeams.map(d => ({
        ...d,
        otpInfo: getTeamOtpInfo(d)
      }));
    }

    listEl.innerHTML = "";
    teams.forEach(team => {
      const item = document.createElement("div");
      item.style.cssText = "background:#090d16;border:1px solid #1e293b;border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;";
      const curOtp = team.otpInfo?.otp || getTeamJoinOtp(team);
      const remSec = team.otpInfo?.remainingSeconds || 300;
      const m = Math.floor(remSec / 60);
      const s = remSec % 60;
      const timerStr = `(${m}:${s < 10 ? '0' : ''}${s})`;

      item.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:0.82rem;color:#f8fafc;">${escapeHtml(team.teamName)}</span>
            <span style="font-size:0.7rem;color:#64748b;">(${escapeHtml(team.vexTeamNumber)})</span>
            <span style="font-size:0.68rem;background:rgba(56,189,248,0.12);color:#38bdf8;padding:1px 6px;border-radius:6px;font-family:monospace;font-weight:700;">Code: ${escapeHtml(team.teamCode)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:3px;font-size:0.72rem;color:#94a3b8;">
            <span>👥 ${team.memberCount || 1} member${team.memberCount === 1 ? '' : 's'}</span>
            <span>·</span>
            <span style="color:#fbbf24;font-family:monospace;font-weight:700;">🔐 Live OTP: ${curOtp} <span style="font-size:0.68rem;color:#94a3b8;">${timerStr}</span></span>
          </div>
        </div>
        <button type="button" class="btn-xs-clean btn-quick-join" data-code="${escapeHtml(team.teamCode)}" data-otp="${curOtp}" style="background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);padding:6px 10px;border-radius:6px;font-size:0.74rem;font-weight:700;white-space:nowrap;cursor:pointer;">
          ⚡ Fill Code &amp; OTP
        </button>
      `;
      listEl.appendChild(item);
    });

    listEl.querySelectorAll(".btn-quick-join").forEach(btn => {
      btn.onclick = () => {
        const code = btn.getAttribute("data-code");
        const otp = btn.getAttribute("data-otp");
        const codeInput = document.getElementById("txtJoinCode");
        const otpInput = document.getElementById("txtJoinOtp");
        if (codeInput) codeInput.value = code;
        if (otpInput) otpInput.value = otp;
        showToast(`⚡ Filled Team Code (${code}) and Live OTP (${otp})! Click Verify & Join below.`, "📋");
        const joinBtn = document.getElementById("btnSubmitJoinTeam");
        if (joinBtn) joinBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });
  }

  // --------------------------------------------------------------------------
  // OWNER PERMISSIONS & PROJECT IMPORT HELPERS
  // --------------------------------------------------------------------------
  function isCurrentUserOwner() {
    if (!currentTeam || !currentUser || !currentUser.email) return false;
    const myEmail = currentUser.email.toLowerCase().trim();
    if (currentTeam.ownerEmail && currentTeam.ownerEmail.toLowerCase().trim() === myEmail) {
      return true;
    }
    const myMember = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === myEmail);
    return Boolean(myMember && myMember.isOwner);
  }

  function updateOwnerControlsVisibility() {
    const ownerWrap = document.getElementById("ownerImportWrap");
    if (ownerWrap) {
      ownerWrap.style.display = isCurrentUserOwner() ? "inline-block" : "none";
    }
  }

  function getLocalPlannerPayload() {
    let paths = [];
    let project = null;

    // 1. Try reading visual planner's localStorage
    try {
      const raw = localStorage.getItem("vex-lemlib-path-v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.paths) && parsed.paths.length > 0) {
          paths = JSON.parse(JSON.stringify(parsed.paths));
        }
      }
    } catch (_) {}

    // 2. Try ProjectManager
    try {
      if (global.ProjectManager && global.ProjectManager.project) {
        project = {
          name: global.ProjectManager.project.name || "Override_LemLib_Bot",
          files: global.ProjectManager.project.files || {}
        };
      } else {
        const rawProj = localStorage.getItem("lemlib_active_project");
        if (rawProj) {
          project = JSON.parse(rawProj);
        }
      }
    } catch (_) {}

    // 3. Fallback to activePaths if nothing in storage
    if (paths.length === 0 && activePaths && activePaths.length > 0) {
      paths = JSON.parse(JSON.stringify(activePaths));
    }

    return {
      paths,
      project: project || { name: "Override_LemLib_Bot", files: {} }
    };
  }

  function parseGithubAutonFiles(files, repoName) {
    let detectedPaths = [];
    if (!files) return detectedPaths;

    const candidateFiles = ["src/autons.cpp", "src/auton.cpp", "src/main.cpp", "main.cpp"];
    let matchedFile = null;
    let code = "";

    for (const cf of candidateFiles) {
      if (files[cf]) {
        matchedFile = cf;
        code = files[cf];
        break;
      }
    }

    if (!code) {
      for (const [fn, content] of Object.entries(files)) {
        if (fn.endsWith(".cpp") && (content.includes("moveToPoint") || content.includes("turnToHeading") || content.includes("setPose"))) {
          matchedFile = fn;
          code = content;
          break;
        }
      }
    }

    if (code && global.CppTranslator && typeof global.CppTranslator.parseCppAuton === "function") {
      try {
        const res = global.CppTranslator.parseCppAuton(code);
        if (res) {
          const fnName = matchedFile ? matchedFile.split("/").pop() : "autons.cpp";
          detectedPaths.push({
            id: "p_gh_" + Date.now(),
            name: `${repoName || "GitHub"} Auton (${fnName})`,
            pose: res.pose || { x: -60, y: -60, theta: 0 },
            actions: res.actions && res.actions.length > 0 ? res.actions : [
              { id: "a_1", type: "moveToPoint", x: 0, y: 0, timeout: 2000, comment: "Start auton" }
            ]
          });
        }
      } catch (err) {
        console.warn("CppTranslator parsing notice:", err);
      }
    }

    if (detectedPaths.length === 0) {
      detectedPaths = [
        {
          id: "p_gh_default_" + Date.now(),
          name: `${repoName || "GitHub"} Default Auton`,
          pose: { x: -60, y: -60, theta: 0 },
          actions: [
            { id: "a_1", type: "moveToPoint", x: -24, y: -24, timeout: 2000, maxSpeed: 115, earlyExitRange: 2, comment: "Rush goal" }
          ]
        }
      ];
    }

    return detectedPaths;
  }

  function onTeamLoaded() {
    if (!currentTeam) return;

    // Set ProjectManager to team mode with up to 500 version histories
    if (global.ProjectManager) {
      global.ProjectManager.isTeam = true;
      if (global.ProjectManager.project) {
        global.ProjectManager.project.isTeam = true;
      }
    }

    // Set current member role
    const norm = currentUser.email.toLowerCase();
    const mem = currentTeam.members.find(m => m.email.toLowerCase() === norm);
    if (mem) {
      currentUser.role = mem.role;
      currentUser.color = mem.color || getRoleColor(mem.role);
    } else {
      currentUser.role = "Programmer";
      currentUser.color = getRoleColor("Programmer");
    }

    // Expose for ProjectManager author attribution
    global.currentUserTeamMember = {
      email: currentUser.email,
      displayName: currentUser.displayName || currentUser.email.split("@")[0],
      role: currentUser.role
    };

    // Update Ribbon Elements
    document.getElementById("lblTeamName").textContent = currentTeam.teamName;
    document.getElementById("lblVexNumber").textContent = `(${currentTeam.vexTeamNumber || "VEX Team"})`;
    document.getElementById("lblTeamCode").textContent = currentTeam.teamCode;

    // Load active paths from team payload
    if (currentTeam.pathPayload && Array.isArray(currentTeam.pathPayload.paths) && currentTeam.pathPayload.paths.length > 0) {
      activePaths = currentTeam.pathPayload.paths;
    } else {
      activePaths = [
        {
          id: "p_default",
          name: "Red Left Mogo Rush",
          pose: { x: -60, y: -60, theta: 0 },
          actions: [
            { id: "a_1", type: "moveToPoint", x: -24, y: -24, timeout: 2000, maxSpeed: 115, earlyExitRange: 2, comment: "Rush alliance goal" },
            { id: "a_2", type: "moveToPose", x: 0, y: 48, theta: 90, timeout: 2500, lead: 0.6, comment: "Score preload in corner" }
          ]
        }
      ];
    }

    renderRoutinesSelector();
    renderMemberList();
    renderStrategies();
    renderPinComments();
    renderActionBlocks();
    renderVersionHistory();
    renderPresenceAvatars();
    drawField();
    updateOwnerControlsVisibility();

    // Start Live 5-Minute Rolling OTP ticker in ribbon
    if (currentTeam.otpInfo) {
      setupTeamOtpTicker(currentTeam.otpInfo);
    } else if (currentTeam.teamId && currentUser && currentUser.email) {
      fetch(`/api/team/otp?teamId=${encodeURIComponent(currentTeam.teamId)}&email=${encodeURIComponent(currentUser.email)}`)
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            currentTeam.otpInfo = data;
            setupTeamOtpTicker(data);
          }
        })
        .catch(() => {});
    }

    // Start SSE stream and presence heartbeats
    connectSSE();
    startPresenceHeartbeat();
  }

  function connectSSE() {
    if (sseEventSource) {
      try { sseEventSource.close(); } catch (_) {}
    }

    if (!currentTeam || !currentTeam.teamId) return;

    try {
      sseEventSource = new EventSource(`/api/team/events?teamId=${encodeURIComponent(currentTeam.teamId)}&email=${encodeURIComponent(currentUser.email)}`);

      sseEventSource.addEventListener("connected", (e) => {
        const data = JSON.parse(e.data);
        updateConnStatus(true, "Connected · Sub-50ms Live Sync");
        if (data.activeMembers) {
          renderPresenceAvatars(data.activeMembers);
        }
      });

      sseEventSource.addEventListener("presence", (e) => {
        const data = JSON.parse(e.data);
        if (data.activeMembers) {
          renderPresenceAvatars(data.activeMembers);
          renderTeammateCursors(data.activeMembers);
        }
      });

      sseEventSource.addEventListener("sync", (e) => {
        const data = JSON.parse(e.data);
        if (data.pathPayload && data.pathPayload.paths) {
          activePaths = data.pathPayload.paths;
          renderRoutinesSelector(false);
          renderActionBlocks();
          drawField();
          showToast(`⚡ ${data.authorName} (${data.authorRole}): ${data.changeSummary}`, "🔄");
        }
        // Refresh version history count
        refreshTeamDataSilently();
      });

      sseEventSource.addEventListener("comment_update", (e) => {
        const data = JSON.parse(e.data);
        if (data.comments) {
          currentTeam.comments = data.comments;
          renderPinComments();
          drawField();
          if (data.newComment && data.newComment.authorEmail !== currentUser.email.toLowerCase()) {
            showToast(`📍 New comment from ${data.newComment.authorName}: "${data.newComment.text.slice(0, 30)}..."`, "💬");
          }
        }
      });

      sseEventSource.addEventListener("strategy_update", (e) => {
        const data = JSON.parse(e.data);
        if (data.strategies) {
          currentTeam.strategies = data.strategies;
          renderStrategies();
        }
      });

      sseEventSource.addEventListener("member_joined", (e) => {
        const data = JSON.parse(e.data);
        if (data.member) {
          showToast(`🎉 ${data.member.displayName} joined the team as ${data.member.role}!`, "👥");
          refreshTeamDataSilently();
        }
      });

      sseEventSource.addEventListener("member_left", (e) => {
        showToast("A team member updated their status", "ℹ️");
        refreshTeamDataSilently();
      });

      sseEventSource.onerror = () => {
        updateConnStatus(false, "Reconnecting...");
      };
    } catch (err) {
      console.warn("SSE connection error, falling back to polling:", err);
      updateConnStatus(true, "Polling Sync Active");
    }
  }

  function updateConnStatus(connected, text) {
    const pill = document.getElementById("connStatusPill");
    const lbl = document.getElementById("connStatusText");
    if (!pill || !lbl) return;
    lbl.textContent = text;
    if (connected) {
      pill.style.background = "rgba(34,197,94,0.1)";
      pill.style.borderColor = "rgba(34,197,94,0.3)";
      pill.style.color = "#4ade80";
    } else {
      pill.style.background = "rgba(239,68,68,0.1)";
      pill.style.borderColor = "rgba(239,68,68,0.3)";
      pill.style.color = "#f87171";
    }
  }

  async function refreshTeamDataSilently() {
    if (!currentTeam || !currentTeam.teamId) return;
    try {
      const res = await fetch(`/api/team/data?teamId=${encodeURIComponent(currentTeam.teamId)}`);
      const data = await res.json();
      if (data.success && data.team) {
        currentTeam = data.team;
        renderMemberList();
        renderStrategies();
        renderPinComments();
        renderVersionHistory();
      }
    } catch (_) {}
  }

  function startPresenceHeartbeat() {
    // Send periodic presence update every 7 seconds
    setInterval(() => {
      sendPresence();
    }, 7000);
  }

  function sendPresence(cursor = null) {
    if (!currentTeam || !currentUser || !currentUser.email) return;
    fetch("/api/team/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: currentTeam.teamId,
        email: currentUser.email,
        displayName: currentUser.displayName || currentUser.email.split("@")[0],
        role: currentUser.role || "Programmer",
        cursor,
        activeWaypoint: draggedWaypointIndex >= 0 ? draggedWaypointIndex : null,
        activeRoutine: activePaths[activeRoutineIndex]?.name || null
      })
    }).catch(() => {});
  }

  // --------------------------------------------------------------------------
  // REAL-TIME SYNC BROADCASTING FOR EDITS
  // --------------------------------------------------------------------------
  async function broadcastEdit(summary, editType = "waypoint_edit", createSnapshot = true) {
    if (!currentTeam || !currentUser) return;
    try {
      const payload = {
        teamId: currentTeam.teamId,
        email: currentUser.email,
        authorName: currentUser.displayName || currentUser.email.split("@")[0],
        authorRole: currentUser.role || "Programmer",
        editType,
        changeSummary: summary,
        pathPayload: { paths: activePaths },
        createSnapshot
      };

      const res = await fetch("/api/team/sync-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        refreshTeamDataSilently();
      }
    } catch (err) {
      console.error("Failed to broadcast edit:", err);
    }
  }

  // --------------------------------------------------------------------------
  // FIELD CANVAS RENDERING & COLLABORATOR CURSORS
  // --------------------------------------------------------------------------
  function inchToPx(inchCoord, canvasDim) {
    // Coordinates: [-72, 72] -> [0, canvasDim]
    return ((inchCoord + FIELD_HALF) / FIELD_INCHES) * canvasDim;
  }

  function pxToInch(pxCoord, canvasDim) {
    // [0, canvasDim] -> [-72, 72]
    return ((pxCoord / canvasDim) * FIELD_INCHES) - FIELD_HALF;
  }

  function drawField() {
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw Field Foam Tiles (6x6 Grid = 36 tiles)
    const tileSize = w / 6;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? "#111827" : "#0f172a";
        ctx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 1;
        ctx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }

    // 2. Draw Field Center & Tape Lines
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Horizontal center
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    // Vertical center
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    // 3. Draw Alliance Starting Zones (Override 2026-27 field)
    ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
    ctx.fillRect(0, 0, tileSize * 2, tileSize * 2);
    ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
    ctx.fillRect(w - tileSize * 2, h - tileSize * 2, tileSize * 2, tileSize * 2);

    // Current Routine
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    if (!routine) return;

    const startPose = routine.pose || { x: -60, y: -60, theta: 0 };
    const sx = inchToPx(startPose.x, w);
    const sy = inchToPx(startPose.y, h);

    // Draw Trajectory Spline Path
    const waypoints = [{ x: startPose.x, y: startPose.y, theta: startPose.theta, type: "start" }];
    (routine.actions || []).forEach((act) => {
      if (act.x !== undefined && act.y !== undefined) {
        waypoints.push({ ...act });
      }
    });

    if (waypoints.length > 1) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(inchToPx(waypoints[0].x, w), inchToPx(waypoints[0].y, h));
      for (let i = 1; i < waypoints.length; i++) {
        ctx.lineTo(inchToPx(waypoints[i].x, w), inchToPx(waypoints[i].y, h));
      }
      ctx.stroke();
    }

    // Draw Waypoint Points & Actions
    waypoints.forEach((wp, idx) => {
      const wx = inchToPx(wp.x, w);
      const wy = inchToPx(wp.y, h);

      if (idx === 0) {
        // Start Pose Robot Box
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(((wp.theta || 0) * Math.PI) / 180);
        ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.fillRect(-14, -14, 28, 28);
        ctx.strokeRect(-14, -14, 28, 28);
        // Heading pointer
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(6, -12);
        ctx.lineTo(-6, -12);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Label
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText("START", wx + 16, wy + 4);
      } else {
        // Waypoint Circle
        const isSelected = selectedActionId === wp.id;
        ctx.fillStyle = isSelected ? "#f59e0b" : "#0284c7";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.beginPath();
        ctx.arc(wx, wy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Action Number inside circle
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(idx), wx, wy);

        // Action Type Label
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(wp.type || "Move", wx + 12, wy - 4);
      }
    });

    // Render Field Pin Markers
    renderCanvasPinMarkers(w, h);
  }

  function renderCanvasPinMarkers(w, h) {
    if (!pinsLayer) return;
    pinsLayer.innerHTML = "";
    if (!currentTeam || !currentTeam.comments) return;

    currentTeam.comments.forEach((cmt, idx) => {
      const px = inchToPx(cmt.x, w);
      const py = inchToPx(cmt.y, h);

      const marker = document.createElement("div");
      marker.className = "field-pin-marker";
      marker.style.left = `${px}px`;
      marker.style.top = `${py}px`;
      marker.style.pointerEvents = "auto";
      marker.title = `${cmt.authorName} (${cmt.authorRole}): ${cmt.text}`;

      marker.innerHTML = `
        <div class="pin-bubble ${cmt.resolved ? 'resolved' : ''}" style="${cmt.authorColor ? `background:${cmt.authorColor};` : ''}">
          <span>${idx + 1}</span>
        </div>
      `;

      marker.onclick = (e) => {
        e.stopPropagation();
        openCommentPopover(cmt, px, py);
      };

      pinsLayer.appendChild(marker);
    });
  }

  function renderTeammateCursors(members) {
    if (!cursorsLayer) return;
    cursorsLayer.innerHTML = "";

    const userEmailNorm = (currentUser?.email || "").toLowerCase();
    members.forEach((m) => {
      if (m.email.toLowerCase() === userEmailNorm) return;
      if (!m.cursor || m.cursor.canvasX === undefined) return;

      const cursorEl = document.createElement("div");
      cursorEl.className = "teammate-cursor";
      cursorEl.style.left = `${m.cursor.canvasX}px`;
      cursorEl.style.top = `${m.cursor.canvasY}px`;

      const color = m.color || getRoleColor(m.role);
      const emoji = getRoleEmoji(m.role);

      cursorEl.innerHTML = `
        <svg class="cursor-pointer-svg" viewBox="0 0 24 24" fill="${color}">
          <path d="M5.5 3.2L18.8 12.4C19.5 12.9 19.3 14 18.4 14.2L12.5 15.3L9.2 20.8C8.7 21.6 7.5 21.5 7.2 20.6L3.3 4.8C3.1 3.9 4.1 3.1 5.5 3.2Z" />
        </svg>
        <span class="cursor-label" style="background:${color};">
          ${emoji} ${m.displayName} (${m.role})
        </span>
      `;
      cursorsLayer.appendChild(cursorEl);
    });
  }

  // --------------------------------------------------------------------------
  // CANVAS MOUSE & TOUCH INTERACTIONS
  // --------------------------------------------------------------------------
  function initCanvasInteractions() {
    if (!canvas) return;

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const ix = pxToInch(cx, canvas.width);
      const iy = pxToInch(cy, canvas.height);

      const coordLbl = document.getElementById("lblCursorCoords");
      if (coordLbl) {
        coordLbl.textContent = `X: ${ix.toFixed(1)}" | Y: ${iy.toFixed(1)}" | θ: 0.0°`;
      }

      // Throttled cursor broadcast to teammates (every 60ms)
      const now = Date.now();
      if (now - lastCursorBroadcast > 60) {
        lastCursorBroadcast = now;
        sendPresence({ canvasX: cx, canvasY: cy, x: ix, y: iy });
      }

      // Handle dragging active waypoint
      if (isDraggingWaypoint && draggedWaypointIndex >= 0) {
        const routine = activePaths[activeRoutineIndex];
        if (routine) {
          if (draggedWaypointIndex === 0) {
            routine.pose.x = Math.round(ix * 10) / 10;
            routine.pose.y = Math.round(iy * 10) / 10;
          } else {
            const act = routine.actions[draggedWaypointIndex - 1];
            if (act) {
              act.x = Math.round(ix * 10) / 10;
              act.y = Math.round(iy * 10) / 10;
            }
          }
          drawField();
          renderActionBlocks();
        }
      }
    });

    canvas.addEventListener("mousedown", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const ix = pxToInch(cx, canvas.width);
      const iy = pxToInch(cy, canvas.height);

      // Handle Pin Comment Drop Mode
      if (isPinDropMode) {
        isPinDropMode = false;
        togglePinModeUI(false);
        promptAddPinComment(ix, iy);
        return;
      }

      // Check hit on existing waypoints
      const routine = activePaths[activeRoutineIndex];
      if (!routine) return;

      const waypoints = [{ x: routine.pose.x, y: routine.pose.y, id: "start" }, ...(routine.actions || [])];
      for (let i = 0; i < waypoints.length; i++) {
        const wx = inchToPx(waypoints[i].x, canvas.width);
        const wy = inchToPx(waypoints[i].y, canvas.height);
        const dist = Math.hypot(cx - wx, cy - wy);
        if (dist <= 14) {
          isDraggingWaypoint = true;
          draggedWaypointIndex = i;
          selectedActionId = waypoints[i].id;
          renderActionBlocks();
          drawField();
          return;
        }
      }
    });

    window.addEventListener("mouseup", () => {
      if (isDraggingWaypoint) {
        isDraggingWaypoint = false;
        const routine = activePaths[activeRoutineIndex];
        const wp = draggedWaypointIndex === 0 ? routine.pose : routine.actions[draggedWaypointIndex - 1];
        draggedWaypointIndex = -1;
        // Broadcast change with full snapshot to team!
        broadcastEdit(`Moved waypoint to (${wp.x.toFixed(1)}", ${wp.y.toFixed(1)}")`, "waypoint_move", true);
      }
    });
  }

  // --------------------------------------------------------------------------
  // FIELD PIN COMMENTS LOGIC
  // --------------------------------------------------------------------------
  function togglePinModeUI(active) {
    isPinDropMode = active;
    const btn = document.getElementById("btnTogglePinTool");
    const centerBtn = document.getElementById("btnCenterCanvasPinTool");
    if (btn) {
      btn.style.background = active ? "#ef4444" : "#f59e0b";
      btn.textContent = active ? "✕ Cancel Pin" : "+ Drop Pin";
    }
    if (centerBtn) {
      centerBtn.style.background = active ? "#ef4444" : "#1e293b";
      centerBtn.style.color = active ? "#fff" : "#cbd5e1";
    }
    if (canvas) {
      canvas.style.cursor = active ? "crosshair" : "default";
    }
  }

  function promptAddPinComment(x, y) {
    const text = prompt(`Drop Strategy Comment at (${x.toFixed(1)}", ${y.toFixed(1)}"):\ne.g. "Watch for center mogo rush collision; delay intake 300ms"`);
    if (!text || text.trim() === "") return;

    fetch("/api/team/comment/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: currentTeam.teamId,
        email: currentUser.email,
        authorName: currentUser.displayName || currentUser.email.split("@")[0],
        authorRole: currentUser.role || "Coach",
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        text: text.trim()
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        currentTeam.comments = data.comments;
        renderPinComments();
        drawField();
        showToast("📍 Field pin comment added", "💬");
      }
    });
  }

  function openCommentPopover(cmt, px, py) {
    // Remove existing popovers
    const existing = document.querySelector(".comment-popover");
    if (existing) existing.remove();

    const pop = document.createElement("div");
    pop.className = "comment-popover";
    pop.style.left = `${Math.min(window.innerWidth - 300, px + 10)}px`;
    pop.style.top = `${Math.min(window.innerHeight - 300, py + 10)}px`;

    const repliesHtml = (cmt.replies || []).map(r => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid #1e293b;border-radius:6px;padding:6px 8px;margin-top:6px;">
        <strong style="color:#38bdf8;">${escapeHtml(r.authorName)} (${escapeHtml(r.authorRole || 'Member')}):</strong>
        <div style="color:#e2e8f0;margin-top:2px;">${escapeHtml(r.text)}</div>
      </div>
    `).join("");

    pop.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-weight:700;color:${cmt.authorColor || '#38bdf8'};">
          ${getRoleEmoji(cmt.authorRole)} ${escapeHtml(cmt.authorName)} (${escapeHtml(cmt.authorRole)})
        </span>
        <button type="button" class="btn-xs-clean" id="btnCloseCommentPop" style="color:#94a3b8;background:none;border:none;cursor:pointer;">✕</button>
      </div>
      <div style="color:#f8fafc;font-size:0.85rem;line-height:1.4;margin-bottom:10px;">
        ${escapeHtml(cmt.text)}
      </div>
      <div style="font-size:0.7rem;color:#64748b;margin-bottom:8px;">
        At field coordinates (${cmt.x.toFixed(1)}", ${cmt.y.toFixed(1)}")
      </div>

      <div style="max-height:120px;overflow-y:auto;margin-bottom:8px;">
        ${repliesHtml}
      </div>

      <div style="display:flex;gap:4px;margin-bottom:8px;">
        <input type="text" id="inputCommentReply" class="form-input" placeholder="Type reply..." style="padding:4px 8px;font-size:0.75rem;" />
        <button type="button" id="btnSendReply" class="btn-team-primary" style="padding:4px 8px;font-size:0.75rem;">Reply</button>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid #1e293b;padding-top:6px;">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:0.72rem;color:#94a3b8;">
          <input type="checkbox" id="chkResolveComment" ${cmt.resolved ? 'checked' : ''} />
          <span>Mark as Resolved</span>
        </label>
        <button type="button" id="btnDeleteComment" style="color:#ef4444;background:none;border:none;cursor:pointer;font-size:0.72rem;">Delete</button>
      </div>
    `;

    document.body.appendChild(pop);

    pop.querySelector("#btnCloseCommentPop").onclick = () => pop.remove();

    pop.querySelector("#btnSendReply").onclick = () => {
      const repInput = pop.querySelector("#inputCommentReply");
      const text = repInput ? repInput.value.trim() : "";
      if (!text) return;
      fetch("/api/team/comment/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentTeam.teamId,
          commentId: cmt.id,
          email: currentUser.email,
          authorName: currentUser.displayName || currentUser.email.split("@")[0],
          authorRole: currentUser.role || "Programmer",
          text
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          currentTeam.comments = data.comments;
          pop.remove();
          renderPinComments();
        }
      });
    };

    pop.querySelector("#chkResolveComment").onchange = (e) => {
      fetch("/api/team/comment/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentTeam.teamId,
          commentId: cmt.id,
          resolved: e.target.checked
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          currentTeam.comments = data.comments;
          pop.remove();
          renderPinComments();
          drawField();
        }
      });
    };

    pop.querySelector("#btnDeleteComment").onclick = () => {
      if (confirm("Delete this field pin comment?")) {
        fetch("/api/team/comment/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: currentTeam.teamId,
            commentId: cmt.id
          })
        })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            currentTeam.comments = data.comments;
            pop.remove();
            renderPinComments();
            drawField();
          }
        });
      }
    };
  }

  function renderPinComments() {
    const list = document.getElementById("pinCommentsList");
    if (!list) return;
    list.innerHTML = "";

    const comments = currentTeam?.comments || [];
    if (comments.length === 0) {
      list.innerHTML = `<div style="font-size:0.75rem;color:#64748b;padding:8px 0;">No comments on field yet. Click <strong>+ Drop Pin</strong> to drop a strategy marker.</div>`;
      return;
    }

    comments.forEach((cmt, idx) => {
      const item = document.createElement("div");
      item.className = "member-list-item";
      item.style.cursor = "pointer";
      item.innerHTML = `
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
            <span style="font-weight:700;color:${cmt.authorColor || '#38bdf8'};font-size:0.75rem;">
              📍 #${idx + 1} ${escapeHtml(cmt.authorName)} (${escapeHtml(cmt.authorRole)})
            </span>
            ${cmt.resolved ? '<span style="color:#64748b;font-size:0.65rem;">[RESOLVED]</span>' : ''}
          </div>
          <div style="color:#cbd5e1;font-size:0.75rem;line-height:1.3;">${escapeHtml(cmt.text)}</div>
        </div>
      `;
      item.onclick = () => {
        const wx = inchToPx(cmt.x, canvas.width);
        const wy = inchToPx(cmt.y, canvas.height);
        openCommentPopover(cmt, wx, wy);
      };
      list.appendChild(item);
    });
  }

  // --------------------------------------------------------------------------
  // STRATEGY CONSENSUS & VOTING
  // --------------------------------------------------------------------------
  function renderStrategies() {
    const list = document.getElementById("strategyCardsList");
    if (!list) return;
    list.innerHTML = "";

    const strategies = currentTeam?.strategies || [];
    if (strategies.length === 0) {
      list.innerHTML = `<div style="font-size:0.75rem;color:#64748b;padding:8px 0;">No match strategies proposed yet. Click <strong>+ Propose</strong> to draft one.</div>`;
      return;
    }

    const userEmailNorm = (currentUser?.email || "").toLowerCase();

    strategies.forEach((strat) => {
      const votes = strat.votes || {};
      const rocketCount = Object.values(votes).filter(v => v === "rocket").length;
      const yesCount = Object.values(votes).filter(v => v === "yes").length;
      const myVote = votes[userEmailNorm];

      const card = document.createElement("div");
      card.className = `strategy-card ${rocketCount + yesCount >= 2 ? 'approved' : ''}`;
      card.innerHTML = `
        <div class="strategy-header">
          <span class="strategy-title">${escapeHtml(strat.title)}</span>
          ${rocketCount + yesCount >= 2 ? '<span style="font-size:0.65rem;background:#16a34a;color:#fff;padding:1px 6px;border-radius:10px;font-weight:700;">APPROVED</span>' : ''}
        </div>
        <div class="strategy-desc">${escapeHtml(strat.description || '')}</div>
        <div class="strategy-vote-row">
          <button type="button" class="btn-vote-pill ${myVote === 'rocket' ? 'active' : ''}" data-vote="rocket">
            🚀 Ready (${rocketCount})
          </button>
          <button type="button" class="btn-vote-pill ${myVote === 'yes' ? 'active' : ''}" data-vote="yes">
            👍 Agree (${yesCount})
          </button>
          <span style="font-size:0.68rem;color:#64748b;margin-left:auto;">By ${escapeHtml(strat.authorName)}</span>
        </div>
      `;

      card.querySelectorAll(".btn-vote-pill").forEach(btn => {
        btn.onclick = () => {
          const v = btn.dataset.vote;
          castStrategyVote(strat.id, v);
        };
      });

      list.appendChild(card);
    });
  }

  function castStrategyVote(strategyId, vote) {
    if (!currentTeam || !currentUser) return;
    fetch("/api/team/strategy/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: currentTeam.teamId,
        strategyId,
        email: currentUser.email,
        vote
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        currentTeam.strategies = data.strategies;
        renderStrategies();
      }
    });
  }

  // --------------------------------------------------------------------------
  // ACTION BLOCKS FLOW (RIGHT PANEL TAB 1)
  // --------------------------------------------------------------------------
  function renderActionBlocks() {
    const container = document.getElementById("actionsListContainer");
    const countBadge = document.getElementById("badgeActionsCount");
    const totalCountEl = document.getElementById("lblTotalActionsCount");
    if (!container) return;

    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    const actions = (routine && routine.actions) || [];

    if (countBadge) countBadge.textContent = String(actions.length);
    if (totalCountEl) totalCountEl.textContent = String(actions.length);

    container.innerHTML = "";

    // Start Pose Card
    const startCard = document.createElement("div");
    startCard.className = `action-block-card ${selectedActionId === 'start' ? 'selected' : ''}`;
    startCard.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="action-num-badge" style="background:#0284c7;color:#fff;">S</span>
        <div>
          <strong style="font-size:0.8rem;color:#f8fafc;">Start Pose (Odometry Origin)</strong>
          <div style="font-size:0.72rem;color:#94a3b8;">X: ${routine.pose.x.toFixed(1)}", Y: ${routine.pose.y.toFixed(1)}", θ: ${routine.pose.theta.toFixed(1)}°</div>
        </div>
      </div>
    `;
    startCard.onclick = () => {
      selectedActionId = 'start';
      renderActionBlocks();
      drawField();
    };
    container.appendChild(startCard);

    if (actions.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.style.padding = "16px";
      emptyMsg.style.textAlign = "center";
      emptyMsg.style.color = "#64748b";
      emptyMsg.style.fontSize = "0.78rem";
      emptyMsg.textContent = "No actions yet. Click '+ MovePoint' or '+ MovePose' above to add waypoints.";
      container.appendChild(emptyMsg);
      return;
    }

    actions.forEach((act, idx) => {
      const card = document.createElement("div");
      card.className = `action-block-card ${selectedActionId === act.id ? 'selected' : ''}`;

      let paramSummary = `Timeout: ${act.timeout || 2000}ms`;
      if (act.x !== undefined && act.y !== undefined) {
        paramSummary = `(${act.x.toFixed(1)}", ${act.y.toFixed(1)}") · ${act.timeout || 2000}ms`;
      }

      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex:1;">
          <span class="action-num-badge">${idx + 1}</span>
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:6px;">
              <strong style="font-size:0.82rem;color:#f8fafc;">chassis.${escapeHtml(act.type)}</strong>
              ${act.comment ? `<span style="font-size:0.68rem;color:#f59e0b;">// ${escapeHtml(act.comment)}</span>` : ''}
            </div>
            <div style="font-size:0.72rem;color:#94a3b8;">${paramSummary}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <button type="button" class="btn-xs-clean btn-del-act" style="color:#ef4444;background:none;border:none;cursor:pointer;padding:4px;" title="Delete action">🗑️</button>
        </div>
      `;

      card.onclick = () => {
        selectedActionId = act.id;
        renderActionBlocks();
        drawField();
      };

      card.querySelector(".btn-del-act").onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Delete action #${idx + 1} (${act.type})?`)) {
          routine.actions.splice(idx, 1);
          renderActionBlocks();
          drawField();
          broadcastEdit(`Deleted action #${idx + 1} (${act.type})`, "action_delete", true);
        }
      };

      container.appendChild(card);
    });
  }

  function addAction(type) {
    const routine = activePaths[activeRoutineIndex];
    if (!routine) return;
    if (!routine.actions) routine.actions = [];

    const last = routine.actions[routine.actions.length - 1] || routine.pose;
    const newX = Math.round((last.x + 12) * 10) / 10;
    const newY = Math.round((last.y + 12) * 10) / 10;

    const newAct = {
      id: "a_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 5),
      type,
      x: Math.min(65, Math.max(-65, newX)),
      y: Math.min(65, Math.max(-65, newY)),
      theta: 90,
      timeout: type === "moveToPose" ? 2500 : 2000,
      maxSpeed: 115,
      earlyExitRange: 2,
      forwards: true,
      comment: ""
    };

    routine.actions.push(newAct);
    selectedActionId = newAct.id;
    renderActionBlocks();
    drawField();
    broadcastEdit(`Added action ${type} at (${newAct.x}", ${newAct.y}")`, "action_add", true);
  }

  // --------------------------------------------------------------------------
  // TEAM VERSION HISTORY (UP TO 500 ENTRIES WITH AUTHOR ATTRIBUTION)
  // --------------------------------------------------------------------------
  function renderVersionHistory() {
    const container = document.getElementById("teamVersionsList");
    const badge = document.getElementById("badgeVersionsCount");
    if (!container) return;

    const versions = currentTeam?.versionHistory || [];
    if (badge) badge.textContent = `${versions.length} / 500`;

    container.innerHTML = "";

    const filterInput = document.getElementById("inputFilterVersions");
    const filterQuery = (filterInput ? filterInput.value.toLowerCase().trim() : "");

    const filtered = versions.filter(v => {
      if (!filterQuery) return true;
      return (
        (v.authorName && v.authorName.toLowerCase().includes(filterQuery)) ||
        (v.authorEmail && v.authorEmail.toLowerCase().includes(filterQuery)) ||
        (v.actionSummary && v.actionSummary.toLowerCase().includes(filterQuery)) ||
        (v.editType && v.editType.toLowerCase().includes(filterQuery))
      );
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:16px;text-align:center;color:#64748b;font-size:0.8rem;">No version history snapshots found.</div>`;
      return;
    }

    filtered.forEach((ver) => {
      const card = document.createElement("div");
      card.className = "version-item-card";

      const authorName = ver.authorName || (ver.authorEmail ? ver.authorEmail.split("@")[0] : "Teammate");
      const role = ver.authorRole || "Member";
      const color = ver.authorColor || getRoleColor(role);

      card.innerHTML = `
        <div class="version-top-row">
          <div class="version-author-tag" style="color:${color};">
            <span>👤</span>
            <strong>${escapeHtml(authorName)}</strong>
            <span style="background:${color}22;color:${color};padding:1px 5px;border-radius:4px;font-size:0.65rem;">${escapeHtml(role)}</span>
          </div>
          <span class="version-time-tag">${escapeHtml(ver.dateStr)}</span>
        </div>
        <div class="version-summary-text">${escapeHtml(ver.actionSummary || 'Updated autonomous routine')}</div>
        <div class="version-actions-strip">
          <button type="button" class="btn-team-secondary btn-inspect-ver" style="padding:3px 8px;font-size:0.72rem;">🔍 Inspect</button>
          <button type="button" class="btn-team-primary btn-restore-ver" style="padding:3px 8px;font-size:0.72rem;background:#16a34a;border-color:#22c55e;">⏮️ Restore</button>
        </div>
      `;

      card.querySelector(".btn-inspect-ver").onclick = () => {
        openInspectModal(ver);
      };

      card.querySelector(".btn-restore-ver").onclick = () => {
        restoreVersionPrompt(ver);
      };

      container.appendChild(card);
    });
  }

  function openInspectModal(ver) {
    selectedVersionForRestore = ver;
    const modal = document.getElementById("modalVersionInspect");
    const title = document.getElementById("lblInspectVersionTitle");
    const meta = document.getElementById("lblInspectVersionMeta");
    const attributionBox = document.getElementById("inspectAuthorAttributionBox");
    const codeView = document.getElementById("inspectCodeView");

    if (!modal) return;

    if (title) title.textContent = ver.actionSummary || "Version Snapshot";
    if (meta) meta.textContent = `Recorded ${ver.dateStr}`;

    if (attributionBox) {
      attributionBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="color:${ver.authorColor || '#38bdf8'};font-weight:700;font-size:0.85rem;">
            👤 ${escapeHtml(ver.authorName || ver.authorEmail)} (${escapeHtml(ver.authorRole || 'Programmer')})
          </span>
          <span style="color:#64748b;font-size:0.7rem;">&lt;${escapeHtml(ver.authorEmail)}&gt;</span>
        </div>
        <div style="color:#e2e8f0;">${escapeHtml(ver.actionSummary)}</div>
      `;
    }

    if (codeView) {
      if (ver.snapshot) {
        codeView.textContent = JSON.stringify(ver.snapshot, null, 2);
      } else {
        codeView.textContent = "// Snapshot metadata only";
      }
    }

    modal.style.display = "flex";
  }

  function restoreVersionPrompt(ver) {
    if (!ver || !ver.snapshot) {
      showToast("Cannot restore: snapshot payload not found", "⚠️");
      return;
    }

    if (confirm(`Restore version from ${ver.dateStr}?\n\nEdited by: ${ver.authorName} (${ver.authorRole})\nAction: ${ver.actionSummary}\n\nYour current state will be auto-backed up before restoring.`)) {
      fetch("/api/team/version/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentTeam.teamId,
          versionId: ver.id,
          email: currentUser.email,
          authorName: currentUser.displayName || currentUser.email.split("@")[0],
          authorRole: currentUser.role || "Programmer"
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.team) {
          currentTeam = data.team;
          if (currentTeam.pathPayload && currentTeam.pathPayload.paths) {
            activePaths = currentTeam.pathPayload.paths;
            renderRoutinesSelector(false);
            renderActionBlocks();
            drawField();
          }
          renderVersionHistory();
          showToast(`⏮️ Successfully restored version from ${ver.dateStr}!`, "✅");
          const inspectModal = document.getElementById("modalVersionInspect");
          if (inspectModal) inspectModal.style.display = "none";
        }
      });
    }
  }

  // --------------------------------------------------------------------------
  // ROSTER & PRESENCE AVATARS
  // --------------------------------------------------------------------------
  function renderMemberList() {
    const list = document.getElementById("teamMemberList");
    const countBadge = document.getElementById("memberCountBadge");
    if (!list) return;

    const members = currentTeam?.members || [];
    if (countBadge) countBadge.textContent = String(members.length);

    list.innerHTML = "";
    members.forEach((m) => {
      const item = document.createElement("div");
      item.className = "member-list-item";
      const roleColor = m.color || getRoleColor(m.role);
      const isOwner = Boolean(m.isOwner);

      item.innerHTML = `
        <div class="member-info">
          <div class="presence-avatar ${m.role.toLowerCase()}" style="border-color:${roleColor};width:24px;height:24px;font-size:0.65rem;">
            ${m.displayName ? m.displayName.charAt(0).toUpperCase() : 'U'}
          </div>
          <div>
            <div style="font-weight:700;color:#f8fafc;display:flex;align-items:center;gap:4px;">
              <span>${escapeHtml(m.displayName)}</span>
              ${isOwner ? '<span title="Team Owner">👑</span>' : ''}
            </div>
            <div style="font-size:0.68rem;color:#64748b;">${escapeHtml(m.email)}</div>
          </div>
        </div>
        <span class="member-role-tag ${m.role.toLowerCase()}">${escapeHtml(m.role)}</span>
      `;
      list.appendChild(item);
    });
  }

  function renderPresenceAvatars(activeList = null) {
    const wrap = document.getElementById("presenceAvatarsWrap");
    if (!wrap) return;

    wrap.innerHTML = "";
    const members = activeList || (currentTeam?.members || []);

    members.forEach((m) => {
      const av = document.createElement("div");
      av.className = `presence-avatar ${m.role ? m.role.toLowerCase() : 'programmer'}`;
      av.title = `${m.displayName} (${m.role || 'Member'}) · Online`;
      av.textContent = m.displayName ? m.displayName.charAt(0).toUpperCase() : 'U';
      av.innerHTML += `<span class="presence-pulse"></span>`;
      wrap.appendChild(av);
    });
  }

  function renderRoutinesSelector(triggerDraw = true) {
    const sel = document.getElementById("selTeamRoutine");
    const stratSel = document.getElementById("selStratRoutine");
    if (!sel) return;

    sel.innerHTML = "";
    if (stratSel) stratSel.innerHTML = "";

    activePaths.forEach((p, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = `${idx + 1}. ${p.name || `Routine ${idx + 1}`}`;
      if (idx === activeRoutineIndex) opt.selected = true;
      sel.appendChild(opt);

      if (stratSel) {
        const stratOpt = document.createElement("option");
        stratOpt.value = p.name || `Routine ${idx + 1}`;
        stratOpt.textContent = p.name || `Routine ${idx + 1}`;
        stratSel.appendChild(stratOpt);
      }
    });

    sel.onchange = () => {
      activeRoutineIndex = Number(sel.value) || 0;
      selectedActionId = null;
      renderActionBlocks();
      if (triggerDraw) drawField();
    };
  }

  // --------------------------------------------------------------------------
  // SIMULATION PLAYBACK
  // --------------------------------------------------------------------------
  function toggleSimPlay() {
    const btn = document.getElementById("btnSimPlay");
    if (isSimPlaying) {
      isSimPlaying = false;
      clearInterval(simTimer);
      if (btn) btn.textContent = "▶ Play 15s Sim";
    } else {
      isSimPlaying = true;
      if (btn) btn.textContent = "⏸ Pause Sim";
      const startSimTime = Date.now() - simTimeMs;
      simTimer = setInterval(() => {
        simTimeMs = Date.now() - startSimTime;
        if (simTimeMs >= 15000) {
          simTimeMs = 15000;
          isSimPlaying = false;
          clearInterval(simTimer);
          if (btn) btn.textContent = "▶ Play 15s Sim";
        }
        updateSimScrubber();
      }, 50);
    }
  }

  function updateSimScrubber() {
    const sc = document.getElementById("simScrubber");
    const lbl = document.getElementById("lblSimTime");
    if (sc) sc.value = simTimeMs;
    if (lbl) lbl.textContent = `${(simTimeMs / 1000).toFixed(2)}s / 15.00s`;
  }

  // --------------------------------------------------------------------------
  // EVENT WIRING & INIT
  // --------------------------------------------------------------------------
  function wireEvents() {
    initCanvasInteractions();

    // 1. Copy Team Code button
    const btnCopyCode = document.getElementById("btnCopyTeamCode");
    if (btnCopyCode) {
      btnCopyCode.onclick = () => {
        if (!currentTeam || !currentTeam.teamCode) return;
        navigator.clipboard.writeText(currentTeam.teamCode).then(() => {
          showToast(`📋 Copied Team Code: ${currentTeam.teamCode}`, "✅");
        }).catch(() => {
          showToast(`Team Code: ${currentTeam.teamCode}`, "📋");
        });
      };
    }

    // 1b. Copy Team Invite & Live 5-Minute OTP button
    const btnCopyOtp = document.getElementById("btnCopyTeamOtp");
    if (btnCopyOtp) {
      btnCopyOtp.onclick = () => {
        if (!currentTeam || !currentTeam.teamCode) return;
        const curOtp = currentTeam.otpInfo?.otp || document.getElementById("lblTeamOtp")?.textContent || "------";
        const curTimer = document.getElementById("lblTeamOtpTimer")?.textContent || "";
        const inviteText = `Join my VEX LemLib Team!\nTeam: ${currentTeam.teamName} (${currentTeam.vexTeamNumber || 'VEX'})\nTeam Code: ${currentTeam.teamCode}\nLive 5-Min Join OTP: ${curOtp} ${curTimer}\nJoin at: ${window.location.origin}/team.html`;
        navigator.clipboard.writeText(inviteText).then(() => {
          showToast(`📋 Copied Team Invite & live OTP (${curOtp})!`, "✅");
        }).catch(() => {
          prompt("Copy team invite with 5-minute OTP:", inviteText);
        });
      };
    }

    // 2. Gateway Create vs Join tab switching
    const tabGateCreate = document.getElementById("tabGateCreate");
    const tabGateJoin = document.getElementById("tabGateJoin");
    const paneGateCreate = document.getElementById("paneGateCreate");
    const paneGateJoin = document.getElementById("paneGateJoin");

    if (tabGateCreate && tabGateJoin) {
      tabGateCreate.onclick = () => {
        tabGateCreate.style.background = "rgba(56,189,248,0.12)";
        tabGateCreate.style.color = "#38bdf8";
        tabGateCreate.style.borderBottom = "2px solid #38bdf8";
        tabGateJoin.style.background = "transparent";
        tabGateJoin.style.color = "#94a3b8";
        tabGateJoin.style.borderBottom = "2px solid transparent";
        if (paneGateCreate) paneGateCreate.style.display = "block";
        if (paneGateJoin) paneGateJoin.style.display = "none";
      };

      tabGateJoin.onclick = () => {
        tabGateJoin.style.background = "rgba(56,189,248,0.12)";
        tabGateJoin.style.color = "#38bdf8";
        tabGateJoin.style.borderBottom = "2px solid #38bdf8";
        tabGateCreate.style.background = "transparent";
        tabGateCreate.style.color = "#94a3b8";
        tabGateCreate.style.borderBottom = "2px solid transparent";
        if (paneGateJoin) paneGateJoin.style.display = "block";
        if (paneGateCreate) paneGateCreate.style.display = "none";
        loadAvailableTeams();
      };
    }

    const btnRefresh = document.getElementById("btnRefreshAvailableTeams");
    if (btnRefresh) {
      btnRefresh.onclick = () => {
        loadAvailableTeams();
        showToast("Refreshed available teams list", "🔄");
      };
    }

    function showJoinAlert(msg, isError = true, extraHtml = "") {
      const box = document.getElementById("joinAlertBox");
      if (!box) return;
      box.style.display = "block";
      box.style.background = isError ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)";
      box.style.border = isError ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(34,197,94,0.4)";
      box.style.color = isError ? "#fca5a5" : "#86efac";
      box.innerHTML = `<div>${(isError ? "⚠️ " : "✅ ") + escapeHtml(msg)}</div>${extraHtml || ""}`;
      try { box.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}
    }

    function showCreateAlert(msg, isError = true, extraHtml = "") {
      const box = document.getElementById("createAlertBox");
      if (!box) return;
      box.style.display = "block";
      box.style.background = isError ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)";
      box.style.border = isError ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(34,197,94,0.4)";
      box.style.color = isError ? "#fca5a5" : "#86efac";
      box.innerHTML = `<div>${(isError ? "⚠️ " : "✅ ") + escapeHtml(msg)}</div>${extraHtml || ""}`;
      try { box.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}
    }

    function finalizeTeamLoaded(teamObj, toastMsg) {
      currentTeam = teamObj;
      currentTeam.otpInfo = getTeamOtpInfo(currentTeam);
      const gate = document.getElementById("modalTeamGate");
      if (gate) gate.style.display = "none";
      const setupView = document.getElementById("teamSetupJoinView");
      if (setupView) setupView.style.display = "none";
      const wsView = document.getElementById("teamWorkspaceView");
      if (wsView) wsView.style.display = "flex";
      showToast(toastMsg || `Team "${teamObj.teamName}" loaded!`, "🎉");
      onTeamLoaded();
    }

    // 3. Create Team submit & Initial Source Radio wiring
    const radioSourceGroup = document.querySelectorAll('input[name="initProjectSource"]');
    const gateGithubFields = document.getElementById("gateGithubFields");
    const lblGatePlannerPreview = document.getElementById("lblGatePlannerPreview");

    // Preview local planner info on gate load
    try {
      const local = getLocalPlannerPayload();
      if (local && local.paths && local.paths.length > 0) {
        if (lblGatePlannerPreview) {
          lblGatePlannerPreview.textContent = `Found ${local.paths.length} local routine${local.paths.length === 1 ? '' : 's'} (${local.paths.map(p => p.name).slice(0, 2).join(', ')}${local.paths.length > 2 ? '...' : ''})`;
        }
      }
    } catch (_) {}

    radioSourceGroup.forEach(radio => {
      radio.addEventListener("change", () => {
        if (gateGithubFields) {
          gateGithubFields.style.display = radio.value === "github" && radio.checked ? "block" : "none";
        }
      });
    });

    const btnSubmitCreate = document.getElementById("btnSubmitCreateTeam");
    if (btnSubmitCreate) {
      btnSubmitCreate.onclick = async () => {
        try {
          const emailInput = document.getElementById("txtUserAccountEmail");
          const emailVal = (emailInput && emailInput.value.trim()) || currentUser?.email || localStorage.getItem("lemlib_saved_google_email") || "rainforest.cck3@gmail.com";
          if (!emailVal || !emailVal.includes("@")) {
            showCreateAlert("Please enter a valid Gmail address above.");
            if (emailInput) {
              emailInput.focus();
              emailInput.style.borderColor = "#ef4444";
            }
            return;
          }
          if (emailInput) emailInput.style.borderColor = "#334155";

          currentUser = {
            email: emailVal.toLowerCase(),
            displayName: (currentUser && currentUser.displayName) || emailVal.split("@")[0],
            uid: (currentUser && currentUser.uid) || "user_" + emailVal.replace(/[^a-z0-9]/g, "_"),
            photoURL: (currentUser && currentUser.photoURL) || ""
          };
          localStorage.setItem("lemlib_saved_google_email", currentUser.email);
          localStorage.setItem("lemlib_saved_google_user", JSON.stringify(currentUser));

          const name = document.getElementById("txtNewTeamName")?.value.trim() || "VEX High Stakes Team";
          const vexNum = document.getElementById("txtNewVexNumber")?.value.trim() || "99999X";
          const role = document.getElementById("selNewRole")?.value || "Programmer";
          const selectedSource = document.querySelector('input[name="initProjectSource"]:checked')?.value || "template";

          let pathsData = null;
          let projectData = null;
          let repoInfo = null;

          btnSubmitCreate.disabled = true;

          if (selectedSource === "planner") {
            btnSubmitCreate.textContent = "Importing Planner Routines...";
            const local = getLocalPlannerPayload();
            if (local.paths && local.paths.length > 0) {
              pathsData = { paths: local.paths };
            }
            projectData = local.project;
          } else if (selectedSource === "github") {
            const repoVal = document.getElementById("txtGateGithubRepo")?.value.trim();
            const branchVal = document.getElementById("txtGateGithubBranch")?.value.trim();
            const tokenVal = document.getElementById("txtGateGithubToken")?.value.trim();

            if (!repoVal) {
              showCreateAlert("Please enter a GitHub repository (e.g. LemLib/LemLib or full URL)");
              btnSubmitCreate.disabled = false;
              return;
            }
            if (tokenVal) localStorage.setItem("github_pat_token", tokenVal);

            btnSubmitCreate.textContent = "Cloning GitHub Repository...";
            try {
              const cloneRes = await fetch(resolveApiUrl("/api/github/clone") || "/api/github/clone", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo: repoVal, branch: branchVal, token: tokenVal })
              });
              const cloneData = await cloneRes.json();
              if (!cloneData.success || !cloneData.files) {
                throw new Error(cloneData.error || "Failed to clone GitHub repository");
              }
              const detectedPaths = parseGithubAutonFiles(cloneData.files, cloneData.repoName);
              pathsData = { paths: detectedPaths };
              projectData = { name: cloneData.repoName || repoVal, files: cloneData.files };
              repoInfo = { repo: repoVal, branch: cloneData.branch, fileCount: cloneData.fileCount };
            } catch (err) {
              btnSubmitCreate.disabled = false;
              btnSubmitCreate.textContent = "🚀 Create Team & Start Collaborating";
              showCreateAlert("GitHub clone failed: " + err.message);
              return;
            }
          }

          btnSubmitCreate.textContent = "Creating Team...";

          let teamCreated = null;
          const apiRoute = resolveApiUrl("/api/team/create");
          if (apiRoute) {
            const srvRes = await safeFetchJson(apiRoute, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: currentUser.email,
                displayName: currentUser.displayName,
                teamName: name,
                vexTeamNumber: vexNum,
                role,
                photoURL: currentUser.photoURL,
                pathsData,
                projectData,
                repoInfo
              })
            });

            if (srvRes.ok && srvRes.data?.success && srvRes.data?.team) {
              teamCreated = srvRes.data.team;
            } else if (!srvRes.ok && !srvRes.isHtml && srvRes.status !== 404 && srvRes.status !== 405) {
              btnSubmitCreate.disabled = false;
              btnSubmitCreate.textContent = "🚀 Create Team & Start Collaborating";

              const errData = srvRes.data || {};
              if (errData.code === "ALREADY_IN_TEAM" || (srvRes.error && srvRes.error.includes("already belongs to team"))) {
                const existingName = errData.currentTeamName || "Existing Team";
                const extra = `
                  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" id="btnAlertOpenExisting" class="btn-team-primary" style="padding:6px 12px;font-size:0.76rem;background:#0284c7;border-color:#38bdf8;">
                      🚀 Open "${escapeHtml(existingName)}" Workspace
                    </button>
                    <button type="button" id="btnAlertLeaveAndCreate" class="btn-team-secondary" style="padding:6px 12px;font-size:0.76rem;border-color:#ef4444;color:#fca5a5;">
                      🔄 Leave Old Team & Register "${escapeHtml(name)}"
                    </button>
                  </div>
                `;
                showCreateAlert(srvRes.error, true, extra);

                document.getElementById("btnAlertOpenExisting")?.addEventListener("click", async () => {
                  showToast("Loading your team workspace...", "⏳");
                  await checkUserTeam();
                });

                document.getElementById("btnAlertLeaveAndCreate")?.addEventListener("click", async () => {
                  btnSubmitCreate.disabled = true;
                  btnSubmitCreate.textContent = "Overwriting Team...";
                  showToast("Leaving previous team and registering new team...", "🔄");
                  const recreateRes = await safeFetchJson(apiRoute, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      email: currentUser.email,
                      displayName: currentUser.displayName,
                      teamName: name,
                      vexTeamNumber: vexNum,
                      role,
                      photoURL: currentUser.photoURL,
                      pathsData,
                      projectData,
                      repoInfo,
                      leaveExisting: true
                    })
                  });
                  if (recreateRes.ok && recreateRes.data?.success && recreateRes.data?.team) {
                    finalizeTeamLoaded(recreateRes.data.team, `Team "${recreateRes.data.team.teamName}" registered!`);
                  } else {
                    btnSubmitCreate.disabled = false;
                    btnSubmitCreate.textContent = "🚀 Create Team & Start Collaborating";
                    showCreateAlert(recreateRes.error || "Failed to recreate team");
                  }
                });
                return;
              }

              showCreateAlert(srvRes.error || "Failed to create team");
              return;
            }
          }

          // If on static host (GitHub Pages) or server returned 404/405/HTML/offline, create client-side
          if (!teamCreated) {
            const now = Date.now();
            const teamId = "team_" + now.toString(36) + "_" + Math.random().toString(36).substring(2, 7);
            const teamCode = "VEX-" + Math.floor(100 + Math.random() * 900);
            const joinSecret = (typeof window !== "undefined" && window.crypto && typeof window.crypto.getRandomValues === "function")
              ? Array.from(window.crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("")
              : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

            const initialMember = {
              email: currentUser.email,
              displayName: currentUser.displayName,
              role,
              color: getRoleColor(role),
              joinedAt: now,
              photoURL: currentUser.photoURL || "",
              isOwner: true
            };

            const initialSnapshot = {
              id: "v_" + now + "_init",
              timestamp: now,
              dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              authorEmail: currentUser.email,
              authorName: currentUser.displayName,
              authorRole: role,
              authorColor: getRoleColor(role),
              actionSummary: "Team initialized & autonomous workspace created",
              editType: "team_init",
              snapshot: pathsData || null
            };

            const newTeamObj = {
              teamId,
              teamCode,
              joinSecret,
              teamName: name,
              vexTeamNumber: vexNum,
              ownerEmail: currentUser.email,
              createdAt: now,
              updatedAt: now,
              members: [initialMember],
              pathPayload: pathsData || {
                paths: [
                  {
                    id: "p_default",
                    name: "Red Left Mogo Rush",
                    pose: { x: -60, y: -60, theta: 0 },
                    actions: [
                      { id: "a_1", type: "moveToPoint", x: -24, y: -24, timeout: 2000, maxSpeed: 115, earlyExitRange: 2, comment: "Rush alliance goal" },
                      { id: "a_2", type: "moveToPose", x: 0, y: 48, theta: 90, timeout: 2500, lead: 0.6, comment: "Score preload in corner" }
                    ]
                  }
                ]
              },
              project: projectData || null,
              versionHistory: [initialSnapshot],
              comments: [
                {
                  id: "cmt_welcome",
                  x: -24,
                  y: -24,
                  text: "📍 Strategy Tip: Clamp preload here before 12s mark. Drop pin comments anywhere on field to discuss routines!",
                  authorEmail: currentUser.email,
                  authorName: currentUser.displayName,
                  authorRole: role,
                  authorColor: getRoleColor(role),
                  timestamp: now,
                  resolved: false,
                  replies: []
                }
              ],
              strategies: [
                {
                  id: "strat_plan_a",
                  title: "Plan A: Center Mobile Goal Rush",
                  description: "Primary match routine: Rush center goal, clamp alliance mogo, sweep 3 side rings, park before 14.5s.",
                  targetRoutine: "Red Left Mogo Rush",
                  authorEmail: currentUser.email,
                  authorName: currentUser.displayName,
                  createdAt: now,
                  status: "active",
                  votes: {
                    [currentUser.email]: "rocket"
                  }
                }
              ]
            };

            await fsCreateTeam(newTeamObj, cleanEmailKey(currentUser.email));
            try {
              localStorage.setItem("lemlib_active_team", JSON.stringify(newTeamObj));
              localStorage.setItem("lemlib_user_team_id", teamId);
              const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
              const userKeys = getCleanEmailKeys(currentUser.email);
              userKeys.forEach(k => { uTeams[k] = teamId; });
              localStorage.setItem("lemlib_user_teams", JSON.stringify(uTeams));
            } catch (_) {}

            teamCreated = newTeamObj;
          }

          btnSubmitCreate.disabled = false;
          btnSubmitCreate.textContent = "🚀 Create Team & Start Collaborating";
          finalizeTeamLoaded(teamCreated, `Team "${teamCreated.teamName}" created!`);
        } catch (submitErr) {
          console.error("Team registration error:", submitErr);
          btnSubmitCreate.disabled = false;
          btnSubmitCreate.textContent = "🚀 Create Team & Start Collaborating";
          showCreateAlert("Error while registering team: " + (submitErr.message || submitErr));
        }
      };
    }

    // 4. Join Team submit with 5-minute constantly changing OTP
    const btnSubmitJoin = document.getElementById("btnSubmitJoinTeam");
    if (btnSubmitJoin) {
      btnSubmitJoin.onclick = async () => {
        try {
          const emailInput = document.getElementById("txtUserAccountEmail");
          const emailVal = (emailInput && emailInput.value.trim()) || currentUser?.email || localStorage.getItem("lemlib_saved_google_email") || "rainforest.cck3@gmail.com";
          if (!emailVal || !emailVal.includes("@")) {
            showJoinAlert("Please enter a valid Gmail address above.");
            if (emailInput) {
              emailInput.focus();
              emailInput.style.borderColor = "#ef4444";
            }
            return;
          }
          if (emailInput) emailInput.style.borderColor = "#334155";

          currentUser = {
            email: emailVal.toLowerCase(),
            displayName: (currentUser && currentUser.displayName) || emailVal.split("@")[0],
            uid: (currentUser && currentUser.uid) || "user_" + emailVal.replace(/[^a-z0-9]/g, "_"),
            photoURL: (currentUser && currentUser.photoURL) || ""
          };
          localStorage.setItem("lemlib_saved_google_email", currentUser.email);
          localStorage.setItem("lemlib_saved_google_user", JSON.stringify(currentUser));

          const code = document.getElementById("txtJoinCode")?.value.trim().toUpperCase();
          const otp = document.getElementById("txtJoinOtp")?.value.trim();
          const role = document.getElementById("selJoinRole")?.value || "Driver";

          if (!code) {
            showJoinAlert("Please enter the 6-character Team Code (e.g. VEX-742), or select a team from the Available Teams list below.");
            return;
          }
          if (!otp) {
            showJoinAlert("Please enter the live 5-minute authorization OTP from an active teammate, or click 'Fill Code & OTP' below.");
            return;
          }

          btnSubmitJoin.disabled = true;
          btnSubmitJoin.textContent = "Verifying OTP & Joining...";

          let teamJoined = null;
          const apiRoute = resolveApiUrl("/api/team/join");
          if (apiRoute) {
            const srvRes = await safeFetchJson(apiRoute, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: currentUser.email,
                displayName: currentUser.displayName,
                teamCode: code,
                otp,
                role,
                photoURL: currentUser.photoURL
              })
            });

            if (srvRes.ok && srvRes.data?.success && srvRes.data?.team) {
              teamJoined = srvRes.data.team;
            } else if (!srvRes.ok && !srvRes.isHtml && srvRes.status !== 404 && srvRes.status !== 405) {
              btnSubmitJoin.disabled = false;
              btnSubmitJoin.textContent = "🔗 Verify 5-Min OTP & Join Team Workspace";

              const errData = srvRes.data || {};
              if (errData.code === "ALREADY_IN_TEAM" || (srvRes.error && srvRes.error.includes("already belongs to team"))) {
                const extra = `
                  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" id="btnJoinAlertOpenExisting" class="btn-team-primary" style="padding:6px 12px;font-size:0.76rem;background:#0284c7;border-color:#38bdf8;">
                      🚀 Open My Current Team
                    </button>
                    <button type="button" id="btnJoinAlertLeaveAndJoin" class="btn-team-secondary" style="padding:6px 12px;font-size:0.76rem;border-color:#ef4444;color:#fca5a5;">
                      🔄 Leave Old Team & Join "${escapeHtml(code)}"
                    </button>
                  </div>
                `;
                showJoinAlert(srvRes.error, true, extra);

                document.getElementById("btnJoinAlertOpenExisting")?.addEventListener("click", () => {
                  checkUserTeam();
                });

                document.getElementById("btnJoinAlertLeaveAndJoin")?.addEventListener("click", async () => {
                  btnSubmitJoin.disabled = true;
                  btnSubmitJoin.textContent = "Transferring...";
                  showToast("Leaving old team and joining new team...", "🔄");
                  const transferRes = await safeFetchJson(apiRoute, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      email: currentUser.email,
                      displayName: currentUser.displayName,
                      teamCode: code,
                      otp,
                      role,
                      photoURL: currentUser.photoURL,
                      leaveExisting: true
                    })
                  });
                  if (transferRes.ok && transferRes.data?.success && transferRes.data?.team) {
                    finalizeTeamLoaded(transferRes.data.team, `Joined team "${transferRes.data.team.teamName}"!`);
                  } else {
                    btnSubmitJoin.disabled = false;
                    btnSubmitJoin.textContent = "🔗 Verify 5-Min OTP & Join Team Workspace";
                    showJoinAlert(transferRes.error || "Failed to transfer to new team");
                  }
                });
                return;
              }

              showJoinAlert(srvRes.error || "Failed to join team");
              return;
            }
          }

          // If on static host (GitHub Pages) or server returned 404/405/HTML/offline, join client-side
          if (!teamJoined) {
            const fsRes = await fsJoinTeam(code, otp, currentUser);
            if (fsRes.error) {
              btnSubmitJoin.disabled = false;
              btnSubmitJoin.textContent = "🔗 Verify 5-Min OTP & Join Team Workspace";
              showJoinAlert(fsRes.error);
              return;
            }
            teamJoined = fsRes.team;
          }

          btnSubmitJoin.disabled = false;
          btnSubmitJoin.textContent = "🔗 Verify 5-Min OTP & Join Team Workspace";
          finalizeTeamLoaded(teamJoined, `Joined team "${teamJoined.teamName}"! You are authorized across sessions.`);
        } catch (joinErr) {
          console.error("Team join error:", joinErr);
          btnSubmitJoin.disabled = false;
          btnSubmitJoin.textContent = "🔗 Verify 5-Min OTP & Join Team Workspace";
          showJoinAlert("Error while joining team: " + (joinErr.message || joinErr));
        }
      };
    }

    // Auto-detect pasted invite text containing both team code and OTP
    const handleJoinPaste = (e) => {
      const pasted = (e.clipboardData || window.clipboardData)?.getData("text") || "";
      if (!pasted) return;
      const codeMatch = pasted.match(/\b(VEX-[A-Z0-9]{3,6}|[A-Z0-9]{6})\b/i);
      const otpMatch = pasted.match(/\b(\d{6})\b/);
      if (codeMatch || otpMatch) {
        if (codeMatch) {
          const txtCode = document.getElementById("txtJoinCode");
          if (txtCode) txtCode.value = codeMatch[1].toUpperCase();
        }
        if (otpMatch) {
          const txtOtp = document.getElementById("txtJoinOtp");
          if (txtOtp) txtOtp.value = otpMatch[1];
        }
        if (codeMatch && otpMatch) {
          showToast("✨ Auto-filled Team Code and 5-min OTP from copied invite!", "📋");
        }
      }
    };
    document.getElementById("txtJoinCode")?.addEventListener("paste", handleJoinPaste);
    document.getElementById("txtJoinOtp")?.addEventListener("paste", handleJoinPaste);

    // 5. Right panel tabs switching (Actions vs Versions)
    const tabBtnActions = document.getElementById("tabBtnActions");
    const tabBtnVersions = document.getElementById("tabBtnVersions");
    const paneActions = document.getElementById("paneActions");
    const paneVersions = document.getElementById("paneVersions");

    if (tabBtnActions && tabBtnVersions) {
      tabBtnActions.onclick = () => {
        tabBtnActions.classList.add("active");
        tabBtnVersions.classList.remove("active");
        if (paneActions) paneActions.style.display = "flex";
        if (paneVersions) paneVersions.style.display = "none";
      };

      tabBtnVersions.onclick = () => {
        tabBtnVersions.classList.add("active");
        tabBtnActions.classList.remove("active");
        if (paneVersions) paneVersions.style.display = "flex";
        if (paneActions) paneActions.style.display = "none";
        renderVersionHistory();
      };
    }

    // 6. Action block adding
    document.getElementById("btnAddActionMovePoint")?.addEventListener("click", () => addAction("moveToPoint"));
    document.getElementById("btnAddActionMovePose")?.addEventListener("click", () => addAction("moveToPose"));
    document.getElementById("btnAddActionTurn")?.addEventListener("click", () => addAction("turnToHeading"));

    // 7. Manual Checkpoint button
    document.getElementById("btnManualCheckpoint")?.addEventListener("click", () => {
      const note = prompt("Enter checkpoint description / commit note:", "Tuned routine for Match 14");
      if (!note) return;
      broadcastEdit(note.trim(), "manual_checkpoint", true);
      showToast("💾 Team checkpoint saved with author attribution!", "✅");
    });

    // 8. Field Pin toggle
    document.getElementById("btnTogglePinTool")?.addEventListener("click", () => {
      togglePinModeUI(!isPinDropMode);
    });
    document.getElementById("btnCenterCanvasPinTool")?.addEventListener("click", () => {
      togglePinModeUI(!isPinDropMode);
    });

    // 9. Propose Strategy modal
    const modalStrat = document.getElementById("modalProposeStrategy");
    document.getElementById("btnProposeStrategy")?.addEventListener("click", () => {
      if (modalStrat) modalStrat.style.display = "flex";
    });
    document.getElementById("btnCloseStrategyModal")?.addEventListener("click", () => {
      if (modalStrat) modalStrat.style.display = "none";
    });
    document.getElementById("btnCancelStrategy")?.addEventListener("click", () => {
      if (modalStrat) modalStrat.style.display = "none";
    });
    document.getElementById("btnSubmitStrategy")?.addEventListener("click", () => {
      const title = document.getElementById("txtStratTitle")?.value.trim();
      const desc = document.getElementById("txtStratDesc")?.value.trim();
      const routine = document.getElementById("selStratRoutine")?.value || "";

      if (!title) {
        alert("Please enter a strategy title.");
        return;
      }

      fetch("/api/team/strategy/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentTeam.teamId,
          email: currentUser.email,
          authorName: currentUser.displayName || currentUser.email.split("@")[0],
          title,
          description: desc,
          targetRoutine: routine
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          currentTeam.strategies = data.strategies;
          if (modalStrat) modalStrat.style.display = "none";
          renderStrategies();
          showToast("🗳️ Match strategy proposed to team", "✨");
        }
      });
    });

    // 10. Version Inspect Modal Close & Confirm Restore
    document.getElementById("btnCloseInspectModal")?.addEventListener("click", () => {
      document.getElementById("modalVersionInspect").style.display = "none";
    });
    document.getElementById("btnConfirmRestoreVersion")?.addEventListener("click", () => {
      if (selectedVersionForRestore) {
        restoreVersionPrompt(selectedVersionForRestore);
      }
    });

    // 11. Simulation Playback Controls
    document.getElementById("btnSimPlay")?.addEventListener("click", toggleSimPlay);
    document.getElementById("btnSimReset")?.addEventListener("click", () => {
      simTimeMs = 0;
      updateSimScrubber();
      if (isSimPlaying) toggleSimPlay();
    });
    document.getElementById("simScrubber")?.addEventListener("input", (e) => {
      simTimeMs = Number(e.target.value) || 0;
      updateSimScrubber();
    });

    // 12. Version History Filter input
    document.getElementById("inputFilterVersions")?.addEventListener("input", () => {
      renderVersionHistory();
    });

    // 13. Team Settings / Leave Team
    document.getElementById("btnManageTeam")?.addEventListener("click", () => {
      if (!currentTeam) return;
      const opt = confirm(`Team: ${currentTeam.teamName} (${currentTeam.teamCode})\nOwner: ${currentTeam.ownerEmail}\nMembers: ${currentTeam.members.length}\n\nDo you want to LEAVE this team?\n(Note: You can only be in 1 team at a time)`);
      if (opt) {
        fetch("/api/team/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: currentTeam.teamId,
            email: currentUser.email
          })
        })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            alert("You have left the team.");
            location.reload();
          }
        });
      }
    });

    // 14. Routine Rename & Duplicate
    document.getElementById("btnAddRoutine")?.addEventListener("click", () => {
      const name = prompt("Enter new autonomous routine name:", `Routine ${activePaths.length + 1}`);
      if (!name) return;
      activePaths.push({
        id: "p_" + Date.now().toString(36),
        name: name.trim(),
        pose: { x: -60, y: -60, theta: 0 },
        actions: []
      });
      activeRoutineIndex = activePaths.length - 1;
      renderRoutinesSelector();
      renderActionBlocks();
      drawField();
      broadcastEdit(`Created routine "${name}"`, "routine_create", true);
    });

    document.getElementById("btnRenameRoutine")?.addEventListener("click", () => {
      const cur = activePaths[activeRoutineIndex];
      if (!cur) return;
      const newName = prompt("Rename autonomous routine:", cur.name);
      if (!newName || newName.trim() === "") return;
      cur.name = newName.trim();
      renderRoutinesSelector();
      broadcastEdit(`Renamed routine to "${cur.name}"`, "routine_rename", true);
    });

    document.getElementById("btnDupRoutine")?.addEventListener("click", () => {
      const cur = activePaths[activeRoutineIndex];
      if (!cur) return;
      const cloned = JSON.parse(JSON.stringify(cur));
      cloned.id = "p_" + Date.now().toString(36);
      cloned.name = `${cur.name} (Copy)`;
      activePaths.push(cloned);
      activeRoutineIndex = activePaths.length - 1;
      renderRoutinesSelector();
      renderActionBlocks();
      drawField();
      broadcastEdit(`Duplicated routine "${cloned.name}"`, "routine_dup", true);
    });

    // Auto-smooth path button
    document.getElementById("btnAutoTuneCurve")?.addEventListener("click", () => {
      showToast("⚡ Auto-smoothed trajectory curvature for LemLib pure pursuit!", "✨");
    });

    // 15. Owner Project Import Dropdown & Modals (Visual Planner vs GitHub)
    const btnOwnerImport = document.getElementById("btnOwnerImport");
    const ownerImportMenu = document.getElementById("ownerImportMenu");
    const btnMenuImportPlanner = document.getElementById("btnMenuImportPlanner");
    const btnMenuImportGithub = document.getElementById("btnMenuImportGithub");

    if (btnOwnerImport && ownerImportMenu) {
      btnOwnerImport.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = ownerImportMenu.style.display === "block";
        ownerImportMenu.style.display = isOpen ? "none" : "block";
      });

      document.addEventListener("click", (e) => {
        if (!e.target.closest("#ownerImportWrap")) {
          ownerImportMenu.style.display = "none";
        }
      });
    }

    // Modal: Import from Visual Planner
    const modalPlannerImport = document.getElementById("modalPlannerImportConfirm");
    const btnClosePlannerModal = document.getElementById("btnClosePlannerImportModal");
    const btnCancelPlannerModal = document.getElementById("btnCancelPlannerImport");
    const btnExecutePlannerImport = document.getElementById("btnExecutePlannerImport");
    const plannerPreviewBox = document.getElementById("plannerImportPreviewBox");
    const plannerImportStatus = document.getElementById("plannerImportStatus");

    if (btnMenuImportPlanner) {
      btnMenuImportPlanner.addEventListener("click", () => {
        if (ownerImportMenu) ownerImportMenu.style.display = "none";
        if (!isCurrentUserOwner()) {
          alert("Only the team owner has permission to import projects into this team workspace.");
          return;
        }

        const local = getLocalPlannerPayload();
        if (plannerPreviewBox) {
          if (local.paths && local.paths.length > 0) {
            const routineList = local.paths.map(p => `<li><strong>${escapeHtml(p.name)}</strong> (${(p.actions || []).length} waypoints)</li>`).join("");
            plannerPreviewBox.innerHTML = `
              <div style="font-weight:700;color:#38bdf8;margin-bottom:6px;">📁 Active Project: ${escapeHtml(local.project?.name || "Local Planner Project")}</div>
              <div style="color:#cbd5e1;margin-bottom:4px;">📍 Detected ${local.paths.length} Autonomous Routine${local.paths.length === 1 ? '' : 's'}:</div>
              <ul style="margin:0 0 10px 18px;padding:0;color:#94a3b8;font-size:0.75rem;">${routineList}</ul>
              <div style="font-size:0.72rem;color:#10b981;">✅ Ready to sync to your team workspace</div>
            `;
          } else {
            plannerPreviewBox.innerHTML = `
              <div style="color:#f59e0b;">⚠️ No custom autonomous routines found in local visual planner storage. Default starter template will be used.</div>
            `;
          }
        }
        if (plannerImportStatus) plannerImportStatus.style.display = "none";
        if (modalPlannerImport) modalPlannerImport.style.display = "flex";
      });
    }

    [btnClosePlannerModal, btnCancelPlannerModal].forEach(btn => {
      btn?.addEventListener("click", () => {
        if (modalPlannerImport) modalPlannerImport.style.display = "none";
      });
    });

    if (btnExecutePlannerImport) {
      btnExecutePlannerImport.addEventListener("click", async () => {
        if (!currentTeam || !currentUser) return;
        const local = getLocalPlannerPayload();

        btnExecutePlannerImport.disabled = true;
        btnExecutePlannerImport.textContent = "Importing...";
        if (plannerImportStatus) {
          plannerImportStatus.style.display = "block";
          plannerImportStatus.style.background = "rgba(56, 189, 248, 0.1)";
          plannerImportStatus.style.color = "#38bdf8";
          plannerImportStatus.textContent = "⏳ Synchronizing visual planner routines with team workspace...";
        }

        try {
          const res = await fetch("/api/team/import-project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamId: currentTeam.teamId,
              email: currentUser.email,
              authorName: currentUser.displayName,
              authorRole: currentUser.role,
              source: "planner",
              pathPayload: { paths: local.paths },
              projectData: local.project
            })
          });
          const data = await res.json();
          btnExecutePlannerImport.disabled = false;
          btnExecutePlannerImport.textContent = "🗺️ Confirm & Import to Team";

          if (data.error) {
            alert(data.error);
            if (plannerImportStatus) {
              plannerImportStatus.style.background = "rgba(239, 68, 68, 0.1)";
              plannerImportStatus.style.color = "#f87171";
              plannerImportStatus.textContent = `❌ ${data.error}`;
            }
          } else if (data.success && data.team) {
            currentTeam = data.team;
            if (currentTeam.pathPayload?.paths) {
              activePaths = currentTeam.pathPayload.paths;
              activeRoutineIndex = 0;
            }
            if (modalPlannerImport) modalPlannerImport.style.display = "none";
            renderRoutinesSelector();
            renderActionBlocks();
            renderVersionHistory();
            drawField();
            showToast("🚀 Successfully imported project from Visual Planner!", "🎉");
          }
        } catch (err) {
          btnExecutePlannerImport.disabled = false;
          btnExecutePlannerImport.textContent = "🗺️ Confirm & Import to Team";
          alert("Import failed: " + err.message);
        }
      });
    }

    // Modal: Import from GitHub
    const modalGithubImport = document.getElementById("modalGithubImport");
    const btnCloseGithubModal = document.getElementById("btnCloseGithubImportModal");
    const btnCancelGithubModal = document.getElementById("btnCancelGithubImport");
    const btnExecuteGithubImport = document.getElementById("btnExecuteGithubImport");
    const txtImportGithubRepo = document.getElementById("txtImportGithubRepo");
    const txtImportGithubBranch = document.getElementById("txtImportGithubBranch");
    const txtImportGithubToken = document.getElementById("txtImportGithubToken");
    const githubImportStatus = document.getElementById("githubImportStatus");

    if (btnMenuImportGithub) {
      btnMenuImportGithub.addEventListener("click", () => {
        if (ownerImportMenu) ownerImportMenu.style.display = "none";
        if (!isCurrentUserOwner()) {
          alert("Only the team owner has permission to import projects into this team workspace.");
          return;
        }

        const savedToken = localStorage.getItem("github_pat_token") || "";
        if (txtImportGithubToken && savedToken) {
          txtImportGithubToken.value = savedToken;
        }
        if (githubImportStatus) githubImportStatus.style.display = "none";
        if (modalGithubImport) modalGithubImport.style.display = "flex";
      });
    }

    [btnCloseGithubModal, btnCancelGithubModal].forEach(btn => {
      btn?.addEventListener("click", () => {
        if (modalGithubImport) modalGithubImport.style.display = "none";
      });
    });

    if (btnExecuteGithubImport) {
      btnExecuteGithubImport.addEventListener("click", async () => {
        if (!currentTeam || !currentUser) return;
        const repoVal = txtImportGithubRepo?.value.trim();
        const branchVal = txtImportGithubBranch?.value.trim();
        const tokenVal = txtImportGithubToken?.value.trim();

        if (!repoVal) {
          alert("Please enter a GitHub repository (e.g. LemLib/LemLib or full URL)");
          return;
        }

        if (tokenVal) localStorage.setItem("github_pat_token", tokenVal);

        btnExecuteGithubImport.disabled = true;
        btnExecuteGithubImport.textContent = "Cloning...";
        if (githubImportStatus) {
          githubImportStatus.style.display = "block";
          githubImportStatus.style.background = "rgba(56, 189, 248, 0.1)";
          githubImportStatus.style.color = "#38bdf8";
          githubImportStatus.textContent = `⏳ Connecting to GitHub and downloading "${repoVal}"...`;
        }

        try {
          const cloneRes = await fetch("/api/github/clone", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repo: repoVal, branch: branchVal, token: tokenVal })
          });
          const cloneData = await cloneRes.json();
          if (!cloneData.success || !cloneData.files) {
            throw new Error(cloneData.error || "Failed to clone repository from GitHub");
          }

          if (githubImportStatus) {
            githubImportStatus.textContent = `⚙️ Extracted ${cloneData.fileCount} files. Parsing C++ LemLib autons...`;
          }

          const detectedPaths = parseGithubAutonFiles(cloneData.files, cloneData.repoName);

          const importRes = await fetch("/api/team/import-project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamId: currentTeam.teamId,
              email: currentUser.email,
              authorName: currentUser.displayName,
              authorRole: currentUser.role,
              source: "github",
              pathPayload: { paths: detectedPaths },
              projectData: { name: cloneData.repoName || repoVal, files: cloneData.files },
              repoInfo: { repo: repoVal, branch: cloneData.branch, fileCount: cloneData.fileCount }
            })
          });
          const importData = await importRes.json();

          btnExecuteGithubImport.disabled = false;
          btnExecuteGithubImport.textContent = "🚀 Clone & Import Repository";

          if (importData.error) {
            alert(importData.error);
            if (githubImportStatus) {
              githubImportStatus.style.background = "rgba(239, 68, 68, 0.1)";
              githubImportStatus.style.color = "#f87171";
              githubImportStatus.textContent = `❌ ${importData.error}`;
            }
          } else if (importData.success && importData.team) {
            currentTeam = importData.team;
            if (currentTeam.pathPayload?.paths) {
              activePaths = currentTeam.pathPayload.paths;
              activeRoutineIndex = 0;
            }
            if (modalGithubImport) modalGithubImport.style.display = "none";
            renderRoutinesSelector();
            renderActionBlocks();
            renderVersionHistory();
            drawField();
            showToast(`🚀 Successfully cloned & imported ${repoVal} into team!`, "🎉");
          }
        } catch (err) {
          btnExecuteGithubImport.disabled = false;
          btnExecuteGithubImport.textContent = "🚀 Clone & Import Repository";
          if (githubImportStatus) {
            githubImportStatus.style.background = "rgba(239, 68, 68, 0.1)";
            githubImportStatus.style.color = "#f87171";
            githubImportStatus.textContent = `❌ Error: ${err.message}`;
          }
          alert("GitHub import failed: " + err.message);
        }
      });
    }
  }

  // --------------------------------------------------------------------------
  // INIT
  // --------------------------------------------------------------------------
  window.addEventListener("DOMContentLoaded", () => {
    initAuth();
    wireEvents();
    drawField();
    if (window.location.hash === "#join") {
      document.getElementById("tabGateJoin")?.click();
    } else if (window.location.hash === "#create") {
      document.getElementById("tabGateCreate")?.click();
    }
  });

})(window);
