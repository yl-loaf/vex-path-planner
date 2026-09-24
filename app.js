(() => {
  "use strict";

  // Canvas roundRect polyfill for maximum browser compatibility
  if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
      const r = typeof radii === "number" ? radii : (Array.isArray(radii) ? radii[0] : 0);
      const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      this.beginPath();
      this.moveTo(x + rad, y);
      this.arcTo(x + w, y, x + w, y + h, rad);
      this.arcTo(x + w, y + h, x, y + h, rad);
      this.arcTo(x, y + h, x, y, rad);
      this.arcTo(x, y, x + w, y, rad);
      this.closePath();
      return this;
    };
  }

  // Universal helper to open modals by ID safely
  window.openModalById = function(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.hidden = false;
      modal.classList.add("open");
    } else {
      console.warn("⚠️ Modal with ID not found:", id);
    }
  };

  // -- Constants ----------------------------------------------------
  const FIELD_IN = 144;
  const HALF = 70.5;
  const STORAGE_KEY = "vex-lemlib-path-v1";
  const HIT_R = 14;

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
    // Real-Time Drive Physics & Auton Clock
    motorCount: 6,
    robotWeightLbs: 15.0,
    wheelTraction: 0.85,
    batteryVolts: 12.8,
    matchPeriod: "15s",
    // LemLib Lateral Controller PID & Settling Parameters
    lateralKp: 8.0,
    lateralKi: 0.0,
    lateralKd: 30.0,
    lateralWindup: 3.0,
    lateralSmallErr: 1.0,
    lateralSmallTime: 100,
    lateralLargeErr: 3.0,
    lateralLargeTime: 500,
    lateralSlew: 0,
    // LemLib Angular Controller PID & Settling Parameters
    angularKp: 2.0,
    angularKi: 0.0,
    angularKd: 10.0,
    angularWindup: 3.0,
    angularSmallErr: 1.0,
    angularSmallTime: 100,
    angularLargeErr: 3.0,
    angularLargeTime: 500,
    angularSlew: 0,
    // Tracking Wheels & Odometry Sensors
    horizTrackerOffset: -2.5,
    horizTrackerWheelDiam: 2.0,
    horizTrackerPort: 9,
    vertTrackerOffset: 0.0,
    vertTrackerWheelDiam: 2.75,
    vertTrackerPort: null,
    imuPort: 10,
    // Top-down image & CAD
    botImage: null,
    botImageOrientation: 0, // 0: UP, 90: RIGHT, 180: DOWN, 270: LEFT
    botImageOpacity: 1.0,
    botImageShowOutline: true,
    botImageEnabled: true,
    botImageNaturalRatio: 1.0,
    botLockRatio: false,
  };

  const SAMPLE_BOT_VEX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="chassisGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#475569"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="wheelGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#334155"/>
      <stop offset="50%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>
    <linearGradient id="flexGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect x="22" y="20" width="156" height="160" rx="6" fill="#0b111e" stroke="#334155" stroke-width="2"/>
  <rect x="24" y="22" width="18" height="156" rx="2" fill="url(#chassisGrad)" stroke="#64748b" stroke-width="1"/>
  <rect x="46" y="24" width="14" height="152" rx="2" fill="url(#chassisGrad)" stroke="#475569" stroke-width="1"/>
  <rect x="140" y="24" width="14" height="152" rx="2" fill="url(#chassisGrad)" stroke="#475569" stroke-width="1"/>
  <rect x="158" y="22" width="18" height="156" rx="2" fill="url(#chassisGrad)" stroke="#64748b" stroke-width="1"/>
  <g fill="#0f172a">
    <circle cx="33" cy="35" r="2.5"/><circle cx="33" cy="55" r="2.5"/><circle cx="33" cy="75" r="2.5"/>
    <circle cx="33" cy="95" r="2.5"/><circle cx="33" cy="115" r="2.5"/><circle cx="33" cy="135" r="2.5"/><circle cx="33" cy="155" r="2.5"/>
    <circle cx="167" cy="35" r="2.5"/><circle cx="167" cy="55" r="2.5"/><circle cx="167" cy="75" r="2.5"/>
    <circle cx="167" cy="95" r="2.5"/><circle cx="167" cy="115" r="2.5"/><circle cx="167" cy="135" r="2.5"/><circle cx="167" cy="155" r="2.5"/>
  </g>
  <rect x="60" y="32" width="80" height="14" rx="2" fill="url(#chassisGrad)" stroke="#475569" stroke-width="1"/>
  <rect x="60" y="154" width="80" height="14" rx="2" fill="url(#chassisGrad)" stroke="#475569" stroke-width="1"/>
  <!-- Left Wheels -->
  <rect x="6" y="28" width="16" height="38" rx="4" fill="url(#wheelGrad)" stroke="#64748b" stroke-width="1"/>
  <rect x="9" y="32" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="9" y="44" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="9" y="56" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="6" y="81" width="16" height="38" rx="4" fill="url(#wheelGrad)" stroke="#64748b" stroke-width="1"/>
  <rect x="9" y="85" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="9" y="97" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="9" y="109" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="6" y="134" width="16" height="38" rx="4" fill="url(#wheelGrad)" stroke="#64748b" stroke-width="1"/>
  <rect x="9" y="138" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="9" y="150" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="9" y="162" width="10" height="6" rx="1" fill="#38bdf8"/>
  <!-- Right Wheels -->
  <rect x="178" y="28" width="16" height="38" rx="4" fill="url(#wheelGrad)" stroke="#64748b" stroke-width="1"/>
  <rect x="181" y="32" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="181" y="44" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="181" y="56" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="178" y="81" width="16" height="38" rx="4" fill="url(#wheelGrad)" stroke="#64748b" stroke-width="1"/>
  <rect x="181" y="85" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="181" y="97" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="181" y="109" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="178" y="134" width="16" height="38" rx="4" fill="url(#wheelGrad)" stroke="#64748b" stroke-width="1"/>
  <rect x="181" y="138" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="181" y="150" width="10" height="6" rx="1" fill="#38bdf8"/>
  <rect x="181" y="162" width="10" height="6" rx="1" fill="#38bdf8"/>
  <!-- Front Intake Rollers -->
  <rect x="62" y="14" width="76" height="12" rx="3" fill="#0f172a" stroke="#64748b" stroke-width="1"/>
  <rect x="70" y="10" width="18" height="20" rx="3" fill="url(#flexGrad)" stroke="#34d399" stroke-width="1"/>
  <rect x="112" y="10" width="18" height="20" rx="3" fill="url(#flexGrad)" stroke="#34d399" stroke-width="1"/>
  <line x1="62" y1="20" x2="138" y2="20" stroke="#cbd5e1" stroke-width="2"/>
  <!-- V5 Brain -->
  <rect x="66" y="60" width="68" height="46" rx="4" fill="#18181b" stroke="#3f3f46" stroke-width="1.5"/>
  <rect x="72" y="66" width="46" height="34" rx="2" fill="#09090b" stroke="#22c55e" stroke-width="1"/>
  <text x="76" y="80" font-family="monospace" font-size="7" fill="#22c55e" font-weight="bold">V5 LEMLIB</text>
  <text x="76" y="92" font-family="monospace" font-size="6" fill="#38bdf8">14.0x14.0&quot;</text>
  <circle cx="125" cy="83" r="4" fill="#22c55e"/>
  <!-- V5 Battery -->
  <rect x="66" y="116" width="68" height="26" rx="3" fill="#27272a" stroke="#52525b" stroke-width="1"/>
  <text x="82" y="132" font-family="sans-serif" font-size="8" font-weight="bold" fill="#a1a1aa">V5 BATTERY</text>
  <!-- Tanks -->
  <rect x="48" y="56" width="10" height="50" rx="4" fill="#94a3b8" stroke="#475569" stroke-width="1"/>
  <rect x="142" y="56" width="10" height="50" rx="4" fill="#94a3b8" stroke="#475569" stroke-width="1"/>
  <!-- Front Marker -->
  <polygon points="100,26 88,42 112,42" fill="#f59e0b" stroke="#d97706" stroke-width="1"/>
  <text x="100" y="52" font-family="sans-serif" font-size="8" font-weight="bold" fill="#f59e0b" text-anchor="middle">FRONT ↑</text>
</svg>`;

  let botImgElement = new Image();
  let botImgReady = false;

  // -- DOM ----------------------------------------------------------
  const canvas = document.getElementById("field");
  const ctx = canvas.getContext("2d");
  const coordsEl = document.getElementById("coords");
  const actionFlow = document.getElementById("actionFlow");
  const codeOut = document.getElementById("codeOut");
  const saveStatus = document.getElementById("saveStatus");
  const fileInput = document.getElementById("fileInput");

  const startX = document.getElementById("startX");
  const startY = document.getElementById("startY");
  const startTheta = document.getElementById("startTheta");
  const newType = document.getElementById("newType");
  const speedLabel = document.getElementById("speedLabel") || document.getElementById("speedLabelField");

  // -- State --------------------------------------------------------
  let fieldImg = new Image();
  fieldImg.src = "field.jpg";
  let imgReady = false;
  fieldImg.onload = () => { imgReady = true; draw(); };
  fieldImg.onerror = () => { imgReady = true; draw(); };

  let paths = [
    {
      id: "p_default",
      name: "Red Left",
      pose: { x: -60, y: -60, theta: 0 },
      actions: [],
    },
  ];
  let activePathId = "p_default";
  let selectedId = null;
  let drag = null;

  function activePath() {
    return paths.find((p) => p.id === activePathId) || paths[0];
  }
  // Live aliases used throughout the app
  let pose = paths[0].pose;
  let actions = paths[0].actions;
  let pendingDeleteActionId = null;
  let dragData = null;

  function moveAction(source, dest) {
    if (!source || !dest) return;
    let movedAct = null;

    if (source.source === "main") {
      const sIdx = actions.findIndex((x) => x.id === source.id);
      if (sIdx !== -1) {
        movedAct = actions.splice(sIdx, 1)[0];
      }
    } else if (source.source === "loop") {
      const parentLoop = actions.find((x) => x.id === source.parentLoopId);
      if (parentLoop && Array.isArray(parentLoop.children)) {
        const cIdx = parentLoop.children.findIndex((x) => x.id === source.id);
        if (cIdx !== -1) {
          movedAct = parentLoop.children.splice(cIdx, 1)[0];
        }
      }
    } else if (source.source === "ifelse") {
      const parentIf = actions.find((x) => x.id === source.parentIfId);
      if (parentIf) {
        const branchList = source.branch === "else" ? parentIf.elseChildren : parentIf.thenChildren;
        if (Array.isArray(branchList)) {
          const cIdx = branchList.findIndex((x) => x.id === source.id);
          if (cIdx !== -1) {
            movedAct = branchList.splice(cIdx, 1)[0];
          }
        }
      }
    }

    if (!movedAct) return;

    if (dest.target === "main") {
      let tIdx = dest.targetIdx != null ? dest.targetIdx : actions.length;
      tIdx = Math.max(0, Math.min(actions.length, tIdx));
      actions.splice(tIdx, 0, movedAct);
      showToast(`🔄 Reordered ${movedAct.type} in routine`);
    } else if (dest.target === "loop") {
      const targetLoop = actions.find((x) => x.id === dest.targetLoopId);
      if (targetLoop) {
        if (!Array.isArray(targetLoop.children)) targetLoop.children = [];
        let cIdx = dest.targetChildIdx != null ? dest.targetChildIdx : targetLoop.children.length;
        cIdx = Math.max(0, Math.min(targetLoop.children.length, cIdx));
        targetLoop.children.splice(cIdx, 0, movedAct);
        showToast(`🔄 Moved ${movedAct.type} block into loop`);
      } else {
        actions.push(movedAct);
      }
    } else if (dest.target === "ifelse") {
      const targetIf = actions.find((x) => x.id === dest.targetIfId);
      if (targetIf) {
        const branch = dest.branch === "else" ? "else" : "then";
        if (branch === "else") {
          if (!Array.isArray(targetIf.elseChildren)) targetIf.elseChildren = [];
          let cIdx = dest.targetChildIdx != null ? dest.targetChildIdx : targetIf.elseChildren.length;
          cIdx = Math.max(0, Math.min(targetIf.elseChildren.length, cIdx));
          targetIf.elseChildren.splice(cIdx, 0, movedAct);
          showToast(`🔄 Moved ${movedAct.type} block into Else branch`);
        } else {
          if (!Array.isArray(targetIf.thenChildren)) targetIf.thenChildren = [];
          let cIdx = dest.targetChildIdx != null ? dest.targetChildIdx : targetIf.thenChildren.length;
          cIdx = Math.max(0, Math.min(targetIf.thenChildren.length, cIdx));
          targetIf.thenChildren.splice(cIdx, 0, movedAct);
          showToast(`🔄 Moved ${movedAct.type} block into Then branch`);
        }
      } else {
        actions.push(movedAct);
      }
    }

    markDirty();
    renderFlow();
    draw();
    generateCode();
    try { updateTimeDisplay(); } catch (_) {}
  }

  function addBlockToLoop(loopId, type) {
    const loop = actions.find((x) => x.id === loopId);
    if (!loop) return;
    if (!Array.isArray(loop.children)) loop.children = [];

    const defMax = bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127;
    const defMin = bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0;
    const poses = computePoses();
    const last = poses[poses.length - 1] || { x: pose.x, y: pose.y, theta: pose.theta };

    const child = defaultAction(type);
    if (needsPoint(type) || isMove(type)) {
      child.x = Number((last.x + 12).toFixed(1));
      child.y = Number(last.y.toFixed(1));
    }
    if (needsHeading(type)) child.theta = last.theta;
    child.maxSpeed = defMax;
    child.minSpeed = defMin;

    loop.children.push(child);
    selectedId = child.id;

    markDirty();
    renderFlow();
    draw();
    generateCode();
    try { updateTimeDisplay(); } catch (_) {}
    showToast(`➕ Added ${type} block to loop (${loop.children.length} total)`);
  }

  function addBlockToIfElse(ifId, branch, type) {
    const ifAct = actions.find((x) => x.id === ifId);
    if (!ifAct) return;
    if (!Array.isArray(ifAct.thenChildren)) ifAct.thenChildren = [];
    if (!Array.isArray(ifAct.elseChildren)) ifAct.elseChildren = [];

    const defMax = bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127;
    const defMin = bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0;
    const poses = computePoses();
    const last = poses[poses.length - 1] || { x: pose.x, y: pose.y, theta: pose.theta };

    const child = defaultAction(type);
    if (needsPoint(type) || isMove(type)) {
      child.x = Number((branch === "else" ? (last.x - 12) : (last.x + 12)).toFixed(1));
      child.y = Number((branch === "else" ? (last.y - 12) : (last.y + 12)).toFixed(1));
    }
    if (needsHeading(type)) child.theta = last.theta;
    child.maxSpeed = defMax;
    child.minSpeed = defMin;

    const list = branch === "else" ? ifAct.elseChildren : ifAct.thenChildren;
    list.push(child);
    selectedId = child.id;

    markDirty();
    renderFlow();
    draw();
    generateCode();
    try { updateTimeDisplay(); } catch (_) {}
    showToast(`➕ Added ${type} block to ${branch === 'else' ? 'Else' : 'Then'} branch (${list.length} total)`);
  }

  function bindActive() {
    const p = activePath();
    pose = p.pose;
    actions = p.actions;
    isSimPathDirty = true;
  }

  function uidPath() {
    return "p" + Math.random().toString(36).slice(2, 9);
  }

  function syncPathSelect() {
    const sel = document.getElementById("pathSelect");
    if (!sel) return;
    sel.innerHTML = "";
    paths.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === activePathId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderPathSelect() {
    syncPathSelect();
  }

  function switchPath(id) {
    if (!paths.some((p) => p.id === id)) return;
    activePathId = id;
    bindActive();
    selectedId = null;
    syncPathSelect();
    syncStartInputs();
    renderFlow();
    draw();
    generateCode();
    updateTimeDisplay();
    markDirty();
  }

  function addPath(name) {
    const n = name || `Routine ${paths.length + 1}`;
    const p = {
      id: uidPath(),
      name: n,
      pose: { x: -60, y: -60, theta: 0 },
      actions: [],
    };
    paths.push(p);
    switchPath(p.id);
  }

  function renameActivePath() {
    const p = activePath();
    const n = prompt("Routine name:", p.name);
    if (!n || !n.trim()) return;
    p.name = n.trim();
    syncPathSelect();
    markDirty();
    generateCode();
  }

  function duplicateActivePath() {
    const src = activePath();
    const p = {
      id: uidPath(),
      name: src.name + " Copy",
      pose: { ...src.pose },
      actions: src.actions.map((a) => ({ ...a, id: uid() })),
    };
    paths.push(p);
    switchPath(p.id);
  }

  function deleteActivePath() {
    if (paths.length <= 1) {
      alert("Keep at least one routine.");
      return;
    }
    const p = activePath();
    if (!confirm(`Delete routine "${p.name}"?`)) return;
    const idx = paths.findIndex((x) => x.id === p.id);
    paths.splice(idx, 1);
    activePathId = paths[Math.max(0, idx - 1)].id;
    bindActive();
    selectedId = null;
    syncPathSelect();
    syncStartInputs();
    renderFlow();
    draw();
    markDirty();
    generateCode();
  }


  let simRunning = false;
  let simPath = [];
  let simSegments = [];
  let simIdx = 0;
  let animId = null;
  let simSpeed = 1;
  let saveTimer = null;
  let isSimPathDirty = true;
  let tuningGraphType = "linear";

  // -- Trajectory Drawing Animation State -----------------------------
  let pathAnimProgress = 1.0;
  let pathAnimStartTime = 0;
  let pathAnimDuration = 600; // ms for trajectory draw animation
  let pathAnimFrameId = null;
  let isPathAnimating = false;

  function triggerPathAnimation(duration = 600) {
    if (typeof drag !== "undefined" && drag != null) {
      pathAnimProgress = 1.0;
      isPathAnimating = false;
      if (pathAnimFrameId) {
        cancelAnimationFrame(pathAnimFrameId);
        pathAnimFrameId = null;
      }
      return;
    }
    if (simRunning) {
      pathAnimProgress = 1.0;
      isPathAnimating = false;
      if (pathAnimFrameId) {
        cancelAnimationFrame(pathAnimFrameId);
        pathAnimFrameId = null;
      }
      return;
    }

    pathAnimDuration = duration;
    pathAnimStartTime = performance.now();
    pathAnimProgress = 0.0;
    isPathAnimating = true;

    if (pathAnimFrameId) {
      cancelAnimationFrame(pathAnimFrameId);
    }

    function animStep(now) {
      if (!isPathAnimating) return;
      const elapsed = now - pathAnimStartTime;
      const rawT = Math.min(1.0, elapsed / pathAnimDuration);
      // Cubic ease-out curve for smooth decelerating trajectory sweep
      pathAnimProgress = 1.0 - Math.pow(1.0 - rawT, 3);
      draw();
      if (rawT < 1.0 && isPathAnimating) {
        pathAnimFrameId = requestAnimationFrame(animStep);
      } else {
        pathAnimProgress = 1.0;
        isPathAnimating = false;
        pathAnimFrameId = null;
        draw();
      }
    }

    pathAnimFrameId = requestAnimationFrame(animStep);
  }

  // -- Condition Manager State (Boolean Variables & Flags) ------------
  const DEFAULT_CONDITIONS = [
    { id: "cond_isGoalLoaded", name: "isGoalLoaded", value: true, description: "Mobile goal clamp loaded / locked", type: "boolean" },
    { id: "cond_ringDetected", name: "ringDetected", value: false, description: "Optical sensor sees ring", type: "boolean" },
    { id: "cond_isRedAlliance", name: "isRedAlliance", value: true, description: "Red alliance match side", type: "boolean" },
    { id: "cond_isSkillsRun", name: "isSkillsRun", value: false, description: "Autonomous skills challenge mode", type: "boolean" },
    { id: "cond_distanceClear", name: "distanceClear", value: true, description: "Distance sensor > 10 inches clear", type: "boolean" },
  ];

  let conditions = JSON.parse(JSON.stringify(DEFAULT_CONDITIONS));

  function sanitizeConditionName(name) {
    if (!name) return "";
    let clean = name.trim().replace(/[^a-zA-Z0-9_.]/g, "");
    if (/^[0-9]/.test(clean)) clean = "_" + clean;
    return clean || "cond";
  }

  function evaluateConditionExpression(condStr) {
    if (!condStr || typeof condStr !== "string") return true;
    const trimmed = condStr.trim();
    if (trimmed === "true" || trimmed === "1") return true;
    if (trimmed === "false" || trimmed === "0") return false;

    // Direct variable match
    const found = conditions.find((c) => c.name === trimmed);
    if (found) return !!found.value;

    // Negation match e.g. !isGoalLoaded
    if (trimmed.startsWith("!")) {
      const sub = trimmed.slice(1).trim();
      const foundSub = conditions.find((c) => c.name === sub);
      if (foundSub) return !foundSub.value;
    }

    // Equality expression e.g. isGoalLoaded == true
    if (trimmed.includes("==")) {
      const parts = trimmed.split("==").map((s) => s.trim());
      if (parts.length === 2) {
        const leftVal = evaluateConditionExpression(parts[0]);
        const rightVal = (parts[1] === "true" || parts[1] === "1") ? true : ((parts[1] === "false" || parts[1] === "0") ? false : evaluateConditionExpression(parts[1]));
        return leftVal === rightVal;
      }
    }

    // Inequality expression e.g. isGoalLoaded != true
    if (trimmed.includes("!=")) {
      const parts = trimmed.split("!=").map((s) => s.trim());
      if (parts.length === 2) {
        const leftVal = evaluateConditionExpression(parts[0]);
        const rightVal = (parts[1] === "true" || parts[1] === "1") ? true : ((parts[1] === "false" || parts[1] === "0") ? false : evaluateConditionExpression(parts[1]));
        return leftVal !== rightVal;
      }
    }

    return true;
  }

  function uid() {
    return "a" + Math.random().toString(36).slice(2, 9);
  }

  function defaultAction(type) {
    if (type === "ifElse") {
      const defMax = bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127;
      const defMin = bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0;
      const defaultCond = conditions.length ? conditions[0].name : "isGoalLoaded";
      return {
        id: uid(),
        type: "ifElse",
        condition: defaultCond,
        thenLabel: "Move forward",
        elseLabel: "Move backwards",
        thenChildren: [
          {
            id: uid(),
            type: "moveToPoint",
            x: 24,
            y: 24,
            timeout: 2000,
            forwards: true,
            maxSpeed: defMax,
            minSpeed: defMin,
            earlyExitRange: 0,
          },
        ],
        elseChildren: [
          {
            id: uid(),
            type: "moveToPoint",
            x: -24,
            y: -24,
            timeout: 2000,
            forwards: false,
            maxSpeed: defMax,
            minSpeed: defMin,
            earlyExitRange: 0,
          },
        ],
        activeSimBranch: "then",
        label: "",
        async: false,
      };
    }
    if (type === "loop") {
      const defMax = bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127;
      const defMin = bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0;
      return {
        id: uid(),
        type: "loop",
        loopMode: "until", // "until", "for", "forever"
        condition: "!limit_switch.get_value()",
        times: 5,
        loopLabel: "Move forward",
        children: [
          {
            id: uid(),
            type: "moveToPoint",
            x: 24,
            y: 24,
            timeout: 2000,
            forwards: true,
            maxSpeed: defMax,
            minSpeed: defMin,
            earlyExitRange: 0,
            label: "Loop motion",
          },
        ],
        label: "",
        async: false,
      };
    }
    return {
      id: uid(),
      type,
      x: 0,
      y: 0,
      theta: 0,
      lead: bot.defaultLead != null ? bot.defaultLead : 0.6,
      cp1X: null,
      cp1Y: null,
      cp2X: null,
      cp2Y: null,
      lead1: 18,
      lead2: 18,
      timeout: type === "bezierCurve" ? 2500 : 2000,
      forwards: true,
      maxSpeed: bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127,
      minSpeed: bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0,
      earlyExitRange: 0,
      lockedSide: "LEFT",
      async: false,
      offsetX: 0,
      offsetY: 0,
      offsetTheta: 0,
      driftScaler: 1.0,
      waitType: "distance",
      distance: 12,
      delayMs: 250,
      customCode: "",
      customDuration: 0,
      label: "",
    };
  }

  // Field inner playable area calibration (derived from field.jpg 810x806)
  // Playing field 144" x 144" is bounded by perimeter walls inside the image:
  // x: 20.3px to 783.8px in 810px image (center = 402.05px, width = 763.5px)
  // y: 18.0px to 781.1px in 806px image (center = 399.55px, height = 763.1px)
  function getFieldMetrics() {
    if (imgReady && fieldImg.naturalWidth) {
      const cxCenter = canvas.width * (402.05 / 810.0);
      const cyCenter = canvas.height * (399.55 / 806.0);
      const scaleX = (canvas.width * (763.5 / 810.0)) / FIELD_IN;
      const scaleY = (canvas.height * (763.1 / 806.0)) / FIELD_IN;
      const scale = (scaleX + scaleY) / 2;
      return { cxCenter, cyCenter, scaleX, scaleY, scale };
    }
    const scale = canvas.width / FIELD_IN;
    return {
      cxCenter: canvas.width / 2,
      cyCenter: canvas.height / 2,
      scaleX: scale,
      scaleY: scale,
      scale: scale,
    };
  }

  function getFieldScale() {
    return getFieldMetrics().scale;
  }

  // -- Coordinate helpers -------------------------------------------
  function fieldToCanvas(x, y) {
    const m = getFieldMetrics();
    return {
      cx: m.cxCenter + x * m.scaleX,
      cy: m.cyCenter - y * m.scaleY,
    };
  }

  function canvasToField(cx, cy) {
    const m = getFieldMetrics();
    return {
      x: (cx - m.cxCenter) / m.scaleX,
      y: (m.cyCenter - cy) / m.scaleY,
    };
  }

  function headingRad(deg) {
    // Convert LemLib heading (0°=+Y, CW+) to canvas math angle for drawing
    return ((90 - deg) * Math.PI) / 180;
  }

  function screenHeadingRad(deg) {
    // Canvas context rotation: 0° heading (North) aligns local +X to point UP (screen -Y)
    return ((deg - 90) * Math.PI) / 180;
  }

  /** Normalize degrees to [0, 360) */
  function normalizeAngle(deg) {
    deg = deg % 360;
    if (deg < 0) deg += 360;
    return deg;
  }

  /**
   * LemLib-style angle from current position to a point.
   * 0° = +Y, increases clockwise (matches common VEX/LemLib field heading).
   * Equivalent to atan2(dx, dy) in degrees.
   */
  function angleToPoint(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    return normalizeAngle((Math.atan2(dx, dy) * 180) / Math.PI);
  }

  /**
   * Shortest angular error target - current, range (-180, 180].
   * Same idea as LemLib angleError.
   */
  function angleError(current, target) {
    let e = target - current;
    while (e > 180) e -= 360;
    while (e <= -180) e += 360;
    return e;
  }

  /**
   * Snaps an angle in degrees to the nearest 22.5° increment [0, 360).
   */
  function snapAngle22_5(deg) {
    const step = 22.5;
    const snapped = Math.round(deg / step) * step;
    return normalizeAngle(snapped);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ==========================================================================
  // FIELD COLLISION DETECTION ENGINE (VEX High Stakes: Walls, Loaders & Mogos)
  // ==========================================================================

  const FIELD_OBSTACLES = {
    // 1. Perimeter Walls: 144" x 144" field, inner boundaries ±70.5"
    walls: [
      { id: "wall_west", name: "West Wall (Left)", type: "wall", axis: "x", value: -70.5, sign: -1, label: "Left Perimeter Wall (-70.5\")" },
      { id: "wall_east", name: "East Wall (Right)", type: "wall", axis: "x", value: 70.5, sign: 1, label: "Right Perimeter Wall (+70.5\")" },
      { id: "wall_south", name: "South Wall (Bottom)", type: "wall", axis: "y", value: -70.5, sign: -1, label: "Bottom Perimeter Wall (-70.5\")" },
      { id: "wall_north", name: "North Wall (Top)", type: "wall", axis: "y", value: 70.5, sign: 1, label: "Top Perimeter Wall (+70.5\")" },
    ],
    // 2. Wall Match Loaders: 4 official loaders mounted on perimeter walls (calibrated to VEX High Stakes field specs & field.jpg)
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
    // 3. Mobile Goals: 9 starting field positions (including Middle Goal)
    // Radius = 3.1 inches (hexagonal base diameter ~6.2 inches) precisely matching field graphic
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
    // 4. Center Ladder Structure
    ladder: []
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

  // Cached collisions by action ID for instant UI rendering
  let actionCollisionsCache = new Map();
  let cachedRoutineCollisionReport = { totalCollisions: 0, collisions: [], collidingObstacleIds: new Set() };

  /**
   * Computes the 4 corners of the robot's oriented bounding box in field inches.
   * Heading 0° = +Y, increases clockwise.
   */
  function getRobotCorners(x, y, thetaDeg, extraBuffer = 0) {
    const hl = (bot.robotL || 14.0) / 2 + extraBuffer;
    const hw = (bot.robotW || 14.0) / 2 + extraBuffer;
    const rad = (thetaDeg * Math.PI) / 180;
    const fx = Math.sin(rad), fy = Math.cos(rad);
    const rx = Math.cos(rad), ry = -Math.sin(rad);
    return [
      { x: x + hl * fx + hw * rx, y: y + hl * fy + hw * ry }, // Front-Right
      { x: x + hl * fx - hw * rx, y: y + hl * fy - hw * ry }, // Front-Left
      { x: x - hl * fx - hw * rx, y: y - hl * fy - hw * ry }, // Rear-Left
      { x: x - hl * fx + hw * rx, y: y - hl * fy + hw * ry }, // Rear-Right
    ];
  }

  /**
   * Check collision against field perimeter walls (±70.5")
   */
  function checkWallCollision(x, y, thetaDeg, buffer = 0) {
    if (!collisionConfig.checkWalls) return null;
    const corners = getRobotCorners(x, y, thetaDeg, buffer);
    const half = HALF; // 70.5
    for (const c of corners) {
      if (c.x < -half) {
        return {
          type: "wall",
          id: "wall_west",
          name: "West Perimeter Wall",
          penetration: Math.abs(c.x - (-half)),
          point: { x: c.x, y: c.y }
        };
      }
      if (c.x > half) {
        return {
          type: "wall",
          id: "wall_east",
          name: "East Perimeter Wall",
          penetration: Math.abs(c.x - half),
          point: { x: c.x, y: c.y }
        };
      }
      if (c.y < -half) {
        return {
          type: "wall",
          id: "wall_south",
          name: "South Perimeter Wall",
          penetration: Math.abs(c.y - (-half)),
          point: { x: c.x, y: c.y }
        };
      }
      if (c.y > half) {
        return {
          type: "wall",
          id: "wall_north",
          name: "North Perimeter Wall",
          penetration: Math.abs(c.y - half),
          point: { x: c.x, y: c.y }
        };
      }
    }
    return null;
  }

  /**
   * Separating Axis Theorem (SAT) collision test between robot OBB and an AABB box (e.g. wall match loader).
   */
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

      if (maxA < minB || maxB < minA) {
        return null; // Separating axis exists: no collision
      }

      const overlap = Math.min(maxA - minB, maxB - minA);
      if (overlap < minOverlap) minOverlap = overlap;
    }

    return { hit: true, penetration: minOverlap };
  }

  /**
   * Collision check between a circle obstacle (e.g. Mobile Goal) and Robot OBB.
   */
  function checkCircleVsOBB(circleX, circleY, radius, robotX, robotY, thetaDeg, buffer = 0) {
    const dx = circleX - robotX;
    const dy = circleY - robotY;
    const rad = (thetaDeg * Math.PI) / 180;
    const fx = Math.sin(rad), fy = Math.cos(rad);
    const rx = Math.cos(rad), ry = -Math.sin(rad);

    // Transform circle center to robot local coordinate frame
    const localX = dx * rx + dy * ry;
    const localY = dx * fx + dy * fy;

    const hl = (bot.robotL || 14.0) / 2 + buffer;
    const hw = (bot.robotW || 14.0) / 2 + buffer;

    // Find closest point on box [-hw, hw] x [-hl, hl]
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

  /**
   * Main collision evaluation for robot at arbitrary pose (x, y, theta).
   */
  function checkRobotCollisionAtPose(x, y, thetaDeg, buffer = 0) {
    if (!collisionConfig.enabled) return { hit: false, obstacles: [] };
    const hits = [];

    // 1. Perimeter Walls
    if (collisionConfig.checkWalls) {
      const wallHit = checkWallCollision(x, y, thetaDeg, buffer);
      if (wallHit) hits.push(wallHit);
    }

    // 2. Wall Match Loaders
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

    // 3. Mobile Goals
    if (collisionConfig.checkGoals) {
      for (const goal of FIELD_OBSTACLES.goals) {
        if (collisionConfig.disabledObstacleIds[goal.id]) continue;
        if (collisionConfig.clampedObstacleIds[goal.id]) continue; // Ignore if clamped/carried
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

    // 4. Center Ladder
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

  /**
   * Evaluates collisions along the entire planned routine trajectory.
   * Returns a detailed collision report.
   */
  function evaluateRoutineCollisions() {
    if (!collisionConfig.enabled) {
      cachedRoutineCollisionReport = { totalCollisions: 0, collisions: [], collidingObstacleIds: new Set() };
      actionCollisionsCache.clear();
      return cachedRoutineCollisionReport;
    }

    const collisions = [];
    const collidingObstacleIds = new Set();
    actionCollisionsCache.clear();
    const buf = collisionConfig.safetyBuffer || 0;

    // Check start pose
    const startCol = checkRobotCollisionAtPose(pose.x, pose.y, pose.theta, buf);
    if (startCol.hit) {
      for (const obs of startCol.obstacles) {
        collidingObstacleIds.add(obs.id);
        collisions.push({
          stepIdx: 0,
          actionId: "start",
          actionType: "Start Pose",
          t: 0,
          point: { x: pose.x, y: pose.y, theta: pose.theta, t: 0 },
          obstacle: obs,
          penetration: obs.penetration || 0.5
        });
      }
    }

    // Check each simSegment and actions
    for (let si = 0; si < simSegments.length; si++) {
      const seg = simSegments[si];
      const act = seg.action;
      if (!act) continue;

      let actFirstHit = null;

      // Check trajectory sample points
      const pts = seg.points || [];
      const stepInterval = Math.max(1, Math.floor(pts.length / 25)); // Sample ~25 points per segment for speed

      for (let pi = 0; pi < pts.length; pi += stepInterval) {
        const pt = pts[pi];
        const res = checkRobotCollisionAtPose(pt.x, pt.y, pt.theta, buf);
        if (res.hit) {
          for (const obs of res.obstacles) {
            collidingObstacleIds.add(obs.id);
            const entry = {
              stepIdx: si + 1,
              actionId: act.id,
              actionType: act.type,
              t: pt.t || 0,
              point: { ...pt },
              obstacle: obs,
              penetration: obs.penetration || 0.5
            };
            collisions.push(entry);
            if (!actFirstHit) actFirstHit = entry;
          }
          break; // Record first collision point along segment to avoid duplicate clutter
        }
      }

      // Check end pose of segment
      if (!actFirstHit && seg.endPose) {
        const endRes = checkRobotCollisionAtPose(seg.endPose.x, seg.endPose.y, seg.endPose.theta, buf);
        if (endRes.hit) {
          for (const obs of endRes.obstacles) {
            collidingObstacleIds.add(obs.id);
            const entry = {
              stepIdx: si + 1,
              actionId: act.id,
              actionType: act.type,
              t: seg.duration || 0,
              point: { ...seg.endPose, t: seg.duration || 0 },
              obstacle: obs,
              penetration: obs.penetration || 0.5
            };
            collisions.push(entry);
            if (!actFirstHit) actFirstHit = entry;
          }
        }
      }

      if (actFirstHit) {
        actionCollisionsCache.set(act.id, actFirstHit);
      }
    }

    cachedRoutineCollisionReport = {
      totalCollisions: collisions.length,
      collisions,
      collidingObstacleIds
    };

    return cachedRoutineCollisionReport;
  }

  function getActionCollision(actionId) {
    return actionCollisionsCache.get(actionId) || null;
  }

  // -- LemLib Movement Math & Differential-Drive Physics ----------------

  /**
   * Theoretical max wheel linear speed in inches/second:
   * vMax = (pi * wheelDiam * driveRpm) / 60 * efficiency (approx 0.95)
   */
  function getMaxLinearSpeed(customBot) {
    const b = customBot || bot;
    const theoretical = (Math.max(b.wheelDiam || 3.25, 0.5) * Math.PI * Math.max(b.driveRpm || 600, 1)) / 60;
    return theoretical * 0.95;
  }

  /**
   * Maximum turn rate in degrees/sec for differential drivetrain with trackWidth:
   * maxOmegaDeg = (2 * vMax / trackWidth) * (180 / Math.PI)
   */
  function getMaxTurnRateDps(customBot) {
    const b = customBot || bot;
    const vMax = getMaxLinearSpeed(b);
    const w = Math.max(b.trackWidth || 12, 1);
    return (2 * vMax / w) * (180 / Math.PI);
  }

  /**
   * LemLib motor desaturation algorithm (matching src/lemlib/util.cpp: desaturate)
   * Prioritizes angular steering over lateral driving when total power saturates.
   */
  function lemlibDesaturate(lateral, angular, maxSpeed = 1.0) {
    let left = lateral + angular;
    let right = lateral - angular;
    const maxVal = Math.max(Math.abs(left), Math.abs(right));
    if (maxVal > maxSpeed) {
      left = (left / maxVal) * maxSpeed;
      right = (right / maxVal) * maxSpeed;
    }
    return { left, right };
  }

  /**
   * LemLib rate limiter (matching src/lemlib/util.cpp: slew)
   */
  function lemlibSlew(target, current, maxRate, dt) {
    if (maxRate <= 0) return target;
    const step = Math.abs(maxRate * dt);
    const diff = target - current;
    if (Math.abs(diff) > step) {
      return current + step * Math.sign(diff);
    }
    return target;
  }

  /**
   * Real-Time Robot Drive Dynamics & Kinematic Limit Calculations
   */
  function getRobotPhysicsProps(customBot) {
    const b = customBot || bot;
    const motorCount = Number(b.motorCount) || 6;
    const weightLbs = Math.max(Number(b.robotWeightLbs) || 15.0, 1.0);
    const tractionMu = Math.max(Number(b.wheelTraction) || 0.85, 0.1);
    const battVolts = Number(b.batteryVolts) || 12.8;
    const rpm = Math.max(Number(b.driveRpm) || 600, 1);
    const wheelDiam = Math.max(Number(b.wheelDiam) || 3.25, 0.5);
    const trackWidth = Math.max(Number(b.trackWidth) || 12.0, 1.0);
    const robotW = Math.max(Number(b.robotW) || 14.0, 1.0);
    const robotL = Math.max(Number(b.robotL) || 14.0, 1.0);

    const gInSec2 = 386.09; // 1g in in/s^2
    const massSlugs = weightLbs / gInSec2;

    // V5 11W motor stall torque (in-lbs): ~210 / rpm
    const singleMotorStallTorque = 210 / rpm;
    const totalDriveStallTorque = motorCount * singleMotorStallTorque;
    const wheelRadius = wheelDiam / 2;
    const maxDriveForceLbf = totalDriveStallTorque / wheelRadius;

    // Dynamic acceleration limits
    const maxMotorAccelInSec2 = (maxDriveForceLbf / massSlugs); // F = m*a => a = F/m
    const maxTractionAccelInSec2 = tractionMu * gInSec2;
    const maxLinearAccelInSec2 = Math.min(maxMotorAccelInSec2, maxTractionAccelInSec2);
    const maxLinearAccelG = maxLinearAccelInSec2 / gInSec2;

    // Rotational moment of inertia (uniform rectangular chassis): J = (1/12)*m*(w^2 + l^2)
    const inertiaJ = (1 / 12) * massSlugs * (robotW * robotW + robotL * robotL);
    const turnTorque = maxDriveForceLbf * (trackWidth / 2);
    const maxAngularAccelDegSec2 = (turnTorque / inertiaJ) * (180 / Math.PI);

    const vMaxInSec = getMaxLinearSpeed(b);
    const vMaxMph = (vMaxInSec * 3600) / 63360;

    return {
      motorCount,
      weightLbs,
      tractionMu,
      battVolts,
      rpm,
      wheelDiam,
      trackWidth,
      massSlugs,
      maxDriveForceLbf,
      maxTractionAccelInSec2,
      maxLinearAccelInSec2,
      maxLinearAccelG,
      inertiaJ,
      maxAngularAccelDegSec2,
      vMaxInSec,
      vMaxMph,
    };
  }

  /**
   * Calculate live discrete step physics (acceleration, lateral G, wheel slip, battery sag)
   */
  function calculateStepPhysics(prevVLin, newVLin, newOmegaDeg, dt, phys, b) {
    const aLin = (newVLin - prevVLin) / Math.max(dt, 0.001);
    const gLin = aLin / 386.09;
    const omegaRad = (newOmegaDeg * Math.PI) / 180;
    const aLateral = Math.abs(newVLin * omegaRad);
    const gLateral = aLateral / 386.09;
    const gTotal = Math.hypot(gLin, gLateral);
    const isSlipping = gTotal > (phys.tractionMu + 0.05);
    const gripMargin = Math.max(0, Math.min(100, Math.round((1 - (gTotal / phys.tractionMu)) * 100)));

    // Motor load & battery voltage sag
    const speedRatio = Math.abs(newVLin) / Math.max(phys.vMaxInSec, 1);
    const turnRatio = Math.abs(newOmegaDeg) / Math.max(getMaxTurnRateDps(b), 1);
    const accelRatio = Math.abs(aLin) / Math.max(phys.maxLinearAccelInSec2, 1);
    const motorEffort = Math.min(1.0, 0.15 * speedRatio + 0.15 * turnRatio + 0.70 * accelRatio);
    const currentPerMotor = 0.25 + 2.25 * motorEffort; // Up to 2.5A peak
    const totalCurrent = phys.motorCount * currentPerMotor;
    const internalR = 0.08; // 80 milliohm pack impedance
    const voltSag = totalCurrent * internalR;
    const actualVoltage = Math.max(9.0, phys.battVolts - voltSag);
    const totalWatts = actualVoltage * totalCurrent;

    return {
      aLin,
      gLin,
      gLateral,
      gTotal,
      isSlipping,
      gripMargin,
      voltage: actualVoltage,
      current: totalCurrent,
      watts: totalWatts,
    };
  }

  /**
   * LemLib discrete PID controller (matching src/lemlib/PID.cpp)
   */
  class LemLibPID {
    constructor(kP, kI, kD, windup = 0, slew = 0) {
      this.kP = kP || 0;
      this.kI = kI || 0;
      this.kD = kD || 0;
      this.windup = windup || 0;
      this.slew = slew || 0;
      this.prevError = 0;
      this.totalError = 0;
      this.prevOutput = 0;
      this.initialized = false;
    }

    reset() {
      this.prevError = 0;
      this.totalError = 0;
      this.prevOutput = 0;
      this.initialized = false;
    }

    update(error, dt = 0.01) {
      if (!this.initialized) {
        this.prevError = error;
        this.initialized = true;
      }
      // Anti-windup
      if (this.windup > 0) {
        if (Math.abs(error) < this.windup) {
          this.totalError += error;
        } else {
          this.totalError = 0;
        }
      } else {
        this.totalError += error;
      }
      // Reset integral on sign change
      if ((error > 0 && this.prevError < 0) || (error < 0 && this.prevError > 0)) {
        this.totalError = 0;
      }

      // Authentic LemLib PID (src/lemlib/pid.cpp): derivative is raw error difference per 10ms cycle
      const deriv = error - this.prevError;
      let output = (this.kP * error) + (this.kI * this.totalError) + (this.kD * deriv);

      // Slew rate limiting
      if (this.slew > 0) {
        output = lemlibSlew(output, this.prevOutput, this.slew, dt);
      }
      this.prevOutput = output;
      this.prevError = error;
      return output;
    }
  }

  /** Apply a swing about locked side: returns new {x,y,theta} after turning dth degrees (CW+) */
  function applySwing(x, y, theta, endTheta, lockedSide, customTrackWidth) {
    const dth = angleError(theta, endTheta);
    if (Math.abs(dth) < 1e-6) return { x, y, theta: endTheta };
    const trackWidth = customTrackWidth || (bot.trackWidth || 12);
    const h = trackWidth / 2;
    const lockLeft = (lockedSide || "LEFT") === "LEFT";
    const rad0 = (theta * Math.PI) / 180;
    const pivotX = lockLeft ? x - h * Math.cos(rad0) : x + h * Math.cos(rad0);
    const pivotY = lockLeft ? y + h * Math.sin(rad0) : y - h * Math.sin(rad0);
    const endRad = (endTheta * Math.PI) / 180;
    const endX = lockLeft ? pivotX + h * Math.cos(endRad) : pivotX - h * Math.cos(endRad);
    const endY = lockLeft ? pivotY - h * Math.sin(endRad) : pivotY + h * Math.sin(endRad);
    return { x: endX, y: endY, theta: endTheta };
  }

  /**
   * Evaluates or derives Cubic Bezier control points and heading vectors.
   * Auto-computes departure and arrival curvature handles along the robot's
   * tangent headings when custom control points are not specified.
   */
  function getBezierControlPoints(action, fromPose) {
    const p0 = { x: fromPose.x, y: fromPose.y };
    const p3 = { x: action.x, y: action.y };
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const defaultLead = Math.max(8, Math.min(36, dist * 0.45));
    const lead1 = action.lead1 != null && !isNaN(Number(action.lead1)) ? Number(action.lead1) : defaultLead;
    const lead2 = action.lead2 != null && !isNaN(Number(action.lead2)) ? Number(action.lead2) : defaultLead;

    const rad0 = (fromPose.theta * Math.PI) / 180;
    const dir0 = action.forwards === false ? -1 : 1;
    const cp1 = {
      x: action.cp1X != null && !isNaN(Number(action.cp1X)) ? Number(action.cp1X) : (p0.x + Math.sin(rad0) * lead1 * dir0),
      y: action.cp1Y != null && !isNaN(Number(action.cp1Y)) ? Number(action.cp1Y) : (p0.y + Math.cos(rad0) * lead1 * dir0),
    };

    const targetHeading = action.theta != null && !isNaN(Number(action.theta)) ? Number(action.theta) : fromPose.theta;
    const rad1 = (targetHeading * Math.PI) / 180;
    const cp2 = {
      x: action.cp2X != null && !isNaN(Number(action.cp2X)) ? Number(action.cp2X) : (p3.x - Math.sin(rad1) * lead2 * dir0),
      y: action.cp2Y != null && !isNaN(Number(action.cp2Y)) ? Number(action.cp2Y) : (p3.y - Math.cos(rad1) * lead2 * dir0),
    };

    return { cp1, cp2, lead1, lead2, targetHeading };
  }

  /**
   * Evaluates position, first derivative, second derivative, curvature, and tangent angle
   * for a cubic Bezier curve at parameter u in [0, 1].
   */
  function evalCubicBezier(p0, cp1, cp2, p3, u, forwards = true) {
    const inv = 1 - u;
    const inv2 = inv * inv;
    const inv3 = inv2 * inv;
    const u2 = u * u;
    const u3 = u2 * u;

    const x = inv3 * p0.x + 3 * inv2 * u * cp1.x + 3 * inv * u2 * cp2.x + u3 * p3.x;
    const y = inv3 * p0.y + 3 * inv2 * u * cp1.y + 3 * inv * u2 * cp2.y + u3 * p3.y;

    const dx = 3 * inv2 * (cp1.x - p0.x) + 6 * inv * u * (cp2.x - cp1.x) + 3 * u2 * (p3.x - cp2.x);
    const dy = 3 * inv2 * (cp1.y - p0.y) + 6 * inv * u * (cp2.y - cp1.y) + 3 * u2 * (p3.y - cp2.y);

    const d2x = 6 * inv * (cp2.x - 2 * cp1.x + p0.x) + 6 * u * (p3.x - 2 * cp2.x + cp1.x);
    const d2y = 6 * inv * (cp2.y - 2 * cp1.y + p0.y) + 6 * u * (p3.y - 2 * cp2.y + cp1.y);

    const speed = Math.hypot(dx, dy);
    const curvature = speed > 1e-4 ? (dx * d2y - dy * d2x) / Math.pow(speed, 3) : 0;
    let thetaDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
    if (!forwards) thetaDeg = (thetaDeg + 180) % 360;

    return { u, x, y, dx, dy, speed, curvature, thetaDeg };
  }

  /**
   * Computes arc length, minimum turning radius, maximum curvature, and control handles
   * for a Bezier spline action.
   */
  function computeBezierMetrics(action, fromPose) {
    const p0 = { x: fromPose.x, y: fromPose.y };
    const p3 = { x: action.x, y: action.y };
    const { cp1, cp2 } = getBezierControlPoints(action, fromPose);
    const SAMPLES = 100;
    let prevX = p0.x, prevY = p0.y;
    let arcLength = 0;
    let maxCurvature = 0;

    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      const pt = evalCubicBezier(p0, cp1, cp2, p3, u, action.forwards !== false);
      if (i > 0) {
        arcLength += Math.hypot(pt.x - prevX, pt.y - prevY);
      }
      if (Math.abs(pt.curvature) > maxCurvature) {
        maxCurvature = Math.abs(pt.curvature);
      }
      prevX = pt.x;
      prevY = pt.y;
    }

    const minRadius = maxCurvature > 1e-4 ? (1 / maxCurvature) : 999.0;
    return { arcLength, maxCurvature, minRadius, cp1, cp2 };
  }

  /**
   * Simulates a single action using authentic LemLib motion control math
   * and differential-drive kinematics with a 10ms discrete integration loop.
   *
   * Returns: { endPose, path: [{x, y, theta, t, vLin, omegaDeg}], duration, carrot: {x, y} }
   */
  function simulateAction(action, fromPose, customBot) {
    const b = customBot || bot;
    const vMax = getMaxLinearSpeed(b);
    const trackWidth = Math.max(b.trackWidth || 12, 1);
    const dt = 0.01; // 10ms LemLib loop period
    const tau = 0.07; // motor response time constant (70ms)

    const defMax = b.defaultMaxSpeed != null ? b.defaultMaxSpeed : 127;
    const defMin = b.defaultMinSpeed != null ? b.defaultMinSpeed : 0;
    const maxSpeed = clamp((action.maxSpeed != null ? action.maxSpeed : defMax) / 127, 0.1, 1.0);
    const minSpeed = clamp((action.minSpeed != null ? action.minSpeed : defMin) / 127, 0, 1.0);
    const timeoutS = Math.max(0.1, (action.timeout || 2000) / 1000);
    const earlyExitRange = Math.max(0, action.earlyExitRange || 0);

    // Lateral & Angular Controller Settings
    const latKp = b.lateralKp != null ? b.lateralKp : 8.0;
    const latKi = b.lateralKi != null ? b.lateralKi : 0.0;
    const latKd = b.lateralKd != null ? b.lateralKd : 30.0;
    const latWindup = b.lateralWindup != null ? b.lateralWindup : 3.0;
    const latSlew = b.lateralSlew != null ? b.lateralSlew : 0;
    const latSmallErr = b.lateralSmallErr != null ? b.lateralSmallErr : 1.0;
    const latSmallTime = (b.lateralSmallTime != null ? b.lateralSmallTime : 100) / 1000;
    const latLargeErr = b.lateralLargeErr != null ? b.lateralLargeErr : 3.0;
    const latLargeTime = (b.lateralLargeTime != null ? b.lateralLargeTime : 500) / 1000;

    const angKp = b.angularKp != null ? b.angularKp : 2.0;
    const angKi = b.angularKi != null ? b.angularKi : 0.0;
    const angKd = b.angularKd != null ? b.angularKd : 10.0;
    const angWindup = b.angularWindup != null ? b.angularWindup : 3.0;
    const angSlew = b.angularSlew != null ? b.angularSlew : 0;
    const angSmallErr = b.angularSmallErr != null ? b.angularSmallErr : 1.0;
    const angSmallTime = (b.angularSmallTime != null ? b.angularSmallTime : 100) / 1000;
    const angLargeErr = b.angularLargeErr != null ? b.angularLargeErr : 3.0;
    const angLargeTime = (b.angularLargeTime != null ? b.angularLargeTime : 500) / 1000;

    const latPid = new LemLibPID(latKp, latKi, latKd, latWindup, latSlew);
    const angPid = new LemLibPID(angKp, angKi, angKd, angWindup, angSlew);

    const phys = getRobotPhysicsProps(b);
    const maxStepV = phys.maxLinearAccelInSec2 * dt;
    const maxStepW = phys.maxAngularAccelDegSec2 * dt;

    let pose = { x: fromPose.x, y: fromPose.y, theta: fromPose.theta };
    let vLin = 0;
    let omegaDeg = 0;
    let t = 0;
    const initPhys = calculateStepPhysics(0, 0, 0, dt, phys, b);
    let points = [{ x: pose.x, y: pose.y, theta: pose.theta, t: 0, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys }];
    let carrotPoint = null;

    if (action.type === "custom") {
      const dur = action.customDuration != null ? Math.max(0, Number(action.customDuration)) : 0;
      if (dur > 0) {
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys });
      }
      return { endPose: pose, path: points, duration: dur, carrot: null };
    }

    if (action.type === "wait") {
      const isTime = action.waitType === "time";
      const dur = isTime ? Math.max(0, (action.delayMs != null ? action.delayMs : 250) / 1000) : 0;
      if (dur > 0) {
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys });
      }
      return { endPose: pose, path: points, duration: dur, carrot: null };
    }

    if (action.type === "ifElse") {
      let isElse = action.activeSimBranch === "else";
      if (action.activeSimBranch !== "else" && action.activeSimBranch !== "then") {
        const evalRes = evaluateConditionExpression(action.condition || "true");
        isElse = !evalRes;
      }
      const branchChildren = isElse ? action.elseChildren : action.thenChildren;
      if (Array.isArray(branchChildren) && branchChildren.length > 0) {
        let curPose = { ...fromPose };
        let combinedPath = [];
        let totalDuration = 0;
        let lastCarrot = null;
        for (const child of branchChildren) {
          const childSeg = simulateAction(child, curPose, customBot);
          if (childSeg && childSeg.path) {
            for (const pt of childSeg.path) {
              combinedPath.push({ ...pt, t: pt.t + totalDuration });
            }
            curPose = { ...childSeg.endPose };
            totalDuration += (childSeg.duration || 0);
            lastCarrot = childSeg.carrot || lastCarrot;
          }
        }
        return {
          path: combinedPath.length ? combinedPath : [{ ...fromPose, t: 0, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0 }],
          endPose: curPose,
          duration: totalDuration,
          carrot: lastCarrot,
        };
      }

      let branchAct = isElse ? action.elseAction : action.thenAction;
      if (!branchAct) {
        const code = isElse ? action.elseCode : action.thenCode;
        if (window.CppTranslator && typeof window.CppTranslator.parseStatementToAction === "function") {
          branchAct = window.CppTranslator.parseStatementToAction(code, b.defaultMaxSpeed || 127, b.defaultMinSpeed || 0);
        }
      }
      if (!branchAct) {
        branchAct = {
          type: "moveToPoint",
          x: isElse ? (fromPose.x - 24) : (fromPose.x + 24),
          y: isElse ? (fromPose.y - 24) : (fromPose.y + 24),
          timeout: 2000,
          forwards: !isElse,
        };
      }
      return simulateAction({ ...branchAct, id: action.id }, fromPose, customBot);
    }

    if (action.type === "loop") {
      if (Array.isArray(action.children) && action.children.length > 0) {
        let curPose = { ...fromPose };
        let combinedPath = [];
        let totalDuration = 0;
        let lastCarrot = null;
        for (const child of action.children) {
          const childSeg = simulateAction(child, curPose, customBot);
          if (childSeg && childSeg.path) {
            for (const pt of childSeg.path) {
              combinedPath.push({ ...pt, t: pt.t + totalDuration });
            }
            curPose = { ...childSeg.endPose };
            totalDuration += (childSeg.duration || 0);
            lastCarrot = childSeg.carrot || lastCarrot;
          }
        }
        return {
          path: combinedPath.length ? combinedPath : [{ ...fromPose, t: 0, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0 }],
          endPose: curPose,
          duration: totalDuration,
          carrot: lastCarrot,
        };
      }
      let branchAct = action.loopAction;
      if (!branchAct) {
        const code = action.loopCode;
        if (window.CppTranslator && typeof window.CppTranslator.parseStatementToAction === "function") {
          branchAct = window.CppTranslator.parseStatementToAction(code, b.defaultMaxSpeed || 127, b.defaultMinSpeed || 0);
        }
      }
      if (!branchAct) {
        branchAct = {
          type: "moveToPoint",
          x: fromPose.x + 24,
          y: fromPose.y + 24,
          timeout: 2000,
          forwards: true,
        };
      }
      return simulateAction({ ...branchAct, id: action.id }, fromPose, customBot);
    }

    if (action.type === "moveToPose") {
      const lead = action.lead != null ? clamp(action.lead, 0, 1.0) : (b.defaultLead != null ? b.defaultLead : 0.6);
      const drift = (action.driftScaler != null ? action.driftScaler : (b.lateralDrift != null ? b.lateralDrift : 1.0));
      const reversed = action.forwards === false;
      const target = { x: action.x, y: action.y, theta: action.theta };
      // When reversed, chassis rear approaches target along target.theta
      const approachTheta = reversed ? normalizeAngle(target.theta + 180) : target.theta;
      const approachRad = (approachTheta * Math.PI) / 180;
      let close = false;
      let settleSmallTimer = 0;
      let settleLargeTimer = 0;
      let isSettled = false;

      while (t < timeoutS) {
        const dist = Math.hypot(target.x - pose.x, target.y - pose.y);
        if (dist < 7.5 && !close) close = true;

        let carrot;
        if (close) {
          carrot = { x: target.x, y: target.y };
        } else {
          const leadDist = lead * dist;
          carrot = {
            x: target.x - Math.sin(approachRad) * leadDist,
            y: target.y - Math.cos(approachRad) * leadDist,
          };
        }
        if (!carrotPoint) carrotPoint = { ...carrot };

        const carrotAngle = angleToPoint(pose.x, pose.y, carrot.x, carrot.y);
        const desiredHeading = close ? target.theta : (reversed ? normalizeAngle(carrotAngle + 180) : carrotAngle);
        const angError = angleError(pose.theta, desiredHeading);

        // LemLib settling timers
        if (dist < latSmallErr && Math.abs(angError) < angSmallErr) {
          settleSmallTimer += dt;
        } else {
          settleSmallTimer = 0;
        }
        if (dist < latLargeErr && Math.abs(angError) < angLargeErr) {
          settleLargeTimer += dt;
        } else {
          settleLargeTimer = 0;
        }

        if (settleSmallTimer >= latSmallTime || settleLargeTimer >= latLargeTime || (earlyExitRange > 0 && dist < earlyExitRange)) {
          isSettled = true;
          break;
        }

        const alignCos = Math.cos((angError * Math.PI) / 180);
        const rawLatPid = latPid.update(dist, dt);
        let latPower = clamp(rawLatPid / 127, -maxSpeed, maxSpeed);
        if (close) {
          latPower *= Math.max(0, alignCos);
        } else {
          // Slow down linearly if heading is misaligned with carrot
          latPower *= Math.max(0.15, alignCos);
        }
        if (Math.abs(latPower) < minSpeed) latPower = Math.sign(latPower) * minSpeed;
        if (reversed) latPower = -latPower;

        const rawAngPid = angPid.update(angError, dt);
        let angPower = clamp((rawAngPid / 127) * Math.max(0.2, drift), -maxSpeed, maxSpeed);

        // Desaturation / overturn prioritization
        const desat = lemlibDesaturate(latPower, angPower, maxSpeed);
        const targetVLin = ((desat.left + desat.right) / 2) * vMax;
        const targetOmega = (((desat.left - desat.right) * vMax) / trackWidth) * (180 / Math.PI);

        const prevVLin = vLin;
        const dV = clamp(((targetVLin - vLin) / tau) * dt, -maxStepV, maxStepV);
        vLin += dV;

        const dW = clamp(((targetOmega - omegaDeg) / tau) * dt, -maxStepW, maxStepW);
        omegaDeg += dW;

        // Smooth physical settling decay to prevent high-frequency numeric PID shaking
        if (dist < 1.0) {
          vLin *= 0.75;
        }
        if (Math.abs(angError) < 1.5) {
          omegaDeg *= 0.75;
        }

        const midTheta = normalizeAngle(pose.theta + (omegaDeg * dt) / 2);
        const rad = (midTheta * Math.PI) / 180;
        pose.x += Math.sin(rad) * vLin * dt;
        pose.y += Math.cos(rad) * vLin * dt;
        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);

        t += dt;
        const stepPhys = calculateStepPhysics(prevVLin, vLin, omegaDeg, dt, phys, b);
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin, omegaDeg, targetVLin, targetOmega, ...stepPhys });
      }

      if (isSettled) {
        if (points.length) {
          const finalPhys = calculateStepPhysics(0, 0, 0, dt, phys, b);
          points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...finalPhys };
        }
      }
      return { endPose: pose, path: points, duration: Math.max(t, 0.1), carrot: carrotPoint };
    }

    if (action.type === "moveToPoint") {
      const drift = (action.driftScaler != null ? action.driftScaler : (b.lateralDrift != null ? b.lateralDrift : 1.0));
      const reversed = action.forwards === false;
      const target = { x: action.x, y: action.y };
      let close = false;
      let settleSmallTimer = 0;
      let settleLargeTimer = 0;
      let isSettled = false;

      while (t < timeoutS) {
        const dist = Math.hypot(target.x - pose.x, target.y - pose.y);
        if (dist < 7.5 && !close) close = true;

        const targetAngle = angleToPoint(pose.x, pose.y, target.x, target.y);
        const desiredHeading = reversed ? normalizeAngle(targetAngle + 180) : targetAngle;
        const angError = angleError(pose.theta, desiredHeading);

        if (dist < latSmallErr) settleSmallTimer += dt;
        else settleSmallTimer = 0;
        if (dist < latLargeErr) settleLargeTimer += dt;
        else settleLargeTimer = 0;

        if (settleSmallTimer >= latSmallTime || settleLargeTimer >= latLargeTime || dist < 0.65 + earlyExitRange) {
          isSettled = true;
          break;
        }

        const alignCos = Math.cos((angError * Math.PI) / 180);
        const rawLatPid = latPid.update(dist, dt);
        let latPower = clamp(rawLatPid / 127, -maxSpeed, maxSpeed);
        if (close) {
          latPower *= Math.max(0, alignCos);
        } else {
          latPower *= Math.max(0.18, alignCos);
        }
        if (Math.abs(latPower) < minSpeed) latPower = Math.sign(latPower) * minSpeed;
        if (reversed) latPower = -latPower;

        // LemLib turns off angular steering when settling within 7.5 in
        const rawAngPid = angPid.update(angError, dt);
        const angPower = close ? 0 : clamp((rawAngPid / 127) * Math.max(0.2, drift), -maxSpeed, maxSpeed);

        const desat = lemlibDesaturate(latPower, angPower, maxSpeed);
        const targetVLin = ((desat.left + desat.right) / 2) * vMax;
        const targetOmega = (((desat.left - desat.right) * vMax) / trackWidth) * (180 / Math.PI);

        const prevVLin = vLin;
        const dV = clamp(((targetVLin - vLin) / tau) * dt, -maxStepV, maxStepV);
        vLin += dV;

        const dW = clamp(((targetOmega - omegaDeg) / tau) * dt, -maxStepW, maxStepW);
        omegaDeg += dW;

        // Smooth physical settling decay to prevent high-frequency numeric PID shaking
        if (dist < 1.0) {
          vLin *= 0.75;
        }
        if (Math.abs(angError) < 1.5) {
          omegaDeg *= 0.75;
        }

        const midTheta = normalizeAngle(pose.theta + (omegaDeg * dt) / 2);
        const rad = (midTheta * Math.PI) / 180;
        pose.x += Math.sin(rad) * vLin * dt;
        pose.y += Math.cos(rad) * vLin * dt;
        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);

        t += dt;
        const stepPhys = calculateStepPhysics(prevVLin, vLin, omegaDeg, dt, phys, b);
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin, omegaDeg, targetVLin, targetOmega, ...stepPhys });
      }

      if (isSettled) {
        if (points.length) {
          const finalPhys = calculateStepPhysics(0, 0, 0, dt, phys, b);
          points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...finalPhys };
        }
      }
      return { endPose: pose, path: points, duration: Math.max(t, 0.1), carrot: null };
    }

    if (action.type === "bezierCurve") {
      const p0 = { x: fromPose.x, y: fromPose.y };
      const p3 = { x: action.x, y: action.y };
      const { cp1, cp2, targetHeading } = getBezierControlPoints(action, fromPose);
      const reversed = action.forwards === false;

      // Sample curve densely into an arc-length parameterized lookup table
      const SAMPLES = 200;
      const table = [];
      let prevX = p0.x, prevY = p0.y;
      let totalLength = 0;

      for (let i = 0; i <= SAMPLES; i++) {
        const u = i / SAMPLES;
        const pt = evalCubicBezier(p0, cp1, cp2, p3, u, !reversed);
        if (i > 0) totalLength += Math.hypot(pt.x - prevX, pt.y - prevY);
        table.push({ ...pt, s: totalLength });
        prevX = pt.x;
        prevY = pt.y;
      }

      function sampleAtDistance(distAlong) {
        const d = clamp(distAlong, 0, totalLength);
        let low = 0, high = table.length - 1;
        while (low <= high) {
          const mid = (low + high) >> 1;
          if (table[mid].s < d) low = mid + 1;
          else high = mid - 1;
        }
        const idx = clamp(low, 1, table.length - 1);
        const pA = table[idx - 1];
        const pB = table[idx];
        const span = Math.max(1e-4, pB.s - pA.s);
        const frac = clamp((d - pA.s) / span, 0, 1);
        return {
          x: pA.x + (pB.x - pA.x) * frac,
          y: pA.y + (pB.y - pA.y) * frac,
          thetaDeg: normalizeAngle(pA.thetaDeg + angleError(pA.thetaDeg, pB.thetaDeg) * frac),
          curvature: pA.curvature + (pB.curvature - pA.curvature) * frac,
        };
      }

      const mu = Math.max(0.1, Number(b.wheelTraction) || 0.85);
      const g = 386.09;
      const maxDecel = phys.maxLinearAccelInSec2;
      const maxAccel = phys.maxLinearAccelInSec2;

      let sDist = 0;
      let vLin = 0;
      let omegaDeg = 0;
      let isSettled = false;

      while (t < timeoutS) {
        const remaining = Math.max(0, totalLength - sDist);
        if (remaining <= (0.5 + earlyExitRange) && t > 0.05) {
          isSettled = true;
          break;
        }

        const curSample = sampleAtDistance(sDist);
        const kappa = curSample.curvature;
        const absKappa = Math.abs(kappa);

        // Curvature speed limit based on wheel traction & differential drive geometry
        const vGrip = Math.sqrt((mu * g) / Math.max(absKappa, 0.001));
        const vDiff = vMax / (1 + (absKappa * trackWidth) / 2);
        const vMaxAllowed = Math.min(vMax * maxSpeed, vGrip, vDiff);

        // Smooth deceleration profiling into target
        const vBrake = Math.sqrt(2 * maxDecel * Math.max(0, remaining));
        let vTarget = Math.min(vMaxAllowed, vBrake);
        if (vTarget < minSpeed * vMax && remaining > 1.5) {
          vTarget = minSpeed * vMax;
        }

        const prevVLin = vLin;
        const dV = clamp(vTarget - vLin, -maxDecel * dt, maxAccel * dt);
        vLin += dV;

        // Kinematic angular velocity from curve curvature & linear speed
        const targetOmega = (vLin * kappa * (180 / Math.PI));
        const dW = clamp(((targetOmega - omegaDeg) / tau) * dt, -maxStepW, maxStepW);
        omegaDeg += dW;

        sDist += Math.max(0.1, vLin) * dt;
        t += dt;

        pose.x = curSample.x;
        pose.y = curSample.y;
        pose.theta = curSample.thetaDeg;

        const stepPhys = calculateStepPhysics(prevVLin, vLin, omegaDeg, dt, phys, b);
        points.push({
          x: pose.x,
          y: pose.y,
          theta: pose.theta,
          t,
          vLin: reversed ? -vLin : vLin,
          omegaDeg,
          targetVLin: vTarget,
          targetOmega,
          curvature: kappa,
          ...stepPhys,
        });
      }

      pose.x = p3.x;
      pose.y = p3.y;
      pose.theta = targetHeading;

      if (isSettled && points.length) {
        const finalPhys = calculateStepPhysics(0, 0, 0, dt, phys, b);
        points[points.length - 1] = {
          x: pose.x,
          y: pose.y,
          theta: pose.theta,
          t,
          vLin: 0,
          omegaDeg: 0,
          targetVLin: 0,
          targetOmega: 0,
          ...finalPhys,
        };
      }

      return {
        endPose: pose,
        path: points,
        duration: Math.max(t, 0.1),
        carrot: { x: cp2.x, y: cp2.y },
        bezierCPs: { cp1, cp2 },
      };
    }

    if (action.type === "turnToHeading" || action.type === "turnToPoint") {
      let targetHeading = pose.theta;
      if (action.type === "turnToHeading") {
        targetHeading = action.theta;
      } else {
        targetHeading = angleToPoint(pose.x, pose.y, action.x, action.y);
        if (action.forwards === false) targetHeading = normalizeAngle(targetHeading + 180);
      }

      const maxOmega = getMaxTurnRateDps(b);
      let settleSmallTimer = 0;
      let settleLargeTimer = 0;
      let isSettled = false;

      while (t < timeoutS) {
        const angError = angleError(pose.theta, targetHeading);
        if (Math.abs(angError) < angSmallErr) settleSmallTimer += dt;
        else settleSmallTimer = 0;
        if (Math.abs(angError) < angLargeErr) settleLargeTimer += dt;
        else settleLargeTimer = 0;

        if (settleSmallTimer >= angSmallTime || settleLargeTimer >= angLargeTime || Math.abs(angError) < 1.0 + earlyExitRange) {
          isSettled = true;
          break;
        }

        const rawAngPid = angPid.update(angError, dt);
        let angPower = clamp(rawAngPid / 127, -maxSpeed, maxSpeed);
        if (Math.abs(angPower) < minSpeed) angPower = Math.sign(angPower) * minSpeed;

        const targetOmega = angPower * maxOmega;
        const dW = clamp(((targetOmega - omegaDeg) / tau) * dt, -maxStepW, maxStepW);
        omegaDeg += dW;

        // Smooth physical settling decay to prevent high-frequency numeric PID shaking
        if (Math.abs(angError) < 1.0) {
          omegaDeg *= 0.75;
        }

        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);
        t += dt;
        const stepPhys = calculateStepPhysics(0, 0, omegaDeg, dt, phys, b);
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg, targetVLin: 0, targetOmega, ...stepPhys });
      }

      if (isSettled) {
        if (points.length) {
          const finalPhys = calculateStepPhysics(0, 0, 0, dt, phys, b);
          points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...finalPhys };
        }
      }
      return { endPose: pose, path: points, duration: Math.max(t, 0.08), carrot: null };
    }

    if (action.type === "swingToHeading" || action.type === "swingToPoint") {
      const lockLeft = (action.lockedSide || "LEFT") === "LEFT";
      const h = trackWidth / 2;
      const rad0 = (fromPose.theta * Math.PI) / 180;
      const pivotX = lockLeft ? fromPose.x - h * Math.cos(rad0) : fromPose.x + h * Math.cos(rad0);
      const pivotY = lockLeft ? fromPose.y + h * Math.sin(rad0) : fromPose.y - h * Math.sin(rad0);

      function getCenter(th) {
        const rad = (th * Math.PI) / 180;
        const cx = lockLeft ? pivotX + h * Math.cos(rad) : pivotX - h * Math.cos(rad);
        const cy = lockLeft ? pivotY - h * Math.sin(rad) : pivotY + h * Math.sin(rad);
        return { x: cx, y: cy };
      }

      let vDrive = 0;
      let settleSmallTimer = 0;
      let settleLargeTimer = 0;
      let isSettled = false;

      while (t < timeoutS) {
        let targetHeading = pose.theta;
        if (action.type === "swingToHeading") {
          targetHeading = action.theta;
        } else {
          targetHeading = angleToPoint(pose.x, pose.y, action.x, action.y);
          if (action.forwards === false) targetHeading = normalizeAngle(targetHeading + 180);
        }

        const angError = angleError(pose.theta, targetHeading);
        if (Math.abs(angError) < angSmallErr) settleSmallTimer += dt;
        else settleSmallTimer = 0;
        if (Math.abs(angError) < angLargeErr) settleLargeTimer += dt;
        else settleLargeTimer = 0;

        if (settleSmallTimer >= angSmallTime || settleLargeTimer >= angLargeTime || (Math.abs(angError) < 0.6 + earlyExitRange && t > 0.04)) {
          isSettled = true;
          break;
        }

        const rawAngPid = angPid.update(angError, dt);
        let pwr = clamp(rawAngPid / 127, -maxSpeed, maxSpeed);
        if (Math.abs(pwr) < minSpeed) pwr = Math.sign(pwr) * minSpeed;

        const prevVDrive = vDrive;
        const targetVDrive = pwr * vMax;
        const dVDrive = clamp(((targetVDrive - vDrive) / tau) * dt, -maxStepV, maxStepV);
        vDrive += dVDrive;

        // Smooth physical settling decay to prevent high-frequency numeric PID shaking
        if (Math.abs(angError) < 1.0) {
          vDrive *= 0.75;
        }

        // Driven wheel turns around stationary locked wheel:
        const wDeg = (vDrive / trackWidth) * (180 / Math.PI);
        pose.theta = normalizeAngle(pose.theta + wDeg * dt);

        const c = getCenter(pose.theta);
        pose.x = c.x;
        pose.y = c.y;

        t += dt;
        const targetW = (targetVDrive / trackWidth) * (180 / Math.PI);
        const vEff = Math.abs(vDrive) / 2;
        const prevVEff = Math.abs(prevVDrive) / 2;
        const stepPhys = calculateStepPhysics(prevVEff, vEff, wDeg, dt, phys, b);
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin: vEff, omegaDeg: wDeg, targetVLin: Math.abs(targetVDrive) / 2, targetOmega: targetW, ...stepPhys });
      }

      if (isSettled) {
        if (points.length) {
          const finalPhys = calculateStepPhysics(0, 0, 0, dt, phys, b);
          points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...finalPhys };
        }
      }

      return { endPose: pose, path: points, duration: Math.max(t, 0.08), carrot: null };
    }

    return { endPose: pose, path: points, duration: 0.1, carrot: null };
  }





  function snapToWall(x, y) {
    const margin = 8;
    const limit = HALF - margin;
    const dL = Math.abs(x + HALF);
    const dR = Math.abs(x - HALF);
    const dB = Math.abs(y + HALF);
    const dT = Math.abs(y - HALF);
    const minD = Math.min(dL, dR, dB, dT);
    if (minD < 14) {
      return { x: clamp(x, -limit, limit), y: clamp(y, -limit, limit) };
    }
    if (minD === dL) return { x: -limit, y: clamp(y, -limit, limit) };
    if (minD === dR) return { x: limit, y: clamp(y, -limit, limit) };
    if (minD === dB) return { x: clamp(x, -limit, limit), y: -limit };
    return { x: clamp(x, -limit, limit), y: limit };
  }

  function needsPoint(t) {
    return ["moveToPoint", "moveToPose", "bezierCurve", "turnToPoint", "swingToPoint"].includes(t);
  }
  function needsHeading(t) {
    return ["moveToPose", "bezierCurve", "turnToHeading", "swingToHeading"].includes(t);
  }
  function needsSide(t) {
    return ["swingToPoint", "swingToHeading"].includes(t);
  }
  function isMove(t) {
    return t === "moveToPoint" || t === "moveToPose" || t === "bezierCurve";
  }
  function isTurn(t) {
    return t === "turnToPoint" || t === "turnToHeading";
  }
  function isSwing(t) {
    return t === "swingToPoint" || t === "swingToHeading";
  }

  // -- History / Undo / Redo -----------------------------------------
  let undoStack = [];
  let redoStack = [];
  let isHistoryApplying = false;
  let historyDragBaseline = null;
  let historyPushTimer = null;

  function cloneState() {
    return JSON.stringify({
      paths: paths.map((p) => ({
        id: p.id,
        name: p.name,
        pose: { ...p.pose },
        actions: p.actions.map((a) => ({ ...a })),
      })),
      activePathId,
      bot: { ...bot },
    });
  }

  function restoreState(snapshotStr) {
    if (!snapshotStr) return;
    isHistoryApplying = true;
    try {
      const data = JSON.parse(snapshotStr);
      if (data.bot) bot = { ...bot, ...data.bot };
      if (Array.isArray(data.paths) && data.paths.length) {
        paths = data.paths.map((p) => ({
          id: p.id || uidPath(),
          name: p.name || "Routine",
          pose: p.pose || { x: -60, y: -60, theta: 0 },
          actions: Array.isArray(p.actions) ? p.actions : [],
        }));
        activePathId = data.activePathId || paths[0].id;
        if (!paths.some((p) => p.id === activePathId)) activePathId = paths[0].id;
      }
      bindActive();
      selectedId = null;
      syncPathSelect();
      syncStartInputs();
      syncBotInputs();
      renderFlow();
      draw();
      generateCode();
      try { updateTimeDisplay(); } catch (_) {}
    } catch (err) {
      console.error("Error restoring history state:", err);
    } finally {
      isHistoryApplying = false;
    }
  }

  function pushHistory(label) {
    if (isHistoryApplying) return;
    const snap = cloneState();
    if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snap) {
      return;
    }
    undoStack.push(snap);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (undoStack.length <= 1) return;
    const current = undoStack.pop();
    redoStack.push(current);
    const prev = undoStack[undoStack.length - 1];
    restoreState(prev);
    saveLocal(true);
  }

  function redo() {
    if (!redoStack.length) return;
    const next = redoStack.pop();
    undoStack.push(next);
    restoreState(next);
    saveLocal(true);
  }

  function scheduleHistoryPush() {
    if (isHistoryApplying) return;
    clearTimeout(historyPushTimer);
    historyPushTimer = setTimeout(() => {
      pushHistory("auto");
    }, 300);
  }

  // -- Persistence --------------------------------------------------
  function markDirty() {
    const ap = activePath();
    if (ap) {
      ap.pose = pose;
      ap.actions = actions;
    }
    isSimPathDirty = true;
    saveStatus.textContent = "Unsaved...";
    saveStatus.className = "save-status dirty";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveLocal(true), 400);
    try { updateTimeDisplay(); } catch (_) {}
    try { generateCode(); } catch (_) {}
    try { scheduleCloudSave(); } catch (_) {}
    try { scheduleHistoryPush(); } catch (_) {}
  }

  function saveLocal(isInteractive = false) {
    // keep active path data in sync
    bindActive();
    const ap = activePath();
    if (ap) {
      ap.pose = pose;
      ap.actions = actions;
    }
    const data = {
      version: 2,
      paths,
      activePathId,
      bot,
      conditions,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem("lemlib_conditions", JSON.stringify(conditions));
      saveStatus.textContent = "Saved";
      saveStatus.className = "save-status ok";
    } catch (e) {
      saveStatus.textContent = "Save failed";
    }

    if (window.ProjectManager && window.ProjectManager.project) {
      const proj = window.ProjectManager.project;
      const isIdeActive = proj.lastAutonEditor === "ide" || proj.rawCppPreserved;
      
      if (isInteractive) {
        // User is actively editing the visual paths - visual editor takes over
        proj.lastAutonEditor = "blocks";
        proj.rawCppPreserved = false;
        syncPlannerIntoProjectManager({ ask: false, force: true });
      } else if (!isIdeActive) {
        // Otherwise, if IDE is not active, sync passively
        syncPlannerIntoProjectManager({ ask: false, force: false });
      } else {
        // IDE is active, do not overwrite autons.cpp passively
        updateProjectBanner();
      }
    } else if (window.ProjectManager) {
      updateProjectBanner();
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.bot) bot = { ...bot, ...data.bot };
      if (Array.isArray(data.conditions) && data.conditions.length) {
        conditions = data.conditions;
      } else {
        const savedConds = localStorage.getItem("lemlib_conditions");
        if (savedConds) {
          try {
            const parsedConds = JSON.parse(savedConds);
            if (Array.isArray(parsedConds) && parsedConds.length) conditions = parsedConds;
          } catch (_) {}
        }
      }
      if (Array.isArray(data.paths) && data.paths.length) {
        paths = data.paths.map((p) => ({
          id: p.id || uidPath(),
          name: p.name || "Routine",
          pose: p.pose || { x: -60, y: -60, theta: 0 },
          actions: Array.isArray(p.actions) ? p.actions : [],
        }));
        activePathId = data.activePathId || paths[0].id;
        if (!paths.some((p) => p.id === activePathId)) activePathId = paths[0].id;
      } else if (data.pose || data.actions) {
        // v1 single-path migrate
        paths = [{
          id: uidPath(),
          name: "Imported",
          pose: data.pose || { x: -60, y: -60, theta: 0 },
          actions: Array.isArray(data.actions) ? data.actions : [],
        }];
        activePathId = paths[0].id;
      }
      bindActive();
      syncPathSelect();
      syncBotInputs();
      syncStartInputs();
      renderFlow();
      draw();
      saveStatus.textContent = "Restored";
      saveStatus.className = "save-status ok";
    } catch (_) {}
  }

  function exportVPath() {
    bindActive();
    activePath().pose = pose;
    activePath().actions = actions;
    const data = {
      version: 2,
      format: "vpath",
      game: "Override 2026-27",
      paths,
      activePathId,
      bot,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `auton-${Date.now()}.vpath`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importVPath(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data.paths) && data.paths.length) {
          paths = data.paths.map((p) => ({
            id: p.id || uidPath(),
            name: p.name || "Routine",
            pose: p.pose || { x: -60, y: -60, theta: 0 },
            actions: (p.actions || []).map((a) => ({
              ...defaultAction(a.type || "moveToPoint"),
              ...a,
              id: a.id || uid(),
            })),
          }));
          activePathId = data.activePathId || paths[0].id;
        } else if (data.pose && Array.isArray(data.actions)) {
          paths = [{
            id: uidPath(),
            name: data.name || "Imported",
            pose: data.pose,
            actions: data.actions.map((a) => ({
              ...defaultAction(a.type || "moveToPoint"),
              ...a,
              id: a.id || uid(),
            })),
          }];
          activePathId = paths[0].id;
        } else {
          throw new Error("Invalid .vpath");
        }
        if (data.bot) bot = { ...bot, ...data.bot };
        bindActive();
        selectedId = null;
        syncPathSelect();
        syncBotInputs();
        syncStartInputs();
        renderFlow();
        draw();
        markDirty();
        saveLocal(true);
        syncPlannerIntoProjectManager({ ask: false, force: true });
        if (cloudReady && cloudUser) {
          cloudSave(true);
        }
      } catch (e) {
        alert("Could not import file: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  function drawRoundedRect(c, x, y, w, h, r) {
    if (typeof c.roundRect === "function") {
      c.roundRect(x, y, w, h, r);
    } else {
      const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      c.moveTo(x + rad, y);
      c.arcTo(x + w, y, x + w, y + h, rad);
      c.arcTo(x + w, y + h, x, y + h, rad);
      c.arcTo(x, y + h, x, y, rad);
      c.arcTo(x, y, x + w, y, rad);
      c.closePath();
    }
  }

  // -- Drawing ------------------------------------------------------
  function drawRobot(x, y, thetaDeg, color, alpha = 1, selected = false, isCollision = false) {
    const { cx, cy } = fieldToCanvas(x, y);
    const scale = getFieldScale();
    const w = bot.robotW * scale; // Lateral width (in canvas px)
    const l = bot.robotL * scale; // Longitudinal length (in canvas px)
    const rad = screenHeadingRad(thetaDeg);

    if (isCollision) {
      color = "#ef4444";
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(rad);

    if (isCollision) {
      ctx.shadowColor = "#ef4444";
      ctx.shadowBlur = 14;
    }

    const hasImg = bot.botImage && bot.botImageEnabled !== false && botImgReady && botImgElement.complete && (botImgElement.naturalWidth > 0 || botImgElement.width > 0);

    if (hasImg) {
      const photoRot = Number(bot.botImageOrientation) || 0;
      const rotRad = ((90 - photoRot) * Math.PI) / 180;
      const isUpDown = (photoRot === 0 || photoRot === 180);
      const drawW = isUpDown ? w : l;
      const drawH = isUpDown ? l : w;
      const imgOpacity = (bot.botImageOpacity != null ? bot.botImageOpacity : 1.0);

      ctx.save();
      ctx.globalAlpha = alpha * imgOpacity;
      ctx.rotate(rotRad);
      try {
        ctx.drawImage(botImgElement, -drawW / 2, -drawH / 2, drawW, drawH);
      } catch (_) {}
      ctx.restore();

      if (bot.botImageShowOutline !== false || isCollision) {
        ctx.strokeStyle = isCollision ? "#ef4444" : color;
        ctx.lineWidth = isCollision ? 3.5 : (selected ? 2.5 : 1.5);
        ctx.beginPath();
        drawRoundedRect(ctx, -l / 2, -w / 2, l, w, 4);
        ctx.stroke();

        // Front bumper indicator chevron
        ctx.fillStyle = isCollision ? "#ef4444" : "#fbbf24";
        ctx.beginPath();
        ctx.moveTo(l * 0.48, 0);
        ctx.lineTo(l * 0.32, -w * 0.22);
        ctx.lineTo(l * 0.36, 0);
        ctx.lineTo(l * 0.32, w * 0.22);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = isCollision ? "rgba(239, 68, 68, 0.85)" : color;
      ctx.strokeStyle = isCollision ? "#fee2e2" : "#fff";
      ctx.lineWidth = isCollision ? 2.5 : 1.5;
      ctx.beginPath();
      drawRoundedRect(ctx, -l / 2, -w / 2, l, w, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isCollision ? "#fff" : "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(l * 0.45, 0);
      ctx.lineTo(l * 0.15, -w * 0.28);
      ctx.lineTo(l * 0.15, w * 0.28);
      ctx.closePath();
      ctx.fill();
    }

    if (selected && !isCollision) {
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      drawRoundedRect(ctx, -l / 2 - 4, -w / 2 - 4, l + 8, w + 8, 6);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (isCollision) {
      // Danger pulse border
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      drawRoundedRect(ctx, -l / 2 - 3, -w / 2 - 3, l + 6, w + 6, 6);
      ctx.stroke();
    }

    // Tracking origin center
    ctx.fillStyle = isCollision ? "#ef4444" : "#fff";
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Floating Collision Badge above Robot
    if (isCollision) {
      ctx.save();
      ctx.shadowColor = "#ef4444";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      drawRoundedRect(ctx, -26, -w / 2 - 20, 52, 16, 4);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("💥 HIT", 0, -w / 2 - 12);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawEndArrow(x, y, thetaDeg) {
    const { cx, cy } = fieldToCanvas(x, y);
    const rad = screenHeadingRad(thetaDeg);
    const len = 26;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    ctx.strokeStyle = "#f59e0b";
    ctx.fillStyle = "#f59e0b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(len + 5, 0);
    ctx.lineTo(len - 5, -6);
    ctx.lineTo(len - 5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function computePoses() {
    buildSimPath();
    const poses = [{ x: pose.x, y: pose.y, theta: pose.theta }];
    for (const seg of simSegments) {
      poses.push({ ...seg.endPose });
    }
    return poses;
  }

  function drawVectorFieldFallback(ctx, w, h) {
    // 1. Dark anti-glare foam background
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, w, h);

    // 2. Render 6x6 VEX Foam Tiles (24" x 24" each)
    const tileSize = w / 6;
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        const x = col * tileSize;
        const y = row * tileSize;
        ctx.fillStyle = (row + col) % 2 === 0 ? "#1e293b" : "#18202f";
        ctx.fillRect(x, y, tileSize, tileSize);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, tileSize, tileSize);
      }
    }

    // 3. Alliance Zones & Goal Corners (Red: Left, Blue: Right)
    ctx.fillStyle = "rgba(239, 68, 68, 0.18)";
    ctx.fillRect(0, 0, tileSize * 2, tileSize * 2);
    ctx.fillRect(0, h - tileSize * 2, tileSize * 2, tileSize * 2);

    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(2, 2, tileSize * 2 - 4, tileSize * 2 - 4);
    ctx.strokeRect(2, h - tileSize * 2 + 2, tileSize * 2 - 4, tileSize * 2 - 4);

    ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
    ctx.fillRect(w - tileSize * 2, 0, tileSize * 2, tileSize * 2);
    ctx.fillRect(w - tileSize * 2, h - tileSize * 2, tileSize * 2, tileSize * 2);

    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(w - tileSize * 2 + 2, 2, tileSize * 2 - 4, tileSize * 2 - 4);
    ctx.strokeRect(w - tileSize * 2 + 2, h - tileSize * 2 + 2, tileSize * 2 - 4, tileSize * 2 - 4);

    // 4. White Autonomous & Alliance Tape Lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.stroke();

    // 5. Center Ladder Goal
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = "rgba(245, 158, 11, 0.15)";
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.fillRect(cx - tileSize * 0.75, cy - tileSize * 0.75, tileSize * 1.5, tileSize * 1.5);
    ctx.strokeRect(cx - tileSize * 0.75, cy - tileSize * 0.75, tileSize * 1.5, tileSize * 1.5);

    ctx.beginPath();
    ctx.moveTo(cx - 15, cy); ctx.lineTo(cx + 15, cy);
    ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy + 15);
    ctx.stroke();

    // 6. Perimeter Wall
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
  }

  /**
   * Render collidable field elements (wall loaders, mobile goals, ladder)
   */
  function drawFieldObstacles(ctx, activeCollidingObstacleIds = new Set()) {
    if (!ctx || !canvas) return;
    const scale = getFieldScale();

    // 1. Draw Match Loaders (Screenshots 2 & 3: angled hopper chute attached to perimeter wall)
    if (collisionConfig.checkLoaders) {
      for (const loader of FIELD_OBSTACLES.loaders) {
        if (collisionConfig.disabledObstacleIds[loader.id]) continue;
        const isHit = activeCollidingObstacleIds.has(loader.id);
        const tl = fieldToCanvas(loader.minX, loader.maxY);
        const br = fieldToCanvas(loader.maxX, loader.minY);
        const w = br.cx - tl.cx;
        const h = br.cy - tl.cy;

        ctx.save();
        if (isHit) {
          ctx.shadowColor = "#ef4444";
          ctx.shadowBlur = 16;
        }

        // Background fill for loader intake chute
        ctx.fillStyle = isHit ? "rgba(239, 68, 68, 0.45)" : (loader.color === "red" ? "rgba(220, 38, 38, 0.20)" : "rgba(37, 99, 235, 0.20)");
        ctx.strokeStyle = isHit ? "#ef4444" : (loader.color === "red" ? "#ef4444" : "#3b82f6");
        ctx.lineWidth = isHit ? 2.5 : 1.5;

        // Draw outer bounding zone
        ctx.beginPath();
        drawRoundedRect(ctx, tl.cx, tl.cy, w, h, 4);
        ctx.fill();
        ctx.stroke();

        // Draw realistic loader hardware graphics (metal wall mounting plate & angled hopper guide chute)
        const plateW = 1.8 * scale;
        ctx.fillStyle = isHit ? "#ef4444" : (loader.color === "red" ? "#991b1b" : "#1e40af");
        if (loader.wall === "west") {
          // Left wall mounting bracket
          ctx.fillRect(tl.cx, tl.cy + 2, plateW, h - 4);
          // Angled hopper guide rails narrowing into field
          ctx.beginPath();
          ctx.moveTo(tl.cx + plateW, tl.cy + 3);
          ctx.lineTo(br.cx - 3, tl.cy + h * 0.22);
          ctx.lineTo(br.cx - 3, br.cy - h * 0.22);
          ctx.lineTo(tl.cx + plateW, br.cy - 3);
          ctx.strokeStyle = loader.color === "red" ? "#fca5a5" : "#93c5fd";
          ctx.lineWidth = 1.4;
          ctx.stroke();

          // Chute mouth bar
          ctx.beginPath();
          ctx.moveTo(br.cx - 3, tl.cy + h * 0.22);
          ctx.lineTo(br.cx - 3, br.cy - h * 0.22);
          ctx.strokeStyle = loader.color === "red" ? "#ef4444" : "#3b82f6";
          ctx.lineWidth = 2.0;
          ctx.stroke();
        } else {
          // Right wall mounting bracket
          ctx.fillRect(br.cx - plateW, tl.cy + 2, plateW, h - 4);
          // Angled hopper guide rails narrowing into field
          ctx.beginPath();
          ctx.moveTo(br.cx - plateW, tl.cy + 3);
          ctx.lineTo(tl.cx + 3, tl.cy + h * 0.22);
          ctx.lineTo(tl.cx + 3, br.cy - h * 0.22);
          ctx.lineTo(br.cx - plateW, br.cy - 3);
          ctx.strokeStyle = loader.color === "red" ? "#fca5a5" : "#93c5fd";
          ctx.lineWidth = 1.4;
          ctx.stroke();

          // Chute mouth bar
          ctx.beginPath();
          ctx.moveTo(tl.cx + 3, tl.cy + h * 0.22);
          ctx.lineTo(tl.cx + 3, br.cy - h * 0.22);
          ctx.strokeStyle = loader.color === "red" ? "#ef4444" : "#3b82f6";
          ctx.lineWidth = 2.0;
          ctx.stroke();
        }

        // Loader Text Label
        ctx.fillStyle = isHit ? "#fff" : "#f1f5f9";
        ctx.font = "bold 8.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const centerC = fieldToCanvas(loader.center.x, loader.center.y);
        ctx.fillText(loader.color === "red" ? "RED LOADER" : "BLUE LOADER", centerC.cx, centerC.cy);

        if (isHit) {
          ctx.font = "bold 12px sans-serif";
          ctx.fillText("💥", centerC.cx, centerC.cy - 14);
        }
        ctx.restore();
      }
    }

    // 2. Draw Mobile Goals (Screenshots 1, 4 & 5: Hexagonal base, center hole, colored rim)
    if (collisionConfig.checkGoals) {
      for (const goal of FIELD_OBSTACLES.goals) {
        if (collisionConfig.disabledObstacleIds[goal.id]) continue;
        const isClamped = !!collisionConfig.clampedObstacleIds[goal.id];
        const isHit = activeCollidingObstacleIds.has(goal.id);
        const { cx, cy } = fieldToCanvas(goal.x, goal.y);
        const r = goal.radius * scale;

        ctx.save();
        if (isClamped) {
          ctx.globalAlpha = 0.45;
        }

        if (isHit) {
          ctx.shadowColor = "#ef4444";
          ctx.shadowBlur = 18;
        }

        // Draw hexagonal base
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const px = cx + r * Math.cos(a);
          const py = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();

        // Base color gradient / styling
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
          // Neutral yellow mobile goal (Screen 5: dark body with yellow ring and center pin)
          ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
          ctx.strokeStyle = "#eab308";
        }

        ctx.lineWidth = isHit ? 3.0 : 1.8;
        ctx.fill();
        ctx.stroke();

        // Inner circular ring / stake receiver groove
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        if (!isHit) {
          if (goal.color === "yellow") {
            ctx.fillStyle = "#eab308";
            ctx.fill();
          } else if (goal.color === "red") {
            ctx.fillStyle = "#ef4444";
            ctx.fill();
          } else if (goal.color === "blue") {
            ctx.fillStyle = "#3b82f6";
            ctx.fill();
          }
        }
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // Center post / stake hole
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = "#0f172a";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label / indicator
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (isHit) {
          ctx.fillStyle = "#fff";
          ctx.font = "bold 11px sans-serif";
          ctx.fillText("💥", cx, cy - r - 8);
        } else if (isClamped) {
          ctx.fillStyle = "#f59e0b";
          ctx.font = "bold 8px sans-serif";
          ctx.fillText("CLAMPED", cx, cy + r + 8);
        }

        // Safety clearance zone ring if enabled
        if (collisionConfig.showSafeClearanceZones || collisionConfig.safetyBuffer > 0) {
          const bufR = (goal.radius + collisionConfig.safetyBuffer) * scale;
          ctx.beginPath();
          ctx.arc(cx, cy, bufR, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.restore();
      }
    }

    // 3. Draw Center Ladder Structure
    if (collisionConfig.checkLadder) {
      for (const lad of FIELD_OBSTACLES.ladder) {
        if (collisionConfig.disabledObstacleIds[lad.id]) continue;
        const isHit = activeCollidingObstacleIds.has(lad.id);
        const { cx, cy } = fieldToCanvas(lad.x, lad.y);
        const r = lad.radius * scale;

        ctx.save();
        if (isHit) {
          ctx.shadowColor = "#ef4444";
          ctx.shadowBlur = 18;
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 3.0;
        } else {
          ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
          ctx.lineWidth = 1.5;
        }
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  function drawCollisionPathMarkers(ctx, report) {
    if (!ctx || !report || !report.collisions || !report.collisions.length) return;
    ctx.save();
    for (const col of report.collisions) {
      if (!col.point) continue;
      const { cx, cy } = fieldToCanvas(col.point.x, col.point.y);
      // Pulsing impact beacon on path
      ctx.shadowColor = "#ef4444";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText("💥", cx, cy - 8);
    }
    ctx.restore();
  }

  function draw() {
    if (!ctx || !canvas) return;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (imgReady && fieldImg.naturalWidth) {
        ctx.drawImage(fieldImg, 0, 0, canvas.width, canvas.height);
      } else {
        drawVectorFieldFallback(ctx, canvas.width, canvas.height);
      }

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      for (let i = -72; i <= 72; i += 24) {
        let p1 = fieldToCanvas(i, -72), p2 = fieldToCanvas(i, 72);
        ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.stroke();
        p1 = fieldToCanvas(-72, i); p2 = fieldToCanvas(72, i);
        ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.stroke();
      }

    // Evaluate routine collisions & collect active colliding obstacle IDs
    const routineReport = evaluateRoutineCollisions();
    const liveHitObstacleIds = new Set(routineReport.collidingObstacleIds);

    let simLiveCol = null;
    if (simRunning && simPath.length) {
      const curSimP = simPath[Math.min(simIdx, simPath.length - 1)];
      simLiveCol = checkRobotCollisionAtPose(curSimP.x, curSimP.y, curSimP.theta, collisionConfig.safetyBuffer);
      if (simLiveCol.hit) {
        for (const obs of simLiveCol.obstacles) {
          liveHitObstacleIds.add(obs.id);
        }
      }
    }

    // Render Field Obstacles (Loaders, Mobile Goals, Center Ladder)
    if (collisionConfig.enabled && collisionConfig.showObstacleOverlays) {
      drawFieldObstacles(ctx, liveHitObstacleIds);
    }

    buildSimPath();
    const poses = [{ x: pose.x, y: pose.y, theta: pose.theta }];
    for (const seg of simSegments) {
      poses.push({ ...seg.endPose });
    }

    // Calculate total points across all segments for progressive drawing animation
    let allTrajectoryPoints = [];
    for (const seg of simSegments) {
      if (!seg.action || seg.action.type === "custom") continue;
      if (seg.points && seg.points.length) {
        for (let pi = 0; pi < seg.points.length; pi++) {
          allTrajectoryPoints.push({
            pt: seg.points[pi],
            actionType: seg.action.type,
            async: !!seg.action.async,
            seg: seg,
          });
        }
      }
    }

    const totalPoints = allTrajectoryPoints.length;
    const activePointLimit = (pathAnimProgress >= 1.0 || totalPoints === 0)
      ? totalPoints
      : Math.max(1, Math.floor(totalPoints * pathAnimProgress));

    // Render the simulated differential-drive path from LemLib kinematics up to activePointLimit
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    let pen = false;
    let pointCounter = 0;

    for (const seg of simSegments) {
      if (!seg.action || seg.action.type === "custom") continue;
      if (!seg.points) continue;
      for (const pt of seg.points) {
        if (pointCounter >= activePointLimit) break;
        pointCounter++;
        const c = fieldToCanvas(pt.x, pt.y);
        if (!pen) { ctx.moveTo(c.cx, c.cy); pen = true; }
        else ctx.lineTo(c.cx, c.cy);
      }
      if (pointCounter >= activePointLimit) break;
    }
    ctx.stroke();

    // Render Bezier Spline Curves with vibrant cyan arc highlight up to activePointLimit
    pointCounter = 0;
    for (const seg of simSegments) {
      if (!seg.action || seg.action.type === "custom") continue;
      const isBezier = seg.action.type === "bezierCurve";
      if (isBezier && seg.points && seg.points.length >= 2) {
        ctx.save();
        ctx.strokeStyle = "#06b6d4";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        let bPen = false;
        for (const pt of seg.points) {
          if (pointCounter >= activePointLimit) break;
          const c = fieldToCanvas(pt.x, pt.y);
          if (!bPen) { ctx.moveTo(c.cx, c.cy); bPen = true; }
          else ctx.lineTo(c.cx, c.cy);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (seg.points) pointCounter += seg.points.length;
      if (pointCounter >= activePointLimit) break;
    }

    // Render Collision Path Markers along the trajectory
    if (collisionConfig.enabled) {
      drawCollisionPathMarkers(ctx, routineReport);
    }

    // Visual feedback for multitasking (async) motions along path
    pointCounter = 0;
    for (const seg of simSegments) {
      if (!seg.action || seg.action.type === "custom") continue;
      if (seg.action.async && seg.points && seg.points.length >= 2) {
        ctx.save();
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.65;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        let segPen = false;
        for (const pt of seg.points) {
          if (pointCounter >= activePointLimit) break;
          const c = fieldToCanvas(pt.x, pt.y);
          if (!segPen) { ctx.moveTo(c.cx, c.cy); segPen = true; }
          else ctx.lineTo(c.cx, c.cy);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (seg.points) pointCounter += seg.points.length;
      if (pointCounter >= activePointLimit) break;
    }

    // Glowing tracer head spark at the leading edge of drawing animation
    if (pathAnimProgress < 1.0 && totalPoints > 0 && activePointLimit > 0) {
      const tipObj = allTrajectoryPoints[Math.min(activePointLimit - 1, totalPoints - 1)];
      if (tipObj && tipObj.pt) {
        const tipC = fieldToCanvas(tipObj.pt.x, tipObj.pt.y);
        ctx.save();
        ctx.shadowColor = tipObj.actionType === "bezierCurve" ? "#22d3ee" : "#60a5fa";
        ctx.shadowBlur = 18;
        ctx.fillStyle = tipObj.actionType === "bezierCurve" ? "#06b6d4" : "#3b82f6";
        ctx.beginPath();
        ctx.arc(tipC.cx, tipC.cy, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.2;
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(tipC.cx, tipC.cy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // LemLib Boomerang visual feedback for selected action
    if (selectedId) {
      const si = actions.findIndex((x) => x.id === selectedId);
      if (si >= 0 && simSegments[si]) {
        const seg = simSegments[si];
        const a = actions[si];
        if (a.type === "moveToPose" && seg.carrot) {
          const fromPt = si === 0 ? pose : simSegments[si - 1].endPose;
          const cFrom = fieldToCanvas(fromPt.x, fromPt.y);
          const cCarrot = fieldToCanvas(seg.carrot.x, seg.carrot.y);
          const cTgt = fieldToCanvas(a.x, a.y);

          ctx.strokeStyle = "rgba(249, 115, 22, 0.7)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cFrom.cx, cFrom.cy);
          ctx.lineTo(cCarrot.cx, cCarrot.cy);
          ctx.lineTo(cTgt.cx, cTgt.cy);
          ctx.stroke();
          ctx.setLineDash([]);

          // Carrot marker
          ctx.fillStyle = "#f97316";
          ctx.beginPath();
          ctx.arc(cCarrot.cx, cCarrot.cy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#fdba74";
          ctx.font = "bold 10px sans-serif";
          ctx.fillText("Carrot", cCarrot.cx + 8, cCarrot.cy + 3);
        }

        if (a.type === "bezierCurve") {
          const fromPt = si === 0 ? pose : simSegments[si - 1].endPose;
          const { cp1, cp2 } = getBezierControlPoints(a, fromPt);
          const cFrom = fieldToCanvas(fromPt.x, fromPt.y);
          const cCp1 = fieldToCanvas(cp1.x, cp1.y);
          const cCp2 = fieldToCanvas(cp2.x, cp2.y);
          const cTgt = fieldToCanvas(a.x, a.y);

          // Control arm 1: fromPt -> CP1
          ctx.strokeStyle = "rgba(6, 182, 212, 0.85)";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cFrom.cx, cFrom.cy);
          ctx.lineTo(cCp1.cx, cCp1.cy);
          ctx.stroke();

          // Control arm 2: Target -> CP2
          ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
          ctx.beginPath();
          ctx.moveTo(cTgt.cx, cTgt.cy);
          ctx.lineTo(cCp2.cx, cCp2.cy);
          ctx.stroke();
          ctx.setLineDash([]);

          // CP1 handle (departure tangent)
          ctx.fillStyle = "#06b6d4";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cCp1.cx, cCp1.cy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#a5f3fc";
          ctx.font = "bold 10px sans-serif";
          ctx.fillText("CP1", cCp1.cx + 9, cCp1.cy + 3);

          // CP2 handle (arrival tangent)
          ctx.fillStyle = "#f59e0b";
          ctx.strokeStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(cCp2.cx, cCp2.cy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#fde68a";
          ctx.fillText("CP2", cCp2.cx + 9, cCp2.cy + 3);

          // Curvature HUD pill on canvas near curve midpoint
          const metrics = computeBezierMetrics(a, fromPt);
          const midU = evalCubicBezier(fromPt, cp1, cp2, { x: a.x, y: a.y }, 0.5, a.forwards !== false);
          const cMid = fieldToCanvas(midU.x, midU.y);

          ctx.save();
          const hudText = `Arc: ${metrics.arcLength.toFixed(1)}" | R_min: ${metrics.minRadius < 200 ? metrics.minRadius.toFixed(1) + '"' : '∞'}`;
          ctx.font = "600 10px ui-monospace, monospace";
          const tw = ctx.measureText(hudText).width;
          ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
          ctx.strokeStyle = "rgba(6, 182, 212, 0.75)";
          ctx.lineWidth = 1;
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(cMid.cx - tw / 2 - 6, cMid.cy - 18, tw + 12, 18, 4);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillRect(cMid.cx - tw / 2 - 6, cMid.cy - 18, tw + 12, 18);
            ctx.strokeRect(cMid.cx - tw / 2 - 6, cMid.cy - 18, tw + 12, 18);
          }
          ctx.fillStyle = "#38bdf8";
          ctx.fillText(hudText, cMid.cx - tw / 2, cMid.cy - 5);
          ctx.restore();
        }
      }
    }

    for (let i = 1; i < poses.length; i++) {
      const a = actions[i - 1];
      if (a.type === "custom") continue;
      if (!needsPoint(a.type) && !isMove(a.type)) continue;
      const p = fieldToCanvas(poses[i].x, poses[i].y);
      const sel = a.id === selectedId;
      const isRev = a.forwards === false;
      const isAsync = a.async === true;

      // Multitask halo ring
      if (isAsync) {
        ctx.save();
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#a855f7";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, (sel ? 7 : 5) + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = sel ? "#60a5fa" : isAsync ? "#a855f7" : isRev ? "#f97316" : "#3b82f6";
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, sel ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "11px sans-serif";
      ctx.fillText(String(i) + (isRev ? "R" : "") + (isAsync ? "⚡" : ""), p.cx + 8, p.cy - 6);

      // Sharp angle transition badge on canvas waypoint
      const canvasSharpTurns = analyzeSharpAngleTransitions();
      const canvasSharpTurn = canvasSharpTurns.find((st) => st.cornerWaypointNum === i);
      if (canvasSharpTurn) {
        ctx.save();
        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(`⚡ ${canvasSharpTurn.angleDelta}°`, p.cx + 8, p.cy + 10);
        ctx.restore();
      }

      // Target aim visualization for swingToPoint and turnToPoint
      if (a.type === "swingToPoint" || a.type === "turnToPoint") {
        const tp = fieldToCanvas(a.x, a.y);
        ctx.save();
        ctx.strokeStyle = sel ? "#38bdf8" : "rgba(56, 189, 248, 0.4)";
        ctx.lineWidth = sel ? 1.5 : 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(p.cx, p.cy);
        ctx.lineTo(tp.cx, tp.cy);
        ctx.stroke();
        ctx.setLineDash([]);

        if (a.type === "swingToPoint" && (sel || (typeof drag !== "undefined" && drag && drag.id === a.id))) {
          // Draw locked wheel pivot
          const fromPose = (i - 1 === 0 ? pose : (simSegments[i - 2]?.endPose || poses[i - 1])) || pose;
          const lockLeft = (a.lockedSide || "LEFT") === "LEFT";
          const h = (bot.trackWidth || 12) / 2;
          const rad0 = (fromPose.theta * Math.PI) / 180;
          const pivX = lockLeft ? fromPose.x - h * Math.cos(rad0) : fromPose.x + h * Math.cos(rad0);
          const pivY = lockLeft ? fromPose.y + h * Math.sin(rad0) : fromPose.y - h * Math.sin(rad0);
          const cpiv = fieldToCanvas(pivX, pivY);

          // Pivot marker
          ctx.strokeStyle = "#f59e0b";
          ctx.fillStyle = "#fbbf24";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cpiv.cx, cpiv.cy, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#f59e0b";
          ctx.font = "bold 9px sans-serif";
          ctx.fillText("Pivot", cpiv.cx + 5, cpiv.cy + 3);

          // Extended rotation radius axis ray
          const radHeading = (poses[i].theta * Math.PI) / 180;
          const rayFarX = poses[i].x + Math.sin(radHeading) * 120;
          const rayFarY = poses[i].y + Math.cos(radHeading) * 120;
          const cRay = fieldToCanvas(rayFarX, rayFarY);
          ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(p.cx, p.cy);
          ctx.lineTo(cRay.cx, cRay.cy);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Target reticle
        const dist = Math.hypot(a.x - poses[i].x, a.y - poses[i].y);
        ctx.strokeStyle = sel ? "#38bdf8" : "rgba(56, 189, 248, 0.7)";
        ctx.lineWidth = sel ? 2 : 1.2;
        ctx.beginPath();
        ctx.arc(tp.cx, tp.cy, sel ? 7 : 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tp.cx - 9, tp.cy); ctx.lineTo(tp.cx + 9, tp.cy);
        ctx.moveTo(tp.cx, tp.cy - 9); ctx.lineTo(tp.cx, tp.cy + 9);
        ctx.stroke();
        if (sel) {
          ctx.fillStyle = "#38bdf8";
          ctx.font = "bold 10px sans-serif";
          const snapTxt = a.type === "swingToPoint"
            ? `Aim ${i} (${poses[i].theta.toFixed(1)}° | R:${dist.toFixed(0)}")`
            : `Aim ${i}`;
          ctx.fillText(snapTxt, tp.cx + 8, tp.cy - 6);
        }
        ctx.restore();
      }
    }

    const startCol = collisionConfig.enabled ? checkRobotCollisionAtPose(pose.x, pose.y, pose.theta, collisionConfig.safetyBuffer) : { hit: false };
    drawRobot(pose.x, pose.y, pose.theta, startCol.hit ? "#ef4444" : "#22c55e", 0.95, selectedId === "start", startCol.hit);
    const s = fieldToCanvas(pose.x, pose.y);
    ctx.fillStyle = startCol.hit ? "#ef4444" : "#22c55e";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(startCol.hit ? "START 💥 COLLISION" : "START", s.cx + 12, s.cy - 10);

    if (poses.length > 1) {
      const end = poses[poses.length - 1];
      const endCol = collisionConfig.enabled ? checkRobotCollisionAtPose(end.x, end.y, end.theta, collisionConfig.safetyBuffer) : { hit: false };
      drawRobot(end.x, end.y, end.theta, endCol.hit ? "#ef4444" : "#f59e0b", 0.65, false, endCol.hit);
      drawEndArrow(end.x, end.y, end.theta);
      const ep = fieldToCanvas(end.x, end.y);
      ctx.fillStyle = endCol.hit ? "#ef4444" : "#fbbf24";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(
        `END (${end.x.toFixed(1)}, ${end.y.toFixed(1)}) θ=${end.theta.toFixed(0)}°${endCol.hit ? " 💥 HIT" : ""}`,
        ep.cx + 14,
        ep.cy + 14
      );
    }

    if (simRunning && simPath.length) {
      const p = simPath[Math.min(simIdx, simPath.length - 1)];
      const isLiveHit = simLiveCol ? simLiveCol.hit : false;
      drawRobot(p.x, p.y, p.theta, isLiveHit ? "#ef4444" : "#38bdf8", 1, false, isLiveHit);
      // Real-time speed vector
      if (Math.abs(p.vLin || 0) > 1) {
        const cp = fieldToCanvas(p.x, p.y);
        const sRad = screenHeadingRad(p.theta);
        const dir = p.vLin >= 0 ? 1 : -1;
        const arrowLen = Math.min(32, Math.abs(p.vLin) * 0.35);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cp.cx, cp.cy);
        ctx.lineTo(cp.cx + Math.cos(sRad) * arrowLen * dir, cp.cy + Math.sin(sRad) * arrowLen * dir);
        ctx.stroke();
      }
    }
    } catch (err) {
      console.warn("Error rendering simulation canvas:", err);
    }
  }

  // -- Flowchart UI -------------------------------------------------
  function badgeClass(type) {
    if (type === "ifElse") return "control";
    if (type === "custom") return "custom";
    if (type === "wait") return "wait";
    if (type === "bezierCurve") return "bezier";
    if (isMove(type)) return "move";
    if (isTurn(type)) return "turn";
    if (isSwing(type)) return "swing";
    return "move";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeXml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function cleanCommentText(label) {
    if (!label) return "";
    let clean = String(label).trim();
    if (clean.startsWith("//")) clean = clean.replace(/^\/\/\s*/, "");
    return clean;
  }

  /**
   * Computes multitasking concurrency info between two adjacent actions.
   * Compares execution durations and determines which action takes precedence.
   */
  function getMultitaskPrecedence(actA, idxA, actB, idxB, poses) {
    if (!actA || !actB) return null;
    const poseA = (poses && poses[idxA]) ? poses[idxA] : { x: pose.x, y: pose.y, theta: pose.theta };
    const poseB = (poses && poses[idxB]) ? poses[idxB] : (actA.type === "custom" ? poseA : (poses && poses[idxA + 1] ? poses[idxA + 1] : poseA));

    const durA = estimateActionTime(actA, poseA);
    const durB = estimateActionTime(actB, poseB);

    const nameA = actA.label ? cleanCommentText(actA.label) : (actA.type === "custom" ? "Custom Task" : actA.type);
    const nameB = actB.label ? cleanCommentText(actB.label) : (actB.type === "custom" ? "Custom Task" : actB.type);

    let precedenceStep = null;
    let diff = Math.abs(durA - durB);
    let summary = "";
    let leadTitle = "";
    let leadDur = 0;
    let trailDur = 0;

    if (durA > durB) {
      precedenceStep = "A";
      leadTitle = `Step ${idxA + 1} (${nameA})`;
      leadDur = durA;
      trailDur = durB;
      const trailName = `Step ${idxB + 1} (${nameB})`;
      summary = `Step ${idxA + 1} (${nameA}, ${durA.toFixed(2)}s) takes precedence over ${trailName} (${durB.toFixed(2)}s) by +${diff.toFixed(2)}s`;
    } else if (durB > durA) {
      precedenceStep = "B";
      leadTitle = `Step ${idxB + 1} (${nameB})`;
      leadDur = durB;
      trailDur = durA;
      const trailName = `Step ${idxA + 1} (${nameA})`;
      summary = `Step ${idxB + 1} (${nameB}, ${durB.toFixed(2)}s) takes precedence over ${trailName} (${durA.toFixed(2)}s) by +${diff.toFixed(2)}s`;
    } else {
      precedenceStep = "EQUAL";
      leadTitle = "Both Steps (Equal)";
      leadDur = durA;
      trailDur = durB;
      summary = `Equal duration: Both Step ${idxA + 1} and Step ${idxB + 1} complete in ${durA.toFixed(2)}s`;
    }

    return {
      durA,
      durB,
      diff,
      precedenceStep,
      leadTitle,
      leadDur,
      trailDur,
      summary,
      nameA,
      nameB,
      isInstantA: durA === 0,
      isInstantB: durB === 0
    };
  }

  function getActionDetails(act, i) {
    if (!act) return { title: "End of Routine", sub: "chassis.waitUntilDone()", type: "end" };
    const stepNum = i + 1;
    if (act.type === "custom") {
      let codeSnip = "";
      if (act.customCode) {
        const lines = act.customCode.split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith("//"));
        if (lines.length > 0) codeSnip = lines[0];
      }
      return {
        title: `${stepNum}. Custom Code`,
        sub: codeSnip ? codeSnip.slice(0, 22) : (act.label || "Subsystem task"),
        type: "custom",
        async: !!act.async
      };
    }
    if (act.type === "ifElse") {
      return {
        title: `${stepNum}. If / Else`,
        sub: act.condition ? `if (${act.condition.slice(0,18)})` : "Conditional",
        type: "ifElse",
        async: !!act.async
      };
    }
    if (act.type === "loop") {
      const mode = act.loopMode || "until";
      let subText = "Loop";
      if (mode === "until") subText = `until (${act.condition ? act.condition.slice(0, 14) : ""})`;
      else if (mode === "for") subText = `for ${act.times || 5} times`;
      else subText = "forever";
      return {
        title: `${stepNum}. Loop`,
        sub: subText,
        type: "loop",
        async: !!act.async
      };
    }
    const coords = (act.x != null && act.y != null) ? `(${act.x}", ${act.y}")` : "";
    return {
      title: `${stepNum}. ${act.type}`,
      sub: act.label ? act.label.slice(0, 20) : coords,
      type: act.type,
      async: !!act.async
    };
  }

  function generateMultitaskFlowchartSvg(a, idx, isModal = false) {
    const uid = (a.id || ("act_" + idx)) + (isModal ? "_m" : "");
    const prevAct = idx > 0 ? actions[idx - 1] : null;
    const nextAct = idx < actions.length - 1 ? actions[idx + 1] : null;
    const afterNextAct = idx < actions.length - 2 ? actions[idx + 2] : null;
    const poses = computePoses();

    let stepA, stepB, stepC, stepD;
    let mPrec = null;

    if (a.type === "custom") {
      stepA = prevAct ? getActionDetails(prevAct, idx - 1) : { title: "Step 0. Start", sub: "Autonomous Entry", type: "start", durStr: "0.00s" };
      stepB = getActionDetails(a, idx); // Custom code
      stepC = nextAct ? getActionDetails(nextAct, idx + 1) : { title: `Step ${idx + 2}. Parallel Motion`, sub: "Chassis Drive Thread", type: "moveToPoint", durStr: "1.20s" };
      stepD = afterNextAct ? getActionDetails(afterNextAct, idx + 2) : { title: "Next Sequential Step", sub: "chassis.waitUntilDone();", type: "swingToPoint", durStr: "0.80s" };
      if (nextAct) {
        mPrec = getMultitaskPrecedence(a, idx, nextAct, idx + 1, poses);
      }
    } else {
      stepA = getActionDetails(a, idx); // e.g. move to point
      if (nextAct && nextAct.type === "custom") {
        stepB = getActionDetails(nextAct, idx + 1);
        stepC = afterNextAct ? getActionDetails(afterNextAct, idx + 2) : { title: `Step ${idx + 3}. Parallel Motion`, sub: "Chassis Drive Thread", type: "moveToPoint", durStr: "1.20s" };
        const stepAfter = idx < actions.length - 3 ? actions[idx + 3] : null;
        stepD = stepAfter ? getActionDetails(stepAfter, idx + 3) : { title: "Next Sequential Step", sub: "chassis.waitUntilDone();", type: "swingToPoint", durStr: "0.80s" };
        mPrec = getMultitaskPrecedence(a, idx, nextAct, idx + 1, poses);
      } else {
        stepB = { title: `${idx + 2}. Custom Code`, sub: nextAct ? (nextAct.label ? cleanCommentText(nextAct.label) : "Subsystem task") : "subsystem.action()", type: "custom", durStr: nextAct && nextAct.type === "custom" ? `${(nextAct.customDuration || 0).toFixed(2)}s` : "0.00s (Instant)" };
        stepC = nextAct ? getActionDetails(nextAct, idx + 1) : { title: `${idx + 2}. moveToPoint`, sub: "Chassis Motion Track", type: "moveToPoint", durStr: "1.00s" };
        stepD = afterNextAct ? getActionDetails(afterNextAct, idx + 2) : { title: `${idx + 3}. swingToPoint`, sub: "chassis.waitUntilDone()", type: "swingToPoint", durStr: "0.80s" };
        if (nextAct) {
          mPrec = getMultitaskPrecedence(a, idx, nextAct, idx + 1, poses);
        }
      }
    }

    const w = 340;
    const h = 440;

    const precText = mPrec
      ? (mPrec.precedenceStep === "A"
          ? `🏆 Precedence: ${mPrec.leadTitle} (+${mPrec.diff.toFixed(2)}s)`
          : (mPrec.precedenceStep === "B"
              ? `🏆 Precedence: ${mPrec.leadTitle} (+${mPrec.diff.toFixed(2)}s)`
              : "🏆 Precedence: Equal Duration"))
      : "⚡ Concurrent Execution";

    return `
      <svg class="flowchart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Seamless Multitask Concurrency Flowchart">
        <defs>
          <marker id="fc-arr-cyan-${uid}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8"/>
          </marker>
          <marker id="fc-arr-purple-${uid}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#c084fc"/>
          </marker>
          <marker id="fc-arr-blue-${uid}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#60a5fa"/>
          </marker>
          <marker id="fc-arr-emerald-${uid}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#34d399"/>
          </marker>
          <linearGradient id="fc-grad-left-${uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" />
            <stop offset="100%" stop-color="#c084fc" />
          </linearGradient>
          <linearGradient id="fc-grad-right-${uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" />
            <stop offset="100%" stop-color="#60a5fa" />
          </linearGradient>
        </defs>

        <!-- SUBTLE GRID BACKGROUND ACCENT -->
        <rect x="0" y="0" width="${w}" height="${h}" fill="none" rx="8" />

        <!-- 1. TOP ANCHOR NODE: STEP A (e.g. Move to point) -->
        <g id="fc-node-a-${uid}">
          <rect x="25" y="14" width="135" height="42" rx="8" fill="#172554" stroke="#38bdf8" stroke-width="1.8" />
          <text x="92" y="31" text-anchor="middle" font-size="10" font-weight="700" fill="#f0f9ff">${escapeXml(stepA.title)}</text>
          <text x="92" y="45" text-anchor="middle" font-size="8" fill="#7dd3fc">${escapeXml(stepA.sub || "chassis motion")} (${escapeXml(stepA.durStr || "")})</text>
        </g>

        <!-- STREAMLINED SEAMLESS BRANCH CONNECTOR: Top Step A -> Left (Custom Code) & Right (Move To Point) -->
        <path d="M 92 56 L 92 120" stroke="#c084fc" stroke-width="2" fill="none" marker-end="url(#fc-arr-purple-${uid})" />
        <text x="86" y="90" text-anchor="end" font-size="7.5" font-weight="700" fill="#c084fc">ASYNC FORK ↓</text>

        <path d="M 125 56 C 125 86, 245 84, 245 120" stroke="#60a5fa" stroke-width="2" stroke-dasharray="3,3" fill="none" marker-end="url(#fc-arr-blue-${uid})" />
        <text x="180" y="82" text-anchor="middle" font-size="7.5" font-weight="700" fill="#93c5fd">CONCURRENT ↓</text>

        <!-- 2. PARALLEL BRANCHES (LEFT: CUSTOM CODE | RIGHT: MOVE TO POINT) -->
        <!-- LEFT: Custom Code (Subsystem Thread) -->
        <g id="fc-node-b-${uid}">
          <rect x="25" y="124" width="135" height="48" rx="8" fill="#1e1b4b" stroke="#a855f7" stroke-width="2" />
          <rect x="25" y="124" width="135" height="15" rx="8" fill="rgba(168,85,247,0.2)" />
          <text x="32" y="135" font-size="7.5" font-weight="800" fill="#d8b4fe">⚡ THREAD 1 · SUBSYSTEM</text>
          <text x="92" y="150" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fae8ff">${escapeXml(stepB.title)}</text>
          <text x="92" y="161" class="fc-custom-snip" text-anchor="middle" font-size="7.5" font-family="monospace" fill="#c084fc">${escapeXml(stepB.sub)} · ${escapeXml(stepB.durStr || "")}</text>
        </g>

        <!-- RIGHT: Move to point (Chassis Thread) -->
        <g id="fc-node-c-${uid}">
          <rect x="180" y="124" width="135" height="48" rx="8" fill="#0f172a" stroke="#3b82f6" stroke-width="2" />
          <rect x="180" y="124" width="135" height="15" rx="8" fill="rgba(59,130,246,0.2)" />
          <text x="187" y="135" font-size="7.5" font-weight="800" fill="#93c5fd">🤖 THREAD 2 · CHASSIS</text>
          <text x="247" y="150" text-anchor="middle" font-size="9.5" font-weight="700" fill="#eff6ff">${escapeXml(stepC.title)}</text>
          <text x="247" y="161" text-anchor="middle" font-size="7.5" fill="#60a5fa">${escapeXml(stepC.sub || "chassis.moveToPoint()")} · ${escapeXml(stepC.durStr || "")}</text>
        </g>

        <!-- SUB-STEP CONNECTIONS IN PARALLEL -->
        <path d="M 92 172 L 92 224" stroke="#c084fc" stroke-width="1.8" fill="none" marker-end="url(#fc-arr-purple-${uid})" />
        <path d="M 247 172 L 247 224" stroke="#60a5fa" stroke-width="1.8" fill="none" marker-end="url(#fc-arr-blue-${uid})" />

        <!-- SYNCHRONIZATION BAR / WAITING POINT -->
        <!-- Left Sub-badge -->
        <rect x="30" y="226" width="125" height="24" rx="6" fill="#2e1065" stroke="#7e22ce" stroke-width="1.2" />
        <text x="92" y="241" text-anchor="middle" font-size="7.5" font-weight="600" fill="#e9d5ff">Task: ${escapeXml(stepB.durStr || "Ready")}</text>

        <!-- Right Sub-badge -->
        <rect x="185" y="226" width="125" height="24" rx="6" fill="#1e3a8a" stroke="#2563eb" stroke-width="1.2" />
        <text x="247" y="241" text-anchor="middle" font-size="7.5" font-weight="600" fill="#bfdbfe">Drive: ${escapeXml(stepC.durStr || "At Target")}</text>

        <!-- PRECEDENCE BANNER IN SVG -->
        <rect x="30" y="258" width="280" height="22" rx="6" fill="#1e1b4b" stroke="#c084fc" stroke-width="1.3" />
        <text x="170" y="272" text-anchor="middle" font-size="8" font-weight="800" fill="#f5d0fe">${escapeXml(precText)}</text>

        <!-- 3. SEAMLESS RE-JOIN CONVERGENCE (CHASSIS.WAITUNTILDONE) -->
        <path d="M 92 280 C 92 304, 150 306, 160 318" stroke="#34d399" stroke-width="2" fill="none" marker-end="url(#fc-arr-emerald-${uid})" />
        <path d="M 247 280 C 247 304, 190 306, 180 318" stroke="#34d399" stroke-width="2" fill="none" marker-end="url(#fc-arr-emerald-${uid})" />

        <!-- Unified Convergence Sync Node -->
        <g id="fc-node-sync-${uid}">
          <rect x="45" y="322" width="250" height="34" rx="8" fill="#064e3b" stroke="#10b981" stroke-width="1.8" />
          <text x="170" y="337" text-anchor="middle" font-size="9" font-weight="800" fill="#d1fae5">⚡ SYNC &amp; RE-JOIN POINT</text>
          <text x="170" y="349" text-anchor="middle" font-size="7.5" font-family="monospace" fill="#a7f3d0">chassis.waitUntilDone();</text>
        </g>

        <!-- Straight arrow down to next sequential step (e.g. Swing to point) -->
        <path d="M 170 356 L 170 384" stroke="#34d399" stroke-width="2" fill="none" marker-end="url(#fc-arr-emerald-${uid})" />

        <!-- 4. STEP D (e.g. Swing to point) -->
        <g id="fc-node-d-${uid}">
          <rect x="25" y="386" width="290" height="38" rx="8" fill="#3b0764" stroke="#a855f7" stroke-width="1.8" />
          <text x="170" y="403" text-anchor="middle" font-size="10" font-weight="700" fill="#fdf4ff">${escapeXml(stepD.title)}</text>
          <text x="170" y="416" text-anchor="middle" font-size="8" fill="#d8b4fe">${escapeXml(stepD.sub || "sequential execution")} (${escapeXml(stepD.durStr || "")})</text>
        </g>
      </svg>
    `;
  }

  function generateRoutineFlowchartSvg() {
    if (!actions || actions.length === 0) {
      return `
        <div style="padding:40px 20px;text-align:center;color:#94a3b8;">
          <p style="margin-bottom:8px;font-size:0.9rem;">No actions in this routine yet.</p>
          <span style="font-size:0.75rem;">Click <strong>+ Add</strong> in the sidebar to build your path.</span>
        </div>`;
    }

    const poses = computePoses();
    const items = [];
    let i = 0;
    while (i < actions.length) {
      const cur = actions[i];
      if (cur.async && i < actions.length - 1) {
        const mPrec = getMultitaskPrecedence(cur, i, actions[i + 1], i + 1, poses);
        items.push({
          type: "parallel",
          actA: cur,
          idxA: i,
          actB: actions[i + 1],
          idxB: i + 1,
          mPrec
        });
        i += 2;
      } else {
        items.push({
          type: "single",
          act: cur,
          idx: i
        });
        i++;
      }
    }

    const rowH = 88;
    const totalH = 60 + items.length * rowH + 60;
    const w = 420;

    let svgRows = "";
    let curY = 60;

    // Start node
    svgRows += `
      <g>
        <rect x="145" y="12" width="130" height="30" rx="8" fill="#166534" stroke="#22c55e" stroke-width="1.5"/>
        <text x="210" y="27" text-anchor="middle" font-size="9.5" font-weight="800" fill="#dcfce7">ROUTINE START</text>
        <text x="210" y="37" text-anchor="middle" font-size="7.5" fill="#86efac">Init Chassis &amp; Sensors</text>
        <path d="M 210 42 L 210 60" stroke="#86efac" stroke-width="1.5" fill="none" marker-end="url(#fc-arr-emerald-all)"/>
      </g>
    `;

    items.forEach((item, itemIdx) => {
      const isLast = itemIdx === items.length - 1;
      const nextY = curY + rowH;

      if (item.type === "single") {
        const details = getActionDetails(item.act, item.idx);
        const isControl = item.act.type === "ifElse" || item.act.type === "loop";
        const strokeColor = isControl ? "#fbbf24" : (item.act.type === "custom" ? "#06b6d4" : item.act.type.startsWith("swing") ? "#a855f7" : "#3b82f6");
        const bgColor = isControl ? "#78350f" : (item.act.type === "custom" ? "#083344" : item.act.type.startsWith("swing") ? "#3b0764" : "#172554");
        svgRows += `
          <g>
            <rect x="85" y="${curY}" width="250" height="46" rx="8" fill="${bgColor}" stroke="${strokeColor}" stroke-width="1.8"/>
            <text x="210" y="${curY + 18}" text-anchor="middle" font-size="10" font-weight="700" fill="#f8fafc">${escapeXml(details.title)}</text>
            <text x="210" y="${curY + 32}" text-anchor="middle" font-size="8" fill="#94a3b8">${escapeXml(details.sub)} · ~${escapeXml(details.durStr)}</text>
            ${!isLast ? `<path d="M 210 ${curY + 46} L 210 ${nextY}" stroke="#94a3b8" stroke-width="1.8" fill="none" marker-end="url(#fc-arr-neutral-all)"/>` : ""}
          </g>
        `;
      } else {
        // Parallel pair (multitask)
        const detA = getActionDetails(item.actA, item.idxA);
        const detB = getActionDetails(item.actB, item.idxB);
        const precLabel = item.mPrec
          ? (item.mPrec.precedenceStep === "A"
              ? `🏆 Step ${item.idxA + 1} takes precedence (${item.mPrec.leadDur.toFixed(2)}s)`
              : (item.mPrec.precedenceStep === "B"
                  ? `🏆 Step ${item.idxB + 1} takes precedence (${item.mPrec.leadDur.toFixed(2)}s)`
                  : "🏆 Equal duration"))
          : "⚡ Parallel Multitask";

        svgRows += `
          <g>
            <!-- Parallel bracket / fork indicator -->
            <path d="M 210 ${curY - 14} C 210 ${curY - 4}, 110 ${curY - 4}, 110 ${curY}" stroke="#c084fc" stroke-width="1.8" fill="none" marker-end="url(#fc-arr-purple-all)"/>
            <path d="M 210 ${curY - 14} C 210 ${curY - 4}, 310 ${curY - 4}, 310 ${curY}" stroke="#60a5fa" stroke-width="1.8" stroke-dasharray="3,3" fill="none" marker-end="url(#fc-arr-blue-all)"/>
            <text x="210" y="${curY - 6}" text-anchor="middle" font-size="7" font-weight="700" fill="#c084fc">⚡ PARALLEL CONCURRENT ⚡</text>

            <!-- Left track card (Subsystem / Custom) -->
            <rect x="25" y="${curY}" width="170" height="46" rx="8" fill="#1e1b4b" stroke="#a855f7" stroke-width="1.8"/>
            <text x="110" y="${curY + 17}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fae8ff">${escapeXml(detA.title)}</text>
            <text x="110" y="${curY + 31}" text-anchor="middle" font-size="7.5" fill="#d8b4fe">${escapeXml(detA.sub)} · ${escapeXml(detA.durStr)}</text>

            <!-- Right track card (Chassis drive) -->
            <rect x="225" y="${curY}" width="170" height="46" rx="8" fill="#0f172a" stroke="#3b82f6" stroke-width="1.8"/>
            <text x="310" y="${curY + 17}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#eff6ff">${escapeXml(detB.title)}</text>
            <text x="310" y="${curY + 31}" text-anchor="middle" font-size="7.5" fill="#93c5fd">${escapeXml(detB.sub)} · ${escapeXml(detB.durStr)}</text>

            <!-- Precedence indicator pill in routine SVG -->
            <rect x="95" y="${curY + 50}" width="230" height="18" rx="5" fill="#1e1b4b" stroke="#a855f7" stroke-width="1"/>
            <text x="210" y="${curY + 62}" text-anchor="middle" font-size="7" font-weight="700" fill="#f0abfc">${escapeXml(precLabel)}</text>

            <!-- Re-join convergence -->
            <path d="M 110 ${curY + 46} C 110 ${curY + 68}, 210 ${curY + 68}, 210 ${nextY}" stroke="#34d399" stroke-width="1.8" fill="none" marker-end="url(#fc-arr-emerald-all)"/>
            <path d="M 310 ${curY + 46} C 310 ${curY + 68}, 210 ${curY + 68}, 210 ${nextY}" stroke="#34d399" stroke-width="1.8" fill="none"/>
          </g>
        `;
      }

      curY = nextY;
    });

    // End node
    svgRows += `
      <g>
        <rect x="145" y="${curY}" width="130" height="30" rx="8" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
        <text x="210" y="${curY + 16}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#f1f5f9">ROUTINE COMPLETE</text>
        <text x="210" y="${curY + 26}" text-anchor="middle" font-size="7.5" fill="#94a3b8">Chassis Stopped &amp; Stable</text>
      </g>
    `;

    return `
      <svg class="flowchart-svg" viewBox="0 0 ${w} ${totalH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Entire Routine Flowchart">
        <defs>
          <marker id="fc-arr-neutral-all" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#94a3b8"/>
          </marker>
          <marker id="fc-arr-purple-all" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#c084fc"/>
          </marker>
          <marker id="fc-arr-blue-all" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#60a5fa"/>
          </marker>
          <marker id="fc-arr-emerald-all" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#34d399"/>
          </marker>
        </defs>
        ${svgRows}
      </svg>
    `;
  }

  function renderFlowchartHtml(a, idx) {
    return `
      <div class="flowchart-panel">
        <div class="flowchart-header">
          <span class="flowchart-title">
            <span>⚡</span> Seamless Multitask Flowchart
          </span>
          <button type="button" class="btn-flowchart-expand" data-act="enlarge-flowchart" data-idx="${idx}" title="Enlarge seamless diagram in dialog">
            🔍 Enlarge
          </button>
        </div>
        <div class="flowchart-svg-wrap">
          ${generateMultitaskFlowchartSvg(a, idx, false)}
        </div>
      </div>
    `;
  }

  let toastTimer = null;
  function showToast(message) {
    const el = document.getElementById("toastNotification");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 3200);
  }

  function renderNestedActionCard(child, cIdx, parentAct, context = "loop", branch = "") {
    let childSummary = "";
    if (child.type === "moveToPoint") childSummary = `(${child.x}, ${child.y})`;
    else if (child.type === "moveToPose") childSummary = `(${child.x}, ${child.y}, ${child.theta}°)`;
    else if (child.type === "turnToPoint" || child.type === "swingToPoint") childSummary = `to (${child.x}, ${child.y})`;
    else if (child.type === "turnToHeading" || child.type === "swingToHeading") childSummary = `to ${child.theta}°`;
    else if (child.type === "wait") {
      const mode = child.waitType || "distance";
      if (mode === "distance") childSummary = `${child.distance != null ? child.distance : 12}" dist`;
      else if (mode === "done") childSummary = "until done";
      else if (mode === "time") childSummary = `${child.delayMs != null ? child.delayMs : 250}ms`;
    } else if (child.type === "custom") {
      const firstLine = (child.customCode || "").trim().split("\n")[0];
      childSummary = firstLine ? (firstLine.length > 20 ? firstLine.substring(0, 18) + "..." : firstLine) : "C++ Code";
    }

    const isSel = selectedId === child.id;
    const isIfElse = context === "ifelse";
    const branchCls = isIfElse ? (branch === "else" ? "ifelse-child-card is-else" : "ifelse-child-card is-then") : "loop-child-card";
    const cardCls = `action-card nested-child-card ${branchCls} ${isSel ? 'selected' : 'collapsed'}`;

    const parentAttrs = isIfElse
      ? `data-context="ifelse" data-if-id="${parentAct.id}" data-branch="${branch}" data-child-id="${child.id}"`
      : `data-context="loop" data-loop-id="${parentAct.id}" data-child-id="${child.id}"`;

    let childFields = "";
    if (child.type === "custom") {
      childFields = `
        <div style="margin-bottom:6px;">
          <textarea class="scratch-code-textarea" rows="2" data-child-f="customCode" ${parentAttrs} placeholder="e.g. intake.move(127);">${escapeHtml(child.customCode || '')}</textarea>
        </div>`;
    } else if (child.type === "wait") {
      const mode = child.waitType || "distance";
      childFields = `
        <div class="row" style="margin-bottom:4px;">
          <label>Wait Type
            <select data-child-f="waitType" ${parentAttrs}>
              <option value="distance" ${mode === "distance" ? "selected" : ""}>chassis.waitUntil(dist)</option>
              <option value="done" ${mode === "done" ? "selected" : ""}>chassis.waitUntilDone()</option>
              <option value="time" ${mode === "time" ? "selected" : ""}>pros::delay(ms)</option>
            </select>
          </label>
          ${mode === "distance" ? `
            <label>Distance (in)
              <input type="number" data-child-f="distance" step="0.5" value="${child.distance != null ? child.distance : 12}" ${parentAttrs}/>
            </label>` : ""}
          ${mode === "time" ? `
            <label>Delay (ms)
              <input type="number" data-child-f="delayMs" step="50" value="${child.delayMs != null ? child.delayMs : 250}" ${parentAttrs}/>
            </label>` : ""}
        </div>`;
    } else {
      const ptFields = needsPoint(child.type) ? `
        <label>X <input type="number" data-child-f="x" step="0.1" value="${child.x}" ${parentAttrs}/></label>
        <label>Y <input type="number" data-child-f="y" step="0.1" value="${child.y}" ${parentAttrs}/></label>` : "";
      const hdField = needsHeading(child.type) ? `
        <label>θ° <input type="number" data-child-f="theta" step="1" value="${child.theta}" ${parentAttrs}/></label>` : "";
      const sideField = needsSide(child.type) ? `
        <label>Side
          <select data-child-f="lockedSide" ${parentAttrs}>
            <option value="LEFT" ${child.lockedSide === "LEFT" ? "selected" : ""}>LEFT</option>
            <option value="RIGHT" ${child.lockedSide === "RIGHT" ? "selected" : ""}>RIGHT</option>
          </select>
        </label>` : "";
      const revToggle = isMove(child.type) ? `
        <div class="check-row" style="margin-top:4px;">
          <label class="reverse-toggle ${child.forwards === false ? "on" : ""}">
            <input type="checkbox" data-child-f="forwards" data-invert="1" ${child.forwards === false ? "checked" : ""} ${parentAttrs}/>
            Drive in reverse (forwards = false)
          </label>
        </div>` : "";

      childFields = `
        <div class="row">
          ${ptFields}
          ${hdField}
          ${sideField}
        </div>
        <div class="row" style="margin-top:4px;">
          <label>Timeout (ms)
            <input type="number" data-child-f="timeout" min="0" step="50" value="${child.timeout || 2000}" ${parentAttrs}/>
          </label>
          <label>Max Speed
            <input type="number" data-child-f="maxSpeed" min="0" max="127" step="1" value="${child.maxSpeed != null ? child.maxSpeed : 127}" ${parentAttrs}/>
          </label>
        </div>
        ${revToggle}`;
    }

    const upAct = isIfElse ? "ifelse-child-up" : "loop-child-up";
    const downAct = isIfElse ? "ifelse-child-down" : "loop-child-down";
    const delAct = isIfElse ? "ifelse-child-del" : "loop-child-del";
    const cardAttrs = isIfElse
      ? `data-nested-child-id="${child.id}" data-context="ifelse" data-if-id="${parentAct.id}" data-branch="${branch}"`
      : `data-nested-child-id="${child.id}" data-context="loop" data-loop-id="${parentAct.id}" data-loop-child-id="${child.id}"`;

    return `
      <div class="${cardCls}" ${cardAttrs} draggable="true">
        <div class="card-title">
          <span class="drag-handle" title="Drag to reorder or move between blocks" draggable="true">⠿</span>
          <span class="badge ${badgeClass(child.type)}" style="font-size:0.7rem;padding:2px 6px;">${cIdx + 1}. ${child.type}</span>
          ${childSummary ? `<span class="collapsed-summary-badge" style="font-size:0.68rem;">${escapeHtml(childSummary)}</span>` : ""}
          ${child.forwards === false ? '<span class="badge reverse" style="font-size:0.65rem;padding:1px 4px;">REV</span>' : ""}
          <div style="margin-left:auto;display:flex;align-items:center;gap:3px">
            <button type="button" class="icon" data-act="${upAct}" ${parentAttrs} title="Move up">↑</button>
            <button type="button" class="icon" data-act="${downAct}" ${parentAttrs} title="Move down">↓</button>
            <button type="button" class="icon" data-act="${delAct}" ${parentAttrs} title="Delete nested block">×</button>
          </div>
        </div>
        <div class="card-body">
          ${childFields}
        </div>
      </div>`;
  }

  function renderChildActionCard(child, cIdx, parentLoop) {
    return renderNestedActionCard(child, cIdx, parentLoop, "loop");
  }

  function renderFlow() {
    actionFlow.innerHTML = "";
    const poses = computePoses();

    const countEl = document.getElementById("tabActionCount");
    if (countEl) countEl.textContent = String(actions.length);

    // Top LemLib Bot Specs & PID summary banner in block interface
    const botBanner = document.createElement("div");
    botBanner.className = "action-flow-bot-banner";
    botBanner.style.cssText = "margin-bottom:12px;background:rgba(15,23,42,0.92);border:1px solid #1e293b;border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;";
    botBanner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.1rem;">🤖</span>
        <div style="display:flex;flex-direction:column;">
          <span style="font-size:0.75rem;font-weight:700;color:#f1f5f9;">LemLib Drivetrain: ${bot.trackWidth || 12}" Track · ${bot.wheelDiam || 3.25}" Wheels · ${bot.driveRpm || 600} RPM</span>
          <span style="font-size:0.68rem;color:#94a3b8;">Lateral PID: (${bot.lateralKp || 8}, ${bot.lateralKi || 0}, ${bot.lateralKd || 30}) · Angular PID: (${bot.angularKp || 2}, ${bot.angularKi || 0}, ${bot.angularKd || 10})</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button type="button" class="btn-xs-clean" id="btnQuickTunePidFromFlow" style="font-size:0.68rem;color:#38bdf8;border-color:rgba(56,189,248,0.3);cursor:pointer;">🎛️ Tune PID</button>
        <button type="button" class="btn-xs-clean" id="btnQuickConfigBotFromFlow" style="font-size:0.68rem;cursor:pointer;">⚙️ Bot Specs</button>
      </div>
    `;
    const tuneBtn = botBanner.querySelector("#btnQuickTunePidFromFlow");
    if (tuneBtn) {
      tuneBtn.addEventListener("click", () => {
        const modal = document.getElementById("pidModal");
        if (modal) {
          modal.hidden = false;
          modal.classList.add("open");
        }
      });
    }
    const specsBtn = botBanner.querySelector("#btnQuickConfigBotFromFlow");
    if (specsBtn) {
      specsBtn.addEventListener("click", () => {
        const tabBot = document.getElementById("tabBtnBot");
        if (tabBot) tabBot.click();
      });
    }
    actionFlow.appendChild(botBanner);

    // Routine Hat Cap Block ("when autonomous starts")
    const activePathObj = paths.find(p => p.id === activePathId) || paths[0];
    const hatBlock = document.createElement("div");
    hatBlock.className = "hat-block";
    const routineOptionsHtml = paths.map((p) => `<option value="${p.id}" ${p.id === activePathId ? "selected" : ""}>auton_${p.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}()</option>`).join("");
    hatBlock.innerHTML = `
      <div class="hat-title">
        <span style="font-size:1.2rem;">🚩</span>
        <span>when autonomous</span>
        <select class="hat-select" id="hatRoutineSelect">${routineOptionsHtml}</select>
        <span>starts</span>
      </div>
      <div style="font-size:0.72rem;font-weight:700;background:rgba(0,0,0,0.35);padding:3px 10px;border-radius:12px;border:1px solid rgba(255,255,255,0.25);">
        ${actions.length} ${actions.length === 1 ? 'block' : 'blocks'}
      </div>
    `;
    const hatSelect = hatBlock.querySelector("#hatRoutineSelect");
    if (hatSelect) {
      hatSelect.addEventListener("change", (e) => {
        activePathId = e.target.value;
        bindActive();
        syncPathSelect();
        renderFlow();
        draw();
        generateCode();
      });
    }
    actionFlow.appendChild(hatBlock);

    actions.forEach((a, idx) => {
      const block = document.createElement("div");
      block.className = "action-block";
      const fromPose = poses[idx] || { x: pose.x, y: pose.y, theta: pose.theta };
      const nextAct = idx < actions.length - 1 ? actions[idx + 1] : null;

      // Multitask precedence for connector & card
      let mPrecConn = null;
      let mPrecCard = null;

      if (idx > 0) {
        const prev = actions[idx - 1];
        const conn = document.createElement("div");
        if (prev && prev.async) {
          mPrecConn = getMultitaskPrecedence(prev, idx - 1, a, idx, poses);
          const precTag = mPrecConn
            ? (mPrecConn.precedenceStep === "A"
                ? `⚡ Step ${idx} (${mPrecConn.nameA}) takes precedence (+${mPrecConn.diff.toFixed(2)}s)`
                : (mPrecConn.precedenceStep === "B"
                    ? `⚡ Step ${idx + 1} (${mPrecConn.nameB}) takes precedence (+${mPrecConn.diff.toFixed(2)}s)`
                    : `⚡ Equal duration (${mPrecConn.durA.toFixed(2)}s)`))
            : "MULTITASKING (RUNS CONCURRENTLY)";

          conn.className = "connector multitask-connector";
          conn.innerHTML = `
            <div class="multitask-connector-bar"></div>
            <div class="multitask-connector-pill" title="${mPrecConn ? escapeHtml(mPrecConn.summary) : 'Concurrent Multitask Execution'}">
              <span>⚡</span> ${escapeHtml(precTag)} <span>⚡</span>
            </div>
            <div class="multitask-connector-bar"></div>`;
        } else {
          conn.className = "connector";
          conn.textContent = "▼";
        }
        block.appendChild(conn);
      }

      if (a.async && nextAct) {
        mPrecCard = getMultitaskPrecedence(a, idx, nextAct, idx + 1, poses);
      }

      let catClass = "cat-motion";
      if (a.type === "bezierCurve") catClass = "cat-bezier";
      else if (a.type === "moveToPoint" || a.type === "moveToPose") catClass = "cat-motion";
      else if (a.type === "turnToPoint" || a.type === "turnToHeading" || a.type === "swingToPoint" || a.type === "swingToHeading") catClass = "cat-turn";
      else if (a.type === "wait" || a.type === "ifElse" || a.type === "loop") catClass = "cat-control";
      else if (a.type === "custom") {
        if (/clamp|intake|conveyor|flywheel|piston|motor/i.test(a.customCode || "")) catClass = "cat-subsystem";
        else catClass = "cat-custom";
      }

      const card = document.createElement("div");
      card.className =
        `action-card block-card ${catClass}` +
        (a.id === selectedId ? " selected" : " collapsed") +
        (a.type === "custom" ? " custom-type" : "") +
        (a.type === "ifElse" ? " if-else-card" : "") +
        (a.type === "loop" ? " loop-card" : "") +
        (a.async ? " multitask-active" : "");
      card.dataset.id = a.id;

      let body = "";
      if (a.type === "ifElse") {
        const isElseSim = a.activeSimBranch === "else";
        if (!Array.isArray(a.thenChildren)) {
          if (a.thenAction) {
            a.thenChildren = [{ ...a.thenAction, id: a.thenAction.id || uid() }];
          } else if (a.thenCode) {
            a.thenChildren = [{ id: uid(), type: "custom", customCode: a.thenCode, label: a.thenLabel || "" }];
          } else {
            a.thenChildren = [];
          }
        }
        if (!Array.isArray(a.elseChildren)) {
          if (a.elseAction) {
            a.elseChildren = [{ ...a.elseAction, id: a.elseAction.id || uid() }];
          } else if (a.elseCode) {
            a.elseChildren = [{ id: uid(), type: "custom", customCode: a.elseCode, label: a.elseLabel || "" }];
          } else {
            a.elseChildren = [];
          }
        }

        const condExpr = (a.condition || "true").trim();
        const matchedCond = conditions.find((c) => c.name === condExpr);
        const matchedNegCond = condExpr.startsWith("!") ? conditions.find((c) => c.name === condExpr.slice(1).trim()) : null;
        const currentEval = evaluateConditionExpression(condExpr);

        let liveBadgeHtml = "";
        if (matchedCond) {
          liveBadgeHtml = `
            <span class="scratch-cond-live-badge ${matchedCond.value ? 'is-true' : 'is-false'}" data-act="toggle-cond-badge" data-var="${escapeHtml(matchedCond.name)}" title="Variable '${matchedCond.name}' = ${matchedCond.value}. Click to toggle truth value.">
              ${matchedCond.value ? '🟢 true' : '⚪ false'}
            </span>
          `;
        } else if (matchedNegCond) {
          liveBadgeHtml = `
            <span class="scratch-cond-live-badge ${!matchedNegCond.value ? 'is-true' : 'is-false'}" data-act="toggle-cond-badge" data-var="${escapeHtml(matchedNegCond.name)}" title="Variable '${matchedNegCond.name}' = ${matchedNegCond.value} (Inverted). Click to toggle.">
              ${!matchedNegCond.value ? '🟢 true' : '⚪ false'}
            </span>
          `;
        }

        // Build options for condition dropdown
        const condOptionsHtml = conditions.map((c) => {
          const isSel = condExpr === c.name;
          return `<option value="${escapeHtml(c.name)}" ${isSel ? 'selected' : ''}>${c.name} (${c.value ? 'true' : 'false'})</option>`;
        }).join("");

        // Build dynamic preset chips from condition variables
        const condChipsHtml = [
          `<button type="button" class="cond-chip ${(condExpr === 'true') ? 'active' : ''}" data-act="set-condition" data-cond="true">true</button>`,
          ...conditions.slice(0, 6).map((c) => {
            const isChipActive = condExpr === c.name;
            return `<button type="button" class="cond-chip ${isChipActive ? 'active' : ''}" data-act="set-condition" data-cond="${escapeHtml(c.name)}" title="${escapeHtml(c.description || c.name)}">${c.value ? '🟢' : '⚪'} ${escapeHtml(c.name)}</button>`;
          })
        ].join("");

        body = `
          <div class="scratch-if-container">
            <div class="scratch-if-header">
              <span class="scratch-keyword">if</span>
              <div class="scratch-condition-slot" title="C++ boolean condition expression">
                <span class="scratch-hex-point">◀</span>
                <input type="text" data-f="condition" class="scratch-condition-input" value="${escapeHtml(a.condition || 'true')}" placeholder="isGoalLoaded, true, etc." />
                <span class="scratch-hex-point">▶</span>
              </div>
              <div class="scratch-condition-select-wrap">
                <select class="scratch-condition-select" data-act="select-cond-var" title="Select defined variable from Condition Manager">
                  <option value="">⚙️ Variables ▾</option>
                  <optgroup label="Defined Conditions">
                    ${condOptionsHtml}
                  </optgroup>
                  <optgroup label="Common Expressions">
                    <option value="true">true</option>
                    <option value="false">false</option>
                    <option value="!isGoalLoaded">!isGoalLoaded</option>
                    <option value="dist < 10">dist &lt; 10</option>
                  </optgroup>
                  <option value="__open_mgr__">🔀 Manage in Sidebar...</option>
                </select>
              </div>
              ${liveBadgeHtml}
              <span class="scratch-keyword">then</span>
              <div class="scratch-sim-toggle" title="Select which conditional branch simulates on the 2D field">
                <span class="scratch-sim-label">Simulate:</span>
                <button type="button" class="scratch-sim-btn ${!isElseSim ? 'active' : ''}" data-act="set-sim-branch" data-branch="then">✓ Then (${a.thenChildren.length})</button>
                <button type="button" class="scratch-sim-btn ${isElseSim ? 'active' : ''}" data-act="set-sim-branch" data-branch="else">Else (${a.elseChildren.length})</button>
              </div>
              <button type="button" class="btn-scratch-cond-mgr" data-act="goto-cond-mgr" title="Open Condition Manager in sidebar">🔀 Conditions</button>
            </div>
            <div class="scratch-cond-presets">
              <span class="scratch-preset-lbl">Variables:</span>
              ${condChipsHtml}
              <button type="button" class="btn-cond-action" data-act="goto-cond-mgr" style="margin-left:auto;font-size:0.65rem;">+ Manage</button>
            </div>

            <!-- THEN ARM (If true...) -->
            <div class="scratch-c-arm ifelse-c-arm ifelse-then-arm" data-if-id="${a.id}" data-branch="then">
              <div class="scratch-branch-header then-header">
                <span class="scratch-branch-badge">🟢 If true:</span>
                <input type="text" data-f="thenLabel" class="scratch-branch-title-input" value="${escapeHtml(a.thenLabel || 'Move forward')}" placeholder="Move forward" />
                <span style="margin-left:auto;font-size:0.75rem;color:#6ee7b7;font-weight:700;">${a.thenChildren.length} ${a.thenChildren.length === 1 ? 'block' : 'blocks'}</span>
              </div>
              <div class="ifelse-children-container" data-if-id="${a.id}" data-branch="then">
                ${a.thenChildren.map((child, cIdx) => renderNestedActionCard(child, cIdx, a, "ifelse", "then")).join("")}
              </div>
              ${a.thenChildren.length === 0 ? `
                <div class="loop-empty-drop-zone ifelse-empty-drop-zone then-zone" data-if-id="${a.id}" data-branch="then">
                  <span class="loop-drop-icon">📥</span>
                  <span>No blocks in Then branch.<br><strong>Drag blocks here</strong> or use the buttons below.</span>
                </div>
              ` : `
                <div class="loop-drop-target ifelse-drop-target then-target" data-if-id="${a.id}" data-branch="then">
                  ➕ Drop block here to append to Then branch
                </div>
              `}
              <div class="loop-add-toolbar">
                <span style="font-size:0.72rem;font-weight:700;color:#10b981;margin-right:2px;">Add Block:</span>
                <button type="button" class="btn-ifelse-add-quick then-btn" data-act="ifelse-add" data-if-id="${a.id}" data-branch="then" data-type="moveToPoint">+ Move Point</button>
                <button type="button" class="btn-ifelse-add-quick then-btn" data-act="ifelse-add" data-if-id="${a.id}" data-branch="then" data-type="turnToHeading">+ Turn Heading</button>
                <button type="button" class="btn-ifelse-add-quick then-btn" data-act="ifelse-add" data-if-id="${a.id}" data-branch="then" data-type="wait">+ Wait</button>
                <button type="button" class="btn-ifelse-add-quick then-btn" data-act="ifelse-add" data-if-id="${a.id}" data-branch="then" data-type="custom">+ Custom C++</button>
                <select class="ifelse-add-more-select then-select" data-act="ifelse-add-select" data-if-id="${a.id}" data-branch="then">
                  <option value="">+ More Actions...</option>
                  <option value="moveToPose">Move to Pose (Boomerang)</option>
                  <option value="turnToPoint">Turn to Point</option>
                  <option value="swingToPoint">Swing to Point</option>
                  <option value="swingToHeading">Swing to Heading</option>
                </select>
              </div>
            </div>

            <!-- ELSE DIVIDER BAR -->
            <div class="scratch-else-bar">
              <span class="scratch-keyword">else</span>
            </div>

            <!-- ELSE ARM (Else...) -->
            <div class="scratch-c-arm ifelse-c-arm ifelse-else-arm" data-if-id="${a.id}" data-branch="else">
              <div class="scratch-branch-header else-header">
                <span class="scratch-branch-badge">🟠 Else:</span>
                <input type="text" data-f="elseLabel" class="scratch-branch-title-input" value="${escapeHtml(a.elseLabel || 'Move backwards')}" placeholder="Move backwards" />
                <span style="margin-left:auto;font-size:0.75rem;color:#fdba74;font-weight:700;">${a.elseChildren.length} ${a.elseChildren.length === 1 ? 'block' : 'blocks'}</span>
              </div>
              <div class="ifelse-children-container" data-if-id="${a.id}" data-branch="else">
                ${a.elseChildren.map((child, cIdx) => renderNestedActionCard(child, cIdx, a, "ifelse", "else")).join("")}
              </div>
              ${a.elseChildren.length === 0 ? `
                <div class="loop-empty-drop-zone ifelse-empty-drop-zone else-zone" data-if-id="${a.id}" data-branch="else">
                  <span class="loop-drop-icon">📥</span>
                  <span>No blocks in Else branch.<br><strong>Drag blocks here</strong> or use the buttons below.</span>
                </div>
              ` : `
                <div class="loop-drop-target ifelse-drop-target else-target" data-if-id="${a.id}" data-branch="else">
                  ➕ Drop block here to append to Else branch
                </div>
              `}
              <div class="loop-add-toolbar">
                <span style="font-size:0.72rem;font-weight:700;color:#f97316;margin-right:2px;">Add Block:</span>
                <button type="button" class="btn-ifelse-add-quick else-btn" data-act="ifelse-add" data-if-id="${a.id}" data-branch="else" data-type="moveToPoint">+ Move Point</button>
                <button type="button" class="btn-ifelse-add-quick else-btn" data-act="ifelse-add" data-if-id="${a.id}" data-branch="else" data-type="turnToHeading">+ Turn Heading</button>
                <button type="button" class="btn-ifelse-add-quick else-btn" data-act="ifelse-add" data-if-id="${a.id}" data-branch="else" data-type="wait">+ Wait</button>
                <button type="button" class="btn-ifelse-add-quick else-btn" data-act="ifelse-add" data-if-id="${a.id}" data-branch="else" data-type="custom">+ Custom C++</button>
                <select class="ifelse-add-more-select else-select" data-act="ifelse-add-select" data-if-id="${a.id}" data-branch="else">
                  <option value="">+ More Actions...</option>
                  <option value="moveToPose">Move to Pose (Boomerang)</option>
                  <option value="turnToPoint">Turn to Point</option>
                  <option value="swingToPoint">Swing to Point</option>
                  <option value="swingToHeading">Swing to Heading</option>
                </select>
              </div>
            </div>

            <div class="scratch-block-cap"></div>
          </div>
          <div class="move-comment-row">
            <label class="move-comment-label">
              <span class="move-comment-header">
                <span class="move-comment-tag">💬 Decision Comment (C++ code)</span>
                <span class="move-comment-preview">${a.label ? `// ${escapeHtml(cleanCommentText(a.label))}` : "e.g. // alliance decision"}</span>
              </span>
              <input type="text" data-f="label" class="move-comment-input" value="${escapeHtml(a.label || '')}" placeholder="e.g. alliance color check or stake decision"/>
            </label>
          </div>`;
      } else if (a.type === "loop") {
        const mode = a.loopMode || "until";
        if (!Array.isArray(a.children)) {
          if (a.loopAction) {
            a.children = [{ ...a.loopAction, id: a.loopAction.id || uid() }];
          } else if (a.loopCode) {
            a.children = [{ id: uid(), type: "custom", customCode: a.loopCode, label: a.loopLabel || "" }];
          } else {
            a.children = [];
          }
        }
        body = `
          <div class="scratch-loop-container">
            <div class="scratch-loop-header">
              <span class="scratch-keyword">loop</span>
              <select data-f="loopMode" class="scratch-loop-mode-select">
                <option value="until" ${mode === "until" ? "selected" : ""}>until</option>
                <option value="for" ${mode === "for" ? "selected" : ""}>for n times</option>
                <option value="forever" ${mode === "forever" ? "selected" : ""}>forever</option>
              </select>

              ${mode === "until" ? `
              <div class="scratch-condition-slot" title="C++ boolean expression condition to stop the loop when true">
                <span class="scratch-hex-point">◀</span>
                <input type="text" data-f="condition" class="scratch-condition-input" value="${escapeHtml(a.condition || '!limit_switch.get_value()')}" placeholder="!limit_switch.get_value()" />
                <span class="scratch-hex-point">▶</span>
              </div>
              ` : ""}

              ${mode === "for" ? `
              <div class="scratch-times-slot" title="Number of iterations for the loop">
                <input type="number" data-f="times" class="scratch-times-input" value="${a.times != null ? a.times : 5}" min="1" step="1" />
                <span class="scratch-times-suffix">times</span>
              </div>
              ` : ""}

              ${mode === "forever" ? `
              <span class="scratch-loop-infinite-label">(infinite 🔄)</span>
              ` : ""}
            </div>

            ${mode === "until" ? `
            <div class="scratch-cond-presets">
              <span class="scratch-preset-lbl">Presets:</span>
              <button type="button" class="cond-chip ${a.condition === '!limit_switch.get_value()' ? 'active' : ''}" data-act="set-loop-cond" data-cond="!limit_switch.get_value()">!limit_switch.get_value()</button>
              <button type="button" class="cond-chip ${a.condition === 'sonar.distance(inches) < 10' ? 'active' : ''}" data-act="set-loop-cond" data-cond="sonar.distance(inches) < 10">sonar &lt; 10"</button>
              <button type="button" class="cond-chip ${a.condition === 'optical.get_hue() > 200' ? 'active' : ''}" data-act="set-loop-cond" data-cond="optical.get_hue() > 200">hue &gt; 200</button>
            </div>
            ` : ""}

            <!-- LOOP BODY ARM -->
            <div class="scratch-c-arm loop-c-arm" data-loop-id="${a.id}">
              <div class="scratch-branch-header loop-header">
                <span class="scratch-branch-badge">🔄 Repeat Body:</span>
                <input type="text" data-f="loopLabel" class="scratch-branch-title-input" value="${escapeHtml(a.loopLabel || 'Move forward')}" placeholder="Move forward" />
                <span style="margin-left:auto;font-size:0.75rem;color:#fed7aa;font-weight:700;">${a.children.length} ${a.children.length === 1 ? 'block' : 'blocks'}</span>
              </div>
              <div class="loop-children-container" data-loop-id="${a.id}">
                ${a.children.map((child, cIdx) => renderChildActionCard(child, cIdx, a)).join("")}
              </div>
              ${a.children.length === 0 ? `
                <div class="loop-empty-drop-zone" data-loop-id="${a.id}">
                  <span class="loop-drop-icon">📥</span>
                  <span>No blocks in loop yet.<br><strong>Drag blocks here</strong> or use the buttons below to add blocks.</span>
                </div>
              ` : `
                <div class="loop-drop-target" data-loop-id="${a.id}">
                  ➕ Drop block here to append to loop
                </div>
              `}
              <div class="loop-add-toolbar">
                <span style="font-size:0.72rem;font-weight:700;color:#f97316;margin-right:2px;">Add Block:</span>
                <button type="button" class="btn-loop-add-quick" data-act="loop-add" data-loop-id="${a.id}" data-type="moveToPoint">+ Move Point</button>
                <button type="button" class="btn-loop-add-quick" data-act="loop-add" data-loop-id="${a.id}" data-type="turnToHeading">+ Turn Heading</button>
                <button type="button" class="btn-loop-add-quick" data-act="loop-add" data-loop-id="${a.id}" data-type="wait">+ Wait</button>
                <button type="button" class="btn-loop-add-quick" data-act="loop-add" data-loop-id="${a.id}" data-type="custom">+ Custom C++</button>
                <select class="loop-add-more-select" data-act="loop-add-select" data-loop-id="${a.id}">
                  <option value="">+ More Actions...</option>
                  <option value="moveToPose">Move to Pose (Boomerang)</option>
                  <option value="turnToPoint">Turn to Point</option>
                  <option value="swingToPoint">Swing to Point</option>
                  <option value="swingToHeading">Swing to Heading</option>
                </select>
              </div>
            </div>

            <div class="scratch-block-cap"></div>
          </div>
          <div class="move-comment-row">
            <label class="move-comment-label">
              <span class="move-comment-header">
                <span class="move-comment-tag">💬 Loop Comment (C++ code)</span>
                <span class="move-comment-preview">${a.label ? `// ${escapeHtml(cleanCommentText(a.label))}` : "e.g. // wait until limit switch triggered"}</span>
              </span>
              <input type="text" data-f="label" class="move-comment-input" value="${escapeHtml(a.label || '')}" placeholder="e.g. sensor wait loop"/>
            </label>
          </div>`;
      } else if (a.type === "wait") {
        const mode = a.waitType || "distance";
        const distVal = a.distance != null ? a.distance : 12;
        const delayVal = a.delayMs != null ? a.delayMs : 250;

        let paramSection = "";
        if (mode === "distance") {
          paramSection = `
            <div class="wait-param-row">
              <label>Trigger at distance along motion:
                <input type="number" data-f="distance" min="0.5" max="144" step="0.5" value="${distVal}" />
                <span class="calc-sub-hint">inches (chassis.waitUntil)</span>
              </label>
              <div class="wait-chips-row">
                <span style="font-size:0.68rem;color:#64748b;">Presets:</span>
                <button type="button" class="wait-chip ${distVal === 6 ? 'active' : ''}" data-act="set-wait-dist" data-dist="6">6"</button>
                <button type="button" class="wait-chip ${distVal === 12 ? 'active' : ''}" data-act="set-wait-dist" data-dist="12">12" (Default)</button>
                <button type="button" class="wait-chip ${distVal === 18 ? 'active' : ''}" data-act="set-wait-dist" data-dist="18">18"</button>
                <button type="button" class="wait-chip ${distVal === 24 ? 'active' : ''}" data-act="set-wait-dist" data-dist="24">24"</button>
                <button type="button" class="wait-chip ${distVal === 36 ? 'active' : ''}" data-act="set-wait-dist" data-dist="36">36"</button>
              </div>
              <div class="wait-hint-box">
                💡 <strong>chassis.waitUntil(${distVal})</strong> triggers concurrent subsystem actions (e.g. clamp goal, spin intake) when the robot has travelled ${distVal}" into its movement, without interrupting chassis drive momentum.
              </div>
            </div>`;
        } else if (mode === "done") {
          paramSection = `
            <div class="wait-param-row">
              <div class="wait-hint-box">
                ⏳ <strong>chassis.waitUntilDone()</strong> blocks execution until the preceding async movement has fully settled within tolerance before proceeding to the next step.
              </div>
            </div>`;
        } else if (mode === "time") {
          paramSection = `
            <div class="wait-param-row">
              <label>Delay duration:
                <input type="number" data-f="delayMs" min="10" max="15000" step="25" value="${delayVal}" />
                <span class="calc-sub-hint">ms (pros::delay)</span>
              </label>
              <div class="wait-chips-row">
                <span style="font-size:0.68rem;color:#64748b;">Presets:</span>
                <button type="button" class="wait-chip ${delayVal === 100 ? 'active' : ''}" data-act="set-wait-delay" data-ms="100">100ms</button>
                <button type="button" class="wait-chip ${delayVal === 250 ? 'active' : ''}" data-act="set-wait-delay" data-ms="250">250ms</button>
                <button type="button" class="wait-chip ${delayVal === 500 ? 'active' : ''}" data-act="set-wait-delay" data-ms="500">500ms</button>
                <button type="button" class="wait-chip ${delayVal === 1000 ? 'active' : ''}" data-act="set-wait-delay" data-ms="1000">1.0s</button>
              </div>
              <div class="wait-hint-box">
                ⏱️ <strong>pros::delay(${delayVal})</strong> pauses the current execution thread for ${delayVal} milliseconds.
              </div>
            </div>`;
        }

        body = `
          <div class="wait-mode-selector">
            <button type="button" class="wait-mode-btn ${mode === 'distance' ? 'active' : ''}" data-act="set-wait-mode" data-mode="distance">📏 Distance (${distVal}")</button>
            <button type="button" class="wait-mode-btn ${mode === 'done' ? 'active' : ''}" data-act="set-wait-mode" data-mode="done">⏳ Wait Until Done</button>
            <button type="button" class="wait-mode-btn ${mode === 'time' ? 'active' : ''}" data-act="set-wait-mode" data-mode="time">⏱️ PROS Delay (${delayVal}ms)</button>
          </div>
          ${paramSection}
          <label class="wide" style="margin-top:8px;">Subsystem Action Code (optional, runs at trigger event)
            <textarea data-f="customCode" rows="2" placeholder="// e.g. clamp.set_value(true); or intake.move(127);">${escapeHtml(a.customCode || '')}</textarea>
          </label>
          <div class="multitask-presets-row">
            <span style="font-size:0.68rem;color:#94a3b8;align-self:center;">Snippets:</span>
            <button type="button" class="snippet-chip" data-snip="clamp.set_value(true);">🦾 Clamp Goal</button>
            <button type="button" class="snippet-chip" data-snip="clamp.set_value(false);">🔓 Release Clamp</button>
            <button type="button" class="snippet-chip" data-snip="intake.move(127);">⚡ Intake On</button>
            <button type="button" class="snippet-chip" data-snip="intake.move(0);">🛑 Intake Off</button>
          </div>
          <div class="move-comment-row">
            <label class="move-comment-label">
              <span class="move-comment-header">
                <span class="move-comment-tag">💬 Event Comment</span>
                <span class="move-comment-preview">${a.label ? `// ${escapeHtml(cleanCommentText(a.label))}` : "e.g. // clamp mogo at 12 inches"}</span>
              </span>
              <input type="text" data-f="label" class="move-comment-input" value="${escapeHtml(a.label || '')}" placeholder="e.g. clamp mogo at 12 inches into drive"/>
            </label>
          </div>`;
      } else if (a.type === "custom") {
        const durVal = a.customDuration != null ? Number(a.customDuration) : 0;
        const detectedIf = window.CppTranslator && typeof window.CppTranslator.parseIfElseFromCode === "function"
          ? window.CppTranslator.parseIfElseFromCode(a.customCode, bot.defaultMaxSpeed || 127, bot.defaultMinSpeed || 0)
          : null;
        body = `
          ${detectedIf ? `
          <div class="custom-if-detected-banner" id="banner-if-detect-${idx}">
            <div class="if-detected-info">
              <span class="if-detected-icon">✨</span>
              <div class="if-detected-text">
                <div class="if-detected-title-row">
                  <span class="if-detected-title">Detected C++ If-Else Loop!</span>
                  <span class="if-detected-cond-badge">if (${escapeHtml(detectedIf.condition)})</span>
                </div>
                <div class="if-detected-branches">
                  <span class="if-detected-branch-item">🟢 Then: <strong>${escapeHtml(detectedIf.thenLabel)}</strong></span>
                  <span class="if-detected-branch-item">🟠 Else: <strong>${escapeHtml(detectedIf.elseLabel)}</strong></span>
                </div>
              </div>
            </div>
            <button type="button" class="btn-convert-to-scratch" data-act="convert-custom-to-if" data-idx="${idx}" title="Convert this custom code block into a visual Scratch If-Else block">
              ⚡ Convert to Scratch Block
            </button>
          </div>` : ""}
          <label class="wide">Custom C++ (injected as-is)
            <textarea data-f="customCode" rows="3" placeholder="// e.g. intake.move(127); or if (isRed) { ... }">${escapeHtml(a.customCode)}</textarea>
          </label>
          <div class="multitask-presets-row">
            <span style="font-size:0.68rem;color:#94a3b8;align-self:center;">Snippets:</span>
            <button type="button" class="snippet-chip" data-snip="intake.move(127);">⚡ Intake On</button>
            <button type="button" class="snippet-chip" data-snip="intake.move(0);">🛑 Intake Off</button>
            <button type="button" class="snippet-chip" data-snip="clamp.set_value(true);">🦾 Clamp</button>
            <button type="button" class="snippet-chip" data-snip="if (isRed) {\n  chassis.moveToPoint(24, 24, 2000);\n} else {\n  chassis.moveToPoint(-24, -24, 2000, {.forwards = false});\n}">🔀 If-Else Loop</button>
            <button type="button" class="snippet-chip" data-snip="isRed ? chassis.moveToPoint(24, 24, 2000) : chassis.moveToPoint(-24, -24, 2000);">⚡ Ternary (? :)</button>
            <button type="button" class="snippet-chip" data-snip="chassis.waitUntil(12);">⏱️ Wait 12"</button>
            <button type="button" class="snippet-chip" data-snip="chassis.waitUntilDone();">⏳ Wait Done</button>
          </div>
          <div class="custom-duration-row">
            <div class="custom-duration-header">
              <span class="custom-duration-label">
                ⏱️ Estimated Time to Complete
                <span class="custom-duration-hint">(0s = Instant / Continuous background, e.g. spinning intake)</span>
              </span>
              <span class="custom-duration-badge ${durVal > 0 ? "has-duration" : "instant"}">
                ${durVal > 0 ? `${durVal.toFixed(2)}s Duration` : "0s · Instant (Spin Intake)"}
              </span>
            </div>
            <div class="custom-duration-input-wrap">
              <label class="custom-duration-input-label">
                <span>Duration:</span>
                <input type="number" data-f="customDuration" min="0" max="60" step="0.05" value="${durVal}" />
                <span class="custom-duration-unit">sec</span>
              </label>
              <div class="custom-duration-presets">
                <button type="button" class="btn-dur-preset ${durVal === 0 ? "active" : ""}" data-act="set-dur" data-dur="0" title="0s means non-blocking / instant (e.g. spinning intake)">⚡ 0s (Spin Intake)</button>
                <button type="button" class="btn-dur-preset ${durVal === 0.2 ? "active" : ""}" data-act="set-dur" data-dur="0.2">0.2s</button>
                <button type="button" class="btn-dur-preset ${durVal === 0.5 ? "active" : ""}" data-act="set-dur" data-dur="0.5">0.5s</button>
                <button type="button" class="btn-dur-preset ${durVal === 1.0 ? "active" : ""}" data-act="set-dur" data-dur="1.0">1.0s</button>
                <button type="button" class="btn-dur-preset ${durVal === 2.0 ? "active" : ""}" data-act="set-dur" data-dur="2.0">2.0s</button>
              </div>
            </div>
          </div>
          ${mPrecCard ? `
          <div class="multitask-precedence-box">
            <div class="m-prec-header">
              <span class="m-prec-title">🏆 Multitask Precedence &amp; Timing</span>
              <span class="m-prec-tag ${mPrecCard.precedenceStep === "A" ? "tag-self" : "tag-other"}">
                ${mPrecCard.precedenceStep === "A" ? "THIS ACTION TAKES PRECEDENCE" : (mPrecCard.precedenceStep === "B" ? "NEXT ACTION TAKES PRECEDENCE" : "EQUAL PRECEDENCE")}
              </span>
            </div>
            <div class="m-prec-body">
              <div class="m-prec-grid">
                <div class="m-prec-col self">
                  <span class="m-col-lbl">Step ${idx + 1} (${escapeHtml(mPrecCard.nameA)}):</span>
                  <span class="m-col-val">${mPrecCard.durA === 0 ? "0.00s (Instant)" : `${mPrecCard.durA.toFixed(2)}s`}</span>
                </div>
                <span class="m-prec-vs">vs</span>
                <div class="m-prec-col other">
                  <span class="m-col-lbl">Step ${idx + 2} (${escapeHtml(mPrecCard.nameB)}):</span>
                  <span class="m-col-val">${mPrecCard.durB === 0 ? "0.00s (Instant)" : `${mPrecCard.durB.toFixed(2)}s`}</span>
                </div>
              </div>
              <div class="m-prec-summary">${escapeHtml(mPrecCard.summary)}</div>
            </div>
          </div>` : ""}
          <div class="multitask-panel ${a.async ? "on" : ""}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <label class="multitask-toggle-label">
                <input type="checkbox" data-f="async" ${a.async ? "checked" : ""}/>
                <span class="multitask-indicator">⚡</span>
                <span class="multitask-text-col">
                  <span class="multitask-title">Multitask / Async (Non-blocking)</span>
                  <span class="multitask-sub">Runs concurrently in the background</span>
                </span>
                <span class="multitask-pill ${a.async ? "active" : ""}">${a.async ? "PARALLEL" : "BLOCKING"}</span>
              </label>
              <button type="button" class="btn-flowchart-toggle ${(a.async || a.showFlowchart) ? "active" : ""}" data-act="toggle-flowchart" data-idx="${idx}" title="Toggle flowchart diagram">
                📊 Flowchart
              </button>
            </div>
            ${(a.async || a.showFlowchart) ? renderFlowchartHtml(a, idx) : ""}
          </div>
          <div class="move-comment-row">
            <label class="move-comment-label">
              <span class="move-comment-header">
                <span class="move-comment-tag">💬 Task Comment</span>
                <span class="move-comment-preview">${a.label ? `// ${escapeHtml(cleanCommentText(a.label))}` : "e.g. // spin intake"}</span>
              </span>
              <input type="text" data-f="label" class="move-comment-input" value="${escapeHtml(a.label || '')}" placeholder="e.g. spin intake motor or deploy clamp"/>
            </label>
          </div>`;
      } else {
        const simDur = estimateActionTime(a, fromPose);

        const pointFields = needsPoint(a.type)
          ? `<label>X <input type="number" data-f="x" step="0.1" value="${a.x}"/></label>
             <label>Y <input type="number" data-f="y" step="0.1" value="${a.y}"/></label>`
          : "";
        const headField = needsHeading(a.type)
          ? `<label>θ° <input type="number" data-f="theta" step="1" value="${a.theta}"/></label>`
          : "";
        const leadField = a.type === "moveToPose"
          ? `<label title="Boomerang carrot lead multiplier (default 0.6)">Lead
               <input type="number" data-f="lead" min="0" max="1" step="0.05" value="${a.lead != null ? a.lead : (bot.defaultLead || 0.6)}"/>
             </label>`
          : "";
        const driftField = isMove(a.type)
          ? `<label title="LemLib drift scaler for drift/turn compensation">Drift Scaler
               <input type="number" data-f="driftScaler" min="0" max="5" step="0.05" value="${a.driftScaler != null ? a.driftScaler : 1.0}"/>
             </label>`
          : "";
        const sideField = needsSide(a.type)
          ? `<label>Side
               <select data-f="lockedSide">
                 <option value="LEFT" ${a.lockedSide === "LEFT" ? "selected" : ""}>LEFT</option>
                 <option value="RIGHT" ${a.lockedSide === "RIGHT" ? "selected" : ""}>RIGHT</option>
               </select>
             </label>`
          : "";

        let bezierBox = "";
        if (a.type === "bezierCurve") {
          const { cp1, cp2 } = getBezierControlPoints(a, fromPose);
          const metrics = computeBezierMetrics(a, fromPose);
          bezierBox = `
            <div class="bezier-curvature-hud">
              <span class="bezier-stat-pill">📏 Arc: <strong>${metrics.arcLength.toFixed(1)}"</strong></span>
              <span class="bezier-stat-pill">🌀 R_min: <strong>${metrics.minRadius < 200 ? metrics.minRadius.toFixed(1) + '"' : 'Straight'}</strong></span>
              <span class="bezier-stat-pill">⚡ κ_max: <strong>${metrics.maxCurvature.toFixed(3)}</strong></span>
            </div>
            <div class="bezier-handle-box">
              <div class="bezier-handle-header">
                <span>🌊 Curvature Handles (Drag on map or adjust)</span>
                <button type="button" class="bezier-btn-auto" data-act="auto-bezier" data-id="${a.id}">📐 Auto Tangents</button>
              </div>
              <div class="row" style="margin-bottom: 6px;">
                <label style="color:#06b6d4;">CP1 X <input type="number" data-f="cp1X" step="0.5" value="${a.cp1X != null ? a.cp1X : Math.round(cp1.x * 10) / 10}"/></label>
                <label style="color:#06b6d4;">CP1 Y <input type="number" data-f="cp1Y" step="0.5" value="${a.cp1Y != null ? a.cp1Y : Math.round(cp1.y * 10) / 10}"/></label>
                <label style="color:#06b6d4;" title="Departure curvature handle length">Lead 1 <input type="number" data-f="lead1" min="2" max="60" step="1" value="${a.lead1 != null ? a.lead1 : 18}"/></label>
              </div>
              <div class="row">
                <label style="color:#f59e0b;">CP2 X <input type="number" data-f="cp2X" step="0.5" value="${a.cp2X != null ? a.cp2X : Math.round(cp2.x * 10) / 10}"/></label>
                <label style="color:#f59e0b;">CP2 Y <input type="number" data-f="cp2Y" step="0.5" value="${a.cp2Y != null ? a.cp2Y : Math.round(cp2.y * 10) / 10}"/></label>
                <label style="color:#f59e0b;" title="Arrival curvature handle length">Lead 2 <input type="number" data-f="lead2" min="2" max="60" step="1" value="${a.lead2 != null ? a.lead2 : 18}"/></label>
              </div>
            </div>`;
        }

        body = `
          <div class="row">
            ${pointFields}
            ${headField}
            ${leadField}
            ${driftField}
            ${sideField}
          </div>
          ${bezierBox}
          <div class="speed-timeout-row">
            <div class="st-header">
              <span class="st-label">Speed &amp; Timeout</span>
              <span class="st-sub">Physical sim: ~${simDur.toFixed(2)}s</span>
            </div>
            <div class="row">
              <label>Max speed (0–127)
                <input type="number" data-f="maxSpeed" min="0" max="127" step="1" value="${a.maxSpeed}"/>
              </label>
              <label>Min speed
                <input type="number" data-f="minSpeed" min="0" max="127" step="1" value="${a.minSpeed}"/>
              </label>
              <label>Timeout (ms)
                <input type="number" data-f="timeout" min="0" step="50" value="${a.timeout}"/>
              </label>
              <label>Early exit (in)
                <input type="number" data-f="earlyExitRange" step="0.1" value="${a.earlyExitRange}"/>
              </label>
            </div>
          </div>
          <div class="check-row">
            <label class="reverse-toggle ${a.forwards === false ? "on" : ""}">
              <input type="checkbox" data-f="forwards" data-invert="1" ${a.forwards === false ? "checked" : ""}/>
              Drive in reverse
              <span class="rev-hint">(forwards = false)</span>
            </label>
          </div>
          ${mPrecCard ? `
          <div class="multitask-precedence-box">
            <div class="m-prec-header">
              <span class="m-prec-title">🏆 Multitask Precedence &amp; Timing</span>
              <span class="m-prec-tag ${mPrecCard.precedenceStep === "A" ? "tag-self" : "tag-other"}">
                ${mPrecCard.precedenceStep === "A" ? "CHASSIS MOTION TAKES PRECEDENCE" : (mPrecCard.precedenceStep === "B" ? "CONCURRENT TASK TAKES PRECEDENCE" : "EQUAL PRECEDENCE")}
              </span>
            </div>
            <div class="m-prec-body">
              <div class="m-prec-grid">
                <div class="m-prec-col self">
                  <span class="m-col-lbl">Step ${idx + 1} (${escapeHtml(mPrecCard.nameA)}):</span>
                  <span class="m-col-val">${mPrecCard.durA === 0 ? "0.00s (Instant)" : `${mPrecCard.durA.toFixed(2)}s`}</span>
                </div>
                <span class="m-prec-vs">vs</span>
                <div class="m-prec-col other">
                  <span class="m-col-lbl">Step ${idx + 2} (${escapeHtml(mPrecCard.nameB)}):</span>
                  <span class="m-col-val">${mPrecCard.durB === 0 ? "0.00s (Instant)" : `${mPrecCard.durB.toFixed(2)}s`}</span>
                </div>
              </div>
              <div class="m-prec-summary">${escapeHtml(mPrecCard.summary)}</div>
            </div>
          </div>` : ""}
          <div class="multitask-panel ${a.async ? "on" : ""}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <label class="multitask-toggle-label">
                <input type="checkbox" data-f="async" ${a.async ? "checked" : ""}/>
                <span class="multitask-indicator">⚡</span>
                <span class="multitask-text-col">
                  <span class="multitask-title">Multitask (Async / Non-blocking)</span>
                  <span class="multitask-sub">Runs next action concurrently while this chassis motion executes</span>
                </span>
                <span class="multitask-pill ${a.async ? "active" : ""}">${a.async ? "PARALLEL" : "SEQUENTIAL"}</span>
              </label>
              <button type="button" class="btn-flowchart-toggle ${(a.async || a.showFlowchart) ? "active" : ""}" data-act="toggle-flowchart" data-idx="${idx}" title="Toggle flowchart diagram">
                📊 Flowchart
              </button>
            </div>
            ${(a.async || a.showFlowchart) ? renderFlowchartHtml(a, idx) : ""}
          </div>
          <div class="offset-row">
            <div class="label">Code-only offsets (hidden from sim)</div>
            <div class="row">
              <label>ΔX <input type="number" data-f="offsetX" step="0.1" value="${a.offsetX}"/></label>
              <label>ΔY <input type="number" data-f="offsetY" step="0.1" value="${a.offsetY}"/></label>
              <label>Δθ <input type="number" data-f="offsetTheta" step="1" value="${a.offsetTheta}"/></label>
            </div>
          </div>
          <div class="move-comment-row">
            <label class="move-comment-label">
              <span class="move-comment-header">
                <span class="move-comment-tag">💬 Move Comment (C++ code)</span>
                <span class="move-comment-preview">${a.label ? `// ${escapeHtml(cleanCommentText(a.label))}` : "e.g. // rush goal"}</span>
              </span>
              <input type="text" data-f="label" class="move-comment-input" value="${escapeHtml(a.label || '')}" placeholder="e.g. rush goal, clamp mogo, or intake preload"/>
            </label>
          </div>`;
      }

      let summaryText = "";
      if (a.type === "ifElse") {
        const thenCount = Array.isArray(a.thenChildren) ? a.thenChildren.length : 0;
        const elseCount = Array.isArray(a.elseChildren) ? a.elseChildren.length : 0;
        summaryText = `if (${a.condition || 'true'}) [${thenCount} blk] : [${elseCount} blk]`;
      } else if (a.type === "moveToPoint") summaryText = `(${a.x}, ${a.y})`;
      else if (a.type === "moveToPose") summaryText = `(${a.x}, ${a.y}, ${a.theta}°)`;
      else if (a.type === "bezierCurve") summaryText = `Arc (${a.x}, ${a.y}, ${a.theta}°)`;
      else if (a.type === "turnToPoint" || a.type === "swingToPoint") summaryText = `to (${a.x}, ${a.y})`;
      else if (a.type === "turnToHeading" || a.type === "swingToHeading") summaryText = `to ${a.theta}°`;
      else if (a.type === "wait") {
        const mode = a.waitType || "distance";
        if (mode === "distance") summaryText = `${a.distance != null ? a.distance : 12}" dist`;
        else if (mode === "done") summaryText = "until done";
        else if (mode === "time") summaryText = `${a.delayMs != null ? a.delayMs : 250}ms`;
      } else if (a.type === "loop") {
        const count = (a.children || []).length;
        summaryText = `${a.loopMode || 'until'} (${count} ${count === 1 ? 'block' : 'blocks'})`;
      } else if (a.type === "custom") {
        const firstLine = (a.customCode || "").trim().split("\n")[0];
        summaryText = firstLine ? (firstLine.length > 25 ? firstLine.substring(0, 22) + "..." : firstLine) : "C++ Code";
      }

      const cleanLbl = cleanCommentText(a.label);
      const actCol = getActionCollision(a.id);
      const colBadgeHtml = actCol ? `<span class="badge collision-badge" title="Collision detected: ${escapeHtml(actCol.obstacle.name)}">💥 Collision</span>` : "";

      const activeSharpTurns = analyzeSharpAngleTransitions();
      const sharpItem = activeSharpTurns.find((st) => st.actionId === a.id);
      const sharpBadgeHtml = sharpItem ? `<span class="badge sharp-turn-badge" title="Sharp angle transition (${sharpItem.angleDelta}°): LemLib chassis brakes to 0 in/s">⚡ ${sharpItem.angleDelta}° Sharp</span>` : "";

      card.innerHTML = `
        <div class="card-title" style="cursor: pointer; user-select: none;">
          <span class="drag-handle" title="Drag to reorder routine or drag into a loop" draggable="true">⠿</span>
          <span class="badge ${badgeClass(a.type)}">${idx + 1}. ${a.type === 'ifElse' ? 'if / else' : a.type}</span>
          ${summaryText ? `<span class="collapsed-summary-badge">${escapeHtml(summaryText)}</span>` : ""}
          ${colBadgeHtml}
          ${sharpBadgeHtml}
          ${a.async ? '<span class="badge multitask-badge" title="Multitasking: Runs concurrently">⚡ Async</span>' : ""}
          ${a.forwards === false && a.type !== "custom" && a.type !== "ifElse" ? '<span class="badge reverse">REV</span>' : ""}
          <span class="hint-inline ${cleanLbl ? "has-comment" : ""}">${cleanLbl ? `// ${escapeHtml(cleanLbl)}` : ""}</span>
          <div style="margin-left:auto;display:flex;align-items:center;gap:4px">
            <button class="icon" data-act="up" title="Move up">↑</button>
            <button class="icon" data-act="down" title="Move down">↓</button>
            <button class="icon" data-act="del" title="Delete">×</button>
          </div>
        </div>
        <div class="card-body">
          ${actCol ? `
            <div class="action-card-collision-alert">
              <span class="col-icon">💥</span>
              <div>
                <div class="col-title">Collision Alert: ${escapeHtml(actCol.obstacle.name)}</div>
                <div class="col-desc">Chassis collides at (X: ${actCol.point.x.toFixed(1)}", Y: ${actCol.point.y.toFixed(1)}", θ: ${Math.round(actCol.point.theta)}°) at ~${actCol.point.t.toFixed(2)}s. Penetration depth: ~${actCol.penetration.toFixed(1)}".</div>
              </div>
            </div>
          ` : ""}
          ${sharpItem ? `
            <div class="action-card-sharp-turn-alert">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:1.1rem;color:#f59e0b;">⚡</span>
                <div>
                  <strong style="color:#fef08a;font-size:0.8rem;">Velocity Drop Warning: ${sharpItem.angleDelta}° Sharp Transition</strong>
                  <p style="margin:2px 0 6px 0;font-size:0.75rem;color:#cbd5e1;">
                    Path changes heading from ${sharpItem.inHeading}° to ${sharpItem.outHeading}°. LemLib chassis brakes to 0 in/s at Waypoint #${sharpItem.cornerWaypointNum}.
                  </p>
                </div>
              </div>
              <div style="display:flex;gap:6px;margin-top:4px;">
                <button type="button" class="btn-xs-fix-bezier" data-act-fix="bezier" data-id="${a.id}">
                  ✨ Convert to Bezier Spline Arc
                </button>
                <button type="button" class="btn-xs-fix-exit" data-act-fix="earlyExit" data-id="${a.id}">
                  🏃 Set 6" Early Exit Range
                </button>
              </div>
            </div>
          ` : ""}
          ${body}
        </div>`;


      card.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("textarea")) return;
        if (e.target.closest(".drag-handle") || e.target.closest(".loop-child-card") || e.target.closest(".ifelse-child-card") || e.target.closest(".loop-add-toolbar") || e.target.closest(".loop-empty-drop-zone") || e.target.closest(".loop-drop-target")) return;
        const clickedHeader = e.target.closest(".card-title");
        if (clickedHeader && selectedId === a.id) {
          selectedId = null; // collapse
        } else {
          selectedId = a.id; // expand
        }
        renderFlow();
        draw();
      });

      card.querySelectorAll('[data-act="auto-bezier"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          a.cp1X = null;
          a.cp1Y = null;
          a.cp2X = null;
          a.cp2Y = null;
          markDirty();
          renderFlow();
          draw();
          generateCode();
        });
      });

      card.querySelectorAll('[data-act-fix="bezier"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          fixSharpTurnToBezier(btn.dataset.id);
        });
      });

      card.querySelectorAll('[data-act-fix="earlyExit"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          fixSharpTurnEarlyExit(btn.dataset.id, 6);
        });
      });

      card.querySelectorAll(".snippet-chip").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const snip = btn.dataset.snip;
          const ta = card.querySelector('textarea[data-f="customCode"]');
          if (ta && snip) {
            const cur = ta.value;
            ta.value = cur ? cur.replace(/\n*$/, "") + "\n" + snip : snip;
            a.customCode = ta.value;
            markDirty();
            generateCode();
            ta.dispatchEvent(new Event("input", { bubbles: true }));
          }
        });
      });

      card.querySelectorAll("[data-f]").forEach((el) => {
        el.addEventListener("change", () => {
          const f = el.dataset.f;
          let v;
          if (el.type === "checkbox") {
            v = el.dataset.invert ? !el.checked : el.checked;
          } else if (el.type === "number") v = Number(el.value);
          else v = el.value;
          a[f] = v;
          if (f === "async") {
            a.showFlowchart = !!v;
          }
          markDirty();
          renderFlow();
          draw();
          generateCode();
          updateTimeDisplay();
        });

        el.addEventListener("input", () => {
          const f = el.dataset.f;
          if (el.type === "number" || el.tagName === "TEXTAREA" || el.type === "text") {
            a[f] = el.type === "number" ? Number(el.value) : el.value;
            markDirty();
            if (["x", "y", "theta", "cp1X", "cp1Y", "cp2X", "cp2Y", "lead1", "lead2"].includes(f)) {
              draw();
              generateCode();
            }
            if (f === "label") {
              const clean = cleanCommentText(el.value);
              const previewEl = card.querySelector(".move-comment-preview");
              if (previewEl) previewEl.textContent = clean ? "// " + clean : "e.g. // rush goal";
              const headerHint = card.querySelector(".hint-inline");
              if (headerHint) {
                headerHint.textContent = clean ? "// " + clean : "";
                headerHint.className = "hint-inline" + (clean ? " has-comment" : "");
              }
              generateCode();
            }
            if (f === "customDuration") {
              updateTimeDisplay();
            }
            if (f === "thenCode") {
              if (window.CppTranslator && typeof window.CppTranslator.parseStatementToAction === "function") {
                a.thenAction = window.CppTranslator.parseStatementToAction(el.value, bot.defaultMaxSpeed || 127, bot.defaultMinSpeed || 0);
              }
              if (a.activeSimBranch !== "else") draw();
              generateCode();
            }
            if (f === "elseCode") {
              if (window.CppTranslator && typeof window.CppTranslator.parseStatementToAction === "function") {
                a.elseAction = window.CppTranslator.parseStatementToAction(el.value, bot.defaultMaxSpeed || 127, bot.defaultMinSpeed || 0);
              }
              if (a.activeSimBranch === "else") draw();
              generateCode();
            }
            if (f === "loopCode") {
              if (window.CppTranslator && typeof window.CppTranslator.parseStatementToAction === "function") {
                a.loopAction = window.CppTranslator.parseStatementToAction(el.value, bot.defaultMaxSpeed || 127, bot.defaultMinSpeed || 0);
              }
              draw();
              generateCode();
            }
            if (f === "condition" || f === "thenLabel" || f === "elseLabel" || f === "loopLabel" || f === "times") {
              generateCode();
            }
            if (f === "customCode") {
              const snipText =
                (el.value || "")
                  .trim()
                  .split("\n")
                  .map((l) => l.trim())
                  .filter((l) => l && !l.startsWith("//"))[0] || "Custom C++ Snippet";
              const subTaskEl = card.querySelector(".fc-custom-snip");
              if (subTaskEl) {
                subTaskEl.textContent =
                  snipText.length > 22 ? snipText.slice(0, 20) + "…" : snipText;
              }

              // Real-time detection of if-loop or ternary in custom code
              const detectedIf = window.CppTranslator && typeof window.CppTranslator.parseIfElseFromCode === "function"
                ? window.CppTranslator.parseIfElseFromCode(el.value, bot.defaultMaxSpeed || 127, bot.defaultMinSpeed || 0)
                : null;
              const detectedLoop = window.CppTranslator && typeof window.CppTranslator.parseLoopFromCode === "function"
                ? window.CppTranslator.parseLoopFromCode(el.value, bot.defaultMaxSpeed || 127, bot.defaultMinSpeed || 0)
                : null;

              let bannerEl = card.querySelector(".custom-if-detected-banner");
              if (detectedIf) {
                if (!bannerEl) {
                  bannerEl = document.createElement("div");
                  bannerEl.className = "custom-if-detected-banner";
                  const labelWide = card.querySelector("label.wide");
                  if (labelWide) labelWide.parentNode.insertBefore(bannerEl, labelWide);
                }
                bannerEl.innerHTML = `
                  <div class="if-detected-info">
                    <span class="if-detected-icon">✨</span>
                    <div class="if-detected-text">
                      <div class="if-detected-title-row">
                        <span class="if-detected-title">Detected C++ If-Else Loop!</span>
                        <span class="if-detected-cond-badge">if (${escapeHtml(detectedIf.condition)})</span>
                      </div>
                      <div class="if-detected-branches">
                        <span class="if-detected-branch-item">🟢 Then: <strong>${escapeHtml(detectedIf.thenLabel)}</strong></span>
                        <span class="if-detected-branch-item">🟠 Else: <strong>${escapeHtml(detectedIf.elseLabel)}</strong></span>
                      </div>
                    </div>
                  </div>
                  <button type="button" class="btn-convert-to-scratch" data-act="convert-custom-to-if" data-idx="${idx}" title="Convert this custom code block into a visual Scratch If-Else block">
                    ⚡ Convert to Scratch Block
                  </button>
                `;
                const btnConv = bannerEl.querySelector('[data-act="convert-custom-to-if"]');
                if (btnConv) {
                  btnConv.onclick = (e) => {
                    e.stopPropagation();
                    a.type = "ifElse";
                    a.condition = detectedIf.condition;
                    a.thenCode = detectedIf.thenCode;
                    a.elseCode = detectedIf.elseCode;
                    a.thenAction = detectedIf.thenAction;
                    a.elseAction = detectedIf.elseAction;
                    a.thenLabel = detectedIf.thenLabel;
                    a.elseLabel = detectedIf.elseLabel;
                    a.activeSimBranch = "then";
                    markDirty();
                    renderFlow();
                    draw();
                    generateCode();
                    showToast("✨ Converted custom C++ code to Scratch If-Else block!");
                  };
                }
              } else if (detectedLoop) {
                if (!bannerEl) {
                  bannerEl = document.createElement("div");
                  bannerEl.className = "custom-if-detected-banner";
                  const labelWide = card.querySelector("label.wide");
                  if (labelWide) labelWide.parentNode.insertBefore(bannerEl, labelWide);
                }
                const modeLbl = detectedLoop.loopMode === "for" ? `for ${detectedLoop.times} times` : (detectedLoop.loopMode === "forever" ? "forever" : `until ${detectedLoop.condition}`);
                bannerEl.innerHTML = `
                  <div class="if-detected-info">
                    <span class="if-detected-icon">✨</span>
                    <div class="if-detected-text">
                      <div class="if-detected-title-row">
                        <span class="if-detected-title" style="color: #fb923c;">Detected C++ Loop!</span>
                        <span class="if-detected-cond-badge" style="background: rgba(249,115,22,0.25); border-color: #FF7B00; color: #f97316;">${escapeHtml(modeLbl)}</span>
                      </div>
                      <div class="if-detected-branches">
                        <span class="if-detected-branch-item">🔄 Repeat: <strong>${escapeHtml(detectedLoop.loopLabel)}</strong></span>
                      </div>
                    </div>
                  </div>
                  <button type="button" class="btn-convert-to-scratch" style="background: linear-gradient(135deg, #FF7B00 0%, #ea580c 100%); box-shadow: 0 2px 8px rgba(234, 88, 12, 0.35);" data-act="convert-custom-to-loop" data-idx="${idx}" title="Convert this custom code block into a visual Scratch Loop block">
                    ⚡ Convert to Loop Block
                  </button>
                `;
                const btnConv = bannerEl.querySelector('[data-act="convert-custom-to-loop"]');
                if (btnConv) {
                  btnConv.onclick = (e) => {
                    e.stopPropagation();
                    a.type = "loop";
                    a.loopMode = detectedLoop.loopMode;
                    a.condition = detectedLoop.condition;
                    a.times = detectedLoop.times;
                    a.loopCode = detectedLoop.loopCode;
                    a.loopAction = detectedLoop.loopAction;
                    a.loopLabel = detectedLoop.loopLabel;
                    markDirty();
                    renderFlow();
                    draw();
                    generateCode();
                    showToast("✨ Converted custom C++ code to Scratch Loop block!");
                  };
                }
              } else if (bannerEl) {
                bannerEl.remove();
              }
            }
          }
        });
      });

      card.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === "convert-custom-to-if") {
            const detected = window.CppTranslator && typeof window.CppTranslator.parseIfElseFromCode === "function"
              ? window.CppTranslator.parseIfElseFromCode(a.customCode, bot.defaultMaxSpeed || 127, bot.defaultMinSpeed || 0)
              : null;
            if (detected) {
              a.type = "ifElse";
              a.condition = detected.condition;
              a.thenCode = detected.thenCode;
              a.elseCode = detected.elseCode;
              a.thenAction = detected.thenAction;
              a.elseAction = detected.elseAction;
              a.thenLabel = detected.thenLabel;
              a.elseLabel = detected.elseLabel;
              a.activeSimBranch = "then";
              markDirty();
              renderFlow();
              draw();
              generateCode();
              showToast("✨ Converted custom C++ code to Scratch If-Else block!");
            }
            return;
          }
          if (act === "convert-custom-to-loop") {
            const detected = window.CppTranslator && typeof window.CppTranslator.parseLoopFromCode === "function"
              ? window.CppTranslator.parseLoopFromCode(a.customCode, bot.defaultMaxSpeed || 127, bot.defaultMinSpeed || 0)
              : null;
            if (detected) {
              a.type = "loop";
              a.loopMode = detected.loopMode;
              a.condition = detected.condition;
              a.times = detected.times;
              a.loopCode = detected.loopCode;
              a.loopAction = detected.loopAction;
              a.loopLabel = detected.loopLabel;
              markDirty();
              renderFlow();
              draw();
              generateCode();
              showToast("✨ Converted custom C++ code to Scratch Loop block!");
            }
            return;
          }
          if (act === "toggle-flowchart") {
            a.showFlowchart = !a.showFlowchart;
            renderFlow();
            return;
          }
          if (act === "enlarge-flowchart") {
            openFlowchartModal(a, idx);
            return;
          }

          if (act === "set-sim-branch") {
            a.activeSimBranch = btn.dataset.branch;
            markDirty();
            renderFlow();
            draw();
            updateTimeDisplay();
            showToast(`🔀 Simulating ${a.activeSimBranch === 'else' ? 'Else (False)' : 'Then (True)'} branch on 2D field`);
            return;
          }
          if (act === "goto-cond-mgr") {
            switchPlannerTab("conditions");
            return;
          }
          if (act === "toggle-cond-badge") {
            const varName = btn.dataset.var;
            const foundCond = conditions.find((c) => c.name === varName);
            if (foundCond) {
              toggleConditionVariableValue(foundCond.id);
            }
            return;
          }
          if (act === "set-condition") {
            a.condition = btn.dataset.cond;
            const evalRes = evaluateConditionExpression(a.condition);
            a.activeSimBranch = evalRes ? "then" : "else";
            markDirty();
            renderFlow();
            draw();
            updateTimeDisplay();
            generateCode();
            showToast(`🔀 Set condition to '${a.condition}' (${evalRes ? 'Then' : 'Else'} branch active)`);
            return;
          }
          if (act === "set-then-preset") {
            const p = btn.dataset.preset;
            if (p === "moveForward") {
              a.thenLabel = "Move forward";
              a.thenCode = "chassis.moveToPoint(24, 24, 2000);";
              a.thenAction = { type: "moveToPoint", x: 24, y: 24, timeout: 2000, forwards: true };
            } else if (p === "turn90") {
              a.thenLabel = "Turn to 90°";
              a.thenCode = "chassis.turnToHeading(90, 1500);";
              a.thenAction = { type: "turnToHeading", theta: 90, timeout: 1500 };
            } else if (p === "clampOn") {
              a.thenLabel = "Clamp Goal";
              a.thenCode = "clamp.set_value(true);\npros::delay(100);";
              a.thenAction = { type: "custom", customCode: "clamp.set_value(true);\npros::delay(100);", customDuration: 0.1 };
            } else if (p === "intakeOn") {
              a.thenLabel = "Intake On";
              a.thenCode = "intake.move(127);";
              a.thenAction = { type: "custom", customCode: "intake.move(127);", customDuration: 0 };
            }
            markDirty();
            renderFlow();
            draw();
            generateCode();
            updateTimeDisplay();
            return;
          }
          if (act === "set-else-preset") {
            const p = btn.dataset.preset;
            if (p === "moveBackwards") {
              a.elseLabel = "Move backwards";
              a.elseCode = "chassis.moveToPoint(-24, -24, 2000, {.forwards = false});";
              a.elseAction = { type: "moveToPoint", x: -24, y: -24, timeout: 2000, forwards: false };
            } else if (p === "turnNeg90") {
              a.elseLabel = "Turn to 270°";
              a.elseCode = "chassis.turnToHeading(270, 1500);";
              a.elseAction = { type: "turnToHeading", theta: 270, timeout: 1500 };
            } else if (p === "clampOff") {
              a.elseLabel = "Release Clamp";
              a.elseCode = "clamp.set_value(false);\npros::delay(100);";
              a.elseAction = { type: "custom", customCode: "clamp.set_value(false);\npros::delay(100);", customDuration: 0.1 };
            } else if (p === "intakeOff") {
              a.elseLabel = "Intake Off";
              a.elseCode = "intake.move(0);";
              a.elseAction = { type: "custom", customCode: "intake.move(0);", customDuration: 0 };
            }
            markDirty();
            renderFlow();
            draw();
            generateCode();
            updateTimeDisplay();
            return;
          }

          if (act === "set-loop-cond") {
            a.condition = btn.dataset.cond;
            markDirty();
            renderFlow();
            generateCode();
            return;
          }

          if (act === "set-loop-preset") {
            const p = btn.dataset.preset;
            if (p === "moveForward") {
              a.loopLabel = "Move forward";
              a.loopCode = "chassis.moveToPoint(24, 24, 2000);";
              a.loopAction = { type: "moveToPoint", x: 24, y: 24, timeout: 2000, forwards: true };
            } else if (p === "turn90") {
              a.loopLabel = "Turn to 90°";
              a.loopCode = "chassis.turnToHeading(90, 1500);";
              a.loopAction = { type: "turnToHeading", theta: 90, timeout: 1500 };
            } else if (p === "clampOn") {
              a.loopLabel = "Clamp Goal";
              a.loopCode = "clamp.set_value(true);\npros::delay(100);";
              a.loopAction = { type: "custom", customCode: "clamp.set_value(true);\npros::delay(100);", customDuration: 0.1 };
            } else if (p === "intakeOn") {
              a.loopLabel = "Intake On";
              a.loopCode = "intake.move(127);";
              a.loopAction = { type: "custom", customCode: "intake.move(127);", customDuration: 0 };
            }
            markDirty();
            renderFlow();
            draw();
            generateCode();
            updateTimeDisplay();
            return;
          }

          if (act === "set-wait-mode") {
            a.waitType = btn.dataset.mode;
            markDirty();
            renderFlow();
            generateCode();
            return;
          }
          if (act === "set-wait-dist") {
            a.distance = Number(btn.dataset.dist);
            markDirty();
            renderFlow();
            generateCode();
            showToast(`📏 Set wait trigger distance to ${a.distance}"`);
            return;
          }
          if (act === "set-wait-delay") {
            a.delayMs = Number(btn.dataset.ms);
            markDirty();
            renderFlow();
            generateCode();
            showToast(`⏱️ Set delay duration to ${a.delayMs}ms`);
            return;
          }
          if (act === "set-dur") {
            a.customDuration = Number(btn.dataset.dur);
            markDirty();
            renderFlow();
            draw();
            generateCode();
            updateTimeDisplay();
            if (a.customDuration === 0) {
              showToast(`⏱️ Set custom code duration to 0s (Non-blocking / e.g. spinning intake)`);
            } else {
              showToast(`⏱️ Set custom code duration to ${a.customDuration}s`);
            }
            return;
          }
          if (act === "loop-add") {
            addBlockToLoop(btn.dataset.loopId, btn.dataset.type);
            return;
          }
          if (act === "ifelse-add") {
            addBlockToIfElse(btn.dataset.ifId, btn.dataset.branch, btn.dataset.type);
            return;
          }
          const i = actions.findIndex((x) => x.id === a.id);
          if (act === "del") {
            if (sessionStorage.getItem("disableDeleteWarning") === "true") {
              actions.splice(i, 1);
              if (selectedId === a.id) selectedId = null;
              showToast(`🗑️ Block deleted.`);
            } else {
              openDeleteBlockModal(a.id);
              return;
            }
          } else if (act === "up" && i > 0) {
            [actions[i - 1], actions[i]] = [actions[i], actions[i - 1]];
          } else if (act === "down" && i < actions.length - 1) {
            [actions[i], actions[i + 1]] = [actions[i + 1], actions[i]];
          }
          markDirty();
          renderFlow();
          draw();
          generateCode();
          updateTimeDisplay();
        });
      });

      card.querySelectorAll(".loop-add-more-select").forEach((sel) => {
        sel.addEventListener("change", (e) => {
          const bType = e.target.value;
          const loopId = sel.dataset.loopId;
          if (bType && loopId) {
            addBlockToLoop(loopId, bType);
            sel.value = "";
          }
        });
      });

      card.querySelectorAll(".ifelse-add-more-select").forEach((sel) => {
        sel.addEventListener("change", (e) => {
          const bType = e.target.value;
          const ifId = sel.dataset.ifId;
          const branch = sel.dataset.branch;
          if (bType && ifId) {
            addBlockToIfElse(ifId, branch, bType);
            sel.value = "";
          }
        });
      });

      card.querySelectorAll(".scratch-condition-select").forEach((sel) => {
        sel.addEventListener("change", (e) => {
          e.stopPropagation();
          const val = sel.value;
          if (val === "__open_mgr__") {
            switchPlannerTab("conditions");
            return;
          }
          if (val) {
            a.condition = val;
            const evalRes = evaluateConditionExpression(val);
            a.activeSimBranch = evalRes ? "then" : "else";
            markDirty();
            renderFlow();
            draw();
            updateTimeDisplay();
            generateCode();
            showToast(`🔀 Set condition to '${val}' (${evalRes ? 'Then' : 'Else'} branch active)`);
          }
        });
      });

      const loopDropZones = card.querySelectorAll(".loop-c-arm, .loop-children-container, .loop-empty-drop-zone, .loop-drop-target");
      loopDropZones.forEach((dz) => {
        dz.addEventListener("dragover", (e) => {
          if (!dragData || dragData.id === a.id) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          dz.classList.add("loop-drag-over");
          const arm = card.querySelector(".loop-c-arm");
          if (arm) arm.classList.add("loop-drag-over");
        });
        dz.addEventListener("dragleave", (e) => {
          if (!dz.contains(e.relatedTarget)) {
            dz.classList.remove("loop-drag-over");
            const arm = card.querySelector(".loop-c-arm");
            if (arm && !arm.contains(e.relatedTarget)) arm.classList.remove("loop-drag-over");
          }
        });
        dz.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.remove("loop-drag-over");
          const arm = card.querySelector(".loop-c-arm");
          if (arm) arm.classList.remove("loop-drag-over");
          if (!dragData || dragData.id === a.id) return;
          moveAction(dragData, { target: "loop", targetLoopId: a.id, targetChildIdx: (a.children || []).length });
        });
      });

      const ifElseDropZones = card.querySelectorAll(".ifelse-c-arm, .ifelse-children-container, .ifelse-empty-drop-zone, .ifelse-drop-target");
      ifElseDropZones.forEach((dz) => {
        const branch = dz.dataset.branch || (dz.closest("[data-branch]") ? dz.closest("[data-branch]").dataset.branch : "then");
        dz.addEventListener("dragover", (e) => {
          if (!dragData || dragData.id === a.id) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          dz.classList.add("loop-drag-over");
          const arm = card.querySelector(`.ifelse-c-arm[data-branch="${branch}"]`);
          if (arm) arm.classList.add("loop-drag-over");
        });
        dz.addEventListener("dragleave", (e) => {
          if (!dz.contains(e.relatedTarget)) {
            dz.classList.remove("loop-drag-over");
            const arm = card.querySelector(`.ifelse-c-arm[data-branch="${branch}"]`);
            if (arm && !arm.contains(e.relatedTarget)) arm.classList.remove("loop-drag-over");
          }
        });
        dz.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.remove("loop-drag-over");
          const arm = card.querySelector(`.ifelse-c-arm[data-branch="${branch}"]`);
          if (arm) arm.classList.remove("loop-drag-over");
          if (!dragData || dragData.id === a.id) return;
          const list = branch === "else" ? (a.elseChildren || []) : (a.thenChildren || []);
          moveAction(dragData, { target: "ifelse", targetIfId: a.id, branch, targetChildIdx: list.length });
        });
      });

      card.querySelectorAll(".ifelse-child-card").forEach((childCard) => {
        const branch = childCard.dataset.branch;
        const childId = childCard.dataset.nestedChildId;
        const list = branch === "else" ? (a.elseChildren || []) : (a.thenChildren || []);
        const childIdx = list.findIndex((c) => c.id === childId);
        const child = list[childIdx];
        if (!child) return;

        childCard.addEventListener("dragstart", (e) => {
          if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)) {
            e.preventDefault();
            return;
          }
          e.stopPropagation();
          dragData = {
            source: "ifelse",
            id: child.id,
            parentIfId: a.id,
            branch,
            fromChildIdx: childIdx,
            type: child.type,
          };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
          setTimeout(() => childCard.classList.add("is-dragging"), 0);
        });

        childCard.addEventListener("dragend", (e) => {
          e.stopPropagation();
          childCard.classList.remove("is-dragging");
          document.querySelectorAll(".drop-before, .drop-after, .loop-drag-over").forEach((el) => {
            el.classList.remove("drop-before", "drop-after", "loop-drag-over");
          });
          dragData = null;
        });

        childCard.addEventListener("dragover", (e) => {
          if (!dragData) return;
          if (dragData.id === child.id) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const rect = childCard.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            childCard.classList.add("drop-before");
            childCard.classList.remove("drop-after");
          } else {
            childCard.classList.add("drop-after");
            childCard.classList.remove("drop-before");
          }
        });

        childCard.addEventListener("dragleave", (e) => {
          if (!childCard.contains(e.relatedTarget)) {
            childCard.classList.remove("drop-before", "drop-after");
          }
        });

        childCard.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const before = childCard.classList.contains("drop-before");
          childCard.classList.remove("drop-before", "drop-after");
          if (!dragData || dragData.id === child.id) return;
          let targetChildIdx = before ? childIdx : childIdx + 1;
          if (dragData.source === "ifelse" && dragData.parentIfId === a.id && dragData.branch === branch && dragData.fromChildIdx < targetChildIdx) {
            targetChildIdx--;
          }
          moveAction(dragData, { target: "ifelse", targetIfId: a.id, branch, targetChildIdx });
        });

        childCard.addEventListener("click", (e) => {
          if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("textarea") || e.target.closest(".drag-handle")) return;
          e.stopPropagation();
          if (selectedId === child.id) {
            selectedId = null;
          } else {
            selectedId = child.id;
          }
          renderFlow();
          draw();
        });

        childCard.querySelectorAll("[data-act]").forEach((cBtn) => {
          cBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const cAct = cBtn.dataset.act;
            if (cAct === "ifelse-child-up" && childIdx > 0) {
              [list[childIdx - 1], list[childIdx]] = [list[childIdx], list[childIdx - 1]];
            } else if (cAct === "ifelse-child-down" && childIdx < list.length - 1) {
              [list[childIdx], list[childIdx + 1]] = [list[childIdx + 1], list[childIdx]];
            } else if (cAct === "ifelse-child-del") {
              if (sessionStorage.getItem("disableDeleteWarning") === "true") {
                list.splice(childIdx, 1);
                if (selectedId === child.id) selectedId = null;
                showToast(`🗑️ Block deleted from ${branch === 'else' ? 'Else' : 'Then'} branch.`);
              } else {
                openDeleteBlockModal(child.id);
                return;
              }
            }
            markDirty();
            renderFlow();
            draw();
            generateCode();
            try { updateTimeDisplay(); } catch (_) {}
          });
        });

        childCard.querySelectorAll("[data-child-f]").forEach((cEl) => {
          cEl.addEventListener("change", () => {
            const f = cEl.dataset.childF;
            let val;
            if (cEl.type === "checkbox") {
              val = cEl.dataset.invert ? !cEl.checked : cEl.checked;
            } else if (cEl.type === "number") {
              val = Number(cEl.value);
            } else {
              val = cEl.value;
            }
            child[f] = val;
            markDirty();
            draw();
            generateCode();
            try { updateTimeDisplay(); } catch (_) {}
          });
        });
      });

      card.querySelectorAll(".loop-child-card").forEach((childCard) => {
        const childId = childCard.dataset.loopChildId;
        const childIdx = (a.children || []).findIndex((c) => c.id === childId);
        const child = (a.children || [])[childIdx];
        if (!child) return;

        childCard.addEventListener("dragstart", (e) => {
          if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)) {
            e.preventDefault();
            return;
          }
          e.stopPropagation();
          dragData = {
            source: "loop",
            id: child.id,
            parentLoopId: a.id,
            fromChildIdx: childIdx,
            type: child.type,
          };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
          setTimeout(() => childCard.classList.add("is-dragging"), 0);
        });

        childCard.addEventListener("dragend", (e) => {
          e.stopPropagation();
          childCard.classList.remove("is-dragging");
          document.querySelectorAll(".drop-before, .drop-after, .loop-drag-over").forEach((el) => {
            el.classList.remove("drop-before", "drop-after", "loop-drag-over");
          });
          dragData = null;
        });

        childCard.addEventListener("dragover", (e) => {
          if (!dragData) return;
          if (dragData.id === child.id) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const rect = childCard.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            childCard.classList.add("drop-before");
            childCard.classList.remove("drop-after");
          } else {
            childCard.classList.add("drop-after");
            childCard.classList.remove("drop-before");
          }
        });

        childCard.addEventListener("dragleave", (e) => {
          if (!childCard.contains(e.relatedTarget)) {
            childCard.classList.remove("drop-before", "drop-after");
          }
        });

        childCard.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const before = childCard.classList.contains("drop-before");
          childCard.classList.remove("drop-before", "drop-after");
          if (!dragData || dragData.id === child.id) return;
          let targetChildIdx = before ? childIdx : childIdx + 1;
          if (dragData.source === "loop" && dragData.parentLoopId === a.id && dragData.fromChildIdx < targetChildIdx) {
            targetChildIdx--;
          }
          moveAction(dragData, { target: "loop", targetLoopId: a.id, targetChildIdx });
        });

        childCard.addEventListener("click", (e) => {
          if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("textarea") || e.target.closest(".drag-handle")) return;
          e.stopPropagation();
          if (selectedId === child.id) {
            selectedId = null;
          } else {
            selectedId = child.id;
          }
          renderFlow();
          draw();
        });

        childCard.querySelectorAll("[data-act]").forEach((cBtn) => {
          cBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const cAct = cBtn.dataset.act;
            if (cAct === "loop-child-up" && childIdx > 0) {
              [a.children[childIdx - 1], a.children[childIdx]] = [a.children[childIdx], a.children[childIdx - 1]];
            } else if (cAct === "loop-child-down" && childIdx < a.children.length - 1) {
              [a.children[childIdx], a.children[childIdx + 1]] = [a.children[childIdx + 1], a.children[childIdx]];
            } else if (cAct === "loop-child-del") {
              if (sessionStorage.getItem("disableDeleteWarning") === "true") {
                a.children.splice(childIdx, 1);
                if (selectedId === child.id) selectedId = null;
                showToast(`🗑️ Block deleted from loop.`);
              } else {
                openDeleteBlockModal(child.id);
                return;
              }
            }
            markDirty();
            renderFlow();
            draw();
            generateCode();
            try { updateTimeDisplay(); } catch (_) {}
          });
        });

        childCard.querySelectorAll("[data-child-f]").forEach((cEl) => {
          cEl.addEventListener("change", () => {
            const f = cEl.dataset.childF;
            let val;
            if (cEl.type === "checkbox") {
              val = cEl.dataset.invert ? !cEl.checked : cEl.checked;
            } else if (cEl.type === "number") {
              val = Number(cEl.value);
            } else {
              val = cEl.value;
            }
            child[f] = val;
            markDirty();
            draw();
            generateCode();
            try { updateTimeDisplay(); } catch (_) {}
          });
        });
      });

      block.setAttribute("draggable", "true");
      block.dataset.idx = idx;
      block.dataset.id = a.id;

      block.addEventListener("dragstart", (e) => {
        if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)) {
          e.preventDefault();
          return;
        }
        if (e.target.closest(".loop-child-card") || e.target.closest(".ifelse-child-card")) {
          return;
        }
        dragData = {
          source: "main",
          id: a.id,
          type: a.type,
          fromIdx: idx,
        };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
        setTimeout(() => block.classList.add("is-dragging"), 0);
      });

      block.addEventListener("dragend", () => {
        block.classList.remove("is-dragging");
        document.querySelectorAll(".drop-before, .drop-after, .loop-drag-over").forEach((el) => {
          el.classList.remove("drop-before", "drop-after", "loop-drag-over");
        });
        dragData = null;
      });

      block.addEventListener("dragover", (e) => {
        if (!dragData) return;
        if (dragData.source === "main" && dragData.id === a.id) return;
        if (e.target.closest(".loop-c-arm") || e.target.closest(".loop-child-card") || e.target.closest(".ifelse-c-arm") || e.target.closest(".ifelse-child-card")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = block.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          block.classList.add("drop-before");
          block.classList.remove("drop-after");
        } else {
          block.classList.add("drop-after");
          block.classList.remove("drop-before");
        }
      });

      block.addEventListener("dragleave", (e) => {
        if (!block.contains(e.relatedTarget)) {
          block.classList.remove("drop-before", "drop-after");
        }
      });

      block.addEventListener("drop", (e) => {
        if (e.target.closest(".loop-c-arm") || e.target.closest(".loop-child-card") || e.target.closest(".ifelse-c-arm") || e.target.closest(".ifelse-child-card")) return;
        const before = block.classList.contains("drop-before");
        block.classList.remove("drop-before", "drop-after");
        if (!dragData) return;
        if (dragData.source === "main" && dragData.id === a.id) return;

        e.preventDefault();
        e.stopPropagation();

        const currentIdx = actions.findIndex((x) => x.id === a.id);
        if (currentIdx === -1) return;
        let targetIdx = before ? currentIdx : currentIdx + 1;
        if (dragData.source === "main" && dragData.fromIdx < targetIdx) {
          targetIdx--;
        }

        moveAction(dragData, { target: "main", targetIdx });
      });

      block.appendChild(card);
      actionFlow.appendChild(block);
    });

    actionFlow.addEventListener("dragover", (e) => {
      if (!dragData) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    actionFlow.addEventListener("drop", (e) => {
      if (e.target === actionFlow && dragData) {
        e.preventDefault();
        moveAction(dragData, { target: "main", targetIdx: actions.length });
      }
    });

    try { renderBreadcrumbs(); } catch (_) {}
  }

  function syncStartInputs() {
    startX.value = Number(pose.x.toFixed(1));
    startY.value = Number(pose.y.toFixed(1));
    startTheta.value = Number(pose.theta.toFixed(1));
  }

  // -- Code generation ----------------------------------------------
  function num(v) {
    return Number(Number(v).toFixed(2));
  }

  function sanitizeIdent(name) {
    let s = String(name || "routine").replace(/[^a-zA-Z0-9_]/g, "_");
    if (/^[0-9]/.test(s)) s = "r_" + s;
    return s || "routine";
  }

  function getIndentString() {
    const sel = document.getElementById("codeIndentSelect");
    if (!sel) return "  ";
    const val = sel.value;
    if (val === "tab") return "\t";
    if (val === "0") return "";
    if (val === "custom") {
      const customInput = document.getElementById("codeIndentCustom");
      const numVal = parseInt(customInput?.value, 10);
      return " ".repeat(isNaN(numVal) ? 2 : Math.max(0, Math.min(16, numVal)));
    }
    const numVal = parseInt(val, 10);
    return " ".repeat(isNaN(numVal) ? 2 : numVal);
  }

  function getCommentStyle() {
    const sel = document.getElementById("codeCommentStyleSelect");
    return sel ? sel.value : (localStorage.getItem("lemlib_code_comment_style") || "inline");
  }

  function emitSingleAction(a, ind, commentStyle) {
    let code = "";
    const cleanComment = cleanCommentText(a.label);
    if (a.type === "custom") {
      if (cleanComment) {
        code += `${ind}// ${cleanComment}\n`;
      }
      const lines = (a.customCode || "").split("\n");
      for (const line of lines) {
        if (line.trim().length === 0) code += "\n";
        else code += `${ind}${line}\n`;
      }
      return code;
    }
    if (a.type === "wait") {
      if (cleanComment && commentStyle === "above") {
        code += `${ind}// ${cleanComment}\n`;
      }
      const commentSuffix = cleanComment && commentStyle !== "above" ? ` // ${cleanComment}` : "";
      if (a.waitType === "distance") {
        code += `${ind}chassis.waitUntil(${a.distance != null ? a.distance : 12});${commentSuffix}\n`;
      } else if (a.waitType === "done") {
        code += `${ind}chassis.waitUntilDone();${commentSuffix}\n`;
      } else if (a.waitType === "time") {
        code += `${ind}pros::delay(${a.delayMs != null ? a.delayMs : 250});${commentSuffix}\n`;
      }
      if (a.customCode && a.customCode.trim()) {
        const lines = a.customCode.trim().split("\n");
        for (const line of lines) {
          if (line.trim().length === 0) code += "\n";
          else code += `${ind}${line}\n`;
        }
      }
      return code;
    }
    if (a.type === "loop") {
      const mode = a.loopMode || "until";
      const cond = (a.condition || "!limit_switch.get_value()").trim();
      if (cleanComment && commentStyle === "above") {
        code += `${ind}// ${cleanComment}\n`;
      }
      const commentSuffix = cleanComment && commentStyle !== "above" ? ` // ${cleanComment}` : "";
      if (mode === "until") {
        code += `${ind}while (!(${cond})) {${commentSuffix}\n`;
      } else if (mode === "for") {
        const tCount = a.times != null ? a.times : 5;
        code += `${ind}for (int i = 0; i < ${tCount}; i++) {${commentSuffix}\n`;
      } else {
        code += `${ind}while (true) {${commentSuffix}\n`;
      }
      if (Array.isArray(a.children) && a.children.length > 0) {
        for (const child of a.children) {
          code += emitSingleAction(child, ind + "  ", commentStyle);
        }
      } else {
        const loopCode = (a.loopCode != null && a.loopCode !== "") ? a.loopCode : (a.loopAction ? "chassis.moveToPoint(24, 24, 2000);" : "chassis.moveToPoint(24, 24, 2000);");
        const lines = loopCode.split("\n");
        for (const line of lines) {
          if (line.trim().length === 0) code += "\n";
          else code += `${ind}  ${line}\n`;
        }
      }
      code += `${ind}}\n`;
      return code;
    }

    const px = a.x + (a.offsetX || 0);
    const py = a.y + (a.offsetY || 0);
    const pt = a.theta + (a.offsetTheta || 0);
    const params = [];
    if (!a.forwards) params.push(".forwards = false");
    if (a.type === "moveToPose" && a.lead != null && Number(a.lead) !== 0.6) {
      params.push(`.lead = ${Number(a.lead)}`);
    }
    if (a.driftScaler != null && Number(a.driftScaler) !== 1.0) {
      params.push(`.horizontalDrift = ${Number(a.driftScaler)}`);
    }
    const defMax = bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127;
    const defMin = bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0;
    if (a.maxSpeed != null && Number(a.maxSpeed) !== Number(defMax)) {
      params.push(`.maxSpeed = ${Number(a.maxSpeed)}`);
    }
    if (a.minSpeed != null && Number(a.minSpeed) !== Number(defMin)) {
      params.push(`.minSpeed = ${Number(a.minSpeed)}`);
    }
    if (a.earlyExitRange) params.push(`.earlyExitRange = ${a.earlyExitRange}`);
    const paramStr = params.length ? `, {${params.join(", ")}}` : "";
    const asyncArg = a.async ? ", true" : "";

    let inlineComment = "";
    if (cleanComment) {
      if (commentStyle === "above") {
        code += `${ind}// ${cleanComment}\n`;
      } else {
        inlineComment = ` // ${cleanComment}`;
      }
    }

    switch (a.type) {
      case "moveToPoint":
        code += `${ind}chassis.moveToPoint(${num(px)}, ${num(py)}, ${a.timeout}${paramStr}${asyncArg});${inlineComment}\n`;
        break;
      case "moveToPose":
        code += `${ind}chassis.moveToPose(${num(px)}, ${num(py)}, ${num(pt)}, ${a.timeout}${paramStr}${asyncArg});${inlineComment}\n`;
        break;
      case "bezierCurve":
        code += `${ind}// Smooth Bezier Spline Arc to (${num(px)}, ${num(py)}, ${num(pt)}°)\n`;
        code += `${ind}chassis.moveToPose(${num(px)}, ${num(py)}, ${num(pt)}, ${a.timeout}${paramStr}${asyncArg});${inlineComment}\n`;
        break;
      case "turnToPoint":
        code += `${ind}chassis.turnToPoint(${num(px)}, ${num(py)}, ${a.timeout}${paramStr}${asyncArg});${inlineComment}\n`;
        break;
      case "turnToHeading":
        code += `${ind}chassis.turnToHeading(${num(pt)}, ${a.timeout}${paramStr}${asyncArg});${inlineComment}\n`;
        break;
      case "swingToPoint":
        code += `${ind}chassis.swingToPoint(${num(px)}, ${num(py)}, DriveSide::${a.lockedSide}, ${a.timeout}${paramStr}${asyncArg});${inlineComment}\n`;
        break;
      case "swingToHeading":
        code += `${ind}chassis.swingToHeading(${num(pt)}, DriveSide::${a.lockedSide}, ${a.timeout}${paramStr}${asyncArg});${inlineComment}\n`;
        break;
      default:
        code += `${ind}// unknown action ${a.type}${inlineComment}\n`;
    }
    return code;
  }

  function emitRoutineBody(pose0, acts, indent) {
    const ind = indent != null ? indent : "  ";
    const commentStyle = getCommentStyle();
    let code = "";
    code += `${ind}chassis.setPose(${num(pose0.x)}, ${num(pose0.y)}, ${num(pose0.theta)});\n`;
    for (const a of acts) {
      if (a.type === "ifElse") {
        const cleanComment = cleanCommentText(a.label);
        const cond = (a.condition || "true").trim();
        if (cleanComment && commentStyle === "above") {
          code += `${ind}// ${cleanComment}\n`;
        }
        const commentSuffix = cleanComment && commentStyle !== "above" ? ` // ${cleanComment}` : "";
        code += `${ind}if (${cond}) {${commentSuffix}\n`;
        if (Array.isArray(a.thenChildren) && a.thenChildren.length > 0) {
          for (const child of a.thenChildren) {
            code += emitSingleAction(child, ind + ind, commentStyle);
          }
        } else {
          const thenCode = (a.thenCode != null && a.thenCode !== "") ? a.thenCode : (a.thenAction ? "chassis.moveToPoint(24, 24, 2000);" : "chassis.moveToPoint(24, 24, 2000);");
          const thenLines = thenCode.split("\n");
          for (const line of thenLines) {
            if (line.trim().length === 0) code += "\n";
            else code += `${ind}${ind}${line}\n`;
          }
        }
        code += `${ind}} else {\n`;
        if (Array.isArray(a.elseChildren) && a.elseChildren.length > 0) {
          for (const child of a.elseChildren) {
            code += emitSingleAction(child, ind + ind, commentStyle);
          }
        } else {
          const elseCode = (a.elseCode != null && a.elseCode !== "") ? a.elseCode : (a.elseAction ? "chassis.moveToPoint(-24, -24, 2000, {.forwards = false});" : "chassis.moveToPoint(-24, -24, 2000, {.forwards = false});");
          const elseLines = elseCode.split("\n");
          for (const line of elseLines) {
            if (line.trim().length === 0) code += "\n";
            else code += `${ind}${ind}${line}\n`;
          }
        }
        code += `${ind}}\n`;
        continue;
      }
      code += emitSingleAction(a, ind, commentStyle);
    }
    return code;
  }

  function generateCode() {
    bindActive();
    activePath().pose = { ...pose };
    activePath().actions = actions;

    const modeEl = document.querySelector('input[name="codeMode"]:checked');
    const mode = modeEl ? modeEl.value : "current";
    const indent = getIndentString();

    let code = `// Auto-generated by VEX LemLib Path Planner\n`;

    // Autonomous Sensor & Strategy Condition Flags
    if (conditions && conditions.length > 0) {
      code += `// Autonomous Sensor & Strategy Condition Flags\n`;
      conditions.forEach((c) => {
        const comment = c.description ? ` // ${c.description}` : "";
        code += `bool ${c.name} = ${c.value ? "true" : "false"};${comment}\n`;
      });
      code += `\n`;
    }

    if (mode === "all") {
      code += `// Autonomous selector — call runAuton(slot) from autonomous()\n\n`;

      paths.forEach((p, i) => {
        const fn = "auton_" + sanitizeIdent(p.name);
        code += `void ${fn}() {\n`;
        code += emitRoutineBody(p.pose, p.actions, indent);
        code += `}\n\n`;
      });

      code += `void runAuton(int slot) {\n`;
      code += `${indent}switch (slot) {\n`;
      paths.forEach((p, i) => {
        const fn = "auton_" + sanitizeIdent(p.name);
        code += `${indent}${indent}case ${i}: ${fn}(); break; // ${p.name}\n`;
      });
      code += `${indent}${indent}default: auton_${sanitizeIdent(paths[0].name)}(); break;\n`;
      code += `${indent}}\n`;
      code += `}\n`;
    } else {
      const p = activePath();
      code += `// Routine: ${p.name}\n\n`;
      code += emitRoutineBody(pose, actions, indent);
    }

    codeOut.value = code;
  }

  function estimateActionTime(a, fromPose) {
    if (!a) return 0;
    if (a.type === "custom") {
      return a.customDuration != null ? Math.max(0, Number(a.customDuration)) : 0;
    }
    const res = simulateAction(a, fromPose || { x: 0, y: 0, theta: 0 }, bot);
    return res.duration;
  }

  function estimateTotalTime() {
    const poses = computePoses();
    let total = 0;
    let i = 0;
    while (i < actions.length) {
      const cur = actions[i];
      const curPose = poses[i] || { x: pose.x, y: pose.y, theta: pose.theta };
      const durA = estimateActionTime(cur, curPose);
      if (cur.async && i < actions.length - 1) {
        const next = actions[i + 1];
        const nextPose = cur.type === "custom" ? curPose : (poses[i + 1] || curPose);
        const durB = estimateActionTime(next, nextPose);
        total += Math.max(durA, durB);
        i += 2;
      } else {
        total += durA;
        i++;
      }
    }
    return total;
  }

  function setDomText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }
  function setDomClass(el, cls) {
    if (el && el.className !== cls) el.className = cls;
  }
  function setDomWidth(el, widthStr) {
    if (el && el.style.width !== widthStr) el.style.width = widthStr;
  }

  function updateTimeDisplay(elapsed, totalEst, currentVLin, currentOmegaDeg, currentPt) {
    const el = document.getElementById("timeEst");
    const hudTime = document.getElementById("simHudTime");
    const hudSpeed = document.getElementById("simHudSpeed");
    const hudCoords = document.getElementById("simHudCoords");
    const btnSimF = document.getElementById("btnSimField");

    const clockLimit = (bot.matchPeriod === "60s") ? 60.0 : 15.0;
    const autonBar = document.getElementById("simAutonProgressBar");
    const clockStatus = document.getElementById("simClockStatus");
    const clockLabel = document.getElementById("simClockLabel");
    const autonMarker = document.getElementById("simAutonMarker");
    const hudAccel = document.getElementById("simHudAccel");
    const hudPower = document.getElementById("simHudPower");
    const hudTraction = document.getElementById("simHudTraction");

    setDomText(clockLabel, `⏱️ ${clockLimit.toFixed(0)}s ${bot.matchPeriod === "60s" ? "Skills" : "Match"} Auton Clock`);
    setDomText(autonMarker, `${clockLimit.toFixed(0)}s`);

    const curTime = (elapsed != null) ? elapsed : (actions.length ? estimateTotalTime() : 0);
    const progressPct = Math.min(100, Math.max(0, (curTime / clockLimit) * 100));
    setDomWidth(autonBar, `${progressPct}%`);

    if (clockStatus) {
      if (curTime <= clockLimit - 1.5) {
        setDomClass(clockStatus, "clock-status legal");
        setDomText(clockStatus, `🟢 Legal (${curTime.toFixed(2)}s / ${clockLimit.toFixed(1)}s)`);
      } else if (curTime <= clockLimit) {
        setDomClass(clockStatus, "clock-status warning");
        setDomText(clockStatus, `🟡 Buffer (${curTime.toFixed(2)}s / ${clockLimit.toFixed(1)}s)`);
      } else {
        setDomClass(clockStatus, "clock-status overtime");
        setDomText(clockStatus, `⚠️ Overtime (+${(curTime - clockLimit).toFixed(2)}s)`);
      }
    }

    const asyncCount = actions.filter((a) => a.async).length;
    const asyncTag = asyncCount > 0 ? ` · ⚡ ${asyncCount} Multitask` : "";
    
    // Determine active robot pose for telemetry
    let activeRobotPose = pose;
    if (simRunning && simPath.length && simPath[simIdx]) {
      activeRobotPose = simPath[simIdx];
    }

    setDomText(hudCoords, `📍 (${activeRobotPose.x.toFixed(1)}", ${activeRobotPose.y.toFixed(1)}") θ=${Math.round(normalizeAngle(activeRobotPose.theta))}°`);

    if (elapsed != null && totalEst != null) {
      let speedText = "";
      if (currentVLin != null && currentOmegaDeg != null) {
        speedText = ` · ${Math.abs(currentVLin).toFixed(1)} in/s · ${Math.abs(currentOmegaDeg).toFixed(0)}°/s`;
        setDomText(hudSpeed, `🏎️ ${Math.abs(currentVLin).toFixed(1)} in/s · ${Math.abs(currentOmegaDeg).toFixed(0)}°/s`);
      }
      setDomText(el, `Time: ${elapsed.toFixed(2)}s / ~${totalEst.toFixed(2)}s${asyncTag}${speedText}`);
      setDomText(hudTime, `⏱ ${elapsed.toFixed(2)}s / ~${totalEst.toFixed(2)}s`);
    } else {
      const t = estimateTotalTime();
      setDomText(el, actions.length ? `Est. time: ~${t.toFixed(2)}s (LemLib)${asyncTag}` : `Est. time: —`);
      setDomText(hudTime, actions.length ? `⏱ ~${t.toFixed(2)}s total` : `⏱ 0.00s`);
      setDomText(hudSpeed, `🏎️ 0.0 in/s`);
    }

    if (currentPt) {
      if (hudAccel) {
        const aLin = currentPt.aLin != null ? Math.round(currentPt.aLin) : 0;
        const gLin = currentPt.gLin != null ? currentPt.gLin.toFixed(2) : "0.00";
        setDomText(hudAccel, `🚀 ${gLin}g (${aLin} in/s²)`);
      }
      if (hudPower) {
        const v = currentPt.voltage != null ? currentPt.voltage.toFixed(1) : (bot.batteryVolts || 12.8).toFixed(1);
        const w = currentPt.watts != null ? Math.round(currentPt.watts) : 0;
        setDomText(hudPower, `⚡ ${v}V · ${w}W`);
      }
      if (hudTraction) {
        if (currentPt.isSlipping) {
          setDomClass(hudTraction, "sim-hud-chip chip-traction slip");
          setDomText(hudTraction, "⚠️ Wheel Slip! (Drift)");
        } else {
          setDomClass(hudTraction, "sim-hud-chip chip-traction");
          const grip = currentPt.gripMargin != null ? currentPt.gripMargin : 100;
          setDomText(hudTraction, `🛞 Grip ${grip}%`);
        }
      }
    } else {
      setDomText(hudAccel, `🚀 0.00g (0 in/s²)`);
      setDomText(hudPower, `⚡ ${(bot.batteryVolts || 12.8).toFixed(1)}V · 0W`);
      if (hudTraction) {
        setDomClass(hudTraction, "sim-hud-chip chip-traction");
        setDomText(hudTraction, `🛞 Grip 100%`);
      }
    }

    const sharpHud = document.getElementById("simHudSharpTurn");
    if (sharpHud) {
      const sharpList = analyzeSharpAngleTransitions();
      if (sharpList.length > 0) {
        setDomClass(sharpHud, "sim-hud-chip chip-sharp-turn");
        setDomText(sharpHud, `⚡ ${sharpList.length} Sharp ${sharpList.length === 1 ? 'Turn' : 'Turns'}`);
      } else {
        setDomClass(sharpHud, "sim-hud-chip chip-sharp-turn clean");
        setDomText(sharpHud, `✨ Smooth Transitions`);
      }
    }

    if (btnSimF) {
      if (simRunning) {
        if (!btnSimF.classList.contains("playing")) btnSimF.classList.add("playing");
        const txt = btnSimF.querySelector(".hud-btn-text");
        setDomText(txt, "Pause");
      } else {
        if (btnSimF.classList.contains("playing")) btnSimF.classList.remove("playing");
        const txt = btnSimF.querySelector(".hud-btn-text");
        setDomText(txt, "Simulate");
      }
    }

    // Update Real-Time Collision HUD Chip & Status
    const hudColChip = document.getElementById("simHudCollision");
    const hudColStatus = document.getElementById("hudCollisionStatus");
    if (hudColChip) {
      if (!collisionConfig.enabled) {
        setDomClass(hudColChip, "sim-hud-chip chip-collision");
        setDomText(hudColChip, "🛡️ Off");
        if (hudColStatus) {
          hudColStatus.textContent = "Off";
          hudColStatus.className = "hud-collision-badge";
        }
      } else if (elapsed != null && currentPt != null) {
        // Live simulation collision check
        const liveCol = checkRobotCollisionAtPose(currentPt.x, currentPt.y, currentPt.theta, collisionConfig.safetyBuffer);
        if (liveCol.hit) {
          setDomClass(hudColChip, "sim-hud-chip chip-collision collision-alert");
          const hitName = liveCol.obstacles.map(o => o.name).join(", ");
          setDomText(hudColChip, `💥 HIT: ${hitName}`);
          if (hudColStatus) {
            hudColStatus.textContent = "HIT!";
            hudColStatus.className = "hud-collision-badge hit";
          }
        } else {
          setDomClass(hudColChip, "sim-hud-chip chip-collision legal");
          setDomText(hudColChip, "🛡️ Clear");
          if (hudColStatus) {
            hudColStatus.textContent = "Clear";
            hudColStatus.className = "hud-collision-badge clean";
          }
        }
      } else {
        // Static trajectory evaluation
        const rep = evaluateRoutineCollisions();
        if (rep.totalCollisions === 0) {
          setDomClass(hudColChip, "sim-hud-chip chip-collision legal");
          setDomText(hudColChip, "🛡️ Clear");
          if (hudColStatus) {
            hudColStatus.textContent = "Clear";
            hudColStatus.className = "hud-collision-badge clean";
          }
        } else {
          setDomClass(hudColChip, "sim-hud-chip chip-collision collision-alert");
          setDomText(hudColChip, `⚠️ ${rep.totalCollisions} Hit${rep.totalCollisions > 1 ? "s" : ""}`);
          if (hudColStatus) {
            hudColStatus.textContent = `${rep.totalCollisions} Hits`;
            hudColStatus.className = "hud-collision-badge hit";
          }
        }
      }
    }
  }

  function buildSimPath() {
    if (!isSimPathDirty && simSegments.length > 0) return;
    const wasDirty = isSimPathDirty;
    simSegments = [];
    simPath = [];
    let cur = { x: pose.x, y: pose.y, theta: pose.theta };
    let t = 0;
    const initPhys = calculateStepPhysics(0, 0, 0, 0.01, getRobotPhysicsProps(bot), bot);
    simPath.push({ ...cur, t: 0, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys });

    for (const a of actions) {
      const seg = simulateAction(a, cur, bot);
      simSegments.push({
        action: a,
        points: seg.path,
        endPose: seg.endPose,
        duration: seg.duration,
        carrot: seg.carrot,
      });

      const segPts = seg.path;
      for (let i = 1; i < segPts.length; i++) {
        const pt = segPts[i];
        simPath.push({
          x: pt.x,
          y: pt.y,
          theta: pt.theta,
          t: t + pt.t,
          vLin: pt.vLin,
          omegaDeg: pt.omegaDeg,
          targetVLin: pt.targetVLin != null ? pt.targetVLin : 0,
          targetOmega: pt.targetOmega != null ? pt.targetOmega : 0,
          aLin: pt.aLin != null ? pt.aLin : 0,
          gLin: pt.gLin != null ? pt.gLin : 0,
          gLateral: pt.gLateral != null ? pt.gLateral : 0,
          gTotal: pt.gTotal != null ? pt.gTotal : 0,
          isSlipping: !!pt.isSlipping,
          gripMargin: pt.gripMargin != null ? pt.gripMargin : 100,
          voltage: pt.voltage != null ? pt.voltage : (bot.batteryVolts || 12.8),
          current: pt.current != null ? pt.current : 0,
          watts: pt.watts != null ? pt.watts : 0,
        });
      }
      t += seg.duration;
      cur = { ...seg.endPose };
    }
    isSimPathDirty = false;

    if (wasDirty && (typeof drag === "undefined" || drag == null) && !simRunning && !isPathAnimating) {
      triggerPathAnimation();
    }
  }

  function startSim() {
    pathAnimProgress = 1.0;
    isPathAnimating = false;
    if (pathAnimFrameId) {
      cancelAnimationFrame(pathAnimFrameId);
      pathAnimFrameId = null;
    }
    if (!actions.length) {
      showToast("⚠️ Add at least one movement action to simulate.");
      return;
    }
    if (simRunning) {
      // Pause
      simRunning = false;
      if (animId) cancelAnimationFrame(animId);
      updateTimeDisplay();
      return;
    }
    buildSimPath();
    simRunning = true;
    simIdx = 0;
    const startTime = performance.now();
    const totalT = simPath.length ? simPath[simPath.length - 1].t : 0;
    const totalEst = estimateTotalTime();
    const startPt = simPath.length ? simPath[0] : null;
    updateTimeDisplay(0, totalEst, 0, 0, startPt);

    function frame(now) {
      if (!simRunning) return;
      const elapsed = ((now - startTime) / 1000) * simSpeed;
      
      // High-performance binary search to find the correct index in O(log N)
      let low = 0;
      let high = simPath.length - 1;
      let idx = 0;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (simPath[mid].t <= elapsed) {
          idx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      simIdx = idx;
      const pt = simPath[simIdx] || { vLin: 0, omegaDeg: 0 };
      const curElapsed = Math.min(elapsed, totalT);

      // Check real-time collision during simulation
      if (collisionConfig.enabled && collisionConfig.stopSimOnCollision) {
        const liveCol = checkRobotCollisionAtPose(pt.x, pt.y, pt.theta, collisionConfig.safetyBuffer);
        if (liveCol.hit) {
          simRunning = false;
          updateTimeDisplay(curElapsed, totalEst, 0, 0, pt);
          draw();
          drawPidTuningGraph(curElapsed);
          const hitNames = liveCol.obstacles.map((o) => o.name).join(", ");
          showToast(`💥 Collision detected: ${hitNames}! Simulation auto-paused.`);
          return;
        }
      }

      updateTimeDisplay(curElapsed, totalEst, pt.vLin, pt.omegaDeg, pt);
      draw();
      drawPidTuningGraph(curElapsed);
      if (elapsed < totalT + 0.15) animId = requestAnimationFrame(frame);
      else {
        simRunning = false;
        updateTimeDisplay(totalT, totalEst, 0, 0, pt);
        draw();
        drawPidTuningGraph(totalT);
      }
    }
    animId = requestAnimationFrame(frame);
  }

  function stopSim() {
    simRunning = false;
    if (animId) cancelAnimationFrame(animId);
    simIdx = 0;
    updateTimeDisplay();
    draw();
    drawPidTuningGraph(0);
  }

  function drawPidTuningGraph(elapsedTime = 0) {
    const canvas = document.getElementById("pidTuningCanvas");
    if (!canvas || canvas.offsetParent === null) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Handle high DPI display
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.floor(rect.width * dpr);
    const targetH = Math.floor(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear canvas
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

    // If there is no simPath, or if it is dirty, build it first
    if (!simPath.length || isSimPathDirty) {
      try { buildSimPath(); } catch (_) {}
    }

    // Grid lines
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    for (let x = 30; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 15; y < height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (!simPath.length) return;

    const totalT = simPath[simPath.length - 1].t;
    const maxT = Math.max(5.0, totalT);

    // Find the maximum absolute value in the path for scale
    let maxVal = 12; // default scale range of at least 12 in/s
    if (tuningGraphType === "linear") {
      simPath.forEach((pt) => {
        maxVal = Math.max(maxVal, Math.abs(pt.vLin), Math.abs(pt.targetVLin));
      });
    } else {
      maxVal = 45; // default scale range of at least 45 deg/s
      simPath.forEach((pt) => {
        maxVal = Math.max(maxVal, Math.abs(pt.omegaDeg), Math.abs(pt.targetOmega));
      });
    }
    // Add 15% margin
    maxVal *= 1.15;

    // Mapping helper functions
    function getX(t) {
      // Leave 10px margin on right/left
      return 10 + (t / maxT) * (width - 20);
    }
    function getY(val) {
      // Graph is bi-directional (values can be negative!)
      // Center of graph represents 0
      const center = height / 2;
      return center - (val / maxVal) * (height / 2 - 10);
    }

    // Draw zero line
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(0));
    ctx.lineTo(getX(maxT), getY(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw target path (blue #60a5fa)
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    simPath.forEach((pt, i) => {
      const val = tuningGraphType === "linear" ? pt.targetVLin : pt.targetOmega;
      if (i === 0) {
        ctx.moveTo(getX(pt.t), getY(val));
      } else {
        ctx.lineTo(getX(pt.t), getY(val));
      }
    });
    ctx.stroke();

    // Draw actual path (green #4ade80)
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 2;
    ctx.beginPath();
    simPath.forEach((pt, i) => {
      const val = tuningGraphType === "linear" ? pt.vLin : pt.omegaDeg;
      if (i === 0) {
        ctx.moveTo(getX(pt.t), getY(val));
      } else {
        ctx.lineTo(getX(pt.t), getY(val));
      }
    });
    ctx.stroke();

    // Draw vertical cursor at elapsedTime
    const cursorX = getX(elapsedTime);
    ctx.strokeStyle = "rgba(226, 232, 240, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();

    // Find the closest point to elapsedTime for display
    let low = 0;
    let high = simPath.length - 1;
    let idx = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (simPath[mid].t <= elapsedTime) {
        idx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const pt = simPath[idx] || { vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0 };
    const targetVal = tuningGraphType === "linear" ? pt.targetVLin : pt.targetOmega;
    const actualVal = tuningGraphType === "linear" ? pt.vLin : pt.omegaDeg;

    // Draw intersection circles
    ctx.fillStyle = "#60a5fa";
    ctx.beginPath();
    ctx.arc(cursorX, getY(targetVal), 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.arc(cursorX, getY(actualVal), 4, 0, Math.PI * 2);
    ctx.fill();

    // Update HTML values
    const timeValEl = document.getElementById("pidTuningTimeVal");
    const targetValEl = document.getElementById("pidTuningTargetVal");
    const actualValEl = document.getElementById("pidTuningActualVal");

    if (timeValEl) timeValEl.textContent = `${elapsedTime.toFixed(2)}s / ${totalT.toFixed(1)}s`;
    if (targetValEl) {
      targetValEl.textContent = tuningGraphType === "linear" 
        ? `${targetVal.toFixed(1)} in/s` 
        : `${targetVal.toFixed(1)} °/s`;
    }
    if (actualValEl) {
      actualValEl.textContent = tuningGraphType === "linear" 
        ? `${actualVal.toFixed(1)} in/s` 
        : `${actualVal.toFixed(1)} °/s`;
    }
  }

  // -- Hit testing / drag -------------------------------------------
  function hitTest(cx, cy) {
    const s = fieldToCanvas(pose.x, pose.y);
    const scale = getFieldScale();
    const botHitR = Math.max(HIT_R + 4, Math.min(bot.robotW, bot.robotL) * scale * 0.48);
    if (Math.hypot(cx - s.cx, cy - s.cy) < botHitR) return { kind: "start" };

    const poses = computePoses();

    // Check selected Bezier handles first so they are easy to grab
    if (selectedId) {
      const si = actions.findIndex((x) => x.id === selectedId);
      if (si >= 0 && actions[si].type === "bezierCurve") {
        const a = actions[si];
        const fromPt = si === 0 ? pose : (simSegments[si - 1]?.endPose || poses[si] || pose);
        const { cp1, cp2 } = getBezierControlPoints(a, fromPt);
        const p1 = fieldToCanvas(cp1.x, cp1.y);
        const p2 = fieldToCanvas(cp2.x, cp2.y);
        if (Math.hypot(cx - p1.cx, cy - p1.cy) < HIT_R + 4) return { kind: "action", id: a.id, handle: "cp1" };
        if (Math.hypot(cx - p2.cx, cy - p2.cy) < HIT_R + 4) return { kind: "action", id: a.id, handle: "cp2" };
      }
    }

    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (!needsPoint(a.type) && !isMove(a.type)) continue;
      const p = fieldToCanvas(a.x, a.y);
      if (Math.hypot(cx - p.cx, cy - p.cy) < HIT_R) return { kind: "action", id: a.id, handle: "target" };
      // Also allow clicking on the robot settled pose for turn/swing
      if (poses[i + 1]) {
        const rp = fieldToCanvas(poses[i + 1].x, poses[i + 1].y);
        if (Math.hypot(cx - rp.cx, cy - rp.cy) < HIT_R) return { kind: "action", id: a.id, handle: "robot" };
      }
    }
    return null;
  }

  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      cx: (e.clientX - rect.left) * scaleX,
      cy: (e.clientY - rect.top) * scaleY,
    };
  }

  // -- Events -------------------------------------------------------
  canvas.addEventListener("mousedown", (e) => {
    const { cx, cy } = canvasCoords(e);
    const hit = hitTest(cx, cy);
    if (hit) {
      // snapshot before drag so undo restores pre-drag pose/waypoint
      historyDragBaseline = cloneState();
      drag = hit;
      selectedId = hit.kind === "start" ? "start" : hit.id;
      renderFlow();
      draw();
      e.preventDefault();
    }
    // Empty click does NOT create moves — use + Add button only
  });

  window.addEventListener("mousemove", (e) => {
    const { cx, cy } = canvasCoords(e);
    const { x, y } = canvasToField(cx, cy);
    coordsEl.textContent = `X: ${x.toFixed(1)}  Y: ${y.toFixed(1)}`;

    if (!drag) return;
    if (drag.kind === "start") {
      const snapped = snapToWall(x, y);
      pose.x = snapped.x;
      pose.y = snapped.y;
      syncStartInputs();
      markDirty();
      draw();
    } else if (drag.kind === "action") {
      const si = actions.findIndex((z) => z.id === drag.id);
      if (si < 0) return;
      const a = actions[si];

      if (drag.handle === "cp1") {
        a.cp1X = Number(x.toFixed(1));
        a.cp1Y = Number(y.toFixed(1));
        coordsEl.textContent = `CP1 (Departure Tangent): X: ${a.cp1X}  Y: ${a.cp1Y}`;
        markDirty();
        renderFlow();
        draw();
        return;
      }
      if (drag.handle === "cp2") {
        a.cp2X = Number(x.toFixed(1));
        a.cp2Y = Number(y.toFixed(1));
        coordsEl.textContent = `CP2 (Arrival Tangent): X: ${a.cp2X}  Y: ${a.cp2Y}`;
        markDirty();
        renderFlow();
        draw();
        return;
      }

      if (a.type === "swingToPoint") {
        const poses = computePoses();
        const fromPose = (si === 0 ? pose : (simSegments[si - 1]?.endPose || poses[si])) || pose;

        // Raw angle from start pose of this swing to mouse cursor
        const rawAngle = angleToPoint(fromPose.x, fromPose.y, x, y);
        // Snap to 22.5° increment (shift key allows free continuous angle dragging)
        const snappedTheta = e.shiftKey ? rawAngle : snapAngle22_5(rawAngle);

        // Robot center position after swinging to snappedTheta
        const endC = applySwing(fromPose.x, fromPose.y, fromPose.theta, snappedTheta, a.lockedSide);

        // Heading unit vector (reverse if backwards)
        const dirRad = (snappedTheta * Math.PI) / 180;
        const fwdX = a.forwards === false ? -Math.sin(dirRad) : Math.sin(dirRad);
        const fwdY = a.forwards === false ? -Math.cos(dirRad) : Math.cos(dirRad);

        // Radial distance along the rotation radius axis:
        let dist = 18;
        if (drag.handle === "robot") {
          dist = Math.max(10, Math.hypot(a.x - endC.x, a.y - endC.y) || 18);
        } else {
          const dx = x - endC.x;
          const dy = y - endC.y;
          const projDist = dx * fwdX + dy * fwdY;
          dist = Math.max(10, projDist);
        }

        a.x = Number((endC.x + fwdX * dist).toFixed(1));
        a.y = Number((endC.y + fwdY * dist).toFixed(1));

        coordsEl.textContent = `X: ${a.x.toFixed(1)}  Y: ${a.y.toFixed(1)} | θ: ${snappedTheta.toFixed(1)}° (22.5° snap) | Radius: ${dist.toFixed(1)}"`;
        if (collisionConfig.enabled) {
          const dragCol = checkRobotCollisionAtPose(a.x, a.y, snappedTheta, collisionConfig.safetyBuffer);
          if (dragCol.hit) {
            coordsEl.textContent += ` | ⚠️ COLLISION: ${dragCol.obstacles.map((o) => o.name).join(", ")}`;
          }
        }
        markDirty();
        renderFlow();
        draw();
      } else {
        a.x = Number(x.toFixed(1));
        a.y = Number(y.toFixed(1));
        coordsEl.textContent = `X: ${a.x.toFixed(1)}  Y: ${a.y.toFixed(1)}`;
        if (collisionConfig.enabled) {
          const poses = computePoses();
          const theta = a.theta != null ? a.theta : (poses[si] ? poses[si].theta : 0);
          const dragCol = checkRobotCollisionAtPose(a.x, a.y, theta, collisionConfig.safetyBuffer);
          if (dragCol.hit) {
            coordsEl.textContent += ` | ⚠️ COLLISION: ${dragCol.obstacles.map((o) => o.name).join(", ")}`;
          }
        }
        markDirty();
        renderFlow();
        draw();
      }
    }
  });


  let openHelp = () => {};
  let closeHelp = () => {};

  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      // allow undo in inputs only with extra care — skip when typing
      return;
    }

    if (e.key === "Escape") {
      const help = document.getElementById("helpModal");
      if (help && !help.hidden) {
        closeHelp();
        return;
      }
      closeClearModal();
      return;
    }

    if ((e.key === "?" || e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openHelp();
      return;
    }

    if (e.key === " ") {
      e.preventDefault();
      if (simRunning) stopSim();
      else startSim();
      return;
    }

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (key === "z" && e.shiftKey) {
      e.preventDefault();
      redo();
    } else if (key === "y" && !e.metaKey) {
      // Ctrl+Y redo (Windows)
      e.preventDefault();
      redo();
    }
  });

  window.addEventListener("mouseup", () => {
    if (drag && historyDragBaseline) {
      // commit post-drag state; baseline already discarded from stack tip if needed
      pushHistory("drag");
      historyDragBaseline = null;
    }
    drag = null;
  });

  // Touch support for dragging points on mobile / touch displays
  canvas.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const { cx, cy } = canvasCoords(t);
    const hit = hitTest(cx, cy);
    if (hit) {
      historyDragBaseline = cloneState();
      drag = hit;
      selectedId = hit.kind === "start" ? "start" : hit.id;
      renderFlow();
      draw();
      e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener("touchmove", (e) => {
    if (!drag || !e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const { cx, cy } = canvasCoords(t);
    const { x, y } = canvasToField(cx, cy);
    coordsEl.textContent = `X: ${x.toFixed(1)}  Y: ${y.toFixed(1)}`;

    if (drag.kind === "start") {
      const snapped = snapToWall(x, y);
      pose.x = snapped.x;
      pose.y = snapped.y;
      syncStartInputs();
      markDirty();
      draw();
    } else if (drag.kind === "action") {
      const a = actions.find((z) => z.id === drag.id);
      if (a) {
        if (drag.handle === "cp1") {
          a.cp1X = Number(x.toFixed(1));
          a.cp1Y = Number(y.toFixed(1));
          markDirty();
          renderFlow();
          draw();
          e.preventDefault();
          return;
        }
        if (drag.handle === "cp2") {
          a.cp2X = Number(x.toFixed(1));
          a.cp2Y = Number(y.toFixed(1));
          markDirty();
          renderFlow();
          draw();
          e.preventDefault();
          return;
        }
        a.x = Number(x.toFixed(1));
        a.y = Number(y.toFixed(1));
        markDirty();
        renderFlow();
        draw();
      }
    }
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("touchend", () => {
    if (drag && historyDragBaseline) {
      pushHistory("drag");
      historyDragBaseline = null;
    }
    drag = null;
  });

  [startX, startY, startTheta].forEach((el) => {
    el.addEventListener("change", () => {
      let x = Number(startX.value);
      let y = Number(startY.value);
      const snapped = snapToWall(x, y);
      pose.x = snapped.x;
      pose.y = snapped.y;
      pose.theta = Number(startTheta.value);
      syncStartInputs();
      markDirty();
      draw();
    });
  });

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.preset;
      let next = { ...pose };
      if (p === "redL") next = { x: -60, y: -60, theta: 0 };
      if (p === "redR") next = { x: 60, y: -60, theta: 0 };
      if (p === "blueL") next = { x: -60, y: 60, theta: 180 };
      if (p === "blueR") next = { x: 60, y: 60, theta: 180 };
      pose.x = next.x;
      pose.y = next.y;
      pose.theta = next.theta;
      activePath().pose = pose;
      syncStartInputs();
      markDirty();
      draw();
    });
  });

  document.getElementById("btnAddAction").onclick = () => {
    const type = newType.value;
    const a = defaultAction(type);
    const poses = computePoses();
    const last = poses[poses.length - 1];
    if (needsPoint(type) || isMove(type)) {
      a.x = Number((last.x + 12).toFixed(1));
      a.y = Number(last.y.toFixed(1));
    }
    if (needsHeading(type)) a.theta = last.theta;
    if (type === "ifElse") {
      const defMax = bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127;
      const defMin = bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0;
      a.thenAction = {
        type: "moveToPoint",
        x: Number((last.x + 24).toFixed(1)),
        y: Number((last.y + 24).toFixed(1)),
        timeout: 2000,
        forwards: true,
        maxSpeed: defMax,
        minSpeed: defMin,
        earlyExitRange: 0,
      };
      a.thenCode = `chassis.moveToPoint(${a.thenAction.x}, ${a.thenAction.y}, 2000);`;
      a.elseAction = {
        type: "moveToPoint",
        x: Number((last.x - 24).toFixed(1)),
        y: Number((last.y - 24).toFixed(1)),
        timeout: 2000,
        forwards: false,
        maxSpeed: defMax,
        minSpeed: defMin,
        earlyExitRange: 0,
      };
      a.elseCode = `chassis.moveToPoint(${a.elseAction.x}, ${a.elseAction.y}, 2000, {.forwards = false});`;
    }
    actions.push(a);
    selectedId = a.id;
    markDirty();
    renderFlow();
    draw();
    generateCode();
  };

  // Block Palette Event Handler
  const paletteBar = document.querySelector(".palette-bar");
  if (paletteBar) {
    paletteBar.addEventListener("click", (e) => {
      const btnBlock = e.target.closest("[data-act-type]");
      const btnSnip = e.target.closest("[data-snip-add]");
      
      if (btnBlock) {
        const type = btnBlock.getAttribute("data-act-type");
        const a = defaultAction(type);
        const poses = computePoses();
        const last = poses[poses.length - 1];
        if (needsPoint(type) || isMove(type)) {
          a.x = Number((last.x + 12).toFixed(1));
          a.y = Number(last.y.toFixed(1));
        }
        if (needsHeading(type)) a.theta = last.theta;
        if (type === "ifElse") {
          const defMax = bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127;
          const defMin = bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0;
          a.thenAction = {
            type: "moveToPoint",
            x: Number((last.x + 24).toFixed(1)),
            y: Number((last.y + 24).toFixed(1)),
            timeout: 2000,
            forwards: true,
            maxSpeed: defMax,
            minSpeed: defMin,
            earlyExitRange: 0,
          };
          a.thenCode = `chassis.moveToPoint(${a.thenAction.x}, ${a.thenAction.y}, 2000);`;
          a.elseAction = {
            type: "moveToPoint",
            x: Number((last.x - 24).toFixed(1)),
            y: Number((last.y - 24).toFixed(1)),
            timeout: 2000,
            forwards: false,
            maxSpeed: defMax,
            minSpeed: defMin,
            earlyExitRange: 0,
          };
          a.elseCode = `chassis.moveToPoint(${a.elseAction.x}, ${a.elseAction.y}, 2000, {.forwards = false});`;
        }
        actions.push(a);
        selectedId = a.id;
        markDirty();
        renderFlow();
        draw();
        generateCode();
      } else if (btnSnip) {
        const snipCode = btnSnip.getAttribute("data-snip-add");
        const a = defaultAction("custom");
        a.customCode = snipCode;
        actions.push(a);
        selectedId = a.id;
        markDirty();
        renderFlow();
        draw();
        generateCode();
      }
    });
  }

  // Block Palette Search & Category Filtering
  const paletteSearchInput = document.getElementById("paletteSearchInput");
  const paletteSearchClear = document.getElementById("paletteSearchClear");
  const catChips = document.querySelectorAll(".palette-bar .cat-chip");
  const paletteButtons = document.querySelectorAll(".palette-block-list .palette-block-btn");

  let activeCategory = "all";

  function filterPalette() {
    const query = paletteSearchInput ? paletteSearchInput.value.trim().toLowerCase() : "";
    if (paletteSearchClear) {
      paletteSearchClear.style.display = query ? "block" : "none";
    }

    paletteButtons.forEach(btn => {
      const cat = btn.getAttribute("data-category") || "";
      const keywords = (btn.getAttribute("data-keywords") || "").toLowerCase();
      const text = btn.textContent.toLowerCase();

      const matchesCategory = (activeCategory === "all" || cat === activeCategory);
      const matchesQuery = (!query || keywords.includes(query) || text.includes(query));

      if (matchesCategory && matchesQuery) {
        btn.style.display = "inline-flex";
      } else {
        btn.style.display = "none";
      }
    });
  }

  if (paletteSearchInput) {
    paletteSearchInput.addEventListener("input", filterPalette);
  }
  if (paletteSearchClear) {
    paletteSearchClear.addEventListener("click", () => {
      if (paletteSearchInput) {
        paletteSearchInput.value = "";
        filterPalette();
        paletteSearchInput.focus();
      }
    });
  }

  catChips.forEach(chip => {
    chip.addEventListener("click", () => {
      catChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeCategory = chip.getAttribute("data-cat") || "all";
      filterPalette();
    });
  });

  document.getElementById("btnClear").onclick = () => {
    openClearModal();
  };

  const btnSimHeader = document.getElementById("btnSim");
  if (btnSimHeader) btnSimHeader.onclick = startSim;
  const btnStopHeader = document.getElementById("btnStop");
  if (btnStopHeader) btnStopHeader.onclick = stopSim;

  const simSpeedInput = document.getElementById("simSpeed");
  const simSpeedFieldInput = document.getElementById("simSpeedField");
  const hudSpeedValEl = document.getElementById("hudSpeedVal");

  function setSimSpeedValue(val) {
    simSpeed = Number(val);
    if (speedLabel) speedLabel.textContent = simSpeed + "×";
    const speedLabelField = document.getElementById("speedLabelField");
    if (speedLabelField) speedLabelField.textContent = simSpeed + "×";
    if (simSpeedInput) simSpeedInput.value = simSpeed;
    if (simSpeedFieldInput) simSpeedFieldInput.value = simSpeed;
    if (hudSpeedValEl) hudSpeedValEl.textContent = simSpeed + "×";
  }

  if (simSpeedInput) {
    simSpeedInput.oninput = (e) => setSimSpeedValue(e.target.value);
  }
  if (simSpeedFieldInput) {
    simSpeedFieldInput.oninput = (e) => setSimSpeedValue(e.target.value);
  }

  // Floating Simulation HUD Buttons
  const btnSimField = document.getElementById("btnSimField");
  if (btnSimField) btnSimField.onclick = startSim;
  const btnStopField = document.getElementById("btnStopField");
  if (btnStopField) btnStopField.onclick = stopSim;

  // Segmented Tab Switcher for Left Sidebar (Routine, Conditions, Bot & PID, C++ Code)
  let newCondInitialVal = true;
  let condSearchQuery = "";

  function switchPlannerTab(tab) {
    const tabBtnFlowchart = document.getElementById("tabBtnFlowchart");
    const tabBtnConditions = document.getElementById("tabBtnConditions");
    const tabBtnBot = document.getElementById("tabBtnBot");
    const tabBtnCode = document.getElementById("tabBtnCode");

    const paneFlowchart = document.getElementById("paneTabFlowchart");
    const paneConditions = document.getElementById("paneTabConditions");
    const paneBot = document.getElementById("paneTabBot");
    const paneCode = document.getElementById("paneTabCode");

    const allTabs = [tabBtnFlowchart, tabBtnConditions, tabBtnBot, tabBtnCode];
    const allPanes = [paneFlowchart, paneConditions, paneBot, paneCode];
    allTabs.forEach((t) => { if (t) t.classList.remove("active"); });
    allPanes.forEach((p) => { if (p) p.style.display = "none"; });

    if (tab === "flowchart") {
      if (tabBtnFlowchart) tabBtnFlowchart.classList.add("active");
      if (paneFlowchart) paneFlowchart.style.display = "flex";
    } else if (tab === "conditions") {
      if (tabBtnConditions) tabBtnConditions.classList.add("active");
      if (paneConditions) paneConditions.style.display = "flex";
      renderConditionManager();
    } else if (tab === "bot") {
      if (tabBtnBot) tabBtnBot.classList.add("active");
      if (paneBot) paneBot.style.display = "flex";
      syncBotInputs();
      syncBotVisualUI();
    } else if (tab === "code") {
      if (tabBtnCode) tabBtnCode.classList.add("active");
      if (paneCode) paneCode.style.display = "flex";
      generateCode();
    }
  }

  function toggleConditionVariableValue(id) {
    const cond = conditions.find((c) => c.id === id);
    if (!cond) return;
    cond.value = !cond.value;
    saveLocal(true);
    renderConditionManager();

    // Dynamically update If/Else blocks evaluating this condition
    actions.forEach((a) => {
      if (a.type === "ifElse") {
        const condExpr = (a.condition || "").trim();
        if (condExpr === cond.name || condExpr === `!${cond.name}` || condExpr.includes(cond.name)) {
          const evalRes = evaluateConditionExpression(a.condition);
          a.activeSimBranch = evalRes ? "then" : "else";
        }
      }
    });

    renderFlow();
    draw();
    updateTimeDisplay();
    generateCode();
    showToast(`🔀 '${cond.name}' set to ${cond.value ? 'TRUE' : 'FALSE'}. Path simulation updated.`);
  }

  function addNewConditionVariable(name, value, description) {
    const cleanName = sanitizeConditionName(name);
    if (!cleanName) {
      alert("Please enter a valid C++ identifier name (e.g., isGoalLoaded).");
      return;
    }
    if (conditions.some((c) => c.name === cleanName)) {
      alert(`A condition variable named "${cleanName}" already exists.`);
      return;
    }
    const newCond = {
      id: "cond_" + uid(),
      name: cleanName,
      value: !!value,
      description: (description || "").trim(),
      type: "boolean",
    };
    conditions.push(newCond);
    saveLocal(true);
    renderConditionManager();
    renderFlow();
    generateCode();
    showToast(`✓ Added boolean variable '${cleanName}'`);
  }

  function deleteConditionVariable(id) {
    const cond = conditions.find((c) => c.id === id);
    if (!cond) return;
    if (!confirm(`Delete boolean variable "${cond.name}"?`)) return;
    const deletedName = cond.name;
    conditions = conditions.filter((c) => c.id !== id);
    saveLocal(true);
    renderConditionManager();
    renderFlow();
    generateCode();
    showToast(`🗑️ Deleted variable '${deletedName}'`);
  }

  function editConditionVariable(id) {
    const cond = conditions.find((c) => c.id === id);
    if (!cond) return;
    const newName = prompt("Edit variable identifier:", cond.name);
    if (newName === null) return;
    const cleanName = sanitizeConditionName(newName);
    if (!cleanName) {
      alert("Invalid identifier.");
      return;
    }
    if (cleanName !== cond.name && conditions.some((c) => c.name === cleanName)) {
      alert(`A variable named "${cleanName}" already exists.`);
      return;
    }
    const oldName = cond.name;
    const newDesc = prompt("Edit description / sensor note:", cond.description || "");
    if (newDesc !== null) cond.description = newDesc.trim();

    if (cleanName !== oldName) {
      actions.forEach((a) => {
        if (a.type === "ifElse" && a.condition === oldName) {
          a.condition = cleanName;
        }
      });
      cond.name = cleanName;
    }

    saveLocal(true);
    renderConditionManager();
    renderFlow();
    generateCode();
    showToast(`✓ Updated variable '${cond.name}'`);
  }

  function renderConditionManager() {
    const listEl = document.getElementById("conditionVarList");
    const countBadge = document.getElementById("condActiveCountBadge");
    const tabCountBadge = document.getElementById("tabConditionCount");
    const cppPreview = document.getElementById("condCppPreview");
    const usageListEl = document.getElementById("condIfElseUsageList");
    const usageCountBadge = document.getElementById("condIfElseCountBadge");

    if (tabCountBadge) tabCountBadge.textContent = conditions.length;
    if (countBadge) countBadge.textContent = `${conditions.length} Variable${conditions.length === 1 ? '' : 's'}`;

    // C++ Declaration Preview
    if (cppPreview) {
      if (conditions.length === 0) {
        cppPreview.textContent = "// No boolean variables defined yet";
      } else {
        let cppText = "// Autonomous Condition & Sensor Flags\n";
        conditions.forEach((c) => {
          const comment = c.description ? ` // ${c.description}` : "";
          cppText += `bool ${c.name} = ${c.value ? "true" : "false"};${comment}\n`;
        });
        cppPreview.textContent = cppText;
      }
    }

    // Determine usage in active routine
    const ifElseBlocks = actions.filter((a) => a.type === "ifElse");
    if (usageCountBadge) usageCountBadge.textContent = `${ifElseBlocks.length} block${ifElseBlocks.length === 1 ? '' : 's'}`;
    if (usageListEl) {
      if (ifElseBlocks.length === 0) {
        usageListEl.innerHTML = `<span style="color:#64748b;font-style:italic;">No If/Else blocks in active routine. Add one from the Block Palette or click '⚡ Use in If/Else' on any variable below.</span>`;
      } else {
        usageListEl.innerHTML = ifElseBlocks.map((a, idx) => {
          const cond = (a.condition || "true").trim();
          const evalRes = evaluateConditionExpression(cond);
          const matched = conditions.some((c) => cond.includes(c.name));
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:rgba(0,0,0,0.35);border-radius:4px;border-left:3px solid ${matched ? '#38bdf8' : '#64748b'};">
              <span style="font-family:monospace;font-weight:700;color:${matched ? '#38bdf8' : '#e2e8f0'};font-size:0.75rem;">#${idx + 1} if (${escapeHtml(cond)})</span>
              <span style="font-size:0.68rem;padding:2px 6px;border-radius:4px;background:${evalRes ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'};color:${evalRes ? '#34d399' : '#f87171'};font-weight:700;">
                Sim: ${evalRes ? 'Then branch' : 'Else branch'}
              </span>
            </div>
          `;
        }).join("");
      }
    }

    if (!listEl) return;

    let filtered = conditions;
    if (condSearchQuery) {
      const q = condSearchQuery.toLowerCase();
      filtered = conditions.filter((c) => c.name.toLowerCase().includes(q) || (c.description && c.description.toLowerCase().includes(q)));
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:18px 8px;background:rgba(15,23,42,0.5);border:1px dashed #334155;border-radius:8px;color:#94a3b8;font-size:0.75rem;">
          ${condSearchQuery ? 'No matching variables found.' : 'No condition variables defined yet.<br>Use the form above or pick a quick preset to add one!'}
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map((c) => {
      const isUsedInActive = ifElseBlocks.some((a) => (a.condition || "").includes(c.name));
      return `
        <div class="cond-item-card ${isUsedInActive ? 'active-in-routine' : ''}" data-id="${c.id}">
          <div class="cond-item-header">
            <span class="cond-name-code">
              <span style="color:#a78bfa;font-size:0.72rem;font-weight:700;">bool</span>
              <strong>${escapeHtml(c.name)}</strong>
              ${isUsedInActive ? '<span title="Active in current routine" style="font-size:0.65rem;color:#38bdf8;background:rgba(56,189,248,0.15);padding:1px 5px;border-radius:3px;font-weight:700;">⚡ Active</span>' : ''}
            </span>
            <span class="cond-val-badge ${c.value ? 'val-true' : 'val-false'}" data-act="toggle-var-val" data-id="${c.id}" title="Simulated value: ${c.value ? 'true' : 'false'}. Click to toggle truth state.">
              ${c.value ? '✓ TRUE (1)' : '✕ FALSE (0)'}
            </span>
          </div>
          ${c.description ? `<div class="cond-item-desc">${escapeHtml(c.description)}</div>` : ''}
          <div class="cond-item-actions">
            <button type="button" class="btn-cond-action primary" data-act="use-in-ifelse" data-name="${escapeHtml(c.name)}" title="Set or insert an If/Else block using this condition">⚡ Use in If/Else</button>
            <button type="button" class="btn-cond-action" data-act="copy-cpp-var" data-name="${escapeHtml(c.name)}" data-val="${c.value}" title="Copy C++ code snippet">📋 Copy C++</button>
            <button type="button" class="btn-cond-action" data-act="edit-var" data-id="${c.id}" title="Edit name &amp; notes">✏️ Edit</button>
            <button type="button" class="btn-cond-action danger" data-act="delete-var" data-id="${c.id}" title="Delete variable">🗑️</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function wireConditionManager() {
    // Initial value selector pills
    const pillTrue = document.getElementById("pillValTrue");
    const pillFalse = document.getElementById("pillValFalse");

    if (pillTrue && pillFalse) {
      pillTrue.onclick = () => {
        newCondInitialVal = true;
        pillTrue.classList.add("active");
        pillFalse.classList.remove("active");
      };
      pillFalse.onclick = () => {
        newCondInitialVal = false;
        pillFalse.classList.add("active");
        pillTrue.classList.remove("active");
      };
    }

    // Quick preset chips
    const pane = document.getElementById("paneTabConditions");
    if (pane) {
      pane.querySelectorAll(".cond-quick-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const varName = chip.dataset.var;
          const varVal = chip.dataset.val === "true";
          const varDesc = chip.dataset.desc || "";
          const inputName = document.getElementById("newCondNameInput");
          const inputDesc = document.getElementById("newCondDescInput");
          if (inputName) inputName.value = varName;
          if (inputDesc) inputDesc.value = varDesc;
          newCondInitialVal = varVal;
          if (pillTrue && pillFalse) {
            if (varVal) {
              pillTrue.classList.add("active");
              pillFalse.classList.remove("active");
            } else {
              pillFalse.classList.add("active");
              pillTrue.classList.remove("active");
            }
          }
          addNewConditionVariable(varName, varVal, varDesc);
        });
      });
    }

    // Add New Condition Button
    const btnAdd = document.getElementById("btnAddNewCondition");
    const inputName = document.getElementById("newCondNameInput");
    const inputDesc = document.getElementById("newCondDescInput");

    if (btnAdd) {
      btnAdd.onclick = () => {
        const name = inputName ? inputName.value : "";
        const desc = inputDesc ? inputDesc.value : "";
        if (!name.trim()) {
          if (inputName) inputName.focus();
          return;
        }
        addNewConditionVariable(name, newCondInitialVal, desc);
        if (inputName) inputName.value = "";
        if (inputDesc) inputDesc.value = "";
      };
    }
    if (inputName) {
      inputName.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (btnAdd) btnAdd.click();
        }
      });
    }

    // Search input
    const searchInput = document.getElementById("condSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        condSearchQuery = e.target.value.trim();
        renderConditionManager();
      });
    }

    // Preset Pack Add
    const btnAddPresets = document.getElementById("btnCondAddPresetPack");
    if (btnAddPresets) {
      btnAddPresets.onclick = () => {
        DEFAULT_CONDITIONS.forEach((def) => {
          if (!conditions.some((c) => c.name === def.name)) {
            conditions.push({ ...def, id: "cond_" + uid() });
          }
        });
        saveLocal(true);
        renderConditionManager();
        renderFlow();
        generateCode();
        showToast("✓ Added competition preset condition variables!");
      };
    }

    // Reset Defaults
    const btnResetDefaults = document.getElementById("btnCondResetDefaults");
    if (btnResetDefaults) {
      btnResetDefaults.onclick = () => {
        if (!confirm("Reset all condition variables to factory competition defaults?")) return;
        conditions = JSON.parse(JSON.stringify(DEFAULT_CONDITIONS));
        saveLocal(true);
        renderConditionManager();
        renderFlow();
        generateCode();
        showToast("✓ Reset condition variables to defaults.");
      };
    }

    // Copy C++ Preview
    const btnCopyCpp = document.getElementById("btnCopyCondCpp");
    if (btnCopyCpp) {
      btnCopyCpp.onclick = async () => {
        const cppPreview = document.getElementById("condCppPreview");
        if (!cppPreview) return;
        try {
          await navigator.clipboard.writeText(cppPreview.textContent);
        } catch (_) {
          const ta = document.createElement("textarea");
          ta.value = cppPreview.textContent;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        const orig = btnCopyCpp.textContent;
        btnCopyCpp.textContent = "✓ Copied!";
        setTimeout(() => { btnCopyCpp.textContent = orig; }, 1800);
      };
    }

    // Variable Item List Delegated Actions
    const varListEl = document.getElementById("conditionVarList");
    if (varListEl) {
      varListEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        const name = btn.dataset.name;

        if (act === "toggle-var-val") {
          toggleConditionVariableValue(id);
          return;
        }
        if (act === "edit-var") {
          editConditionVariable(id);
          return;
        }
        if (act === "delete-var") {
          deleteConditionVariable(id);
          return;
        }
        if (act === "copy-cpp-var") {
          const val = btn.dataset.val === "true";
          const snippet = `bool ${name} = ${val ? "true" : "false"};`;
          try {
            navigator.clipboard.writeText(snippet);
          } catch (_) {
            const ta = document.createElement("textarea");
            ta.value = snippet;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
          }
          showToast(`📋 Copied '${snippet}' to clipboard!`);
          return;
        }
        if (act === "use-in-ifelse") {
          let targetIf = actions.find((a) => a.id === selectedId && a.type === "ifElse");
          if (!targetIf) {
            targetIf = actions.find((a) => a.type === "ifElse");
          }

          if (targetIf) {
            targetIf.condition = name;
            const evalRes = evaluateConditionExpression(name);
            targetIf.activeSimBranch = evalRes ? "then" : "else";
            selectedId = targetIf.id;
          } else {
            const newIf = defaultAction("ifElse");
            newIf.condition = name;
            const evalRes = evaluateConditionExpression(name);
            newIf.activeSimBranch = evalRes ? "then" : "else";
            actions.push(newIf);
            selectedId = newIf.id;
          }

          markDirty();
          renderFlow();
          draw();
          updateTimeDisplay();
          generateCode();
          switchPlannerTab("flowchart");
          showToast(`⚡ Configured If/Else block with condition '${name}'!`);
          return;
        }
      });
    }
  }

  function wirePlannerTabsAndModes() {
    const tabBtnFlowchart = document.getElementById("tabBtnFlowchart");
    const tabBtnConditions = document.getElementById("tabBtnConditions");
    const tabBtnBot = document.getElementById("tabBtnBot");
    const tabBtnCode = document.getElementById("tabBtnCode");

    if (tabBtnFlowchart) tabBtnFlowchart.onclick = () => switchPlannerTab("flowchart");
    if (tabBtnConditions) tabBtnConditions.onclick = () => switchPlannerTab("conditions");
    if (tabBtnBot) tabBtnBot.onclick = () => switchPlannerTab("bot");
    if (tabBtnCode) tabBtnCode.onclick = () => switchPlannerTab("code");

    wireConditionManager();
    renderConditionManager();

    // Header Mode Nav
    const navPlanner = document.getElementById("navModePlanner");
    const navPidTuner = document.getElementById("navModePidTuner");
    const navBrain = document.getElementById("navModeBrain");

    if (navPlanner) {
      navPlanner.onclick = (e) => {
        e.preventDefault();
        showPlannerView();
      };
    }
    if (navPidTuner) {
      navPidTuner.onclick = (e) => {
        e.preventDefault();
        const modal = document.getElementById("pidModal");
        if (modal) {
          modal.hidden = false;
          modal.classList.add("open");
        }
      };
    }
    if (navBrain) {
      navBrain.onclick = (e) => {
        e.preventDefault();
        const modal = document.getElementById("brainModal");
        if (modal) {
          modal.hidden = false;
          modal.classList.add("open");
        }
      };
    }

    const btnOpenPidBot = document.getElementById("btnOpenPidFromBot");
    if (btnOpenPidBot) {
      btnOpenPidBot.onclick = () => {
        const modal = document.getElementById("pidModal");
        if (modal) {
          modal.hidden = false;
          modal.classList.add("open");
        }
      };
    }
  }

  document.getElementById("btnGenerate").onclick = generateCode;

  const btnCopy = document.getElementById("btnCopy");
  if (btnCopy) {
    btnCopy.onclick = async () => {
      codeOut.select();
      try {
        await navigator.clipboard.writeText(codeOut.value);
      } catch (_) {
        document.execCommand("copy");
      }
      const orig = btnCopy.textContent;
      btnCopy.textContent = "✓ Copied to Clipboard!";
      btnCopy.classList.add("copied");
      setTimeout(() => {
        btnCopy.textContent = orig;
        btnCopy.classList.remove("copied");
      }, 1800);
    };
  }

  const indentSel = document.getElementById("codeIndentSelect");
  const indentCustom = document.getElementById("codeIndentCustom");
  if (indentSel) {
    const savedIndent = localStorage.getItem("lemlib_code_indent");
    if (savedIndent) {
      if (["0", "2", "4", "tab"].includes(savedIndent)) {
        indentSel.value = savedIndent;
      } else {
        indentSel.value = "custom";
        if (indentCustom) {
          indentCustom.value = savedIndent;
          indentCustom.style.display = "inline-block";
        }
      }
    }
    indentSel.addEventListener("change", () => {
      if (indentSel.value === "custom") {
        if (indentCustom) indentCustom.style.display = "inline-block";
      } else {
        if (indentCustom) indentCustom.style.display = "none";
        localStorage.setItem("lemlib_code_indent", indentSel.value);
      }
      generateCode();
    });
  }
  if (indentCustom) {
    indentCustom.addEventListener("input", () => {
      localStorage.setItem("lemlib_code_indent", indentCustom.value);
      generateCode();
    });
  }

  document.querySelectorAll('input[name="codeMode"]').forEach((radio) => {
    radio.addEventListener("change", generateCode);
  });

  document.getElementById("btnExport").onclick = exportVPath;
  document.getElementById("btnImport").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    if (fileInput.files[0]) importVPath(fileInput.files[0]);
    fileInput.value = "";
  };

  function initBotImageElement() {
    if (bot.botImage) {
      if (!botImgElement) botImgElement = new Image();
      botImgElement.onload = () => {
        botImgReady = true;
        syncBotVisualUI();
        draw();
      };
      botImgElement.onerror = () => {
        botImgReady = false;
        draw();
      };
      botImgElement.src = bot.botImage;
    } else {
      botImgReady = false;
    }
  }

  function setBotImage(dataUrl, autoAdjustDims = true) {
    if (!dataUrl) {
      bot.botImage = null;
      botImgReady = false;
      syncBotVisualUI();
      markDirty();
      draw();
      return;
    }
    const temp = new Image();
    temp.onload = () => {
      let finalData = dataUrl;
      const maxDim = 900;
      let dw = temp.naturalWidth;
      let dh = temp.naturalHeight;
      if (dw > maxDim || dh > maxDim) {
        if (dw > dh) {
          dh = Math.round((dh * maxDim) / dw);
          dw = maxDim;
        } else {
          dw = Math.round((dw * maxDim) / dh);
          dh = maxDim;
        }
        try {
          const off = document.createElement("canvas");
          off.width = dw;
          off.height = dh;
          const offCtx = off.getContext("2d");
          offCtx.drawImage(temp, 0, 0, dw, dh);
          finalData = off.toDataURL("image/png");
        } catch (_) {}
      }
      bot.botImage = finalData;
      bot.botImageNaturalRatio = temp.naturalWidth / Math.max(1, temp.naturalHeight);
      bot.botImageEnabled = true;

      if (autoAdjustDims && Math.abs(bot.botImageNaturalRatio - 1.0) > 0.05) {
        const isUpDown = (bot.botImageOrientation === 0 || bot.botImageOrientation === 180);
        const newL = isUpDown 
          ? bot.robotW / bot.botImageNaturalRatio 
          : bot.robotW * bot.botImageNaturalRatio;
        bot.robotL = Number(Math.max(1, newL).toFixed(1));
        const elL = document.getElementById("robotL");
        if (elL) elL.value = bot.robotL;
      }

      if (!botImgElement) botImgElement = new Image();
      botImgElement.onload = () => {
        botImgReady = true;
        syncBotVisualUI();
        markDirty();
        draw();
      };
      botImgElement.onerror = () => {
        botImgReady = false;
        draw();
      };
      botImgElement.src = finalData;
    };
    temp.onerror = () => {
      alert("Could not load image. Please provide a valid image file (PNG, JPG, SVG, WebP).");
    };
    temp.src = dataUrl;
  }

  function syncBotVisualUI() {
    const el = (id) => document.getElementById(id);
    const hasImg = !!bot.botImage;

    const btnToggle = el("btnToggleBotImg");
    if (btnToggle) {
      const isEnabled = bot.botImageEnabled !== false;
      btnToggle.textContent = isEnabled ? "👁️ Picture: ON" : "👁️ Picture: OFF";
      btnToggle.className = "btn-bot-img-toggle" + (isEnabled ? " active" : "");
    }

    const previewWrap = el("botImgPreviewWrap");
    const uploadContent = el("botImgUploadContent");
    const controls = el("botImgControls");
    const thumb = el("botImgThumb");
    const thumbTag = el("botThumbFrontTag");
    const thumbSize = el("botThumbSize");
    const thumbScale = el("botThumbScale");
    const dimLabel = el("botDimLabel");
    const lockRatio = el("botLockRatio");
    const orient = el("botImgOrientation");
    const opacityInput = el("botImgOpacity");
    const opacityVal = el("botOpacityVal");
    const showOutline = el("botShowOutline");

    const scale = canvas ? getFieldScale() : 5;
    const wPx = (bot.robotW * scale).toFixed(0);
    const lPx = (bot.robotL * scale).toFixed(0);
    const pctField = ((bot.robotW / FIELD_IN) * 100).toFixed(1);

    if (hasImg) {
      if (previewWrap) previewWrap.style.display = "flex";
      if (uploadContent) uploadContent.style.display = "none";
      if (controls) controls.style.display = "flex";
      if (thumb) {
        thumb.src = bot.botImage;
        const o = Number(bot.botImageOrientation) || 0;
        thumb.style.transform = `rotate(${o}deg)`;
      }
      if (thumbTag) {
        const o = Number(bot.botImageOrientation) || 0;
        const arrows = { 0: "FRONT ↑", 90: "FRONT →", 180: "FRONT ↓", 270: "FRONT ←" };
        thumbTag.textContent = arrows[o] || "FRONT ↑";
      }
      if (thumbSize) thumbSize.textContent = `${bot.robotW.toFixed(1)}" × ${bot.robotL.toFixed(1)}"`;
      if (thumbScale) thumbScale.textContent = `Field scale: ${wPx}×${lPx}px (${pctField}% of field)`;
      if (dimLabel) dimLabel.textContent = `${bot.robotW.toFixed(1)}" × ${bot.robotL.toFixed(1)}" (${wPx}×${lPx}px)`;
      if (lockRatio) lockRatio.checked = !!bot.botLockRatio;
      if (orient) orient.value = String(bot.botImageOrientation || 0);
      const op = Math.round((bot.botImageOpacity != null ? bot.botImageOpacity : 1) * 100);
      if (opacityInput) opacityInput.value = op;
      if (opacityVal) opacityVal.textContent = op + "%";
      if (showOutline) showOutline.checked = bot.botImageShowOutline !== false;
    } else {
      if (previewWrap) previewWrap.style.display = "none";
      if (uploadContent) uploadContent.style.display = "flex";
      if (controls) controls.style.display = "none";
      if (dimLabel) dimLabel.textContent = `${bot.robotW.toFixed(1)}" × ${bot.robotL.toFixed(1)}" (${wPx}×${lPx}px)`;
    }
  }

  function wireBotVisualCard() {
    const fileInput = document.getElementById("botImgFileInput");
    const btnUpload = document.getElementById("btnUploadBotImg");
    const btnChange = document.getElementById("btnChangeBotImg");
    const btnPreset = document.getElementById("btnPresetBotImg");
    const btnClear = document.getElementById("btnClearBotImg");
    const btnToggle = document.getElementById("btnToggleBotImg");
    const dropZone = document.getElementById("botImgDropZone");
    const orientSelect = document.getElementById("botImgOrientation");
    const rotCW = document.getElementById("btnBotRotCW");
    const rotCCW = document.getElementById("btnBotRotCCW");
    const opacityInput = document.getElementById("botImgOpacity");
    const showOutline = document.getElementById("botShowOutline");
    const lockRatio = document.getElementById("botLockRatio");

    const handleFile = (file) => {
      if (!file || !file.type.startsWith("image/")) {
        alert("Please provide an image file (PNG, JPG, SVG, WebP).");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        setBotImage(e.target.result);
      };
      reader.readAsDataURL(file);
    };

    if (btnUpload && fileInput) btnUpload.addEventListener("click", () => fileInput.click());
    if (btnChange && fileInput) btnChange.addEventListener("click", () => fileInput.click());
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
        fileInput.value = "";
      });
    }

    if (btnPreset) {
      btnPreset.addEventListener("click", () => {
        const svgUrl = "data:image/svg+xml;utf8," + encodeURIComponent(SAMPLE_BOT_VEX_SVG);
        setBotImage(svgUrl, false);
      });
    }

    if (btnClear) {
      btnClear.addEventListener("click", () => {
        setBotImage(null);
      });
    }

    if (btnToggle) {
      btnToggle.addEventListener("click", () => {
        bot.botImageEnabled = !(bot.botImageEnabled !== false);
        syncBotVisualUI();
        markDirty();
        draw();
      });
    }

    if (dropZone) {
      dropZone.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("select") || e.target.closest("input")) return;
        if (!bot.botImage && fileInput) fileInput.click();
      });
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
      });
      dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
      });
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFile(e.dataTransfer.files[0]);
        }
      });
    }

    // Canvas drag-and-drop: dropping a bot picture on the field
    const canvasWrap = canvas ? canvas.closest(".canvas-wrap") : null;
    if (canvasWrap) {
      canvasWrap.addEventListener("dragover", (e) => {
        if (e.dataTransfer && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          canvasWrap.classList.add("field-drag-over");
        }
      });
      canvasWrap.addEventListener("dragleave", (e) => {
        if (!canvasWrap.contains(e.relatedTarget)) {
          canvasWrap.classList.remove("field-drag-over");
        }
      });
      canvasWrap.addEventListener("drop", (e) => {
        canvasWrap.classList.remove("field-drag-over");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          const f = e.dataTransfer.files[0];
          if (f.type.startsWith("image/")) {
            e.preventDefault();
            handleFile(f);
          }
        }
      });
    }

    // Clipboard paste support for bot image
    window.addEventListener("paste", (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
      if (activeTag === "input" || activeTag === "textarea") return;
      if (e.clipboardData && e.clipboardData.items) {
        for (let item of e.clipboardData.items) {
          if (item.type.startsWith("image/")) {
            const blob = item.getAsFile();
            if (blob) {
              handleFile(blob);
              break;
            }
          }
        }
      }
    });

    if (orientSelect) {
      orientSelect.addEventListener("change", () => {
        bot.botImageOrientation = Number(orientSelect.value) || 0;
        syncBotVisualUI();
        markDirty();
        draw();
      });
    }

    if (rotCW) {
      rotCW.addEventListener("click", () => {
        bot.botImageOrientation = (((Number(bot.botImageOrientation) || 0) + 90) % 360);
        syncBotVisualUI();
        markDirty();
        draw();
      });
    }

    if (rotCCW) {
      rotCCW.addEventListener("click", () => {
        bot.botImageOrientation = ((((Number(bot.botImageOrientation) || 0) - 90) % 360 + 360) % 360);
        syncBotVisualUI();
        markDirty();
        draw();
      });
    }

    if (opacityInput) {
      opacityInput.addEventListener("input", () => {
        bot.botImageOpacity = Number(opacityInput.value) / 100;
        syncBotVisualUI();
        draw();
      });
      opacityInput.addEventListener("change", () => {
        markDirty();
      });
    }

    if (showOutline) {
      showOutline.addEventListener("change", () => {
        bot.botImageShowOutline = showOutline.checked;
        markDirty();
        draw();
      });
    }

    if (lockRatio) {
      lockRatio.addEventListener("change", () => {
        bot.botLockRatio = lockRatio.checked;
        if (bot.botLockRatio && bot.botImageNaturalRatio) {
          const isUpDown = (bot.botImageOrientation === 0 || bot.botImageOrientation === 180);
          const newL = isUpDown 
            ? bot.robotW / bot.botImageNaturalRatio 
            : bot.robotW * bot.botImageNaturalRatio;
          bot.robotL = Number(Math.max(1, newL).toFixed(1));
          const elL = document.getElementById("robotL");
          if (elL) elL.value = bot.robotL;
        }
        syncBotVisualUI();
        markDirty();
        draw();
      });
    }
  }

  function syncBotInputs() {
    const el = (id) => document.getElementById(id);
    if (el("trackWidth")) el("trackWidth").value = bot.trackWidth != null ? bot.trackWidth : 12;
    if (el("robotW")) el("robotW").value = bot.robotW != null ? bot.robotW : 14;
    if (el("robotL")) el("robotL").value = bot.robotL != null ? bot.robotL : 14;
    if (el("wheelDiam")) el("wheelDiam").value = bot.wheelDiam != null ? bot.wheelDiam : 3.25;
    if (el("wheelDiamPreset")) el("wheelDiamPreset").value = String(bot.wheelDiam != null ? bot.wheelDiam : 3.25);
    if (el("driveRpm")) el("driveRpm").value = bot.driveRpm != null ? bot.driveRpm : 600;
    if (el("driveRpmPreset")) el("driveRpmPreset").value = String(bot.driveRpm != null ? bot.driveRpm : 600);
    if (el("defaultMaxSpeed")) el("defaultMaxSpeed").value = bot.defaultMaxSpeed != null ? bot.defaultMaxSpeed : 127;
    if (el("defaultMinSpeed")) el("defaultMinSpeed").value = bot.defaultMinSpeed != null ? bot.defaultMinSpeed : 0;
    if (el("botLateralDrift")) el("botLateralDrift").value = bot.lateralDrift != null ? bot.lateralDrift : 1.0;
    if (el("botTurnDrift")) el("botTurnDrift").value = bot.turnDrift != null ? bot.turnDrift : 1.0;
    if (el("botDefaultLead")) el("botDefaultLead").value = bot.defaultLead != null ? bot.defaultLead : 0.6;

    // LemLib Lateral Controller
    if (el("botLateralKp")) el("botLateralKp").value = bot.lateralKp != null ? bot.lateralKp : 8.0;
    if (el("botLateralKi")) el("botLateralKi").value = bot.lateralKi != null ? bot.lateralKi : 0.0;
    if (el("botLateralKd")) el("botLateralKd").value = bot.lateralKd != null ? bot.lateralKd : 30.0;
    if (el("botLateralWindup")) el("botLateralWindup").value = bot.lateralWindup != null ? bot.lateralWindup : 3.0;
    if (el("botLateralSmallErr")) el("botLateralSmallErr").value = bot.lateralSmallErr != null ? bot.lateralSmallErr : 1.0;
    if (el("botLateralSmallTime")) el("botLateralSmallTime").value = bot.lateralSmallTime != null ? bot.lateralSmallTime : 100;
    if (el("botLateralLargeErr")) el("botLateralLargeErr").value = bot.lateralLargeErr != null ? bot.lateralLargeErr : 3.0;
    if (el("botLateralLargeTime")) el("botLateralLargeTime").value = bot.lateralLargeTime != null ? bot.lateralLargeTime : 500;
    if (el("botLateralSlew")) el("botLateralSlew").value = bot.lateralSlew != null ? bot.lateralSlew : 0;

    // LemLib Angular Controller
    if (el("botAngularKp")) el("botAngularKp").value = bot.angularKp != null ? bot.angularKp : 2.0;
    if (el("botAngularKi")) el("botAngularKi").value = bot.angularKi != null ? bot.angularKi : 0.0;
    if (el("botAngularKd")) el("botAngularKd").value = bot.angularKd != null ? bot.angularKd : 10.0;
    if (el("botAngularWindup")) el("botAngularWindup").value = bot.angularWindup != null ? bot.angularWindup : 3.0;
    if (el("botAngularSmallErr")) el("botAngularSmallErr").value = bot.angularSmallErr != null ? bot.angularSmallErr : 1.0;
    if (el("botAngularSmallTime")) el("botAngularSmallTime").value = bot.angularSmallTime != null ? bot.angularSmallTime : 100;
    if (el("botAngularLargeErr")) el("botAngularLargeErr").value = bot.angularLargeErr != null ? bot.angularLargeErr : 3.0;
    if (el("botAngularLargeTime")) el("botAngularLargeTime").value = bot.angularLargeTime != null ? bot.angularLargeTime : 500;
    if (el("botAngularSlew")) el("botAngularSlew").value = bot.angularSlew != null ? bot.angularSlew : 0;

    // Odometry & Sensors
    if (el("horizTrackerOffset")) el("horizTrackerOffset").value = bot.horizTrackerOffset != null ? bot.horizTrackerOffset : -2.5;
    if (el("horizTrackerDiam")) el("horizTrackerDiam").value = bot.horizTrackerWheelDiam != null ? bot.horizTrackerWheelDiam : 2.0;
    if (el("imuSensorPort")) el("imuSensorPort").value = bot.imuPort != null ? bot.imuPort : 10;

    // Sync detail text
    if (el("botSyncDetail")) {
      el("botSyncDetail").textContent = `${bot.driveRpm || 600} RPM · ${bot.wheelDiam || 3.25}" Wheels · ${bot.trackWidth || 12}" Track`;
    }

    initBotImageElement();
    syncBotVisualUI();
  }

  function wireBotSettings() {
    const map = {
      trackWidth: "trackWidth",
      robotW: "robotW",
      robotL: "robotL",
      wheelDiam: "wheelDiam",
      driveRpm: "driveRpm",
      defaultMaxSpeed: "defaultMaxSpeed",
      defaultMinSpeed: "defaultMinSpeed",
      lateralDrift: "botLateralDrift",
      turnDrift: "botTurnDrift",
      defaultLead: "botDefaultLead",
      // Lateral PID
      lateralKp: "botLateralKp",
      lateralKi: "botLateralKi",
      lateralKd: "botLateralKd",
      lateralWindup: "botLateralWindup",
      lateralSmallErr: "botLateralSmallErr",
      lateralSmallTime: "botLateralSmallTime",
      lateralLargeErr: "botLateralLargeErr",
      lateralLargeTime: "botLateralLargeTime",
      lateralSlew: "botLateralSlew",
      // Angular PID
      angularKp: "botAngularKp",
      angularKi: "botAngularKi",
      angularKd: "botAngularKd",
      angularWindup: "botAngularWindup",
      angularSmallErr: "botAngularSmallErr",
      angularSmallTime: "botAngularSmallTime",
      angularLargeErr: "botAngularLargeErr",
      angularLargeTime: "botAngularLargeTime",
      angularSlew: "botAngularSlew",
      // Sensors
      horizTrackerOffset: "horizTrackerOffset",
      horizTrackerWheelDiam: "horizTrackerDiam",
      imuPort: "imuSensorPort",
    };

    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        let v = Number(el.value);
        if (key === "defaultMaxSpeed" || key === "defaultMinSpeed") {
          v = Math.max(0, Math.min(127, isNaN(v) ? bot[key] : v));
          el.value = v;
        }
        if (key === "defaultLead") {
          v = Math.max(0, Math.min(1.0, isNaN(v) ? bot[key] : v));
          el.value = v;
        }
        if (key === "lateralDrift" || key === "turnDrift") {
          v = Math.max(0.1, Math.min(5.0, isNaN(v) ? bot[key] : v));
          el.value = v;
        }
        bot[key] = isNaN(v) ? bot[key] : v;

        // Keep dropdown presets in sync
        if (key === "wheelDiam") {
          const sel = document.getElementById("wheelDiamPreset");
          if (sel) sel.value = String(v);
        }
        if (key === "driveRpm") {
          const sel = document.getElementById("driveRpmPreset");
          if (sel) sel.value = String(v);
        }

        // Aspect ratio locking between robotW and robotL based on photo ratio
        if (key === "robotW" && bot.botLockRatio && bot.botImageNaturalRatio) {
          const isUpDown = (bot.botImageOrientation === 0 || bot.botImageOrientation === 180);
          const newL = isUpDown 
            ? bot.robotW / bot.botImageNaturalRatio 
            : bot.robotW * bot.botImageNaturalRatio;
          bot.robotL = Number(Math.max(1, newL).toFixed(1));
          const elL = document.getElementById("robotL");
          if (elL) elL.value = bot.robotL;
        } else if (key === "robotL" && bot.botLockRatio && bot.botImageNaturalRatio) {
          const isUpDown = (bot.botImageOrientation === 0 || bot.botImageOrientation === 180);
          const newW = isUpDown 
            ? bot.robotL * bot.botImageNaturalRatio 
            : bot.robotL / bot.botImageNaturalRatio;
          bot.robotW = Number(Math.max(1, newW).toFixed(1));
          const elW = document.getElementById("robotW");
          if (elW) elW.value = bot.robotW;
        }

        const syncDetail = document.getElementById("botSyncDetail");
        if (syncDetail) {
          syncDetail.textContent = `${bot.driveRpm || 600} RPM · ${bot.wheelDiam || 3.25}" Wheels · ${bot.trackWidth || 12}" Track`;
        }

        syncBotVisualUI();
        markDirty();
        renderFlow();
        draw();
        updateTimeDisplay();
      });
    });

    // Preset dropdowns
    const wheelPreset = document.getElementById("wheelDiamPreset");
    if (wheelPreset) {
      wheelPreset.addEventListener("change", () => {
        const val = Number(wheelPreset.value);
        if (!isNaN(val)) {
          bot.wheelDiam = val;
          const wInput = document.getElementById("wheelDiam");
          if (wInput) wInput.value = val;
          markDirty();
          renderFlow();
          draw();
          updateTimeDisplay();
        }
      });
    }

    const driveRpmPreset = document.getElementById("driveRpmPreset");
    if (driveRpmPreset) {
      driveRpmPreset.addEventListener("change", () => {
        const val = Number(driveRpmPreset.value);
        if (!isNaN(val)) {
          bot.driveRpm = val;
          const rpmInput = document.getElementById("driveRpm");
          if (rpmInput) rpmInput.value = val;
          markDirty();
          renderFlow();
          draw();
          updateTimeDisplay();
        }
      });
    }

    // PID sub-tabs in sidebar
    const btnTabLat = document.getElementById("btnBotPidTabLat");
    const btnTabAng = document.getElementById("btnBotPidTabAng");
    const latCard = document.getElementById("botPidLatCard");
    const angCard = document.getElementById("botPidAngCard");

    if (btnTabLat && btnTabAng && latCard && angCard) {
      btnTabLat.addEventListener("click", () => {
        btnTabLat.style.background = "#0284c7";
        btnTabLat.style.color = "#fff";
        btnTabAng.style.background = "transparent";
        btnTabAng.style.color = "#94a3b8";
        latCard.style.display = "block";
        angCard.style.display = "none";
      });

      btnTabAng.addEventListener("click", () => {
        btnTabAng.style.background = "#0284c7";
        btnTabAng.style.color = "#fff";
        btnTabLat.style.background = "transparent";
        btnTabLat.style.color = "#94a3b8";
        angCard.style.display = "block";
        latCard.style.display = "none";
      });
    }

    // Two-way sync buttons with src/robot-config.cpp
    const btnSyncFromCpp = document.getElementById("btnSyncBotFromCpp");
    if (btnSyncFromCpp) {
      btnSyncFromCpp.addEventListener("click", () => {
        if (window.ProjectManager && typeof window.ProjectManager.extractLemLibConfig === "function") {
          const cfg = window.ProjectManager.extractLemLibConfig();
          if (cfg) {
            Object.assign(bot, cfg);
            syncBotInputs();
            markDirty();
            renderFlow();
            draw();
            updateTimeDisplay();
            showToast("🔄 Successfully synchronized bot specs & PID from src/robot-config.cpp!");
            return;
          }
        }
        showToast("ℹ️ robot-config.cpp already matches current robot setup!");
      });
    }

    const btnSaveToCpp = document.getElementById("btnSaveBotToCpp");
    if (btnSaveToCpp) {
      btnSaveToCpp.addEventListener("click", () => {
        if (window.ProjectManager && typeof window.ProjectManager.updateRobotConfigCpp === "function") {
          window.ProjectManager.updateRobotConfigCpp(bot);
          showToast("💾 Updated src/robot-config.cpp with current LemLib bot specs & PID constants!");
        } else {
          showToast("💾 Bot settings stored and applied to simulation!");
        }
      });
    }
  }

  
  // -- Google auth + cloud path sync (Firebase) --------------------
  let cloudUser = null;
  let cloudReady = false;
  let cloudSaveTimer = null;
  let cloudApplying = false; // prevent save loop while loading remote

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

  function setCloudStatus(text, cls) {
    const el = document.getElementById("cloudStatus");
    if (!el) return;
    el.textContent = text || "";
    el.className = "cloud-status" + (cls ? " " + cls : "");
  }

  function pathPayload() {
    bindActive();
    activePath().pose = pose;
    activePath().actions = actions;
    return {
      version: 2,
      paths,
      activePathId,
      bot,
      updatedAt: new Date().toISOString(),
    };
  }

  function applyPathPayload(data) {
    if (!data) return;
    cloudApplying = true;
    try {
      if (data.bot) bot = { ...bot, ...data.bot };
      if (Array.isArray(data.paths) && data.paths.length) {
        paths = data.paths;
        activePathId = data.activePathId || paths[0].id;
      } else if (data.pose || data.actions) {
        paths = [{
          id: uidPath(),
          name: "Cloud",
          pose: data.pose || { x: -60, y: -60, theta: 0 },
          actions: data.actions || [],
        }];
        activePathId = paths[0].id;
      }
      bindActive();
      selectedId = null;
      syncPathSelect();
      syncBotInputs();
      syncStartInputs();
      renderFlow();
      draw();
      generateCode();
      updateTimeDisplay();
    } finally {
      cloudApplying = false;
    }
  }

  let cloudProjectUnsub = null;
  let cloudPollTimer = null;

  function subscribeToCloudProject(uid) {
    if (cloudProjectUnsub) {
      try { cloudProjectUnsub(); } catch (_) {}
      cloudProjectUnsub = null;
    }
    if (cloudPollTimer) {
      clearInterval(cloudPollTimer);
      cloudPollTimer = null;
    }
    if (!uid) return;

    // Periodic check on server cloud project status
    cloudPollTimer = setInterval(async () => {
      if (document.visibilityState !== "visible" || window.ProjectManager?.isDirty || cloudApplying) return;
      try {
        const email = cloudUser?.email || localStorage.getItem(AUTH_EMAIL_KEY) || "";
        const params = new URLSearchParams();
        if (uid) params.set("uid", uid);
        if (email) params.set("email", email);
        const srvUrl = getApiUrl(`/api/project/status?${params.toString()}`);
        if (srvUrl) {
          const res = await fetch(srvUrl);
          if (res.ok) {
            const st = await res.json();
            if (st.exists) {
              const serverTime = Number(st.updatedAt) || 0;
              const isLocalDefault = window.ProjectManager?.isDefaultProject ? window.ProjectManager.isDefaultProject() : false;
              const localTime = isLocalDefault ? 0 : (window.ProjectManager?.project?.updatedAt || 0);
              if (serverTime > localTime || isLocalDefault) {
                console.log("[CloudSync] Periodic server check detected newer project. Reloading...");
                await cloudLoad(true);
              }
            }
          }
        }
      } catch (_) {}
    }, 15000);

    // Realtime Firestore onSnapshot listener
    if (typeof firebase !== "undefined" && firebase.firestore) {
      try {
        const db = firebase.firestore();
        const projRef = db.collection("users").doc(uid).collection("data").doc("active_project");

        cloudProjectUnsub = projRef.onSnapshot((snap) => {
          if (!snap.exists || snap.metadata?.hasPendingWrites) return;
          const data = snap.data();
          const cloudTime = Number(data.updatedAt) || 0;
          const isLocalDefault = window.ProjectManager?.isDefaultProject ? window.ProjectManager.isDefaultProject() : false;
          const localTime = isLocalDefault ? 0 : (window.ProjectManager?.project?.updatedAt || 0);

          if ((cloudTime > localTime || isLocalDefault) && !window.ProjectManager?.isDirty && !cloudApplying) {
            console.log("[CloudSync] Live server workspace update detected! Updating...");
            window.ProjectManager.loadFromCloud(true).then((proj) => {
              if (proj) {
                loadProjectAutonsIntoPlanner(false, true);
                updateProjectBanner();
                showToast(`☁️ Workspace updated from server ("${proj.name || 'Project'}")`, 3500);
              }
            });
          }
        }, (err) => {
          console.warn("Live project sync warning:", err);
        });
      } catch (e) {
        console.warn("Failed to subscribe to cloud project:", e);
      }
    }
  }

  async function cloudLoad(force = false) {
    const activeUser = cloudUser || getSavedGoogleUser();
    if (!activeUser) return;

    const isJustLoggedIn = (typeof sessionStorage !== "undefined" && sessionStorage.getItem("lemlib_just_logged_in") === "true");
    if (isJustLoggedIn) {
      console.log("[CloudLoad] User just logged in. Clearing local path copy and forcing cloud sync.");
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        console.warn("Error deleting local path copy:", e);
      }
      force = true;
    }

    setCloudStatus("Loading…", "busy");
    try {
      // 1. Load active project workspace using ProjectManager.loadFromCloud (checks both server and Firestore)
      if (window.ProjectManager) {
        const loadedProj = await window.ProjectManager.loadFromCloud(force);
        if (loadedProj) {
          loadProjectAutonsIntoPlanner(false, true);
          updateProjectBanner();
        }
      }

      // 2. Load path payload if available from server or Firestore
      let pathLoaded = false;
      const uid = activeUser.uid;
      const email = activeUser.email || "";

      const proj = window.ProjectManager?.project;
      const isIdeActive = proj && (proj.lastAutonEditor === "ide" || proj.rawCppPreserved);
      if (isIdeActive) {
        console.log("[CloudLoad] C++ IDE workspace is active. Bypassing cloud pathPayload to preserve parsed blocks from src/autons.cpp.");
        pathLoaded = true;
      }

      try {
        const params = new URLSearchParams();
        if (uid) params.set("uid", uid);
        if (email) params.set("email", email);
        const srvUrl = getApiUrl(`/api/project?${params.toString()}`);
        if (srvUrl) {
          const srvRes = await fetch(srvUrl);
          if (srvRes.ok) {
            const srvData = await srvRes.json();
            if (srvData.exists && srvData.pathPayload) {
              applyPathPayload(srvData.pathPayload);
              saveLocal();
              pathLoaded = true;
            }
          }
        }
      } catch (err) {
        console.warn("Server path check warning:", err);
      }

      if (!pathLoaded && typeof firebase !== "undefined" && firebase.firestore && cloudUser) {
        try {
          const db = firebase.firestore();
          const ref = db.collection("users").doc(cloudUser.uid).collection("data").doc("path");
          const snap = await ref.get();
          if (snap.exists) {
            const pathData = snap.data();
            applyPathPayload(pathData);
            saveLocal();
            pathLoaded = true;
          }
        } catch (fsErr) {
          console.warn("Firestore path check warning:", fsErr);
        }
      }

      if (isJustLoggedIn) {
        if (!pathLoaded) {
          console.log("[CloudLoad] No cloud path found. Resetting to default paths.");
          paths = [
            {
              id: "p_default",
              name: "Red Left",
              pose: { x: -60, y: -60, theta: 0 },
              actions: [],
            },
          ];
          activePathId = "p_default";
          saveLocal();
          bindActive();
          syncPathSelect();
          syncBotInputs();
          syncStartInputs();
          renderFlow();
          draw();
        }
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("lemlib_just_logged_in");
        }
      }

      setCloudStatus("Synced", "ok");
    } catch (e) {
      console.error("Cloud load failed:", e);
      setCloudStatus("Load failed", "err");
    }
  }

  async function cloudSave(force) {
    if (window.SessionGuard && !window.SessionGuard.isInstanceActive()) {
      console.warn("[CloudSave] Aborted: This instance is deactivated by single-instance session guard.");
      return;
    }
    const activeUser = cloudUser || getSavedGoogleUser();
    if (!activeUser || cloudApplying) return;
    setCloudStatus("Saving…", "busy");
    try {
      const payload = pathPayload();

      // 1. Ensure ProjectManager active_project is saved to cloud (server + Firestore)
      if (window.ProjectManager && window.ProjectManager.project) {
        await window.ProjectManager.saveToCloud(null, !force);
      }

      // 2. Save path to server cloud store
      try {
        const srvUrl = getApiUrl("/api/project");
        if (srvUrl) {
          await fetch(srvUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uid: activeUser.uid,
              email: activeUser.email || "",
              project: window.ProjectManager?.project || null,
              pathPayload: payload
            })
          });
        }
      } catch (srvErr) {
        console.warn("Server cloud path save warning:", srvErr);
      }

      // 3. Save path to Firestore if signed in
      if (typeof firebase !== "undefined" && firebase.firestore && cloudUser) {
        try {
          const db = firebase.firestore();
          const ref = db.collection("users").doc(cloudUser.uid).collection("data").doc("path");
          await ref.set(payload, { merge: true });
        } catch (fsErr) {
          console.warn("Firestore path save warning:", fsErr);
        }
      }

      setCloudStatus("Synced", "ok");
    } catch (e) {
      console.error(e);
      setCloudStatus("Save failed", "err");
    }
  }

  function scheduleCloudSave() {
    if (!cloudReady || !cloudUser || cloudApplying) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => cloudSave(false), 800);
  }

  const AUTH_STORAGE_KEY = "lemlib_saved_google_user";
  const AUTH_EMAIL_KEY = "lemlib_saved_google_email";
  const AUTH_EXPLICIT_SIGNOUT_KEY = "lemlib_signed_out";

  function getSavedGoogleUser() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function saveGoogleUserProfile(user) {
    if (!user) return;
    try {
      const profile = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || user.email || "Google User",
        photoURL: user.photoURL || "",
        savedAt: Date.now(),
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(profile));
      if (user.email) {
        localStorage.setItem(AUTH_EMAIL_KEY, user.email);
      }
      localStorage.removeItem(AUTH_EXPLICIT_SIGNOUT_KEY);
    } catch (_) {}
  }

  function clearSavedGoogleUser() {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.setItem(AUTH_EXPLICIT_SIGNOUT_KEY, "true");
    } catch (_) {}
  }

  function updateAuthUI(previewUser, isPendingReconnect) {
    const btnIn = document.getElementById("btnGoogleSignIn");
    const btnOut = document.getElementById("btnSignOut");
    const btnSwitch = document.getElementById("btnSwitchAccount");
    const userEl = document.getElementById("authUser");

    const homeBtnIn = document.getElementById("btnHomeGoogleSignIn");
    const homeBtnOut = document.getElementById("btnHomeSignOut");
    const homeUserEl = document.getElementById("homeAuthUser");

    const activeUser = cloudUser || previewUser;
    if (activeUser) {
      if (btnIn) btnIn.hidden = true;
      if (btnOut) btnOut.hidden = false;
      if (btnSwitch) btnSwitch.hidden = false;
      if (homeBtnIn) homeBtnIn.hidden = true;
      if (homeBtnOut) homeBtnOut.hidden = false;

      const name = activeUser.displayName || activeUser.email || "Signed in";
      const email = activeUser.email || "";

      if (userEl) {
        userEl.hidden = false;
        if (isPendingReconnect) {
          userEl.innerHTML = `
            <span class="auth-saved-tag" title="Saved account: ${escapeHtml(email)} · Click Reconnect to refresh session">👤 ${escapeHtml(name)}</span>
            <button type="button" class="auth-reconnect-btn" id="btnAuthReconnect" title="Click to refresh session">⚡ Reconnect</button>
          `;
          const reconBtn = document.getElementById("btnAuthReconnect");
          if (reconBtn) {
            reconBtn.onclick = (e) => {
              e.stopPropagation();
              triggerGoogleSignIn(false);
            };
          }
        } else {
          userEl.innerHTML = `
            <span class="auth-saved-tag" title="${escapeHtml(email)} · Account saved across sessions on this device">👤 ${escapeHtml(name)}</span>
          `;
        }
      }

      if (homeUserEl) {
        homeUserEl.hidden = false;
        homeUserEl.innerHTML = `<span class="auth-saved-tag">👤 ${escapeHtml(name)}</span>`;
      }
    } else {
      if (btnIn) btnIn.hidden = false;
      if (homeBtnIn) homeBtnIn.hidden = false;
      const lastEmail = localStorage.getItem(AUTH_EMAIL_KEY);
      if (lastEmail && localStorage.getItem(AUTH_EXPLICIT_SIGNOUT_KEY) !== "true") {
        if (btnIn) {
          btnIn.title = `Sign in as ${lastEmail} (saved session)`;
          btnIn.textContent = `Sign in (${lastEmail.split("@")[0]})`;
        }
        if (homeBtnIn) homeBtnIn.textContent = `Sign in (${lastEmail.split("@")[0]})`;
      } else {
        if (btnIn) {
          btnIn.title = "Sign in with Google to sync paths across devices";
          btnIn.textContent = "Sign in with Google";
        }
        if (homeBtnIn) homeBtnIn.textContent = "Sign in with Google";
      }
      if (btnOut) btnOut.hidden = true;
      if (btnSwitch) btnSwitch.hidden = true;
      if (homeBtnOut) homeBtnOut.hidden = true;
      if (userEl) {
        userEl.hidden = true;
        userEl.textContent = "";
      }
      if (homeUserEl) {
        homeUserEl.hidden = true;
        homeUserEl.textContent = "";
      }
      setCloudStatus("");
    }
  }

  async function triggerGoogleSignIn(forceAccountPicker = false) {
    if (typeof firebase === "undefined" || !firebase.auth) {
      alert("Firebase library is not ready. Please check your internet connection.");
      return;
    }

    try {
      // Ensure persistence is set to LOCAL so login survives browser restarts & reloads
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      const provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/drive.file");
      const lastEmail = localStorage.getItem(AUTH_EMAIL_KEY);

      if (forceAccountPicker) {
        // User requested to switch accounts: show account chooser
        provider.setCustomParameters({ prompt: "select_account" });
      } else if (lastEmail) {
        // Automatically pre-fill and select saved account without re-prompting
        provider.setCustomParameters({ login_hint: lastEmail });
      }

      setCloudStatus("Connecting…", "busy");
      const cred = await firebase.auth().signInWithPopup(provider);
      if (cred && cred.user) {
        if (cred.credential && cred.credential.accessToken) {
          localStorage.setItem("gdrive_access_token", cred.credential.accessToken);
          localStorage.setItem("gdrive_token_expiry", Date.now() + 3500 * 1000);
        }
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem("lemlib_just_logged_in", "true");
        }
        cloudUser = cred.user;
        saveGoogleUserProfile(cred.user);
        updateAuthUI();
        await cloudLoad(true);
      }
    } catch (e) {
      console.error("Google sign-in error:", e);
      if (e && (e.code === "auth/popup-blocked" || e.message?.includes("popup"))) {
        const openTab = confirm(
          "Google Sign-In popup was blocked by the browser or preview iframe.\n\nOpen this app in a new browser tab to complete sign in and keep your account saved?"
        );
        if (openTab) {
          window.open(window.location.href, "_blank");
        }
      } else if (e && e.code === "auth/popup-closed-by-user") {
        // User closed popup without completing; restore saved UI if present
        const saved = getSavedGoogleUser();
        if (saved && !cloudUser) updateAuthUI(saved, true);
      } else {
        alert("Sign-in failed: " + ((e && e.message) || e));
      }
    }
  }

  function initFirebaseAuth() {
    const cfg = window.FIREBASE_CONFIG;
    const enabled = window.FIREBASE_ENABLED === true;
    if (!enabled || !cfg || !cfg.apiKey || cfg.apiKey === "YOUR_API_KEY") {
      setCloudStatus("Cloud off", "");
      const btnIn = document.getElementById("btnGoogleSignIn");
      if (btnIn) {
        btnIn.title = "Set firebase-config.js to enable Google sign-in";
        btnIn.onclick = () => {
          alert(
            "Google sign-in is not configured yet.\n\n" +
              "1. Create a Firebase project\n" +
              "2. Enable Google sign-in\n" +
              "3. Paste web config into firebase-config.js\n" +
              "4. Set FIREBASE_ENABLED = true\n\n" +
              "See README for full steps."
          );
        };
      }
      return;
    }
    if (typeof firebase === "undefined") {
      setCloudStatus("Firebase missing", "err");
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(cfg);
      }
      cloudReady = true;

      // Ensure auth state persists across browser restarts and tab closures
      firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
        console.warn("Could not set auth persistence to LOCAL:", err);
      });
    } catch (e) {
      console.error(e);
      setCloudStatus("Init failed", "err");
      return;
    }

    // Immediately restore cached user from localStorage so there is zero UI flicker on reload
    const isExplicitSignOut = localStorage.getItem(AUTH_EXPLICIT_SIGNOUT_KEY) === "true";
    const saved = getSavedGoogleUser();
    if (window.SessionGuard) {
      window.SessionGuard.init({ pageName: "Path Planner" });
      if (saved && !isExplicitSignOut) {
        window.SessionGuard.setUser(saved);
      }
    }
    if (saved && !isExplicitSignOut) {
      updateAuthUI(saved, false);
      setCloudStatus("Connecting…", "busy");
      cloudLoad(false);
    }

    const btnIn = document.getElementById("btnGoogleSignIn");
    const homeBtnIn = document.getElementById("btnHomeGoogleSignIn");
    if (btnIn) {
      btnIn.onclick = () => triggerGoogleSignIn(false);
    }
    if (homeBtnIn) {
      homeBtnIn.onclick = () => triggerGoogleSignIn(false);
    }

    const btnSwitch = document.getElementById("btnSwitchAccount");
    if (btnSwitch) {
      btnSwitch.onclick = () => triggerGoogleSignIn(true);
    }

    const btnOut = document.getElementById("btnSignOut");
    const homeBtnOut = document.getElementById("btnHomeSignOut");
    const handleSignOut = async () => {
      try {
        clearSavedGoogleUser();
        cloudUser = null;
        await firebase.auth().signOut();
        updateAuthUI();
        setCloudStatus("");
      } catch (e) {
        console.error(e);
      }
    };
    if (btnOut) btnOut.onclick = handleSignOut;
    if (homeBtnOut) homeBtnOut.onclick = handleSignOut;

    firebase.auth().onAuthStateChanged(async (user) => {
      cloudUser = user;
      if (window.SessionGuard) {
        window.SessionGuard.setUser(user);
      }
      if (user) {
        saveGoogleUserProfile(user);
        updateAuthUI();
        await cloudLoad();
        subscribeToCloudProject(user.uid);
        try {
          const userTutDone = localStorage.getItem("lemlib_tutorial_user_" + user.uid) === "true";
          const globalTutDone = localStorage.getItem("lemlib_tutorial_completed_v1") === "true";
          if (!userTutDone && !globalTutDone && window.LemLibTutorial) {
            window.LemLibTutorial.checkAutoLaunch();
          }
        } catch (_) {}
      } else {
        if (cloudProjectUnsub) {
          try { cloudProjectUnsub(); } catch (_) {}
          cloudProjectUnsub = null;
        }
        const signedOut = localStorage.getItem(AUTH_EXPLICIT_SIGNOUT_KEY) === "true";
        if (signedOut) {
          updateAuthUI();
        } else {
          const cached = getSavedGoogleUser();
          if (cached) {
            // Keep saved account visible so user knows they are remembered and can re-sync with 1 click
            updateAuthUI(cached, true);
            cloudLoad(false);
          } else {
            updateAuthUI();
          }
        }
      }
    });

    // Save on tab close or navigation, but never clobber server with untouched default template
    window.addEventListener("beforeunload", () => {
      const activeUser = cloudUser || getSavedGoogleUser();
      if (cloudReady && activeUser && !cloudApplying) {
        const isDefault = window.ProjectManager?.isDefaultProject ? window.ProjectManager.isDefaultProject() : false;
        if (!isDefault || window.ProjectManager?.isDirty) {
          cloudSave(true);
        }
      }
    });
    document.addEventListener("visibilitychange", () => {
      const activeUser = cloudUser || getSavedGoogleUser();
      if (document.visibilityState === "hidden") {
        if (cloudReady && activeUser && !cloudApplying) {
          const isDefault = window.ProjectManager?.isDefaultProject ? window.ProjectManager.isDefaultProject() : false;
          if (!isDefault || window.ProjectManager?.isDirty) {
            cloudSave(true);
          }
        }
      } else if (document.visibilityState === "visible") {
        if (activeUser && !cloudApplying && !window.ProjectManager?.isDirty) {
          cloudLoad(false);
        }
      }
    });
    window.addEventListener("focus", () => {
      const activeUser = cloudUser || getSavedGoogleUser();
      if (activeUser && !cloudApplying && !window.ProjectManager?.isDirty) {
        cloudLoad(false);
      }
    });
  }

  // -- Clear path challenge modal ----------------------------------
  let clearChallengeWord = "CLEAR";

  function openClearModal() {
    clearChallengeWord = "CLEAR";
    const modal = document.getElementById("clearModal");
    const input = document.getElementById("clearChallengeInput");
    const text = document.getElementById("clearChallengeText");
    const confirmBtn = document.getElementById("clearModalConfirm");
    if (!modal) {
      // fallback
      if (confirm("Clear entire path?")) doClearPath();
      return;
    }
    text.textContent = clearChallengeWord;
    input.value = "";
    confirmBtn.disabled = true;
    modal.hidden = false;
    input.focus();
  }

  function closeClearModal() {
    const modal = document.getElementById("clearModal");
    if (modal) modal.hidden = true;
  }

  function doClearPath() {
    actions = [];
    selectedId = null;
    markDirty();
    renderFlow();
    stopSim();
    draw();
    closeClearModal();
  }

  function wireClearModal() {
    const modal = document.getElementById("clearModal");
    const input = document.getElementById("clearChallengeInput");
    const confirmBtn = document.getElementById("clearModalConfirm");
    const cancelBtn = document.getElementById("clearModalCancel");
    if (!modal || !input) return;

    input.addEventListener("input", () => {
      confirmBtn.disabled = input.value.trim().toUpperCase() !== clearChallengeWord;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !confirmBtn.disabled) doClearPath();
      if (e.key === "Escape") closeClearModal();
    });
    confirmBtn.onclick = () => {
      if (input.value.trim().toUpperCase() === clearChallengeWord) doClearPath();
    };
    cancelBtn.onclick = closeClearModal;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeClearModal();
    });
  }

  function openDeleteBlockModal(actionId) {
    pendingDeleteActionId = actionId;
    const modal = document.getElementById("deleteBlockModal");
    if (modal) {
      const chk = document.getElementById("chkDoNotWarnDeleteSession");
      if (chk) chk.checked = false;
      modal.hidden = false;
    }
  }

  function closeDeleteBlockModal() {
    pendingDeleteActionId = null;
    const modal = document.getElementById("deleteBlockModal");
    if (modal) modal.hidden = true;
  }

  function confirmDeleteBlock() {
    if (!pendingDeleteActionId) return;
    const chk = document.getElementById("chkDoNotWarnDeleteSession");
    if (chk && chk.checked) {
      sessionStorage.setItem("disableDeleteWarning", "true");
    }

    const i = actions.findIndex((x) => x.id === pendingDeleteActionId);
    if (i !== -1) {
      actions.splice(i, 1);
      if (selectedId === pendingDeleteActionId) selectedId = null;
      markDirty();
      renderFlow();
      draw();
      generateCode();
      try { updateTimeDisplay(); } catch (_) {}
      showToast(`🗑️ Block deleted.`);
    } else {
      for (const a of actions) {
        if (a.type === "loop" && Array.isArray(a.children)) {
          const ci = a.children.findIndex((x) => x.id === pendingDeleteActionId);
          if (ci !== -1) {
            a.children.splice(ci, 1);
            if (selectedId === pendingDeleteActionId) selectedId = null;
            markDirty();
            renderFlow();
            draw();
            generateCode();
            try { updateTimeDisplay(); } catch (_) {}
            showToast(`🗑️ Block deleted from loop.`);
            break;
          }
        }
      }
    }
    closeDeleteBlockModal();
  }

  function wireDeleteBlockModal() {
    const modal = document.getElementById("deleteBlockModal");
    const btnCancelX = document.getElementById("btnDeleteBlockCancelX");
    const btnCancel = document.getElementById("btnDeleteBlockCancel");
    const btnConfirm = document.getElementById("btnDeleteBlockConfirm");

    if (!modal) return;

    btnCancelX.onclick = closeDeleteBlockModal;
    btnCancel.onclick = closeDeleteBlockModal;
    btnConfirm.onclick = confirmDeleteBlock;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeDeleteBlockModal();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) {
        closeDeleteBlockModal();
      }
    });
  }

  function wireHelpModal() {
    const modal = document.getElementById("helpModal");
    const btnOpen = document.getElementById("btnHelp");
    const linkDocs = document.getElementById("linkHelpDocs");
    const btnClose = document.getElementById("helpModalClose");
    const btnDone = document.getElementById("helpModalDoneBtn");
    const tabs = document.querySelectorAll(".help-tab");
    const panes = document.querySelectorAll(".help-pane");

    function selectTab(tabId) {
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
      panes.forEach((p) => p.classList.toggle("active", p.dataset.pane === tabId));
    }

    openHelp = function (tabId) {
      if (tabId) selectTab(tabId);
      if (modal) modal.hidden = false;
    };

    closeHelp = function () {
      if (modal) modal.hidden = true;
    };

    if (btnOpen) btnOpen.onclick = () => openHelp("overview");
    if (linkDocs) linkDocs.onclick = () => openHelp("overview");
    if (btnClose) btnClose.onclick = closeHelp;
    if (btnDone) btnDone.onclick = closeHelp;

    tabs.forEach((t) => {
      t.onclick = () => selectTab(t.dataset.tab);
    });

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeHelp();
      });
    }
  }

  // -- Multitask Concurrency Flowchart Modal ----------------------
  function openFlowchartModal(action, idx) {
    const modal = document.getElementById("flowchartModal");
    const titleEl = document.getElementById("flowchartModalTitle");
    const bodyEl = document.getElementById("flowchartModalBody");
    if (!modal || !bodyEl) return;
    if (titleEl) {
      titleEl.textContent = `⚡ Multitask Flowchart · Step ${idx + 1} (${action.type})`;
    }
    bodyEl.innerHTML = generateMultitaskFlowchartSvg(action, idx, true);
    modal.hidden = false;
  }

  function openRoutineFlowchartModal() {
    const modal = document.getElementById("flowchartModal");
    const titleEl = document.getElementById("flowchartModalTitle");
    const bodyEl = document.getElementById("flowchartModalBody");
    if (!modal || !bodyEl) return;
    const curPath = paths[activePathIndex];
    const pathName = curPath ? curPath.name : "Active Routine";
    if (titleEl) {
      titleEl.textContent = `⚡ Seamless Flowchart · ${pathName}`;
    }
    bodyEl.innerHTML = generateRoutineFlowchartSvg();
    modal.hidden = false;
  }

  function closeFlowchartModal() {
    const modal = document.getElementById("flowchartModal");
    if (modal) modal.hidden = true;
  }

  function wireFlowchartModal() {
    const modal = document.getElementById("flowchartModal");
    const btnClose = document.getElementById("flowchartModalClose");
    const btnDone = document.getElementById("flowchartModalDoneBtn");
    const btnOpenRoutine = document.getElementById("btnOpenRoutineFlowchart");
    if (!modal) return;
    if (btnClose) btnClose.onclick = closeFlowchartModal;
    if (btnDone) btnDone.onclick = closeFlowchartModal;
    if (btnOpenRoutine) btnOpenRoutine.onclick = openRoutineFlowchartModal;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeFlowchartModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeFlowchartModal();
    });
  }

  // ===================================================================
  // -- Raw C++ Autonomous to Blocks Translator Engine ----------------
  // ===================================================================
  // Delegates parsing to shared modular engine window.CppTranslator in cpp-parser.js
  function parseCppAuton(rawCode) {
    if (window.CppTranslator && typeof window.CppTranslator.parseCppAuton === "function") {
      return window.CppTranslator.parseCppAuton(rawCode, {
        defaultMaxSpeed: bot.defaultMaxSpeed || 127,
        defaultMinSpeed: bot.defaultMinSpeed || 0,
      });
    }
    return {
      success: false,
      routineName: "Imported Auton",
      startPose: null,
      actions: [],
      stats: { motionsCount: 0, customCount: 0, asyncCount: 0, commentsCount: 0 },
      log: ["CppTranslator engine not loaded."],
    };
  }

  const CPP_SAMPLE_ROUTINES = (window.CppTranslator && window.CppTranslator.SAMPLE_ROUTINES) || {};

  // Wire C++ Auton Translator Modal
  function wireCppTranslateModal() {
    const modal = document.getElementById("cppTranslateModal");
    const btnOpenHead = document.getElementById("btnCppTranslator");
    const btnOpenSide = document.getElementById("btnCppTranslatorSide");
    const btnClose = document.getElementById("cppTranslateClose");
    const btnCancel = document.getElementById("cppTranslateCancelBtn");
    const btnApply = document.getElementById("cppTranslateApplyBtn");
    const codeInput = document.getElementById("cppCodeInput");
    const sampleBtns = document.querySelectorAll(".btn-cpp-sample");
    const activeNameEl = document.getElementById("cppActiveRoutineName");
    const newNameInput = document.getElementById("cppNewRoutineName");
    const errorEl = document.getElementById("cppErrorMsg");

    const statPose = document.getElementById("cppStatPose");
    const statMotions = document.getElementById("cppStatMotions");
    const statCustom = document.getElementById("cppStatCustom");
    const statAsync = document.getElementById("cppStatAsync");
    const statComments = document.getElementById("cppStatComments");
    const analysisStatus = document.getElementById("cppAnalysisStatus");
    const analysisCount = document.getElementById("cppAnalysisCount");
    const previewList = document.getElementById("cppParsedPreviewList");

    if (!modal) return;

    let lastParsed = null;

    function updateActiveRoutineLabel() {
      const cur = activePath();
      if (activeNameEl && cur) {
        activeNameEl.textContent = cur.name || "Active Routine";
      }
    }

    function openModal() {
      updateActiveRoutineLabel();
      modal.hidden = false;
      if (errorEl) errorEl.hidden = true;
      if (codeInput && !codeInput.value.trim()) {
        // Load default sample if empty
        codeInput.value = CPP_SAMPLE_ROUTINES.preload_rush;
      }
      runLiveAnalysis();
      if (codeInput) codeInput.focus();
    }

    function closeModal() {
      modal.hidden = true;
    }

    function runLiveAnalysis() {
      const text = codeInput ? codeInput.value : "";
      if (!text || !text.trim()) {
        if (statPose) statPose.textContent = "—";
        if (statMotions) statMotions.textContent = "0";
        if (statCustom) statCustom.textContent = "0";
        if (statAsync) statAsync.textContent = "0";
        if (statComments) statComments.textContent = "0";
        if (analysisStatus) analysisStatus.textContent = "Paste C++ code above";
        if (analysisCount) analysisCount.textContent = "0 items";
        if (previewList) previewList.innerHTML = '<span style="color:#64748b;font-size:0.72rem;">No actions parsed yet</span>';
        lastParsed = null;
        return;
      }

      const res = parseCppAuton(text);
      lastParsed = res;

      if (statPose) {
        statPose.textContent = res.startPose
          ? `(${res.startPose.x}, ${res.startPose.y}, ${res.startPose.theta}°)`
          : "— (keep current)";
      }
      if (statMotions) statMotions.textContent = String(res.stats.motionsCount);
      if (statCustom) statCustom.textContent = String(res.stats.customCount);
      if (statAsync) statAsync.textContent = String(res.stats.asyncCount);
      if (statComments) statComments.textContent = String(res.stats.commentsCount);

      const totalItems = res.actions.length + (res.startPose ? 1 : 0);
      if (analysisCount) analysisCount.textContent = `${totalItems} item${totalItems === 1 ? "" : "s"} detected`;

      if (analysisStatus) {
        if (res.actions.length > 0) {
          analysisStatus.innerHTML = `<span style="color:#34d399;">✓ Parsed ${res.actions.length} action blocks successfully</span>`;
        } else if (res.startPose) {
          analysisStatus.innerHTML = `<span style="color:#38bdf8;">✓ Parsed start pose</span>`;
        } else {
          analysisStatus.innerHTML = `<span style="color:#fbbf24;">⚠️ No movement actions recognized</span>`;
        }
      }

      if (newNameInput && res.routineName && res.routineName !== "Imported Auton") {
        newNameInput.value = res.routineName;
      }

      // Render parsed preview pills
      if (previewList) {
        if (res.actions.length === 0 && !res.startPose) {
          previewList.innerHTML = '<span style="color:#64748b;font-size:0.72rem;">No LemLib actions recognized. Check C++ syntax.</span>';
        } else {
          let pillsHtml = "";
          if (res.startPose) {
            pillsHtml += `<span class="cpp-preview-pill" style="border-color:#38bdf8;background:rgba(56,189,248,0.15);color:#7dd3fc;"><span class="pill-num">🏁</span> Start: (${res.startPose.x}, ${res.startPose.y}, ${res.startPose.theta}°)</span>`;
          }
          res.actions.forEach((a, i) => {
            const isAsync = a.async;
            const isCustom = a.type === "custom";
            let icon = "📍";
            if (isCustom) icon = "⚡";
            else if (a.type.includes("turn")) icon = "🔄";
            else if (a.type.includes("swing")) icon = "🌊";
            else if (a.type === "moveToPose") icon = "🎯";

            let desc = a.type;
            if (isCustom) {
              const snippet = (a.customCode || "").split("\n")[0] || "custom code";
              desc = snippet.length > 18 ? snippet.slice(0, 16) + "…" : snippet;
              if (a.customDuration > 0) desc += ` (${a.customDuration}s)`;
              else desc += ` (0s)`;
            } else if (a.type === "moveToPoint") {
              desc = `moveToPoint(${a.x}, ${a.y})`;
            } else if (a.type === "moveToPose") {
              desc = `moveToPose(${a.x}, ${a.y}, ${a.theta}°)`;
            } else if (a.type.includes("Heading")) {
              desc = `${a.type}(${a.theta}°)`;
            } else if (a.type.includes("Point")) {
              desc = `${a.type}(${a.x}, ${a.y})`;
            }

            const commentTag = a.label ? ` <span style="color:#94a3b8;">// ${escapeHtml(a.label)}</span>` : "";
            const asyncTag = isAsync ? ` <span style="color:#d8b4fe;font-weight:700;">⚡ASYNC</span>` : "";

            pillsHtml += `<span class="cpp-preview-pill ${isAsync ? 'async' : ''} ${isCustom ? 'custom' : ''}"><span class="pill-num">${i + 1}.</span> ${icon} ${escapeHtml(desc)}${asyncTag}${commentTag}</span>`;
          });
          previewList.innerHTML = pillsHtml;
        }
      }
    }

    function applyTranslation() {
      if (!lastParsed || (!lastParsed.actions.length && !lastParsed.startPose)) {
        if (errorEl) {
          errorEl.textContent = "Please paste valid LemLib C++ autonomous code before applying.";
          errorEl.hidden = false;
        }
        return;
      }

      const targetRadio = document.querySelector('input[name="cppImportTarget"]:checked');
      const isNew = targetRadio && targetRadio.value === "new";
      const customName = newNameInput ? newNameInput.value.trim() : "";
      const routineName = customName || lastParsed.routineName || `Routine ${paths.length + 1}`;

      if (isNew) {
        addPath(routineName);
      } else {
        const cur = activePath();
        if (cur && customName && targetRadio.value === "active" && lastParsed.routineName !== "Imported Auton") {
          cur.name = routineName;
          syncPathSelect();
        }
      }

      // Apply start pose if found
      if (lastParsed.startPose) {
        pose = { ...lastParsed.startPose };
        activePath().pose = { ...lastParsed.startPose };
        syncStartInputs();
      }

      // Apply actions
      actions = lastParsed.actions.map((a) => ({ ...a, id: uid() }));
      activePath().actions = actions;

      selectedId = actions.length > 0 ? actions[0].id : null;
      markDirty();
      renderFlow();
      draw();
      generateCode();
      try { updateTimeDisplay(); } catch (_) {}
      pushHistory("cpp_translate_import");

      closeModal();
      showToast(`📥 Successfully imported & translated ${actions.length} action blocks onto the visual editor and field map!`);
    }

    if (btnOpenHead) btnOpenHead.onclick = openModal;
    if (btnOpenSide) btnOpenSide.onclick = openModal;
    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;
    if (btnApply) btnApply.onclick = applyTranslation;

    if (codeInput) {
      codeInput.addEventListener("input", runLiveAnalysis);
      codeInput.addEventListener("paste", () => setTimeout(runLiveAnalysis, 50));
    }

    sampleBtns.forEach((btn) => {
      btn.onclick = () => {
        const sampleKey = btn.dataset.sample;
        if (sampleKey === "clear") {
          if (codeInput) codeInput.value = "";
        } else if (CPP_SAMPLE_ROUTINES[sampleKey]) {
          if (codeInput) codeInput.value = CPP_SAMPLE_ROUTINES[sampleKey];
        }
        runLiveAnalysis();
      };
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  // -- PID Tuning Visualizer Modal -----------------------------------
  function wirePidModal() {
    const modal = document.getElementById("pidModal");
    const btnOpenHead = document.getElementById("btnPidTuner");
    const btnOpenBot = document.getElementById("btnOpenPidFromBot");
    const btnClose = document.getElementById("pidModalClose");
    const btnCloseFooter = document.getElementById("pidModalCloseBtn");
    const btnApply = document.getElementById("btnApplyPidToSim");
    const btnCopyCode = document.getElementById("btnCopyPidCode");
    const canvas = document.getElementById("pidGraphCanvas");

    if (!modal || !canvas) return;

    let currentMode = "lateral"; // "lateral" or "angular"
    const state = {
      lateral: {
        kp: bot.lateralKp != null ? bot.lateralKp : 8.0,
        ki: bot.lateralKi != null ? bot.lateralKi : 0.0,
        kd: bot.lateralKd != null ? bot.lateralKd : 30.0,
        windup: bot.lateralWindup != null ? bot.lateralWindup : 3.0,
        slew: bot.lateralSlew != null ? bot.lateralSlew : 0,
        step: 24.0,
        smallErr: 1.0,
        smallTime: 100,
        largeTime: 500,
      },
      angular: {
        kp: bot.angularKp != null ? bot.angularKp : 2.0,
        ki: bot.angularKi != null ? bot.angularKi : 0.0,
        kd: bot.angularKd != null ? bot.angularKd : 10.0,
        windup: bot.angularWindup != null ? bot.angularWindup : 3.0,
        slew: bot.angularSlew != null ? bot.angularSlew : 0,
        step: 90.0,
        smallErr: 1.0,
        smallTime: 100,
        largeTime: 500,
      }
    };

    function openModal() {
      // Refresh current bot values
      if (bot.lateralKp != null) state.lateral.kp = bot.lateralKp;
      if (bot.lateralKi != null) state.lateral.ki = bot.lateralKi;
      if (bot.lateralKd != null) state.lateral.kd = bot.lateralKd;
      if (bot.lateralWindup != null) state.lateral.windup = bot.lateralWindup;
      if (bot.lateralSlew != null) state.lateral.slew = bot.lateralSlew;
      if (bot.lateralSmallErr != null) state.lateral.smallErr = bot.lateralSmallErr;
      if (bot.lateralSmallTime != null) state.lateral.smallTime = bot.lateralSmallTime;
      if (bot.lateralLargeTime != null) state.lateral.largeTime = bot.lateralLargeTime;

      if (bot.angularKp != null) state.angular.kp = bot.angularKp;
      if (bot.angularKi != null) state.angular.ki = bot.angularKi;
      if (bot.angularKd != null) state.angular.kd = bot.angularKd;
      if (bot.angularWindup != null) state.angular.windup = bot.angularWindup;
      if (bot.angularSlew != null) state.angular.slew = bot.angularSlew;
      if (bot.angularSmallErr != null) state.angular.smallErr = bot.angularSmallErr;
      if (bot.angularSmallTime != null) state.angular.smallTime = bot.angularSmallTime;
      if (bot.angularLargeTime != null) state.angular.largeTime = bot.angularLargeTime;

      syncInputsFromState();
      modal.hidden = false;
      modal.classList.add("open");
      updateGraphAndDiagnosis();
    }

    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("open");
    }

    function syncInputsFromState() {
      const cur = state[currentMode];
      const el = (id) => document.getElementById(id);

      if (el("pidKpInput")) el("pidKpInput").value = cur.kp;
      if (el("pidKpSlider")) el("pidKpSlider").value = cur.kp;
      if (el("pidKiInput")) el("pidKiInput").value = cur.ki;
      if (el("pidKiSlider")) el("pidKiSlider").value = cur.ki;
      if (el("pidKdInput")) el("pidKdInput").value = cur.kd;
      if (el("pidKdSlider")) el("pidKdSlider").value = cur.kd;
      if (el("pidWindupInput")) el("pidWindupInput").value = cur.windup;
      if (el("pidSlewInput")) el("pidSlewInput").value = cur.slew;
      if (el("pidStepInput")) el("pidStepInput").value = cur.step;
      if (el("pidSmallErrInput")) el("pidSmallErrInput").value = cur.smallErr;
      if (el("pidSmallTimeInput")) el("pidSmallTimeInput").value = cur.smallTime;
      if (el("pidLargeTimeInput")) el("pidLargeTimeInput").value = cur.largeTime;

      const titleEl = document.getElementById("pidGraphTitle");
      if (titleEl) {
        titleEl.textContent = currentMode === "lateral"
          ? `Step Response: ${cur.step}" Linear Distance Step`
          : `Step Response: ${cur.step}° Angular Heading Step`;
      }

      document.querySelectorAll(".pid-tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.pidMode === currentMode);
      });

      updateCodeOutput();
    }

    function updateCodeOutput() {
      const cur = state[currentMode];
      const codeEl = document.getElementById("pidCodeOutput");
      if (!codeEl) return;

      const unitComment = currentMode === "lateral" ? "inches" : "degrees";
      const code = `// lemlib::ControllerSettings for ${currentMode} motion
lemlib::ControllerSettings ${currentMode}_controller(
    ${cur.kp.toFixed(2)}, // proportional gain (kP)
    ${cur.ki.toFixed(3)}, // integral gain (kI)
    ${cur.kd.toFixed(2)}, // derivative gain (kD)
    ${cur.windup.toFixed(1)}, // anti windup range
    ${cur.smallErr.toFixed(1)}, // small error range, in ${unitComment}
    ${Math.round(cur.smallTime)}, // small error range timeout, in ms
    ${(cur.smallErr * 3).toFixed(1)}, // large error range, in ${unitComment}
    ${Math.round(cur.largeTime)}, // large error range timeout, in ms
    ${Math.round(cur.slew)} // maximum acceleration (slew rate)
);`;
      codeEl.textContent = code;
    }

    function simulatePidStep(params) {
      const { kp, ki, kd, windup, slew, step, smallErr } = params;
      const dt = 0.005; // 5ms discrete simulation loop
      const totalTime = 2.5; // 2.5s window
      const steps = Math.round(totalTime / dt);

      let position = 0;
      let velocity = 0;
      let prevError = step;
      let integral = 0;
      let prevOutput = 0;

      const points = [];
      let rise10 = null;
      let rise90 = null;
      let peakPos = 0;
      let settleTime = null;

      // Dynamic system constants for robot inertia & drag
      const mass = currentMode === "lateral" ? 6.5 : 0.09; // kg or kg*m^2
      const drag = currentMode === "lateral" ? 18.0 : 1.2; // friction & back-EMF
      const maxPower = 127.0;

      for (let i = 0; i <= steps; i++) {
        const t = i * dt;
        const error = step - position;

        // Integral with anti-windup clamping
        if (Math.abs(error) < windup && windup > 0) {
          integral += error * dt;
        } else if (windup > 0) {
          integral = 0;
        }

        // Derivative on error
        const derivative = (error - prevError) / dt;

        // Raw PID output
        let output = kp * error + ki * integral + kd * derivative;

        // Slew rate limiting
        if (slew > 0) {
          const maxDelta = slew * dt * 5.0;
          if (Math.abs(output - prevOutput) > maxDelta) {
            output = prevOutput + Math.sign(output - prevOutput) * maxDelta;
          }
        }
        output = Math.max(-maxPower, Math.min(maxPower, output));
        prevOutput = output;
        prevError = error;

        // Physical acceleration on robot chassis
        const force = (output / 127.0) * (currentMode === "lateral" ? 180.0 : 900.0);
        const acceleration = (force - drag * velocity) / mass;
        velocity += acceleration * dt;
        position += velocity * dt;

        points.push({ t, y: position, target: step, error });

        if (position > peakPos) peakPos = position;
        if (rise10 === null && position >= 0.1 * step) rise10 = t;
        if (rise90 === null && position >= 0.9 * step) rise90 = t;

        // Track settling
        if (Math.abs(step - position) <= smallErr) {
          if (settleTime === null) settleTime = t;
        } else {
          settleTime = null; // unset if it bounces out
        }
      }

      const overshoot = Math.max(0, ((peakPos - step) / step) * 100);
      const riseTime = (rise10 !== null && rise90 !== null) ? Math.max(0.01, rise90 - rise10) : (totalTime);
      const finalSettle = settleTime !== null ? settleTime : totalTime;
      const steadyError = Math.abs(step - points[points.length - 1].y);

      return {
        points,
        overshoot,
        riseTime,
        settleTime: finalSettle,
        steadyError,
      };
    }

    function updateGraphAndDiagnosis() {
      const cur = state[currentMode];
      const sim = simulatePidStep(cur);

      // Render KPIs
      const elOvershoot = document.getElementById("pidKpiOvershoot");
      const elRise = document.getElementById("pidKpiRise");
      const elSettle = document.getElementById("pidKpiSettle");
      const elError = document.getElementById("pidKpiError");
      const elBadge = document.getElementById("pidDampingBadge");

      if (elOvershoot) elOvershoot.textContent = `${sim.overshoot.toFixed(1)}%`;
      if (elRise) elRise.textContent = `${sim.riseTime.toFixed(2)}s`;
      if (elSettle) elSettle.textContent = `${sim.settleTime.toFixed(2)}s`;
      if (elError) {
        elError.textContent = currentMode === "lateral"
          ? `${sim.steadyError.toFixed(2)}"`
          : `${sim.steadyError.toFixed(1)}°`;
      }

      if (elBadge) {
        if (sim.overshoot > 20) {
          elBadge.className = "pid-diagnosis-badge underdamped";
          elBadge.textContent = "🌊 Underdamped (High Overshoot & Oscillation)";
        } else if (sim.overshoot > 5) {
          elBadge.className = "pid-diagnosis-badge underdamped";
          elBadge.textContent = "⚡ Slightly Underdamped (Minor Ringing)";
        } else if (sim.riseTime > 0.9 || sim.settleTime > 1.6) {
          elBadge.className = "pid-diagnosis-badge sluggish";
          elBadge.textContent = "🐢 Overdamped (Sluggish / Low Power)";
        } else {
          elBadge.className = "pid-diagnosis-badge optimal";
          elBadge.textContent = "🎯 Optimal / Critically Damped";
        }
      }

      // Draw canvas response
      drawPidCanvas(sim, cur.step, cur.smallErr);
      updateCodeOutput();
    }

    function drawPidCanvas(sim, step, smallErr) {
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;

      // Background
      ctx.fillStyle = "#090d16";
      ctx.fillRect(0, 0, w, h);

      const padL = 48;
      const padR = 24;
      const padT = 24;
      const padB = 32;
      const graphW = w - padL - padR;
      const graphH = h - padT - padB;

      const maxVal = Math.max(step * 1.35, 1);
      const totalT = 2.5;

      const toX = (t) => padL + (t / totalT) * graphW;
      const toY = (v) => padT + graphH - (v / maxVal) * graphH;

      // Draw Grid
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let t = 0; t <= totalT; t += 0.5) {
        const x = toX(t);
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + graphH);
      }
      for (let v = 0; v <= maxVal; v += step / 2) {
        const y = toY(v);
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + graphW, y);
      }
      ctx.stroke();

      // Axis Labels
      ctx.fillStyle = "#64748b";
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      for (let t = 0; t <= totalT; t += 0.5) {
        ctx.fillText(`${t.toFixed(1)}s`, toX(t), h - 14);
      }
      ctx.textAlign = "right";
      for (let v = 0; v <= maxVal; v += step / 2) {
        ctx.fillText(`${v.toFixed(0)}`, padL - 6, toY(v) + 3);
      }

      // Settling Band (± smallErr)
      const bandTop = toY(step + smallErr);
      const bandBot = toY(step - smallErr);
      ctx.fillStyle = "rgba(34, 197, 94, 0.08)";
      ctx.fillRect(padL, bandTop, graphW, bandBot - bandTop);

      // Target Line (dashed emerald)
      const targetY = toY(step);
      ctx.strokeStyle = "#22c55e";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, targetY);
      ctx.lineTo(padL + graphW, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Response Curve y(t) (cyan glowing stroke)
      if (sim.points && sim.points.length > 0) {
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        sim.points.forEach((pt, idx) => {
          const x = toX(pt.t);
          const y = toY(pt.y);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Subtle gradient area below curve
        const grad = ctx.createLinearGradient(0, padT, 0, padT + graphH);
        grad.addColorStop(0, "rgba(56, 189, 248, 0.2)");
        grad.addColorStop(1, "rgba(56, 189, 248, 0.0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(0));
        sim.points.forEach((pt) => ctx.lineTo(toX(pt.t), toY(pt.y)));
        ctx.lineTo(toX(totalT), toY(0));
        ctx.closePath();
        ctx.fill();
      }

      // Render Interactive Draggable Handles on the Step Response curve
      let kpPoint = null;
      let kdPoint = null;
      if (sim.points && sim.points.length > 0) {
        // Find points closest to t = 0.4s and t = 1.1s
        kpPoint = sim.points.reduce((prev, curr) => Math.abs(curr.t - 0.4) < Math.abs(prev.t - 0.4) ? curr : prev);
        kdPoint = sim.points.reduce((prev, curr) => Math.abs(curr.t - 1.1) < Math.abs(prev.t - 1.1) ? curr : prev);
      }

      if (kpPoint && kdPoint) {
        window.pidKpHandleX = toX(kpPoint.t);
        window.pidKpHandleY = toY(kpPoint.y);
        window.pidKdHandleX = toX(kdPoint.t);
        window.pidKdHandleY = toY(kdPoint.y);

        // Draw Amber kP Proportional Handle (Power/Rise)
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#f59e0b";
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.arc(window.pidKpHandleX, window.pidKpHandleY, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Draw Cobalt kD Derivative Handle (Damping)
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#3b82f6";
        ctx.fillStyle = "#3b82f6";
        ctx.beginPath();
        ctx.arc(window.pidKdHandleX, window.pidKdHandleY, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Overlay text instructions/labels near handles
        ctx.fillStyle = "#fde68a";
        ctx.font = "bold 9px Inter, system-ui, sans-serif";
        ctx.fillText("↕ kP Power", window.pidKpHandleX + 10, window.pidKpHandleY - 2);

        ctx.fillStyle = "#93c5fd";
        ctx.font = "bold 9px Inter, system-ui, sans-serif";
        ctx.fillText("↔ kD Damping", window.pidKdHandleX + 10, window.pidKdHandleY + 12);
      }
    }

    // Tab Switching
    document.querySelectorAll(".pid-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentMode = btn.dataset.pidMode || "lateral";
        syncInputsFromState();
        updateGraphAndDiagnosis();
      });
    });

    // Dual input / slider bindings
    const pairs = [
      ["pidKpInput", "pidKpSlider", "kp", (v) => Math.max(0, Number(v))],
      ["pidKiInput", "pidKiSlider", "ki", (v) => Math.max(0, Number(v))],
      ["pidKdInput", "pidKdSlider", "kd", (v) => Math.max(0, Number(v))],
      ["pidWindupInput", null, "windup", (v) => Math.max(0, Number(v))],
      ["pidSlewInput", null, "slew", (v) => Math.max(0, Number(v))],
      ["pidStepInput", null, "step", (v) => Math.max(1, Number(v))],
      ["pidSmallErrInput", null, "smallErr", (v) => Math.max(0.1, Number(v))],
      ["pidSmallTimeInput", null, "smallTime", (v) => Math.max(0, Number(v))],
      ["pidLargeTimeInput", null, "largeTime", (v) => Math.max(0, Number(v))],
    ];

    pairs.forEach(([numId, slideId, key, sanitize]) => {
      const numEl = document.getElementById(numId);
      const slideEl = slideId ? document.getElementById(slideId) : null;

      if (numEl) {
        numEl.addEventListener("input", () => {
          const val = sanitize(numEl.value);
          state[currentMode][key] = val;
          if (slideEl) slideEl.value = val;
          updateGraphAndDiagnosis();
        });
      }
      if (slideEl) {
        slideEl.addEventListener("input", () => {
          const val = sanitize(slideEl.value);
          state[currentMode][key] = val;
          if (numEl) numEl.value = val;
          updateGraphAndDiagnosis();
        });
      }
    });

    // Preset Buttons
    const presets = {
      stock: {
        lateral: { kp: 8.0, ki: 0.0, kd: 30.0, windup: 3.0, slew: 0 },
        angular: { kp: 2.0, ki: 0.0, kd: 10.0, windup: 3.0, slew: 0 }
      },
      critically_damped: {
        lateral: { kp: 10.5, ki: 0.02, kd: 44.0, windup: 3.0, slew: 0 },
        angular: { kp: 2.8, ki: 0.01, kd: 14.0, windup: 3.0, slew: 0 }
      },
      aggressive: {
        lateral: { kp: 18.0, ki: 0.05, kd: 36.0, windup: 2.0, slew: 20 },
        angular: { kp: 4.2, ki: 0.05, kd: 12.0, windup: 2.0, slew: 20 }
      },
      underdamped: {
        lateral: { kp: 26.0, ki: 0.0, kd: 10.0, windup: 0, slew: 0 },
        angular: { kp: 6.0, ki: 0.0, kd: 4.0, windup: 0, slew: 0 }
      },
      sluggish: {
        lateral: { kp: 3.2, ki: 0.0, kd: 65.0, windup: 5.0, slew: 0 },
        angular: { kp: 0.9, ki: 0.0, kd: 20.0, windup: 5.0, slew: 0 }
      }
    };

    document.querySelectorAll(".btn-pid-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const presetKey = btn.dataset.preset;
        if (presets[presetKey] && presets[presetKey][currentMode]) {
          const p = presets[presetKey][currentMode];
          Object.assign(state[currentMode], p);
          syncInputsFromState();
          updateGraphAndDiagnosis();
          showToast(`🎯 Applied ${btn.textContent.trim()} preset`);
        }
      });
    });

    // Copy C++ Code
    if (btnCopyCode) {
      btnCopyCode.addEventListener("click", () => {
        const codeEl = document.getElementById("pidCodeOutput");
        if (codeEl && navigator.clipboard) {
          navigator.clipboard.writeText(codeEl.textContent);
          showToast("📋 Controller declaration copied to clipboard!");
        }
      });
    }

    // Apply to Robot & Simulator
    if (btnApply) {
      btnApply.addEventListener("click", () => {
        const cur = state[currentMode];
        if (currentMode === "lateral") {
          bot.lateralKp = cur.kp;
          bot.lateralKi = cur.ki;
          bot.lateralKd = cur.kd;
          bot.lateralWindup = cur.windup;
          bot.lateralSlew = cur.slew;
          bot.lateralSmallErr = cur.smallErr;
          bot.lateralSmallTime = cur.smallTime;
          bot.lateralLargeTime = cur.largeTime;
        } else {
          bot.angularKp = cur.kp;
          bot.angularKi = cur.ki;
          bot.angularKd = cur.kd;
          bot.angularWindup = cur.windup;
          bot.angularSlew = cur.slew;
          bot.angularSmallErr = cur.smallErr;
          bot.angularSmallTime = cur.smallTime;
          bot.angularLargeTime = cur.largeTime;
        }

        syncBotInputs();
        if (window.ProjectManager && typeof window.ProjectManager.updateRobotConfigCpp === "function") {
          window.ProjectManager.updateRobotConfigCpp(bot);
        }

        markDirty();
        renderFlow();
        draw();
        updateTimeDisplay();
        closeModal();
        showToast(`🚀 Applied ${currentMode} PID gains to bot & updated src/robot-config.cpp!`);
      });
    }

    // Visual PID Tuning Draggable Canvas Interaction
    let isDraggingKp = false;
    let isDraggingKd = false;
    let lastX = 0;
    let lastY = 0;

    canvas.style.cursor = "pointer";

    function getMouseCoords(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    }

    function handleStart(e) {
      const coords = getMouseCoords(e);
      if (window.pidKpHandleX != null && window.pidKpHandleY != null) {
        const dKp = Math.hypot(coords.x - window.pidKpHandleX, coords.y - window.pidKpHandleY);
        if (dKp < 16) {
          isDraggingKp = true;
          lastX = coords.x;
          lastY = coords.y;
          canvas.style.cursor = "grabbing";
          e.preventDefault();
          return;
        }
      }
      if (window.pidKdHandleX != null && window.pidKdHandleY != null) {
        const dKd = Math.hypot(coords.x - window.pidKdHandleX, coords.y - window.pidKdHandleY);
        if (dKd < 16) {
          isDraggingKd = true;
          lastX = coords.x;
          lastY = coords.y;
          canvas.style.cursor = "grabbing";
          e.preventDefault();
          return;
        }
      }
    }

    function handleMove(e) {
      const coords = getMouseCoords(e);
      
      // Update cursor on hover
      if (!isDraggingKp && !isDraggingKd) {
        let hover = false;
        if (window.pidKpHandleX != null && window.pidKpHandleY != null) {
          if (Math.hypot(coords.x - window.pidKpHandleX, coords.y - window.pidKpHandleY) < 16) hover = true;
        }
        if (window.pidKdHandleX != null && window.pidKdHandleY != null) {
          if (Math.hypot(coords.x - window.pidKdHandleX, coords.y - window.pidKdHandleY) < 16) hover = true;
        }
        canvas.style.cursor = hover ? "grab" : "default";
        return;
      }

      const cur = state[currentMode];
      if (isDraggingKp) {
        const deltaY = lastY - coords.y;
        cur.kp = Math.max(0, Math.min(40, Number((cur.kp + deltaY * 0.15).toFixed(2))));
        syncInputsFromState();
        updateGraphAndDiagnosis();
      } else if (isDraggingKd) {
        const deltaX = coords.x - lastX;
        cur.kd = Math.max(0, Math.min(100, Number((cur.kd + deltaX * 0.4).toFixed(1))));
        syncInputsFromState();
        updateGraphAndDiagnosis();
      }

      lastX = coords.x;
      lastY = coords.y;
      e.preventDefault();
    }

    function handleEnd() {
      isDraggingKp = false;
      isDraggingKd = false;
      canvas.style.cursor = "default";
    }

    canvas.addEventListener("mousedown", handleStart);
    canvas.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleEnd);

    canvas.addEventListener("touchstart", handleStart, { passive: false });
    canvas.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleEnd);

    if (btnOpenHead) btnOpenHead.onclick = openModal;
    if (btnOpenBot) btnOpenBot.onclick = openModal;
    if (btnClose) btnClose.onclick = closeModal;
    if (btnCloseFooter) btnCloseFooter.onclick = closeModal;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  // -- Video (.mp4) Export Modal --------------------------------------
  function wireVideoExportModal() {
    const modal = document.getElementById("videoExportModal");
    const btnOpen = document.getElementById("btnExportVideo");
    const btnClose = document.getElementById("videoModalClose");
    const btnCancel = document.getElementById("videoModalCancelBtn");
    const btnStart = document.getElementById("btnStartVideoExport");

    const optTimer = document.getElementById("videoOptTimer");
    const optGauges = document.getElementById("videoOptGauges");
    const optBadges = document.getElementById("videoOptBadges");
    const optWatermark = document.getElementById("videoOptWatermark");
    const optFps = document.getElementById("videoOptFps");
    const optSpeed = document.getElementById("videoOptSpeed");

    const estDurEl = document.getElementById("videoEstDur");
    const estFramesEl = document.getElementById("videoEstFrames");
    const statusBox = document.getElementById("videoRecordingStatus");
    const statusText = document.getElementById("videoStatusText");
    const percentText = document.getElementById("videoPercentText");
    const progressBar = document.getElementById("videoProgressBar");
    const statusSub = document.getElementById("videoStatusSub");

    if (!modal) return;

    function openModal() {
      updateSummary();
      if (statusBox) statusBox.hidden = true;
      modal.hidden = false;
      modal.classList.add("open");
    }

    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("open");
    }

    function updateSummary() {
      const fps = Number(optFps?.value || 60);
      const speed = Number(optSpeed?.value || 1.0);
      const poses = computePoses();
      let totalSimTime = 0;

      actions.forEach((a, idx) => {
        const fromPose = poses[idx] || { x: pose.x, y: pose.y, theta: pose.theta };
        totalSimTime += estimateActionTime(a, fromPose);
      });

      const videoDuration = totalSimTime / speed;
      const totalFrames = Math.max(1, Math.round(videoDuration * fps));

      if (estDurEl) estDurEl.textContent = `~${videoDuration.toFixed(1)}s`;
      if (estFramesEl) estFramesEl.textContent = `${totalFrames} frames`;
    }

    if (optFps) optFps.onchange = updateSummary;
    if (optSpeed) optSpeed.onchange = updateSummary;

    async function recordRoutineVideo() {
      if (!actions || actions.length === 0) {
        showToast("⚠️ Autonomous routine is empty. Add movement actions first.");
        return;
      }

      const fps = Number(optFps?.value || 60);
      const speed = Number(optSpeed?.value || 1.0);
      const includeTimer = optTimer ? optTimer.checked : true;
      const includeGauges = optGauges ? optGauges.checked : true;
      const includeBadges = optBadges ? optBadges.checked : true;
      const includeWatermark = optWatermark ? optWatermark.checked : true;

      // Pre-compute complete simulation trajectory
      const simFrames = [];
      const poses = computePoses();
      let curP = { ...pose };
      let cumulativeTime = 0;

      actions.forEach((act, actIdx) => {
        const startPose = { ...curP };
        const simRes = simulateAction(act, startPose, bot);
        const subPoints = simRes.points || [{ ...startPose, vLin: 0, vAng: 0, dt: 0.01 }];

        subPoints.forEach((p) => {
          simFrames.push({
            ...p,
            actIdx,
            act,
            matchTime: cumulativeTime + (p.t || 0),
          });
        });

        if (subPoints.length > 0) {
          curP = { ...subPoints[subPoints.length - 1] };
          cumulativeTime += simRes.duration;
        }
      });

      if (simFrames.length === 0) {
        showToast("⚠️ No movement data generated for recording.");
        return;
      }

      // Show recording UI
      if (statusBox) statusBox.hidden = false;
      if (btnStart) btnStart.disabled = true;

      const vCanvas = document.createElement("canvas");
      vCanvas.width = 900;
      vCanvas.height = 900;
      const vCtx = vCanvas.getContext("2d");

      // Setup MediaRecorder
      const stream = vCanvas.captureStream(fps);
      let mimeType = "video/webm";
      if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")) mimeType = "video/mp4;codecs=avc1";
      else if (MediaRecorder.isTypeSupported("video/mp4")) mimeType = "video/mp4";
      else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) mimeType = "video/webm;codecs=vp9";

      let recorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });
      } catch (err) {
        recorder = new MediaRecorder(stream);
      }

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const activeName = activePath() ? activePath().name.replace(/[^a-zA-Z0-9_-]/g, "_") : "autonomous";
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        a.href = url;
        a.download = `${activeName}_routine_simulation.${ext}`;
        a.click();
        URL.revokeObjectURL(url);

        if (statusBox) statusBox.hidden = true;
        if (btnStart) btnStart.disabled = false;
        closeModal();
        showToast(`🎥 Autonomous simulation video exported successfully (${ext.toUpperCase()})!`);
      };

      recorder.start();

      // Render frames
      const totalSteps = simFrames.length;
      const frameSkip = Math.max(1, Math.round((0.01 * fps) / speed));
      const targetFrames = Math.ceil(totalSteps / frameSkip);
      let frameCount = 0;

      for (let i = 0; i < totalSteps; i += frameSkip) {
        const frameData = simFrames[i];
        renderRecordingFrame(vCtx, frameData, {
          includeTimer,
          includeGauges,
          includeBadges,
          includeWatermark,
          allActions: actions,
          totalDuration: cumulativeTime,
        });

        frameCount++;
        const pct = Math.min(100, Math.round((frameCount / targetFrames) * 100));

        if (progressBar) progressBar.style.width = `${pct}%`;
        if (percentText) percentText.textContent = `${pct}%`;
        if (statusSub) statusSub.textContent = `Rendering frame ${frameCount} of ${targetFrames} (${fps} FPS)...`;

        // Yield to browser event loop
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }

      // Add small buffer at end
      for (let j = 0; j < 15; j++) {
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }

      recorder.stop();
    }

    function renderRecordingFrame(ctx, frame, opts) {
      const W = 900;
      const H = 900;
      const HALF = 72;
      const INCH_PX = W / 144.0;

      const fToC = (x, y) => ({
        cx: (x + HALF) * INCH_PX,
        cy: (HALF - y) * INCH_PX,
      });

      // 1. Draw Field Background
      ctx.fillStyle = "#1e2430";
      ctx.fillRect(0, 0, W, H);

      // Soft grid
      ctx.strokeStyle = "#2d3748";
      ctx.lineWidth = 1;
      const tileSize = 24 * INCH_PX;
      for (let gx = 0; gx <= W; gx += tileSize) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
        ctx.stroke();
      }
      for (let gy = 0; gy <= H; gy += tileSize) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
        ctx.stroke();
      }

      // Center Origin cross
      ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      // Field Perimeter border
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, W - 4, H - 4);

      // 2. Draw Planned Path Waypoints
      ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      const startP = fToC(pose.x, pose.y);
      ctx.moveTo(startP.cx, startP.cy);
      opts.allActions.forEach((act) => {
        if (act.x != null && act.y != null) {
          const cp = fToC(act.x, act.y);
          ctx.lineTo(cp.cx, cp.cy);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // 3. Draw Robot Chassis
      const cp = fToC(frame.x, frame.y);
      const rad = ((90 - frame.theta) * Math.PI) / 180;
      const rW = (bot.robotW || 14) * INCH_PX;
      const rL = (bot.robotL || 14) * INCH_PX;

      ctx.save();
      ctx.translate(cp.cx, cp.cy);
      ctx.rotate(rad);

      // Bot Box
      ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.fillRect(-rW / 2, -rL / 2, rW, rL);
      ctx.strokeRect(-rW / 2, -rL / 2, rW, rL);

      // Front Heading Arrow
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(0, -rL / 2 - 12);
      ctx.lineTo(7, -rL / 2 + 2);
      ctx.lineTo(-7, -rL / 2 + 2);
      ctx.closePath();
      ctx.fill();

      // Heading line
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -rL / 2);
      ctx.stroke();

      ctx.restore();

      // 4. Live Velocity Vector
      const vLin = frame.vLin || 0;
      if (Math.abs(vLin) > 1) {
        const vLen = Math.min(50, Math.abs(vLin) * 0.7);
        const sRad = ((90 - frame.theta) * Math.PI) / 180;
        const dir = vLin >= 0 ? 1 : -1;
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cp.cx, cp.cy);
        ctx.lineTo(cp.cx + Math.cos(sRad) * vLen * dir, cp.cy + Math.sin(sRad) * vLen * dir);
        ctx.stroke();
      }

      // 5. Overlays
      // TOP LEFT: Watermark & Match Clock HUD
      if (opts.includeWatermark) {
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(16, 16, 320, 72, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 15px Inter, system-ui, sans-serif";
        ctx.fillText(activePath()?.name || "Autonomous Routine", 30, 42);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px Inter, system-ui, sans-serif";
        ctx.fillText("LemLib Kinematics · VEX V5 Competition", 30, 62);
        ctx.fillText(`Bot: ${bot.robotW}" × ${bot.robotL}" · ${bot.driveRpm} RPM`, 30, 76);
      }

      // TOP RIGHT: Official Match Timer HUD
      if (opts.includeTimer) {
        const matchSec = Math.min(15.0, frame.matchTime || 0);
        const timeStr = `00:${matchSec < 10 ? '0' : ''}${matchSec.toFixed(1)} / 00:15.0`;

        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(W - 276, 16, 260, 68, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#facc15";
        ctx.font = "bold 11px Inter, system-ui, sans-serif";
        ctx.fillText("⏱️ VEX AUTONOMOUS TIMER", W - 258, 38);

        ctx.fillStyle = matchSec >= 14.5 ? "#ef4444" : "#ffffff";
        ctx.font = "bold 19px monospace";
        ctx.fillText(timeStr, W - 258, 64);
      }

      // BOTTOM LEFT: Telemetry Speedometer & Gyro
      if (opts.includeGauges) {
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(16, H - 96, 340, 80, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 10px Inter, system-ui, sans-serif";
        ctx.fillText("📊 LIVE KINEMATIC TELEMETRY", 30, H - 76);

        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 13px Inter, system-ui, sans-serif";
        ctx.fillText(`Linear Speed: ${Math.abs(frame.vLin || 0).toFixed(1)} in/s`, 30, H - 54);

        ctx.fillStyle = "#c084fc";
        ctx.fillText(`Turn Rate: ${Math.abs(frame.vAng || 0).toFixed(1)} °/s`, 30, H - 34);

        ctx.fillStyle = "#34d399";
        ctx.fillText(`Pose: (${frame.x.toFixed(1)}", ${frame.y.toFixed(1)}", ${frame.theta.toFixed(1)}°)`, 30, H - 14);
      }

      // BOTTOM RIGHT: Active Action Badge
      if (opts.includeBadges && frame.act) {
        const act = frame.act;
        let actDesc = `${frame.actIdx + 1}. ${act.type}`;
        if (act.type === "moveToPoint" || act.type === "moveToPose") {
          actDesc += ` (${act.x}", ${act.y}")`;
        }

        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(W - 320, H - 84, 304, 68, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 11px Inter, system-ui, sans-serif";
        ctx.fillText("⚡ ACTIVE ACTION", W - 304, H - 64);

        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 13px Inter, system-ui, sans-serif";
        ctx.fillText(actDesc, W - 304, H - 42);

        if (act.label) {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "11px Inter, system-ui, sans-serif";
          ctx.fillText(`// ${act.label}`, W - 304, H - 24);
        }
      }
    }

    if (btnOpen) btnOpen.onclick = openModal;
    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;
    if (btnStart) btnStart.onclick = recordRoutineVideo;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }


  // -- Alliance Mirror Transformation Engine -------------------------
  function executeAllianceMirror(mode, options = {}) {
    const origPath = activePath();
    if (!origPath) return;

    const dest = options.destination || "new";
    const newName = options.newName || `${origPath.name} (${mode === "rot180" ? "Blue Inverted" : mode === "y" ? "Y-Flipped" : "Mirrored"})`;
    const invertSwing = options.invertSwingSides !== false;
    const swapColors = options.swapColorTerms !== false;
    const swapDirs = options.swapDirectionTerms !== false;
    const switchNow = options.switchImmediately !== false;

    function swapColorsInText(text) {
      if (!text || typeof text !== "string") return text;
      return text
        .replace(/\bRed\b/g, "__BLUE_TEMP__")
        .replace(/\bBlue\b/g, "Red")
        .replace(/__BLUE_TEMP__/g, "Blue")
        .replace(/\bred\b/g, "__blue_temp__")
        .replace(/\bblue\b/g, "red")
        .replace(/__blue_temp__/g, "blue")
        .replace(/\bRED\b/g, "__BLUE_CAP_TEMP__")
        .replace(/\bBLUE\b/g, "RED")
        .replace(/__BLUE_CAP_TEMP__/g, "BLUE");
    }

    function swapDirectionsInText(text) {
      if (!text || typeof text !== "string") return text;
      return text
        .replace(/\bLeft\b/g, "__RIGHT_TEMP__")
        .replace(/\bRight\b/g, "Left")
        .replace(/__RIGHT_TEMP__/g, "Right")
        .replace(/\bleft\b/g, "__right_temp__")
        .replace(/\bright\b/g, "left")
        .replace(/__right_temp__/g, "right")
        .replace(/\bLEFT\b/g, "__RIGHT_CAP_TEMP__")
        .replace(/\bRIGHT\b/g, "LEFT")
        .replace(/__RIGHT_CAP_TEMP__/g, "RIGHT");
    }

    function transformText(text) {
      let t = text;
      if (swapColors) t = swapColorsInText(t);
      if (swapDirs) t = swapDirectionsInText(t);
      return t;
    }

    function transformPose(p) {
      let x = p.x;
      let y = p.y;
      let theta = p.theta;
      if (mode === "x") {
        x = -x;
        theta = normalizeAngle(360 - theta);
      } else if (mode === "rot180") {
        x = -x;
        y = -y;
        theta = normalizeAngle(theta + 180);
      } else if (mode === "y") {
        y = -y;
        theta = normalizeAngle(180 - theta);
      }
      return { x, y, theta };
    }

    function transformAction(a) {
      const cloned = JSON.parse(JSON.stringify(a));
      cloned.id = uid();

      if (cloned.x != null) {
        if (mode === "x" || mode === "rot180") cloned.x = -cloned.x;
      }
      if (cloned.y != null) {
        if (mode === "rot180" || mode === "y") cloned.y = -cloned.y;
      }
      if (cloned.theta != null) {
        if (mode === "x") cloned.theta = normalizeAngle(360 - cloned.theta);
        else if (mode === "rot180") cloned.theta = normalizeAngle(cloned.theta + 180);
        else if (mode === "y") cloned.theta = normalizeAngle(180 - cloned.theta);
      }

      if (cloned.offsetX != null && (mode === "x" || mode === "rot180")) {
        cloned.offsetX = -cloned.offsetX;
      }
      if (cloned.offsetY != null && (mode === "y" || mode === "rot180")) {
        cloned.offsetY = -cloned.offsetY;
      }
      if (cloned.offsetTheta != null && (mode === "x" || mode === "y")) {
        cloned.offsetTheta = -cloned.offsetTheta;
      }

      if (invertSwing && cloned.lockedSide) {
        if (cloned.lockedSide === "LEFT") cloned.lockedSide = "RIGHT";
        else if (cloned.lockedSide === "RIGHT") cloned.lockedSide = "LEFT";
      }

      if (cloned.label) cloned.label = transformText(cloned.label);
      if (cloned.customCode) cloned.customCode = transformText(cloned.customCode);
      if (cloned.thenCode) cloned.thenCode = transformText(cloned.thenCode);
      if (cloned.elseCode) cloned.elseCode = transformText(cloned.elseCode);
      if (cloned.thenLabel) cloned.thenLabel = transformText(cloned.thenLabel);
      if (cloned.elseLabel) cloned.elseLabel = transformText(cloned.elseLabel);
      if (cloned.loopCode) cloned.loopCode = transformText(cloned.loopCode);

      if (Array.isArray(cloned.thenChildren)) {
        cloned.thenChildren = cloned.thenChildren.map(transformAction);
      }
      if (Array.isArray(cloned.elseChildren)) {
        cloned.elseChildren = cloned.elseChildren.map(transformAction);
      }
      if (Array.isArray(cloned.children)) {
        cloned.children = cloned.children.map(transformAction);
      }

      return cloned;
    }

    const transformedStart = transformPose(origPath.pose);
    const transformedActions = origPath.actions.map(transformAction);

    if (dest === "new") {
      const newPath = {
        id: uidPath(),
        name: newName,
        pose: transformedStart,
        actions: transformedActions,
      };
      paths.push(newPath);
      pushHistory(`Alliance Mirror "${origPath.name}" to "${newPath.name}"`);
      if (switchNow) {
        switchPath(newPath.id);
      } else {
        syncPathSelect();
      }
    } else {
      origPath.pose = transformedStart;
      origPath.actions = transformedActions;
      if (options.updateNameInPlace && newName) {
        origPath.name = newName;
      }
      pushHistory(`Alliance Mirror "${origPath.name}" in-place`);
      bindActive();
      selectedId = null;
      syncPathSelect();
      syncStartInputs();
      renderFlow();
      draw();
      markDirty();
      generateCode();
      try { updateTimeDisplay(); } catch (_) {}
    }
  }

  // -- Alliance Mirroring & Routine Inversion Modal -----------------
  function wireAllianceMirrorModal() {
    const modal = document.getElementById("allianceMirrorModal");
    const btnOpenMirrorHeader = document.getElementById("btnToolsAllianceMirror");
    const btnOpenMirrorRoutine = document.getElementById("btnPathMirror");
    const btnClose = document.getElementById("allianceMirrorClose");
    const btnCancel = document.getElementById("allianceMirrorCancelBtn");
    const btnExecute = document.getElementById("btnExecuteMirror");

    const modeRadios = document.querySelectorAll('input[name="mirrorModeSelect"]');
    const destRadios = document.querySelectorAll('input[name="mirrorDestination"]');
    const nameInput = document.getElementById("mirrorRoutineNameInput");
    const nameRow = document.getElementById("mirrorNewNameRow");
    const invertSwingCb = document.getElementById("mirrorInvertSwingSides");
    const swapColorCb = document.getElementById("mirrorSwapColorTerms");
    const swapDirCb = document.getElementById("mirrorSwapDirectionTerms");
    const switchNowCb = document.getElementById("mirrorSwitchImmediately");

    const origPoseTxt = document.getElementById("mirrorOrigPoseTxt");
    const newPoseTxt = document.getElementById("mirrorNewPoseTxt");
    const waypointCountTxt = document.getElementById("mirrorWaypointCount");
    const previewCanvas = document.getElementById("mirrorPreviewCanvas");

    if (!modal) return;

    function getSelectedMode() {
      const checked = document.querySelector('input[name="mirrorModeSelect"]:checked');
      return checked ? checked.value : "x";
    }

    function getSelectedDest() {
      const checked = document.querySelector('input[name="mirrorDestination"]:checked');
      return checked ? checked.value : "new";
    }

    function updateCardSelectionUI() {
      const selMode = getSelectedMode();
      document.querySelectorAll(".mirror-type-card").forEach((card) => {
        if (card.dataset.mode === selMode) {
          card.classList.add("active");
        } else {
          card.classList.remove("active");
        }
      });
    }

    function suggestMirroredName(origName, mode) {
      if (!origName) return "Mirrored_Routine";
      let base = origName;
      if (mode === "rot180") {
        if (/Red/i.test(base)) {
          base = base.replace(/\bRed\b/g, "Blue").replace(/\bred\b/g, "blue");
        } else if (/Blue/i.test(base)) {
          base = base.replace(/\bBlue\b/g, "Red").replace(/\bblue\b/g, "red");
        } else {
          base = base + " (Blue 180°)";
        }
      } else if (mode === "x") {
        if (/Left/i.test(base)) {
          base = base.replace(/\bLeft\b/g, "Right").replace(/\bleft\b/g, "right");
        } else if (/Right/i.test(base)) {
          base = base.replace(/\bRight\b/g, "Left").replace(/\bright\b/g, "left");
        } else {
          base = base + " (Flip X)";
        }
      } else if (mode === "y") {
        base = base + " (Flip Y)";
      }
      return base;
    }

    function getMirroredPose(p, mode) {
      let x = p.x;
      let y = p.y;
      let theta = p.theta;
      if (mode === "x") {
        x = -x;
        theta = normalizeAngle(360 - theta);
      } else if (mode === "rot180") {
        x = -x;
        y = -y;
        theta = normalizeAngle(theta + 180);
      } else if (mode === "y") {
        y = -y;
        theta = normalizeAngle(180 - theta);
      }
      return { x, y, theta };
    }

    function renderPreviewCanvas() {
      if (!previewCanvas) return;
      const ctx = previewCanvas.getContext("2d");
      const W = previewCanvas.width;
      const H = previewCanvas.height;
      const HALF = 72;
      const scale = Math.min(W, H) / 144.0;
      const ox = (W - 144 * scale) / 2;
      const oy = (H - 144 * scale) / 2;

      const toC = (x, y) => ({
        cx: ox + (x + HALF) * scale,
        cy: oy + (HALF - y) * scale,
      });

      // Clear & Background
      ctx.fillStyle = "#0c1222";
      ctx.fillRect(0, 0, W, H);

      // Grid tiles (6x6 tiles for standard 144" field)
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      const tileSize = 24 * scale;
      for (let x = ox; x <= ox + 144 * scale + 0.1; x += tileSize) {
        ctx.beginPath();
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + 144 * scale);
        ctx.stroke();
      }
      for (let y = oy; y <= oy + 144 * scale + 0.1; y += tileSize) {
        ctx.beginPath();
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + 144 * scale, y);
        ctx.stroke();
      }

      // Center origin axes
      ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox + 72 * scale, oy);
      ctx.lineTo(ox + 72 * scale, oy + 144 * scale);
      ctx.moveTo(ox, oy + 72 * scale);
      ctx.lineTo(ox + 144 * scale, oy + 72 * scale);
      ctx.stroke();

      // Field perimeter border
      ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox, oy, 144 * scale, 144 * scale);

      // Original path points
      const origPts = [{ x: pose.x, y: pose.y, theta: pose.theta }];
      actions.forEach((a) => {
        if (a.x != null && a.y != null) {
          origPts.push({ x: a.x, y: a.y, theta: a.theta != null ? a.theta : 0 });
        }
      });

      // Draw Original Path (Cyan dashed)
      if (origPts.length > 1) {
        ctx.strokeStyle = "rgba(56, 189, 248, 0.75)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const start = toC(origPts[0].x, origPts[0].y);
        ctx.moveTo(start.cx, start.cy);
        for (let i = 1; i < origPts.length; i++) {
          const pt = toC(origPts[i].x, origPts[i].y);
          ctx.lineTo(pt.cx, pt.cy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Original Waypoint Dots
      origPts.forEach((pt, idx) => {
        const c = toC(pt.x, pt.y);
        ctx.fillStyle = idx === 0 ? "#38bdf8" : "#0284c7";
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, idx === 0 ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      });

      // Mirrored path points
      const mode = getSelectedMode();
      const mirPts = origPts.map((p) => getMirroredPose(p, mode));

      // Draw Mirrored Path (Purple / Violet solid)
      if (mirPts.length > 1) {
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 3;
        ctx.beginPath();
        const start = toC(mirPts[0].x, mirPts[0].y);
        ctx.moveTo(start.cx, start.cy);
        for (let i = 1; i < mirPts.length; i++) {
          const pt = toC(mirPts[i].x, mirPts[i].y);
          ctx.lineTo(pt.cx, pt.cy);
        }
        ctx.stroke();
      }

      // Draw Mirrored Waypoint Dots & Direction Arrow
      mirPts.forEach((pt, idx) => {
        const c = toC(pt.x, pt.y);
        ctx.fillStyle = idx === 0 ? "#e879f9" : "#a855f7";
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, idx === 0 ? 6 : 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Draw start orientation heading indicator
        if (idx === 0) {
          const rad = ((90 - pt.theta) * Math.PI) / 180;
          const arrowLen = 14;
          const tipX = c.cx + Math.cos(rad) * arrowLen;
          const tipY = c.cy - Math.sin(rad) * arrowLen;
          ctx.strokeStyle = "#f472b6";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(c.cx, c.cy);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();
        }
      });
    }

    function updatePreviewAndUI() {
      const mode = getSelectedMode();
      const orig = activePath();
      if (!orig) return;

      updateCardSelectionUI();

      if (origPoseTxt) {
        origPoseTxt.textContent = `(${pose.x.toFixed(1)}", ${pose.y.toFixed(1)}", ${Math.round(normalizeAngle(pose.theta))}°)`;
      }
      const mirPose = getMirroredPose(pose, mode);
      if (newPoseTxt) {
        newPoseTxt.textContent = `(${mirPose.x.toFixed(1)}", ${mirPose.y.toFixed(1)}", ${Math.round(normalizeAngle(mirPose.theta))}°)`;
      }
      if (waypointCountTxt) {
        waypointCountTxt.textContent = `${actions.length} action${actions.length === 1 ? "" : "s"}`;
      }

      if (nameInput) {
        nameInput.value = suggestMirroredName(orig.name, mode);
      }

      renderPreviewCanvas();
    }

    function openModal() {
      const orig = activePath();
      if (!orig) return;
      modal.hidden = false;
      modal.classList.add("open");
      updatePreviewAndUI();
    }

    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("open");
    }

    if (btnOpenMirrorHeader) {
      btnOpenMirrorHeader.addEventListener("click", () => {
        openModal();
      });
    }

    if (btnOpenMirrorRoutine) {
      btnOpenMirrorRoutine.addEventListener("click", () => {
        const menu = document.getElementById("routineActionsMenu");
        if (menu) menu.hidden = true;
        openModal();
      });
    }

    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (btnCancel) btnCancel.addEventListener("click", closeModal);

    modeRadios.forEach((r) => {
      r.addEventListener("change", () => {
        updatePreviewAndUI();
      });
    });

    document.querySelectorAll(".mirror-type-card").forEach((card) => {
      card.addEventListener("click", () => {
        const r = card.querySelector('input[name="mirrorModeSelect"]');
        if (r && !r.checked) {
          r.checked = true;
          updatePreviewAndUI();
        }
      });
    });

    destRadios.forEach((r) => {
      r.addEventListener("change", () => {
        if (nameRow) {
          nameRow.hidden = (r.value === "inplace");
        }
      });
    });

    if (btnExecute) {
      btnExecute.addEventListener("click", () => {
        const mode = getSelectedMode();
        const dest = getSelectedDest();
        const newName = nameInput ? nameInput.value.trim() : "";
        const invertSwing = invertSwingCb ? invertSwingCb.checked : true;
        const swapColors = swapColorCb ? swapColorCb.checked : true;
        const swapDirs = swapDirCb ? swapDirCb.checked : true;
        const switchNow = switchNowCb ? switchNowCb.checked : true;

        executeAllianceMirror(mode, {
          destination: dest,
          newName: newName || `Mirrored Routine`,
          invertSwingSides: invertSwing,
          swapColorTerms: swapColors,
          swapDirectionTerms: swapDirs,
          switchImmediately: switchNow,
        });

        closeModal();
        showToast("🪞 Routine mirrored with competition symmetry!");
      });
    }

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  // -- Real-Time Drive Physics & 15s Auton Clock Modal ---------------
  function wireDrivePhysicsModal() {
    const modal = document.getElementById("drivePhysicsModal");
    const btnOpenTools = document.getElementById("btnToolsDrivePhysics");
    const btnOpenHud = document.getElementById("btnHudPhysicsModal");
    const btnOpenBotTab = document.getElementById("btnOpenPhysicsFromBot");
    const btnClose = document.getElementById("drivePhysicsClose");
    const btnCloseBtn = document.getElementById("drivePhysicsCloseBtn");
    const btnApply = document.getElementById("btnApplyPhysicsToBot");

    const motorCountSel = document.getElementById("physMotorCount");
    const weightRange = document.getElementById("physWeightRange");
    const weightVal = document.getElementById("physWeightVal");
    const tractionSel = document.getElementById("physTractionSelect");
    const battSel = document.getElementById("physBatterySelect");

    const btnPeriod15 = document.getElementById("btnPeriod15s");
    const btnPeriod60 = document.getElementById("btnPeriod60s");

    const calcDriveForce = document.getElementById("calcDriveForce");
    const calcTractionLimit = document.getElementById("calcTractionLimit");
    const calcInertia = document.getElementById("calcInertia");
    const calcFreeSpeed = document.getElementById("calcFreeSpeed");

    const kpiPeakSpeed = document.getElementById("physKpiPeakSpeed");
    const kpiPeakSpeedSub = document.getElementById("physKpiPeakSpeedSub");
    const kpiPeakAccel = document.getElementById("physKpiPeakAccel");
    const kpiPeakAccelSub = document.getElementById("physKpiPeakAccelSub");
    const kpiPeakG = document.getElementById("physKpiPeakG");
    const kpiGWarning = document.getElementById("physKpiGWarning");
    const kpiMinVolt = document.getElementById("physKpiMinVolt");
    const kpiPeakWatts = document.getElementById("physKpiPeakWatts");
    const kpiAutonCompliance = document.getElementById("physKpiAutonCompliance");
    const kpiMargin = document.getElementById("physKpiMargin");

    const graphCanvas = document.getElementById("physGraphCanvas");
    const legendRow = document.getElementById("physGraphLegend");
    let activeChannel = "velocity"; // "velocity" | "accel" | "power"

    if (!modal) return;

    function syncInputsFromBot() {
      if (motorCountSel) motorCountSel.value = String(bot.motorCount || 6);
      if (weightRange) weightRange.value = String(bot.robotWeightLbs || 15.0);
      if (weightVal) weightVal.value = String(bot.robotWeightLbs || 15.0);
      if (tractionSel) tractionSel.value = String(bot.wheelTraction || 0.85);
      if (battSel) battSel.value = String(bot.batteryVolts || 12.8);

      const period = bot.matchPeriod || "15s";
      if (period === "60s") {
        if (btnPeriod60) btnPeriod60.classList.add("active");
        if (btnPeriod15) btnPeriod15.classList.remove("active");
      } else {
        if (btnPeriod15) btnPeriod15.classList.add("active");
        if (btnPeriod60) btnPeriod60.classList.remove("active");
      }
    }

    function getCurrentSettingsBot() {
      return {
        ...bot,
        motorCount: Number(motorCountSel ? motorCountSel.value : 6) || 6,
        robotWeightLbs: Number(weightVal ? weightVal.value : 15.0) || 15.0,
        wheelTraction: Number(tractionSel ? tractionSel.value : 0.85) || 0.85,
        batteryVolts: Number(battSel ? battSel.value : 12.8) || 12.8,
        matchPeriod: btnPeriod60 && btnPeriod60.classList.contains("active") ? "60s" : "15s",
      };
    }

    function updateDynoCalculations() {
      const tempBot = getCurrentSettingsBot();
      const phys = getRobotPhysicsProps(tempBot);

      if (calcDriveForce) calcDriveForce.textContent = `~${phys.maxDriveForceLbf.toFixed(1)} lbf (${(phys.maxDriveForceLbf * 4.448).toFixed(0)} N)`;
      if (calcTractionLimit) calcTractionLimit.textContent = `~${phys.tractionMu.toFixed(2)} g (${Math.round(phys.maxTractionAccelInSec2)} in/s²)`;
      if (calcInertia) calcInertia.textContent = `~${(phys.inertiaJ * 386.09).toFixed(1)} lb·in²`;
      if (calcFreeSpeed) calcFreeSpeed.textContent = `~${phys.vMaxInSec.toFixed(1)} in/s (${phys.vMaxMph.toFixed(1)} mph)`;

      // Simulate current routine with temporary physics parameters
      const simPts = [];
      let cur = { x: pose.x, y: pose.y, theta: pose.theta };
      let tOffset = 0;
      actions.forEach((act) => {
        const seg = simulateAction(act, cur, tempBot);
        if (seg && seg.path) {
          seg.path.forEach((p, idx) => {
            if (idx > 0 || simPts.length === 0) {
              simPts.push({ ...p, t: tOffset + p.t });
            }
          });
          tOffset += seg.duration;
          cur = { ...seg.endPose };
        }
      });

      // Analyze performance KPIs
      let peakSpeed = 0;
      let peakAccel = 0;
      let peakG = 0;
      let minVolt = tempBot.batteryVolts;
      let peakWatts = 0;
      let slipOccurred = false;

      simPts.forEach((p) => {
        if (p.vLin && Math.abs(p.vLin) > peakSpeed) peakSpeed = Math.abs(p.vLin);
        if (p.aLin && Math.abs(p.aLin) > peakAccel) peakAccel = Math.abs(p.aLin);
        if (p.gTotal && p.gTotal > peakG) peakG = p.gTotal;
        if (p.voltage && p.voltage < minVolt) minVolt = p.voltage;
        if (p.watts && p.watts > peakWatts) peakWatts = p.watts;
        if (p.isSlipping) slipOccurred = true;
      });

      const peakMph = (peakSpeed * 3600) / 63360;
      const peakAccelG = peakAccel / 386.09;

      if (kpiPeakSpeed) kpiPeakSpeed.textContent = `${peakSpeed.toFixed(1)} in/s`;
      if (kpiPeakSpeedSub) kpiPeakSpeedSub.textContent = `${peakMph.toFixed(2)} mph`;

      if (kpiPeakAccel) kpiPeakAccel.textContent = `${peakAccelG.toFixed(2)} g`;
      if (kpiPeakAccelSub) kpiPeakAccelSub.textContent = `${Math.round(peakAccel)} in/s²`;

      if (kpiPeakG) kpiPeakG.textContent = `${peakG.toFixed(2)} g`;
      if (kpiGWarning) {
        if (slipOccurred) {
          kpiGWarning.textContent = "⚠️ Traction Slip (Drift)";
          kpiGWarning.style.color = "#f43f5e";
        } else {
          kpiGWarning.textContent = "🟢 Full Traction Grip";
          kpiGWarning.style.color = "#10b981";
        }
      }

      if (kpiMinVolt) kpiMinVolt.textContent = `${minVolt.toFixed(1)} V`;
      if (kpiPeakWatts) kpiPeakWatts.textContent = `Peak ${Math.round(peakWatts)} W`;

      const limitSec = tempBot.matchPeriod === "60s" ? 60.0 : 15.0;
      const totalTime = tOffset;
      const margin = limitSec - totalTime;

      if (kpiAutonCompliance) {
        if (margin >= 0) {
          kpiAutonCompliance.textContent = `🟢 Legal (${totalTime.toFixed(2)}s)`;
          kpiAutonCompliance.className = "kpi-val text-green";
        } else {
          kpiAutonCompliance.textContent = `⚠️ Overtime (+${Math.abs(margin).toFixed(2)}s)`;
          kpiAutonCompliance.className = "kpi-val text-red";
        }
      }
      if (kpiMargin) {
        kpiMargin.textContent = margin >= 0 ? `~${margin.toFixed(2)}s safety buffer` : `Exceeds ${limitSec.toFixed(0)}s clock!`;
      }

      renderDynoGraph(simPts, tempBot);
    }

    function renderDynoGraph(pts, currentBot) {
      if (!graphCanvas) return;
      const ctx = graphCanvas.getContext("2d");
      const W = graphCanvas.width;
      const H = graphCanvas.height;

      ctx.fillStyle = "#0c1222";
      ctx.fillRect(0, 0, W, H);

      if (!pts || pts.length < 2) {
        ctx.fillStyle = "#64748b";
        ctx.font = "13px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No path trajectory to analyze. Add actions to routine.", W / 2, H / 2);
        return;
      }

      const totalT = pts[pts.length - 1].t;
      const padLeft = 46;
      const padRight = 16;
      const padTop = 20;
      const padBottom = 28;
      const plotW = W - padLeft - padRight;
      const plotH = H - padTop - padBottom;

      // Update Legend Row
      if (legendRow) {
        if (activeChannel === "velocity") {
          legendRow.innerHTML = `
            <span class="legend-item"><span class="legend-color-box" style="background:#38bdf8;"></span> Linear Speed (in/s)</span>
            <span class="legend-item"><span class="legend-color-box" style="background:#facc15;"></span> Turn Rate (°/s)</span>
          `;
        } else if (activeChannel === "accel") {
          legendRow.innerHTML = `
            <span class="legend-item"><span class="legend-color-box" style="background:#f43f5e;"></span> Acceleration (g)</span>
            <span class="legend-item"><span class="legend-color-box" style="background:#fb923c;"></span> Centripetal Lat G</span>
            <span class="legend-item"><span class="legend-color-box" style="background:#ef4444;border-top:2px dashed #ef4444;"></span> Slip Limit (${currentBot.wheelTraction || 0.85}g)</span>
          `;
        } else if (activeChannel === "power") {
          legendRow.innerHTML = `
            <span class="legend-item"><span class="legend-color-box" style="background:#fbbf24;"></span> Battery Voltage (V)</span>
            <span class="legend-item"><span class="legend-color-box" style="background:#34d399;"></span> Drivetrain Power (W)</span>
          `;
        }
      }

      // Draw Grid & Axes
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padTop + (plotH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(W - padRight, y);
        ctx.stroke();
      }

      const timeSteps = 5;
      for (let i = 0; i <= timeSteps; i++) {
        const x = padLeft + (plotW / timeSteps) * i;
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();

        const tVal = (totalT / timeSteps) * i;
        ctx.fillStyle = "#64748b";
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${tVal.toFixed(1)}s`, x, H - 10);
      }

      const getX = (t) => padLeft + (Math.max(0, t) / Math.max(totalT, 0.01)) * plotW;

      if (activeChannel === "velocity") {
        // Linear velocity & turn rate
        const maxV = Math.max(80, ...pts.map((p) => Math.abs(p.vLin || 0)));
        const maxW = Math.max(360, ...pts.map((p) => Math.abs(p.omegaDeg || 0)));

        const getY_V = (v) => padTop + plotH - (Math.abs(v) / maxV) * plotH;
        const getY_W = (w) => padTop + plotH - (Math.abs(w) / maxW) * plotH;

        // Draw Speed (Cyan)
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = getX(p.t);
          const y = getY_V(p.vLin || 0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw Turn Rate (Yellow)
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = getX(p.t);
          const y = getY_W(p.omegaDeg || 0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Left axis labels (Speed)
        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(maxV)}`, padLeft - 6, padTop + 8);
        ctx.fillText(`0`, padLeft - 6, padTop + plotH);

      } else if (activeChannel === "accel") {
        const maxG = Math.max(1.5, (currentBot.wheelTraction || 0.85) * 1.3, ...pts.map((p) => p.gTotal || 0));
        const getYG = (g) => padTop + plotH - (Math.min(g, maxG) / maxG) * plotH;

        // Draw Traction Limit threshold line (Red dashed)
        const slipY = getYG(currentBot.wheelTraction || 0.85);
        ctx.strokeStyle = "rgba(239, 68, 68, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, slipY);
        ctx.lineTo(W - padRight, slipY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Linear Accel (Magenta)
        ctx.strokeStyle = "#f43f5e";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = getX(p.t);
          const y = getYG(Math.abs(p.gLin || 0));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw Lateral G (Orange)
        ctx.strokeStyle = "#fb923c";
        ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = getX(p.t);
          const y = getYG(p.gLateral || 0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = "#f43f5e";
        ctx.textAlign = "right";
        ctx.fillText(`${maxG.toFixed(1)}g`, padLeft - 6, padTop + 8);
        ctx.fillText(`0g`, padLeft - 6, padTop + plotH);

      } else if (activeChannel === "power") {
        const minV = 8.5;
        const maxV = 13.5;
        const maxW = Math.max(120, ...pts.map((p) => p.watts || 0));

        const getY_Volt = (v) => padTop + plotH - ((v - minV) / (maxV - minV)) * plotH;
        const getY_Watts = (w) => padTop + plotH - (w / maxW) * plotH;

        // Draw Battery Voltage (Amber)
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = getX(p.t);
          const y = getY_Volt(p.voltage || currentBot.batteryVolts || 12.8);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw Power (Green)
        ctx.strokeStyle = "#34d399";
        ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = getX(p.t);
          const y = getY_Watts(p.watts || 0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = "#fbbf24";
        ctx.textAlign = "right";
        ctx.fillText(`${maxV}V`, padLeft - 6, padTop + 8);
        ctx.fillText(`${minV}V`, padLeft - 6, padTop + plotH);
      }
    }

    function openModal() {
      syncInputsFromBot();
      modal.hidden = false;
      modal.classList.add("open");
      updateDynoCalculations();
    }

    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("open");
    }

    if (btnOpenTools) btnOpenTools.addEventListener("click", openModal);
    if (btnOpenHud) btnOpenHud.addEventListener("click", openModal);
    if (btnOpenBotTab) btnOpenBotTab.addEventListener("click", openModal);
    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (btnCloseBtn) btnCloseBtn.addEventListener("click", closeModal);

    // Form change events
    if (motorCountSel) motorCountSel.addEventListener("change", updateDynoCalculations);
    if (tractionSel) tractionSel.addEventListener("change", updateDynoCalculations);
    if (battSel) battSel.addEventListener("change", updateDynoCalculations);

    if (weightRange && weightVal) {
      weightRange.addEventListener("input", () => {
        weightVal.value = weightRange.value;
        updateDynoCalculations();
      });
      weightVal.addEventListener("input", () => {
        weightRange.value = weightVal.value;
        updateDynoCalculations();
      });
    }

    // Period toggles
    if (btnPeriod15 && btnPeriod60) {
      btnPeriod15.addEventListener("click", () => {
        btnPeriod15.classList.add("active");
        btnPeriod60.classList.remove("active");
        updateDynoCalculations();
      });
      btnPeriod60.addEventListener("click", () => {
        btnPeriod60.classList.add("active");
        btnPeriod15.classList.remove("active");
        updateDynoCalculations();
      });
    }

    // Preset buttons
    const presets = {
      "6m_speed": { motorCount: 6, rpm: 600, weight: 14.0, diam: 3.25, traction: 0.85 },
      "6m_balanced": { motorCount: 6, rpm: 450, weight: 15.0, diam: 3.25, traction: 0.85 },
      "8m_heavy": { motorCount: 8, rpm: 360, weight: 18.0, diam: 4.0, traction: 1.10 },
      "4m_starter": { motorCount: 4, rpm: 200, weight: 12.0, diam: 4.0, traction: 0.85 },
    };

    document.querySelectorAll(".btn-physics-preset").forEach((b) => {
      b.addEventListener("click", () => {
        const p = presets[b.dataset.preset];
        if (p) {
          if (motorCountSel) motorCountSel.value = String(p.motorCount);
          if (weightRange) weightRange.value = String(p.weight);
          if (weightVal) weightVal.value = String(p.weight);
          if (tractionSel) tractionSel.value = String(p.traction);
          updateDynoCalculations();
          showToast(`⚡ Loaded preset: ${b.textContent.trim()}`);
        }
      });
    });

    // Channel tabs
    document.querySelectorAll(".phys-channel-btn").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll(".phys-channel-btn").forEach((btn) => btn.classList.remove("active"));
        b.classList.add("active");
        activeChannel = b.dataset.channel;
        updateDynoCalculations();
      });
    });

    // Save Physics Settings to Robot
    if (btnApply) {
      btnApply.addEventListener("click", () => {
        const newProps = getCurrentSettingsBot();
        bot.motorCount = newProps.motorCount;
        bot.robotWeightLbs = newProps.robotWeightLbs;
        bot.wheelTraction = newProps.wheelTraction;
        bot.batteryVolts = newProps.batteryVolts;
        bot.matchPeriod = newProps.matchPeriod;

        syncBotInputs();
        isSimPathDirty = true;
        markDirty();
        updateTimeDisplay();
        draw();
        closeModal();
        showToast("💾 Saved robot drive physics & auton period settings!");
      });
    }

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }


// -- Init ---------------------------------------------------------
  wireBotSettings();
  wireBotVisualCard();
  
  // -- Build number + soft check ----------------------------------
  function showBuildNumber() {
    const el = document.getElementById("buildNumber");
    if (!el) return;
    const b = window.APP_BUILD || "local";
    el.textContent = b;
  }

  async function performHardUpdateReload(remoteVersion) {
    try {
      sessionStorage.setItem("lemlib_last_update_prompt_at", Date.now().toString());
      sessionStorage.setItem("lemlib_reload_in_progress", "true");
      if (window.ProjectManager && typeof window.ProjectManager.saveLocal === "function") {
        window.ProjectManager.saveLocal();
      }
    } catch (_) {}

    // Proactively fetch updated resources with cache: "reload" to evict browser disk cache
    try {
      const b = "?_=" + Date.now();
      await Promise.allSettled([
        fetch("version.js" + b, { cache: "reload" }),
        fetch("app.js" + b, { cache: "reload" }),
        fetch("session-guard.js" + b, { cache: "reload" }),
        fetch("project-manager.js" + b, { cache: "reload" })
      ]);
    } catch (_) {}

    // Unregister any service workers
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          await reg.unregister();
        }
      } catch (_) {}
    }

    // Clear caches
    if (typeof window !== "undefined" && window.caches) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      } catch (_) {}
    }

    // Force reload with cache-busting version query string
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set("v", remoteVersion || Date.now().toString());
    targetUrl.searchParams.set("reload", Date.now().toString());
    window.location.replace(targetUrl.toString());
  }
  window.performHardUpdateReload = performHardUpdateReload;

  async function checkForUpdates(manual) {
    try {
      const r = await fetch("version.js?_=" + Date.now(), {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        }
      });
      if (!r.ok) return;
      const text = await r.text();
      const m = text.match(/APP_BUILD\s*=\s*["']([^"']+)["']/);
      if (!m) return;
      const remote = m[1];
      const local = window.APP_BUILD || "";
      if (remote && local && remote !== local) {
        // Prevent infinite reload loop: do not auto-prompt if prompted or reloaded recently in this tab session
        if (!manual) {
          const lastPrompt = Number(sessionStorage.getItem("lemlib_last_update_prompt_at") || 0);
          if (Date.now() - lastPrompt < 60000) {
            console.log("[Update] Soft update check bypassed to prevent infinite reload loop.");
            return;
          }
        }

        if (confirm("A newer build is available (" + remote + ").\nReload now?")) {
          await performHardUpdateReload(remote);
        }
      } else if (manual) {
        alert("You are on the latest build (" + (local || remote) + ").");
      }
    } catch (e) {
      if (manual) alert("Could not check for updates.");
    }
  }


  /* =================================================================
     FIELD COLLISION DETECTION & OBSTACLE MANAGER MODAL
     ================================================================= */
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
    const gridEl = document.getElementById("collisionObstaclesGrid");

    if (!modal) return;

    function openModal() {
      syncInputs();
      renderDiagnosticsTable();
      renderObstaclesGrid();
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

      markDirty();
      renderFlow();
      draw();
      try { updateTimeDisplay(); } catch (_) {}
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

      if (!diagTbody) return;

      if (!collisionConfig.enabled) {
        diagTbody.innerHTML = `<tr><td colspan="7" class="collision-empty-row">⚠️ Collision detection is currently disabled. Toggle master switch above to activate checks.</td></tr>`;
        return;
      }

      if (num === 0) {
        diagTbody.innerHTML = `<tr><td colspan="7" class="collision-empty-row">✨ Path is 100% collision-free! Robot clears all walls, loaders, and goals.</td></tr>`;
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
            <td>
              <button type="button" class="btn-xs-clean col-jump-btn" data-action-id="${c.actionId}" style="color:#38bdf8;cursor:pointer;">
                🔍 Jump to Step
              </button>
            </td>
          </tr>
        `;
      });

      diagTbody.innerHTML = rowsHtml;

      diagTbody.querySelectorAll(".col-jump-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const actId = btn.dataset.actionId;
          closeModal();
          selectedId = actId;
          renderFlow();
          draw();
          setTimeout(() => {
            const cardEl = document.querySelector(`.action-card[data-id="${actId}"]`);
            if (cardEl) {
              cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
              cardEl.classList.add("selected");
            }
          }, 60);
        });
      });
    }

    function renderObstaclesGrid() {
      if (!gridEl) return;
      let html = "";

      // 1. Loaders
      FIELD_OBSTACLES.loaders.forEach((loader) => {
        const isMuted = !!collisionConfig.disabledObstacleIds[loader.id];
        const colorTag = loader.color === "red" ? "red" : "blue";
        html += `
          <div class="collision-obstacle-card ${isMuted ? 'muted' : ''}">
            <div class="col-obs-head">
              <span class="col-obs-tag ${colorTag}">${loader.color.toUpperCase()} LOADER</span>
              <label class="col-obs-check">
                <input type="checkbox" data-obs-id="${loader.id}" ${!isMuted ? 'checked' : ''} />
                <span>Active</span>
              </label>
            </div>
            <div class="col-obs-title">${loader.name}</div>
            <div class="col-obs-meta">X: [${loader.minX}", ${loader.maxX}"] · Y: [${loader.minY}", ${loader.maxY}"]</div>
            <div class="col-obs-desc">Official match load chute angled off perimeter wall.</div>
          </div>
        `;
      });

      // 2. Mobile Goals
      FIELD_OBSTACLES.goals.forEach((goal) => {
        const isMuted = !!collisionConfig.disabledObstacleIds[goal.id];
        const isClamped = !!collisionConfig.clampedObstacleIds[goal.id];
        const colorTag = goal.color === "red" ? "red" : (goal.color === "blue" ? "blue" : "neutral");
        html += `
          <div class="collision-obstacle-card ${isMuted ? 'muted' : ''} ${isClamped ? 'clamped' : ''}">
            <div class="col-obs-head">
              <span class="col-obs-tag ${colorTag}">${goal.color.toUpperCase()} MOGO</span>
              <label class="col-obs-check">
                <input type="checkbox" data-obs-id="${goal.id}" ${!isMuted ? 'checked' : ''} />
                <span>Active</span>
              </label>
            </div>
            <div class="col-obs-title">${goal.name}</div>
            <div class="col-obs-meta">Pos: (${goal.x}", ${goal.y}") · Radius: ${goal.radius}"</div>
            <div class="col-obs-actions">
              <button type="button" class="btn-clamp-mogo ${isClamped ? 'active' : ''}" data-clamp-id="${goal.id}" title="Toggle clamped status if robot is carrying this mobile goal">
                ${isClamped ? '🧲 Clamped (Carried)' : '🧲 Clamp to Bot'}
              </button>
            </div>
          </div>
        `;
      });

      // 3. Center Ladder
      FIELD_OBSTACLES.ladder.forEach((lad) => {
        const isMuted = !!collisionConfig.disabledObstacleIds[lad.id];
        html += `
          <div class="collision-obstacle-card ${isMuted ? 'muted' : ''}">
            <div class="col-obs-head">
              <span class="col-obs-tag neutral">FIELD STRUCTURE</span>
              <label class="col-obs-check">
                <input type="checkbox" data-obs-id="${lad.id}" ${!isMuted ? 'checked' : ''} />
                <span>Active</span>
              </label>
            </div>
            <div class="col-obs-title">${lad.name}</div>
            <div class="col-obs-meta">Center (0", 0") · Radius: ${lad.radius}"</div>
            <div class="col-obs-desc">Central ladder obstacle uprights and rungs.</div>
          </div>
        `;
      });

      gridEl.innerHTML = html;

      // Bind obstacle enable/disable toggles
      gridEl.querySelectorAll("input[data-obs-id]").forEach((chk) => {
        chk.addEventListener("change", (e) => {
          const obsId = e.target.dataset.obsId;
          if (e.target.checked) {
            delete collisionConfig.disabledObstacleIds[obsId];
          } else {
            collisionConfig.disabledObstacleIds[obsId] = true;
          }
          markDirty();
          renderFlow();
          draw();
          renderDiagnosticsTable();
          renderObstaclesGrid();
        });
      });

      // Bind clamp/carried toggles
      gridEl.querySelectorAll("button[data-clamp-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const gid = btn.dataset.clampId;
          if (collisionConfig.clampedObstacleIds[gid]) {
            delete collisionConfig.clampedObstacleIds[gid];
            showToast(`🧲 Released ${gid} from robot clamp.`);
          } else {
            collisionConfig.clampedObstacleIds[gid] = true;
            showToast(`🧲 Marked ${gid} as clamped/carried by robot.`);
          }
          markDirty();
          renderFlow();
          draw();
          renderDiagnosticsTable();
          renderObstaclesGrid();
        });
      });
    }

    if (btnOpenHud) btnOpenHud.onclick = openModal;
    if (btnClose) btnClose.onclick = closeModal;
    if (btnDone) btnDone.onclick = closeModal;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    [chkMaster, chkLoaders, chkGoals, chkWalls, chkLadder, chkOverlays, chkStopSim].forEach((el) => {
      if (el) el.addEventListener("change", updateConfigAndRedraw);
    });

    if (rngBuffer) {
      rngBuffer.addEventListener("input", updateConfigAndRedraw);
    }

    const btnExportPdf = document.getElementById("btnExportCollisionPdf");
    if (btnExportPdf) {
      btnExportPdf.onclick = () => {
        generateCollisionPdfReport();
      };
    }
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

  function generateCollisionPdfReport() {
    const report = evaluateRoutineCollisions();
    const curPath = typeof activePath === "function" ? activePath() : null;
    const routineName = (curPath && curPath.name) ? curPath.name : ((autonSlots && autonSlots[activeSlotIndex] && autonSlots[activeSlotIndex].name) ? autonSlots[activeSlotIndex].name : "Autonomous Routine");
    const slotNum = (typeof activeSlotIndex !== "undefined" ? activeSlotIndex : 0) + 1;
    const dateStr = new Date().toLocaleString();
    const bufVal = collisionConfig.safetyBuffer || 0;

    let critCount = 0;
    let majCount = 0;
    let minCount = 0;

    report.collisions.forEach((c) => {
      const sev = getCollisionSeverity(c);
      if (sev.level === "CRITICAL") critCount++;
      else if (sev.level === "MAJOR") majCount++;
      else if (sev.level === "MINOR") minCount++;
    });

    if (window.jspdf && window.jspdf.jsPDF) {
      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        let y = 15;

        // Header Banner
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageWidth, 28, "F");

        doc.setTextColor(56, 189, 248);
        doc.setFontSize(15);
        doc.setFont("helvetica", "bold");
        doc.text("VEX High Stakes Trajectory Collision & Safety Report", 14, 12);

        doc.setFontSize(9.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(203, 213, 225);
        doc.text(`Generated: ${dateStr} · VEX V5 LemLib Suite Engine`, 14, 20);

        y = 36;

        // Routine Info Card
        doc.setDrawColor(51, 65, 85);
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(14, y, pageWidth - 28, 26, 3, 3, "FD");

        doc.setTextColor(15, 23, 42);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(`Routine: ${routineName} (Slot #${slotNum})`, 18, y + 8);

        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(71, 85, 105);
        const botWidth = bot ? (bot.bumperWidth || bot.trackWidth || 13) : 13;
        const botLen = bot ? (bot.bumperLength || bot.wheelBase || 13) : 13;
        doc.text(`Robot Dimensions: ${botWidth}" W × ${botLen}" L  |  Safety Buffer Clearance: +${bufVal.toFixed(2)}"  |  Actions: ${actions ? actions.length : 0} steps`, 18, y + 16);
        doc.text(`Collision Master: ${collisionConfig.enabled ? 'ENABLED' : 'DISABLED'}  |  Obstacles Checked: Perimeter Walls, Match Loaders, Mogos, Center Ladder`, 18, y + 21);

        y += 32;

        // Executive Summary Box
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text("Executive Safety Summary", 14, y);
        y += 5;

        const isClean = report.totalCollisions === 0;
        doc.setFillColor(isClean ? 240 : 254, isClean ? 253 : 242, isClean ? 244 : 242);
        doc.setDrawColor(isClean ? 34 : 239, isClean ? 197 : 68, isClean ? 94 : 68);
        doc.roundedRect(14, y, pageWidth - 28, 22, 3, 3, "FD");

        doc.setFontSize(10.5);
        doc.setFont("helvetica", "bold");
        if (isClean) {
          doc.setTextColor(22, 101, 52);
          doc.text("STATUS: PASSED — 100% CLEAN TRAJECTORY (0 Collisions Detected)", 18, y + 9);
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.text("The simulated trajectory clears all field perimeter walls, match loaders, mobile goals, and ladder structures.", 18, y + 16);
        } else {
          doc.setTextColor(153, 27, 27);
          doc.text(`STATUS: ACTION REQUIRED — ${report.totalCollisions} TRAJECTORY COLLISION(S) DETECTED`, 18, y + 9);
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.text(`Severity Breakdown: ${critCount} Critical Impact(s)  |  ${majCount} Major Overlap(s)  |  ${minCount} Minor Clearance Breach(es)`, 18, y + 16);
        }

        y += 28;

        // Detailed Table Header
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text("Detailed Collision Log & Timestamps", 14, y);
        y += 6;

        if (report.totalCollisions === 0) {
          doc.setFontSize(10);
          doc.setFont("helvetica", "italic");
          doc.setTextColor(100, 116, 139);
          doc.text("No collisions recorded along trajectory.", 14, y);
        } else {
          // Table Header
          doc.setFillColor(30, 41, 59);
          doc.rect(14, y, pageWidth - 28, 8, "F");

          doc.setFontSize(8.5);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(255, 255, 255);
          doc.text("Step #", 16, y + 5.5);
          doc.text("Action Type", 32, y + 5.5);
          doc.text("Timestamp", 62, y + 5.5);
          doc.text("Severity", 85, y + 5.5);
          doc.text("Robot Pose (X, Y, Theta)", 112, y + 5.5);
          doc.text("Obstacle Collided", 155, y + 5.5);

          y += 8;

          doc.setFontSize(8);
          doc.setFont("helvetica", "normal");

          report.collisions.forEach((c, idx) => {
            if (y > pageHeight - 20) {
              doc.addPage();
              y = 15;
              doc.setFillColor(30, 41, 59);
              doc.rect(14, y, pageWidth - 28, 8, "F");
              doc.setFontSize(8.5);
              doc.setFont("helvetica", "bold");
              doc.setTextColor(255, 255, 255);
              doc.text("Step #", 16, y + 5.5);
              doc.text("Action Type", 32, y + 5.5);
              doc.text("Timestamp", 62, y + 5.5);
              doc.text("Severity", 85, y + 5.5);
              doc.text("Robot Pose (X, Y, Theta)", 112, y + 5.5);
              doc.text("Obstacle Collided", 155, y + 5.5);
              y += 8;
              doc.setFontSize(8);
              doc.setFont("helvetica", "normal");
            }

            const sev = getCollisionSeverity(c);
            const rowBg = idx % 2 === 0 ? 255 : 248;
            doc.setFillColor(rowBg, rowBg, rowBg);
            doc.rect(14, y, pageWidth - 28, 7.5, "F");

            doc.setTextColor(15, 23, 42);
            doc.setFont("helvetica", "bold");
            doc.text(`#${c.stepIdx + 1}`, 16, y + 5);

            doc.setFont("helvetica", "normal");
            doc.text(c.actionType.substring(0, 16), 32, y + 5);

            const tsStr = c.point ? c.point.t.toFixed(2) + "s" : (c.t ? c.t.toFixed(2) + "s" : "0.00s");
            doc.text(tsStr, 62, y + 5);

            // Severity Badge
            if (sev.level === "CRITICAL") doc.setTextColor(220, 38, 38);
            else if (sev.level === "MAJOR") doc.setTextColor(234, 88, 12);
            else doc.setTextColor(161, 98, 7);
            doc.setFont("helvetica", "bold");
            doc.text(sev.level, 85, y + 5);

            doc.setTextColor(15, 23, 42);
            doc.setFont("helvetica", "normal");
            const poseStr = `(${c.point ? c.point.x.toFixed(1) : 0}", ${c.point ? c.point.y.toFixed(1) : 0}", ${c.point ? Math.round(c.point.theta) : 0}°)`;
            doc.text(poseStr, 112, y + 5);

            const obsNameStr = (c.obstacle ? c.obstacle.name : "Field Obstacle").substring(0, 24);
            doc.text(obsNameStr, 155, y + 5);

            doc.setDrawColor(226, 232, 240);
            doc.line(14, y + 7.5, pageWidth - 14, y + 7.5);

            y += 7.5;
          });
        }

        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(`Page ${i} of ${pageCount} · VEX High Stakes LemLib Collision Engine`, 14, pageHeight - 8);
        }

        const fileName = `VEX_Collision_Report_${routineName.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
        doc.save(fileName);
        showToast("📄 Downloaded trajectory collision report PDF!");
        return;
      } catch (err) {
        console.warn("jsPDF export error, falling back to print window:", err);
      }
    }

    openPrintWindowFallback(report, routineName, slotNum, dateStr, bufVal, critCount, majCount, minCount);
  }

  function openPrintWindowFallback(report, routineName, slotNum, dateStr, bufVal, critCount, majCount, minCount) {
    const win = window.open("", "_blank");
    if (!win) {
      showToast("⚠️ Popup blocked! Please allow popups to view/print PDF report.");
      return;
    }

    let rowsHtml = "";
    if (report.totalCollisions === 0) {
      rowsHtml = `<tr><td colspan="6" style="padding:16px;text-align:center;color:#166534;font-weight:600;">✨ Path is 100% collision-free! Robot clears all walls, loaders, and goals.</td></tr>`;
    } else {
      report.collisions.forEach((c) => {
        const sev = getCollisionSeverity(c);
        const poseStr = `(${c.point ? c.point.x.toFixed(1) : 0}", ${c.point ? c.point.y.toFixed(1) : 0}", ${c.point ? Math.round(c.point.theta) : 0}°)`;
        rowsHtml += `
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px;font-weight:bold;">#${c.stepIdx + 1}</td>
            <td style="padding:8px;">${escapeHtml(c.actionType)}</td>
            <td style="padding:8px;font-weight:bold;">${c.point ? c.point.t.toFixed(2) + "s" : "—"}</td>
            <td style="padding:8px;font-weight:bold;color:${sev.color};">${sev.label}</td>
            <td style="padding:8px;"><code>${poseStr}</code></td>
            <td style="padding:8px;font-weight:bold;">💥 ${escapeHtml(c.obstacle.name)}</td>
          </tr>
        `;
      });
    }

    const isClean = report.totalCollisions === 0;

    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>VEX High Stakes Collision Report - ${escapeHtml(routineName)}</title>
        <style>
          body { font-family: sans-serif; padding: 24px; color: #0f172a; max-width: 900px; margin: 0 auto; }
          .header { background: #0f172a; color: #38bdf8; padding: 18px 24px; border-radius: 8px; margin-bottom: 20px; }
          .header h1 { margin: 0; font-size: 1.4rem; }
          .meta { font-size: 0.85rem; color: #cbd5e1; margin-top: 4px; }
          .summary { padding: 16px; border-radius: 8px; margin-bottom: 24px; background: ${isClean ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${isClean ? '#22c55e' : '#ef4444'}; }
          .summary h2 { margin: 0 0 6px 0; font-size: 1.1rem; color: ${isClean ? '#166534' : '#991b1b'}; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.9rem; }
          th { background: #1e293b; color: #fff; padding: 10px; text-align: left; }
          td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
          @media print {
            body { padding: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🛡️ VEX High Stakes Trajectory Collision &amp; Safety Report</h1>
          <div class="meta">Routine: ${escapeHtml(routineName)} (Slot #${slotNum}) · Generated ${dateStr}</div>
        </div>
        <div class="summary">
          <h2>STATUS: ${isClean ? 'PASSED (0 Collisions)' : `ACTION REQUIRED (${report.totalCollisions} Collisions Detected)`}</h2>
          <p style="margin:0;font-size:0.9rem;">
            ${isClean ? 'Path clears all field perimeter walls, match loaders, mobile goals, and ladder structures.' : `Critical: ${critCount} · Major: ${majCount} · Minor: ${minCount} · Safety Buffer Clearance: +${bufVal.toFixed(2)}"`}
          </p>
        </div>
        <h3>Detailed Trajectory Collision Log</h3>
        <table>
          <thead>
            <tr>
              <th>Step #</th>
              <th>Action</th>
              <th>Timestamp</th>
              <th>Severity</th>
              <th>Robot Pose (X, Y, θ)</th>
              <th>Obstacle Collided</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <div style="margin-top:24px;text-align:right;">
          <button onclick="window.print()" style="padding:10px 20px;background:#38bdf8;border:none;border-radius:6px;color:#0f172a;font-weight:bold;cursor:pointer;">🖨️ Print / Save as PDF</button>
        </div>
      </body>
      </html>
    `);
    win.document.close();
  }


  /* =================================================================
     BREADCRUMB NAVIGATION & GLOBAL QOL UTILITIES
     ================================================================= */
  function renderBreadcrumbs() {
    const el = document.getElementById("flowBreadcrumbs");
    if (!el) return;

    const curPath = activePath();
    const routineName = curPath ? curPath.name : "Routine";

    if (!selectedId) {
      el.innerHTML = `
        <div class="crumb-item active" data-crumb-act="root" title="Top-level routine view">
          <span>🏁</span> <strong>${escapeHtml(routineName)}</strong> <span class="crumb-count">(${actions.length} ${actions.length === 1 ? "block" : "blocks"})</span>
        </div>
      `;
      return;
    }

    // Find trail to selectedId
    function findTrail(id, list, parentTrail = []) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const currentStep = {
          id: item.id,
          type: item.type,
          index: i + 1,
          item: item
        };
        if (item.id === id) {
          return [...parentTrail, currentStep];
        }
        if (item.type === "ifElse") {
          if (Array.isArray(item.thenChildren)) {
            const res = findTrail(id, item.thenChildren, [...parentTrail, currentStep, { branch: "then", parentId: item.id }]);
            if (res) return res;
          }
          if (Array.isArray(item.elseChildren)) {
            const res = findTrail(id, item.elseChildren, [...parentTrail, currentStep, { branch: "else", parentId: item.id }]);
            if (res) return res;
          }
        }
        if (item.type === "loop" && Array.isArray(item.children)) {
          const res = findTrail(id, item.children, [...parentTrail, currentStep, { branch: "loop", parentId: item.id }]);
          if (res) return res;
        }
      }
      return null;
    }

    const trail = findTrail(selectedId, actions);

    let html = `
      <div class="crumb-item" data-crumb-act="root" title="Select top-level routine">
        <span>🏁</span> <strong>${escapeHtml(routineName)}</strong>
      </div>
    `;

    if (trail && trail.length) {
      trail.forEach((step, idx) => {
        const isLast = idx === trail.length - 1;
        html += `<span class="crumb-sep">›</span>`;

        if (step.branch) {
          const branchLabel = step.branch === "then" ? "Then Branch" : (step.branch === "else" ? "Else Branch" : "Loop Body");
          const branchClass = step.branch === "then" ? "then-branch" : (step.branch === "else" ? "else-branch" : "loop-branch");
          html += `
            <div class="crumb-item branch ${branchClass}" data-crumb-act="branch" data-parent-id="${step.parentId}" data-branch="${step.branch}">
              <span>⚡</span> ${branchLabel}
            </div>
          `;
        } else {
          let icon = "📍";
          if (step.type === "ifElse") icon = "🔀";
          else if (step.type === "loop") icon = "🔁";
          else if (step.type.includes("turn")) icon = "🔄";
          else if (step.type.includes("swing")) icon = "🌊";
          else if (step.type === "custom") icon = "🔴";

          const label = `#${step.index} ${step.type === 'ifElse' ? 'if/else' : step.type}`;
          html += `
            <div class="crumb-item ${isLast ? "active" : ""}" data-crumb-act="block" data-id="${step.id}">
              <span>${icon}</span> ${escapeHtml(label)}
            </div>
          `;
        }
      });
    } else {
      html += `
        <span class="crumb-sep">›</span>
        <div class="crumb-item active"><span>📍</span> Selected Block</div>
      `;
    }

    el.innerHTML = html;
  }

  function wireBreadcrumbs() {
    const el = document.getElementById("flowBreadcrumbs");
    if (!el) return;

    el.addEventListener("click", (e) => {
      const item = e.target.closest("[data-crumb-act]");
      if (!item) return;

      const act = item.dataset.crumbAct;
      if (act === "root") {
        selectedId = null;
        renderFlow();
        draw();
      } else if (act === "block") {
        const id = item.dataset.id;
        if (id) {
          selectedId = id;
          renderFlow();
          draw();
          setTimeout(() => {
            const cardEl = document.querySelector(`.action-card[data-id="${id}"]`) || document.querySelector(`[data-nested-child-id="${id}"]`);
            if (cardEl) cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 30);
        }
      } else if (act === "branch") {
        const parentId = item.dataset.parentId;
        const branch = item.dataset.branch;
        if (parentId) {
          selectedId = parentId;
          if (branch === "then" || branch === "else") {
            const parentBlock = actions.find(a => a.id === parentId);
            if (parentBlock && parentBlock.type === "ifElse") {
              parentBlock.activeSimBranch = branch;
            }
          }
          renderFlow();
          draw();
          setTimeout(() => {
            const cardEl = document.querySelector(`.action-card[data-id="${parentId}"]`);
            if (cardEl) cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 30);
        }
      }
    });
  }

  function duplicateActionById(actionId) {
    if (!actionId) return;

    function cloneAction(act) {
      const cloned = JSON.parse(JSON.stringify(act));
      cloned.id = uid();
      if (Array.isArray(cloned.thenChildren)) cloned.thenChildren = cloned.thenChildren.map(cloneAction);
      if (Array.isArray(cloned.elseChildren)) cloned.elseChildren = cloned.elseChildren.map(cloneAction);
      if (Array.isArray(cloned.children)) cloned.children = cloned.children.map(cloneAction);
      return cloned;
    }

    const idx = actions.findIndex((x) => x.id === actionId);
    if (idx !== -1) {
      const cloned = cloneAction(actions[idx]);
      actions.splice(idx + 1, 0, cloned);
      selectedId = cloned.id;
      markDirty();
      renderFlow();
      draw();
      generateCode();
      try { updateTimeDisplay(); } catch (_) {}
      showToast(`📋 Duplicated block #${idx + 1} (${cloned.type})`);
      return;
    }

    // Check nested loops and if/else
    for (const a of actions) {
      if (a.type === "loop" && Array.isArray(a.children)) {
        const cIdx = a.children.findIndex((x) => x.id === actionId);
        if (cIdx !== -1) {
          const cloned = cloneAction(a.children[cIdx]);
          a.children.splice(cIdx + 1, 0, cloned);
          selectedId = cloned.id;
          markDirty();
          renderFlow();
          draw();
          generateCode();
          try { updateTimeDisplay(); } catch (_) {}
          showToast(`📋 Duplicated block in Loop (${cloned.type})`);
          return;
        }
      }
      if (a.type === "ifElse") {
        if (Array.isArray(a.thenChildren)) {
          const tIdx = a.thenChildren.findIndex((x) => x.id === actionId);
          if (tIdx !== -1) {
            const cloned = cloneAction(a.thenChildren[tIdx]);
            a.thenChildren.splice(tIdx + 1, 0, cloned);
            selectedId = cloned.id;
            markDirty();
            renderFlow();
            draw();
            generateCode();
            try { updateTimeDisplay(); } catch (_) {}
            showToast(`📋 Duplicated block in Then Branch (${cloned.type})`);
            return;
          }
        }
        if (Array.isArray(a.elseChildren)) {
          const eIdx = a.elseChildren.findIndex((x) => x.id === actionId);
          if (eIdx !== -1) {
            const cloned = cloneAction(a.elseChildren[eIdx]);
            a.elseChildren.splice(eIdx + 1, 0, cloned);
            selectedId = cloned.id;
            markDirty();
            renderFlow();
            draw();
            generateCode();
            try { updateTimeDisplay(); } catch (_) {}
            showToast(`📋 Duplicated block in Else Branch (${cloned.type})`);
            return;
          }
        }
      }
    }
  }

  /* =================================================================
     COMMAND PALETTE (CTRL+K) & GLOBAL KEYBOARD SHORTCUTS
     ================================================================= */
  let cmdPaletteHighlightIdx = 0;
  let cmdPaletteFilteredList = [];

  function addActionToFlow(type) {
    const act = defaultAction(type);
    if (!act) return;
    actions.push(act);
    selectedId = act.id;
    markDirty();
    renderFlow();
    draw();
    generateCode();
    try { updateTimeDisplay(); } catch (_) {}
    switchPlannerTab("flowchart");
    showToast(`➕ Added '${type}' block to routine!`);

    setTimeout(() => {
      const cardEl = document.querySelector(`.action-card[data-id="${act.id}"]`);
      if (cardEl) cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function addSnippetToFlow(snippet) {
    const act = defaultAction("custom");
    act.customCode = snippet;
    act.label = snippet.split("(")[0] || "subsystem command";
    actions.push(act);
    selectedId = act.id;
    markDirty();
    renderFlow();
    draw();
    generateCode();
    try { updateTimeDisplay(); } catch (_) {}
    switchPlannerTab("flowchart");
    showToast(`🟢 Inserted subsystem snippet '${snippet}'!`);

    setTimeout(() => {
      const cardEl = document.querySelector(`.action-card[data-id="${act.id}"]`);
      if (cardEl) cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function setSimSpeed(sp) {
    simSpeed = sp;
    const speedEl = document.getElementById("simSpeedVal");
    if (speedEl) speedEl.textContent = `${sp.toFixed(1)}x`;
    showToast(`⚡ Simulation speed set to ${sp.toFixed(1)}x`);
  }

  function toggleCommandPaletteModal() {
    const modal = document.getElementById("commandPaletteModal");
    if (!modal) return;
    if (modal.hidden) {
      modal.hidden = false;
      modal.classList.add("open");
      const input = document.getElementById("cmdPaletteInput");
      if (input) {
        input.value = "";
        input.focus();
      }
      cmdPaletteHighlightIdx = 0;
      renderCommandPaletteList();
    } else {
      modal.hidden = true;
      modal.classList.remove("open");
    }
  }

  function closeCommandPaletteModal() {
    const modal = document.getElementById("commandPaletteModal");
    if (modal) {
      modal.hidden = true;
      modal.classList.remove("open");
    }
  }

  function renderCommandPaletteList() {
    const resultsContainer = document.getElementById("cmdPaletteResults");
    const input = document.getElementById("cmdPaletteInput");
    if (!resultsContainer) return;

    const query = input ? input.value.trim().toLowerCase() : "";

    const COMMAND_PALETTE_ITEMS = [
      // Category 1: Blocks & Motions
      { id: "act_bezierCurve", cat: "🧩 Blocks & Motion", title: "Add Bezier Spline Curve(x, y, θ)", desc: "Fluid high-speed sweeping arc with curvature control and tangent handles", keywords: "bezier spline curve arc path fluid smooth", action: () => addActionToFlow("bezierCurve") },
      { id: "act_moveToPose", cat: "🧩 Blocks & Motion", title: "Add moveToPose(x, y, θ)", desc: "Drive chassis to target field position and angle", keywords: "move pose drive motion", action: () => addActionToFlow("moveToPose") },
      { id: "act_moveToPoint", cat: "🧩 Blocks & Motion", title: "Add moveToPoint(x, y)", desc: "Drive chassis to target point without fixed ending angle", keywords: "move point drive motion", action: () => addActionToFlow("moveToPoint") },
      { id: "act_turnToHeading", cat: "🧩 Blocks & Motion", title: "Add turnToHeading(θ)", desc: "Rotate chassis in place to face target heading angle", keywords: "turn heading angle rotate", action: () => addActionToFlow("turnToHeading") },
      { id: "act_turnToPoint", cat: "🧩 Blocks & Motion", title: "Add turnToPoint(x, y)", desc: "Rotate chassis in place to face target field coordinate", keywords: "turn point face target", action: () => addActionToFlow("turnToPoint") },
      { id: "act_swingToHeading", cat: "🧩 Blocks & Motion", title: "Add swingToHeading(θ)", desc: "Single-sided wheel lock swing turn to heading angle", keywords: "swing turn heading lock wheel", action: () => addActionToFlow("swingToHeading") },
      { id: "act_swingToPoint", cat: "🧩 Blocks & Motion", title: "Add swingToPoint(x, y)", desc: "Single-sided wheel lock swing turn towards target point", keywords: "swing turn point lock wheel", action: () => addActionToFlow("swingToPoint") },
      { id: "act_wait", cat: "🧩 Blocks & Motion", title: "Add Wait / Delay Block", desc: "Pause auton timing or wait for sensor condition / event", keywords: "wait delay pause event timing", action: () => addActionToFlow("wait") },
      { id: "act_ifElse", cat: "🧩 Logic & Control", title: "Add If / Else Block (Scratch Logic)", desc: "Conditional branch block evaluating boolean variable", keywords: "if else condition logic branch scratch", action: () => addActionToFlow("ifElse") },
      { id: "act_loop", cat: "🧩 Logic & Control", title: "Add Loop Block (for/until/forever)", desc: "Repeat nested actions multiple times or until condition", keywords: "loop repeat for until forever repeat", action: () => addActionToFlow("loop") },
      { id: "act_custom", cat: "🧩 Code & Custom", title: "Add Custom C++ Block", desc: "Execute custom subsystem C++ code or inline function", keywords: "custom code cpp pros lemlib inline", action: () => addActionToFlow("custom") },
      { id: "snip_clamp", cat: "🟢 Subsystem Snippets", title: "Add 'clamp goal' Command", desc: "Insert clamp.set_value(true); custom snippet", keywords: "clamp goal mogo pneumatic", action: () => addSnippetToFlow("clamp.set_value(true);") },
      { id: "snip_intake", cat: "🟢 Subsystem Snippets", title: "Add 'intake on' Command", desc: "Insert intake.move(127); custom snippet", keywords: "intake move spin motor roller", action: () => addSnippetToFlow("intake.move(127);") },

      // Category 2: Navigation & Tabs
      { id: "nav_tab_flow", cat: "🗺️ Navigation & Tabs", title: "Switch to Auton Action Flow", desc: "Visual Scratch block editor and routine timeline", shortcut: "Alt+1", keywords: "flow flowchart blocks actions scratch tab", action: () => switchPlannerTab("flowchart") },
      { id: "nav_tab_cond", cat: "🗺️ Navigation & Tabs", title: "Switch to Conditions & Variables", desc: "Manage boolean flags and sensor condition states", shortcut: "Alt+2", keywords: "condition variable flag boolean logic tab", action: () => switchPlannerTab("conditions") },
      { id: "nav_tab_bot", cat: "🗺️ Navigation & Tabs", title: "Switch to Robot Specs & Drivetrain", desc: "Configure track width, wheel diameter, RPM & PID gains", shortcut: "Alt+3", keywords: "bot specs drivetrain pid track rpm tab", action: () => switchPlannerTab("bot") },
      { id: "nav_tab_code", cat: "🗺️ Navigation & Tabs", title: "Switch to LemLib C++ Code Export", desc: "View auto-generated C++ code for src/autons.cpp", shortcut: "Alt+4", keywords: "code cpp export generate source tab", action: () => switchPlannerTab("code") },
      { id: "nav_pros_ide", cat: "🗺️ Navigation & Tabs", title: "Open PROS C++ Web IDE", desc: "Full C++ code editor with syntax highlighting", keywords: "pros ide editor cpp code page", action: () => { window.location.href = "ide.html"; } },
      { id: "nav_brain_usb", cat: "🗺️ Navigation & Tabs", title: "Open VEX V5 Brain USB Telemetry", desc: "Live terminal and serial communication with V5 Brain", keywords: "brain usb serial telemetry connect", action: () => { const btn = document.getElementById("navModeBrain"); if (btn) btn.click(); } },

      // Category 3: Simulation
      { id: "sim_toggle", cat: "▶️ Simulation", title: "Run / Pause Simulation", desc: "Play or pause 2D field kinematics simulation", shortcut: "Ctrl+Space", keywords: "run pause play stop simulation sim", action: () => { if (simRunning) stopSim(); else startSim(); } },
      { id: "sim_reset", cat: "▶️ Simulation", title: "Reset Simulation Rewind", desc: "Stop simulation and return robot to start pose", keywords: "reset rewind stop start sim", action: () => stopSim() },
      { id: "sim_sp_1x", cat: "▶️ Simulation", title: "Set Speed 1.0x (Normal Time)", desc: "Real-time 1:1 playback speed", keywords: "speed 1x normal time", action: () => setSimSpeed(1.0) },
      { id: "sim_sp_2x", cat: "▶️ Simulation", title: "Set Speed 2.0x (Fast Forward)", desc: "Double speed playback for fast review", keywords: "speed 2x fast forward", action: () => setSimSpeed(2.0) },
      { id: "sim_sp_05x", cat: "▶️ Simulation", title: "Set Speed 0.5x (Slow Motion)", desc: "Half speed playback for precision debugging", keywords: "speed 0.5x slow motion", action: () => setSimSpeed(0.5) },

      // Category 4: Tools & Engineering Modals
      { id: "tool_mirror", cat: "⚙️ Tools & Utilities", title: "Open Alliance Routine Mirror", desc: "Transform routine across X-axis, Y-axis, or 180° rotation", shortcut: "Ctrl+Shift+M", keywords: "mirror alliance invert flip red blue rot180", action: () => openModalById("allianceMirrorModal") },
      { id: "tool_physics", cat: "⚙️ Tools & Utilities", title: "Open Real-Time Drive Physics Dyno", desc: "Inspect motor torque, traction limit, G-forces & 15s clock", shortcut: "Ctrl+Shift+P", keywords: "physics dyno traction gforce voltage battery clock", action: () => openModalById("drivePhysicsModal") },
      { id: "tool_flowchart", cat: "⚙️ Tools & Utilities", title: "Open Interactive Routine Flowchart", desc: "View full routine visual diagram", keywords: "flowchart diagram visual tree graph", action: () => openModalById("flowchartModal") },
      { id: "tool_cpp_import", cat: "⚙️ Tools & Utilities", title: "Open C++ Code Translator", desc: "Parse and convert raw C++ auton code into Scratch blocks", keywords: "translator import cpp convert parse blocks", action: () => openModalById("cppTranslateModal") },
      { id: "tool_pid_tuner", cat: "⚙️ Tools & Utilities", title: "Open PID Gain Visualizer", desc: "Interactive step response graph and PID tuner", keywords: "pid gain tuner lateral angular step graph", action: () => openModalById("pidModal") },
      { id: "tool_export_vid", cat: "⚙️ Tools & Utilities", title: "Export .mp4 Video Recording", desc: "Render HD video file of autonomous simulation", keywords: "export video mp4 recording render video", action: () => openModalById("videoExportModal") },
      { id: "tool_help", cat: "⚙️ Tools & Utilities", title: "Open Help & Documentation", desc: "Comprehensive guides, field specs, and shortcuts", keywords: "help docs guide reference documentation", action: () => openModalById("helpModal") },

      // Category 5: Routine File Operations
      { id: "file_new", cat: "📁 Routine Operations", title: "New Autonomous Routine", desc: "Create a blank routine in active project", keywords: "new routine path auton create", action: () => addPath() },
      { id: "file_duplicate", cat: "📁 Routine Operations", title: "Duplicate Selected Block / Routine", desc: "Duplicate active block (or entire routine if none selected)", shortcut: "Ctrl+D", keywords: "duplicate copy clone block routine", action: () => { if (selectedId) duplicateActionById(selectedId); else duplicateActivePath(); } },
      { id: "file_rename", cat: "📁 Routine Operations", title: "Rename Active Routine", desc: "Change active routine display name", keywords: "rename name title routine", action: () => renameActivePath() },
      { id: "file_delete_block", cat: "📁 Routine Operations", title: "Delete Selected Block", desc: "Remove currently selected block card", shortcut: "Delete", keywords: "delete remove trash block card", action: () => { if (selectedId) openDeleteBlockModal(selectedId); else showToast("Select a block first to delete"); } },
      { id: "file_undo", cat: "📁 Routine Operations", title: "Undo Last Edit", desc: "Revert last change to routine or bot settings", shortcut: "Ctrl+Z", keywords: "undo revert back history", action: () => undo() },
      { id: "file_redo", cat: "📁 Routine Operations", title: "Redo Edit", desc: "Reapply previously undone change", shortcut: "Ctrl+Shift+Z", keywords: "redo reapply forward history", action: () => redo() },
    ];

    cmdPaletteFilteredList = COMMAND_PALETTE_ITEMS.filter((item) => {
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        item.desc.toLowerCase().includes(query) ||
        item.keywords.toLowerCase().includes(query) ||
        item.cat.toLowerCase().includes(query) ||
        (item.shortcut && item.shortcut.toLowerCase().includes(query))
      );
    });

    if (cmdPaletteHighlightIdx < 0) cmdPaletteHighlightIdx = 0;
    if (cmdPaletteHighlightIdx >= cmdPaletteFilteredList.length) {
      cmdPaletteHighlightIdx = Math.max(0, cmdPaletteFilteredList.length - 1);
    }

    if (cmdPaletteFilteredList.length === 0) {
      resultsContainer.innerHTML = `<div style="padding:24px;text-align:center;color:#94a3b8;font-size:0.88rem;">No commands or actions found matching "<strong>${escapeHtml(query)}</strong>"</div>`;
      return;
    }

    // Group items by category
    const categories = [];
    cmdPaletteFilteredList.forEach((item) => {
      let cat = categories.find((c) => c.name === item.cat);
      if (!cat) {
        cat = { name: item.cat, items: [] };
        categories.push(cat);
      }
      cat.items.push(item);
    });

    let html = "";
    let overallIndex = 0;
    categories.forEach((cat) => {
      html += `<div class="cmd-category-title">${escapeHtml(cat.name)}</div>`;
      cat.items.forEach((item) => {
        const isHighlighted = overallIndex === cmdPaletteHighlightIdx;
        html += `
          <div class="cmd-item-card ${isHighlighted ? "highlighted" : ""}" data-item-idx="${overallIndex}">
            <div class="cmd-item-left">
              <span class="cmd-item-title">${escapeHtml(item.title)}</span>
              <span class="cmd-item-desc">${escapeHtml(item.desc)}</span>
            </div>
            ${item.shortcut ? `<span class="cmd-item-shortcut">${escapeHtml(item.shortcut)}</span>` : ""}
          </div>
        `;
        overallIndex++;
      });
    });

    resultsContainer.innerHTML = html;

    // Scroll highlighted item into view
    const highlightedEl = resultsContainer.querySelector(".cmd-item-card.highlighted");
    if (highlightedEl) {
      highlightedEl.scrollIntoView({ block: "nearest" });
    }
  }

  function wireCommandPaletteModal() {
    const btnHeader = document.getElementById("btnOpenCommandPalette");
    if (btnHeader) {
      btnHeader.addEventListener("click", () => {
        toggleCommandPaletteModal();
      });
    }

    const btnClose = document.getElementById("cmdPaletteClose");
    if (btnClose) {
      btnClose.addEventListener("click", () => {
        closeCommandPaletteModal();
      });
    }

    const modal = document.getElementById("commandPaletteModal");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeCommandPaletteModal();
      });
    }

    const input = document.getElementById("cmdPaletteInput");
    if (input) {
      input.addEventListener("input", () => {
        cmdPaletteHighlightIdx = 0;
        renderCommandPaletteList();
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (cmdPaletteFilteredList.length > 0) {
            cmdPaletteHighlightIdx = (cmdPaletteHighlightIdx + 1) % cmdPaletteFilteredList.length;
            renderCommandPaletteList();
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (cmdPaletteFilteredList.length > 0) {
            cmdPaletteHighlightIdx = (cmdPaletteHighlightIdx - 1 + cmdPaletteFilteredList.length) % cmdPaletteFilteredList.length;
            renderCommandPaletteList();
          }
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (cmdPaletteFilteredList[cmdPaletteHighlightIdx]) {
            const item = cmdPaletteFilteredList[cmdPaletteHighlightIdx];
            closeCommandPaletteModal();
            item.action();
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeCommandPaletteModal();
        }
      });
    }

    const resultsContainer = document.getElementById("cmdPaletteResults");
    if (resultsContainer) {
      resultsContainer.addEventListener("click", (e) => {
        const itemCard = e.target.closest(".cmd-item-card");
        if (!itemCard) return;
        const idx = Number(itemCard.dataset.itemIdx);
        if (cmdPaletteFilteredList[idx]) {
          closeCommandPaletteModal();
          cmdPaletteFilteredList[idx].action();
        }
      });
    }

    initGlobalShortcuts();
  }

  function initGlobalShortcuts() {
    window.addEventListener("keydown", (e) => {
      const activeEl = document.activeElement;
      const tag = activeEl ? activeEl.tagName.toLowerCase() : "";
      const isInput = tag === "input" || tag === "textarea" || tag === "select" || (activeEl && activeEl.isContentEditable);

      // Ctrl+K / Cmd+K: Open/Toggle Command Palette
      const isCmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        toggleCommandPaletteModal();
        return;
      }

      // If Command Palette modal is open, let palette keydown listener handle keys
      const cmdPaletteModal = document.getElementById("commandPaletteModal");
      if (cmdPaletteModal && !cmdPaletteModal.hidden) {
        if (e.key === "Escape") {
          closeCommandPaletteModal();
          e.preventDefault();
        }
        return;
      }

      // Ctrl+Space or Cmd+Space: Toggle simulation
      const isCmdSpace = (e.ctrlKey || e.metaKey) && (e.code === "Space" || e.key === " ");
      if (isCmdSpace) {
        e.preventDefault();
        if (simRunning) stopSim();
        else startSim();
        return;
      }

      // Ctrl+Shift+M or Cmd+Shift+M: Alliance Mirror Modal
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        openModalById("allianceMirrorModal");
        if (typeof updateAllianceMirrorPreview === "function") updateAllianceMirrorPreview();
        return;
      }

      // Ctrl+Shift+P or Cmd+Shift+P: Drive Physics Modal
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        openModalById("drivePhysicsModal");
        if (typeof updateDrivePhysicsDyno === "function") updateDrivePhysicsDyno();
        return;
      }

      // Ctrl+Enter or Cmd+Enter: Switch to Code Tab & Generate C++ Code
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        switchPlannerTab("code");
        showToast("💻 Generated LemLib C++ Code!");
        return;
      }

      // Alt+1, Alt+2, Alt+3, Alt+4: Switch Planner Tabs
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "1") { e.preventDefault(); switchPlannerTab("flowchart"); return; }
        if (e.key === "2") { e.preventDefault(); switchPlannerTab("conditions"); return; }
        if (e.key === "3") { e.preventDefault(); switchPlannerTab("bot"); return; }
        if (e.key === "4") { e.preventDefault(); switchPlannerTab("code"); return; }
      }

      // Do NOT execute single-key shortcuts when typing in input/textarea/select
      if (isInput) return;

      // Space key alone outside inputs: Toggle simulation
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (simRunning) stopSim();
        else startSim();
        return;
      }

      // Ctrl+D / Cmd+D: Duplicate selected block or routine
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selectedId) {
          duplicateActionById(selectedId);
        } else {
          duplicateActivePath();
        }
        return;
      }

      // Delete / Backspace outside inputs: Delete selected block
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          e.preventDefault();
          openDeleteBlockModal(selectedId);
        }
        return;
      }

      // Ctrl+Z / Cmd+Z (Undo) and Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y (Redo)
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((key === "z" && e.shiftKey) || key === "y") {
          e.preventDefault();
          redo();
        }
      }
    });
  }


  showBuildNumber();
  const btnUp = document.getElementById("btnCheckUpdate");
  if (btnUp) btnUp.onclick = () => checkForUpdates(true);
  // Soft check a few seconds after load (no prompt unless newer)
  setTimeout(() => checkForUpdates(false), 2500);
  wireClearModal();
  wireDeleteBlockModal();
  wireHelpModal();
  wireFlowchartModal();
  wireCppTranslateModal();
  wirePidModal();
  wireVideoExportModal();
  wireAllianceMirrorModal();
  wireDrivePhysicsModal();
  wireCollisionModal();
  wireBreadcrumbs();
  wireCommandPaletteModal();
  loadLocal();
  syncPathSelect();
  syncStartInputs();
  syncBotInputs();
  renderFlow();
  draw();
  generateCode();
  try { updateTimeDisplay(); } catch (_) {}

  // initial history checkpoint
  undoStack = [];
  redoStack = [];
  pushHistory("init");

  const pathSel = document.getElementById("pathSelect");
  if (pathSel) pathSel.onchange = () => switchPath(pathSel.value);
  const bAdd = document.getElementById("btnPathAdd");
  if (bAdd) bAdd.onclick = () => {
    const n = prompt("New routine name:", `Routine ${paths.length + 1}`);
    if (n === null) return;
    addPath(n.trim() || `Routine ${paths.length + 1}`);
  };
  const bRen = document.getElementById("btnPathRename");
  if (bRen) {
    bRen.onclick = () => {
      const menu = document.getElementById("routineActionsMenu");
      if (menu) menu.hidden = true;
      renameActivePath();
    };
  }
  const bDup = document.getElementById("btnPathDup");
  if (bDup) {
    bDup.onclick = () => {
      const menu = document.getElementById("routineActionsMenu");
      if (menu) menu.hidden = true;
      duplicateActivePath();
    };
  }
  const bDel = document.getElementById("btnPathDel");
  if (bDel) {
    bDel.onclick = () => {
      const menu = document.getElementById("routineActionsMenu");
      if (menu) menu.hidden = true;
      deleteActivePath();
    };
  }

  // Routine Actions Dropdown toggle
  const btnRoutineMenu = document.getElementById("btnRoutineMenuDropdown");
  const routineActionsMenu = document.getElementById("routineActionsMenu");
  if (btnRoutineMenu && routineActionsMenu) {
    btnRoutineMenu.onclick = (e) => {
      e.stopPropagation();
      routineActionsMenu.hidden = !routineActionsMenu.hidden;
    };
    document.addEventListener("click", (e) => {
      if (!routineActionsMenu.contains(e.target) && e.target !== btnRoutineMenu) {
        routineActionsMenu.hidden = true;
      }
    });
  }
  document.querySelectorAll('input[name="codeMode"]').forEach((el) => {
    el.addEventListener("change", () => generateCode());
  });



  const codeCommentStyleSelect = document.getElementById("codeCommentStyleSelect");
  if (codeCommentStyleSelect) {
    codeCommentStyleSelect.value = getCommentStyle();
    codeCommentStyleSelect.onchange = () => {
      localStorage.setItem("lemlib_code_comment_style", codeCommentStyleSelect.value);
      generateCode();
      showToast(`💬 Code comment style set to: ${codeCommentStyleSelect.options[codeCommentStyleSelect.selectedIndex].text}`);
    };
  }

  const btnNewTab = document.getElementById("btnNewTab");
  if (btnNewTab && window.self !== window.top) {
    btnNewTab.href = window.location.href;
    btnNewTab.style.display = "inline-flex";
  }

  // =========================================================================
  // PROS Project Workspace & Live Debugger Integration
  // =========================================================================
  let _autoMergeSessionChoice = null;

  function updateProjectBanner() {
    if (!window.ProjectManager) return;
    const proj = window.ProjectManager.project;
    const bannerName = document.getElementById("bannerProjectName");
    const bannerVarCount = document.getElementById("bannerVariableCount");
    const headerBadge = document.getElementById("headerProjectBadge");
    const rawBadge = document.getElementById("bannerRawBadge");

    if (bannerName && proj) {
      bannerName.textContent = proj.name || "Override_LemLib_Bot";
    }
    if (headerBadge && proj) {
      headerBadge.textContent = `📁 ${proj.name || "Override_LemLib_Bot"}`;
    }
    if (bannerVarCount && window.ProjectManager.symbols) {
      const syms = window.ProjectManager.symbols;
      const totalCount = (syms.motors?.length || 0) + (syms.pistons?.length || 0) + (syms.sensors?.length || 0) + (syms.functions?.length || 0);
      bannerVarCount.textContent = `${totalCount} device${totalCount === 1 ? '' : 's'} indexed`;
    }
    if (rawBadge && proj) {
      const isIdePreserved = proj.lastAutonEditor === "ide" || proj.rawCppPreserved;
      rawBadge.style.display = isIdePreserved ? "inline-flex" : "none";
      rawBadge.onclick = () => {
        if (typeof window.openVersionHistoryModal === "function") {
          window.openVersionHistoryModal("src/autons.cpp");
        }
      };
    }
    if (typeof window.ProjectManager.updateVersionCountBadges === "function") {
      window.ProjectManager.updateVersionCountBadges();
    }
    updateHomepageStats();
  }

  function promptMergeAutonCpp(options = {}) {
    return new Promise((resolve) => {
      if (!window.ProjectManager) {
        resolve(false);
        return;
      }

      const indent = getIndentString();
      const hasDiff = window.ProjectManager.hasCodeDifference(paths, indent);
      if (!hasDiff) {
        // No difference, proceed silently
        window.ProjectManager.updateAutonCppFromPlanner(paths, indent);
        updateProjectBanner();
        resolve(true);
        return;
      }

      // If user chose to remember session choice
      if (_autoMergeSessionChoice) {
        window.ProjectManager.createVersionSnapshot("src/autons.cpp", "blocks_merge", `Preserved Raw C++ before Auto-${_autoMergeSessionChoice}`);
        window.ProjectManager.mergePlannerIntoAutonCpp(paths, _autoMergeSessionChoice, indent, { force: true });
        updateProjectBanner();
        resolve(true);
        return;
      }

      // Show confirmation dialog before merging code
      const modal = document.getElementById("mergeDiffModal");
      const btnClose = document.getElementById("btnMergeModalClose");
      const btnKeep = document.getElementById("btnMergeKeep");
      const btnAppend = document.getElementById("btnMergeAppend");
      const btnOverwrite = document.getElementById("btnMergeOverwrite");
      const btnViewHist = document.getElementById("btnMergeViewHistory");
      const newPreview = document.getElementById("mergeNewCodePreview");
      const existingPreview = document.getElementById("mergeExistingCodePreview");
      const newBadge = document.getElementById("mergeNewRoutinesBadge");
      const chkRemember = document.getElementById("chkMergeRememberSession");

      if (!modal) {
        window.ProjectManager.updateAutonCppFromPlanner(paths, indent);
        updateProjectBanner();
        resolve(true);
        return;
      }

      // Populate preview contents
      const generatedCode = window.ProjectManager.generateAutonCppCode(paths, indent);
      const existingCode = window.ProjectManager.getFile("src/autons.cpp") || "// Empty src/autons.cpp";

      if (newPreview) newPreview.textContent = generatedCode;
      if (existingPreview) existingPreview.textContent = existingCode;
      if (newBadge) newBadge.textContent = `${paths.length} Routine${paths.length === 1 ? '' : 's'}`;

      modal.hidden = false;
      modal.classList.add("open");

      function cleanup() {
        modal.hidden = true;
        modal.classList.remove("open");
        if (btnClose) btnClose.onclick = null;
        if (btnKeep) btnKeep.onclick = null;
        if (btnAppend) btnAppend.onclick = null;
        if (btnOverwrite) btnOverwrite.onclick = null;
        if (btnViewHist) btnViewHist.onclick = null;
      }

      if (btnViewHist) {
        btnViewHist.onclick = () => {
          if (typeof window.openVersionHistoryModal === "function") {
            window.openVersionHistoryModal("src/autons.cpp");
          }
        };
      }

      if (btnClose) {
        btnClose.onclick = () => {
          cleanup();
          resolve(false);
        };
      }

      if (btnKeep) {
        btnKeep.onclick = () => {
          cleanup();
          loadProjectAutonsIntoPlanner(true, true);
          showToast("🛡️ Loaded raw C++ code into visual planner canvas");
          resolve(false);
        };
      }

      if (btnAppend) {
        btnAppend.onclick = () => {
          if (chkRemember && chkRemember.checked) _autoMergeSessionChoice = "append";
          window.ProjectManager.createVersionSnapshot("src/autons.cpp", "blocks_append", "Preserved Raw C++ before Blocks Append");
          window.ProjectManager.mergePlannerIntoAutonCpp(paths, "append", indent, { force: true });
          updateProjectBanner();
          cleanup();
          showToast("➕ Appended visual routine into src/autons.cpp (Previous raw C++ backed up)");
          resolve(true);
        };
      }

      if (btnOverwrite) {
        btnOverwrite.onclick = () => {
          if (chkRemember && chkRemember.checked) _autoMergeSessionChoice = "replace";
          window.ProjectManager.createVersionSnapshot("src/autons.cpp", "blocks_merge", "Preserved Raw C++ before Blocks Overwrite");
          window.ProjectManager.mergePlannerIntoAutonCpp(paths, "replace", indent, { force: true });
          updateProjectBanner();
          cleanup();
          showToast("✅ Merged into src/autons.cpp (Previous raw C++ backed up in Versions)");
          resolve(true);
        };
      }
    });
  }

  let isSyncingFromPlanner = false;
  window.isSyncingFromPlanner = false;

  function syncPlannerIntoProjectManager(options = { ask: false, force: false }) {
    if (!window.ProjectManager || !window.ProjectManager.project) return;
    try {
      isSyncingFromPlanner = true;
      window.isSyncingFromPlanner = true;

      if (options.ask) {
        promptMergeAutonCpp();
      } else {
        const proj = window.ProjectManager.project;
        const isIdeActive = proj.lastAutonEditor === "ide" || proj.rawCppPreserved;
        
        if (isIdeActive && !options.force) {
          console.log("🛡️ Preserving raw C++ code; skipping passive sync from Visual Planner.");
          return;
        }

        const indent = typeof getIndentString === "function" ? getIndentString() : "    ";
        window.ProjectManager.updateAutonCppFromPlanner(paths, indent, { mode: "replace", force: options.force || false });
        window.ProjectManager.project.lastAutonEditor = "blocks";
        window.ProjectManager.project.rawCppPreserved = false;
        window.ProjectManager.saveLocal(true);
        updateProjectBanner();
      }

      if (typeof window.refreshIdeEditorIfActive === "function") {
        window.refreshIdeEditorIfActive("src/autons.cpp");
      }
    } catch (e) {
      console.warn("Failed to sync planner into ProjectManager:", e);
    } finally {
      setTimeout(() => {
        isSyncingFromPlanner = false;
        window.isSyncingFromPlanner = false;
      }, 400);
    }
  }

  function loadProjectAutonsIntoPlanner(showNotification = false, force = false) {
    if (!window.ProjectManager || isSyncingFromPlanner) return;

    // Make sure current raw C++ is protected by an auto-snapshot
    const autonsCode = window.ProjectManager.getFile("src/autons.cpp");
    if (autonsCode && autonsCode.trim().length > 0) {
      window.ProjectManager.createVersionSnapshot("src/autons.cpp", "ide", "Raw C++ Code from IDE");
    }

    const indent = typeof getIndentString === "function" ? getIndentString() : "    ";
    if (!force && !window.ProjectManager.hasCodeDifference(paths, indent)) {
      return;
    }

    const autonRoutines = window.ProjectManager.getAutonRoutines();
    if (!autonRoutines || autonRoutines.length === 0) return;

    // Convert parsed routines into planner paths
    const newPaths = [];
    autonRoutines.forEach((r, idx) => {
      let parsed = null;
      if (window.CppTranslator && typeof window.CppTranslator.parseCppAuton === "function") {
        try {
          const fullCode = `void ${r.name}() {\n${r.body}\n}`;
          parsed = window.CppTranslator.parseCppAuton(fullCode, { defaultTimeout: 2000 });
        } catch (e) {
          console.warn("Failed parsing routine in CppTranslator:", e);
        }
      }

      const pName = r.name.replace(/^auton_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || `Routine ${idx + 1}`;
      const startPose = parsed?.startPose || parsed?.pose || { x: -60, y: -60, theta: 0 };
      const actions = (parsed && Array.isArray(parsed.actions)) ? parsed.actions : [];

      newPaths.push({
        id: "path_" + Date.now() + "_" + idx,
        name: pName,
        pose: { ...startPose },
        actions: actions
      });
    });

    if (newPaths.length > 0) {
      paths = newPaths;
      const existingIdx = paths.findIndex(p => p.id === activePathId);
      activePathId = existingIdx >= 0 ? paths[existingIdx].id : paths[0].id;

      bindActive();
      syncPathSelect();
      syncStartInputs();
      renderFlow();
      draw();
      generateCode();

      // Persist to planner storage key so it never falls back to old stale routines!
      const data = {
        version: 2,
        paths,
        activePathId,
        bot,
        savedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (_) {}

      if (showNotification) {
        showToast(`📁 Synchronized ${newPaths.length} autonomous routine${newPaths.length === 1 ? '' : 's'} from src/autons.cpp`);
      }
    }
  }

  // =========================================================================
  // HOMEPAGE HUB & CLEAN NAVIGATION SYSTEM
  // =========================================================================
  function updateHomepageStats() {
    const elProj = document.getElementById("homeStatProjects");
    const elAutons = document.getElementById("homeStatAutons");
    const elDevices = document.getElementById("homeStatDevices");

    if (elProj && window.ProjectManager?.project) {
      elProj.textContent = "1";
    }
    if (elAutons) {
      elAutons.textContent = String(paths.length || 1);
    }
    if (elDevices && window.ProjectManager?.symbols) {
      const syms = window.ProjectManager.symbols;
      const totalCount = (syms.motors?.length || 0) + (syms.pistons?.length || 0) + (syms.sensors?.length || 0) + (syms.functions?.length || 0);
      elDevices.textContent = String(totalCount || 12);
    }
  }

  function resizeCanvas() {
    if (!canvas) return;
    const wrap = canvas.parentElement || document.getElementById("canvasWrap");
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const hud = document.getElementById("simFloatingHud");
    const isDocked = hud && hud.classList.contains("is-docked");
    const isMinimized = hud && hud.classList.contains("is-minimized");
    const hudHeight = (hud && isDocked && !isMinimized) ? hud.offsetHeight : 0;
    const availW = Math.max(280, rect.width - 16);
    const availH = Math.max(280, window.innerHeight - 160 - hudHeight);
    const size = Math.min(availW, availH);
    if (size > 0) {
      canvas.style.width = size + "px";
      canvas.style.height = size + "px";
    }
    draw();
  }

  function setupSimHudControls() {
    const hud = document.getElementById("simFloatingHud");
    if (!hud) return;

    const btnDock = document.getElementById("btnHudDock");
    const btnMin = document.getElementById("btnHudMinimize");
    const handle = document.getElementById("hudDragHandle");

    // Load saved preferences
    const isDocked = localStorage.getItem("sim_hud_docked") === "true";
    const isMinimized = localStorage.getItem("sim_hud_minimized") === "true";

    if (isDocked) {
      hud.classList.add("is-docked");
      if (btnDock) btnDock.innerHTML = "🔓 Float on Field";
    }
    if (isMinimized) {
      hud.classList.add("is-minimized");
      if (btnMin) btnMin.textContent = "+";
    }

    if (btnDock) {
      btnDock.onclick = (e) => {
        e.stopPropagation();
        const docked = hud.classList.toggle("is-docked");
        btnDock.innerHTML = docked ? "🔓 Float on Field" : "📌 Dock Above";
        localStorage.setItem("sim_hud_docked", docked ? "true" : "false");
        if (docked) {
          hud.style.top = "";
          hud.style.left = "";
        }
        resizeCanvas();
      };
    }

    if (btnMin) {
      btnMin.onclick = (e) => {
        e.stopPropagation();
        const minned = hud.classList.toggle("is-minimized");
        btnMin.textContent = minned ? "+" : "―";
        localStorage.setItem("sim_hud_minimized", minned ? "true" : "false");
        resizeCanvas();
      };
    }

    // Draggable HUD handle
    if (handle) {
      let isDragging = false;
      let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

      const onMouseDown = (e) => {
        if (hud.classList.contains("is-docked")) return;
        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startX = clientX;
        startY = clientY;

        const rect = hud.getBoundingClientRect();
        const parentRect = hud.parentElement ? hud.parentElement.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        initialLeft = rect.left - parentRect.left;
        initialTop = rect.top - parentRect.top;

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        document.addEventListener("touchmove", onMouseMove, { passive: false });
        document.addEventListener("touchend", onMouseUp);
      };

      const onMouseMove = (e) => {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = clientX - startX;
        const dy = clientY - startY;

        const parentRect = hud.parentElement ? hud.parentElement.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        const hudRect = hud.getBoundingClientRect();

        let newLeft = Math.max(4, Math.min(parentRect.width - hudRect.width - 4, initialLeft + dx));
        let newTop = Math.max(4, Math.min(parentRect.height - hudRect.height - 4, initialTop + dy));

        hud.style.left = newLeft + "px";
        hud.style.top = newTop + "px";
        hud.style.right = "auto";
      };

      const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.removeEventListener("touchmove", onMouseMove);
        document.removeEventListener("touchend", onMouseUp);
      };

      handle.addEventListener("mousedown", onMouseDown);
      handle.addEventListener("touchstart", onMouseDown, { passive: true });
    }
  }

  window.addEventListener("resize", resizeCanvas);

  function showPlannerView() {
    const homeView = document.getElementById("homepageView");
    const appView = document.getElementById("app");
    if (homeView) homeView.style.display = "none";
    if (appView) {
      appView.style.display = "flex";
      appView.style.flexDirection = "column";
      // Trigger canvas resize and redraw
      setTimeout(() => {
        if (typeof resizeCanvas === "function") resizeCanvas();
        draw();
      }, 50);
    }
  }

  function showHomepageView() {
    const homeView = document.getElementById("homepageView");
    const appView = document.getElementById("app");
    if (appView) appView.style.display = "none";
    if (homeView) homeView.style.display = "flex";
    updateHomepageStats();
  }

  function wireHomepageHub() {
    const btnLaunchDirect = document.getElementById("btnLaunchPlannerDirect");
    const btnHeroPlanner = document.getElementById("btnHeroOpenPlanner");
    const btnCardPlanner = document.getElementById("btnCardLaunchPlanner");
    const btnReturnHome = document.getElementById("btnReturnHomeHub");

    const btnHeroBrain = document.getElementById("btnHeroConnectBrain");
    const btnCardBrain = document.getElementById("btnCardOpenBrain");
    const btnCardPid = document.getElementById("btnCardOpenPid");
    const btnCardVideo = document.getElementById("btnCardExportVideo");

    // Launch buttons
    if (btnLaunchDirect) btnLaunchDirect.onclick = showPlannerView;
    if (btnHeroPlanner) btnHeroPlanner.onclick = showPlannerView;
    if (btnCardPlanner) btnCardPlanner.onclick = showPlannerView;
    if (btnReturnHome) btnReturnHome.onclick = showHomepageView;

    // Modal launchers from Home
    if (btnHeroBrain) {
      btnHeroBrain.onclick = () => {
        const modal = document.getElementById("brainModal");
        if (modal) {
          modal.hidden = false;
          modal.classList.add("open");
        }
      };
    }
    if (btnCardBrain) {
      btnCardBrain.onclick = () => {
        const modal = document.getElementById("brainModal");
        if (modal) {
          modal.hidden = false;
          modal.classList.add("open");
        }
      };
    }
    if (btnCardPid) {
      btnCardPid.onclick = () => {
        showPlannerView();
        const modal = document.getElementById("pidModal");
        if (modal) {
          modal.hidden = false;
          modal.classList.add("open");
        }
      };
    }
    if (btnCardVideo) {
      btnCardVideo.onclick = () => {
        showPlannerView();
        const modal = document.getElementById("videoExportModal");
        if (modal) {
          modal.hidden = false;
          modal.classList.add("open");
        }
      };
    }

    // Quick Competition Templates
    const btnTplOverride = document.getElementById("btnTplOverride");
    const btnTplSkills = document.getElementById("btnTplSkills");
    const btnTplSoloAwp = document.getElementById("btnTplSoloAwp");

    if (btnTplOverride) {
      btnTplOverride.onclick = () => {
        paths = [
          {
            id: "path_override_match",
            name: "Override Match Routine",
            pose: { x: -60, y: -60, theta: 0 },
            actions: [
              { id: "act_1", type: "moveToPoint", x: -24, y: -24, timeout: 2000, maxSpeed: 127, minSpeed: 0, earlyExitRange: 0, forwards: true, label: "Rush Center Goal", async: false },
              { id: "act_2", type: "clampPiston", state: "true", label: "Clamp Mobile Goal", delay: 100 },
              { id: "act_3", type: "intakeMotor", speed: 127, label: "Intake 3 Rings", delay: 300 },
              { id: "act_4", type: "moveToPose", x: -50, y: -50, theta: 225, timeout: 2500, maxSpeed: 100, minSpeed: 0, earlyExitRange: 0, forwards: false, label: "Score in Corner", async: false }
            ]
          }
        ];
        activePathId = paths[0].id;
        bindActive();
        syncPathSelect();
        syncStartInputs();
        renderFlow();
        generateCode();
        showPlannerView();
        promptMergeAutonCpp();
        showToast("⚡ Loaded Override Match routine into planner!");
      };
    }

    if (btnTplSkills) {
      btnTplSkills.onclick = () => {
        paths = [
          {
            id: "path_skills_60s",
            name: "60s Full Field Skills",
            pose: { x: -60, y: 0, theta: 90 },
            actions: [
              { id: "act_sk1", type: "moveToPoint", x: -24, y: 0, timeout: 1800, maxSpeed: 127, minSpeed: 0, earlyExitRange: 0, forwards: true, label: "Clear Alliance Goal", async: false },
              { id: "act_sk2", type: "clampPiston", state: "true", label: "Clamp Goal", delay: 100 },
              { id: "act_sk3", type: "moveToPose", x: 0, y: 48, theta: 45, timeout: 3000, maxSpeed: 110, minSpeed: 0, earlyExitRange: 0, forwards: true, label: "Quadrant 1 Clearing", async: false },
              { id: "act_sk4", type: "moveToPose", x: 48, y: 0, theta: 135, timeout: 3000, maxSpeed: 110, minSpeed: 0, earlyExitRange: 0, forwards: true, label: "Quadrant 2 Rings", async: false },
              { id: "act_sk5", type: "moveToPose", x: 0, y: -48, theta: 225, timeout: 3000, maxSpeed: 110, minSpeed: 0, earlyExitRange: 0, forwards: true, label: "Quadrant 3 Scoring", async: false },
              { id: "act_sk6", type: "moveToPose", x: -48, y: -48, theta: 315, timeout: 2500, maxSpeed: 100, minSpeed: 0, earlyExitRange: 0, forwards: true, label: "Corner Parking", async: false }
            ]
          }
        ];
        activePathId = paths[0].id;
        bindActive();
        syncPathSelect();
        syncStartInputs();
        renderFlow();
        generateCode();
        showPlannerView();
        promptMergeAutonCpp();
        showToast("⚡ Loaded 60-Second Full Field Skills routine into planner!");
      };
    }

    if (btnTplSoloAwp) {
      btnTplSoloAwp.onclick = () => {
        paths = [
          {
            id: "path_solo_awp",
            name: "Solo Autonomous Win Point",
            pose: { x: -60, y: 24, theta: 90 },
            actions: [
              { id: "act_awp1", type: "moveToPoint", x: -36, y: 24, timeout: 1500, maxSpeed: 127, minSpeed: 0, earlyExitRange: 0, forwards: true, label: "Cross Line", async: false },
              { id: "act_awp2", type: "intakeMotor", speed: 127, label: "Score Preload", delay: 400 },
              { id: "act_awp3", type: "turnToHeading", theta: 180, timeout: 1200, maxSpeed: 110, minSpeed: 0, earlyExitRange: 0, label: "Turn To Ladder", async: false },
              { id: "act_awp4", type: "moveToPose", x: 0, y: 0, theta: 180, timeout: 2200, maxSpeed: 100, minSpeed: 0, earlyExitRange: 0, forwards: true, label: "Touch Ladder", async: false }
            ]
          }
        ];
        activePathId = paths[0].id;
        bindActive();
        syncPathSelect();
        syncStartInputs();
        renderFlow();
        generateCode();
        showPlannerView();
        promptMergeAutonCpp();
        showToast("⚡ Loaded Solo Autonomous Win Point routine into planner!");
      };
    }

    // Tools Dropdown wiring
    const btnToolsDropdown = document.getElementById("btnToolsDropdown");
    const toolsDropdownMenu = document.getElementById("toolsDropdownMenu");
    if (btnToolsDropdown && toolsDropdownMenu) {
      btnToolsDropdown.onclick = (e) => {
        e.stopPropagation();
        toolsDropdownMenu.hidden = !toolsDropdownMenu.hidden;
      };

      document.addEventListener("click", (e) => {
        if (!toolsDropdownMenu.contains(e.target) && e.target !== btnToolsDropdown) {
          toolsDropdownMenu.hidden = true;
        }
      });
    }

    // Interactive Tutorial Button Triggers
    const btnOpenTutorial = document.getElementById("btnOpenTutorial");
    if (btnOpenTutorial) {
      btnOpenTutorial.onclick = () => {
        if (typeof window.openTutorial === "function") {
          window.openTutorial(0);
        }
      };
    }
    const btnToolsTutorial = document.getElementById("btnToolsTutorial");
    if (btnToolsTutorial) {
      btnToolsTutorial.onclick = () => {
        if (toolsDropdownMenu) toolsDropdownMenu.hidden = true;
        if (typeof window.openTutorial === "function") {
          window.openTutorial(0);
        }
      };
    }

    updateHomepageStats();
  }

  function wireProjectWorkspace() {
    updateProjectBanner();

    // Banner Project Actions Dropdown
    const btnProjectActionsDropdown = document.getElementById("btnProjectActionsDropdown");
    const projectActionsMenu = document.getElementById("projectActionsMenu");
    if (btnProjectActionsDropdown && projectActionsMenu) {
      btnProjectActionsDropdown.onclick = (e) => {
        e.stopPropagation();
        projectActionsMenu.hidden = !projectActionsMenu.hidden;
      };
      document.addEventListener("click", (e) => {
        if (!projectActionsMenu.contains(e.target) && e.target !== btnProjectActionsDropdown) {
          projectActionsMenu.hidden = true;
        }
      });
    }

    // Banner Versions button
    const btnVersionsBanner = document.getElementById("btnVersionHistoryBanner");
    if (btnVersionsBanner) {
      btnVersionsBanner.onclick = () => {
        if (projectActionsMenu) projectActionsMenu.hidden = true;
        if (typeof window.openVersionHistoryModal === "function") {
          window.openVersionHistoryModal("src/autons.cpp");
        }
      };
    }

    // Banner Cloud Sync button
    const btnSyncCloud = document.getElementById("btnSyncProjectToCloud");
    if (btnSyncCloud) {
      btnSyncCloud.onclick = async () => {
        if (projectActionsMenu) projectActionsMenu.hidden = true;
        try {
          btnSyncCloud.disabled = true;
          btnSyncCloud.textContent = "⏳ Syncing...";
          if (window.ProjectManager.project?.lastAutonEditor !== "ide" && !window.ProjectManager.project?.rawCppPreserved) {
            syncPlannerIntoProjectManager();
          }
          let finalStr = "";
          await window.ProjectManager.saveToCloud((curr, total, progStr) => {
            btnSyncCloud.textContent = `⏳ ${progStr}`;
            finalStr = progStr;
          }, false);
          await cloudSave(true);
          setCloudStatus("Synced", "ok");
          showToast(`☁️ Multi-file project synchronized to cloud (${finalStr || "100%"})!`);
        } catch (err) {
          showToast(`⚠️ Cloud sync failed: ${err.message}`);
        } finally {
          btnSyncCloud.disabled = false;
          btnSyncCloud.textContent = "☁️ Sync Cloud";
        }
      };
    }

    // Banner Compile Project button
    const btnCompileBanner = document.getElementById("btnCompileProjectBanner");
    if (btnCompileBanner) {
      btnCompileBanner.onclick = () => {
        if (window.ProjectManager.project?.lastAutonEditor !== "ide" && !window.ProjectManager.project?.rawCppPreserved) {
          syncPlannerIntoProjectManager();
        }
        const res = window.ProjectManager.compileProject();
        if (res.success) {
          showToast(`⚡ Project compiled clean in ${res.elapsed}s (pros make)`);
        } else {
          showToast(`❌ Compile failed: ${res.errors.length} error(s). See Debugger.`, 4000);
        }
        // Open debug panel on diagnostics
        const debugPanel = document.getElementById("debugSidePanel");
        if (debugPanel) {
          debugPanel.hidden = false;
          const diagTab = document.querySelector('.debug-tab[data-tab="diagnostics"]');
          if (diagTab) diagTab.click();
        }
      };
    }
  }

  // -- Load Project Modal Wiring ---------------------------------------
  function wireLoadProjectModal() {
    const modal = document.getElementById("loadProjectModal");
    const btnOpen = document.getElementById("btnLoadProject");
    const btnClose = document.getElementById("loadProjectModalClose");
    const btnDone = document.getElementById("btnLoadProjectDone");

    const btnLoadDefault = document.getElementById("btnLoadDefaultTemplate");
    const btnFetchCloud = document.getElementById("btnFetchCloudProject");
    const btnBrowse = document.getElementById("btnBrowseProjectFile");
    const fileInput = document.getElementById("projectFileInput");
    const btnExport = document.getElementById("btnExportProjectBundle");

    if (!modal) return;

    function openModal() {
      modal.hidden = false;
      modal.classList.add("open");
    }
    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("open");
    }

    if (btnOpen) btnOpen.onclick = openModal;
    if (btnClose) btnClose.onclick = closeModal;
    if (btnDone) btnDone.onclick = closeModal;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    if (btnLoadDefault) {
      btnLoadDefault.onclick = () => {
        if (!window.ProjectManager) return;
        window.promptWipeChallenge("Standard Competition Template", () => {
          window.ProjectManager.wipeProject();
          window.ProjectManager.initDefaultProject("Override_LemLib_Bot");
          loadProjectAutonsIntoPlanner(false, true);
          updateProjectBanner();
          closeModal();
          showToast("🚀 Current workspace wiped clean! Standard template loaded.");
        });
      };
    }

    if (btnFetchCloud) {
      btnFetchCloud.onclick = () => {
        if (!window.ProjectManager) return;
        window.promptWipeChallenge("Cloud Account Project", async () => {
          try {
            btnFetchCloud.disabled = true;
            btnFetchCloud.textContent = "Fetching...";
            const proj = await window.ProjectManager.loadFromCloud(true);
            if (proj) {
              loadProjectAutonsIntoPlanner(false, true);
              updateProjectBanner();
              closeModal();
              showToast("☁️ Previous workspace wiped! Synced cloud project loaded.");
            } else {
              showToast("No project found in cloud. Sync your current project first!");
            }
          } catch (e) {
            showToast(`⚠️ Cloud fetch failed: ${e.message}`);
          } finally {
            btnFetchCloud.disabled = false;
            btnFetchCloud.textContent = "Fetch Cloud Project";
          }
        });
      };
    }

    if (btnBrowse && fileInput) {
      btnBrowse.onclick = () => fileInput.click();
      fileInput.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const data = JSON.parse(evt.target.result);
            if (data.files) {
              const targetName = file.name || (data.name ? `${data.name}.json` : "Imported Project");
              window.promptWipeChallenge(targetName, async () => {
                const totalBytes = Object.values(data.files).reduce((sum, content) => sum + (typeof content === "string" ? content.length : 0), 0);
                const fileCount = Object.keys(data.files).length;
                if (window.ImportProgressModal) {
                  window.ImportProgressModal.show({
                    title: "Importing Project Workspace",
                    subtitle: `Importing "${targetName}" (${fileCount} files)`,
                    totalBytes: totalBytes,
                    totalFiles: fileCount
                  });
                  window.ImportProgressModal.update({
                    phase: 2,
                    pct: 35,
                    currentBytes: Math.round(totalBytes * 0.35),
                    totalBytes: totalBytes,
                    message: "Parsing symbols & LemLib configurations..."
                  });
                }
                window.ProjectManager.wipeProject();
                data.updatedAt = Date.now();
                data.isDefault = false;
                data.cloudSynced = false;
                window.ProjectManager.project = data;
                if (window.ImportProgressModal) {
                  window.ImportProgressModal.update({
                    phase: 3,
                    pct: 60,
                    currentBytes: Math.round(totalBytes * 0.60),
                    totalBytes: totalBytes,
                    message: "Writing workspace to IndexedDB..."
                  });
                }
                await window.ProjectManager.saveLocal();
                if (window.ImportProgressModal) {
                  window.ImportProgressModal.update({
                    phase: 4,
                    pct: 85,
                    currentBytes: totalBytes,
                    totalBytes: totalBytes,
                    message: "Synchronizing autonomous routines into map..."
                  });
                }
                loadProjectAutonsIntoPlanner(false, true);
                updateProjectBanner();
                closeModal();

                // Immediately sync imported workspace to Firebase Firestore
                const currentUser = (typeof firebase !== "undefined" && firebase.auth) ? firebase.auth().currentUser : null;
                if (currentUser) {
                  try {
                    if (window.ImportProgressModal) {
                      window.ImportProgressModal.update({
                        phase: 4,
                        pct: 95,
                        currentBytes: totalBytes,
                        totalBytes: totalBytes,
                        message: "Synchronizing project workspace to cloud server..."
                      });
                    }
                    await window.ProjectManager.saveToCloud(null, false);
                    await cloudSave(true);
                    setCloudStatus("Synced", "ok");
                  } catch (cloudErr) {
                    console.error("Cloud sync on import failed:", cloudErr);
                    showToast(`⚠️ Saved locally, but cloud sync warning: ${cloudErr.message}`, 4000);
                  }
                }

                if (window.ImportProgressModal) {
                  window.ImportProgressModal.finish({
                    bytesSynced: totalBytes,
                    totalBytes: totalBytes,
                    message: `✓ Successfully synced ${fileCount} files (${window.ProjectManager.formatBytes ? window.ProjectManager.formatBytes(totalBytes) : totalBytes + ' B'})`
                  });
                }
                showToast(`💥 Current workspace wiped! Imported "${targetName}" and synced to server!`);
              });
            } else {
              showToast("Invalid project file: missing files map.");
            }
          } catch (err) {
            showToast("Failed to parse project JSON file.");
          }
        };
        reader.readAsText(file);
      };
    }

    if (btnExport) {
      btnExport.onclick = () => {
        if (!window.ProjectManager || !window.ProjectManager.project) return;
        syncPlannerIntoProjectManager();
        const json = JSON.stringify(window.ProjectManager.project, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${window.ProjectManager.project.name || "Override_LemLib_Project"}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("💾 Exported full multi-file project bundle!");
      };
    }
  }

  // -- Live Debugger & Inspector Side Panel -----------------------------
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
        if (targetId === "tuning") drawPidTuningGraph(0);
      };
    });

    // PID Tuning graph toggles
    const btnTuningLinear = document.getElementById("btnTuningLinear");
    const btnTuningAngular = document.getElementById("btnTuningAngular");
    const btnClearPidTuning = document.getElementById("btnClearPidTuning");

    if (btnTuningLinear) {
      btnTuningLinear.onclick = () => {
        tuningGraphType = "linear";
        btnTuningLinear.classList.add("active");
        btnTuningLinear.style.background = "#1e293b";
        btnTuningLinear.style.color = "#fff";
        if (btnTuningAngular) {
          btnTuningAngular.classList.remove("active");
          btnTuningAngular.style.background = "#0f172a";
          btnTuningAngular.style.color = "#94a3b8";
        }
        drawPidTuningGraph(0);
      };
    }

    if (btnTuningAngular) {
      btnTuningAngular.onclick = () => {
        tuningGraphType = "angular";
        btnTuningAngular.classList.add("active");
        btnTuningAngular.style.background = "#1e293b";
        btnTuningAngular.style.color = "#fff";
        if (btnTuningLinear) {
          btnTuningLinear.classList.remove("active");
          btnTuningLinear.style.background = "#0f172a";
          btnTuningLinear.style.color = "#94a3b8";
        }
        drawPidTuningGraph(0);
      };
    }

    if (btnClearPidTuning) {
      btnClearPidTuning.onclick = () => {
        drawPidTuningGraph(0);
      };
    }

    // Populate Indexed Devices & Variables Tab
    function refreshDebugDevices() {
      const container = document.getElementById("debugDevicesList");
      if (!container || !window.ProjectManager) return;
      window.ProjectManager.indexVariables();
      const syms = window.ProjectManager.symbols;
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

    // Diagnostics Compilation Check
    function refreshDebugDiagnostics() {
      const summary = document.getElementById("debugDiagSummary");
      const list = document.getElementById("debugDiagList");
      const badge = document.getElementById("debugDiagBadge");
      if (!list || !window.ProjectManager) return;

      syncPlannerIntoProjectManager();
      const res = window.ProjectManager.compileProject();
      list.innerHTML = "";

      const totalIssues = res.errors.length + res.warnings.length;
      if (badge) badge.textContent = totalIssues;

      if (summary) {
        if (res.success) {
          summary.innerHTML = `<span class="debug-diag-status-dot green"></span><strong>Project Workspace: All Files Clean (0 Errors)</strong>`;
        } else {
          summary.innerHTML = `<span class="debug-diag-status-dot red"></span><strong>Build Failed: ${res.errors.length} error(s)</strong>`;
        }
      }

      if (totalIssues === 0) {
        list.innerHTML = `
          <div style="font-size:0.75rem;color:#22c55e;background:rgba(34,197,94,0.1);padding:10px;border-radius:6px;border:1px solid rgba(34,197,94,0.3);">
            ✅ No syntax, missing semicolon, or unresolved variable errors detected across any project script.
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

    // Step Debugger
    let debugStepIdx = 0;
    const btnStepNext = document.getElementById("btnDebugStepNext");
    const btnStepPrev = document.getElementById("btnDebugStepPrev");
    const btnStepReset = document.getElementById("btnDebugStepReset");
    const stepLabel = document.getElementById("debugActiveStepLabel");
    const stepPose = document.getElementById("debugStepPose");
    const stepTime = document.getElementById("debugStepTime");
    const stepLog = document.getElementById("debugStepLog");

    function updateStepDebugger() {
      if (!actions || actions.length === 0) return;
      const poses = computePoses();
      const curPose = debugStepIdx === 0 ? { ...pose } : (poses[debugStepIdx - 1] || pose);

      if (stepLabel) {
        stepLabel.textContent = debugStepIdx === 0 ? "Step 0 (Start Pose)" : `Step ${debugStepIdx} of ${actions.length} (${actions[debugStepIdx - 1]?.type || 'Action'})`;
      }
      if (stepPose) {
        stepPose.textContent = `(X: ${curPose.x.toFixed(1)}", Y: ${curPose.y.toFixed(1)}", θ: ${curPose.theta.toFixed(1)}°)`;
      }

      // Update robot preview on canvas to current step pose
      robotSimPose = { ...curPose };
      draw();

      if (debugStepIdx > 0 && actions[debugStepIdx - 1]) {
        selectedId = actions[debugStepIdx - 1].id;
        renderFlow();
      }
    }

    if (btnStepNext) {
      btnStepNext.onclick = () => {
        if (!actions || actions.length === 0) return;
        if (debugStepIdx < actions.length) {
          debugStepIdx++;
          const act = actions[debugStepIdx - 1];
          const entry = document.createElement("div");
          entry.className = "step-log-entry";
          entry.textContent = `[STEP ${debugStepIdx}] Executed ${act.type} (Timeout: ${act.timeout || 0}ms)`;
          stepLog?.appendChild(entry);
          if (stepLog) stepLog.scrollTop = stepLog.scrollHeight;
          updateStepDebugger();
        }
      };
    }

    if (btnStepPrev) {
      btnStepPrev.onclick = () => {
        if (debugStepIdx > 0) {
          debugStepIdx--;
          updateStepDebugger();
        }
      };
    }

    if (btnStepReset) {
      btnStepReset.onclick = () => {
        debugStepIdx = 0;
        if (stepLog) {
          stepLog.innerHTML = `<div class="step-log-entry info">[START] Autonomous routine reset to start pose.</div>`;
        }
        updateStepDebugger();
      };
    }

    // Terminal Clear
    const btnClearTerm = document.getElementById("btnClearDebugTerminal");
    const termConsole = document.getElementById("debugTerminalConsole");
    if (btnClearTerm && termConsole) {
      btnClearTerm.onclick = () => {
        termConsole.textContent = `[VEX V5 Terminal Ready]\n`;
      };
    }
  }

  // -- VEX V5 Brain Connection & Telemetry Controller ------------------
  function wireV5BrainUI() {
    if (!window.V5BrainSerial) return;

    const btnConnectNav = document.getElementById("btnConnectBrain");
    const bannerDot = document.getElementById("bannerBrainDot");
    const bannerText = document.getElementById("bannerBrainText");
    const bannerBatt = document.getElementById("bannerBrainBatt");
    const bannerPill = document.getElementById("bannerBrainStatus");

    // Modal elements
    const brainModal = document.getElementById("brainModal");
    const brainModalClose = document.getElementById("brainModalClose");
    const btnBrainModalDone = document.getElementById("btnBrainModalDone");
    const btnModalConnect = document.getElementById("btnModalConnectBrain");
    const btnModalDisconnect = document.getElementById("btnModalDisconnectBrain");
    const modalBrainDot = document.getElementById("modalBrainDot");
    const modalBrainName = document.getElementById("modalBrainName");
    const modalBrainSubtext = document.getElementById("modalBrainSubtext");
    const modalBattPct = document.getElementById("modalBattPct");
    const modalBattFill = document.getElementById("modalBattFill");
    const modalBattMv = document.getElementById("modalBattMv");
    const modalBattTemp = document.getElementById("modalBattTemp");
    const modalFirmware = document.getElementById("modalFirmware");
    const modalRadio = document.getElementById("modalRadio");
    const modalSmartportsGrid = document.getElementById("modalSmartportsGrid");
    const modalSlotSelect = document.getElementById("modalSlotSelect");
    const btnModalUpload = document.getElementById("btnModalUploadAuton");
    const btnModalRun = document.getElementById("btnModalRunProgram");
    const btnModalStop = document.getElementById("btnModalStopProgram");
    const uploadProgressWrap = document.getElementById("modalUploadProgressWrap");
    const uploadProgressBar = document.getElementById("modalUploadProgressBar");
    const uploadProgressLabel = document.getElementById("modalUploadProgressLabel");

    // Debug pane elements
    const debugBrainDot = document.getElementById("debugBrainDot");
    const debugBrainStatusName = document.getElementById("debugBrainStatusName");
    const btnDebugConnect = document.getElementById("btnDebugConnectBrain");
    const debugBrainBattVal = document.getElementById("debugBrainBattVal");
    const debugBrainBattBar = document.getElementById("debugBrainBattBar");
    const debugBrainTempVal = document.getElementById("debugBrainTempVal");
    const debugBrainVexosVal = document.getElementById("debugBrainVexosVal");
    const debugBrainSlotVal = document.getElementById("debugBrainSlotVal");
    const debugSlotSelect = document.getElementById("debugSlotSelect");
    const btnDebugUpload = document.getElementById("btnDebugUploadAuton");
    const btnDebugRun = document.getElementById("btnDebugRunProgram");
    const btnDebugStop = document.getElementById("btnDebugStopProgram");
    const debugSmartportsList = document.getElementById("debugSmartportsList");
    const debugTerminalConsole = document.getElementById("debugTerminalConsole");

    function openBrainModal() {
      if (!brainModal) return;
      brainModal.hidden = false;
      brainModal.classList.add("open");
      renderSmartports();
    }
    function closeBrainModal() {
      if (!brainModal) return;
      brainModal.hidden = true;
      brainModal.classList.remove("open");
    }

    if (bannerPill) bannerPill.onclick = openBrainModal;
    if (brainModalClose) brainModalClose.onclick = closeBrainModal;
    if (btnBrainModalDone) btnBrainModalDone.onclick = closeBrainModal;
    if (brainModal) {
      brainModal.addEventListener("click", (e) => {
        if (e.target === brainModal) closeBrainModal();
      });
    }

    async function handleConnectToggle() {
      if (window.V5BrainSerial.isConnected) {
        await window.V5BrainSerial.disconnect();
        showToast("🔌 VEX V5 Brain Disconnected");
      } else {
        showToast("🔌 Connecting to VEX V5 Brain via USB CDC...");
        const ok = await window.V5BrainSerial.connect();
        if (ok) {
          showToast(`🧠 Connected to VEX V5 Brain (${window.V5BrainSerial.status.name})!`);
        }
      }
    }

    if (btnConnectNav) btnConnectNav.onclick = handleConnectToggle;
    if (btnModalConnect) btnModalConnect.onclick = handleConnectToggle;
    if (btnModalDisconnect) btnModalDisconnect.onclick = handleConnectToggle;
    if (btnDebugConnect) btnDebugConnect.onclick = handleConnectToggle;

    // Flash / Upload autonomous routine to Brain
    async function handleUploadToBrain(slotPicker) {
      if (!window.V5BrainSerial.isConnected) {
        showToast("⚠️ Please connect to VEX V5 Brain first!");
        openBrainModal();
        return;
      }
      const slot = parseInt(slotPicker?.value || "1", 10);
      const activePath = getActive();
      const routineName = activePath?.name ? activePath.name.replace(/\s+/g, "_") : "Override_Auton";

      try {
        if (uploadProgressWrap) uploadProgressWrap.style.display = "block";
        if (btnModalUpload) btnModalUpload.disabled = true;
        if (btnDebugUpload) btnDebugUpload.disabled = true;

        await window.V5BrainSerial.uploadToSlot(slot, routineName, (pct) => {
          if (uploadProgressBar) uploadProgressBar.style.width = `${pct}%`;
          if (uploadProgressLabel) uploadProgressLabel.textContent = `Flashing to Slot ${slot}... ${pct}%`;
        });

        showToast(`🚀 Autonomous routine successfully flashed to Slot ${slot} on Brain!`);
      } catch (err) {
        showToast(`❌ Flashing failed: ${err.message}`);
      } finally {
        if (btnModalUpload) btnModalUpload.disabled = false;
        if (btnDebugUpload) btnDebugUpload.disabled = false;
        setTimeout(() => {
          if (uploadProgressWrap) uploadProgressWrap.style.display = "none";
        }, 1200);
      }
    }

    if (btnModalUpload) btnModalUpload.onclick = () => handleUploadToBrain(modalSlotSelect);
    if (btnDebugUpload) btnDebugUpload.onclick = () => handleUploadToBrain(debugSlotSelect);

    const btnUploadAndRun = document.getElementById("btnUploadAndRun");
    if (btnUploadAndRun) {
      btnUploadAndRun.onclick = async () => {
        if (!window.V5BrainSerial.isConnected) {
          showToast("⚠️ VEX V5 Brain is not connected via USB!");
          openBrainModal();
          return;
        }
        
        btnUploadAndRun.disabled = true;
        const oldHtml = btnUploadAndRun.innerHTML;
        btnUploadAndRun.innerHTML = "⏳ Uploading...";
        btnUploadAndRun.style.background = "#f59e0b";
        showToast("⚡ Starting Unified 1-Click Upload & Run...");

        const slot = parseInt(debugSlotSelect?.value || "1", 10);
        
        try {
          // Upload to slot
          await handleUploadToBrain(debugSlotSelect);
          // Wait 350ms, then trigger execution
          await new Promise((resolve) => setTimeout(resolve, 350));
          showToast(`🚀 Program updated! Starting routine in Slot ${slot}...`);
          await window.V5BrainSerial.startProgram(slot);
          showToast("🟢 Robot running autonomously!");
        } catch (err) {
          showToast(`❌ 1-Click failed: ${err.message}`);
        } finally {
          btnUploadAndRun.disabled = false;
          btnUploadAndRun.innerHTML = oldHtml;
          btnUploadAndRun.style.background = "";
        }
      };
    }

    if (btnModalRun) btnModalRun.onclick = () => window.V5BrainSerial.startProgram(parseInt(modalSlotSelect?.value || "1", 10));
    if (btnDebugRun) btnDebugRun.onclick = () => window.V5BrainSerial.startProgram(parseInt(debugSlotSelect?.value || "1", 10));
    if (btnModalStop) btnModalStop.onclick = () => window.V5BrainSerial.stopProgram();
    if (btnDebugStop) btnDebugStop.onclick = () => window.V5BrainSerial.stopProgram();

    // Render smart ports in modal and debug panel
    function renderSmartports() {
      const ports = window.V5BrainSerial.status.smartPorts;
      if (modalSmartportsGrid) {
        modalSmartportsGrid.innerHTML = "";
        for (let p = 1; p <= 21; p++) {
          const dev = ports[p];
          const card = document.createElement("div");
          card.className = "smartport-item-card";
          if (dev) {
            card.innerHTML = `
              <div class="smartport-item-top"><span>PORT ${p}</span><span style="color:#22c55e;">${escapeHtml(dev.status)}</span></div>
              <div class="smartport-item-name">${escapeHtml(dev.name)}</div>
              <div class="smartport-item-type">${escapeHtml(dev.type)} ${dev.tempC ? `(${dev.tempC}°C)` : ''}</div>
            `;
          } else {
            card.style.opacity = "0.45";
            card.innerHTML = `
              <div class="smartport-item-top" style="color:#64748b;"><span>PORT ${p}</span><span>--</span></div>
              <div class="smartport-item-name" style="color:#64748b;">Empty</div>
              <div class="smartport-item-type">No device</div>
            `;
          }
          modalSmartportsGrid.appendChild(card);
        }
      }

      if (debugSmartportsList) {
        debugSmartportsList.innerHTML = "";
        Object.keys(ports).forEach((p) => {
          const dev = ports[p];
          const row = document.createElement("div");
          row.className = "debug-port-row";
          row.innerHTML = `
            <span class="debug-port-num">P${p}</span>
            <span class="debug-port-name">${escapeHtml(dev.name)} <small style="color:#94a3b8;">(${escapeHtml(dev.type)})</small></span>
            <span class="debug-port-status">${dev.tempC ? `${dev.tempC}°C • ` : ''}${escapeHtml(dev.status)}</span>
          `;
          debugSmartportsList.appendChild(row);
        });
      }
    }

    // Update Status UI Listener
    function updateStatusUI(status) {
      const isConn = status && status.connected;

      // Top nav button
      if (btnConnectNav) {
        btnConnectNav.classList.toggle("connected", isConn);
        btnConnectNav.textContent = isConn ? `🔌 ${status.name}` : "🔌 Connect Brain";
      }

      // Banner pill
      if (bannerDot) {
        bannerDot.className = `brain-status-dot ${isConn ? 'connected' : 'disconnected'}`;
      }
      if (bannerText) {
        bannerText.textContent = isConn ? `Brain: ${status.name} (Slot ${status.activeSlot})` : "Brain: Disconnected";
      }
      if (bannerBatt) {
        bannerBatt.hidden = !isConn;
        if (isConn) bannerBatt.textContent = `⚡ ${status.batteryPct}%`;
      }

      // Homepage Brain pill
      const homeDot = document.getElementById("homeBrainDot");
      const homeText = document.getElementById("homeBrainText");
      const homeBatt = document.getElementById("homeBrainBatt");
      if (homeDot) homeDot.className = `brain-status-dot ${isConn ? 'connected' : 'disconnected'}`;
      if (homeText) homeText.textContent = isConn ? `Brain: ${status.name}` : "Brain: Disconnected";
      if (homeBatt) {
        homeBatt.hidden = !isConn;
        if (isConn) homeBatt.textContent = `⚡ ${status.batteryPct}%`;
      }

      // Modal elements
      if (modalBrainDot) modalBrainDot.className = `brain-status-dot ${isConn ? 'connected' : 'disconnected'}`;
      if (modalBrainName) modalBrainName.textContent = isConn ? `Connected: ${status.name}` : "Brain: Disconnected";
      if (modalBrainSubtext) {
        modalBrainSubtext.textContent = isConn 
          ? `VEXos ${status.vexosVersion} • ${status.radioType} (${status.radioSignalDbm} dBm) • Serial CDC 115200`
          : "Plug in VEX V5 USB cable to connect Web Serial CDC port";
      }
      if (btnModalConnect) btnModalConnect.style.display = isConn ? "none" : "inline-flex";
      if (btnModalDisconnect) btnModalDisconnect.style.display = isConn ? "inline-flex" : "none";

      if (modalBattPct) modalBattPct.textContent = isConn ? `${status.batteryPct}%` : "--%";
      if (modalBattFill) modalBattFill.style.width = isConn ? `${status.batteryPct}%` : "0%";
      if (modalBattMv) modalBattMv.textContent = isConn ? `${(status.batteryMv / 1000).toFixed(2)} V` : "-- V";
      if (modalBattTemp) modalBattTemp.textContent = isConn ? `${status.batteryTempC} °C` : "-- °C";
      if (modalFirmware) modalFirmware.textContent = isConn ? `VEXos ${status.vexosVersion}` : "--";
      if (modalRadio) modalRadio.textContent = isConn ? `${status.radioType} (${status.radioSignalDbm} dBm)` : "--";

      // Debug pane
      if (debugBrainDot) debugBrainDot.className = `brain-status-dot ${isConn ? 'connected' : 'disconnected'}`;
      if (debugBrainStatusName) debugBrainStatusName.textContent = isConn ? `VEX V5 Brain: ${status.name}` : "VEX V5 Brain: Disconnected";
      if (btnDebugConnect) btnDebugConnect.textContent = isConn ? "Disconnect" : "🔌 Connect USB";
      if (debugBrainBattVal) debugBrainBattVal.textContent = isConn ? `${status.batteryPct}% (${(status.batteryMv / 1000).toFixed(2)}V)` : "--% (-- V)";
      if (debugBrainBattBar) debugBrainBattBar.style.width = isConn ? `${status.batteryPct}%` : "0%";
      if (debugBrainTempVal) debugBrainTempVal.textContent = isConn ? `${status.batteryTempC} °C` : "-- °C";
      if (debugBrainVexosVal) debugBrainVexosVal.textContent = isConn ? `v${status.vexosVersion}` : "--";
      if (debugBrainSlotVal) debugBrainSlotVal.textContent = isConn ? `Slot ${status.activeSlot} ${status.programRunning ? '(Running)' : ''}` : "--";

      renderSmartports();
    }

    window.V5BrainSerial.addListener("status", updateStatusUI);
    window.V5BrainSerial.addListener("connected", (d) => updateStatusUI(d.status));
    window.V5BrainSerial.addListener("disconnected", (d) => updateStatusUI(d.status));
    window.V5BrainSerial.addListener("terminal", (line) => {
      if (debugTerminalConsole) {
        debugTerminalConsole.textContent += line;
        debugTerminalConsole.scrollTop = debugTerminalConsole.scrollHeight;
      }
    });

    updateStatusUI(window.V5BrainSerial.status);
  }

  // Initialize Homepage Hub, Planner Tabs, Project Manager, Debug Panels, and Brain Controller
  setupSimHudControls();
  wirePlannerTabsAndModes();
  wireBotVisualCard();
  wireBotSettings();
  syncBotInputs();
  wireHomepageHub();

  if (window.ProjectManager) {
    wireProjectWorkspace();
    wireLoadProjectModal();
    wireDebugPanel();

    function checkAndSyncExternalChanges(showNotification = true) {
      if (!window.ProjectManager || !window.ProjectManager.project || isSyncingFromPlanner) return;
      const proj = window.ProjectManager.project;
      const code = window.ProjectManager.getFile("src/autons.cpp");
      if (!code || !code.trim()) return;

      const indent = typeof getIndentString === "function" ? getIndentString() : "    ";
      const hasDiff = window.ProjectManager.hasCodeDifference(paths, indent);
      
      if (hasDiff && (proj.lastAutonEditor === "ide" || proj.rawCppPreserved)) {
        console.log("🔄 External IDE changes or restored version detected. Synchronizing Visual Planner blocks...");
        loadProjectAutonsIntoPlanner(showNotification, true);
      }
    }

    // UI state updates only - do NOT destructively replace user's planner paths on background events!
    window.ProjectManager.addListener(async (pm, reason) => {
      updateProjectBanner();
      if (reason === "load" || reason === "version_restored" || reason === "file_restored") {
        checkAndSyncExternalChanges(true);
      }
    });

    window.addEventListener("focus", async () => {
      if (window.ProjectManager) {
        await window.ProjectManager.initAsyncStorage();
        updateProjectBanner();
        checkAndSyncExternalChanges(false);
      }
    });

    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden && window.ProjectManager) {
        await window.ProjectManager.initAsyncStorage();
        updateProjectBanner();
        checkAndSyncExternalChanges(false);
      }
    });

    // Intelligent startup resolution: compare timestamps and raw C++ code between Planner storage and ProjectManager
    window.ProjectManager.whenReady().then(() => {
      const proj = window.ProjectManager.project;
      if (!proj) return;

      // Check if we just did a translation on translator.html
      const justSavedByTranslator = localStorage.getItem("lemlib_translator_just_saved") === "true";
      if (justSavedByTranslator) {
        localStorage.removeItem("lemlib_translator_just_saved");
        console.log("🚀 Detected fresh translation from Translator. Synchronizing to project...");
        proj.lastAutonEditor = "blocks";
        proj.rawCppPreserved = false;
        syncPlannerIntoProjectManager({ ask: false, force: true });
        updateProjectBanner();
        if (typeof showToast === "function") {
          showToast("✓ Translation successfully loaded and synchronized with Visual Planner & Flowchart!");
        }
        return;
      }

      const code = window.ProjectManager.getFile("src/autons.cpp");
      const projUpdatedAt = Number(proj.updatedAt) || 0;
      const rawPlanner = localStorage.getItem(STORAGE_KEY);
      let plannerTime = 0;
      if (rawPlanner) {
        try {
          const parsed = JSON.parse(rawPlanner);
          if (parsed.savedAt) plannerTime = new Date(parsed.savedAt).getTime();
        } catch (_) {}
      }

      const indent = typeof getIndentString === "function" ? getIndentString() : "    ";
      const hasDiff = window.ProjectManager.hasCodeDifference(paths, indent);

      // Protect raw C++ code: IF code exists in src/autons.cpp and differs from visual blocks:
      if (code && code.trim().length > 0) {
        if (hasDiff) {
          if (proj.importedProject || proj.lastAutonEditor === "ide" || proj.rawCppPreserved) {
            console.log("📥 Loading autonomous routines from imported/IDE C++ code (src/autons.cpp)...");
            loadProjectAutonsIntoPlanner(false, true);
          } else {
            console.log("⚠️ Conflict detected between visual blocks and src/autons.cpp. Prompting user...");
            promptMergeAutonCpp();
          }
        } else if (!paths || paths.length === 0) {
          loadProjectAutonsIntoPlanner(false, false);
        }
      } else if (paths && paths.length > 0) {
        // Planner has routines, but src/autons.cpp is empty: safely sync planner into autons.cpp
        syncPlannerIntoProjectManager({ ask: false, force: true });
      }

      updateProjectBanner();
    });
  }
  if (window.V5BrainSerial) {
    wireV5BrainUI();
  }

  function initMainSplitter() {
    const splitter = document.getElementById("mainSplitter");
    const panel = document.querySelector(".panel.flowchart-panel");
    if (!splitter || !panel) return;

    // Load saved width from localStorage if exists
    const savedWidth = localStorage.getItem("lemlib_panel_width");
    if (savedWidth) {
      panel.style.width = savedWidth + "px";
    }

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    splitter.addEventListener("mousedown", (e) => {
      isDragging = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      splitter.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      
      // Prevent canvas/iframes from intercepting mouse events during drag
      document.querySelectorAll("canvas, iframe").forEach(el => el.style.pointerEvents = "none");
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      let newWidth = startWidth + deltaX;
      
      // Enforce bounds
      const minW = 280;
      const maxW = Math.min(800, window.innerWidth * 0.6);
      if (newWidth < minW) newWidth = minW;
      if (newWidth > maxW) newWidth = maxW;

      panel.style.width = newWidth + "px";
      
      // Trigger canvas resize and redrawing
      if (typeof resizeCanvas === "function") {
        resizeCanvas();
      }
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      splitter.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      
      // Restore pointer events
      document.querySelectorAll("canvas, iframe").forEach(el => el.style.pointerEvents = "");
      
      // Save width
      localStorage.setItem("lemlib_panel_width", panel.offsetWidth);
    });
  }

  // Ensure simulation canvas is directly displayed and drawn on load
  initMainSplitter();
  showPlannerView();
  updateTimeDisplay();

  // ==========================================================================
  // BEGINNER QOL & ONBOARDING SYSTEM: VALIDATION, LINTER & INTERACTIVE TOUR
  // ==========================================================================

  // 1. INPUT RANGE VALIDATION & ERROR BUBBLES
  function validateInput(inputEl) {
    const valStr = inputEl.value;
    const val = Number(valStr);
    const id = inputEl.id || "";
    const name = inputEl.name || "";
    const field = inputEl.dataset.f || inputEl.dataset.childF || "";

    let isInvalid = false;
    let errMsg = "";

    // Parse bounds depending on type
    if (id.toLowerCase().includes("startx") || id.toLowerCase().includes("starty") || field === "x" || field === "y") {
      if (Math.abs(val) > 72) {
        isInvalid = true;
        errMsg = "Off Field: Limits are [-72, 72] inches";
      }
    } else if (field === "maxSpeed" || field === "speed" || id.toLowerCase().includes("speed")) {
      if (valStr.trim() !== "" && (val < 0 || val > 127)) {
        isInvalid = true;
        errMsg = "V5 Motor Limit: Must be 0 to 127";
      }
    } else if (field === "timeout" || id.toLowerCase().includes("timeout")) {
      if (val < 0) {
        isInvalid = true;
        errMsg = "Timeout cannot be negative";
      } else if (val > 15000) {
        isInvalid = true;
        errMsg = "Warning: Long timeout (>15s)";
      }
    }

    // Toggle validation markup cleanly on parentNode
    let parent = inputEl.parentNode;
    if (parent) {
      let errSpan = parent.querySelector(".validation-error-msg");
      if (isInvalid) {
        inputEl.classList.add("input-invalid");
        if (!errSpan) {
          errSpan = document.createElement("span");
          errSpan.className = "validation-error-msg";
          parent.appendChild(errSpan);
        }
        errSpan.textContent = errMsg;
      } else {
        inputEl.classList.remove("input-invalid");
        if (errSpan) {
          errSpan.remove();
        }
      }
    }
  }

  // 2. C++ SAFE MODE REAL-TIME LINTER
  function lintTextarea(textareaEl) {
    const code = textareaEl.value;
    const warnings = [];

    // Bracket/paren matching
    const counts = { '(': 0, ')': 0, '{': 0, '}': 0, '[': 0, ']': 0 };
    for (const char of code) {
      if (counts[char] !== undefined) counts[char]++;
    }
    if (counts['('] !== counts[')']) warnings.push("Unbalanced parenthesis ( and )");
    if (counts['{'] !== counts['}']) warnings.push("Unbalanced curly braces { and }");
    if (counts['['] !== counts[']']) warnings.push("Unbalanced square brackets [ and ]");

    // Case typos in standard LemLib functions
    if (/chassis\.moveto/i.test(code) && !/chassis\.moveTo/i.test(code) && /chassis\./i.test(code)) {
      warnings.push("Typo: LemLib uses camelCase. Use 'chassis.moveToPoint' or 'chassis.moveToPose'.");
    }
    if (/chassis\.turnto/i.test(code) && !/chassis\.turnTo/i.test(code) && /chassis\./i.test(code)) {
      warnings.push("Typo: LemLib uses camelCase. Use 'chassis.turnToHeading'.");
    }

    // Missing semicolon checker
    const lines = code.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    let missingSemicolon = false;
    for (const line of lines) {
      if (line.endsWith("{") || line.endsWith("}") || line.endsWith(";") || line.startsWith("//") || line.startsWith("/*")) {
        continue;
      }
      if (/^(if|for|while|else)\b/.test(line)) {
        continue;
      }
      missingSemicolon = true;
    }
    if (missingSemicolon) {
      warnings.push("Missing semicolon ';' at the end of statement");
    }

    // Assignment inside conditional block
    if (/if\s*\([^=]*=[^=]*\)/.test(code)) {
      warnings.push("Assignment '=' found inside 'if' statement condition. Did you mean '=='?");
    }

    // Render alerts
    let warningsBox = textareaEl.parentNode.querySelector(".cpp-linter-warnings");
    if (warnings.length > 0) {
      if (!warningsBox) {
        warningsBox = document.createElement("div");
        warningsBox.className = "cpp-linter-warnings";
        textareaEl.parentNode.appendChild(warningsBox);
      }
      warningsBox.innerHTML = `
        <div class="cpp-linter-title">⚠️ C++ Safe Mode Alerts:</div>
        ${warnings.map(w => `<div class="cpp-linter-msg">• ${w}</div>`).join("")}
      `;
    } else {
      if (warningsBox) {
        warningsBox.remove();
      }
    }
  }

  // Bind dynamic listeners via event delegation across flowchart and start cards
  const flowchartContainer = document.getElementById("actionFlow");
  const startCardEl = document.getElementById("startCard");

  if (flowchartContainer) {
    flowchartContainer.addEventListener("input", (e) => {
      if (e.target.tagName === "INPUT") validateInput(e.target);
      if (e.target.tagName === "TEXTAREA") lintTextarea(e.target);
    });
  }
  if (startCardEl) {
    startCardEl.addEventListener("input", (e) => {
      if (e.target.tagName === "INPUT") validateInput(e.target);
    });
  }

  // =========================================================================
  // LEMLIB VELOCITY & SHARP ANGLE TRANSITION ANALYSIS HELPER
  // =========================================================================
  function analyzeSharpAngleTransitions() {
    const sharpTurns = [];
    if (!actions || !actions.length) return sharpTurns;

    const poses = [{ x: pose.x, y: pose.y, theta: pose.theta }];
    for (const seg of simSegments) {
      if (seg.endPose) poses.push({ ...seg.endPose });
    }

    for (let i = 0; i < actions.length - 1; i++) {
      const a1 = actions[i];
      const a2 = actions[i + 1];
      if (!a1 || !a2) continue;
      if (a1.type === "custom" || a2.type === "custom" || a1.type === "wait" || a2.type === "wait" || a1.type === "ifElse" || a2.type === "ifElse" || a1.type === "loop" || a2.type === "loop") continue;

      const isMove1 = isMove(a1.type);
      const isMove2 = isMove(a2.type);
      if (!isMove1 || !isMove2) continue;

      const pFrom = poses[i] || pose;
      const pCorner = poses[i + 1] || pFrom;
      const pNext = poses[i + 2] || pCorner;

      let inDeg = angleToPoint(pFrom.x, pFrom.y, pCorner.x, pCorner.y);
      if (a1.forwards === false) inDeg = normalizeAngle(inDeg + 180);
      if (a1.type === "moveToPose" && a1.theta != null) inDeg = a1.theta;

      let outDeg = angleToPoint(pCorner.x, pCorner.y, pNext.x, pNext.y);
      if (a2.forwards === false) outDeg = normalizeAngle(outDeg + 180);

      if (a2.type === "bezierCurve") {
        const { cp1 } = getBezierControlPoints(a2, pCorner);
        outDeg = angleToPoint(pCorner.x, pCorner.y, cp1.x, cp1.y);
      }

      const angleDelta = Math.abs(angleError(inDeg, outDeg));

      if (angleDelta >= 35) {
        const hasEarlyExit = (a1.earlyExitRange || 0) >= 4;
        const isBezierPair = a1.type === "bezierCurve" && a2.type === "bezierCurve";

        sharpTurns.push({
          actionIndex: i,
          actionId: a1.id,
          nextActionId: a2.id,
          cornerWaypointNum: i + 1,
          cornerPose: { ...pCorner },
          inHeading: Math.round(inDeg),
          outHeading: Math.round(outDeg),
          angleDelta: Math.round(angleDelta),
          hasEarlyExit,
          isBezierPair,
          actionType1: a1.type,
          actionType2: a2.type,
          estimatedTimeLossSec: Number(((angleDelta / 180) * 0.4 + 0.12).toFixed(2)),
        });
      }
    }

    return sharpTurns;
  }

  function fixSharpTurnToBezier(actionId) {
    const idx = actions.findIndex((x) => x.id === actionId);
    if (idx < 0) return;
    const a = actions[idx];

    a.type = "bezierCurve";
    a.cp1X = null;
    a.cp1Y = null;
    a.cp2X = null;
    a.cp2Y = null;
    a.lead1 = 18;
    a.lead2 = 18;

    markDirty();
    renderFlow();
    draw();
    generateCode();
    try { updateTimeDisplay(); } catch (_) {}

    showToast(`✨ Converted Waypoint #${idx + 1} to a smooth Bezier spline arc!`);
  }

  function fixSharpTurnEarlyExit(actionId, rangeInches) {
    const r = rangeInches != null ? rangeInches : 6;
    const idx = actions.findIndex((x) => x.id === actionId);
    if (idx < 0) return;
    const a = actions[idx];
    a.earlyExitRange = r;

    markDirty();
    renderFlow();
    draw();
    generateCode();
    try { updateTimeDisplay(); } catch (_) {}

    showToast(`🏃 Added ${r}" earlyExitRange to Waypoint #${idx + 1}!`);
  }

  function fixAllSharpTurnsAutomatically() {
    const report = analyzeSharpAngleTransitions();
    if (!report.length) {
      showToast("✨ Path is already smooth!");
      return;
    }

    let count = 0;
    for (const item of report) {
      const a = actions[item.actionIndex];
      if (!a) continue;
      if (a.type !== "bezierCurve") {
        a.type = "bezierCurve";
        a.cp1X = null; a.cp1Y = null; a.cp2X = null; a.cp2Y = null;
        a.lead1 = 18; a.lead2 = 18;
      } else {
        a.earlyExitRange = 6;
      }
      count++;
    }

    markDirty();
    renderFlow();
    draw();
    generateCode();
    try { updateTimeDisplay(); } catch (_) {}

    const modal = document.getElementById("sharpTurnModal");
    if (modal) modal.style.display = "none";
    showToast(`⚡ Automatically optimized ${count} sharp turn transitions!`);
  }

  function renderSharpTurnModal() {
    const modal = document.getElementById("sharpTurnModal");
    if (!modal) return;
    const tbody = document.getElementById("sharpTurnModalTbody");
    const iconEl = document.getElementById("sharpTurnModalIcon");
    const titleEl = document.getElementById("sharpTurnModalTitle");
    const subEl = document.getElementById("sharpTurnModalSub");
    const btnFixAll = document.getElementById("btnFixAllSharpTurnsModal");

    const report = analyzeSharpAngleTransitions();

    if (!report.length) {
      if (iconEl) iconEl.textContent = "✨";
      if (titleEl) titleEl.textContent = "0 Sharp Turns Detected";
      if (subEl) subEl.textContent = "All waypoint transitions maintain smooth continuous velocity.";
      if (btnFixAll) btnFixAll.style.display = "none";
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:#34d399;font-weight:600;">✨ All movement transitions are smooth! Chassis maintains linear velocity.</td></tr>`;
      }
      return;
    }

    if (iconEl) iconEl.textContent = "⚡";
    if (titleEl) titleEl.textContent = `${report.length} Sharp ${report.length === 1 ? 'Turn' : 'Turns'} Detected`;
    if (subEl) subEl.textContent = `Chassis must brake to 0 in/s at sharp corner transitions. Convert to Bezier curves or set early exit.`;
    if (btnFixAll) btnFixAll.style.display = "inline-block";

    if (tbody) {
      tbody.innerHTML = report.map((item) => {
        return `
          <tr style="border-bottom:1px solid #1e293b;background:rgba(15,23,42,0.4);">
            <td style="padding:10px 12px;font-weight:700;color:#f8fafc;">
              Waypoint #${item.cornerWaypointNum}
              <div style="font-size:0.7rem;color:#94a3b8;font-weight:normal;">(${item.cornerPose.x.toFixed(1)}", ${item.cornerPose.y.toFixed(1)}")</div>
            </td>
            <td style="padding:10px 12px;">
              <span class="badge warning-badge" style="background:rgba(245,158,11,0.2);color:#fbbf24;border:1px solid rgba(245,158,11,0.4);padding:2px 6px;border-radius:4px;font-weight:700;">
                ⚡ ${item.angleDelta}° Sharp
              </span>
            </td>
            <td style="padding:10px 12px;color:#cbd5e1;font-family:ui-monospace, monospace;">
              ${item.inHeading}° → ${item.outHeading}°
            </td>
            <td style="padding:10px 12px;color:#f87171;font-weight:600;">
              Brakes to 0 in/s (~+${item.estimatedTimeLossSec}s)
            </td>
            <td style="padding:10px 12px;text-align:right;">
              <div style="display:flex;gap:6px;justify-content:flex-end;">
                <button type="button" class="btn-xs-fix-bezier" data-fix-act="bezier" data-id="${item.actionId}">
                  ✨ Bezier Curve
                </button>
                <button type="button" class="btn-xs-fix-exit" data-fix-act="exit" data-id="${item.actionId}">
                  🏃 6" Early Exit
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join("");

      tbody.querySelectorAll('[data-fix-act="bezier"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          fixSharpTurnToBezier(btn.dataset.id);
          renderSharpTurnModal();
        });
      });

      tbody.querySelectorAll('[data-fix-act="exit"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          fixSharpTurnEarlyExit(btn.dataset.id, 6);
          renderSharpTurnModal();
        });
      });
    }
  }

  function openSharpTurnModal() {
    const modal = document.getElementById("sharpTurnModal");
    if (!modal) return;
    renderSharpTurnModal();
    modal.style.display = "flex";
  }

  function setupSharpTurnAnalyzer() {
    const btnSharpHud = document.getElementById("simHudSharpTurn");
    if (btnSharpHud) btnSharpHud.addEventListener("click", openSharpTurnModal);

    const btnToolsSharp = document.getElementById("btnToolsSharpTurns");
    if (btnToolsSharp) btnToolsSharp.addEventListener("click", openSharpTurnModal);

    const btnCloseModal = document.getElementById("btnSharpTurnModalClose");
    if (btnCloseModal) btnCloseModal.addEventListener("click", () => {
      const modal = document.getElementById("sharpTurnModal");
      if (modal) modal.style.display = "none";
    });

    const btnDoneModal = document.getElementById("btnSharpTurnModalDone");
    if (btnDoneModal) btnDoneModal.addEventListener("click", () => {
      const modal = document.getElementById("sharpTurnModal");
      if (modal) modal.style.display = "none";
    });

    const btnFixAll = document.getElementById("btnFixAllSharpTurnsModal");
    if (btnFixAll) btnFixAll.addEventListener("click", fixAllSharpTurnsAutomatically);
  }

  setupSharpTurnAnalyzer();

  // 3. INTERACTIVE "GETTING STARTED" WALKTHROUGH
  function setupGuidedTour() {
    const tourOverlay = document.getElementById("tourOverlay");
    const btnStart = document.getElementById("btnStartQuickTour");
    const btnSkip = document.getElementById("tourSkipBtn");
    const btnNext = document.getElementById("tourNextBtn");
    const badge = document.getElementById("tourStepBadge");
    const title = document.getElementById("tourTitle");
    const desc = document.getElementById("tourDesc");
    const card = document.getElementById("tourCard");

    if (!tourOverlay || !btnStart) return;

    const steps = [
      {
        title: "🗺️ 2D Robot Field Simulator",
        desc: "Interactive canvas displaying your robot's live kinematics. Double-click anywhere to add target points, or click-and-drag the robot to reposition its starting pose.",
        targetId: "fieldCanvasCanvas", // standard canvas inside the simulator wrapper
        fallbackId: "fieldCanvas",
        pos: "right"
      },
      {
        title: "🧩 Autonomous Block Palette",
        desc: "Choose and click block actions like moveToPoint, moveToPose, turns, wait, loop, or custom C++ code to build your autonomous routine visually.",
        targetId: "plannerTabBar",
        pos: "bottom"
      },
      {
        title: "🎯 Sequenced Auton Flowchart",
        desc: "Your block actions chain together sequentially here. Adjust speed ranges, timeouts, coordinates, and precision parameters on-the-fly with real-time range validation.",
        targetId: "actionFlow",
        pos: "bottom"
      },
      {
        title: "⚡ Unified 1-Click Upload & Run",
        desc: "Plug in your robot's V5 Brain via USB Web Serial. 1-click on this button compiles, uploads to the active slot, and runs it on the robot instantly!",
        targetId: "bannerBrainStatus",
        pos: "bottom"
      }
    ];

    let currentStep = 0;

    function showStep(idx) {
      if (idx < 0 || idx >= steps.length) {
        endTour();
        return;
      }
      currentStep = idx;
      const s = steps[idx];

      badge.textContent = `Step ${idx + 1} of ${steps.length}`;
      title.textContent = s.title;
      desc.textContent = s.desc;
      btnNext.textContent = (idx === steps.length - 1) ? "Finish" : "Next →";

      // Position card beside the target element
      let target = document.getElementById(s.targetId) || document.getElementById(s.fallbackId);
      
      // Temporarily clear old highlights
      document.querySelectorAll(".tour-highlight").forEach(el => el.classList.remove("tour-highlight"));

      if (target) {
        target.classList.add("tour-highlight");
        const r = target.getBoundingClientRect();
        const pad = 16;

        if (s.pos === "right") {
          card.style.left = `${r.right + pad}px`;
          card.style.top = `${r.top + (r.height / 2) - 100}px`;
          card.style.transform = "none";
        } else if (s.pos === "bottom") {
          card.style.left = `${r.left + (r.width / 2) - 200}px`;
          card.style.top = `${r.bottom + pad}px`;
          card.style.transform = "none";
        } else {
          card.style.top = "50%";
          card.style.left = "50%";
          card.style.transform = "translate(-50%, -50%)";
        }
      } else {
        // Fallback center of the screen
        card.style.top = "50%";
        card.style.left = "50%";
        card.style.transform = "translate(-50%, -50%)";
      }

      // Constrain within visible viewport bounds
      const cardRect = card.getBoundingClientRect();
      if (cardRect.left < 10) card.style.left = "10px";
      if (cardRect.right > window.innerWidth - 10) card.style.left = `${window.innerWidth - cardRect.width - 10}px`;
      if (cardRect.top < 10) card.style.top = "10px";
      if (cardRect.bottom > window.innerHeight - 10) card.style.top = `${window.innerHeight - cardRect.height - 10}px`;
    }

    function startTour() {
      tourOverlay.style.display = "flex";
      showStep(0);
    }

    function endTour() {
      tourOverlay.style.display = "none";
      document.querySelectorAll(".tour-highlight").forEach(el => el.classList.remove("tour-highlight"));
    }

    btnStart.onclick = () => startTour();
    btnSkip.onclick = () => endTour();
    btnNext.onclick = () => showStep(currentStep + 1);
  }

  setupGuidedTour();

  window.PlannerApp = {
    emitRoutineBody,
    syncPlannerIntoProjectManager,
    getPaths: () => paths,
    getIndentString
  };

  initFirebaseAuth();
})();
