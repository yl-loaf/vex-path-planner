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
  const speedLabel = document.getElementById("speedLabel");

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

  function bindActive() {
    const p = activePath();
    pose = p.pose;
    actions = p.actions;
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

  function uid() {
    return "a" + Math.random().toString(36).slice(2, 9);
  }

  function defaultAction(type) {
    return {
      id: uid(),
      type,
      x: 0,
      y: 0,
      theta: 0,
      lead: bot.defaultLead != null ? bot.defaultLead : 0.6,
      timeout: 2000,
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

  // -- Coordinate helpers -------------------------------------------
  function fieldToCanvas(x, y) {
    const scale = canvas.width / FIELD_IN;
    return {
      cx: canvas.width / 2 + x * scale,
      cy: canvas.height / 2 - y * scale,
    };
  }

  function canvasToField(cx, cy) {
    const scale = canvas.width / FIELD_IN;
    return {
      x: (cx - canvas.width / 2) / scale,
      y: (canvas.height / 2 - cy) / scale,
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
          this.totalError += error * dt;
        } else {
          this.totalError = 0;
        }
      } else {
        this.totalError += error * dt;
      }
      // Reset integral on sign change
      if ((error > 0 && this.prevError < 0) || (error < 0 && this.prevError > 0)) {
        this.totalError = 0;
      }

      const deriv = dt > 0 ? (error - this.prevError) / dt : 0;
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

    let pose = { x: fromPose.x, y: fromPose.y, theta: fromPose.theta };
    let vLin = 0;
    let omegaDeg = 0;
    let t = 0;
    let points = [{ x: pose.x, y: pose.y, theta: pose.theta, t: 0, vLin: 0, omegaDeg: 0 }];
    let carrotPoint = null;

    if (action.type === "custom") {
      const dur = action.customDuration != null ? Math.max(0, Number(action.customDuration)) : 0;
      if (dur > 0) {
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0 });
      }
      return { endPose: pose, path: points, duration: dur, carrot: null };
    }

    if (action.type === "wait") {
      const isTime = action.waitType === "time";
      const dur = isTime ? Math.max(0, (action.delayMs != null ? action.delayMs : 250) / 1000) : 0;
      if (dur > 0) {
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0 });
      }
      return { endPose: pose, path: points, duration: dur, carrot: null };
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

        if (settleSmallTimer >= latSmallTime || settleLargeTimer >= latLargeTime) break;
        if (earlyExitRange > 0 && dist < earlyExitRange) break;

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

        vLin += ((targetVLin - vLin) / tau) * dt;
        omegaDeg += ((targetOmega - omegaDeg) / tau) * dt;

        const midTheta = normalizeAngle(pose.theta + (omegaDeg * dt) / 2);
        const rad = (midTheta * Math.PI) / 180;
        pose.x += Math.sin(rad) * vLin * dt;
        pose.y += Math.cos(rad) * vLin * dt;
        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);

        t += dt;
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin, omegaDeg });
      }

      // Settle cleanly to exact target pose
      pose.x = target.x;
      pose.y = target.y;
      pose.theta = target.theta;
      return { endPose: pose, path: points, duration: Math.max(t, 0.1), carrot: carrotPoint };
    }

    if (action.type === "moveToPoint") {
      const drift = (action.driftScaler != null ? action.driftScaler : (b.lateralDrift != null ? b.lateralDrift : 1.0));
      const reversed = action.forwards === false;
      const target = { x: action.x, y: action.y };
      let close = false;
      let settleSmallTimer = 0;
      let settleLargeTimer = 0;

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

        if (settleSmallTimer >= latSmallTime || settleLargeTimer >= latLargeTime) break;
        if (dist < 0.65 + earlyExitRange) break;

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

        vLin += ((targetVLin - vLin) / tau) * dt;
        omegaDeg += ((targetOmega - omegaDeg) / tau) * dt;

        const midTheta = normalizeAngle(pose.theta + (omegaDeg * dt) / 2);
        const rad = (midTheta * Math.PI) / 180;
        pose.x += Math.sin(rad) * vLin * dt;
        pose.y += Math.cos(rad) * vLin * dt;
        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);

        t += dt;
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin, omegaDeg });
      }

      pose.x = target.x;
      pose.y = target.y;
      return { endPose: pose, path: points, duration: Math.max(t, 0.1), carrot: null };
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

      while (t < timeoutS) {
        const angError = angleError(pose.theta, targetHeading);
        if (Math.abs(angError) < angSmallErr) settleSmallTimer += dt;
        else settleSmallTimer = 0;
        if (Math.abs(angError) < angLargeErr) settleLargeTimer += dt;
        else settleLargeTimer = 0;

        if (settleSmallTimer >= angSmallTime || settleLargeTimer >= angLargeTime) break;
        if (Math.abs(angError) < 1.0 + earlyExitRange) break;

        const rawAngPid = angPid.update(angError, dt);
        let angPower = clamp(rawAngPid / 127, -maxSpeed, maxSpeed);
        if (Math.abs(angPower) < minSpeed) angPower = Math.sign(angPower) * minSpeed;

        const targetOmega = angPower * maxOmega;
        omegaDeg += ((targetOmega - omegaDeg) / tau) * dt;

        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);
        t += dt;
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg });
      }

      pose.theta = targetHeading;
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

        if (settleSmallTimer >= angSmallTime || settleLargeTimer >= angLargeTime) break;
        if (Math.abs(angError) < 0.6 + earlyExitRange && t > 0.04) break;

        const rawAngPid = angPid.update(angError, dt);
        let pwr = clamp(rawAngPid / 127, -maxSpeed, maxSpeed);
        if (Math.abs(pwr) < minSpeed) pwr = Math.sign(pwr) * minSpeed;

        const targetVDrive = pwr * vMax;
        vDrive += ((targetVDrive - vDrive) / tau) * dt;

        // Driven wheel turns around stationary locked wheel:
        const wDeg = (vDrive / trackWidth) * (180 / Math.PI);
        pose.theta = normalizeAngle(pose.theta + wDeg * dt);

        const c = getCenter(pose.theta);
        pose.x = c.x;
        pose.y = c.y;

        t += dt;
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin: Math.abs(vDrive) / 2, omegaDeg: wDeg });
      }

      // Exact geometry settlement to eliminate any discrete integration residual
      let finalHeading = pose.theta;
      if (action.type === "swingToHeading") {
        finalHeading = action.theta;
      } else {
        finalHeading = angleToPoint(pose.x, pose.y, action.x, action.y);
        if (action.forwards === false) finalHeading = normalizeAngle(finalHeading + 180);
      }
      pose.theta = finalHeading;
      const finalC = getCenter(finalHeading);
      pose.x = finalC.x;
      pose.y = finalC.y;
      if (points.length) {
        points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0 };
      }

      return { endPose: pose, path: points, duration: Math.max(t, 0.08), carrot: null };
    }

    return { endPose: pose, path: points, duration: 0.1, carrot: null };
  }

  /**
   * Intelligently calculates the recommended timeout for an action with 100ms of clearance
   * to guard against battery voltage drops and real-world friction variations.
   * Simulates the exact physical kinematics motion profile.
   */
  function calculateIntelligentTimeout(action, fromPose, customBot) {
    if (!action) return 1000;
    if (action.type === "custom") {
      const dur = action.customDuration != null ? Math.max(0, Number(action.customDuration)) : 0;
      return dur === 0 ? 0 : Math.max(100, Math.round(dur * 1000 + 100));
    }
    const b = customBot || bot;
    const virtualAct = { ...action, timeout: 60000 };
    const sim = simulateAction(virtualAct, fromPose || { x: 0, y: 0, theta: 0 }, b);
    const simMs = Math.round(sim.duration * 1000);
    const batteryClearanceMs = 100; // 100ms clearance for battery voltage sag
    return Math.max(200, simMs + batteryClearanceMs);
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
    return ["moveToPoint", "moveToPose", "turnToPoint", "swingToPoint"].includes(t);
  }
  function needsHeading(t) {
    return ["moveToPose", "turnToHeading", "swingToHeading"].includes(t);
  }
  function needsSide(t) {
    return ["swingToPoint", "swingToHeading"].includes(t);
  }
  function isMove(t) {
    return t === "moveToPoint" || t === "moveToPose";
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
    saveLocal();
  }

  function redo() {
    if (!redoStack.length) return;
    const next = redoStack.pop();
    undoStack.push(next);
    restoreState(next);
    saveLocal();
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
    saveStatus.textContent = "Unsaved...";
    saveStatus.className = "save-status dirty";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLocal, 400);
    try { updateTimeDisplay(); } catch (_) {}
    try { generateCode(); } catch (_) {}
    try { scheduleCloudSave(); } catch (_) {}
    try { scheduleHistoryPush(); } catch (_) {}
  }

  function saveLocal() {
    // keep active path data in sync
    bindActive();
    const ap = activePath();
    ap.pose = pose;
    ap.actions = actions;
    const data = {
      version: 2,
      paths,
      activePathId,
      bot,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveStatus.textContent = "Saved";
      saveStatus.className = "save-status ok";
    } catch (e) {
      saveStatus.textContent = "Save failed";
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
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
        saveLocal();
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
  function drawRobot(x, y, thetaDeg, color, alpha = 1, selected = false) {
    const { cx, cy } = fieldToCanvas(x, y);
    const scale = canvas.width / FIELD_IN;
    const w = bot.robotW * scale; // Lateral width (in canvas px)
    const l = bot.robotL * scale; // Longitudinal length (in canvas px)
    const rad = screenHeadingRad(thetaDeg);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(rad);

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

      if (bot.botImageShowOutline !== false) {
        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 2.5 : 1.5;
        ctx.beginPath();
        drawRoundedRect(ctx, -l / 2, -w / 2, l, w, 4);
        ctx.stroke();

        // Front bumper indicator chevron
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.moveTo(l * 0.48, 0);
        ctx.lineTo(l * 0.32, -w * 0.22);
        ctx.lineTo(l * 0.36, 0);
        ctx.lineTo(l * 0.32, w * 0.22);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = color;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      drawRoundedRect(ctx, -l / 2, -w / 2, l, w, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(l * 0.45, 0);
      ctx.lineTo(l * 0.15, -w * 0.28);
      ctx.lineTo(l * 0.15, w * 0.28);
      ctx.closePath();
      ctx.fill();
    }

    if (selected) {
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      drawRoundedRect(ctx, -l / 2 - 4, -w / 2 - 4, l + 8, w + 8, 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Tracking origin center
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
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

    buildSimPath();
    const poses = [{ x: pose.x, y: pose.y, theta: pose.theta }];
    for (const seg of simSegments) {
      poses.push({ ...seg.endPose });
    }

    // Render the simulated differential-drive path from LemLib kinematics
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    let pen = false;
    for (const seg of simSegments) {
      if (!seg.action || seg.action.type === "custom") continue;
      for (const pt of seg.points) {
        const c = fieldToCanvas(pt.x, pt.y);
        if (!pen) { ctx.moveTo(c.cx, c.cy); pen = true; }
        else ctx.lineTo(c.cx, c.cy);
      }
    }
    ctx.stroke();

    // Visual feedback for multitasking (async) motions along path
    for (const seg of simSegments) {
      if (!seg.action || seg.action.type === "custom" || !seg.action.async) continue;
      if (!seg.points || seg.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = "#c084fc";
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.65;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      let segPen = false;
      for (const pt of seg.points) {
        const c = fieldToCanvas(pt.x, pt.y);
        if (!segPen) { ctx.moveTo(c.cx, c.cy); segPen = true; }
        else ctx.lineTo(c.cx, c.cy);
      }
      ctx.stroke();
      ctx.restore();
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

    drawRobot(pose.x, pose.y, pose.theta, "#22c55e", 0.95, selectedId === "start");
    const s = fieldToCanvas(pose.x, pose.y);
    ctx.fillStyle = "#22c55e";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("START", s.cx + 12, s.cy - 10);

    if (poses.length > 1) {
      const end = poses[poses.length - 1];
      drawRobot(end.x, end.y, end.theta, "#f59e0b", 0.65);
      drawEndArrow(end.x, end.y, end.theta);
      const ep = fieldToCanvas(end.x, end.y);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(
        `END (${end.x.toFixed(1)}, ${end.y.toFixed(1)}) θ=${end.theta.toFixed(0)}°`,
        ep.cx + 14,
        ep.cy + 14
      );
    }

    if (simRunning && simPath.length) {
      const p = simPath[Math.min(simIdx, simPath.length - 1)];
      drawRobot(p.x, p.y, p.theta, "#38bdf8", 1);
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
    if (type === "custom") return "custom";
    if (type === "wait") return "wait";
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
        const strokeColor = item.act.type === "custom" ? "#06b6d4" : item.act.type.startsWith("swing") ? "#a855f7" : "#3b82f6";
        const bgColor = item.act.type === "custom" ? "#083344" : item.act.type.startsWith("swing") ? "#3b0764" : "#172554";
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

      const card = document.createElement("div");
      card.className =
        "action-card" +
        (a.id === selectedId ? " selected" : "") +
        (a.type === "custom" ? " custom-type" : "") +
        (a.async ? " multitask-active" : "");
      card.dataset.id = a.id;

      let body = "";
      if (a.type === "wait") {
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
        body = `
          <label class="wide">Custom C++ (injected as-is)
            <textarea data-f="customCode" rows="3" placeholder="// e.g. intake.move(127); or chassis.waitUntil(12);">${escapeHtml(a.customCode)}</textarea>
          </label>
          <div class="multitask-presets-row">
            <span style="font-size:0.68rem;color:#94a3b8;align-self:center;">Snippets:</span>
            <button type="button" class="snippet-chip" data-snip="intake.move(127);">⚡ Intake On</button>
            <button type="button" class="snippet-chip" data-snip="intake.move(0);">🛑 Intake Off</button>
            <button type="button" class="snippet-chip" data-snip="clamp.set_value(true);">🦾 Clamp</button>
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
        const intelligentTimeout = calculateIntelligentTimeout(a, fromPose, bot);

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

        body = `
          <div class="row">
            ${pointFields}
            ${headField}
            ${leadField}
            ${driftField}
            ${sideField}
          </div>
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
              <label class="timeout-label">
                <span class="timeout-label-text">Timeout (ms) <span class="calc-sub-hint">+100ms batt</span></span>
                <div class="timeout-input-group">
                  <input type="number" data-f="timeout" min="0" step="50" value="${a.timeout}"/>
                  <button type="button" class="btn-calc-timeout" data-act="apply-intelligent-timeout" data-idx="${idx}" title="Set intelligent timeout (~${intelligentTimeout}ms = physical motion sim + 100ms clearance for battery voltage sag)">⚡ ~${intelligentTimeout}ms</button>
                </div>
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

      const cleanLbl = cleanCommentText(a.label);
      card.innerHTML = `
        <div class="card-title">
          <span class="badge ${badgeClass(a.type)}">${idx + 1}. ${a.type}</span>
          ${a.async ? '<span class="badge multitask-badge" title="Multitasking / Async: Non-blocking action running concurrently with the next step">⚡ MULTITASK</span>' : ""}
          ${a.forwards === false && a.type !== "custom" ? '<span class="badge reverse">REV</span>' : ""}
          <span class="hint-inline ${cleanLbl ? "has-comment" : ""}">${cleanLbl ? `// ${escapeHtml(cleanLbl)}` : ""}</span>
          <div style="margin-left:auto;display:flex;gap:2px">
            <button class="icon" data-act="up" title="Move up">↑</button>
            <button class="icon" data-act="down" title="Move down">↓</button>
            <button class="icon" data-act="del" title="Delete">×</button>
          </div>
        </div>
        <div class="card-body">${body}</div>`;

      card.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("textarea")) return;
        selectedId = a.id;
        renderFlow();
        draw();
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
            if (["x", "y", "theta"].includes(f)) draw();
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
            }
          }
        });
      });

      card.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === "toggle-flowchart") {
            a.showFlowchart = !a.showFlowchart;
            renderFlow();
            return;
          }
          if (act === "enlarge-flowchart") {
            openFlowchartModal(a, idx);
            return;
          }
          if (act === "apply-intelligent-timeout") {
            const fromP = poses[idx] || { x: pose.x, y: pose.y, theta: pose.theta };
            const calcT = calculateIntelligentTimeout(a, fromP, bot);
            a.timeout = calcT;
            markDirty();
            renderFlow();
            generateCode();
            showToast(`⚡ Set timeout to ${calcT}ms (+100ms clearance for battery sag)`);
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
          const i = actions.findIndex((x) => x.id === a.id);
          if (act === "del") {
            actions.splice(i, 1);
            if (selectedId === a.id) selectedId = null;
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

      block.appendChild(card);
      actionFlow.appendChild(block);
    });
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

  function emitRoutineBody(pose0, acts, indent) {
    const ind = indent != null ? indent : "  ";
    const commentStyle = getCommentStyle();
    let code = "";
    code += `${ind}chassis.setPose(${num(pose0.x)}, ${num(pose0.y)}, ${num(pose0.theta)});\n`;
    for (const a of acts) {
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
        continue;
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
        continue;
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

  function updateTimeDisplay(elapsed, totalEst, currentVLin, currentOmegaDeg) {
    const el = document.getElementById("timeEst");
    const hudTime = document.getElementById("simHudTime");
    const hudSpeed = document.getElementById("simHudSpeed");
    const hudCoords = document.getElementById("simHudCoords");
    const btnSimF = document.getElementById("btnSimField");

    const asyncCount = actions.filter((a) => a.async).length;
    const asyncTag = asyncCount > 0 ? ` · ⚡ ${asyncCount} Multitask` : "";
    
    // Determine active robot pose for telemetry
    let activeRobotPose = pose;
    if (simRunning && simPath.length && simPath[simIdx]) {
      activeRobotPose = simPath[simIdx];
    }

    if (hudCoords) {
      hudCoords.textContent = `📍 (${activeRobotPose.x.toFixed(1)}", ${activeRobotPose.y.toFixed(1)}") θ=${Math.round(normalizeAngle(activeRobotPose.theta))}°`;
    }

    if (elapsed != null && totalEst != null) {
      let speedText = "";
      if (currentVLin != null && currentOmegaDeg != null) {
        speedText = ` · ${Math.abs(currentVLin).toFixed(1)} in/s · ${Math.abs(currentOmegaDeg).toFixed(0)}°/s`;
        if (hudSpeed) {
          hudSpeed.textContent = `🏎️ ${Math.abs(currentVLin).toFixed(1)} in/s · ${Math.abs(currentOmegaDeg).toFixed(0)}°/s`;
        }
      }
      if (el) el.textContent = `Time: ${elapsed.toFixed(2)}s / ~${totalEst.toFixed(2)}s${asyncTag}${speedText}`;
      if (hudTime) hudTime.textContent = `⏱ ${elapsed.toFixed(2)}s / ~${totalEst.toFixed(2)}s`;
    } else {
      const t = estimateTotalTime();
      if (el) el.textContent = actions.length ? `Est. time: ~${t.toFixed(2)}s (LemLib)${asyncTag}` : `Est. time: —`;
      if (hudTime) hudTime.textContent = actions.length ? `⏱ ~${t.toFixed(2)}s total` : `⏱ 0.00s`;
      if (hudSpeed) hudSpeed.textContent = `🏎️ 0.0 in/s`;
    }

    if (btnSimF) {
      if (simRunning) {
        btnSimF.classList.add("playing");
        const txt = btnSimF.querySelector(".hud-btn-text");
        if (txt) txt.textContent = "Pause";
      } else {
        btnSimF.classList.remove("playing");
        const txt = btnSimF.querySelector(".hud-btn-text");
        if (txt) txt.textContent = "Simulate";
      }
    }
  }

  function buildSimPath() {
    simSegments = [];
    simPath = [];
    let cur = { x: pose.x, y: pose.y, theta: pose.theta };
    let t = 0;
    simPath.push({ ...cur, t: 0, vLin: 0, omegaDeg: 0 });

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
        });
      }
      t += seg.duration;
      cur = { ...seg.endPose };
    }
  }

  function startSim() {
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
    updateTimeDisplay(0, totalEst, 0, 0);

    function frame(now) {
      if (!simRunning) return;
      const elapsed = ((now - startTime) / 1000) * simSpeed;
      let idx = 0;
      for (let i = 0; i < simPath.length; i++) {
        if (simPath[i].t <= elapsed) idx = i;
        else break;
      }
      simIdx = idx;
      const pt = simPath[simIdx] || { vLin: 0, omegaDeg: 0 };
      updateTimeDisplay(Math.min(elapsed, totalT), totalEst, pt.vLin, pt.omegaDeg);
      draw();
      if (elapsed < totalT + 0.15) animId = requestAnimationFrame(frame);
      else {
        simRunning = false;
        updateTimeDisplay(totalT, totalEst, 0, 0);
        draw();
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
  }

  // -- Hit testing / drag -------------------------------------------
  function hitTest(cx, cy) {
    const s = fieldToCanvas(pose.x, pose.y);
    const scale = canvas.width / FIELD_IN;
    const botHitR = Math.max(HIT_R + 4, Math.min(bot.robotW, bot.robotL) * scale * 0.48);
    if (Math.hypot(cx - s.cx, cy - s.cy) < botHitR) return { kind: "start" };

    const poses = computePoses();
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
        markDirty();
        renderFlow();
        draw();
      } else {
        a.x = Number(x.toFixed(1));
        a.y = Number(y.toFixed(1));
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
    actions.push(a);
    selectedId = a.id;
    markDirty();
    renderFlow();
    draw();
  };

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

  // Segmented Tab Switcher for Left Sidebar (Routine, Bot & PID, C++ Code)
  function wirePlannerTabsAndModes() {
    const tabBtnFlowchart = document.getElementById("tabBtnFlowchart");
    const tabBtnBot = document.getElementById("tabBtnBot");
    const tabBtnCode = document.getElementById("tabBtnCode");

    const paneFlowchart = document.getElementById("paneTabFlowchart");
    const paneBot = document.getElementById("paneTabBot");
    const paneCode = document.getElementById("paneTabCode");

    function selectTab(tab) {
      const allTabs = [tabBtnFlowchart, tabBtnBot, tabBtnCode];
      const allPanes = [paneFlowchart, paneBot, paneCode];
      allTabs.forEach((t) => { if (t) t.classList.remove("active"); });
      allPanes.forEach((p) => { if (p) p.style.display = "none"; });

      if (tab === "flowchart") {
        if (tabBtnFlowchart) tabBtnFlowchart.classList.add("active");
        if (paneFlowchart) paneFlowchart.style.display = "flex";
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

    if (tabBtnFlowchart) tabBtnFlowchart.onclick = () => selectTab("flowchart");
    if (tabBtnBot) tabBtnBot.onclick = () => selectTab("bot");
    if (tabBtnCode) tabBtnCode.onclick = () => selectTab("code");

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

    const scale = canvas ? canvas.width / FIELD_IN : 5;
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

  async function cloudLoad() {
    if (!cloudReady || !cloudUser) return;
    setCloudStatus("Loading…", "busy");
    try {
      const db = firebase.firestore();
      const ref = db.collection("users").doc(cloudUser.uid).collection("data").doc("path");
      const snap = await ref.get();
      if (snap.exists) {
        applyPathPayload(snap.data());
        setCloudStatus("Synced", "ok");
        saveLocal();
      } else {
        // First login: upload current local path
        await cloudSave(true);
        setCloudStatus("Synced", "ok");
      }
    } catch (e) {
      console.error(e);
      setCloudStatus("Load failed", "err");
    }
  }

  async function cloudSave(force) {
    if (!cloudReady || !cloudUser || cloudApplying) return;
    setCloudStatus("Saving…", "busy");
    try {
      const db = firebase.firestore();
      const ref = db.collection("users").doc(cloudUser.uid).collection("data").doc("path");
      await ref.set(pathPayload(), { merge: true });
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
        cloudUser = cred.user;
        saveGoogleUserProfile(cred.user);
        updateAuthUI();
        await cloudLoad();
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
    if (saved && !isExplicitSignOut) {
      updateAuthUI(saved, false);
      setCloudStatus("Connecting…", "busy");
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
      if (user) {
        saveGoogleUserProfile(user);
        updateAuthUI();
        await cloudLoad();
      } else {
        const signedOut = localStorage.getItem(AUTH_EXPLICIT_SIGNOUT_KEY) === "true";
        if (signedOut) {
          updateAuthUI();
        } else {
          const cached = getSavedGoogleUser();
          if (cached) {
            // Keep saved account visible so user knows they are remembered and can re-sync with 1 click
            updateAuthUI(cached, true);
            setCloudStatus("Offline · Reconnect", "busy");
          } else {
            updateAuthUI();
          }
        }
      }
    });

    // Save on tab close or navigation
    window.addEventListener("beforeunload", () => {
      if (cloudReady && cloudUser && !cloudApplying) {
        cloudSave(true);
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && cloudReady && cloudUser && !cloudApplying) {
        cloudSave(true);
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

  async function checkForUpdates(manual) {
    try {
      const r = await fetch("version.js?_=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const text = await r.text();
      const m = text.match(/APP_BUILD\s*=\s*["']([^"']+)["']/);
      if (!m) return;
      const remote = m[1];
      const local = window.APP_BUILD || "";
      if (remote && local && remote !== local) {
        if (confirm("A newer build is available (" + remote + ").\\nReload now?")) {
          location.reload(true);
        }
      } else if (manual) {
        alert("You are on the latest build (" + (local || remote) + ").");
      }
    } catch (e) {
      if (manual) alert("Could not check for updates.");
    }
  }


  showBuildNumber();
  const btnUp = document.getElementById("btnCheckUpdate");
  if (btnUp) btnUp.onclick = () => checkForUpdates(true);
  // Soft check a few seconds after load (no prompt unless newer)
  setTimeout(() => checkForUpdates(false), 2500);
  wireClearModal();
  wireHelpModal();
  wireFlowchartModal();
  wireCppTranslateModal();
  wirePidModal();
  wireVideoExportModal();
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
  if (bRen) bRen.onclick = renameActivePath;
  const bDup = document.getElementById("btnPathDup");
  if (bDup) bDup.onclick = duplicateActivePath;
  const bDel = document.getElementById("btnPathDel");
  if (bDel) bDel.onclick = deleteActivePath;
  document.querySelectorAll('input[name="codeMode"]').forEach((el) => {
    el.addEventListener("change", () => generateCode());
  });

  const btnAutoAll = document.getElementById("btnAutoAllTimeouts");
  if (btnAutoAll) {
    btnAutoAll.onclick = () => {
      if (!actions || !actions.length) {
        showToast("No actions in routine to calculate.");
        return;
      }
      const poses = computePoses();
      let updatedCount = 0;
      actions.forEach((a, i) => {
        if (a.type !== "custom") {
          const fromPose = poses[i] || { x: pose.x, y: pose.y, theta: pose.theta };
          a.timeout = calculateIntelligentTimeout(a, fromPose, bot);
          updatedCount++;
        }
      });
      markDirty();
      renderFlow();
      generateCode();
      showToast(`⚡ Calculated intelligent timeouts (+100ms clearance) for ${updatedCount} movement${updatedCount === 1 ? '' : 's'}`);
    };
  }

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
        window.ProjectManager.mergePlannerIntoAutonCpp(paths, _autoMergeSessionChoice, indent);
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
          showToast("Kept existing src/autons.cpp (No changes made)");
          resolve(false);
        };
      }

      if (btnAppend) {
        btnAppend.onclick = () => {
          if (chkRemember && chkRemember.checked) _autoMergeSessionChoice = "append";
          window.ProjectManager.mergePlannerIntoAutonCpp(paths, "append", indent);
          updateProjectBanner();
          cleanup();
          showToast("➕ Appended visual routine into src/autons.cpp");
          resolve(true);
        };
      }

      if (btnOverwrite) {
        btnOverwrite.onclick = () => {
          if (chkRemember && chkRemember.checked) _autoMergeSessionChoice = "replace";
          window.ProjectManager.mergePlannerIntoAutonCpp(paths, "replace", indent);
          updateProjectBanner();
          cleanup();
          showToast("✅ Merged & overwritten src/autons.cpp from visual blocks");
          resolve(true);
        };
      }
    });
  }

  function syncPlannerIntoProjectManager(options = { ask: false }) {
    if (!window.ProjectManager) return;
    try {
      if (options.ask) {
        promptMergeAutonCpp();
      } else {
        window.ProjectManager.updateAutonCppFromPlanner(paths, getIndentString());
        updateProjectBanner();
      }
    } catch (e) {
      console.warn("Failed to sync planner into ProjectManager:", e);
    }
  }

  function loadProjectAutonsIntoPlanner() {
    if (!window.ProjectManager) return;
    const autonRoutines = window.ProjectManager.getAutonRoutines();
    if (!autonRoutines || autonRoutines.length === 0) return;

    // Convert parsed routines into planner paths
    const newPaths = [];
    autonRoutines.forEach((r, idx) => {
      let parsed = null;
      if (window.CppParser && typeof window.CppParser.parse === "function") {
        try {
          parsed = window.CppParser.parse(r.body, { defaultTimeout: 2000 });
        } catch (_) {}
      }

      const pName = r.name.replace(/^auton_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || `Routine ${idx + 1}`;
      newPaths.push({
        id: "path_" + Date.now() + "_" + idx,
        name: pName,
        pose: parsed?.pose ? { ...parsed.pose } : { x: -60, y: -60, theta: 0 },
        actions: parsed?.actions && parsed.actions.length > 0 ? parsed.actions : [
          {
            id: "act_" + Date.now() + "_0",
            type: "moveToPoint",
            x: -24,
            y: -24,
            theta: 0,
            timeout: 2000,
            maxSpeed: 127,
            minSpeed: 0,
            earlyExitRange: 0,
            forwards: true,
            label: "Rush goal",
            async: false
          }
        ]
      });
    });

    if (newPaths.length > 0) {
      paths = newPaths;
      activePathId = paths[0].id;
      bindActive();
      syncPathSelect();
      syncStartInputs();
      renderFlow();
      draw();
      generateCode();
      showToast(`📁 Loaded ${newPaths.length} autonomous routine${newPaths.length === 1 ? '' : 's'} from src/autons.cpp`);
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
    const hudHeight = hud ? hud.offsetHeight : 50;
    const availW = Math.max(280, rect.width - 16);
    const availH = Math.max(280, window.innerHeight - 160 - hudHeight);
    const size = Math.min(availW, availH);
    if (size > 0) {
      canvas.style.width = size + "px";
      canvas.style.height = size + "px";
    }
    draw();
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

    updateHomepageStats();
  }

  function wireProjectWorkspace() {
    updateProjectBanner();
    loadProjectAutonsIntoPlanner();

    // Banner Cloud Sync button
    const btnSyncCloud = document.getElementById("btnSyncProjectToCloud");
    if (btnSyncCloud) {
      btnSyncCloud.onclick = async () => {
        try {
          btnSyncCloud.disabled = true;
          btnSyncCloud.textContent = "⏳ Syncing...";
          syncPlannerIntoProjectManager();
          await window.ProjectManager.saveToCloud();
          showToast("☁️ Multi-file project synchronized to cloud successfully!");
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
        syncPlannerIntoProjectManager();
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
        if (window.ProjectManager) {
          window.ProjectManager.initDefaultProject("Override_LemLib_Bot");
          loadProjectAutonsIntoPlanner();
          updateProjectBanner();
          closeModal();
          showToast("🚀 Default competition project loaded. Visual flowchart synced to src/autons.cpp");
        }
      };
    }

    if (btnFetchCloud) {
      btnFetchCloud.onclick = async () => {
        if (!window.ProjectManager) return;
        try {
          btnFetchCloud.disabled = true;
          btnFetchCloud.textContent = "Fetching...";
          const proj = await window.ProjectManager.loadFromCloud();
          if (proj) {
            loadProjectAutonsIntoPlanner();
            updateProjectBanner();
            closeModal();
            showToast("☁️ Synced cloud project loaded successfully!");
          } else {
            showToast("No project found in cloud. Sync your current project first!");
          }
        } catch (e) {
          showToast(`⚠️ Cloud fetch failed: ${e.message}`);
        } finally {
          btnFetchCloud.disabled = false;
          btnFetchCloud.textContent = "Fetch Cloud Project";
        }
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
              window.ProjectManager.project = data;
              window.ProjectManager.saveLocal();
              loadProjectAutonsIntoPlanner();
              updateProjectBanner();
              closeModal();
              showToast("📂 Project imported successfully!");
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
      };
    });

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
  wirePlannerTabsAndModes();
  wireBotVisualCard();
  wireBotSettings();
  syncBotInputs();
  wireHomepageHub();

  if (window.ProjectManager) {
    wireProjectWorkspace();
    wireLoadProjectModal();
    wireDebugPanel();
  }
  if (window.V5BrainSerial) {
    wireV5BrainUI();
  }

  // Ensure simulation canvas is directly displayed and drawn on load
  showPlannerView();
  updateTimeDisplay();

  initFirebaseAuth();
})();
