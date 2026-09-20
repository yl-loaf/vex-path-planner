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
    trackWidth: 12,
    robotW: 14,
    robotL: 14,
    wheelDiam: 3.25,
    driveRpm: 600,
    defaultMaxSpeed: 127,
    defaultMinSpeed: 0,
  };

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
      lead: 0.6,
      timeout: 2000,
      forwards: true,
      maxSpeed: bot.defaultMaxSpeed,
      minSpeed: bot.defaultMinSpeed,
      earlyExitRange: 0,
      lockedSide: "LEFT",
      async: false,
      offsetX: 0,
      offsetY: 0,
      offsetTheta: 0,
      customCode: "",
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
    constructor(kP, kI, kD) {
      this.kP = kP;
      this.kI = kI;
      this.kD = kD;
      this.prevError = 0;
      this.totalError = 0;
      this.initialized = false;
    }

    reset() {
      this.prevError = 0;
      this.totalError = 0;
      this.initialized = false;
    }

    update(error, dt = 0.01) {
      if (!this.initialized) {
        this.prevError = error;
        this.initialized = true;
      }
      if ((error > 0 && this.prevError < 0) || (error < 0 && this.prevError > 0)) {
        this.totalError = 0;
      }
      this.totalError += error * dt;
      const deriv = dt > 0 ? (error - this.prevError) / dt : 0;
      this.prevError = error;
      return this.kP * error + this.kI * this.totalError + this.kD * deriv;
    }
  }

  /** Apply a swing about locked side: returns new {x,y,theta} after turning dth degrees (CW+) */
  function applySwing(x, y, theta, endTheta, lockedSide) {
    const dth = angleError(theta, endTheta);
    if (Math.abs(dth) < 1e-6) return { x, y, theta: endTheta };
    const halfTrack = (bot.trackWidth || 12) / 2;
    const lockLeft = (lockedSide || "LEFT") === "LEFT";
    const pivotLocalX = lockLeft ? -halfTrack : halfTrack;
    // robot right unit at current heading (0=+Y CW+)
    const rightX = Math.sin(((theta + 90) * Math.PI) / 180);
    const rightY = Math.cos(((theta + 90) * Math.PI) / 180);
    const pivotWX = x + rightX * pivotLocalX;
    const pivotWY = y + rightY * pivotLocalX;
    const relX = x - pivotWX;
    const relY = y - pivotWY;
    const ang = (dth * Math.PI) / 180;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    // CW rotation of relative vector
    const nx = relX * cosA + relY * sinA;
    const ny = -relX * sinA + relY * cosA;
    return { x: pivotWX + nx, y: pivotWY + ny, theta: endTheta };
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

    let pose = { x: fromPose.x, y: fromPose.y, theta: fromPose.theta };
    let vLin = 0;
    let omegaDeg = 0;
    let t = 0;
    let points = [{ x: pose.x, y: pose.y, theta: pose.theta, t: 0, vLin: 0, omegaDeg: 0 }];
    let carrotPoint = null;

    if (action.type === "custom") {
      const dur = Math.min(0.35, timeoutS);
      points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0 });
      return { endPose: pose, path: points, duration: dur, carrot: null };
    }

    if (action.type === "moveToPose") {
      const lead = action.lead != null ? clamp(action.lead, 0, 1.0) : 0.6;
      const reversed = action.forwards === false;
      const target = { x: action.x, y: action.y, theta: action.theta };
      // When reversed, chassis rear approaches target along target.theta
      const approachTheta = reversed ? normalizeAngle(target.theta + 180) : target.theta;
      const approachRad = (approachTheta * Math.PI) / 180;
      let close = false;

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

        // LemLib settling exit condition
        if (close && dist < 0.65 && Math.abs(angError) < 2.0) break;
        if (earlyExitRange > 0 && dist < earlyExitRange) break;

        const alignCos = Math.cos((angError * Math.PI) / 180);
        let latPower = clamp(dist / 14, 0, maxSpeed);
        if (close) {
          latPower *= Math.max(0, alignCos);
        } else {
          // Slow down linearly if heading is misaligned with carrot
          latPower *= Math.max(0.15, alignCos);
        }
        if (reversed) latPower = -latPower;

        let angPower = clamp(angError / 32, -maxSpeed, maxSpeed);

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
      const reversed = action.forwards === false;
      const target = { x: action.x, y: action.y };
      let close = false;

      while (t < timeoutS) {
        const dist = Math.hypot(target.x - pose.x, target.y - pose.y);
        if (dist < 7.5 && !close) close = true;

        const targetAngle = angleToPoint(pose.x, pose.y, target.x, target.y);
        const desiredHeading = reversed ? normalizeAngle(targetAngle + 180) : targetAngle;
        const angError = angleError(pose.theta, desiredHeading);

        if (dist < 0.65 + earlyExitRange) break;

        const alignCos = Math.cos((angError * Math.PI) / 180);
        let latPower = clamp(dist / 14, 0, maxSpeed);
        if (close) {
          latPower *= Math.max(0, alignCos);
        } else {
          latPower *= Math.max(0.18, alignCos);
        }
        if (reversed) latPower = -latPower;

        // LemLib turns off angular steering when settling within 7.5 in
        const angPower = close ? 0 : clamp(angError / 32, -maxSpeed, maxSpeed);

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

      while (t < timeoutS) {
        const angError = angleError(pose.theta, targetHeading);
        if (Math.abs(angError) < 1.0 + earlyExitRange) break;

        let angPower = clamp(angError / 26, -maxSpeed, maxSpeed);
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
      let targetHeading = pose.theta;
      if (action.type === "swingToHeading") {
        targetHeading = action.theta;
      } else {
        targetHeading = angleToPoint(pose.x, pose.y, action.x, action.y);
        if (action.forwards === false) targetHeading = normalizeAngle(targetHeading + 180);
      }

      let vDrive = 0;

      while (t < timeoutS) {
        const angError = angleError(pose.theta, targetHeading);
        if (Math.abs(angError) < 1.0 + earlyExitRange) break;

        let pwr = clamp(angError / 26, -maxSpeed, maxSpeed);
        if (Math.abs(pwr) < minSpeed) pwr = Math.sign(pwr) * minSpeed;

        const targetVDrive = pwr * vMax;
        vDrive += ((targetVDrive - vDrive) / tau) * dt;

        // Circular arc about locked wheel:
        // Left locked: vL = 0, vR = -vDrive -> CW rotation when angError > 0
        // Right locked: vR = 0, vL = vDrive -> CW rotation when angError > 0
        const vL = vDrive / 2;
        const wDeg = (vDrive / trackWidth) * (180 / Math.PI);

        const midTheta = normalizeAngle(pose.theta + (wDeg * dt) / 2);
        const rad = (midTheta * Math.PI) / 180;
        pose.x += Math.sin(rad) * vL * dt;
        pose.y += Math.cos(rad) * vL * dt;
        pose.theta = normalizeAngle(pose.theta + wDeg * dt);

        t += dt;
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin: vL, omegaDeg: wDeg });
      }

      // Exact geometry settlement
      const exactSwing = applySwing(fromPose.x, fromPose.y, fromPose.theta, targetHeading, action.lockedSide);
      pose.x = exactSwing.x;
      pose.y = exactSwing.y;
      pose.theta = targetHeading;
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
    const w = bot.robotW * scale;
    const l = bot.robotL * scale;
    const rad = headingRad(thetaDeg);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(rad);

    if (selected) {
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 3;
      ctx.beginPath();
      drawRoundedRect(ctx, -w / 2 - 3, -l / 2 - 3, w + 6, l + 6, 6);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    drawRoundedRect(ctx, -w / 2, -l / 2, w, l, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.moveTo(l * 0.42, 0);
    ctx.lineTo(l * 0.12, -w * 0.26);
    ctx.lineTo(l * 0.12, w * 0.26);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEndArrow(x, y, thetaDeg) {
    const { cx, cy } = fieldToCanvas(x, y);
    const rad = headingRad(thetaDeg);
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

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (imgReady && fieldImg.naturalWidth) {
      ctx.drawImage(fieldImg, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#1a1f2a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
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
      ctx.fillStyle = sel ? "#60a5fa" : isRev ? "#f97316" : "#3b82f6";
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, sel ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "11px sans-serif";
      ctx.fillText(String(i) + (isRev ? "R" : ""), p.cx + 8, p.cy - 6);
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
        const rad = headingRad(p.theta);
        const dir = p.vLin >= 0 ? 1 : -1;
        const arrowLen = Math.min(32, Math.abs(p.vLin) * 0.35);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cp.cx, cp.cy);
        ctx.lineTo(cp.cx + Math.cos(rad) * arrowLen * dir, cp.cy - Math.sin(rad) * arrowLen * dir);
        ctx.stroke();
      }
    }
  }

  // -- Flowchart UI -------------------------------------------------
  function badgeClass(type) {
    if (type === "custom") return "custom";
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

  function renderFlow() {
    actionFlow.innerHTML = "";
    actions.forEach((a, idx) => {
      const block = document.createElement("div");
      block.className = "action-block";

      const conn = document.createElement("div");
      conn.className = "connector";
      conn.textContent = "▼";
      block.appendChild(conn);

      const card = document.createElement("div");
      card.className =
        "action-card" +
        (a.id === selectedId ? " selected" : "") +
        (a.type === "custom" ? " custom-type" : "");
      card.dataset.id = a.id;

      let body = "";
      if (a.type === "custom") {
        body = `
          <label class="wide">Custom C++ (injected as-is)
            <textarea data-f="customCode" rows="3">${escapeHtml(a.customCode)}</textarea>
          </label>
          <div class="check-row">
            <label><input type="checkbox" data-f="async" ${a.async ? "checked" : ""}/> async (non-blocking)</label>
          </div>`;
      } else {
        const pointFields = needsPoint(a.type)
          ? `<label>X <input type="number" data-f="x" step="0.1" value="${a.x}"/></label>
             <label>Y <input type="number" data-f="y" step="0.1" value="${a.y}"/></label>`
          : "";
        const headField = needsHeading(a.type)
          ? `<label>θ° <input type="number" data-f="theta" step="1" value="${a.theta}"/></label>`
          : "";
        const leadField = a.type === "moveToPose"
          ? `<label title="Boomerang carrot lead multiplier (default 0.6)">Lead
               <input type="number" data-f="lead" min="0" max="1" step="0.05" value="${a.lead != null ? a.lead : 0.6}"/>
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
            ${sideField}
          </div>
          <div class="speed-timeout-row">
            <div class="st-label">Speed &amp; timeout</div>
            <div class="row">
              <label>Max speed (0–127)
                <input type="number" data-f="maxSpeed" min="0" max="127" step="1" value="${a.maxSpeed}"/>
              </label>
              <label>Min speed
                <input type="number" data-f="minSpeed" min="0" max="127" step="1" value="${a.minSpeed}"/>
              </label>
              <label>Timeout (ms)
                <input type="number" data-f="timeout" min="0" step="100" value="${a.timeout}"/>
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
            <label><input type="checkbox" data-f="async" ${a.async ? "checked" : ""}/> async</label>
          </div>
                    <div class="offset-row">
            <div class="label">Code-only offsets (hidden from sim)</div>
            <div class="row">
              <label>ΔX <input type="number" data-f="offsetX" step="0.1" value="${a.offsetX}"/></label>
              <label>ΔY <input type="number" data-f="offsetY" step="0.1" value="${a.offsetY}"/></label>
              <label>Δθ <input type="number" data-f="offsetTheta" step="1" value="${a.offsetTheta}"/></label>
            </div>
          </div>
          <label class="wide" style="margin-top:4px">Label (optional)
            <input type="text" data-f="label" value="${escapeHtml(a.label)}" placeholder="e.g. intake stack"/>
          </label>`;
      }

      card.innerHTML = `
        <div class="card-title">
          <span class="badge ${badgeClass(a.type)}">${idx + 1}. ${a.type}</span>
          ${a.forwards === false && a.type !== "custom" ? '<span class="badge reverse">REV</span>' : ""}
          <span class="hint-inline">${a.label ? escapeHtml(a.label) : ""}</span>
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

      card.querySelectorAll("[data-f]").forEach((el) => {
        el.addEventListener("change", () => {
          const f = el.dataset.f;
          let v;
          if (el.type === "checkbox") {
            // data-invert: checked means the logical opposite (Drive in reverse → forwards=false)
            v = el.dataset.invert ? !el.checked : el.checked;
          } else if (el.type === "number") v = Number(el.value);
          else v = el.value;
          a[f] = v;
          markDirty();
          renderFlow();
          draw();
        });
        el.addEventListener("input", () => {
          if (el.type === "number" || el.tagName === "TEXTAREA" || el.type === "text") {
            const f = el.dataset.f;
            a[f] = el.type === "number" ? Number(el.value) : el.value;
            markDirty();
            if (["x", "y", "theta"].includes(f)) draw();
          }
        });
      });

      card.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
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

  function emitRoutineBody(pose0, acts, indent) {
    const ind = indent || "  ";
    let code = "";
    code += `${ind}chassis.setPose(${num(pose0.x)}, ${num(pose0.y)}, ${num(pose0.theta)});\n`;
    for (const a of acts) {
      if (a.label) code += `${ind}// ${a.label}\n`;
      if (a.type === "custom") {
        const lines = (a.customCode || "").split("\n");
        for (const line of lines) code += `${ind}${line}\n`;
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

      switch (a.type) {
        case "moveToPoint":
          code += `${ind}chassis.moveToPoint(${num(px)}, ${num(py)}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "moveToPose":
          code += `${ind}chassis.moveToPose(${num(px)}, ${num(py)}, ${num(pt)}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "turnToPoint":
          code += `${ind}chassis.turnToPoint(${num(px)}, ${num(py)}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "turnToHeading":
          code += `${ind}chassis.turnToHeading(${num(pt)}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "swingToPoint":
          code += `${ind}chassis.swingToPoint(${num(px)}, ${num(py)}, DriveSide::${a.lockedSide}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "swingToHeading":
          code += `${ind}chassis.swingToHeading(${num(pt)}, DriveSide::${a.lockedSide}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        default:
          code += `${ind}// unknown action ${a.type}\n`;
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

    let code = `// Auto-generated by VEX LemLib Path Planner\n`;
    code += `// Override 2026-27 · inches · heading 0° = +Y, increases clockwise\n`;
    code += `// Bot: trackWidth=${bot.trackWidth}" robot=${bot.robotW}x${bot.robotL}" wheels=${bot.wheelDiam}" @ ${bot.driveRpm}rpm\n`;
    code += `// Default speeds: max=${bot.defaultMaxSpeed} min=${bot.defaultMinSpeed} (per-move overrides in params)\n`;
    code += `// (Configure lemlib::Drivetrain with track width ${bot.trackWidth} in)\n\n`;

    if (mode === "all") {
      code += `// Autonomous selector — call runAuton(slot) from autonomous()\n`;
      code += `// slot: `;
      code += paths.map((p, i) => `${i}=${p.name}`).join(", ") + `\n\n`;

      paths.forEach((p, i) => {
        const fn = "auton_" + sanitizeIdent(p.name);
        code += `void ${fn}() {\n`;
        code += emitRoutineBody(p.pose, p.actions, "  ");
        code += `}\n\n`;
      });

      code += `void runAuton(int slot) {\n`;
      code += `  switch (slot) {\n`;
      paths.forEach((p, i) => {
        const fn = "auton_" + sanitizeIdent(p.name);
        code += `    case ${i}: ${fn}(); break; // ${p.name}\n`;
      });
      code += `    default: auton_${sanitizeIdent(paths[0].name)}(); break;\n`;
      code += `  }\n`;
      code += `}\n\n`;
      code += `// Example:\n// void autonomous() {\n//   runAuton(0); // ${paths[0].name}\n// }\n`;
    } else {
      const p = activePath();
      code += `// Routine: ${p.name}\n\n`;
      code += emitRoutineBody(pose, actions, "");
    }

    codeOut.value = code;
  }

  function estimateActionTime(a, fromPose) {
    if (a.type === "custom") return Math.min(0.35, Math.max(0.1, (a.timeout || 2000) / 1000));
    const res = simulateAction(a, fromPose, bot);
    return res.duration;
  }

  function estimateTotalTime() {
    buildSimPath();
    let total = 0;
    for (const seg of simSegments) {
      if (seg.action.async) {
        total += seg.duration * 0.15;
      } else {
        total += seg.duration;
      }
    }
    return total;
  }

  function updateTimeDisplay(elapsed, totalEst, currentVLin, currentOmegaDeg) {
    const el = document.getElementById("timeEst");
    if (!el) return;
    if (elapsed != null && totalEst != null) {
      let speedText = "";
      if (currentVLin != null && currentOmegaDeg != null) {
        speedText = ` · ${Math.abs(currentVLin).toFixed(1)} in/s · ${Math.abs(currentOmegaDeg).toFixed(0)}°/s`;
      }
      el.textContent = `Time: ${elapsed.toFixed(2)}s / ~${totalEst.toFixed(2)}s${speedText}`;
    } else {
      const t = estimateTotalTime();
      el.textContent = actions.length ? `Est. time: ~${t.toFixed(2)}s (LemLib)` : `Est. time: —`;
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
    if (!actions.length) return;
    buildSimPath();
    simRunning = true;
    simIdx = 0;
    const startTime = performance.now();
    const totalT = simPath.length ? simPath[simPath.length - 1].t : 0;
    const totalEst = estimateTotalTime();

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
        updateTimeDisplay(totalT, totalEst);
        draw();
      }
    }
    animId = requestAnimationFrame(frame);
  }

  function stopSim() {
    simRunning = false;
    if (animId) cancelAnimationFrame(animId);
    draw();
  }

  // -- Hit testing / drag -------------------------------------------
  function hitTest(cx, cy) {
    const s = fieldToCanvas(pose.x, pose.y);
    if (Math.hypot(cx - s.cx, cy - s.cy) < HIT_R + 4) return { kind: "start" };

    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (!needsPoint(a.type) && !isMove(a.type)) continue;
      const p = fieldToCanvas(a.x, a.y);
      if (Math.hypot(cx - p.cx, cy - p.cy) < HIT_R) return { kind: "action", id: a.id };
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
      const a = actions.find((z) => z.id === drag.id);
      if (a) {
        a.x = Number(x.toFixed(1));
        a.y = Number(y.toFixed(1));
        markDirty();
        renderFlow();
        draw();
      }
    }
  });


  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      // allow undo in inputs only with extra care — skip when typing
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

  document.getElementById("btnSim").onclick = startSim;
  document.getElementById("btnStop").onclick = stopSim;
  document.getElementById("simSpeed").oninput = (e) => {
    simSpeed = Number(e.target.value);
    speedLabel.textContent = simSpeed + "×";
  };

  document.getElementById("btnGenerate").onclick = generateCode;
  document.getElementById("btnCopy").onclick = () => {
    codeOut.select();
    navigator.clipboard.writeText(codeOut.value);
  };

  document.getElementById("btnExport").onclick = exportVPath;
  document.getElementById("btnImport").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    if (fileInput.files[0]) importVPath(fileInput.files[0]);
    fileInput.value = "";
  };

  function syncBotInputs() {
    const el = (id) => document.getElementById(id);
    if (el("trackWidth")) el("trackWidth").value = bot.trackWidth;
    if (el("robotW")) el("robotW").value = bot.robotW;
    if (el("robotL")) el("robotL").value = bot.robotL;
    if (el("wheelDiam")) el("wheelDiam").value = bot.wheelDiam;
    if (el("driveRpm")) el("driveRpm").value = bot.driveRpm;
    if (el("defaultMaxSpeed")) el("defaultMaxSpeed").value = bot.defaultMaxSpeed;
    if (el("defaultMinSpeed")) el("defaultMinSpeed").value = bot.defaultMinSpeed;
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
        bot[key] = isNaN(v) ? bot[key] : v;
        markDirty();
        draw();
      });
    });
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

  function updateAuthUI() {
    const btnIn = document.getElementById("btnGoogleSignIn");
    const btnOut = document.getElementById("btnSignOut");
    const userEl = document.getElementById("authUser");
    if (!btnIn) return;
    if (cloudUser) {
      btnIn.hidden = true;
      if (btnOut) btnOut.hidden = false;
      if (userEl) {
        userEl.hidden = false;
        userEl.textContent = cloudUser.displayName || cloudUser.email || "Signed in";
        userEl.title = cloudUser.email || "";
      }
    } else {
      btnIn.hidden = false;
      if (btnOut) btnOut.hidden = true;
      if (userEl) {
        userEl.hidden = true;
        userEl.textContent = "";
      }
      setCloudStatus("");
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
            "Google sign-in is not configured yet.\\n\\n" +
              "1. Create a Firebase project\\n" +
              "2. Enable Google sign-in\\n" +
              "3. Paste web config into firebase-config.js\\n" +
              "4. Set FIREBASE_ENABLED = true\\n\\n" +
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
    } catch (e) {
      console.error(e);
      setCloudStatus("Init failed", "err");
      return;
    }

    const btnIn = document.getElementById("btnGoogleSignIn");
    if (btnIn) {
      btnIn.onclick = async () => {
        try {
          const provider = new firebase.auth.GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          await firebase.auth().signInWithPopup(provider);
        } catch (e) {
          console.error("Google sign-in error:", e);
          if (e && (e.code === "auth/popup-blocked" || e.message?.includes("popup"))) {
            const openTab = confirm(
              "Google Sign-In popup was blocked by the browser or preview iframe.\n\nOpen this app in a new browser tab to complete sign in?"
            );
            if (openTab) {
              window.open(window.location.href, "_blank");
            }
          } else if (e && e.code === "auth/popup-closed-by-user") {
            // Popup closed by user, no error prompt needed
          } else {
            alert("Sign-in failed: " + ((e && e.message) || e));
          }
        }
      };
    }

    const btnOut = document.getElementById("btnSignOut");
    if (btnOut) {
      btnOut.onclick = async () => {
        try {
          await firebase.auth().signOut();
        } catch (e) {
          console.error(e);
        }
      };
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      cloudUser = user;
      updateAuthUI();
      if (user) {
        await cloudLoad();
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


// -- Init ---------------------------------------------------------
  wireBotSettings();
  
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

  const btnNewTab = document.getElementById("btnNewTab");
  if (btnNewTab && window.self !== window.top) {
    btnNewTab.href = window.location.href;
    btnNewTab.style.display = "inline-flex";
  }

  initFirebaseAuth();
})();
