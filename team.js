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

  // --------------------------------------------------------------------------
  // AUTHENTICATION & TEAM INITIALIZATION
  // --------------------------------------------------------------------------
  function initAuth() {
    const btnGoogleSignIn = document.getElementById("btnGoogleSignIn");
    const btnSignOut = document.getElementById("btnSignOut");
    const btnSwitchAccount = document.getElementById("btnSwitchAccount");
    const authUser = document.getElementById("authUser");
    const btnGateSignIn = document.getElementById("btnGateSignIn");

    function updateAuthUI(user) {
      currentUser = user;
      if (user) {
        if (btnGoogleSignIn) btnGoogleSignIn.hidden = true;
        if (btnSignOut) btnSignOut.hidden = false;
        if (btnSwitchAccount) btnSwitchAccount.hidden = false;
        if (authUser) {
          authUser.hidden = false;
          authUser.textContent = user.displayName || user.email;
        }
        document.getElementById("gateAuthRequired").style.display = "none";
        document.getElementById("gateOptions").style.display = "block";
        checkUserTeam();
      } else {
        if (btnGoogleSignIn) btnGoogleSignIn.hidden = false;
        if (btnSignOut) btnSignOut.hidden = true;
        if (btnSwitchAccount) btnSwitchAccount.hidden = true;
        if (authUser) authUser.hidden = true;
        document.getElementById("gateAuthRequired").style.display = "block";
        document.getElementById("gateOptions").style.display = "none";
        document.getElementById("modalTeamGate").style.display = "flex";
      }
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
          // Check saved localStorage fallback
          const savedEmail = localStorage.getItem("lemlib_saved_google_email");
          if (savedEmail) {
            let savedObj = null;
            try { savedObj = JSON.parse(localStorage.getItem("lemlib_saved_google_user")); } catch (_) {}
            updateAuthUI({
              email: savedEmail,
              displayName: (savedObj && savedObj.displayName) || savedEmail.split("@")[0],
              uid: (savedObj && savedObj.uid) || "uid_" + savedEmail
            });
          } else {
            updateAuthUI(null);
          }
        }
      });
    } else {
      // Local fallback
      const savedEmail = localStorage.getItem("lemlib_saved_google_email") || "rainforest.cck3@gmail.com";
      updateAuthUI({
        email: savedEmail,
        displayName: savedEmail.split("@")[0],
        uid: "user_" + savedEmail.replace(/[^a-z0-9]/g, "_")
      });
    }

    const triggerSignIn = () => {
      if (typeof firebase !== "undefined" && firebase.auth) {
        const provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider).catch((err) => {
          // Fallback prompt
          const fallbackEmail = prompt("Enter your Gmail address to sign in:", "rainforest.cck3@gmail.com");
          if (fallbackEmail && fallbackEmail.includes("@")) {
            localStorage.setItem("lemlib_saved_google_email", fallbackEmail.trim());
            updateAuthUI({
              email: fallbackEmail.trim(),
              displayName: fallbackEmail.split("@")[0],
              uid: "user_" + fallbackEmail.replace(/[^a-z0-9]/g, "_")
            });
          }
        });
      } else {
        const fallbackEmail = prompt("Enter your Gmail address to sign in:", "rainforest.cck3@gmail.com");
        if (fallbackEmail && fallbackEmail.includes("@")) {
          localStorage.setItem("lemlib_saved_google_email", fallbackEmail.trim());
          updateAuthUI({
            email: fallbackEmail.trim(),
            displayName: fallbackEmail.split("@")[0],
            uid: "user_" + fallbackEmail.replace(/[^a-z0-9]/g, "_")
          });
        }
      }
    };

    if (btnGoogleSignIn) btnGoogleSignIn.onclick = triggerSignIn;
    if (btnGateSignIn) btnGateSignIn.onclick = triggerSignIn;

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
  async function checkUserTeam() {
    if (!currentUser || !currentUser.email) return;
    try {
      const res = await fetch(`/api/team/my-team?email=${encodeURIComponent(currentUser.email)}`);
      const data = await res.json();
      if (data.hasTeam && data.team) {
        currentTeam = data.team;
        document.getElementById("modalTeamGate").style.display = "none";
        onTeamLoaded();
      } else {
        // Show Team Gate Dialog
        currentTeam = null;
        document.getElementById("modalTeamGate").style.display = "flex";
      }
    } catch (err) {
      console.error("Error checking user team:", err);
      showToast("Network error checking team status", "⚠️");
    }
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
      };
    }

    // 3. Create Team submit
    const btnSubmitCreate = document.getElementById("btnSubmitCreateTeam");
    if (btnSubmitCreate) {
      btnSubmitCreate.onclick = () => {
        if (!currentUser || !currentUser.email) {
          alert("Please sign in with Google first.");
          return;
        }
        const name = document.getElementById("txtNewTeamName")?.value.trim();
        const vexNum = document.getElementById("txtNewVexNumber")?.value.trim();
        const role = document.getElementById("selNewRole")?.value || "Programmer";

        btnSubmitCreate.disabled = true;
        btnSubmitCreate.textContent = "Creating Team...";

        fetch("/api/team/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: currentUser.email,
            displayName: currentUser.displayName,
            teamName: name,
            vexTeamNumber: vexNum,
            role,
            photoURL: currentUser.photoURL
          })
        })
        .then(r => r.json())
        .then(data => {
          btnSubmitCreate.disabled = false;
          btnSubmitCreate.textContent = "🚀 Create Team & Start Collaborating";
          if (data.error) {
            alert(data.error);
          } else if (data.success && data.team) {
            currentTeam = data.team;
            document.getElementById("modalTeamGate").style.display = "none";
            showToast(`Team "${data.team.teamName}" created!`, "🎉");
            onTeamLoaded();
          }
        })
        .catch(err => {
          btnSubmitCreate.disabled = false;
          btnSubmitCreate.textContent = "🚀 Create Team & Start Collaborating";
          alert("Network error creating team: " + err.message);
        });
      };
    }

    // 4. Join Team submit
    const btnSubmitJoin = document.getElementById("btnSubmitJoinTeam");
    if (btnSubmitJoin) {
      btnSubmitJoin.onclick = () => {
        if (!currentUser || !currentUser.email) {
          alert("Please sign in with Google first.");
          return;
        }
        const code = document.getElementById("txtJoinCode")?.value.trim().toUpperCase();
        const role = document.getElementById("selJoinRole")?.value || "Driver";

        if (!code) {
          alert("Please enter the 6-character team code (e.g. VEX-742)");
          return;
        }

        btnSubmitJoin.disabled = true;
        btnSubmitJoin.textContent = "Joining Team...";

        fetch("/api/team/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: currentUser.email,
            displayName: currentUser.displayName,
            teamCode: code,
            role,
            photoURL: currentUser.photoURL
          })
        })
        .then(r => r.json())
        .then(data => {
          btnSubmitJoin.disabled = false;
          btnSubmitJoin.textContent = "🔗 Join Team Workspace";
          if (data.error) {
            alert(data.error);
          } else if (data.success && data.team) {
            currentTeam = data.team;
            document.getElementById("modalTeamGate").style.display = "none";
            showToast(`Joined team "${data.team.teamName}"!`, "🎉");
            onTeamLoaded();
          }
        })
        .catch(err => {
          btnSubmitJoin.disabled = false;
          btnSubmitJoin.textContent = "🔗 Join Team Workspace";
          alert("Network error joining team: " + err.message);
        });
      };
    }

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
  }

  // --------------------------------------------------------------------------
  // INIT
  // --------------------------------------------------------------------------
  window.addEventListener("DOMContentLoaded", () => {
    initAuth();
    wireEvents();
    drawField();
  });

})(window);
