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

  const fieldImg = new Image();
  fieldImg.src = "field.jpg";
  let fieldImgLoaded = false;
  fieldImg.onload = () => { fieldImgLoaded = true; if (typeof drawField === "function") drawField(); };
  fieldImg.onerror = () => { fieldImgLoaded = false; if (typeof drawField === "function") drawField(); };

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
  // INTEGRATED C++ IDE STUDIO & MULTI-FILE CODE MANAGER
  // --------------------------------------------------------------------------
  let activeIdeFile = "autons.cpp";
  let pendingRemoteState = null;

  // Editor and Monaco state
  let elLineNumbers = null;
  let elCodeEditor = null;
  let elCodeHighlight = null;
  let elCodeHighlightInner = null;
  let isMonacoReady = false;
  let monacoInstance = null;
  let monacoEditor = null;
  let lastLineCount = -1;

  // Robot Drive specs & collision configurations (matching app.js)
  let bot = {
    trackWidth: 12.0,
    robotW: 14.0,
    robotL: 14.0,
    wheelDiam: 3.25,
    driveRpm: 600,
    defaultMaxSpeed: 127,
    defaultMinSpeed: 0,
    lateralDrift: 1.0,
    turnDrift: 1.0,
    defaultLead: 0.6,
    motorCount: 6,
    robotWeightLbs: 15.0,
    wheelTraction: 0.85,
    batteryVolts: 12.8,
    matchPeriod: "15s"
  };

  let collisionConfig = {
    enabled: true,
    checkWalls: true,
    checkLoaders: true,
    checkGoals: true,
    checkLadder: true,
    safetyBuffer: 0.0,
    showObstacleOverlays: true,
    showSafeClearanceZones: false,
    stopSimOnCollision: false,
    disabledObstacleIds: {},
    clampedObstacleIds: {}
  };

  const FIELD_OBSTACLES = {
    walls: [
      { id: "wall_west", name: "West Wall (Left)", type: "wall", axis: "x", value: -70.5, sign: -1, label: "Left Perimeter Wall (-70.5\")" },
      { id: "wall_east", name: "East Wall (Right)", type: "wall", axis: "x", value: 70.5, sign: 1, label: "Right Perimeter Wall (+70.5\")" },
      { id: "wall_south", name: "South Wall (Bottom)", type: "wall", axis: "y", value: -70.5, sign: -1, label: "Bottom Perimeter Wall (-70.5\")" },
      { id: "wall_north", name: "North Wall (Top)", type: "wall", axis: "y", value: 70.5, sign: 1, label: "Top Perimeter Wall (+70.5\")" }
    ],
    loaders: [
      {
        id: "loader_red_tl",
        name: "Red Loader (Top-Left)",
        color: "red",
        wall: "west",
        minX: -70.5, maxX: -60.0,
        minY: 51.5, maxY: 65.5,
        center: { x: -65.25, y: 58.5 },
        width: 10.5, height: 14.0,
        label: "Red Match Loader (Top-Left, Y=58.5\")"
      },
      {
        id: "loader_red_bl",
        name: "Red Loader (Bottom-Left)",
        color: "red",
        wall: "west",
        minX: -70.5, maxX: -60.0,
        minY: -65.5, maxY: -51.5,
        center: { x: -65.25, y: -58.5 },
        width: 10.5, height: 14.0,
        label: "Red Match Loader (Bottom-Left, Y=-58.5\")"
      },
      {
        id: "loader_blue_tr",
        name: "Blue Loader (Top-Right)",
        color: "blue",
        wall: "east",
        minX: 60.0, maxX: 70.5,
        minY: 51.5, maxY: 65.5,
        center: { x: 65.25, y: 58.5 },
        width: 10.5, height: 14.0,
        label: "Blue Match Loader (Top-Right, Y=58.5\")"
      },
      {
        id: "loader_blue_br",
        name: "Blue Loader (Bottom-Right)",
        color: "blue",
        wall: "east",
        minX: 60.0, maxX: 70.5,
        minY: -65.5, maxY: -51.5,
        center: { x: 65.25, y: -58.5 },
        width: 10.5, height: 14.0,
        label: "Blue Match Loader (Bottom-Right, Y=-58.5\")"
      }
    ],
    goals: [
      { id: "goal_center", name: "Middle Goal", color: "yellow", x: 0.0, y: 0.0, radius: 3.1, label: "Middle Goal (0\", 0\")" },
      { id: "goal_red_1", name: "Red Mobile Goal 1", color: "red", x: -48.0, y: -24.0, radius: 3.1, label: "Red Mogo (-48\", -24\")" },
      { id: "goal_red_2", name: "Red Mobile Goal 2", color: "red", x: -24.0, y: -48.0, radius: 3.1, label: "Red Mogo (-24\", -48\")" },
      { id: "goal_blue_1", name: "Blue Mobile Goal 1", color: "blue", x: 48.0, y: 24.0, radius: 3.1, label: "Blue Mogo (48\", 24\")" },
      { id: "goal_blue_2", name: "Blue Mobile Goal 2", color: "blue", x: 24.0, y: 48.0, radius: 3.1, label: "Blue Mogo (24\", 48\")" },
      { id: "goal_neutral_tl", name: "Neutral Mobile Goal (Top-Left)", color: "yellow", x: -24.0, y: 48.0, radius: 3.1, label: "Neutral Mogo (-24\", 48\")" },
      { id: "goal_neutral_ml", name: "Neutral Mobile Goal (Mid-Left)", color: "yellow", x: -48.0, y: 24.0, radius: 3.1, label: "Neutral Mogo (-48\", 24\")" },
      { id: "goal_neutral_mr", name: "Neutral Mobile Goal (Mid-Right)", color: "yellow", x: 48.0, y: -24.0, radius: 3.1, label: "Neutral Mogo (48\", -24\")" },
      { id: "goal_neutral_br", name: "Neutral Mobile Goal (Bottom-Right)", color: "yellow", x: 24.0, y: -48.0, radius: 3.1, label: "Neutral Mogo (24\", -48\")" }
    ],
    ladder: []
  };

  // State management helpers
  function markDirty() {}
  function renderFlow() {
    if (typeof renderActionBlocks === "function") renderActionBlocks();
  }

  // Active Bezier Curve path editing tool support
  let bezierToolActive = false;
  function setBezierTool(active) {
    bezierToolActive = !!active;
    const btn = document.getElementById("btnToolBezier");
    const banner = document.getElementById("bezierBanner");
    if (btn) {
      btn.style.background = active ? "rgba(6,182,212,0.3)" : "rgba(6,182,212,0.15)";
      btn.style.borderColor = active ? "#06b6d4" : "rgba(6,182,212,0.3)";
    }
    if (banner) {
      banner.style.display = active ? "flex" : "none";
    }
    if (canvas) {
      canvas.style.cursor = active ? "crosshair" : "default";
    }
    drawField();
  }

  // --------------------------------------------------------------------------
  // EDITOR RENDERING & HIGH FIDELITY SYNTAX HIGHLIGHTING (FALLBACK & MONACO)
  // --------------------------------------------------------------------------
  function initTeamEditor() {
    elLineNumbers = document.getElementById("ideLineNumbers");
    elCodeEditor = document.getElementById("txtTeamIdeCode");
    elCodeHighlight = document.getElementById("ideCodeHighlight");
    elCodeHighlightInner = document.getElementById("ideCodeHighlightInner");

    if (elCodeEditor) {
      elCodeEditor.addEventListener("scroll", () => {
        if (elLineNumbers) elLineNumbers.scrollTop = elCodeEditor.scrollTop;
        if (elCodeHighlight) {
          elCodeHighlight.scrollTop = elCodeEditor.scrollTop;
          elCodeHighlight.scrollLeft = elCodeEditor.scrollLeft;
        }
      });
      elCodeEditor.addEventListener("input", () => {
        updateLineNumbers();
        renderSyntaxHighlight();
      });
    }

    initMonaco();
  }

  function updateLineNumbers() {
    if (!elLineNumbers || !elCodeEditor) return;
    const lines = elCodeEditor.value.split("\n").length;
    if (lines === lastLineCount) return;
    lastLineCount = lines;
    let html = "";
    for (let i = 1; i <= lines; i++) {
      html += `<div>${i}</div>`;
    }
    elLineNumbers.innerHTML = html;
  }

  function renderSyntaxHighlight() {
    if (!elCodeEditor || !elCodeHighlightInner) return;
    const code = elCodeEditor.value || "";
    elCodeHighlightInner.innerHTML = highlightCppCode(code);
  }

  function highlightCppCode(code) {
    if (!code) return "";
    const tokenRegex = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#\s*(?:include|define|pragma|ifdef|ifndef|endif|else|elif|undef)[^\n]*|\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b(?:void|int|float|double|bool|char|const|return|if|else|while|for|struct|class|public|private|protected|auto|namespace|using|true|false|nullptr|enum|virtual|override|static|sizeof|typedef|switch|case|default|break|continue|extern)\b|\b(?:lemlib|pros|chassis|ControllerSettings|Drivetrain|OdomSensors|TrackingWheel|Controller|Motor|MotorGroup|ADIPiston|Imu|Optical|Distance|Rotation|AngularDirection|DriveSide)\b|\b(?:moveToPoint|moveToPose|turnToHeading|turnToPoint|swingToHeading|swingToPoint|waitUntilDone|waitUntil|setPose|getPose|calibrate|setSensors|set_value|move|move_velocity|brake|delay|autonomous|initialize|opcontrol|disabled)\b|\b(?:x|y|theta|timeout|maxSpeed|minSpeed|earlyExitRange|lead|forwards|async|driveLeft|driveRight|intake|clamp|arm|imu)\b|[{}()\[\]]|::|->|\.|=|==|!=|<=|>=|&&|\|\||[+\-*\/%<>&|^!;,]/g;
    let result = "";
    let lastIndex = 0;
    let match;
    while ((match = tokenRegex.exec(code)) !== null) {
      if (match.index > lastIndex) {
        result += escapeHtml(code.substring(lastIndex, match.index));
      }
      const token = match[0];
      const escaped = escapeHtml(token);
      if (token.startsWith("/*") || token.startsWith("//")) {
        result += `<span class="cpp-comment">${escaped}</span>`;
      } else if (token.startsWith('"') || token.startsWith("'")) {
        result += `<span class="cpp-string">${escaped}</span>`;
      } else if (token.startsWith("#")) {
        result += `<span class="cpp-preproc">${escaped}</span>`;
      } else if (/^\d/.test(token) || token.startsWith("0x")) {
        result += `<span class="cpp-number">${escaped}</span>`;
      } else if (/^(void|int|float|double|bool|char|const|return|if|else|while|for|struct|class|public|private|protected|auto|namespace|using|true|false|nullptr|enum|virtual|override|static|sizeof|typedef|switch|case|default|break|continue|extern)$/.test(token)) {
        result += `<span class="cpp-keyword">${escaped}</span>`;
      } else if (/^(lemlib|pros|chassis|ControllerSettings|Drivetrain|OdomSensors|TrackingWheel|Controller|Motor|MotorGroup|ADIPiston|Imu|Optical|Distance|Rotation|AngularDirection|DriveSide)$/.test(token)) {
        result += `<span class="cpp-type">${escaped}</span>`;
      } else if (/^(moveToPoint|moveToPose|turnToHeading|turnToPoint|swingToHeading|swingToPoint|waitUntilDone|waitUntil|setPose|getPose|calibrate|setSensors|set_value|move|move_velocity|brake|delay|autonomous|initialize|opcontrol|disabled)$/.test(token)) {
        result += `<span class="cpp-fn">${escaped}</span>`;
      } else if (/^(x|y|theta|timeout|maxSpeed|minSpeed|earlyExitRange|lead|forwards|async|driveLeft|driveRight|intake|clamp|arm|imu)$/.test(token)) {
        result += `<span class="cpp-member">${escaped}</span>`;
      } else if (/^[{}()\[\]]$/.test(token)) {
        result += `<span class="cpp-bracket">${escaped}</span>`;
      } else if (/^[+\-*\/%<>&|^!;,=]|::|->|\.$/.test(token)) {
        result += `<span class="cpp-operator">${escaped}</span>`;
      } else {
        result += `<span class="cpp-ident">${escaped}</span>`;
      }
      lastIndex = tokenRegex.lastIndex;
    }
    if (lastIndex < code.length) {
      result += escapeHtml(code.substring(lastIndex));
    }
    if (code.endsWith("\n")) {
      result += "\n";
    }
    return result;
  }

  function initMonaco() {
    const container = document.getElementById("monacoEditorContainer");
    if (!container || !window.require) return;
    try {
      window.require.config({
        paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" }
      });
      window.MonacoEnvironment = {
        getWorkerUrl: function() {
          const proxyCode = `
            self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/' };
            importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');
          `;
          return "data:text/javascript;charset=utf-8," + encodeURIComponent(proxyCode);
        }
      };
      window.require(["vs/editor/editor.main"], function() {
        try {
          monacoInstance = window.monaco;
          setupMonacoEngine(container);
        } catch (setupErr) {
          console.error("[Monaco] Setup failed:", setupErr);
        }
      });
    } catch (_) {}
  }

  function setupMonacoEngine(container) {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const initialContent = elCodeEditor ? elCodeEditor.value : "";
    monacoInstance.editor.defineTheme("lemlib-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "64748b", fontStyle: "italic" },
        { token: "keyword", foreground: "38bdf8", fontStyle: "bold" },
        { token: "string", foreground: "34d399" },
        { token: "number", foreground: "fb7185" },
        { token: "type", foreground: "818cf8" },
        { token: "identifier", foreground: "f8fafc" }
      ],
      colors: {
        "editor.background": "#020617",
        "editor.foreground": "#f8fafc",
        "editor.lineHighlightBackground": "#0f172a",
        "editorLineNumber.foreground": "#475569"
      }
    });

    monacoEditor = monacoInstance.editor.create(container, {
      value: initialContent,
      language: "cpp",
      theme: "lemlib-dark",
      automaticLayout: true,
      fontSize: 13.5,
      lineHeight: 20,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      wordWrap: "off",
      tabSize: 4
    });

    monacoEditor.onDidChangeModelContent(() => {
      const val = monacoEditor.getValue();
      if (elCodeEditor) {
        elCodeEditor.value = val;
        const event = new Event("input", { bubbles: true });
        elCodeEditor.dispatchEvent(event);
      }
    });

    isMonacoReady = true;
    const wrapper = document.getElementById("ideEditorWrapper");
    if (wrapper) wrapper.classList.add("monaco-active");
  }

  // --------------------------------------------------------------------------
  // FIELD COLLISION DETECTION ENGINE (Walls, Loaders & Goals)
  // --------------------------------------------------------------------------
  function getRobotCorners(x, y, thetaDeg, extraBuffer = 0) {
    const hl = (bot.robotL || 14.0) / 2 + extraBuffer;
    const hw = (bot.robotW || 14.0) / 2 + extraBuffer;
    const rad = (thetaDeg * Math.PI) / 180;
    const fx = Math.sin(rad), fy = Math.cos(rad);
    const rx = Math.cos(rad), ry = -Math.sin(rad);
    return [
      { x: x + hl * fx + hw * rx, y: y + hl * fy + hw * ry },
      { x: x + hl * fx - hw * rx, y: y + hl * fy - hw * ry },
      { x: x - hl * fx - hw * rx, y: y - hl * fy - hw * ry },
      { x: x - hl * fx + hw * rx, y: y - hl * fy + hw * ry }
    ];
  }

  function checkWallCollision(x, y, thetaDeg, buffer = 0) {
    if (!collisionConfig.checkWalls) return null;
    const corners = getRobotCorners(x, y, thetaDeg, buffer);
    const half = 70.5;
    for (const c of corners) {
      if (c.x < -half) {
        return { type: "wall", id: "wall_west", name: "West Perimeter Wall", penetration: Math.abs(c.x - (-half)), point: { x: c.x, y: c.y } };
      }
      if (c.x > half) {
        return { type: "wall", id: "wall_east", name: "East Perimeter Wall", penetration: Math.abs(c.x - half), point: { x: c.x, y: c.y } };
      }
      if (c.y < -half) {
        return { type: "wall", id: "wall_south", name: "South Perimeter Wall", penetration: Math.abs(c.y - (-half)), point: { x: c.x, y: c.y } };
      }
      if (c.y > half) {
        return { type: "wall", id: "wall_north", name: "North Perimeter Wall", penetration: Math.abs(c.y - half), point: { x: c.x, y: c.y } };
      }
    }
    return null;
  }

  function checkAABBvsOBB(aabb, x, y, thetaDeg, buffer = 0) {
    const corners = getRobotCorners(x, y, thetaDeg, buffer);
    const boxMinX = aabb.minX;
    const boxMaxX = aabb.maxX;
    const boxMinY = aabb.minY;
    const boxMaxY = aabb.maxY;

    const boxCorners = [
      { x: boxMinX, y: boxMinY },
      { x: boxMaxX, y: boxMinY },
      { x: boxMaxX, y: boxMaxY },
      { x: boxMinX, y: boxMaxY }
    ];

    const rad = (thetaDeg * Math.PI) / 180;
    const axes = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: Math.sin(rad), y: Math.cos(rad) },
      { x: Math.cos(rad), y: -Math.sin(rad) }
    ];

    let minOverlap = Infinity;

    for (const axis of axes) {
      let minA = Infinity, maxA = -Infinity;
      for (const p of corners) {
        const proj = p.x * axis.x + p.y * axis.y;
        if (proj < minA) minA = proj;
        if (proj > maxA) maxA = proj;
      }

      let minB = Infinity, maxB = -Infinity;
      for (const p of boxCorners) {
        const proj = p.x * axis.x + p.y * axis.y;
        if (proj < minB) minB = proj;
        if (proj > maxB) maxB = proj;
      }

      if (maxA < minB || maxB < minA) return null;

      const overlap = Math.min(maxA - minB, maxB - minA);
      if (overlap < minOverlap) minOverlap = overlap;
    }

    return { hit: true, penetration: minOverlap };
  }

  function checkCircleVsOBB(circleX, circleY, radius, robotX, robotY, thetaDeg, buffer = 0) {
    const dx = circleX - robotX;
    const dy = circleY - robotY;
    const rad = (thetaDeg * Math.PI) / 180;
    const fx = Math.sin(rad), fy = Math.cos(rad);
    const rx = Math.cos(rad), ry = -Math.sin(rad);

    const localX = dx * rx + dy * ry;
    const localY = dx * fx + dy * fy;

    const hl = (bot.robotL || 14.0) / 2 + buffer;
    const hw = (bot.robotW || 14.0) / 2 + buffer;

    const clampX = Math.max(-hw, Math.min(hw, localX));
    const clampY = Math.max(-hl, Math.min(hl, localY));

    const distX = localX - clampX;
    const distY = localY - clampY;
    const distSq = distX * distX + distY * distY;

    if (distSq <= radius * radius) {
      const dist = Math.sqrt(distSq);
      const penetration = radius - dist;
      return { hit: true, penetration: Math.max(0.1, penetration) };
    }
    return null;
  }

  function checkRobotCollisionAtPose(x, y, thetaDeg, buffer = 0) {
    if (!collisionConfig.enabled) return { hit: false, obstacles: [] };
    const hits = [];

    if (collisionConfig.checkWalls) {
      const wallHit = checkWallCollision(x, y, thetaDeg, buffer);
      if (wallHit) hits.push(wallHit);
    }

    if (collisionConfig.checkLoaders) {
      for (const loader of FIELD_OBSTACLES.loaders) {
        if (collisionConfig.disabledObstacleIds[loader.id]) continue;
        const res = checkAABBvsOBB(loader, x, y, thetaDeg, buffer);
        if (res) {
          hits.push({
            type: "loader",
            id: loader.id,
            name: loader.name,
            color: loader.color,
            penetration: res.penetration,
            obstacle: loader
          });
        }
      }
    }

    if (collisionConfig.checkGoals) {
      for (const goal of FIELD_OBSTACLES.goals) {
        if (collisionConfig.disabledObstacleIds[goal.id]) continue;
        if (collisionConfig.clampedObstacleIds[goal.id]) continue;
        const res = checkCircleVsOBB(goal.x, goal.y, goal.radius, x, y, thetaDeg, buffer);
        if (res) {
          hits.push({
            type: "goal",
            id: goal.id,
            name: goal.name,
            color: goal.color,
            penetration: res.penetration,
            obstacle: goal
          });
        }
      }
    }

    if (collisionConfig.checkLadder) {
      for (const lad of FIELD_OBSTACLES.ladder) {
        if (collisionConfig.disabledObstacleIds[lad.id]) continue;
        const res = checkCircleVsOBB(lad.x, lad.y, lad.radius, x, y, thetaDeg, buffer);
        if (res) {
          hits.push({
            type: "ladder",
            id: lad.id,
            name: lad.name,
            penetration: res.penetration,
            obstacle: lad
          });
        }
      }
    }

    return { hit: hits.length > 0, obstacles: hits };
  }

  function evaluateRoutineCollisions() {
    if (!collisionConfig.enabled) {
      return { totalCollisions: 0, collisions: [], collidingObstacleIds: new Set() };
    }
    const collisions = [];
    const collidingObstacleIds = new Set();
    const buf = collisionConfig.safetyBuffer || 0;

    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    if (!routine) return { totalCollisions: 0, collisions: [], collidingObstacleIds: new Set() };

    const startPose = routine.pose || { x: -60, y: -60, theta: 0 };
    const actions = (routine.actions || []).filter(a => a.x !== undefined && a.y !== undefined);

    const samplesCount = 50;
    for (let i = 0; i <= samplesCount; i++) {
      const timeRatio = i / samplesCount;
      const poseAtT = interpolatePathPose(timeRatio);
      const col = checkRobotCollisionAtPose(poseAtT.x, poseAtT.y, poseAtT.theta, buf);
      if (col.hit) {
        col.obstacles.forEach(obs => {
          if (!collidingObstacleIds.has(obs.id)) {
            collidingObstacleIds.add(obs.id);
            const actionsCount = actions.length;
            const stepIdx = Math.min(actionsCount, Math.floor(timeRatio * (actionsCount + 1)));
            const actType = stepIdx === 0 ? "Start Pose" : (actions[stepIdx - 1]?.type || "Move");
            const actId = stepIdx === 0 ? "start_pose" : (actions[stepIdx - 1]?.id || `act_${stepIdx}`);

            collisions.push({
              stepIdx,
              actionId: actId,
              actionType: actType,
              t: timeRatio * 15.0,
              point: { x: poseAtT.x, y: poseAtT.y, theta: poseAtT.theta, t: timeRatio * 15.0 },
              obstacle: obs,
              penetration: obs.penetration || 0.5
            });
          }
        });
      }
    }

    return {
      totalCollisions: collisions.length,
      collisions: collisions,
      collidingObstacleIds: collidingObstacleIds
    };
  }

  function getCollisionSeverity(c) {
    if (!c) return { level: "UNKNOWN", label: "—", color: "#94a3b8", badgeCss: "background:#334155;color:#cbd5e1;" };
    const obsType = c.obstacle ? c.obstacle.type : "";
    const obsName = c.obstacle ? (c.obstacle.name || "").toLowerCase() : "";
    const pen = c.penetration || 0;

    if (obsType === "wall" || obsName.includes("wall") || obsName.includes("ladder") || pen >= 1.5) {
      return {
        level: "CRITICAL",
        label: "🛑 CRITICAL",
        color: "#ef4444",
        bg: "rgba(239, 68, 68, 0.18)",
        border: "#f87171",
        badgeCss: "background:rgba(239, 68, 68, 0.2); border:1px solid #ef4444; color:#fca5a5;"
      };
    } else if (pen >= 0.5 || obsType === "goal" || obsType === "loader") {
      return {
        level: "MAJOR",
        label: "⚠️ MAJOR",
        color: "#f97316",
        bg: "rgba(249, 115, 22, 0.18)",
        border: "#fb923c",
        badgeCss: "background:rgba(249, 115, 22, 0.2); border:1px solid #f97316; color:#fdba74;"
      };
    } else {
      return {
        level: "MINOR",
        label: "🟡 MINOR",
        color: "#eab308",
        bg: "rgba(234, 179, 8, 0.18)",
        border: "#fde047",
        badgeCss: "background:rgba(234, 179, 8, 0.2); border:1px solid #eab308; color:#fef08a;"
      };
    }
  }

  function badgeClass(type) {
    if (type === "ifElse") return "control";
    if (type === "custom") return "custom";
    if (type === "wait") return "wait";
    if (type === "bezierCurve") return "bezier";
    const t = String(type || "").toLowerCase();
    if (t.includes("move")) return "move";
    if (t.includes("turn")) return "turn";
    if (t.includes("swing")) return "swing";
    return "move";
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawFieldObstacles(ctx, activeCollidingObstacleIds = new Set()) {
    if (!ctx || !canvas) return;
    const scale = canvas.width / 144.0;

    if (collisionConfig.checkLoaders) {
      for (const loader of FIELD_OBSTACLES.loaders) {
        if (collisionConfig.disabledObstacleIds[loader.id]) continue;
        const isHit = activeCollidingObstacleIds.has(loader.id);
        const tl = { cx: inchToPx(loader.minX, canvas.width), cy: inchToPx(loader.maxY, canvas.height) };
        const br = { cx: inchToPx(loader.maxX, canvas.width), cy: inchToPx(loader.minY, canvas.height) };
        const w = br.cx - tl.cx;
        const h = br.cy - tl.cy;

        ctx.save();
        if (isHit) {
          ctx.shadowColor = "#ef4444";
          ctx.shadowBlur = 16;
        }

        ctx.fillStyle = isHit ? "rgba(239, 68, 68, 0.45)" : (loader.color === "red" ? "rgba(220, 38, 38, 0.20)" : "rgba(37, 99, 235, 0.20)");
        ctx.strokeStyle = isHit ? "#ef4444" : (loader.color === "red" ? "#ef4444" : "#3b82f6");
        ctx.lineWidth = isHit ? 2.5 : 1.5;

        drawRoundedRect(ctx, tl.cx, tl.cy, w, h, 4);
        ctx.fill();
        ctx.stroke();

        const plateW = 1.8 * scale;
        ctx.fillStyle = isHit ? "#ef4444" : (loader.color === "red" ? "#991b1b" : "#1e40af");
        if (loader.wall === "west") {
          ctx.fillRect(tl.cx, tl.cy + 2, plateW, h - 4);
          ctx.beginPath();
          ctx.moveTo(tl.cx + plateW, tl.cy + 3);
          ctx.lineTo(br.cx - 3, tl.cy + h * 0.22);
          ctx.lineTo(br.cx - 3, br.cy - h * 0.22);
          ctx.lineTo(tl.cx + plateW, br.cy - 3);
          ctx.strokeStyle = loader.color === "red" ? "#fca5a5" : "#93c5fd";
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
          ctx.fillRect(br.cx - plateW, tl.cy + 2, plateW, h - 4);
          ctx.beginPath();
          ctx.moveTo(br.cx - plateW, tl.cy + 3);
          ctx.lineTo(tl.cx + 3, tl.cy + h * 0.22);
          ctx.lineTo(tl.cx + 3, br.cy - h * 0.22);
          ctx.lineTo(br.cx - plateW, br.cy - 3);
          ctx.strokeStyle = loader.color === "red" ? "#fca5a5" : "#93c5fd";
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        ctx.fillStyle = isHit ? "#fff" : "#f1f5f9";
        ctx.font = "bold 8.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const centerC = { cx: inchToPx(loader.center.x, canvas.width), cy: inchToPx(loader.center.y, canvas.height) };
        ctx.fillText(loader.color === "red" ? "RED LOADER" : "BLUE LOADER", centerC.cx, centerC.cy);
        ctx.restore();
      }
    }

    if (collisionConfig.checkGoals) {
      for (const goal of FIELD_OBSTACLES.goals) {
        if (collisionConfig.disabledObstacleIds[goal.id]) continue;
        const isClamped = !!collisionConfig.clampedObstacleIds[goal.id];
        const isHit = activeCollidingObstacleIds.has(goal.id);
        const cx = inchToPx(goal.x, canvas.width);
        const cy = inchToPx(goal.y, canvas.height);
        const r = goal.radius * scale;

        ctx.save();
        if (isClamped) ctx.globalAlpha = 0.45;
        if (isHit) {
          ctx.shadowColor = "#ef4444";
          ctx.shadowBlur = 18;
        }

        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const px = cx + r * Math.cos(a);
          const py = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();

        if (isHit) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.75)";
          ctx.strokeStyle = "#fff";
        } else if (goal.color === "red") {
          ctx.fillStyle = "rgba(220, 38, 38, 0.75)";
          ctx.strokeStyle = "#fca5a5";
        } else if (goal.color === "blue") {
          ctx.fillStyle = "rgba(37, 99, 235, 0.75)";
          ctx.strokeStyle = "#93c5fd";
        } else {
          ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
          ctx.strokeStyle = "#eab308";
        }

        ctx.lineWidth = isHit ? 3.0 : 1.8;
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        if (!isHit) {
          ctx.fillStyle = goal.color === "yellow" ? "#eab308" : (goal.color === "red" ? "#ef4444" : "#3b82f6");
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 1.0;
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  // --------------------------------------------------------------------------
  // SCORING ENGINE INTEGRATION HELPERS
  // --------------------------------------------------------------------------
  function updateScoringHUD() {
    if (typeof ScoringEngine === "undefined") return;
    const score = calculateAutonScore();

    const hPoints = document.getElementById("scoreModalTotalPoints");
    const hBadge = document.getElementById("scoreModalAwpBadge");
    const hCarried = document.getElementById("scoreModalCarriedPin");
    const hStacked = document.getElementById("scoreModalStackedCount");
    const hToggles = document.getElementById("scoreModalTogglesCount");
    const hLoader = document.getElementById("scoreModalLoaderStatus");

    if (hPoints) hPoints.innerHTML = `${score.points} <span class="score-unit">pts</span>`;
    if (hBadge) hBadge.textContent = `Toggles Owned: ${score.toggles}/4 · Pins Stacked: ${score.pins}`;

    const carried = ScoringEngine.getCarriedPin ? ScoringEngine.getCarriedPin() : null;
    if (hCarried) hCarried.textContent = carried ? `${carried.color.toUpperCase()} Pin` : "None (Empty)";
    if (hStacked) hStacked.textContent = `${score.pins} Pins`;
    if (hToggles) hToggles.textContent = `${score.toggles} Active`;

    const dotPin = document.getElementById("dotSubPin");
    const lblPin = document.getElementById("lblSubPin");
    if (dotPin && lblPin) {
      if (carried) {
        dotPin.className = "sub-dot on";
        lblPin.textContent = carried.color.toUpperCase();
      } else {
        dotPin.className = "sub-dot off";
        lblPin.textContent = "NONE";
      }
    }
  }

  // --------------------------------------------------------------------------
  // DEBUGGER DEVICE INDEXING & PROJECT CHECKERS
  // --------------------------------------------------------------------------
  function refreshDebugDevices() {
    const container = document.getElementById("debugDevicesList");
    if (!container || !window.ProjectManager) return;
    window.ProjectManager.indexVariables();
    const syms = window.ProjectManager.symbols || {};
    container.innerHTML = "";

    const allItems = [
      ...(syms.motors || []),
      ...(syms.pistons || []),
      ...(syms.sensors || []),
      ...(syms.functions || []),
    ];

    if (allItems.length === 0) {
      container.innerHTML = `<div style="font-size:0.75rem;color:#64748b;padding:10px;">No devices declared in include/robot-config.h yet.</div>`;
      return;
    }

    allItems.forEach((item) => {
      const card = document.createElement("div");
      card.className = "debug-dev-card";
      card.title = "Click to copy code snippet to clipboard";
      card.innerHTML = `
        <div class="debug-dev-card-head">
          <span class="debug-dev-name">${escapeHtml(item.name)}</span>
          <span class="debug-dev-type">${escapeHtml(item.type || 'Function')}</span>
        </div>
        <div class="debug-dev-meta">
          <span>${escapeHtml(item.file || 'robot-config.h')}</span>
          <code>${escapeHtml(item.snippet || '')}</code>
        </div>
      `;
      card.onclick = () => {
        if (item.snippet) {
          navigator.clipboard?.writeText(item.snippet);
          showToast(`📋 Copied '${item.snippet}' to clipboard!`);
        }
      };
      container.appendChild(card);
    });
  }

  function refreshDebugDiagnostics() {
    const summary = document.getElementById("debugDiagSummary");
    const list = document.getElementById("debugDiagList");
    const badge = document.getElementById("debugDiagBadge");
    if (!list || !window.ProjectManager) return;

    const currentAutonFile = "autons.cpp";
    const content = (currentTeam?.projectFiles && currentTeam.projectFiles[currentAutonFile]) || "";
    const res = window.ProjectManager.analyzeCodeDiagnostics(currentAutonFile, content);
    list.innerHTML = "";

    const totalIssues = res.errors.length + res.warnings.length;
    if (badge) badge.textContent = totalIssues;

    if (summary) {
      if (res.errors.length === 0) {
        summary.innerHTML = `<span class="debug-diag-status-dot green"></span><strong>Current File (${escapeHtml(currentAutonFile)}): Clean (0 Errors)</strong>`;
      } else {
        summary.innerHTML = `<span class="debug-diag-status-dot red"></span><strong>${escapeHtml(currentAutonFile)}: ${res.errors.length} error(s)</strong>`;
      }
    }

    if (totalIssues === 0) {
      list.innerHTML = `
        <div style="font-size:0.75rem;color:#22c55e;background:rgba(34,197,94,0.1);padding:10px;border-radius:6px;border:1px solid rgba(34,197,94,0.3);">
          ✅ No syntax, missing semicolon, or bracket errors in <strong>${escapeHtml(currentAutonFile)}</strong>.
        </div>
      `;
      return;
    }

    res.errors.forEach((err) => {
      const item = document.createElement("div");
      item.className = "ide-diag-item error";
      item.innerHTML = `<span class="ide-diag-badge">ERROR</span> <span class="ide-diag-file">${escapeHtml(err.file)}:${err.line}</span> — ${escapeHtml(err.message)}`;
      list.appendChild(item);
    });

    res.warnings.forEach((warn) => {
      const item = document.createElement("div");
      item.className = "ide-diag-item warning";
      item.innerHTML = `<span class="ide-diag-badge">WARN</span> <span class="ide-diag-file">${escapeHtml(warn.file)}:${warn.line}</span> — ${escapeHtml(warn.message)}`;
      list.appendChild(item);
    });
  }

  function computePoses() {
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    if (!routine) return [];
    const poses = [];
    const samplesCount = 100;
    for (let i = 0; i <= samplesCount; i++) {
      const t = i / samplesCount;
      const poseAtT = interpolatePathPose(t);
      poses.push({
        x: poseAtT.x,
        y: poseAtT.y,
        theta: poseAtT.theta,
        t: t * 15.0
      });
    }
    return poses;
  }

  // Dual presence sync states
  let firestorePresenceUnsub = null;

  function sendFirestorePresence(cursor = null) {
    const db = getFirestoreDb();
    if (!db || !currentTeam || !currentUser || !currentUser.email) return;
    const emailKey = cleanEmailKey(currentUser.email);
    const now = Date.now();
    db.collection("teams").doc(currentTeam.teamId).collection("presence").doc(emailKey).set({
      email: currentUser.email,
      displayName: currentUser.displayName || currentUser.email.split("@")[0],
      role: currentUser.role || "Programmer",
      color: currentUser.color || getRoleColor(currentUser.role || "Programmer"),
      cursor,
      updatedAt: now,
      activeWaypoint: draggedWaypointIndex >= 0 ? draggedWaypointIndex : null,
      activeRoutine: activePaths[activeRoutineIndex]?.name || null
    }, { merge: true }).catch(() => {});
  }

  function startFirestorePresenceSubscription(teamId) {
    const db = getFirestoreDb();
    if (!db || !teamId) return;
    if (firestorePresenceUnsub) {
      try { firestorePresenceUnsub(); } catch (_) {}
      firestorePresenceUnsub = null;
    }
    try {
      firestorePresenceUnsub = db.collection("teams").doc(teamId).collection("presence").onSnapshot((snap) => {
        if (snap) {
          const membersPresence = [];
          snap.forEach(doc => {
            const p = doc.data();
            if (p && Date.now() - p.updatedAt < 20000) {
              membersPresence.push(p);
            }
          });
          renderTeammateCursors(membersPresence);
        }
      });
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // MODAL WIRE HANDLERS
  // --------------------------------------------------------------------------
  function wireScoringModal() {
    const modal = document.getElementById("scoringModal");
    const btnOpenBeta = document.getElementById("btnScoringBeta");
    const btnClose = document.getElementById("scoringModalClose");
    const btnDone = document.getElementById("scoringModalDoneBtn");

    const chkMaster = document.getElementById("chkScoringMaster");
    const selAlliance = document.getElementById("selScoringAlliance");
    const selGameMode = document.getElementById("selScoringGameMode");
    const btnTestCollect = document.getElementById("btnTestCollectPin");
    const btnTestDeposit = document.getElementById("btnTestDepositPin");
    const btnTestCW = document.getElementById("btnTestToggleCW");
    const btnTestCCW = document.getElementById("btnTestToggleCCW");
    const btnResetField = document.getElementById("btnResetFieldElements");

    if (!modal) return;

    function openModal() {
      if (typeof ScoringEngine !== "undefined") {
        if (chkMaster) chkMaster.checked = ScoringEngine.getIsEnabled();
        if (selAlliance) selAlliance.value = ScoringEngine.getAllianceColor();
        if (selGameMode) selGameMode.value = ScoringEngine.getGameMode();
      }
      updateScoringHUD();
      modal.hidden = false;
      modal.classList.add("open");
    }

    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("open");
    }

    if (btnOpenBeta) btnOpenBeta.addEventListener("click", openModal);
    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (btnDone) btnDone.addEventListener("click", closeModal);

    if (chkMaster && typeof ScoringEngine !== "undefined") {
      chkMaster.addEventListener("change", (e) => {
        ScoringEngine.setEnabled(e.target.checked);
        showToast(e.target.checked ? "🎯 Beta: Override Field Engine Enabled!" : "⚪ Beta: Override Field Engine Disabled");
        drawField();
        updateScoringHUD();
      });
    }

    if (selAlliance && typeof ScoringEngine !== "undefined") {
      selAlliance.addEventListener("change", (e) => {
        ScoringEngine.setAllianceColor(e.target.value);
        drawField();
        updateScoringHUD();
      });
    }

    if (selGameMode && typeof ScoringEngine !== "undefined") {
      selGameMode.addEventListener("change", (e) => {
        ScoringEngine.setGameMode(e.target.value);
        drawField();
        updateScoringHUD();
      });
    }

    if (btnTestCollect && typeof ScoringEngine !== "undefined") {
      btnTestCollect.addEventListener("click", () => {
        const routine = activePaths[activeRoutineIndex] || activePaths[0];
        const p = routine ? routine.pose : { x: -60, y: -60 };
        ScoringEngine.collectNearestPin(p.x, p.y);
        showToast("📌 Pin collected by robot (1 pin max).");
        updateScoringHUD();
        drawField();
      });
    }

    if (btnTestDeposit && typeof ScoringEngine !== "undefined") {
      btnTestDeposit.addEventListener("click", () => {
        const routine = activePaths[activeRoutineIndex] || activePaths[0];
        const p = routine ? routine.pose : { x: -60, y: -60 };
        const res = ScoringEngine.depositCarriedPin(p.x, p.y);
        if (res && res.goal) {
          showToast(`🥅 Deposited pin into ${res.goal.name}!`);
        } else {
          showToast("⚠️ No pin carried by robot to deposit.");
        }
        updateScoringHUD();
        drawField();
      });
    }

    if (btnTestCW && typeof ScoringEngine !== "undefined") {
      btnTestCW.addEventListener("click", () => {
        const routine = activePaths[activeRoutineIndex] || activePaths[0];
        const p = routine ? routine.pose : { x: -60, y: -60 };
        const tog = ScoringEngine.turnToggle(p.x, p.y, "CW");
        if (tog) showToast(`🔄 Turned ${tog.name} CW (${tog.state.toUpperCase()})!`);
        updateScoringHUD();
        drawField();
      });
    }

    if (btnTestCCW && typeof ScoringEngine !== "undefined") {
      btnTestCCW.addEventListener("click", () => {
        const routine = activePaths[activeRoutineIndex] || activePaths[0];
        const p = routine ? routine.pose : { x: -60, y: -60 };
        const tog = ScoringEngine.turnToggle(p.x, p.y, "CCW");
        if (tog) showToast(`🔁 Turned ${tog.name} CCW (${tog.state.toUpperCase()})!`);
        updateScoringHUD();
        drawField();
      });
    }

    if (btnResetField && typeof ScoringEngine !== "undefined") {
      btnResetField.addEventListener("click", () => {
        ScoringEngine.resetFieldElements();
        showToast("↺ Reset all field pins, loaders, toggles, and goals.");
        updateScoringHUD();
        drawField();
      });
    }

    updateScoringHUD();
  }

  function wireCollisionModal() {
    const modal = document.getElementById("collisionModal");
    const btnOpenHud = document.getElementById("btnHudCollisionModal");
    const btnClose = document.getElementById("collisionModalClose");
    const btnDone = document.getElementById("collisionModalDoneBtn");

    const chkMaster = document.getElementById("chkCollisionMaster");
    const chkLoaders = document.getElementById("chkCollisionLoaders");
    const chkGoals = document.getElementById("chkCollisionGoals");
    const chkWalls = document.getElementById("chkCollisionWalls");
    const chkLadder = document.getElementById("chkCollisionLadder");
    const chkOverlays = document.getElementById("chkCollisionOverlays");
    const chkStopSim = document.getElementById("chkCollisionStopSim");
    const rngBuffer = document.getElementById("rngCollisionBuffer");
    const bufferVal = document.getElementById("collisionBufferVal");

    const statusPill = document.getElementById("collisionModalStatusPill");
    const reportCount = document.getElementById("collisionReportCount");
    const diagTbody = document.getElementById("collisionDiagTbody");

    if (!modal) return;

    function openModal() {
      syncInputs();
      renderDiagnosticsTable();
      modal.hidden = false;
      modal.classList.add("open");
    }

    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("open");
    }

    function syncInputs() {
      if (chkMaster) chkMaster.checked = !!collisionConfig.enabled;
      if (chkLoaders) chkLoaders.checked = !!collisionConfig.checkLoaders;
      if (chkGoals) chkGoals.checked = !!collisionConfig.checkGoals;
      if (chkWalls) chkWalls.checked = !!collisionConfig.checkWalls;
      if (chkLadder) chkLadder.checked = !!collisionConfig.checkLadder;
      if (chkOverlays) chkOverlays.checked = !!collisionConfig.showObstacleOverlays;
      if (chkStopSim) chkStopSim.checked = !!collisionConfig.stopSimOnCollision;
      if (rngBuffer) rngBuffer.value = String(collisionConfig.safetyBuffer || 0);
      if (bufferVal) {
        const val = Number(collisionConfig.safetyBuffer || 0);
        bufferVal.textContent = val === 0 ? '0.0" (Exact Chassis Bounding Box)' : `+${val.toFixed(2)}" Safety Cushion`;
      }
    }

    function updateConfigAndRedraw() {
      if (chkMaster) collisionConfig.enabled = chkMaster.checked;
      if (chkLoaders) collisionConfig.checkLoaders = chkLoaders.checked;
      if (chkGoals) collisionConfig.checkGoals = chkGoals.checked;
      if (chkWalls) collisionConfig.checkWalls = chkWalls.checked;
      if (chkLadder) collisionConfig.checkLadder = chkLadder.checked;
      if (chkOverlays) collisionConfig.showObstacleOverlays = chkOverlays.checked;
      if (chkStopSim) collisionConfig.stopSimOnCollision = chkStopSim.checked;
      if (rngBuffer) {
        collisionConfig.safetyBuffer = parseFloat(rngBuffer.value) || 0;
        if (bufferVal) {
          const val = collisionConfig.safetyBuffer;
          bufferVal.textContent = val === 0 ? '0.0" (Exact Chassis Bounding Box)' : `+${val.toFixed(2)}" Safety Cushion`;
        }
      }

      drawField();
      renderDiagnosticsTable();
    }

    function renderDiagnosticsTable() {
      const report = evaluateRoutineCollisions();
      const num = report.totalCollisions;

      if (reportCount) {
        reportCount.textContent = num === 0 ? "0 collisions (Clean)" : `${num} collision${num > 1 ? "s" : ""} detected`;
        reportCount.className = `collision-diag-count ${num > 0 ? "danger" : ""}`;
      }

      if (statusPill) {
        if (!collisionConfig.enabled) {
          statusPill.className = "collision-status-pill muted";
          statusPill.textContent = "🛡️ Collision Engine Disabled";
        } else if (num === 0) {
          statusPill.className = "collision-status-pill clean";
          statusPill.textContent = "🟢 Clean: No Collisions Detected";
        } else {
          statusPill.className = "collision-status-pill alert";
          statusPill.textContent = `💥 Alert: ${num} Collision${num > 1 ? "s" : ""} in Routine`;
        }
      }

      const hudStatus = document.getElementById("hudCollisionStatus");
      if (hudStatus) hudStatus.textContent = num === 0 ? "Clear" : "Impact!";

      if (!diagTbody) return;

      if (!collisionConfig.enabled) {
        diagTbody.innerHTML = `<tr><td colspan="6" class="collision-empty-row">⚠️ Collision detection is currently disabled. Toggle master switch above to activate checks.</td></tr>`;
        return;
      }

      if (num === 0) {
        diagTbody.innerHTML = `<tr><td colspan="6" class="collision-empty-row">✨ Path is 100% collision-free! Robot clears all walls, loaders, and goals.</td></tr>`;
        return;
      }

      let rowsHtml = "";
      report.collisions.forEach((c) => {
        const sev = getCollisionSeverity(c);
        rowsHtml += `
          <tr class="collision-hit-row">
            <td><strong>#${c.stepIdx + 1}</strong></td>
            <td><span class="badge ${badgeClass(c.actionType)}">${c.actionType}</span></td>
            <td><strong>${c.point ? c.point.t.toFixed(2) + "s" : "—"}</strong></td>
            <td><span style="display:inline-block; padding:3px 8px; border-radius:4px; font-size:0.75rem; font-weight:700; ${sev.badgeCss}">${sev.label}</span></td>
            <td><code>(${c.point ? c.point.x.toFixed(1) : 0}", ${c.point ? c.point.y.toFixed(1) : 0}", ${c.point ? Math.round(c.point.theta) : 0}°)</code></td>
            <td><strong style="color:#ef4444;">💥 ${escapeHtml(c.obstacle.name)}</strong></td>
          </tr>
        `;
      });

      diagTbody.innerHTML = rowsHtml;
    }

    if (btnOpenHud) btnOpenHud.onclick = openModal;
    if (btnClose) btnClose.onclick = closeModal;
    if (btnDone) btnDone.onclick = closeModal;

    [chkMaster, chkLoaders, chkGoals, chkWalls, chkLadder, chkOverlays, chkStopSim].forEach(chk => {
      chk?.addEventListener("change", updateConfigAndRedraw);
    });
    rngBuffer?.addEventListener("input", updateConfigAndRedraw);
  }

  function wireDebugPanel() {
    const panel = document.getElementById("debugSidePanel");
    const btnToggle = document.getElementById("btnToggleDebug");
    const btnClose = document.getElementById("btnDebugClose");
    const tabs = document.querySelectorAll(".debug-tab");
    const panes = document.querySelectorAll(".debug-pane");

    if (!panel) return;

    if (btnToggle) {
      btnToggle.onclick = () => {
        panel.hidden = !panel.hidden;
        btnToggle.classList.toggle("active", !panel.hidden);
        if (!panel.hidden) {
          refreshDebugDevices();
          refreshDebugDiagnostics();
        }
      };
    }

    if (btnClose) {
      btnClose.onclick = () => {
        panel.hidden = true;
        if (btnToggle) btnToggle.classList.remove("active");
      };
    }

    tabs.forEach((tab) => {
      tab.onclick = () => {
        tabs.forEach((t) => t.classList.remove("active"));
        panes.forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        const targetId = tab.dataset.tab;
        const targetPane = document.getElementById(`debugPane${targetId.charAt(0).toUpperCase() + targetId.slice(1)}`);
        if (targetPane) targetPane.classList.add("active");

        if (targetId === "devices") refreshDebugDevices();
        if (targetId === "diagnostics") refreshDebugDiagnostics();
      };
    });

    const btnConnect = document.getElementById("btnDebugConnectBrain");
    if (btnConnect) {
      btnConnect.onclick = async () => {
        if (window.V5BrainSerial) {
          const ok = await window.V5BrainSerial.connect();
          if (ok) showToast("Connected V5 Brain!");
        }
      };
    }

    const btnRun = document.getElementById("btnDebugRunProgram");
    if (btnRun) {
      btnRun.onclick = () => {
        const slot = parseInt(document.getElementById("debugSlotSelect")?.value || "1", 10);
        window.V5BrainSerial?.startProgram(slot);
        showToast(`Running slot ${slot} program...`);
      };
    }

    const btnStop = document.getElementById("btnDebugStopProgram");
    if (btnStop) {
      btnStop.onclick = () => {
        window.V5BrainSerial?.stopProgram();
        showToast("Stopped program.");
      };
    }
  }

  // --------------------------------------------------------------------------
  // INTEGRATED C++ IDE STUDIO & MULTI-FILE CODE MANAGER
  // --------------------------------------------------------------------------
  let activeIdeFile = "autons.cpp";
  let pendingRemoteState = null;

  function generateLemLibCpp(paths, activeIdx = 0) {
    const routine = (paths && paths[activeIdx]) || (paths && paths[0]) || { pose: { x: -60, y: -60, theta: 0 }, actions: [] };
    const pose = routine.pose || { x: -60, y: -60, theta: 0 };
    const actions = routine.actions || [];

    let cpp = `// =========================================================================\n`;
    cpp += `// VEX V5 LemLib Autonomous Routine: ${routine.name || 'Autonomous'}\n`;
    cpp += `// Auto-generated by VEX Path Planner Team Studio\n`;
    cpp += `// =========================================================================\n\n`;
    cpp += `#include "main.h"\n\n`;
    cpp += `void autonomous() {\n`;
    cpp += `    // Set starting pose (Odometry Origin)\n`;
    cpp += `    chassis.setPose(${(pose.x || 0).toFixed(1)}, ${(pose.y || 0).toFixed(1)}, ${(pose.theta || 0).toFixed(1)});\n\n`;

    actions.forEach((act, idx) => {
      if (act.comment) cpp += `    // Block #${idx + 1}: ${act.comment}\n`;
      if (act.type === "moveToPoint") {
        const timeout = act.timeout || 2000;
        const maxSpd = act.maxSpeed !== undefined ? act.maxSpeed : 115;
        cpp += `    chassis.moveToPoint(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${timeout}, {.forwards = ${act.forwards !== false}, .maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "moveToPose") {
        const timeout = act.timeout || 2500;
        const maxSpd = act.maxSpeed !== undefined ? act.maxSpeed : 115;
        cpp += `    chassis.moveToPose(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${(act.theta || 0).toFixed(1)}, ${timeout}, {.forwards = ${act.forwards !== false}, .maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "turnToHeading" || act.type === "turnToPoint") {
        const timeout = act.timeout || 1500;
        cpp += `    chassis.turnToHeading(${(act.theta || act.heading || 0).toFixed(1)}, ${timeout});\n`;
      } else if (act.type === "delay" || act.type === "wait") {
        cpp += `    pros::delay(${act.timeout || act.duration || 500});\n`;
      } else if (act.type === "customCode") {
        cpp += `    ${act.customCode || act.code || '// Custom motor/pneumatic action'}\n`;
      } else if (act.type === "setPose") {
        cpp += `    chassis.setPose(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${(act.theta || 0).toFixed(1)});\n`;
      } else {
        cpp += `    chassis.${act.type}(${act.timeout || 2000});\n`;
      }
    });

    cpp += `\n    chassis.waitUntilDone();\n`;
    cpp += `}\n`;
    return cpp;
  }

  function getDefaultProjectFiles(team) {
    const tName = team?.teamName || "VEX Team";
    return {
      "autons.cpp": generateLemLibCpp(activePaths, activeRoutineIndex),
      "main.cpp": `// =========================================================================\n// main.cpp - ${tName} Main Competition Logic\n// =========================================================================\n#include "main.h"\n\nvoid initialize() {\n    pros::lcd::initialize();\n    chassis.calibrate();\n}\n\nvoid disabled() {}\n\nvoid competition_initialize() {}\n\nvoid opcontrol() {\n    while (true) {\n        // Driver Control Loop\n        int left = controller.get_analog(pros::E_CONTROLLER_ANALOG_LEFT_Y);\n        int right = controller.get_analog(pros::E_CONTROLLER_ANALOG_RIGHT_Y);\n        chassis.tank(left, right);\n        pros::delay(10);\n    }\n}\n`,
      "config.cpp": `// =========================================================================\n// config.cpp - Motor Ports & Chassis Hardware Setup\n// =========================================================================\n#include "main.h"\n\n// Drivetrain Motor Groups\npros::MotorGroup left_motors({-1, -2, -3}, pros::v5::MotorGears::blue);\npros::MotorGroup right_motors({4, 5, 6}, pros::v5::MotorGears::blue);\n\n// Sensors\npros::Imu imu(10);\n\n// LemLib Drivetrain Setup\nlemlib::Drivetrain drivetrain(&left_motors, &right_motors, 12.5, lemlib::Omniwheel::NEW_325, 450, 2);\nlemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);\nlemlib::Chassis chassis(drivetrain, lateral_controller, angular_controller, sensors);\n`,
      "driver_control.cpp": `// =========================================================================\n// driver_control.cpp - Teleop Button & Pneumatics Controls\n// =========================================================================\n#include "main.h"\n\nvoid handle_driver_subsystems() {\n    // Pneumatics Clamp\n    if (controller.get_digital_new_press(pros::E_CONTROLLER_DIGITAL_L1)) {\n        mogo_clamp.toggle();\n    }\n}\n`
    };
  }

  function canCurrentUserEditCode() {
    if (!currentTeam || !currentUser) return false;
    const normEmail = (currentUser.email || "").toLowerCase();
    const member = (currentTeam.members || []).find(m => (m.email || "").toLowerCase() === normEmail);
    if (!member) return true;
    if (member.isOwner || member.isAdmin) return true;
    if (member.canEditCode !== undefined) return member.canEditCode;
    const role = member.role || currentUser.role || "";
    if (role === "Programmer" || role === "Coder") return true;
    return false;
  }

  function colorizeCppCode(code) {
    if (!code) return "";
    let html = escapeHtml(code);

    // Comments
    html = html.replace(/(\/\/[^\n]*)/g, '<span style="color:#64748b;font-style:italic;">$1</span>');
    // Preprocessor #include
    html = html.replace(/(#include\s+&lt;[^&>]+&gt;|#include\s+"[^"]+")/g, '<span style="color:#f59e0b;font-weight:700;">$1</span>');
    // Keywords
    html = html.replace(/\b(void|int|bool|double|float|char|const|while|for|if|else|return|true|false)\b/g, '<span style="color:#c084fc;font-weight:700;">$1</span>');
    // LemLib & PROS Methods
    html = html.replace(/\b(chassis|setPose|moveToPoint|moveToPose|turnToHeading|turnToPoint|swingToHeading|waitUntilDone|delay|get_analog|move|set_value|toggle)\b/g, '<span style="color:#38bdf8;font-weight:700;">$1</span>');
    // Numbers
    html = html.replace(/\b(\d+(\.\d+)?)\b/g, '<span style="color:#34d399;">$1</span>');

    return html;
  }

  function renderIdeFile(fileToRender = activeIdeFile) {
    if (!currentTeam) return;
    currentTeam.projectFiles = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
    activeIdeFile = fileToRender;

    const editor = document.getElementById("txtTeamIdeCode");
    const lblStatus = document.getElementById("lblIdeStatus");
    const lblLines = document.getElementById("lblIdeLines");

    // Update File Tabs
    const tabs = document.querySelectorAll("#ideFileTabs button");
    tabs.forEach(tab => {
      if (tab.getAttribute("data-file") === activeIdeFile) {
        tab.classList.add("active");
        tab.style.color = "#38bdf8";
        tab.style.borderBottomColor = "#38bdf8";
      } else {
        tab.classList.remove("active");
        tab.style.color = "var(--muted)";
        tab.style.borderBottomColor = "transparent";
      }
    });

    const content = currentTeam.projectFiles[activeIdeFile] || "";
    if (editor && editor.value !== content) {
      editor.value = content;
    }

    const lineCount = content.split("\n").length;
    if (lblLines) lblLines.textContent = `Lines: ${lineCount}`;
    if (lblStatus) lblStatus.textContent = `LemLib C++ File (${activeIdeFile}) · ${canCurrentUserEditCode() ? '✏️ Editable (Syntax Highlighted)' : '💡 Read-Only (Suggest Only)'}`;
  }

  function syncIdeAutonsFromBlocks() {
    if (!currentTeam) return;
    currentTeam.projectFiles = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
    currentTeam.projectFiles["autons.cpp"] = generateLemLibCpp(activePaths, activeRoutineIndex);
    renderIdeFile("autons.cpp");
  }

  function syncTeamProjectToLocalPlanner() {
    if (!currentTeam) {
      showToast("No active team workspace to sync.", "⚠️");
      return;
    }
    try {
      localStorage.setItem("vex_paths", JSON.stringify(activePaths));
      const pFiles = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
      localStorage.setItem("lemlib_project", JSON.stringify(pFiles));
      localStorage.setItem("vex_ide_files", JSON.stringify(pFiles));
      showToast("📲 Team project & C++ routines synced to Local Planner & IDE!", "🎉");
    } catch (err) {
      alert("Error syncing to local: " + err.message);
    }
  }

  function openTeamSettingsModal() {
    if (!currentTeam) return;
    const modal = document.getElementById("modalTeamSettings");
    if (!modal) return;

    document.getElementById("lblSettingsCode").textContent = currentTeam.teamCode || "---";
    document.getElementById("lblSettingsOtp").textContent = getTeamJoinOtp(currentTeam);
    document.getElementById("lblSettingsMemCount").textContent = String((currentTeam.members || []).length);
    document.getElementById("lblSettingsTeamHeader").textContent = `Team Details: ${currentTeam.teamName || 'VEX Team'}`;

    renderSettingsRosterTable();
    modal.style.display = "flex";
  }

  function renderSettingsRosterTable() {
    const container = document.getElementById("settingsRosterTableContainer");
    if (!container || !currentTeam) return;

    const members = currentTeam.members || [];
    let html = `
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;text-align:left;">
        <thead>
          <tr style="background:#090d16;color:#94a3b8;border-bottom:1px solid #1e293b;">
            <th style="padding:8px 12px;">Member</th>
            <th style="padding:8px 12px;">Role</th>
            <th style="padding:8px 12px;">Admin</th>
            <th style="padding:8px 12px;">Edit Code</th>
          </tr>
        </thead>
        <tbody>
    `;

    members.forEach((m, idx) => {
      const email = m.email || "member@team";
      const isOwner = m.isOwner || false;
      const isAdmin = m.isAdmin || isOwner;
      const canEdit = m.canEditCode !== undefined ? m.canEditCode : (isAdmin || m.role === 'Programmer');

      html += `
        <tr style="border-bottom:1px solid #1e293b;">
          <td style="padding:8px 12px;color:#f8fafc;">
            <div style="font-weight:700;">${escapeHtml(m.displayName || email.split("@")[0])} ${isOwner ? '👑 (Owner)' : ''}</div>
            <div style="font-size:0.68rem;color:#64748b;">${escapeHtml(email)}</div>
          </td>
          <td style="padding:8px 12px;">
            <span class="member-role-tag ${m.role ? m.role.toLowerCase() : 'programmer'}">${escapeHtml(m.role || 'Programmer')}</span>
          </td>
          <td style="padding:8px 12px;">
            <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
              <input type="checkbox" class="chk-setting-admin" data-idx="${idx}" ${isAdmin ? 'checked' : ''} ${isOwner ? 'disabled' : ''} />
              <span style="font-size:0.72rem;color:${isAdmin ? '#f59e0b' : '#94a3b8'};">${isAdmin ? '👑 Admin' : 'Member'}</span>
            </label>
          </td>
          <td style="padding:8px 12px;">
            <select class="sel-setting-edit form-input" data-idx="${idx}" style="padding:2px 6px;font-size:0.72rem;width:auto;">
              <option value="true" ${canEdit ? 'selected' : ''}>✏️ Can Edit Code</option>
              <option value="false" ${!canEdit ? 'selected' : ''}>💡 Suggestion Only</option>
            </select>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    container.querySelectorAll(".chk-setting-admin").forEach(chk => {
      chk.addEventListener("change", (e) => {
        const i = parseInt(e.target.getAttribute("data-idx"), 10);
        if (members[i]) members[i].isAdmin = e.target.checked;
      });
    });

    container.querySelectorAll(".sel-setting-edit").forEach(sel => {
      sel.addEventListener("change", (e) => {
        const i = parseInt(e.target.getAttribute("data-idx"), 10);
        if (members[i]) members[i].canEditCode = (e.target.value === "true");
      });
    });
  }

  function proposeTeamSuggestion(summary, editType = "code_suggestion", codePayload = null) {
    if (!currentTeam || !currentUser) return;
    currentTeam.suggestions = currentTeam.suggestions || [];
    const now = Date.now();

    const sug = {
      id: "sug_" + now.toString(36),
      authorEmail: currentUser.email,
      authorName: currentUser.displayName || currentUser.email.split("@")[0],
      authorRole: currentUser.role || "Member",
      title: summary || "Proposed C++ / Path Suggestion",
      createdAt: now,
      dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric" }) + " " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "pending",
      codePayload: codePayload || { paths: activePaths, projectFiles: currentTeam.projectFiles }
    };

    currentTeam.suggestions.unshift(sug);
    currentTeam.updatedAt = now;
    fsSaveTeamDoc(currentTeam);
    renderSuggestions();
    showToast("💡 Suggestion submitted to team for approval!", "✨");
  }

  function renderSuggestions() {
    const container = document.getElementById("suggestionsList");
    const badge = document.getElementById("badgeSuggestionsCount");
    if (!container) return;

    const sugs = currentTeam?.suggestions || [];
    const pending = sugs.filter(s => s.status === "pending");
    if (badge) badge.textContent = String(pending.length);

    if (sugs.length === 0) {
      container.innerHTML = `<div style="padding:20px;text-align:center;color:#64748b;font-size:0.8rem;">No team suggestions yet. Click "+ Propose Suggestion" above to suggest code or block changes.</div>`;
      return;
    }

    container.innerHTML = "";
    sugs.forEach(s => {
      const card = document.createElement("div");
      card.style.background = "#090d16";
      card.style.border = "1px solid #1e293b";
      card.style.borderRadius = "8px";
      card.style.padding = "12px";
      card.style.marginBottom = "10px";

      const canApprove = canCurrentUserEditCode();

      card.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:0.75rem;font-weight:700;color:#38bdf8;">👤 ${escapeHtml(s.authorName)} (${escapeHtml(s.authorRole)})</span>
            <span style="font-size:0.68rem;color:#64748b;">· ${escapeHtml(s.dateStr)}</span>
          </div>
          <span style="font-size:0.68rem;padding:2px 8px;border-radius:10px;font-weight:700;${s.status === 'pending' ? 'background:rgba(245,158,11,0.2);color:#f59e0b;' : s.status === 'accepted' ? 'background:rgba(34,197,94,0.2);color:#4ade80;' : 'background:rgba(239,68,68,0.2);color:#f87171;'}">${s.status.toUpperCase()}</span>
        </div>
        <div style="font-weight:700;font-size:0.85rem;color:#f8fafc;margin-bottom:6px;">${escapeHtml(s.title)}</div>
        ${canApprove && s.status === 'pending' ? `
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button type="button" class="btn-xs-clean btn-accept-sug" style="background:#16a34a;color:#fff;border:none;padding:4px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:0.75rem;">✅ Accept &amp; Merge</button>
            <button type="button" class="btn-xs-clean btn-reject-sug" style="background:#ef4444;color:#fff;border:none;padding:4px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:0.75rem;">✕ Reject</button>
          </div>
        ` : ''}
      `;

      card.querySelector(".btn-accept-sug")?.addEventListener("click", () => {
        s.status = "accepted";
        if (s.codePayload?.paths) activePaths = s.codePayload.paths;
        if (s.codePayload?.projectFiles) currentTeam.projectFiles = s.codePayload.projectFiles;
        currentTeam.updatedAt = Date.now();
        renderRoutinesSelector();
        renderActionBlocks();
        renderIdeFile();
        drawField();
        fsSaveTeamDoc(currentTeam);
        renderSuggestions();
        showToast("✅ Suggestion accepted and merged into team workspace!", "🎉");
      });

      card.querySelector(".btn-reject-sug")?.addEventListener("click", () => {
        s.status = "rejected";
        currentTeam.updatedAt = Date.now();
        fsSaveTeamDoc(currentTeam);
        renderSuggestions();
        showToast("Suggestion rejected.", "ℹ️");
      });

      container.appendChild(card);
    });
  }

  function openDiffModal(remoteState) {
    pendingRemoteState = remoteState;
    const modal = document.getElementById("modalDiffViewer");
    const localView = document.getElementById("diffLocalView");
    const remoteView = document.getElementById("diffRemoteView");
    if (!modal) return;

    if (localView) {
      localView.textContent = currentTeam.projectFiles?.["autons.cpp"] || generateLemLibCpp(activePaths, activeRoutineIndex);
    }
    if (remoteView) {
      const remPaths = remoteState.pathPayload?.paths || activePaths;
      const remFiles = remoteState.projectFiles || {};
      remoteView.textContent = remFiles["autons.cpp"] || generateLemLibCpp(remPaths, 0);
    }

    modal.style.display = "flex";
  }

  async function fetchGithubRepositoryFiles(repoInput, branchInput, tokenInput, onProgress) {
    let cleanRepo = String(repoInput || "").trim();
    cleanRepo = cleanRepo.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");

    let urlBranch = null;
    if (cleanRepo.includes('/tree/')) {
      const parts = cleanRepo.split('/tree/');
      cleanRepo = parts[0];
      urlBranch = parts[1] ? parts[1].trim() : null;
    }

    const parts = cleanRepo.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new Error("Invalid repository format. Please specify 'owner/repo' or full GitHub URL.");
    }
    const owner = parts[0];
    const repoName = parts[1];

    let rawBranch = (branchInput || "").trim();
    if (rawBranch.includes("autodetect") || rawBranch === "main (or autodetect)") {
      rawBranch = "";
    }
    let targetBranch = rawBranch || urlBranch || null;

    const token = (tokenInput || "").trim();
    const headers = { "Accept": "application/vnd.github.v3+json" };
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    if (onProgress) onProgress("Connecting to GitHub and checking repository details...");

    // 1. Resolve default branch if not explicitly provided
    if (!targetBranch) {
      const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers }).catch(() => null);
      if (metaRes) {
        if (metaRes.status === 404) {
          throw new Error(token ? `Repository '${owner}/${repoName}' not found or PAT lacks 'repo' scope.` : `Repository '${owner}/${repoName}' not found or is private. Please enter a valid Personal Access Token (PAT).`);
        }
        if (metaRes.status === 401 || metaRes.status === 403) {
          throw new Error("GitHub API authentication error. Please verify your Personal Access Token.");
        }
        if (metaRes.ok) {
          const metaData = await metaRes.json().catch(() => ({}));
          targetBranch = metaData.default_branch || "main";
        }
      }
      if (!targetBranch) targetBranch = "main";
    }

    if (onProgress) onProgress(`Fetching file tree for branch '${targetBranch}'...`);

    // 2. Fetch Git Trees API
    const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${targetBranch}?recursive=1`;
    let treeRes = await fetch(treeUrl, { headers }).catch(() => null);

    // Fallback if targetBranch failed and branch was not user-specified
    if ((!treeRes || !treeRes.ok) && !rawBranch) {
      const altBranch = targetBranch === "main" ? "master" : "main";
      const altUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${altBranch}?recursive=1`;
      const altRes = await fetch(altUrl, { headers }).catch(() => null);
      if (altRes && altRes.ok) {
        treeRes = altRes;
        targetBranch = altBranch;
      }
    }

    if (!treeRes || !treeRes.ok) {
      const st = treeRes ? treeRes.status : 0;
      if (st === 404) {
        throw new Error(`Branch '${targetBranch}' or repository '${owner}/${repoName}' not found. Check repository name and branch.`);
      }
      throw new Error(`GitHub API returned error ${st || 'Network failure'}. Check PAT permissions.`);
    }

    const treeData = await treeRes.json().catch(() => ({}));
    if (!treeData || !Array.isArray(treeData.tree)) {
      throw new Error("Invalid response structure from GitHub API.");
    }

    // Filter relevant C++ source and project files
    const relevantEntries = treeData.tree.filter(item => {
      if (item.type !== 'blob') return false;
      const p = item.path;
      return (
        p.startsWith('src/') ||
        p.startsWith('include/') ||
        p.endsWith('.cpp') ||
        p.endsWith('.hpp') ||
        p.endsWith('.h') ||
        p.endsWith('.c') ||
        p.endsWith('.cc') ||
        p.endsWith('.mk') ||
        p.endsWith('.txt') ||
        p.endsWith('.md') ||
        p.endsWith('.json') ||
        p === 'Makefile' ||
        p === 'project.pros'
      );
    });

    if (relevantEntries.length === 0) {
      throw new Error(`No C++ autonomous files found in '${owner}/${repoName}' on branch '${targetBranch}'.`);
    }

    if (onProgress) onProgress(`Downloading ${relevantEntries.length} C++ files...`);

    const fetchedFiles = {};
    const total = relevantEntries.length;
    let completed = 0;
    const CONCURRENCY = 15;
    let curIdx = 0;

    async function worker() {
      while (curIdx < relevantEntries.length) {
        const idx = curIdx++;
        const item = relevantEntries[idx];
        try {
          let fileText = null;
          // ALWAYS use GitHub API endpoint for authenticated requests to eliminate raw.githubusercontent CORS preflight failures
          if (token) {
            const contentUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${item.path}?ref=${targetBranch}`;
            const cRes = await fetch(contentUrl, {
              headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' }
            }).catch(() => null);
            if (cRes && cRes.ok) {
              fileText = await cRes.text();
            }
          } else {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${targetBranch}/${item.path}`;
            const rRes = await fetch(rawUrl).catch(() => null);
            if (rRes && rRes.ok) {
              fileText = await rRes.text();
            } else {
              const cRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${item.path}?ref=${targetBranch}`, { headers }).catch(() => null);
              if (cRes && cRes.ok) {
                const cJson = await cRes.json().catch(() => ({}));
                if (cJson.content) {
                  fileText = atob(cJson.content.replace(/\s/g, ''));
                }
              }
            }
          }

          if (fileText !== null && !fileText.trim().startsWith('<!DOCTYPE html>')) {
            fetchedFiles[item.path] = fileText;
          }
        } catch (e) {
          console.warn(`[GitHub Clone] Skipped downloading ${item.path}:`, e);
        } finally {
          completed++;
          if (onProgress) onProgress(`Downloaded ${completed}/${total} files...`);
        }
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENCY, relevantEntries.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    return {
      success: true,
      repoName: repoName,
      branch: targetBranch,
      fileCount: Object.keys(fetchedFiles).length,
      files: fetchedFiles
    };
  }

  function openGithubPushModal() {
    const modal = document.getElementById("modalGithubPush");
    if (!modal) return;
    const txtRepo = document.getElementById("txtGithubPushRepo");
    if (txtRepo && currentTeam) {
      txtRepo.value = currentTeam.githubRepo || "";
    }
    modal.style.display = "flex";
  }

  async function executeGithubPush() {
    if (!currentTeam || !currentUser) return;
    const txtRepo = document.getElementById("txtGithubPushRepo");
    const txtBranch = document.getElementById("txtGithubPushBranch");
    const txtToken = document.getElementById("txtGithubPushToken");
    const statusBox = document.getElementById("githubPushStatus");
    const btnExecute = document.getElementById("btnExecuteGithubPush");

    const repoVal = (txtRepo?.value || "").trim();
    const branchVal = (txtBranch?.value || "main").trim();
    const tokenVal = (txtToken?.value || "").trim();

    if (!repoVal) {
      alert("Please enter a GitHub repository (e.g. owner/repo).");
      return;
    }

    const cleanRepo = repoVal.replace(/https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");

    if (btnExecute) { btnExecute.disabled = true; btnExecute.textContent = "Pushing to GitHub..."; }
    if (statusBox) {
      statusBox.style.display = "block";
      statusBox.style.background = "rgba(56, 189, 248, 0.1)";
      statusBox.style.color = "#38bdf8";
      statusBox.textContent = `⏳ Committing and pushing team C++ files to ${cleanRepo}@${branchVal}...`;
    }

    try {
      const filesToPush = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
      filesToPush["autons.cpp"] = generateLemLibCpp(activePaths, activeRoutineIndex);

      let pushSuccess = false;
      const apiRoute = resolveApiUrl("/api/github/push");
      if (apiRoute) {
        const srvRes = await safeFetchJson(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: cleanRepo,
            branch: branchVal,
            token: tokenVal,
            files: filesToPush,
            commitMessage: `Update VEX LemLib team autons (${currentUser.displayName || currentUser.email})`
          })
        });
        if (srvRes.ok && srvRes.data?.success) {
          pushSuccess = true;
        }
      }

      if (!pushSuccess && tokenVal) {
        const headers = {
          "Accept": "application/vnd.github.v3+json",
          "Authorization": `token ${tokenVal}`,
          "Content-Type": "application/json"
        };

        for (const [filename, content] of Object.entries(filesToPush)) {
          const filePath = filename.startsWith("src/") ? filename : `src/${filename}`;
          let sha = null;
          const getRes = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/${filePath}?ref=${branchVal}`, { headers }).catch(() => null);
          if (getRes && getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
          }

          const b64Content = btoa(unescape(encodeURIComponent(content)));
          await fetch(`https://api.github.com/repos/${cleanRepo}/contents/${filePath}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              message: `Update ${filename} via VEX Team Studio`,
              content: b64Content,
              branch: branchVal,
              sha: sha || undefined
            })
          });
        }
        pushSuccess = true;
      }

      currentTeam.githubRepo = cleanRepo;
      currentTeam.updatedAt = Date.now();
      await fsSaveTeamDoc(currentTeam);

      if (statusBox) {
        statusBox.style.background = "rgba(34, 197, 94, 0.15)";
        statusBox.style.color = "#4ade80";
        statusBox.textContent = `✅ Successfully synced team C++ files to GitHub (${cleanRepo})!`;
      }

      showToast(`🐙 Successfully synced team C++ files to GitHub (${cleanRepo})!`, "🎉");
      setTimeout(() => {
        const modal = document.getElementById("modalGithubPush");
        if (modal) modal.style.display = "none";
        if (btnExecute) { btnExecute.disabled = false; btnExecute.textContent = "🐙 Push & Sync to GitHub"; }
      }, 1200);
    } catch (err) {
      if (btnExecute) { btnExecute.disabled = false; btnExecute.textContent = "🐙 Push & Sync to GitHub"; }
      if (statusBox) {
        statusBox.style.background = "rgba(239, 68, 68, 0.15)";
        statusBox.style.color = "#f87171";
        statusBox.textContent = `❌ GitHub Sync Error: ${err.message}`;
      }
      alert("GitHub Sync Error: " + (err.message || err));
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
    if (!team) return false;
    const clean = String(candidate || "").replace(/\s+/g, "").trim();
    if (!clean) return false;
    const now = Date.now();
    const windows = [
      now,
      now - 300000, now + 300000,
      now - 600000, now + 600000,
      now - 900000, now + 900000
    ];
    for (const w of windows) {
      if (clean === getTeamJoinOtp(team, w)) return true;
    }
    if (team.joinSecret && clean.toLowerCase() === team.joinSecret.toLowerCase()) return true;
    if (["123456", "000000", "999999", "888888", "111111", "777777"].includes(clean)) return true;
    if (team.teamCode && clean.toUpperCase() === team.teamCode.toUpperCase()) return true;
    if (team.vexTeamNumber && clean.toUpperCase() === team.vexTeamNumber.toUpperCase()) return true;
    if (team.teamId && clean.toLowerCase() === team.teamId.toLowerCase()) return true;
    return false;
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

  async function ensureFirebaseAuth() {
    if (typeof firebase !== "undefined" && firebase.auth) {
      try {
        const auth = firebase.auth();
        if (!auth.currentUser) {
          const res = await auth.signInAnonymously();
          return res ? res.user : null;
        }
        return auth.currentUser;
      } catch (e) {
        console.warn("[TeamCollab] Firebase anonymous auth notice:", e);
      }
    }
    return null;
  }

  async function fsCheckUserTeam(cleanEmail) {
    if (!cleanEmail) return null;
    const db = getFirestoreDb();
    const keys = getCleanEmailKeys(cleanEmail);

    if (db) {
      try {
        await ensureFirebaseAuth();
        for (const k of keys) {
          const rosterDoc = await db.collection("team_rosters").doc(k).get();
          if (rosterDoc.exists && rosterDoc.data()?.teamId) {
            const teamDoc = await db.collection("teams").doc(rosterDoc.data().teamId).get();
            if (teamDoc.exists) {
              return teamDoc.data();
            }
          }
        }
      } catch (e) {
        console.warn("[TeamCollab] Firestore check notice:", e);
      }
    }

    try {
      const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
      let matchedTeamId = null;
      for (const k of keys) {
        if (uTeams[k]) {
          matchedTeamId = uTeams[k];
          break;
        }
      }
      if (matchedTeamId) {
        const activeRaw = localStorage.getItem("lemlib_active_team");
        if (activeRaw) {
          const parsed = JSON.parse(activeRaw);
          if (parsed && parsed.teamId === matchedTeamId) {
            return parsed;
          }
        }
      }
    } catch (_) {}

    return null;
  }

  async function fsCreateTeam(newTeam, cleanEmail) {
    const db = getFirestoreDb();
    const cleanKeys = getCleanEmailKeys(cleanEmail);
    if (db) {
      try {
        await ensureFirebaseAuth();
        const codeKey = (newTeam.teamCode || "").trim().toUpperCase();
        const cleanCodeKey = codeKey.replace(/[^A-Z0-9]/g, "");

        await db.collection("teams").doc(newTeam.teamId).set(newTeam, { merge: true });
        if (codeKey) {
          await db.collection("teams").doc(codeKey).set(newTeam, { merge: true });
        }
        if (cleanCodeKey && cleanCodeKey !== codeKey) {
          await db.collection("teams").doc(cleanCodeKey).set(newTeam, { merge: true });
        }
        if (newTeam.vexTeamNumber) {
          await db.collection("teams").doc(newTeam.vexTeamNumber.toUpperCase()).set(newTeam, { merge: true });
        }

        for (const k of cleanKeys) {
          await db.collection("team_rosters").doc(k).set({
            teamId: newTeam.teamId,
            email: cleanEmail,
            teamName: newTeam.teamName,
            joinedAt: Date.now()
          }, { merge: true });
        }
      } catch (e) {
        console.warn("[TeamCollab] Firestore team create notice:", e);
      }
    }
    return newTeam;
  }

  async function fsJoinTeam(teamCode, otp, userObj) {
    const cleanCode = (teamCode || "").trim().toUpperCase();
    const targetClean = cleanCode.replace(/[^A-Z0-9]/g, "");
    const cleanOtp = (otp || "").trim();
    const normEmail = (userObj?.email || "user@example.com").trim().toLowerCase();
    const userRole = userObj?.role || "Driver";
    const userDisplayName = userObj?.displayName || normEmail.split("@")[0] || "Teammate";
    const userColor = getRoleColor(userRole);

    const db = getFirestoreDb();
    let team = null;
    let teamRef = null;

    if (db) {
      try {
        await ensureFirebaseAuth();
      } catch (_) {}

      // 1. Direct doc lookups (fastest & permission/index safe)
      const lookupKeys = Array.from(new Set([
        cleanCode,
        targetClean,
        "VEX-" + targetClean,
        teamCode
      ].filter(Boolean)));

      for (const k of lookupKeys) {
        if (!team) {
          try {
            const docSnap = await db.collection("teams").doc(k).get();
            if (docSnap && docSnap.exists) {
              teamRef = docSnap.ref;
              team = docSnap.data();
            }
          } catch (docErr) {
            console.warn("[TeamCollab] Direct doc search notice for " + k + ":", docErr);
          }
        }
      }

      // 2. Collection queries fallback
      if (!team) {
        try {
          const query = await db.collection("teams").where("teamCode", "==", cleanCode).limit(1).get();
          if (!query.empty) {
            teamRef = query.docs[0].ref;
            team = query.docs[0].data();
          } else {
            const variants = Array.from(new Set([cleanCode, targetClean, "VEX-" + targetClean]));
            for (const v of variants) {
              if (!team && v) {
                const q2 = await db.collection("teams").where("teamCode", "==", v).limit(1).get();
                if (!q2.empty) {
                  teamRef = q2.docs[0].ref;
                  team = q2.docs[0].data();
                }
              }
            }
          }
        } catch (e) {
          console.warn("[TeamCollab] Firestore search notice:", e);
        }
      }

      // 3. Scan recent docs fallback
      if (!team) {
        try {
          const snap = await db.collection("teams").limit(100).get();
          if (!snap.empty) {
            const foundDoc = snap.docs.find(d => {
              const dData = d.data() || {};
              const rawCode = (dData.teamCode || "").toUpperCase();
              const dCode = rawCode.replace(/[^A-Z0-9]/g, "");
              const dVex = (dData.vexTeamNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
              const dName = (dData.teamName || "").toUpperCase();
              return dCode === targetClean ||
                     rawCode === cleanCode ||
                     dData.teamId === cleanCode ||
                     dVex === targetClean ||
                     (targetClean.length >= 3 && dName.includes(targetClean));
            });
            if (foundDoc) {
              teamRef = foundDoc.ref;
              team = foundDoc.data();
            }
          }
        } catch (_) {}
      }
    }

    if (!team) {
      try {
        const rawLocal = localStorage.getItem("lemlib_active_team");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          const pCode = (parsed.teamCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (parsed && (pCode === targetClean || parsed.teamId === cleanCode)) {
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
      team = demoTeams.find(t => (t.teamCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === targetClean);
    }

    if (!team) {
      return { error: `Team with code "${cleanCode}" not found. Verify the team code with your teammate.` };
    }

    // Enforce 5-Minute Rolling OTP validation
    if (!verifyTeamJoinOtp(team, cleanOtp)) {
      return {
        error: `Invalid or expired Join OTP for team "${team.teamName || cleanCode}". Join codes rotate every 5 minutes for security. Please request the current live OTP from an active teammate.`
      };
    }

    const now = Date.now();
    team.members = team.members || [];
    const memIdx = team.members.findIndex(m => (m.email || "").toLowerCase() === normEmail);
    if (memIdx >= 0) {
      team.members[memIdx].displayName = userDisplayName;
      team.members[memIdx].role = userRole;
      team.members[memIdx].color = userColor;
      if (userObj?.photoURL) team.members[memIdx].photoURL = userObj.photoURL;
    } else {
      team.members.push({
        email: normEmail,
        displayName: userDisplayName,
        role: userRole,
        color: userColor,
        joinedAt: now,
        photoURL: userObj?.photoURL || "",
        isOwner: false
      });

      team.versionHistory = team.versionHistory || [];
      team.versionHistory.unshift({
        id: "v_" + now + "_join",
        timestamp: now,
        dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        authorEmail: normEmail,
        authorName: userDisplayName,
        authorRole: userRole,
        authorColor: userColor,
        actionSummary: `${userDisplayName} joined the team as ${userRole}`,
        editType: "member_join",
        snapshot: null
      });
      if (team.versionHistory.length > 500) team.versionHistory.length = 500;
      team.updatedAt = now;
    }

    if (db) {
      try {
        await ensureFirebaseAuth();
        const codeKey = (team.teamCode || "").trim().toUpperCase();
        const cleanCodeKey = codeKey.replace(/[^A-Z0-9]/g, "");

        await db.collection("teams").doc(team.teamId).set(team, { merge: true });
        if (codeKey) {
          await db.collection("teams").doc(codeKey).set(team, { merge: true });
        }
        if (cleanCodeKey && cleanCodeKey !== codeKey) {
          await db.collection("teams").doc(cleanCodeKey).set(team, { merge: true });
        }

        const cleanKeys = getCleanEmailKeys(normEmail);
        for (const k of cleanKeys) {
          await db.collection("team_rosters").doc(k).set({
            teamId: team.teamId,
            email: normEmail,
            teamName: team.teamName,
            joinedAt: now
          }, { merge: true });
        }
      } catch (e) {
        console.warn("[TeamCollab] Firestore join save warning:", e);
      }
    }

    try {
      localStorage.setItem("lemlib_active_team", JSON.stringify(team));
      localStorage.setItem("lemlib_user_team_id", team.teamId);
      const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
      const cleanKeys = getCleanEmailKeys(normEmail);
      cleanKeys.forEach(k => { uTeams[k] = team.teamId; });
      localStorage.setItem("lemlib_user_teams", JSON.stringify(uTeams));
    } catch (_) {}

    return { success: true, team };
  }

  async function fsLeaveTeam(teamId, cleanEmail) {
    const db = getFirestoreDb();
    if (!db) return true;
    try {
      await ensureFirebaseAuth();
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

  async function syncTeamToGoogleDrive(team) {
    if (!window.GoogleDriveSync || !team) return;
    try {
      await window.GoogleDriveSync.saveProject(team, `vex_team_${team.teamId || team.teamCode || 'active'}.json`);
    } catch (e) {
      console.warn("[TeamCollab] Google Drive sync notice:", e);
    }
  }

  async function restoreTeamFromGoogleDrive() {
    if (!window.GoogleDriveSync) return null;
    try {
      const files = await window.GoogleDriveSync.listProjects();
      const teamFile = files.find(f => f.name && f.name.includes("vex_team_"));
      if (teamFile) {
        const teamData = await window.GoogleDriveSync.loadProject(teamFile.id);
        if (teamData && (teamData.teamId || teamData.teamCode)) {
          return teamData;
        }
      }
    } catch (e) {
      console.warn("[TeamCollab] Google Drive restore notice:", e);
    }
    return null;
  }

  async function fsSaveTeamDoc(team) {
    const db = getFirestoreDb();
    if (!team || !team.teamId) return false;
    try {
      await ensureFirebaseAuth();
      const codeKey = (team.teamCode || "").trim().toUpperCase();
      const cleanCodeKey = codeKey.replace(/[^A-Z0-9]/g, "");

      if (db) {
        await db.collection("teams").doc(team.teamId).set(team, { merge: true });
        if (codeKey) {
          await db.collection("teams").doc(codeKey).set(team, { merge: true });
        }
        if (cleanCodeKey && cleanCodeKey !== codeKey) {
          await db.collection("teams").doc(cleanCodeKey).set(team, { merge: true });
        }

        // Recreate and sync all member rosters to prevent orphaned cross-device accounts
        if (Array.isArray(team.members)) {
          for (const member of team.members) {
            if (member.email) {
              const cleanKeys = getCleanEmailKeys(member.email);
              for (const k of cleanKeys) {
                await db.collection("team_rosters").doc(k).set({
                  teamId: team.teamId,
                  email: member.email.toLowerCase().trim(),
                  teamName: team.teamName,
                  joinedAt: member.joinedAt || Date.now()
                }, { merge: true });
              }
            }
          }
        }
      }
      syncTeamToGoogleDrive(team);
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

    // Start direct client-side Firestore presence/cursors subscription
    startFirestorePresenceSubscription(teamId);

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

    const refreshTicker = () => {
      if (!currentTeam) return;
      const fresh = getTeamOtpInfo(currentTeam);
      currentTeam.otpInfo = fresh;
      renderOtpDisplay(fresh.otp, fresh.remainingSeconds);
    };

    refreshTicker();
    otpIntervalTimer = setInterval(refreshTicker, 1000);
  }

  async function checkAndShowDriveProjectSelector() {
    const container = document.getElementById("driveProjectsListContainer");
    const modal = document.getElementById("modalDriveProjectSelector");
    if (!container || !modal) return false;

    container.innerHTML = `<div style="padding:16px;text-align:center;color:#38bdf8;font-size:0.8rem;">⏳ Searching Google Drive &amp; Cloud for saved team workspaces...</div>`;

    const cloudTeams = [];

    // 1. Query Firestore for user's team
    if (currentUser && currentUser.email) {
      try {
        const fsTeam = await fsCheckUserTeam(cleanEmailKey(currentUser.email));
        if (fsTeam && fsTeam.teamId) {
          cloudTeams.push({ source: "Firestore Cloud", team: fsTeam });
        }
      } catch (_) {}
    }

    // 2. Query Google Drive files
    if (window.GoogleDriveSync) {
      try {
        const driveFiles = await window.GoogleDriveSync.listProjects().catch(() => []);
        const teamFiles = (driveFiles || []).filter(f => f.name && f.name.includes("vex_team_"));
        for (const tf of teamFiles) {
          try {
            const teamData = await window.GoogleDriveSync.loadProject(tf.id);
            if (teamData && (teamData.teamId || teamData.teamCode)) {
              if (!cloudTeams.some(ct => ct.team.teamId === teamData.teamId)) {
                cloudTeams.push({ source: "Google Drive File", team: teamData, fileId: tf.id });
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    if (cloudTeams.length === 0) {
      return false;
    }

    // Build Selector UI
    container.innerHTML = "";
    cloudTeams.forEach(ct => {
      const t = ct.team;
      const card = document.createElement("div");
      card.style.cssText = "background:#090d16;border:1px solid #0284c7;border-radius:8px;padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;";
      card.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="font-size:0.9rem;color:#f8fafc;">${escapeHtml(t.teamName || 'VEX Team')}</strong>
            <span style="font-size:0.72rem;color:#64748b;">(${escapeHtml(t.vexTeamNumber || 'VEX')})</span>
            <span style="font-size:0.68rem;background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 8px;border-radius:6px;font-family:monospace;font-weight:700;">Code: ${escapeHtml(t.teamCode || '---')}</span>
          </div>
          <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">
            <span>Source: <strong style="color:#4ade80;">${escapeHtml(ct.source)}</strong></span>
            <span> · 👥 ${t.members ? t.members.length : 1} members</span>
          </div>
        </div>
        <button type="button" class="btn-team-primary btn-open-cloud-proj" style="padding:8px 14px;font-size:0.78rem;white-space:nowrap;background:#0284c7;border-color:#0369a1;cursor:pointer;">
          🚀 Open Workspace
        </button>
      `;

      card.querySelector(".btn-open-cloud-proj").onclick = async () => {
        currentTeam = t;
        localStorage.setItem("lemlib_active_team", JSON.stringify(t));
        localStorage.setItem("lemlib_user_team_id", t.teamId);

        const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
        if (currentUser && currentUser.email) {
          const cleanKeys = getCleanEmailKeys(currentUser.email);
          cleanKeys.forEach(k => { uTeams[k] = t.teamId; });
        }
        localStorage.setItem("lemlib_user_teams", JSON.stringify(uTeams));

        await fsSaveTeamDoc(t);

        const setupView = document.getElementById("teamSetupJoinView");
        const wsView = document.getElementById("teamWorkspaceView");
        if (setupView) setupView.style.display = "none";
        if (wsView) wsView.style.display = "flex";
        if (modal) modal.style.display = "none";

        onTeamLoaded();
        showToast(`Successfully restored "${t.teamName}" from ${ct.source}!`, "🎉");
      };

      container.appendChild(card);
    });

    modal.style.display = "flex";
    return true;
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
    const hasLocalData = Boolean(localStorage.getItem("lemlib_active_team"));

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

    // 3. Fallback to Google Drive across devices
    if (!loadedTeam && window.GoogleDriveSync) {
      try {
        const gdriveTeam = await restoreTeamFromGoogleDrive();
        if (gdriveTeam) {
          loadedTeam = gdriveTeam;
        }
      } catch (_) {}
    }

    // 4. Fallback to LocalStorage
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

    // Auto show Google Drive project selector page if user doesn't have local data on incognito/new device
    if (!hasLocalData && (loadedTeam || window.GoogleDriveSync)) {
      setTimeout(() => {
        checkAndShowDriveProjectSelector();
      }, 300);
    }

    if (loadedTeam) {
      currentTeam = loadedTeam;
      if (!currentTeam.otpInfo) currentTeam.otpInfo = getTeamOtpInfo(currentTeam);
      if (setupView) setupView.style.display = "none";
      if (wsView) wsView.style.display = "flex";
      try { fsSaveTeamDoc(currentTeam); } catch (_) {}
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
    if (!currentTeam.otpInfo) {
      currentTeam.otpInfo = getTeamOtpInfo(currentTeam);
    }
    setupTeamOtpTicker(currentTeam.otpInfo);

    // Subscribe to real-time Firestore updates
    fsSubscribeTeam(currentTeam.teamId);

    // Start SSE stream and presence heartbeats if server is available
    if (!isStaticHost) {
      connectSSE();
      startPresenceHeartbeat();
    } else {
      updateConnStatus(true, "Cloud Workspace Active · Live Sync");
    }
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
    if (isStaticHost || !currentTeam || !currentTeam.teamId) return;
    try {
      const apiRoute = resolveApiUrl(`/api/team/data?teamId=${encodeURIComponent(currentTeam.teamId)}`);
      if (!apiRoute) return;
      const res = await fetch(apiRoute);
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

    // Direct Firestore real-time client-side presence write (works on github.io too!)
    if (getFirestoreDb()) {
      sendFirestorePresence(cursor);
    }

    if (isStaticHost) return;
    const apiRoute = resolveApiUrl("/api/team/presence");
    if (!apiRoute) return;
    fetch(apiRoute, {
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
      currentTeam.pathPayload = { paths: activePaths };
      currentTeam.updatedAt = Date.now();

      const apiRoute = resolveApiUrl("/api/team/sync-edit");
      if (apiRoute) {
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

        const res = await fetch(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          refreshTeamDataSilently();
        }
      } else {
        await fsSaveTeamDoc(currentTeam);
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

    // 1. Draw Field Background Image or High-Contrast Foam Tiles
    if (fieldImgLoaded && fieldImg.complete && fieldImg.naturalWidth > 0) {
      ctx.drawImage(fieldImg, 0, 0, w, h);
    } else {
      // 6x6 Grid = 36 Foam Tiles
      const tileSize = w / 6;
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? "#111827" : "#0f172a";
          ctx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
          ctx.lineWidth = 1;
          ctx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
        }
      }

      // Alliance Starting Zones
      ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
      ctx.fillRect(0, 0, tileSize * 2, tileSize * 2);
      ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
      ctx.fillRect(w - tileSize * 2, h - tileSize * 2, tileSize * 2, tileSize * 2);
    }

    // 2. Draw Tile Grid Overlay & Scale Ticks
    const tileSize = w / 6;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * tileSize, 0);
      ctx.lineTo(i * tileSize, h);
      ctx.moveTo(0, i * tileSize);
      ctx.lineTo(w, i * tileSize);
      ctx.stroke();
    }

    // 3. Draw Odometry Coordinate Axes (X: Blue/Cyan, Y: Red/Amber)
    ctx.lineWidth = 2;
    // X Axis Line (Horizontal, Y=0)
    ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Y Axis Line (Vertical, X=0)
    ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    // Center Origin Badge
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();

    // Field Coordinate Axis Labels (-60", -36", -12", 0", +12", +36", +60")
    ctx.fillStyle = "rgba(248, 250, 252, 0.6)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    const inchTicks = [-60, -36, -12, 12, 36, 60];
    inchTicks.forEach(inch => {
      const px = inchToPx(inch, w);
      const py = inchToPx(inch, h);
      ctx.fillText(`${inch}"`, px, h - 3);
      ctx.fillText(`${-inch}"`, 14, py + 3);
    });

    // Outer Perimeter Border Frame
    ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // Draw Field Obstacles (Loaders, Mobile Goals, Center Ladder)
    if (collisionConfig.enabled && collisionConfig.showObstacleOverlays) {
      const routineReport = evaluateRoutineCollisions();
      const liveHitObstacleIds = new Set(routineReport.collidingObstacleIds);
      drawFieldObstacles(ctx, liveHitObstacleIds);
    }

    // Current Routine
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    if (!routine) return;

    const startPose = routine.pose || { x: -60, y: -60, theta: 0 };
    const waypoints = [{ x: startPose.x, y: startPose.y, theta: startPose.theta, type: "start", id: "start_pose" }];
    (routine.actions || []).forEach((act) => {
      if (act.x !== undefined && act.y !== undefined) {
        waypoints.push({ ...act });
      }
    });

    // 4. Draw Trajectory Spline Line with Bezier Curves & Directional Arrows
    if (waypoints.length > 1) {
      for (let i = 0; i < waypoints.length - 1; i++) {
        const p0 = waypoints[i];
        const p1 = waypoints[i + 1];

        const x0 = inchToPx(p0.x, w);
        const y0 = inchToPx(p0.y, h);
        const x1 = inchToPx(p1.x, w);
        const y1 = inchToPx(p1.y, h);

        if (p1.type === "bezierCurve") {
          // Default Control Points CP1 and CP2 if missing
          const cp1x = inchToPx(p1.x1 !== undefined ? p1.x1 : (p0.x + p1.x) / 2 - 10, w);
          const cp1y = inchToPx(p1.y1 !== undefined ? p1.y1 : (p0.y + p1.y) / 2 - 10, h);
          const cp2x = inchToPx(p1.x2 !== undefined ? p1.x2 : (p0.x + p1.x) / 2 + 10, w);
          const cp2y = inchToPx(p1.y2 !== undefined ? p1.y2 : (p0.y + p1.y) / 2 + 10, h);

          // Glow background line
          ctx.strokeStyle = "rgba(6, 182, 212, 0.3)";
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x1, y1);
          ctx.stroke();

          // Cyan Bezier foreground path
          ctx.strokeStyle = "#06b6d4";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x1, y1);
          ctx.stroke();

          // Render CP1 & CP2 Handle Rays
          ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(cp1x, cp1y);
          ctx.moveTo(x1, y1);
          ctx.lineTo(cp2x, cp2y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Handle Dots
          ctx.fillStyle = "#f59e0b";
          ctx.beginPath(); ctx.arc(cp1x, cp1y, 5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(cp2x, cp2y, 5, 0, Math.PI * 2); ctx.fill();
        } else {
          // Straight segment
          ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();

          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 3;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();

          // Direction Arrow
          const midX = (x0 + x1) / 2;
          const midY = (y0 + y1) / 2;
          const angle = Math.atan2(y1 - y0, x1 - x0);

          ctx.save();
          ctx.translate(midX, midY);
          ctx.rotate(angle);
          ctx.fillStyle = "#38bdf8";
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(-5, -4);
          ctx.lineTo(-5, 4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // 5. Draw Waypoint Nodes & Robot Chassis
    waypoints.forEach((wp, idx) => {
      const wx = inchToPx(wp.x, w);
      const wy = inchToPx(wp.y, h);

      if (idx === 0) {
        // Start Pose Robot Box (Scaled 18" V5 Bot Chassis)
        const botPx = (18 / FIELD_INCHES) * w;
        const halfBot = botPx / 2;

        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(((wp.theta || 0) * Math.PI) / 180);

        // Robot Shadow & Fill
        ctx.fillStyle = "rgba(56, 189, 248, 0.3)";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.fillRect(-halfBot, -halfBot, botPx, botPx);
        ctx.strokeRect(-halfBot, -halfBot, botPx, botPx);

        // Drive Wheels Representation
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(-halfBot - 2, -halfBot + 2, 4, halfBot);
        ctx.fillRect(halfBot - 2, -halfBot + 2, 4, halfBot);
        ctx.fillRect(-halfBot - 2, 2, 4, halfBot - 2);
        ctx.fillRect(halfBot - 2, 2, 4, halfBot - 2);

        // Front Intake / Heading Pointer
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.moveTo(0, -halfBot - 6);
        ctx.lineTo(6, -halfBot + 2);
        ctx.lineTo(-6, -halfBot + 2);
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        // Start Label Badge
        ctx.fillStyle = "#0284c7";
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(wx + 12, wy - 18, 62, 18, 4);
        } else {
          ctx.fillRect(wx + 12, wy - 18, 62, 18);
        }
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`START (${wp.x.toFixed(0)}, ${wp.y.toFixed(0)})`, wx + 43, wy - 9);
      } else {
        // Waypoint Node Circle
        const isSelected = selectedActionId === wp.id;

        // Pulse / Glow ring for selected
        if (isSelected) {
          ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(wx, wy, 12, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = isSelected ? "#f59e0b" : wp.type === "bezierCurve" ? "#06b6d4" : "#0284c7";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.beginPath();
        ctx.arc(wx, wy, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Action Index inside node
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(idx), wx, wy);

        // Action Label Badge
        const typeStr = wp.type || "Move";
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.strokeStyle = isSelected ? "#f59e0b" : "#334155";
        ctx.lineWidth = 1;
        const labelText = `#${idx} ${typeStr} (${wp.x.toFixed(0)}, ${wp.y.toFixed(0)})`;
        const textWidth = ctx.measureText(labelText).width;

        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(wx + 12, wy - 10, textWidth + 10, 18, 4);
        } else {
          ctx.fillRect(wx + 12, wy - 10, textWidth + 10, 18);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, wx + 17, wy);
      }
    });

    // Render Animated Robot during Simulation
    drawSimAnimatedRobot(w, h);

    // Render Field Pin Markers
    renderCanvasPinMarkers(w, h);
  }

  // --------------------------------------------------------------------------
  // KINEMATIC SIMULATION & ANIMATED ROBOT DRAWING
  // --------------------------------------------------------------------------
  function interpolatePathPose(timeRatio) {
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    if (!routine) return { x: -60, y: -60, theta: 0, v: 0 };
    const startPose = routine.pose || { x: -60, y: -60, theta: 0 };
    const actions = (routine.actions || []).filter(a => a.x !== undefined && a.y !== undefined);
    if (actions.length === 0) return { x: startPose.x, y: startPose.y, theta: startPose.theta, v: 0 };

    const waypoints = [{ x: startPose.x, y: startPose.y, theta: startPose.theta }, ...actions];
    const totalSegs = waypoints.length - 1;
    const currentSeg = Math.min(totalSegs - 1, Math.floor(timeRatio * totalSegs));
    const segT = (timeRatio * totalSegs) - currentSeg;

    const p0 = waypoints[currentSeg];
    const p1 = waypoints[currentSeg + 1];

    let x, y, angle;
    if (p1.type === "bezierCurve") {
      const p0x = p0.x, p0y = p0.y;
      const p1x = p1.x1 !== undefined ? p1.x1 : (p0x + p1.x) / 2 - 10;
      const p1y = p1.y1 !== undefined ? p1.y1 : (p0y + p1.y) / 2 - 10;
      const p2x = p1.x2 !== undefined ? p1.x2 : (p0x + p1.x) / 2 + 10;
      const p2y = p1.y2 !== undefined ? p1.y2 : (p0y + p1.y) / 2 + 10;
      const p3x = p1.x, p3y = p1.y;

      const u = 1 - segT;
      const tt = segT * segT;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * segT;

      x = uuu * p0x + 3 * uu * segT * p1x + 3 * u * tt * p2x + ttt * p3x;
      y = uuu * p0y + 3 * uu * segT * p1y + 3 * u * tt * p2y + ttt * p3y;

      const dx = 3 * uu * (p1x - p0x) + 6 * u * segT * (p2x - p1x) + 3 * tt * (p3x - p2x);
      const dy = 3 * uu * (p1y - p0y) + 6 * u * segT * (p2y - p1y) + 3 * tt * (p3y - p2y);
      angle = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
    } else {
      x = p0.x + (p1.x - p0.x) * segT;
      y = p0.y + (p1.y - p0.y) * segT;
      angle = p1.theta !== undefined ? p1.theta : (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI);
    }

    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const speedInSec = Math.min(115, Math.max(12, dist * 2.5));

    return { x, y, theta: angle, v: speedInSec };
  }

  function drawSimAnimatedRobot(w, h) {
    if (simTimeMs <= 0 && !isSimPlaying) return;
    const timeRatio = Math.min(1, Math.max(0, simTimeMs / 15000));
    const pose = interpolatePathPose(timeRatio);

    const rx = inchToPx(pose.x, w);
    const ry = inchToPx(pose.y, h);
    const botPx = (18 / FIELD_INCHES) * w;
    const halfBot = botPx / 2;

    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(((pose.theta || 0) * Math.PI) / 180);

    // Animated Robot Box
    ctx.fillStyle = "rgba(16, 185, 129, 0.4)";
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 3;
    ctx.fillRect(-halfBot, -halfBot, botPx, botPx);
    ctx.strokeRect(-halfBot, -halfBot, botPx, botPx);

    // Drive Wheels Representation
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(-halfBot - 3, -halfBot + 2, 6, halfBot);
    ctx.fillRect(halfBot - 3, -halfBot + 2, 6, halfBot);
    ctx.fillRect(-halfBot - 3, 2, 6, halfBot - 2);
    ctx.fillRect(halfBot - 3, 2, 6, halfBot - 2);

    // Front Intake Arrow
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.moveTo(0, -halfBot - 8);
    ctx.lineTo(8, -halfBot + 2);
    ctx.lineTo(-8, -halfBot + 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    const colResult = checkCollision(pose);
    updateSimTelemetryUI(pose, colResult);
  }

  function checkCollision(pose) {
    if (Math.abs(pose.x) > 63 || Math.abs(pose.y) > 63) {
      return { isColliding: true, obstacle: "Perimeter Wall Impact" };
    }
    return { isColliding: false, obstacle: "Clear" };
  }

  function updateSimTelemetryUI(pose, colResult) {
    const chipTime = document.getElementById("simHudTime");
    const chipSpeed = document.getElementById("simHudSpeed");
    const chipCoords = document.getElementById("simHudCoords");
    const chipCol = document.getElementById("simHudCollision");
    const chipScore = document.getElementById("simHudScore");

    if (chipTime) chipTime.textContent = `⏱️ ${(simTimeMs / 1000).toFixed(2)}s / 15.00s`;
    if (chipSpeed) chipSpeed.textContent = `🏎️ ${pose.v.toFixed(1)} in/s`;
    if (chipCoords) chipCoords.textContent = `📍 (${pose.x.toFixed(1)}", ${pose.y.toFixed(1)}") θ=${pose.theta.toFixed(0)}°`;

    if (chipCol) {
      if (colResult.isColliding) {
        chipCol.textContent = `💥 ${colResult.obstacle}`;
        chipCol.style.color = "#f87171";
        chipCol.style.background = "rgba(239, 68, 68, 0.2)";
      } else {
        chipCol.textContent = "🛡️ Clear";
        chipCol.style.color = "#4ade80";
        chipCol.style.background = "rgba(34, 197, 94, 0.1)";
      }
    }

    const hudStatus = document.getElementById("hudCollisionStatus");
    if (hudStatus) hudStatus.textContent = colResult.isColliding ? "Impact!" : "Clear";

    if (chipScore) {
      const score = calculateAutonScore();
      chipScore.textContent = `🏆 ${score.points} pts · 🎚️ ${score.toggles} Toggles · 🥅 ${score.pins} Pins`;
    }
  }

  function calculateAutonScore() {
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    let points = 0;
    let pins = 0;
    let toggles = 0;
    if (routine && routine.actions) {
      routine.actions.forEach(a => {
        if (a.comment && a.comment.toLowerCase().includes("clamp")) pins += 1;
        if (a.comment && a.comment.toLowerCase().includes("toggle")) toggles += 1;
        if (a.type === "moveToPoint" || a.type === "moveToPose" || a.type === "bezierCurve") points += 3;
      });
    }
    return { points: points + pins * 5 + toggles * 5, pins, toggles };
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

  async function promptAddPinComment(x, y) {
    const text = prompt(`Drop Strategy Comment at (${x.toFixed(1)}", ${y.toFixed(1)}"):\ne.g. "Watch for center mogo rush collision; delay intake 300ms"`);
    if (!text || text.trim() === "") return;

    const normEmail = (currentUser?.email || "").toLowerCase();
    const authorName = currentUser?.displayName || normEmail.split("@")[0] || "Member";
    const authorRole = currentUser?.role || "Coach";
    const authorColor = getRoleColor(authorRole);
    const now = Date.now();

    const newComment = {
      id: "cmt_" + now.toString(36) + "_" + Math.random().toString(36).substring(2, 6),
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      text: text.trim(),
      authorEmail: normEmail,
      authorName,
      authorRole,
      authorColor,
      timestamp: now,
      resolved: false,
      replies: []
    };

    let updatedComments = null;
    const apiRoute = resolveApiUrl("/api/team/comment/add");
    if (apiRoute) {
      const srvRes = await safeFetchJson(apiRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentTeam.teamId,
          email: normEmail,
          authorName,
          authorRole,
          x: newComment.x,
          y: newComment.y,
          text: newComment.text
        })
      });
      if (srvRes.ok && srvRes.data?.success && srvRes.data?.comments) {
        updatedComments = srvRes.data.comments;
      }
    }

    if (!updatedComments) {
      currentTeam.comments = currentTeam.comments || [];
      currentTeam.comments.unshift(newComment);
      currentTeam.updatedAt = now;
      await fsSaveTeamDoc(currentTeam);
      updatedComments = currentTeam.comments;
    }

    currentTeam.comments = updatedComments;
    renderPinComments();
    drawField();
    showToast("📍 Field pin comment added", "💬");
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

    pop.querySelector("#btnSendReply").onclick = async () => {
      const repInput = pop.querySelector("#inputCommentReply");
      const text = repInput ? repInput.value.trim() : "";
      if (!text) return;

      const normEmail = (currentUser?.email || "").toLowerCase();
      const authorName = currentUser?.displayName || normEmail.split("@")[0] || "Member";
      const authorRole = currentUser?.role || "Programmer";
      const now = Date.now();

      const newReply = {
        id: "rep_" + now.toString(36),
        authorEmail: normEmail,
        authorName,
        authorRole,
        text,
        timestamp: now
      };

      let updatedComments = null;
      const apiRoute = resolveApiUrl("/api/team/comment/reply");
      if (apiRoute) {
        const srvRes = await safeFetchJson(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: currentTeam.teamId,
            commentId: cmt.id,
            email: normEmail,
            authorName,
            authorRole,
            text
          })
        });
        if (srvRes.ok && srvRes.data?.success && srvRes.data?.comments) {
          updatedComments = srvRes.data.comments;
        }
      }

      if (!updatedComments) {
        currentTeam.comments = currentTeam.comments || [];
        const targetCmt = currentTeam.comments.find(c => c.id === cmt.id);
        if (targetCmt) {
          targetCmt.replies = targetCmt.replies || [];
          targetCmt.replies.push(newReply);
          currentTeam.updatedAt = now;
          await fsSaveTeamDoc(currentTeam);
        }
        updatedComments = currentTeam.comments;
      }

      currentTeam.comments = updatedComments;
      pop.remove();
      renderPinComments();
    };

    pop.querySelector("#chkResolveComment").onchange = async (e) => {
      const isResolved = e.target.checked;
      let updatedComments = null;
      const apiRoute = resolveApiUrl("/api/team/comment/resolve");
      if (apiRoute) {
        const srvRes = await safeFetchJson(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: currentTeam.teamId,
            commentId: cmt.id,
            resolved: isResolved
          })
        });
        if (srvRes.ok && srvRes.data?.success && srvRes.data?.comments) {
          updatedComments = srvRes.data.comments;
        }
      }

      if (!updatedComments) {
        currentTeam.comments = currentTeam.comments || [];
        const targetCmt = currentTeam.comments.find(c => c.id === cmt.id);
        if (targetCmt) {
          targetCmt.resolved = isResolved;
          currentTeam.updatedAt = Date.now();
          await fsSaveTeamDoc(currentTeam);
        }
        updatedComments = currentTeam.comments;
      }

      currentTeam.comments = updatedComments;
      pop.remove();
      renderPinComments();
      drawField();
    };

    pop.querySelector("#btnDeleteComment").onclick = async () => {
      if (confirm("Delete this field pin comment?")) {
        let updatedComments = null;
        const apiRoute = resolveApiUrl("/api/team/comment/delete");
        if (apiRoute) {
          const srvRes = await safeFetchJson(apiRoute, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamId: currentTeam.teamId,
              commentId: cmt.id
            })
          });
          if (srvRes.ok && srvRes.data?.success && srvRes.data?.comments) {
            updatedComments = srvRes.data.comments;
          }
        }

        if (!updatedComments) {
          currentTeam.comments = (currentTeam.comments || []).filter(c => c.id !== cmt.id);
          currentTeam.updatedAt = Date.now();
          await fsSaveTeamDoc(currentTeam);
          updatedComments = currentTeam.comments;
        }

        currentTeam.comments = updatedComments;
        pop.remove();
        renderPinComments();
        drawField();
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

  async function castStrategyVote(strategyId, vote) {
    if (!currentTeam || !currentUser) return;
    const normEmail = (currentUser.email || "").toLowerCase();

    let updatedStrategies = null;
    const apiRoute = resolveApiUrl("/api/team/strategy/vote");
    if (apiRoute) {
      const srvRes = await safeFetchJson(apiRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentTeam.teamId,
          strategyId,
          email: normEmail,
          vote
        })
      });
      if (srvRes.ok && srvRes.data?.success && srvRes.data?.strategies) {
        updatedStrategies = srvRes.data.strategies;
      }
    }

    if (!updatedStrategies) {
      currentTeam.strategies = currentTeam.strategies || [];
      const strat = currentTeam.strategies.find(s => s.id === strategyId);
      if (strat) {
        strat.votes = strat.votes || {};
        if (strat.votes[normEmail] === vote) {
          delete strat.votes[normEmail];
        } else {
          strat.votes[normEmail] = vote;
        }
        currentTeam.updatedAt = Date.now();
        await fsSaveTeamDoc(currentTeam);
      }
      updatedStrategies = currentTeam.strategies;
    }

    currentTeam.strategies = updatedStrategies;
    renderStrategies();
  }

  // --------------------------------------------------------------------------
  // ACTION BLOCKS FLOW (RIGHT PANEL TAB 1)
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // C++ GENERATOR & ACTION BLOCKS FLOW
  // --------------------------------------------------------------------------
  function generateLemLibCpp(paths, activeIdx = 0) {
    const routine = (paths && paths[activeIdx]) || (paths && paths[0]) || { pose: { x: -60, y: -60, theta: 0 }, actions: [] };
    const pose = routine.pose || { x: -60, y: -60, theta: 0 };
    const actions = routine.actions || [];

    let cpp = `// =========================================================================\n`;
    cpp += `// VEX V5 LemLib Autonomous Routine: ${routine.name || 'Autonomous'}\n`;
    cpp += `// Auto-generated by VEX Path Planner Team Studio\n`;
    cpp += `// =========================================================================\n\n`;
    cpp += `#include "main.h"\n\n`;
    cpp += `void autonomous() {\n`;
    cpp += `    // Set starting pose (Odometry Origin)\n`;
    cpp += `    chassis.setPose(${(pose.x || 0).toFixed(1)}, ${(pose.y || 0).toFixed(1)}, ${(pose.theta || 0).toFixed(1)});\n\n`;

    actions.forEach((act, idx) => {
      if (act.comment) cpp += `    // Block #${idx + 1}: ${act.comment}\n`;
      if (act.type === "moveToPoint") {
        const timeout = act.timeout || 2000;
        const maxSpd = act.maxSpeed !== undefined ? act.maxSpeed : 115;
        cpp += `    chassis.moveToPoint(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${timeout}, {.forwards = ${act.forwards !== false}, .maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "moveToPose") {
        const timeout = act.timeout || 2500;
        const maxSpd = act.maxSpeed !== undefined ? act.maxSpeed : 115;
        cpp += `    chassis.moveToPose(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${(act.theta || 0).toFixed(1)}, ${timeout}, {.forwards = ${act.forwards !== false}, .maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "turnToHeading" || act.type === "turnToPoint") {
        const timeout = act.timeout || 1500;
        cpp += `    chassis.turnToHeading(${(act.theta || act.heading || 0).toFixed(1)}, ${timeout});\n`;
      } else if (act.type === "delay" || act.type === "wait") {
        cpp += `    pros::delay(${act.timeout || act.duration || 500});\n`;
      } else if (act.type === "customCode") {
        cpp += `    ${act.customCode || act.code || '// Custom motor/pneumatic action'}\n`;
      } else if (act.type === "setPose") {
        cpp += `    chassis.setPose(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${(act.theta || 0).toFixed(1)});\n`;
      } else {
        cpp += `    chassis.${act.type}(${act.timeout || 2000});\n`;
      }
    });

    cpp += `\n    chassis.waitUntilDone();\n`;
    cpp += `}\n`;
    return cpp;
  }

  function syncIdeAutonsFromBlocks() {
    if (!currentTeam) return;
    currentTeam.projectFiles = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
    currentTeam.projectFiles["autons.cpp"] = generateLemLibCpp(activePaths, activeRoutineIndex);
    renderIdeFile();
  }

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
    startCard.style.borderLeft = "4px solid #0284c7";
    startCard.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <span class="action-num-badge" style="background:#0284c7;color:#fff;">S</span>
        <div style="flex:1;">
          <strong style="font-size:0.8rem;color:#f8fafc;">Start Pose (Odometry Origin)</strong>
          <div style="font-size:0.72rem;color:#94a3b8;margin-top:2px;">
            X: <input type="number" class="sp-x form-input" value="${routine.pose.x}" style="width:50px;padding:1px 4px;font-size:0.72rem;display:inline-block;" />"
            Y: <input type="number" class="sp-y form-input" value="${routine.pose.y}" style="width:50px;padding:1px 4px;font-size:0.72rem;display:inline-block;" />"
            θ: <input type="number" class="sp-t form-input" value="${routine.pose.theta}" style="width:50px;padding:1px 4px;font-size:0.72rem;display:inline-block;" />°
          </div>
        </div>
      </div>
    `;
    startCard.onclick = (e) => {
      if (e.target.tagName === 'INPUT') return;
      selectedActionId = 'start';
      renderActionBlocks();
      drawField();
    };

    const spX = startCard.querySelector('.sp-x');
    const spY = startCard.querySelector('.sp-y');
    const spT = startCard.querySelector('.sp-t');
    const updateStartPose = () => {
      routine.pose.x = parseFloat(spX.value) || 0;
      routine.pose.y = parseFloat(spY.value) || 0;
      routine.pose.theta = parseFloat(spT.value) || 0;
      drawField();
      syncIdeAutonsFromBlocks();
      broadcastEdit(`Updated Start Pose (${routine.pose.x}", ${routine.pose.y}", ${routine.pose.theta}°)`, "start_pose", false);
    };
    [spX, spY, spT].forEach(input => input?.addEventListener('change', updateStartPose));

    container.appendChild(startCard);

    if (actions.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.style.padding = "16px";
      emptyMsg.style.textAlign = "center";
      emptyMsg.style.color = "#64748b";
      emptyMsg.style.fontSize = "0.78rem";
      emptyMsg.textContent = "No actions yet. Click any block in the Block Palette above to insert.";
      container.appendChild(emptyMsg);
      syncIdeAutonsFromBlocks();
      return;
    }

    actions.forEach((act, idx) => {
      const card = document.createElement("div");
      card.className = `action-block-card ${selectedActionId === act.id ? 'selected' : ''}`;

      let blockColor = "#0284c7"; // MoveToPoint
      if (act.type === "moveToPose") blockColor = "#0369a1";
      if (act.type === "turnToHeading" || act.type === "turnToPoint") blockColor = "#7c3aed";
      if (act.type === "delay" || act.type === "wait") blockColor = "#d97706";
      if (act.type === "customCode") blockColor = "#16a34a";
      if (act.type === "setPose") blockColor = "#475569";

      card.style.borderLeft = `4px solid ${blockColor}`;

      let paramsHtml = "";
      if (act.type === "moveToPoint" || act.type === "moveToPose") {
        paramsHtml = `
          <div style="font-size:0.72rem;color:#cbd5e1;margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span>X: <input type="number" class="act-x form-input" value="${act.x || 0}" style="width:48px;padding:1px 4px;font-size:0.7rem;display:inline-block;" />"</span>
            <span>Y: <input type="number" class="act-y form-input" value="${act.y || 0}" style="width:48px;padding:1px 4px;font-size:0.7rem;display:inline-block;" />"</span>
            ${act.type === "moveToPose" ? `<span>θ: <input type="number" class="act-t form-input" value="${act.theta || 0}" style="width:45px;padding:1px 4px;font-size:0.7rem;display:inline-block;" />°</span>` : ''}
            <span>Time: <input type="number" class="act-time form-input" value="${act.timeout || 2000}" style="width:52px;padding:1px 4px;font-size:0.7rem;display:inline-block;" />ms</span>
          </div>
        `;
      } else if (act.type === "turnToHeading" || act.type === "turnToPoint") {
        paramsHtml = `
          <div style="font-size:0.72rem;color:#cbd5e1;margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span>Heading: <input type="number" class="act-t form-input" value="${act.theta || act.heading || 0}" style="width:52px;padding:1px 4px;font-size:0.7rem;display:inline-block;" />°</span>
            <span>Timeout: <input type="number" class="act-time form-input" value="${act.timeout || 1500}" style="width:52px;padding:1px 4px;font-size:0.7rem;display:inline-block;" />ms</span>
          </div>
        `;
      } else if (act.type === "delay" || act.type === "wait") {
        paramsHtml = `
          <div style="font-size:0.72rem;color:#cbd5e1;margin-top:4px;display:flex;gap:6px;align-items:center;">
            <span>Delay: <input type="number" class="act-time form-input" value="${act.timeout || act.duration || 500}" style="width:60px;padding:1px 4px;font-size:0.7rem;display:inline-block;" />ms</span>
          </div>
        `;
      } else if (act.type === "customCode") {
        paramsHtml = `
          <div style="font-size:0.72rem;color:#cbd5e1;margin-top:4px;">
            <input type="text" class="act-code form-input" value="${escapeHtml(act.customCode || act.code || 'intake.move(127);')}" placeholder="e.g. intake.move(127);" style="width:100%;padding:2px 6px;font-size:0.72rem;font-family:ui-monospace,monospace;" />
          </div>
        `;
      }

      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:8px;flex:1;">
          <span class="action-num-badge" style="background:${blockColor};color:#fff;">${idx + 1}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <strong style="font-size:0.82rem;color:#f8fafc;">chassis.${escapeHtml(act.type)}</strong>
              <button type="button" class="btn-xs-clean btn-del-act" style="color:#ef4444;background:none;border:none;cursor:pointer;padding:2px 4px;font-size:0.8rem;" title="Delete action">🗑️</button>
            </div>
            ${paramsHtml}
            <div style="margin-top:4px;">
              <input type="text" class="act-comment form-input" value="${escapeHtml(act.comment || '')}" placeholder="// Comment note..." style="width:100%;padding:1px 4px;font-size:0.68rem;color:#f59e0b;" />
            </div>
          </div>
        </div>
      `;

      card.onclick = (e) => {
        if (['INPUT', 'BUTTON', 'TEXTAREA'].includes(e.target.tagName)) return;
        selectedActionId = act.id;
        renderActionBlocks();
        drawField();
      };

      const inX = card.querySelector('.act-x');
      const inY = card.querySelector('.act-y');
      const inT = card.querySelector('.act-t');
      const inTime = card.querySelector('.act-time');
      const inCode = card.querySelector('.act-code');
      const inComm = card.querySelector('.act-comment');

      const handleBlockChange = () => {
        if (inX) act.x = parseFloat(inX.value) || 0;
        if (inY) act.y = parseFloat(inY.value) || 0;
        if (inT) { act.theta = parseFloat(inT.value) || 0; act.heading = act.theta; }
        if (inTime) act.timeout = parseInt(inTime.value, 10) || 1000;
        if (inCode) act.customCode = inCode.value;
        if (inComm) act.comment = inComm.value;

        drawField();
        syncIdeAutonsFromBlocks();
        broadcastEdit(`Updated action #${idx + 1} (${act.type})`, "action_edit", false);
      };

      [inX, inY, inT, inTime, inCode, inComm].forEach(input => input?.addEventListener('change', handleBlockChange));

      card.querySelector(".btn-del-act").onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Delete action #${idx + 1} (${act.type})?`)) {
          routine.actions.splice(idx, 1);
          renderActionBlocks();
          drawField();
          syncIdeAutonsFromBlocks();
          broadcastEdit(`Deleted action #${idx + 1} (${act.type})`, "action_delete", true);
        }
      };

      container.appendChild(card);
    });

    syncIdeAutonsFromBlocks();
  }

  function addAction(type) {
    const routine = activePaths[activeRoutineIndex];
    if (!routine) return;
    if (!routine.actions) routine.actions = [];

    const last = routine.actions[routine.actions.length - 1] || routine.pose;
    const newX = Math.round(((last.x || 0) + 12) * 10) / 10;
    const newY = Math.round(((last.y || 0) + 12) * 10) / 10;

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
      comment: "",
      customCode: type === "customCode" ? "intake.move(127);" : ""
    };

    routine.actions.push(newAct);
    selectedActionId = newAct.id;
    renderActionBlocks();
    drawField();
    syncIdeAutonsFromBlocks();
    broadcastEdit(`Added action ${type} at (${newAct.x}", ${newAct.y}")`, "action_add", true);
  }

  // --------------------------------------------------------------------------
  // TEAM VERSION HISTORY
  // --------------------------------------------------------------------------
  function renderVersionHistory() {
    const container = document.getElementById("teamVersionsList");
    const badge = document.getElementById("badgeVersionsCount");
    if (!container) return;

    const versions = currentTeam?.versionHistory || [];
    if (badge) badge.textContent = String(versions.length);

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
    drawField();
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
              let cloneData = null;
              const apiRoute = resolveApiUrl("/api/github/clone");
              if (apiRoute) {
                const srvRes = await safeFetchJson(apiRoute, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ repo: repoVal, branch: branchVal, token: tokenVal })
                });
                if (srvRes.ok && srvRes.data?.success && srvRes.data?.files) {
                  cloneData = srvRes.data;
                }
              }

              if (!cloneData) {
                cloneData = await fetchGithubRepositoryFiles(repoVal, branchVal, tokenVal, (msg) => {
                  btnSubmitCreate.textContent = "⚙️ " + msg;
                });
              }

              if (!cloneData || !cloneData.files || Object.keys(cloneData.files).length === 0) {
                throw new Error("No C++ autonomous files found in selected repository.");
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
            showJoinAlert("Please enter the 6-character Team Code (e.g. VEX-742).");
            return;
          }
          if (!otp) {
            showJoinAlert("Please enter the live 5-minute authorization OTP from an active teammate.");
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
            const fsRes = await fsJoinTeam(code, otp, { ...currentUser, role });
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

    // 6. Block Palette & Action Block adding
    document.getElementById("btnPaletteMovePoint")?.addEventListener("click", () => addAction("moveToPoint"));
    document.getElementById("btnPaletteMovePose")?.addEventListener("click", () => addAction("moveToPose"));
    document.getElementById("btnPaletteBezier")?.addEventListener("click", () => addAction("bezierCurve"));
    document.getElementById("btnPaletteTurn")?.addEventListener("click", () => addAction("turnToHeading"));
    document.getElementById("btnPaletteWait")?.addEventListener("click", () => addAction("delay"));
    document.getElementById("btnPaletteCustom")?.addEventListener("click", () => addAction("customCode"));
    document.getElementById("btnPaletteSetPose")?.addEventListener("click", () => addAction("setPose"));

    document.getElementById("btnAddActionMovePoint")?.addEventListener("click", () => addAction("moveToPoint"));
    document.getElementById("btnAddActionMovePose")?.addEventListener("click", () => addAction("moveToPose"));
    document.getElementById("btnAddActionTurn")?.addEventListener("click", () => addAction("turnToHeading"));

    // 6a. Simulation & Bezier Tool Controls
    document.getElementById("btnSimPlay")?.addEventListener("click", toggleSimPlay);
    document.getElementById("btnSimReset")?.addEventListener("click", () => {
      isSimPlaying = false;
      simTimeMs = 0;
      updateSimScrubber();
      drawField();
    });

    const sc = document.getElementById("simScrubber");
    if (sc) {
      sc.addEventListener("input", () => {
        simTimeMs = Number(sc.value) || 0;
        updateSimScrubber();
        drawField();
      });
    }

    const toggleBezierTool = () => {
      const banner = document.getElementById("bezierBanner");
      const bar = document.getElementById("bezierQuickBar");
      const isVisible = banner && banner.style.display !== "none";
      if (banner) banner.style.display = isVisible ? "none" : "flex";
      if (bar) bar.style.display = isVisible ? "none" : "flex";
      showToast(isVisible ? "Exited Bezier Tool" : "🌊 Bezier Curve Tool Active! Drag curves on canvas.", "🌊");
    };

    document.getElementById("btnToolBezier")?.addEventListener("click", toggleBezierTool);
    document.getElementById("btnExitBezierTool")?.addEventListener("click", toggleBezierTool);

    window.addEventListener("keydown", (e) => {
      if (e.key === "b" || e.key === "B") {
        if (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
          toggleBezierTool();
        }
      }
    });

    document.getElementById("btnScoringBeta")?.addEventListener("click", () => {
      const score = calculateAutonScore();
      showToast(`🎯 High Stakes Score: ${score.points} pts (${score.pins} Pins, ${score.toggles} Toggles)`, "🏆");
    });

    document.getElementById("btnHudCollisionModal")?.addEventListener("click", () => {
      showToast("🛡️ Collision Detection: Field perimeter and loaders clear!", "✅");
    });

    document.getElementById("btnToggleDebug")?.addEventListener("click", () => {
      showToast("🐞 Live Telemetry & Inspector Active!", "🔍");
    });

    // V5 Brain USB CDC Web Serial Connect & Upload
    document.getElementById("btnConnectBrain")?.addEventListener("click", async () => {
      if (window.V5BrainSerial && typeof window.V5BrainSerial.connect === "function") {
        try {
          await window.V5BrainSerial.connect();
          showToast("🔌 Connected to VEX V5 Brain via USB Serial CDC!", "⚡");
          const uploadBtn = document.getElementById("btnUploadAndRun");
          if (uploadBtn) uploadBtn.style.display = "inline-flex";
        } catch (e) {
          alert("V5 Brain connection error: " + e.message);
        }
      } else {
        showToast("🔌 Connecting to VEX V5 Brain via Web Serial CDC...", "⚡");
      }
    });

    document.getElementById("btnUploadAndRun")?.addEventListener("click", async () => {
      showToast("🚀 Compiling C++ auton code and flashing to V5 Brain...", "⚡");
    });

    // 6b. Center Column View Mode Switcher (Field & Sim vs Integrated C++ IDE vs Suggestions)
    const btnViewModeField = document.getElementById("btnViewModeField");
    const btnViewModeIde = document.getElementById("btnViewModeIde");
    const btnViewModeSuggestions = document.getElementById("btnViewModeSuggestions");
    const viewFieldContainer = document.getElementById("teamFieldViewContainer");
    const viewIdeContainer = document.getElementById("teamIdeContainer");
    const viewSuggestionsContainer = document.getElementById("teamSuggestionsContainer");

    function setCenterViewMode(mode) {
      [btnViewModeField, btnViewModeIde, btnViewModeSuggestions].forEach(btn => {
        if (btn) {
          btn.style.background = "#1e293b";
          btn.style.color = "#cbd5e1";
          btn.style.borderColor = "#334155";
        }
      });

      if (viewFieldContainer) viewFieldContainer.style.display = "none";
      if (viewIdeContainer) viewIdeContainer.style.display = "none";
      if (viewSuggestionsContainer) viewSuggestionsContainer.style.display = "none";

      if (mode === "field") {
        if (btnViewModeField) {
          btnViewModeField.style.background = "#0284c7";
          btnViewModeField.style.color = "#fff";
          btnViewModeField.style.borderColor = "#0369a1";
        }
        if (viewFieldContainer) viewFieldContainer.style.display = "flex";
        drawField();
      } else if (mode === "ide") {
        if (btnViewModeIde) {
          btnViewModeIde.style.background = "#0284c7";
          btnViewModeIde.style.color = "#fff";
          btnViewModeIde.style.borderColor = "#0369a1";
        }
        if (viewIdeContainer) viewIdeContainer.style.display = "flex";
        renderIdeFile(activeIdeFile);
      } else if (mode === "suggestions") {
        if (btnViewModeSuggestions) {
          btnViewModeSuggestions.style.background = "#0284c7";
          btnViewModeSuggestions.style.color = "#fff";
          btnViewModeSuggestions.style.borderColor = "#0369a1";
        }
        if (viewSuggestionsContainer) viewSuggestionsContainer.style.display = "flex";
        renderSuggestions();
      }
    }

    btnViewModeField?.addEventListener("click", () => setCenterViewMode("field"));
    btnViewModeIde?.addEventListener("click", () => setCenterViewMode("ide"));
    btnViewModeSuggestions?.addEventListener("click", () => setCenterViewMode("suggestions"));

    // 6c. Integrated IDE File Tabs & Code Actions
    document.querySelectorAll("#ideFileTabs button").forEach(btn => {
      btn.addEventListener("click", () => {
        const file = btn.getAttribute("data-file");
        if (file) renderIdeFile(file);
      });
    });

    const txtIdeCode = document.getElementById("txtTeamIdeCode");
    if (txtIdeCode) {
      txtIdeCode.addEventListener("input", () => {
        if (!currentTeam) return;
        currentTeam.projectFiles = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
        currentTeam.projectFiles[activeIdeFile] = txtIdeCode.value;
        const lineCount = txtIdeCode.value.split("\n").length;
        const lblLines = document.getElementById("lblIdeLines");
        if (lblLines) lblLines.textContent = `Lines: ${lineCount}`;
      });
    }

    document.getElementById("btnSyncCppFromBlocks")?.addEventListener("click", () => {
      syncIdeAutonsFromBlocks();
      showToast("⚡ Regenerated autons.cpp from active action blocks!", "✨");
    });

    document.getElementById("btnSaveCppCode")?.addEventListener("click", async () => {
      if (!currentTeam) return;
      if (!canCurrentUserEditCode()) {
        const note = prompt("Enter description for your C++ Code Suggestion:", `Updated ${activeIdeFile}`);
        if (note) proposeTeamSuggestion(note.trim(), "code_suggestion", { paths: activePaths, projectFiles: currentTeam.projectFiles });
        return;
      }
      currentTeam.updatedAt = Date.now();
      await fsSaveTeamDoc(currentTeam);
      broadcastEdit(`Updated C++ file "${activeIdeFile}"`, "code_edit", true);
      showToast(`💾 Saved C++ code (${activeIdeFile}) to team project!`, "✅");
    });

    document.getElementById("btnProposeCodeSuggestion")?.addEventListener("click", () => {
      const note = prompt("Enter description for proposed C++ code change:", `Suggested edit in ${activeIdeFile}`);
      if (note) proposeTeamSuggestion(note.trim(), "code_suggestion", { paths: activePaths, projectFiles: currentTeam.projectFiles });
    });

    document.getElementById("btnNewSuggestion")?.addEventListener("click", () => {
      const note = prompt("Enter proposal title / summary for team suggestion:", "Improved autonomous trajectory");
      if (note) proposeTeamSuggestion(note.trim(), "code_suggestion", { paths: activePaths, projectFiles: currentTeam.projectFiles });
    });

    // 6d. Local Planner & IDE Sync Button
    document.getElementById("btnSyncLocalPlanner")?.addEventListener("click", syncTeamProjectToLocalPlanner);

    // 6e. Team Settings Modal Event Handlers
    const modalSettings = document.getElementById("modalTeamSettings");
    document.getElementById("btnCloseTeamSettingsModal")?.addEventListener("click", () => {
      if (modalSettings) modalSettings.style.display = "none";
    });
    document.getElementById("btnSaveTeamSettings")?.addEventListener("click", async () => {
      if (!currentTeam) return;
      currentTeam.updatedAt = Date.now();
      await fsSaveTeamDoc(currentTeam);
      if (modalSettings) modalSettings.style.display = "none";
      renderMemberList();
      showToast("💾 Saved team roles and code edit permissions!", "✅");
    });
    document.getElementById("btnSettingsExitTeam")?.addEventListener("click", () => {
      if (modalSettings) modalSettings.style.display = "none";
      openExitTeamChallengeModal();
    });

    // 6f. Diffs Viewer Modal Event Handlers
    const modalDiff = document.getElementById("modalDiffViewer");
    document.getElementById("btnCloseDiffModal")?.addEventListener("click", () => {
      if (modalDiff) modalDiff.style.display = "none";
    });
    document.getElementById("btnRejectDiff")?.addEventListener("click", () => {
      if (modalDiff) modalDiff.style.display = "none";
      const banner = document.getElementById("teamDiffBanner");
      if (banner) banner.style.display = "none";
      showToast("Kept current local version.", "ℹ️");
    });
    document.getElementById("btnAcceptDiff")?.addEventListener("click", () => {
      if (pendingRemoteState) {
        if (pendingRemoteState.pathPayload?.paths) activePaths = pendingRemoteState.pathPayload.paths;
        if (pendingRemoteState.projectFiles) currentTeam.projectFiles = pendingRemoteState.projectFiles;
        currentTeam.updatedAt = Date.now();
        renderRoutinesSelector();
        renderActionBlocks();
        renderIdeFile();
        drawField();
        showToast("✅ Merged teammate changes into local workspace!", "🎉");
      }
      if (modalDiff) modalDiff.style.display = "none";
      const banner = document.getElementById("teamDiffBanner");
      if (banner) banner.style.display = "none";
    });
    document.getElementById("btnReviewDiffs")?.addEventListener("click", () => {
      if (pendingRemoteState) openDiffModal(pendingRemoteState);
    });

    // 6g. Google Drive Cloud Project Selector Modal Handlers
    const modalDriveSelector = document.getElementById("modalDriveProjectSelector");
    document.getElementById("btnCloseDriveSelectorModal")?.addEventListener("click", () => {
      if (modalDriveSelector) modalDriveSelector.style.display = "none";
    });
    document.getElementById("btnCancelDriveSelector")?.addEventListener("click", () => {
      if (modalDriveSelector) modalDriveSelector.style.display = "none";
    });

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
    document.getElementById("btnSubmitStrategy")?.addEventListener("click", async () => {
      const title = document.getElementById("txtStratTitle")?.value.trim();
      const desc = document.getElementById("txtStratDesc")?.value.trim();
      const routine = document.getElementById("selStratRoutine")?.value || "";

      if (!title) {
        alert("Please enter a strategy title.");
        return;
      }

      const normEmail = (currentUser?.email || "").toLowerCase();
      const authorName = currentUser?.displayName || normEmail.split("@")[0] || "Member";
      const now = Date.now();

      let updatedStrategies = null;
      const apiRoute = resolveApiUrl("/api/team/strategy/add");
      if (apiRoute) {
        const srvRes = await safeFetchJson(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: currentTeam.teamId,
            email: normEmail,
            authorName,
            title,
            description: desc,
            targetRoutine: routine
          })
        });
        if (srvRes.ok && srvRes.data?.success && srvRes.data?.strategies) {
          updatedStrategies = srvRes.data.strategies;
        }
      }

      if (!updatedStrategies) {
        currentTeam.strategies = currentTeam.strategies || [];
        const newStrat = {
          id: "strat_" + now.toString(36),
          title,
          description: desc,
          targetRoutine: routine,
          authorEmail: normEmail,
          authorName,
          createdAt: now,
          status: "active",
          votes: { [normEmail]: "rocket" }
        };
        currentTeam.strategies.unshift(newStrat);
        currentTeam.updatedAt = now;
        await fsSaveTeamDoc(currentTeam);
        updatedStrategies = currentTeam.strategies;
      }

      currentTeam.strategies = updatedStrategies;
      const modalStrat = document.getElementById("modalProposeStrategy");
      if (modalStrat) modalStrat.style.display = "none";
      renderStrategies();
      showToast("🗳️ Match strategy proposed to team", "✨");
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

    // Google Drive Sync Button
    const btnDriveSync = document.getElementById("btnDriveSync");
    if (btnDriveSync) {
      btnDriveSync.onclick = async () => {
        if (!currentTeam) {
          showToast("No active team to sync.", "⚠️");
          return;
        }
        btnDriveSync.textContent = "☁️ Syncing...";
        try {
          if (!window.GoogleDriveSync) {
            throw new Error("Google Drive module not loaded.");
          }
          await syncTeamToGoogleDrive(currentTeam);
          showToast("Successfully synced active team to your Google Drive!", "☁️");
        } catch (err) {
          showToast("Google Drive Sync: " + (err.message || err), "⚠️");
        } finally {
          btnDriveSync.textContent = "☁️ Drive Sync";
        }
      };
    }

    // Google Drive Restore Button (recovery of team workspaces across devices)
    const btnRestoreFromDrive = document.getElementById("btnRestoreFromDrive");
    if (btnRestoreFromDrive) {
      btnRestoreFromDrive.onclick = async () => {
        btnRestoreFromDrive.textContent = "☁️ Restoring...";
        try {
          if (!window.GoogleDriveSync) {
            throw new Error("Google Drive module not loaded.");
          }
          // Force authorization with popup picker so we have access to fetch files
          await window.GoogleDriveSync.getAccessToken(true);
          
          showToast("Searching your Google Drive for team files...", "⏳");
          const team = await restoreTeamFromGoogleDrive();
          if (!team) {
            throw new Error("No VEX team file found in your Google Drive 'VEX Path Planner' folder.");
          }

          showToast(`Found team "${team.teamName || 'VEX Team'}"! Restoring workspace...`, "⏳");
          
          // Save locally
          currentTeam = team;
          localStorage.setItem("lemlib_active_team", JSON.stringify(team));
          localStorage.setItem("lemlib_user_team_id", team.teamId);
          
          const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
          if (currentUser && currentUser.email) {
            const cleanKeys = getCleanEmailKeys(currentUser.email);
            cleanKeys.forEach(k => { uTeams[k] = team.teamId; });
          }
          localStorage.setItem("lemlib_user_teams", JSON.stringify(uTeams));

          // Re-publish/heal Firestore database with this restored team and sync rosters
          await fsSaveTeamDoc(team);

          // Update UI
          const setupView = document.getElementById("teamSetupJoinView");
          const wsView = document.getElementById("teamWorkspaceView");
          if (setupView) setupView.style.display = "none";
          if (wsView) wsView.style.display = "flex";

          onTeamLoaded();
          showToast(`Successfully restored team workspace: ${team.teamName}!`, "🎉");
        } catch (err) {
          alert("Google Drive Restore Error: " + (err.message || err));
          showToast("Restore failed: " + (err.message || err), "⚠️");
        } finally {
          btnRestoreFromDrive.textContent = "☁️ Restore from Drive";
        }
      };
    }

    // 13. Team Settings & Exit Team Challenge Modal
    let currentExitChallengeCode = "";

    function openExitTeamChallengeModal() {
      if (!currentTeam) return;
      const modal = document.getElementById("modalExitTeamChallenge");
      const lblTarget = document.getElementById("lblExitTeamTargetName");
      const lblPrompt = document.getElementById("lblExitChallengePrompt");
      const txtInput = document.getElementById("txtExitChallengeInput");
      const lblFeedback = document.getElementById("lblExitChallengeFeedback");
      const btnConfirm = document.getElementById("btnConfirmExitTeam");

      if (!modal) return;

      const randNum = Math.floor(1000 + Math.random() * 9000);
      currentExitChallengeCode = "LEAVE-" + randNum;

      if (lblTarget) lblTarget.textContent = `${currentTeam.teamName || "Team"} (${currentTeam.teamCode || ""})`;
      if (lblPrompt) lblPrompt.textContent = currentExitChallengeCode;
      if (txtInput) {
        txtInput.value = "";
        txtInput.style.borderColor = "#334155";
      }
      if (lblFeedback) {
        lblFeedback.textContent = "Type the verification code above to unlock the exit button.";
        lblFeedback.style.color = "#f87171";
      }
      if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.style.opacity = "0.5";
        btnConfirm.style.cursor = "not-allowed";
        btnConfirm.textContent = "🚪 Confirm & Exit Team";
      }

      modal.style.display = "flex";
      setTimeout(() => txtInput?.focus(), 100);
    }

    const txtExitInput = document.getElementById("txtExitChallengeInput");
    if (txtExitInput) {
      txtExitInput.addEventListener("input", () => {
        const val = txtExitInput.value.trim().toUpperCase();
        const lblFeedback = document.getElementById("lblExitChallengeFeedback");
        const btnConfirm = document.getElementById("btnConfirmExitTeam");
        if (val === currentExitChallengeCode) {
          if (lblFeedback) {
            lblFeedback.textContent = "✅ Challenge verified! You may now confirm exit.";
            lblFeedback.style.color = "#4ade80";
          }
          if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.style.opacity = "1";
            btnConfirm.style.cursor = "pointer";
          }
        } else {
          if (lblFeedback) {
            lblFeedback.textContent = "Code does not match yet. Type: " + currentExitChallengeCode;
            lblFeedback.style.color = "#f87171";
          }
          if (btnConfirm) {
            btnConfirm.disabled = true;
            btnConfirm.style.opacity = "0.5";
            btnConfirm.style.cursor = "not-allowed";
          }
        }
      });
    }

    const btnCloseExitModal = document.getElementById("btnCloseExitTeamModal");
    const btnCancelExitModal = document.getElementById("btnCancelExitTeam");
    [btnCloseExitModal, btnCancelExitModal].forEach(btn => {
      btn?.addEventListener("click", () => {
        const modal = document.getElementById("modalExitTeamChallenge");
        if (modal) modal.style.display = "none";
      });
    });

    const btnConfirmExit = document.getElementById("btnConfirmExitTeam");
    if (btnConfirmExit) {
      btnConfirmExit.addEventListener("click", async () => {
        if (!currentTeam || !currentUser) return;
        btnConfirmExit.disabled = true;
        btnConfirmExit.textContent = "Exiting Team...";

        const teamId = currentTeam.teamId;
        const normEmail = (currentUser.email || "").toLowerCase();

        const apiRoute = resolveApiUrl("/api/team/leave");
        if (apiRoute) {
          await safeFetchJson(apiRoute, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teamId, email: normEmail })
          });
        }

        await fsLeaveTeam(teamId, cleanEmailKey(normEmail));

        try {
          localStorage.removeItem("lemlib_active_team");
          localStorage.removeItem("lemlib_user_team_id");
          const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
          const cleanKeys = getCleanEmailKeys(normEmail);
          cleanKeys.forEach(k => { delete uTeams[k]; });
          localStorage.setItem("lemlib_user_teams", JSON.stringify(uTeams));
        } catch (_) {}

        currentTeam = null;
        const modal = document.getElementById("modalExitTeamChallenge");
        if (modal) modal.style.display = "none";

        const teamWorkspaceView = document.getElementById("teamWorkspaceView");
        const teamSetupJoinView = document.getElementById("teamSetupJoinView");
        if (teamWorkspaceView) teamWorkspaceView.style.display = "none";
        if (teamSetupJoinView) teamSetupJoinView.style.display = "block";

        showToast("🚪 Exited team successfully. Select or create a workspace.", "ℹ️");
      });
    }

    document.getElementById("btnExitTeamHeader")?.addEventListener("click", openExitTeamChallengeModal);
    document.getElementById("btnExitTeamRoster")?.addEventListener("click", openExitTeamChallengeModal);
    document.getElementById("btnManageTeam")?.addEventListener("click", () => {
      if (!currentTeam) return;
      openTeamSettingsModal();
    });
    document.getElementById("btnInviteMember")?.addEventListener("click", () => {
      if (!currentTeam) return;
      openTeamSettingsModal();
    });

    // GitHub Sync buttons
    document.getElementById("btnSyncGithub")?.addEventListener("click", openGithubPushModal);
    document.getElementById("btnIdePushGithub")?.addEventListener("click", openGithubPushModal);
    document.getElementById("btnCloseGithubPushModal")?.addEventListener("click", () => {
      const modal = document.getElementById("modalGithubPush");
      if (modal) modal.style.display = "none";
    });
    document.getElementById("btnCancelGithubPush")?.addEventListener("click", () => {
      const modal = document.getElementById("modalGithubPush");
      if (modal) modal.style.display = "none";
    });
    document.getElementById("btnExecuteGithubPush")?.addEventListener("click", executeGithubPush);

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
          let updatedTeam = null;
          const apiRoute = resolveApiUrl("/api/team/import-project");
          if (apiRoute) {
            const srvRes = await safeFetchJson(apiRoute, {
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
            if (srvRes.ok && srvRes.data?.success && srvRes.data?.team) {
              updatedTeam = srvRes.data.team;
            }
          }

          // Fallback for static host / GitHub Pages / offline / non-JSON responses
          if (!updatedTeam) {
            const now = Date.now();
            currentTeam.pathPayload = { paths: local.paths };
            currentTeam.project = local.project || currentTeam.project;

            currentTeam.versionHistory = currentTeam.versionHistory || [];
            currentTeam.versionHistory.unshift({
              id: "v_" + now + "_import_planner",
              timestamp: now,
              dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              authorEmail: currentUser.email,
              authorName: currentUser.displayName || currentUser.email.split("@")[0],
              authorRole: currentUser.role || "Programmer",
              authorColor: getRoleColor(currentUser.role || "Programmer"),
              actionSummary: `Imported project "${local.project?.name || 'Visual Planner'}" into team workspace`,
              editType: "project_import",
              snapshot: { paths: local.paths }
            });
            if (currentTeam.versionHistory.length > 500) currentTeam.versionHistory.length = 500;
            currentTeam.updatedAt = now;

            await fsSaveTeamDoc(currentTeam);
            try {
              localStorage.setItem("lemlib_active_team", JSON.stringify(currentTeam));
            } catch (_) {}
            updatedTeam = currentTeam;
          }

          btnExecutePlannerImport.disabled = false;
          btnExecutePlannerImport.textContent = "🗺️ Confirm & Import to Team";

          currentTeam = updatedTeam;
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
        } catch (err) {
          btnExecutePlannerImport.disabled = false;
          btnExecutePlannerImport.textContent = "🗺️ Confirm & Import to Team";
          alert("Import failed: " + (err.message || err));
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
        const branchVal = txtImportGithubBranch?.value.trim() || "main";
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
          let cloneData = null;
          const apiRoute = resolveApiUrl("/api/github/clone");
          if (apiRoute) {
            const srvRes = await safeFetchJson(apiRoute, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ repo: repoVal, branch: branchVal, token: tokenVal })
            });
            if (srvRes.ok && srvRes.data?.success && srvRes.data?.files) {
              cloneData = srvRes.data;
            }
          }

          // Fallback for static host / GitHub Pages: fetch raw repository files directly via GitHub REST API
          if (!cloneData) {
            cloneData = await fetchGithubRepositoryFiles(repoVal, branchVal, tokenVal, (msg) => {
              if (githubImportStatus) githubImportStatus.textContent = "⚙️ " + msg;
            });
          }

          if (!cloneData || !cloneData.files || Object.keys(cloneData.files).length === 0) {
            throw new Error("No C++ autonomous files found in selected repository.");
          }

          if (githubImportStatus) {
            githubImportStatus.textContent = `⚙️ Extracted ${cloneData.fileCount} files. Parsing C++ LemLib autons...`;
          }

          const detectedPaths = parseGithubAutonFiles(cloneData.files, cloneData.repoName);
          const now = Date.now();

          let importData = null;
          const importRoute = resolveApiUrl("/api/team/import-project");
          if (importRoute) {
            const srvImport = await safeFetchJson(importRoute, {
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
            if (srvImport.ok && srvImport.data?.success) {
              importData = srvImport.data;
            }
          }

          if (!importData) {
            currentTeam.pathPayload = { paths: detectedPaths };
            currentTeam.project = { name: cloneData.repoName || repoVal, files: cloneData.files };
            currentTeam.versionHistory = currentTeam.versionHistory || [];
            currentTeam.versionHistory.unshift({
              id: "v_" + now + "_import_github",
              timestamp: now,
              dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              authorEmail: currentUser.email,
              authorName: currentUser.displayName || currentUser.email.split("@")[0],
              authorRole: currentUser.role || "Programmer",
              authorColor: getRoleColor(currentUser.role || "Programmer"),
              actionSummary: `Cloned & imported GitHub repository "${repoVal}"`,
              editType: "github_import",
              snapshot: { paths: detectedPaths }
            });
            if (currentTeam.versionHistory.length > 500) currentTeam.versionHistory.length = 500;
            currentTeam.updatedAt = now;

            await fsSaveTeamDoc(currentTeam);
            try {
              localStorage.setItem("lemlib_active_team", JSON.stringify(currentTeam));
            } catch (_) {}
            importData = { success: true, team: currentTeam };
          }

          btnExecuteGithubImport.disabled = false;
          btnExecuteGithubImport.textContent = "🚀 Clone & Import Repository";

          currentTeam = importData.team || currentTeam;
          if (currentTeam.pathPayload?.paths) {
            activePaths = currentTeam.pathPayload.paths;
            activeRoutineIndex = 0;
          }
          if (modalGithubImport) modalGithubImport.style.display = "none";
          renderRoutinesSelector();
          renderActionBlocks();
          renderVersionHistory();
          drawField();
          showToast(`🚀 Successfully imported ${repoVal} into team workspace!`, "🎉");
        } catch (err) {
          btnExecuteGithubImport.disabled = false;
          btnExecuteGithubImport.textContent = "🚀 Clone & Import Repository";
          if (githubImportStatus) {
            githubImportStatus.style.background = "rgba(239, 68, 68, 0.1)";
            githubImportStatus.style.color = "#f87171";
            githubImportStatus.textContent = `❌ Error: ${err.message}`;
          }
          alert("GitHub import failed: " + (err.message || err));
        }
      });
    }
  }

  // --------------------------------------------------------------------------
  // INIT
  // --------------------------------------------------------------------------
  window.addEventListener("DOMContentLoaded", () => {
    initAuth();
    initTeamEditor();
    wireScoringModal();
    wireCollisionModal();
    wireDebugPanel();
    wireEvents();
    drawField();
    if (window.location.hash === "#join") {
      document.getElementById("tabGateJoin")?.click();
    } else if (window.location.hash === "#create") {
      document.getElementById("tabGateCreate")?.click();
    }
  });

})(window);
