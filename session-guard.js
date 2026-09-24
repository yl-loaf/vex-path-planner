/**
 * LemLib Suite - Single-Instance Account Session Guard
 * Ensures only one instance of a user account is active at any time to prevent sync collisions.
 */
(function (global) {
  "use strict";

  let tabSessionId = "";
  try {
    tabSessionId = sessionStorage.getItem("lemlib_tab_session_id");
  } catch (_) {}
  if (!tabSessionId) {
    tabSessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
    try {
      sessionStorage.setItem("lemlib_tab_session_id", tabSessionId);
    } catch (_) {}
  }
  const SESSION_ID = tabSessionId;
  const SESSION_CHANNEL_NAME = "lemlib_single_account_session_bus";
  const LOCAL_STORAGE_ACTIVE_KEY_PREFIX = "lemlib_active_session_";
  const HEARTBEAT_INTERVAL_MS = 8000;

  function getApiUrl(path) {
    if (typeof window !== "undefined" && typeof window.getApiUrl === "function") {
      return window.getApiUrl(path);
    }
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".run.app")) {
      return path;
    }
    return null;
  }

  let currentUser = null; // { uid, email, displayName }
  let pageName = "App";
  let instanceStatus = "UNAUTHENTICATED"; // "UNAUTHENTICATED" | "ACTIVE" | "CONFLICT_PENDING" | "DEACTIVATED"
  let heartbeatTimer = null;
  let firestoreUnsub = null;
  let broadcastChannel = null;
  let lastActiveSessionInfo = null;

  // Event callbacks
  const listeners = {
    onStatusChange: [],
    onDeactivated: [],
    onActivated: []
  };

  // Helper: Get user storage key
  function getUserKey(user) {
    if (!user) return null;
    if (user.uid) return "uid_" + user.uid;
    if (user.email) return "email_" + user.email.toLowerCase().replace(/[^a-z0-9]/g, "_");
    return null;
  }

  // Cross-Tab Broadcast Channel initialization
  try {
    if (typeof BroadcastChannel !== "undefined") {
      broadcastChannel = new BroadcastChannel(SESSION_CHANNEL_NAME);
      broadcastChannel.onmessage = (event) => {
        handleBroadcastMessage(event.data);
      };
    }
  } catch (err) {
    console.warn("[SessionGuard] BroadcastChannel not supported:", err);
  }

  // Cross-Tab storage event listener fallback
  window.addEventListener("storage", (event) => {
    if (!currentUser || !event.key) return;
    const userKey = getUserKey(currentUser);
    if (event.key === LOCAL_STORAGE_ACTIVE_KEY_PREFIX + userKey && event.newValue) {
      try {
        const remoteData = JSON.parse(event.newValue);
        if (remoteData && remoteData.sessionId && remoteData.sessionId !== SESSION_ID) {
          if (instanceStatus === "ACTIVE") {
            deactivateInstance(remoteData);
          }
        }
      } catch (_) {}
    }
  });

  function handleBroadcastMessage(data) {
    if (!data || !currentUser) return;
    const myKey = getUserKey(currentUser);
    const incomingKey = getUserKey(data.user);
    if (!myKey || myKey !== incomingKey) return;

    if (data.type === "ANNOUNCE_ACTIVE") {
      if (data.sessionId !== SESSION_ID) {
        if (instanceStatus === "ACTIVE") {
          // If remote instance claims it took over after us, yield active state
          if (data.timestamp >= (lastActiveSessionInfo?.openedAt || 0)) {
            deactivateInstance(data);
          }
        }
      }
    } else if (data.type === "QUERY_ACTIVE") {
      if (instanceStatus === "ACTIVE") {
        broadcastMessage({
          type: "ANNOUNCE_ACTIVE",
          sessionId: SESSION_ID,
          pageName: pageName,
          user: currentUser,
          timestamp: Date.now()
        });
      }
    } else if (data.type === "TAKEOVER_CLAIMED") {
      if (data.sessionId !== SESSION_ID && instanceStatus === "ACTIVE") {
        deactivateInstance(data);
      }
    } else if (data.type === "FORCE_DISCONNECT_TARGET") {
      if (data.targetSessionId === SESSION_ID) {
        deactivateInstance(data);
      }
    }
  }

  function broadcastMessage(msg) {
    try {
      if (broadcastChannel) {
        broadcastChannel.postMessage(msg);
      }
    } catch (_) {}
  }

  // UI Modals & Overlays
  function removeModal(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function showConflictModal(existingSession) {
    removeModal("lemlib-conflict-modal");
    removeModal("lemlib-lockout-overlay");

    const email = currentUser?.email || "this account";
    const remotePage = existingSession?.page || existingSession?.pageName || "Another window/device";
    const openedTime = existingSession?.openedAt ? new Date(existingSession.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "recently";

    const modal = document.createElement("div");
    modal.id = "lemlib-conflict-modal";
    modal.className = "session-modal-backdrop";
    modal.innerHTML = `
      <div class="session-modal-card" role="dialog" aria-modal="true" aria-labelledby="conflictTitle">
        <div class="session-modal-icon warning">⚠️</div>
        <h3 id="conflictTitle" class="session-modal-title">Account Already Active Elsewhere</h3>
        <p class="session-modal-desc">
          Another instance of <strong>${escapeHtml(email)}</strong> is currently open in <strong>${escapeHtml(remotePage)}</strong> (active since ${escapeHtml(openedTime)}).
        </p>
        <div class="session-modal-notice">
          To prevent data conflicts and overwrite loss, only <strong>one instance</strong> may be active at a time.
        </div>
        <div class="session-modal-actions">
          <button type="button" class="session-btn session-btn-primary" id="btnSessionTakeover" title="Deactivate the other instance and make this one active">
            ⚡ Take Over (Log Out Other Instance)
          </button>
          <button type="button" class="session-btn session-btn-secondary" id="btnSessionDisconnectThis" title="Close or sign out of this tab">
            ✖ Disconnect This Instance
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("btnSessionTakeover")?.addEventListener("click", () => {
      removeModal("lemlib-conflict-modal");
      takeOverSession();
    });

    document.getElementById("btnSessionDisconnectThis")?.addEventListener("click", () => {
      removeModal("lemlib-conflict-modal");
      disconnectThisInstance();
    });
  }

  function showLockoutOverlay(remoteSession) {
    removeModal("lemlib-conflict-modal");
    removeModal("lemlib-lockout-overlay");

    const email = currentUser?.email || "Your account";
    const remotePage = remoteSession?.page || remoteSession?.pageName || "another window/device";

    const overlay = document.createElement("div");
    overlay.id = "lemlib-lockout-overlay";
    overlay.className = "session-lockout-overlay";
    overlay.innerHTML = `
      <div class="session-lockout-card" role="alertdialog">
        <div class="session-modal-icon locked">🔒</div>
        <h2 class="session-modal-title">Session Deactivated</h2>
        <p class="session-modal-desc">
          <strong>${escapeHtml(email)}</strong> is currently active in <strong>${escapeHtml(remotePage)}</strong>.
        </p>
        <div class="session-modal-notice">
          This tab is paused to prevent project file and autonomous path conflicts. You can take over the session here whenever you're ready.
        </div>
        <div class="session-modal-actions">
          <button type="button" class="session-btn session-btn-primary" id="btnLockoutTakeover">
            ⚡ Take Over Session Here
          </button>
          <button type="button" class="session-btn session-btn-secondary" id="btnLockoutSignOut">
            🚪 Sign Out
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("btnLockoutTakeover")?.addEventListener("click", () => {
      takeOverSession();
    });

    document.getElementById("btnLockoutSignOut")?.addEventListener("click", () => {
      removeModal("lemlib-lockout-overlay");
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().signOut().catch(console.error);
      }
      localStorage.removeItem("lemlib_saved_google_user");
      localStorage.setItem("lemlib_explicit_signout", "true");
      location.reload();
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Inject session styling
  function injectStyles() {
    if (document.getElementById("lemlib-session-guard-styles")) return;
    const style = document.createElement("style");
    style.id = "lemlib-session-guard-styles";
    style.textContent = `
      .session-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        animation: sessionFadeIn 0.2s ease-out;
      }
      .session-modal-card {
        background: #1e293b;
        color: #f8fafc;
        border: 1px solid #334155;
        border-radius: 14px;
        padding: 24px;
        max-width: 480px;
        width: 100%;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
        text-align: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .session-lockout-overlay {
        position: fixed;
        inset: 0;
        z-index: 999998;
        background: rgba(10, 15, 29, 0.88);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        animation: sessionFadeIn 0.25s ease-out;
      }
      .session-lockout-card {
        background: #1e293b;
        color: #f8fafc;
        border: 1px solid #475569;
        border-radius: 16px;
        padding: 32px 24px;
        max-width: 460px;
        width: 100%;
        text-align: center;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .session-modal-icon {
        font-size: 40px;
        line-height: 1;
        margin-bottom: 12px;
      }
      .session-modal-title {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 10px 0;
        color: #f1f5f9;
      }
      .session-modal-desc {
        font-size: 0.95rem;
        line-height: 1.5;
        color: #cbd5e1;
        margin: 0 0 14px 0;
      }
      .session-modal-notice {
        font-size: 0.85rem;
        line-height: 1.4;
        background: rgba(51, 65, 85, 0.6);
        border: 1px solid rgba(100, 116, 139, 0.3);
        border-radius: 8px;
        padding: 10px 14px;
        color: #94a3b8;
        margin-bottom: 20px;
      }
      .session-modal-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .session-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 12px 18px;
        border-radius: 8px;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
        outline: none;
      }
      .session-btn-primary {
        background: #2563eb;
        color: #ffffff;
      }
      .session-btn-primary:hover {
        background: #1d4ed8;
      }
      .session-btn-secondary {
        background: #334155;
        color: #cbd5e1;
        border: 1px solid #475569;
      }
      .session-btn-secondary:hover {
        background: #475569;
        color: #ffffff;
      }
      @keyframes sessionFadeIn {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }

  // Deactivate current instance
  function deactivateInstance(remoteSession) {
    if (instanceStatus === "DEACTIVATED") return;
    console.warn(`[SessionGuard] Instance ${SESSION_ID} deactivated by another session:`, remoteSession);
    instanceStatus = "DEACTIVATED";
    lastActiveSessionInfo = remoteSession;

    stopHeartbeat();
    showLockoutOverlay(remoteSession);

    // Notify listeners
    listeners.onDeactivated.forEach(fn => {
      try { fn(remoteSession); } catch (_) {}
    });
    listeners.onStatusChange.forEach(fn => {
      try { fn(instanceStatus, remoteSession); } catch (_) {}
    });
  }

  // Activate current instance
  function activateInstance() {
    instanceStatus = "ACTIVE";
    removeModal("lemlib-conflict-modal");
    removeModal("lemlib-lockout-overlay");

    const now = Date.now();
    lastActiveSessionInfo = {
      sessionId: SESSION_ID,
      pageName: pageName,
      openedAt: now,
      user: currentUser
    };

    // Store in localStorage for instant local cross-tab sync
    if (currentUser) {
      const userKey = getUserKey(currentUser);
      if (userKey) {
        try {
          localStorage.setItem(LOCAL_STORAGE_ACTIVE_KEY_PREFIX + userKey, JSON.stringify({
            sessionId: SESSION_ID,
            page: pageName,
            user: { uid: currentUser.uid, email: currentUser.email },
            openedAt: now,
            updatedAt: now
          }));
        } catch (_) {}
      }
    }

    // Broadcast announcement to all local tabs
    broadcastMessage({
      type: "ANNOUNCE_ACTIVE",
      sessionId: SESSION_ID,
      pageName: pageName,
      user: currentUser,
      timestamp: now
    });

    // Start server heartbeat
    startHeartbeat();

    // Setup Firestore listener if available
    setupFirestoreSessionWatcher();

    console.log(`[SessionGuard] Instance ${SESSION_ID} is now ACTIVE for ${currentUser?.email || currentUser?.uid}`);

    // Notify listeners
    listeners.onActivated.forEach(fn => {
      try { fn(); } catch (_) {}
    });
    listeners.onStatusChange.forEach(fn => {
      try { fn(instanceStatus); } catch (_) {}
    });
  }

  // Server Registration & Heartbeat
  async function registerWithServer(forceTakeover = false) {
    if (!currentUser) return { success: true };
    const url = getApiUrl("/api/session/register");
    if (!url) return { success: true, conflict: false };
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: currentUser.uid || "",
          email: currentUser.email || "",
          sessionId: SESSION_ID,
          page: pageName,
          userAgent: navigator.userAgent || "",
          forceTakeover: Boolean(forceTakeover)
        })
      });
      if (!resp.ok) throw new Error("Server returned " + resp.status);
      return await resp.json();
    } catch (err) {
      return { success: true, conflict: false }; // fallback gracefully
    }
  }

  async function sendHeartbeat() {
    if (!currentUser || instanceStatus !== "ACTIVE") return;
    const url = getApiUrl("/api/session/heartbeat");
    if (!url) return;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: currentUser.uid || "",
          email: currentUser.email || "",
          sessionId: SESSION_ID,
          page: pageName
        })
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.valid === false && data.reason === "taken_over") {
        deactivateInstance(data.activeSession || { page: "another device" });
      }
    } catch (err) {
      // transient network glitch; heartbeat will retry next tick
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    sendHeartbeat();
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // Firestore Realtime Session Coordination (if Firebase is configured)
  function setupFirestoreSessionWatcher() {
    if (firestoreUnsub) {
      try { firestoreUnsub(); } catch (_) {}
      firestoreUnsub = null;
    }
    if (typeof firebase === "undefined" || !firebase.firestore || !currentUser || !currentUser.uid) return;
    try {
      const db = firebase.firestore();
      const sessDoc = db.collection("users").doc(currentUser.uid).collection("data").doc("session");

      // Write active session record to firestore
      sessDoc.set({
        sessionId: SESSION_ID,
        page: pageName,
        email: currentUser.email || "",
        openedAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastHeartbeat: firebase.firestore.FieldValue.serverTimestamp(),
        userAgent: navigator.userAgent || ""
      }, { merge: true }).catch(err => {
        console.warn("[SessionGuard] Firestore session set notice:", err);
      });

      // Listen for remote takeovers
      firestoreUnsub = sessDoc.onSnapshot((snap) => {
        if (!snap.exists) return;
        const data = snap.data();
        if (data && data.sessionId && data.sessionId !== SESSION_ID) {
          if (instanceStatus === "ACTIVE") {
            deactivateInstance(data);
          }
        }
      }, (err) => {
        console.warn("[SessionGuard] Firestore session listener warning:", err);
      });
    } catch (err) {
      console.warn("[SessionGuard] Error setting up Firestore watcher:", err);
    }
  }

  // Take Over Session
  async function takeOverSession() {
    removeModal("lemlib-conflict-modal");
    removeModal("lemlib-lockout-overlay");

    // Broadcast takeover to all other tabs on this machine
    broadcastMessage({
      type: "TAKEOVER_CLAIMED",
      sessionId: SESSION_ID,
      pageName: pageName,
      user: currentUser,
      timestamp: Date.now()
    });

    // Register with server forcing takeover
    await registerWithServer(true);

    // Make this instance active
    activateInstance();
  }

  // Disconnect / Close This Instance
  function disconnectThisInstance() {
    removeModal("lemlib-conflict-modal");
    instanceStatus = "DEACTIVATED";
    stopHeartbeat();

    // Release server registration if any
    if (currentUser) {
      try {
        fetch(getApiUrl("/api/session/release"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid: currentUser.uid || "",
            email: currentUser.email || "",
            sessionId: SESSION_ID
          }),
          keepalive: true
        }).catch(() => {});
      } catch (_) {}
    }

    // Try closing window if opened as popup/tab
    try {
      window.close();
    } catch (_) {}

    // If still open, display inactive state
    showLockoutOverlay({ pageName: "other open instance" });
  }

  // Check initial conflict state on user sign-in or page load
  async function checkSessionStatus(user) {
    if (!user) {
      instanceStatus = "UNAUTHENTICATED";
      stopHeartbeat();
      removeModal("lemlib-conflict-modal");
      removeModal("lemlib-lockout-overlay");
      return;
    }

    currentUser = {
      uid: user.uid || "",
      email: user.email || "",
      displayName: user.displayName || user.email || "User"
    };

    // Check if an intentional reload is in progress (update reload, force refresh, etc.)
    let isReloading = false;
    try {
      if (sessionStorage.getItem("lemlib_reload_in_progress") === "true") {
        isReloading = true;
        sessionStorage.removeItem("lemlib_reload_in_progress");
      }
    } catch (_) {}

    if (isReloading) {
      console.log(`[SessionGuard] Reload in progress for ${currentUser?.email} - automatically taking over active session without conflict modal`);
      await registerWithServer(true);
      activateInstance();
      return;
    }

    // 1. Check local storage first for instant cross-tab collision check in same browser
    const userKey = getUserKey(currentUser);
    let localConflict = false;
    let localActiveInfo = null;
    if (userKey) {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_ACTIVE_KEY_PREFIX + userKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          // If active session exists and is less than 30 seconds old and not this session
          if (parsed && parsed.sessionId && parsed.sessionId !== SESSION_ID && (Date.now() - (parsed.updatedAt || parsed.openedAt || 0) < 30000)) {
            localConflict = true;
            localActiveInfo = parsed;
          }
        }
      } catch (_) {}
    }

    // 2. Check server
    const serverResult = await registerWithServer(false);

    if (serverResult && serverResult.conflict && serverResult.activeSession) {
      const prevTabSession = sessionStorage.getItem("lemlib_tab_session_id");
      if (serverResult.activeSession.sessionId === SESSION_ID || (prevTabSession && serverResult.activeSession.sessionId === prevTabSession)) {
        console.log(`[SessionGuard] Recognized previous session on reload (${serverResult.activeSession.sessionId}) - auto taking over`);
        await registerWithServer(true);
        activateInstance();
        return;
      }
      instanceStatus = "CONFLICT_PENDING";
      showConflictModal(serverResult.activeSession);
      return;
    }

    if (localConflict && localActiveInfo) {
      const prevTabSession = sessionStorage.getItem("lemlib_tab_session_id");
      if (localActiveInfo.sessionId === SESSION_ID || (prevTabSession && localActiveInfo.sessionId === prevTabSession)) {
        console.log(`[SessionGuard] Recognized previous local session on reload - activating`);
        await registerWithServer(true);
        activateInstance();
        return;
      }
      instanceStatus = "CONFLICT_PENDING";
      showConflictModal(localActiveInfo);
      return;
    }

    // No conflict detected; activate this instance
    activateInstance();
  }

  // Clean release on tab unload
  window.addEventListener("beforeunload", () => {
    // If a reload is in progress, do not release so the same session ID smoothly continues
    try {
      if (sessionStorage.getItem("lemlib_reload_in_progress") === "true") return;
    } catch (_) {}

    if (currentUser && instanceStatus === "ACTIVE") {
      try {
        fetch(getApiUrl("/api/session/release"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid: currentUser.uid || "",
            email: currentUser.email || "",
            sessionId: SESSION_ID
          }),
          keepalive: true
        }).catch(() => {});
      } catch (_) {}
    }
  });

  // Public API
  const SessionGuard = {
    sessionId: SESSION_ID,
    init: function (config = {}) {
      if (config.pageName) pageName = config.pageName;
      injectStyles();

      if (config.onDeactivated) listeners.onDeactivated.push(config.onDeactivated);
      if (config.onActivated) listeners.onActivated.push(config.onActivated);
      if (config.onStatusChange) listeners.onStatusChange.push(config.onStatusChange);

      // Check if user is already saved in localStorage
      try {
        const cachedRaw = localStorage.getItem("lemlib_saved_google_user") || localStorage.getItem("vex_auth_user_cache");
        if (cachedRaw) {
          const cachedUser = JSON.parse(cachedRaw);
          if (cachedUser && (cachedUser.uid || cachedUser.email)) {
            checkSessionStatus(cachedUser);
          }
        }
      } catch (_) {}
    },

    setUser: function (user) {
      if (user) {
        checkSessionStatus(user);
      } else {
        currentUser = null;
        instanceStatus = "UNAUTHENTICATED";
        stopHeartbeat();
        removeModal("lemlib-conflict-modal");
        removeModal("lemlib-lockout-overlay");
      }
    },

    isInstanceActive: function () {
      // If user is not authenticated, local actions are allowed
      if (!currentUser || instanceStatus === "UNAUTHENTICATED") return true;
      return instanceStatus === "ACTIVE";
    },

    getStatus: function () {
      return instanceStatus;
    },

    takeOver: function () {
      return takeOverSession();
    },

    disconnect: function () {
      return disconnectThisInstance();
    },

    onDeactivated: function (fn) {
      if (typeof fn === "function") listeners.onDeactivated.push(fn);
    },

    onActivated: function (fn) {
      if (typeof fn === "function") listeners.onActivated.push(fn);
    }
  };

  global.SessionGuard = SessionGuard;

  // Auto-initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectStyles();
    });
  } else {
    injectStyles();
  }
})(typeof window !== "undefined" ? window : this);
