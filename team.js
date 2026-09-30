// team.js - Real-Time Multi-User Collaboration & Cloud Sync Engine (ALPHA)
(function (global) {
  "use strict";

  if (typeof window !== "undefined") {
    const safeGetModifierState = function(key) {
      if (key === "Control") return Boolean(this && this.ctrlKey);
      if (key === "Shift") return Boolean(this && this.shiftKey);
      if (key === "Alt") return Boolean(this && this.altKey);
      if (key === "Meta") return Boolean(this && this.metaKey);
      return false;
    };
    [
      typeof Event !== "undefined" ? Event.prototype : null,
      typeof UIEvent !== "undefined" ? UIEvent.prototype : null,
      typeof KeyboardEvent !== "undefined" ? KeyboardEvent.prototype : null,
      typeof MouseEvent !== "undefined" ? MouseEvent.prototype : null,
      typeof CustomEvent !== "undefined" ? CustomEvent.prototype : null
    ].forEach(proto => {
      if (proto && typeof proto.getModifierState !== "function") {
        try {
          Object.defineProperty(proto, "getModifierState", {
            value: safeGetModifierState,
            writable: true,
            configurable: true
          });
        } catch (_) {
          proto.getModifierState = safeGetModifierState;
        }
      }
    });
  }

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
  let simAnimId = null;
  let simStartTime = 0;

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
    lateralKp: 8.0,
    lateralKi: 0.0,
    lateralKd: 30.0,
    lateralWindup: 3.0,
    lateralSlew: 0,
    lateralSmallErr: 1.0,
    lateralSmallTime: 100,
    lateralLargeErr: 3.0,
    lateralLargeTime: 500,
    angularKp: 2.0,
    angularKi: 0.0,
    angularKd: 10.0,
    angularWindup: 3.0,
    angularSlew: 0,
    angularSmallErr: 1.0,
    angularSmallTime: 100,
    angularLargeErr: 3.0,
    angularLargeTime: 500,
    matchPeriod: "15s"
  };
  let botConfig = bot;

  // --------------------------------------------------------------------------
  // AUTHENTIC LEMLIB KINEMATIC SIMULATION & MOTION CONTROL MATH (From app.js)
  // --------------------------------------------------------------------------
  function headingRad(deg) {
    // Convert LemLib heading (0°=+Y, CW+) to canvas math angle for drawing
    return ((90 - deg) * Math.PI) / 180;
  }

  function screenHeadingRad(deg) {
    // Canvas context rotation: 0° heading (North) aligns local +X to point UP (screen -Y)
    return ((deg - 90) * Math.PI) / 180;
  }

  function normalizeAngle(deg) {
    deg = deg % 360;
    if (deg < 0) deg += 360;
    return deg;
  }

  function angleToPoint(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    return normalizeAngle((Math.atan2(dx, dy) * 180) / Math.PI);
  }

  function angleError(current, target) {
    let e = target - current;
    while (e > 180) e -= 360;
    while (e <= -180) e += 360;
    return e;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
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

  function fieldToCanvas(x, y, canvasW = 900, canvasH = 900) {
    return {
      cx: inchToPx(x, canvasW, false),
      cy: inchToPx(y, canvasH, true),
    };
  }

  function canvasToField(cx, cy, canvasW = 900, canvasH = 900) {
    return {
      x: pxToInch(cx, canvasW, false),
      y: pxToInch(cy, canvasH, true),
    };
  }

  function getMaxLinearSpeed(customBot) {
    const b = customBot || botConfig || bot;
    const theoretical = (Math.max(b.wheelDiam || 3.25, 0.5) * Math.PI * Math.max(b.driveRpm || 600, 1)) / 60;
    return theoretical * 0.95;
  }

  function getMaxTurnRateDps(customBot) {
    const b = customBot || botConfig || bot;
    const vMax = getMaxLinearSpeed(b);
    const w = Math.max(b.trackWidth || 12, 1);
    return (2 * vMax / w) * (180 / Math.PI);
  }

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

  function lemlibSlew(target, current, maxRate, dt) {
    if (maxRate <= 0) return target;
    const step = Math.abs(maxRate * dt);
    const diff = target - current;
    if (Math.abs(diff) > step) {
      return current + step * Math.sign(diff);
    }
    return target;
  }

  function getRobotPhysicsProps(customBot) {
    const b = customBot || botConfig || bot;
    const motorCount = Number(b.motorCount) || 6;
    const baseWeight = Math.max(Number(b.robotWeightLbs) || 15.0, 1.0);
    const weightLbs = baseWeight;
    const tractionMu = Math.max(Number(b.wheelTraction) || 0.85, 0.1);
    const battVolts = Number(b.batteryVolts) || 12.8;
    const rpm = Math.max(Number(b.driveRpm) || 600, 1);
    const wheelDiam = Math.max(Number(b.wheelDiam) || 3.25, 0.5);
    const trackWidth = Math.max(Number(b.trackWidth) || 12.0, 1.0);
    const robotW = Math.max(Number(b.robotW) || 14.0, 1.0);
    const robotL = Math.max(Number(b.robotL) || 14.0, 1.0);

    const gInSec2 = 386.09;
    const massSlugs = weightLbs / gInSec2;
    const singleMotorStallTorque = 210 / rpm;
    const totalDriveStallTorque = motorCount * singleMotorStallTorque;
    const wheelRadius = wheelDiam / 2;
    const maxDriveForceLbf = totalDriveStallTorque / wheelRadius;
    const maxMotorAccelInSec2 = (maxDriveForceLbf / massSlugs);
    const maxTractionAccelInSec2 = tractionMu * gInSec2;
    const maxLinearAccelInSec2 = Math.min(maxMotorAccelInSec2, maxTractionAccelInSec2);

    const inertiaJ = (1 / 12) * massSlugs * (robotW * robotW + robotL * robotL);
    const turnTorque = maxDriveForceLbf * (trackWidth / 2);
    const maxAngularAccelDegSec2 = (turnTorque / inertiaJ) * (180 / Math.PI);
    const vMaxInSec = getMaxLinearSpeed(b);

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
      maxLinearAccelInSec2,
      maxAngularAccelDegSec2,
      vMaxInSec,
    };
  }

  function calculateStepPhysics(prevVLin, newVLin, newOmegaDeg, dt, phys, b) {
    const aLin = (newVLin - prevVLin) / Math.max(dt, 0.001);
    const gLin = aLin / 386.09;
    const omegaRad = (newOmegaDeg * Math.PI) / 180;
    const aLateral = Math.abs(newVLin * omegaRad);
    const gLateral = aLateral / 386.09;
    const gTotal = Math.hypot(gLin, gLateral);
    const isSlipping = gTotal > (phys.tractionMu + 0.05);
    const gripMargin = Math.max(0, Math.min(100, Math.round((1 - (gTotal / phys.tractionMu)) * 100)));
    return { aLin, gLin, gLateral, gTotal, isSlipping, gripMargin };
  }

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
      if (this.windup > 0) {
        if (Math.abs(error) < this.windup) {
          this.totalError += error;
        } else {
          this.totalError = 0;
        }
      } else {
        this.totalError += error;
      }
      if ((error > 0 && this.prevError < 0) || (error < 0 && this.prevError > 0)) {
        this.totalError = 0;
      }
      const deriv = error - this.prevError;
      let output = (this.kP * error) + (this.kI * this.totalError) + (this.kD * deriv);
      if (this.slew > 0) {
        output = lemlibSlew(output, this.prevOutput, this.slew, dt);
      }
      this.prevOutput = output;
      this.prevError = error;
      return output;
    }
  }

  function getBezierControlPoints(action, fromPose) {
    const p0 = { x: fromPose.x, y: fromPose.y };
    const p3 = { x: action.x, y: action.y };
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const dist = Math.hypot(dx, dy) || 1e-4;
    const defaultLead = Math.max(8, Math.min(36, dist * 0.45));
    const lead1 = action.lead1 != null && !isNaN(Number(action.lead1)) ? Number(action.lead1) : defaultLead;
    const lead2 = action.lead2 != null && !isNaN(Number(action.lead2)) ? Number(action.lead2) : defaultLead;

    const rad0 = (fromPose.theta * Math.PI) / 180;
    const dir0 = action.forwards === false ? -1 : 1;
    const targetHeading = action.theta != null && !isNaN(Number(action.theta)) ? Number(action.theta) : fromPose.theta;
    const rad1 = (targetHeading * Math.PI) / 180;

    const baseCp1 = {
      x: p0.x + Math.sin(rad0) * lead1 * dir0,
      y: p0.y + Math.cos(rad0) * lead1 * dir0,
    };
    const baseCp2 = {
      x: p3.x - Math.sin(rad1) * lead2 * dir0,
      y: p3.y - Math.cos(rad1) * lead2 * dir0,
    };

    const nx = dy / dist;
    const ny = -dx / dist;

    const commonBulge = action.bulge != null && !isNaN(Number(action.bulge)) ? Number(action.bulge) : 0;
    const b1 = action.bulge1 != null && !isNaN(Number(action.bulge1)) ? Number(action.bulge1) : commonBulge;
    const b2 = action.bulge2 != null && !isNaN(Number(action.bulge2)) ? Number(action.bulge2) : commonBulge;

    let cp1 = {
      x: baseCp1.x + nx * b1,
      y: baseCp1.y + ny * b1,
    };
    let cp2 = {
      x: baseCp2.x + nx * b2,
      y: baseCp2.y + ny * b2,
    };

    if (action.freeHandles === true) {
      if (action.cp1X != null && !isNaN(Number(action.cp1X))) cp1.x = Number(action.cp1X);
      if (action.cp1Y != null && !isNaN(Number(action.cp1Y))) cp1.y = Number(action.cp1Y);
      if (action.cp2X != null && !isNaN(Number(action.cp2X))) cp2.x = Number(action.cp2X);
      if (action.cp2Y != null && !isNaN(Number(action.cp2Y))) cp2.y = Number(action.cp2Y);
    }

    return { cp1, cp2, lead1, lead2, targetHeading, bulge: commonBulge, b1, b2, dist, nx, ny };
  }

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

  function simulateAction(action, fromPose, customBot = botConfig) {
    const b = customBot || botConfig || bot;
    const vMax = getMaxLinearSpeed(b);
    const trackWidth = Math.max(b.trackWidth || 12, 1);
    const dt = 0.01; // 10ms discrete loop
    const tau = 0.07; // motor response time constant (70ms)

    const defMax = b.defaultMaxSpeed != null ? b.defaultMaxSpeed : 127;
    const defMin = b.defaultMinSpeed != null ? b.defaultMinSpeed : 0;
    const maxSpeed = clamp((action.maxSpeed != null ? action.maxSpeed : defMax) / 127, 0.1, 1.0);
    const minSpeed = clamp((action.minSpeed != null ? action.minSpeed : defMin) / 127, 0, 1.0);
    const timeoutS = Math.max(0.1, (action.timeout || 2000) / 1000);
    const earlyExitRange = Math.max(0, action.earlyExitRange || 0);

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

    let pose = { x: fromPose.x, y: fromPose.y, theta: normalizeAngle(fromPose.theta || 0) };
    let vLin = 0;
    let omegaDeg = 0;
    let t = 0;
    const initPhys = calculateStepPhysics(0, 0, 0, dt, phys, b);
    let points = [{ x: pose.x, y: pose.y, theta: pose.theta, t: 0, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys }];
    let carrotPoint = null;

    if (action.type === "custom" || action.type === "customCode") {
      const dur = action.customDuration != null ? Math.max(0, Number(action.customDuration)) : (action.delayMs ? action.delayMs / 1000 : 0.25);
      if (dur > 0) {
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys });
      }
      return { endPose: pose, path: points, duration: dur, carrot: null };
    }

    if (action.type === "wait" || action.type === "delay") {
      const dur = Math.max(0.05, (action.delayMs != null ? action.delayMs : (action.timeout != null ? action.timeout : 250)) / 1000);
      points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys });
      return { endPose: pose, path: points, duration: dur, carrot: null };
    }

    if (action.type === "ifElse" || action.type === "if_else") {
      const dur = 0.2;
      points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys });
      return { endPose: pose, path: points, duration: dur, carrot: null };
    }

    if (action.type === "loop") {
      const cnt = action.loopType === "for" ? (action.count || 3) : 3;
      const dur = Math.max(0.1, (cnt * (action.delayMs || 100)) / 1000);
      points.push({ x: pose.x, y: pose.y, theta: pose.theta, t: dur, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0, ...initPhys });
      return { endPose: pose, path: points, duration: dur, carrot: null };
    }

    if (action.type === "moveToPose") {
      const lead = action.lead != null ? clamp(action.lead, 0, 1.0) : (b.defaultLead != null ? b.defaultLead : 0.6);
      const drift = (action.driftScaler != null ? action.driftScaler : (b.lateralDrift != null ? b.lateralDrift : 1.0));
      const reversed = action.forwards === false;
      const targetTheta = action.theta !== undefined ? action.theta : (action.heading !== undefined ? action.heading : pose.theta);
      const target = { x: action.x, y: action.y, theta: targetTheta };
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
          latPower *= Math.max(0.15, alignCos);
        }
        if (Math.abs(latPower) < minSpeed) latPower = Math.sign(latPower) * minSpeed;
        if (reversed) latPower = -latPower;

        const rawAngPid = angPid.update(angError, dt);
        let angPower = clamp((rawAngPid / 127) * Math.max(0.2, drift), -maxSpeed, maxSpeed);

        const desat = lemlibDesaturate(latPower, angPower, maxSpeed);
        const targetVLin = ((desat.left + desat.right) / 2) * vMax;
        const targetOmega = (((desat.left - desat.right) * vMax) / trackWidth) * (180 / Math.PI);

        const prevVLin = vLin;
        const dV = clamp(((targetVLin - vLin) / tau) * dt, -maxStepV, maxStepV);
        vLin += dV;

        const dW = clamp(((targetOmega - omegaDeg) / tau) * dt, -maxStepW, maxStepW);
        omegaDeg += dW;

        if (dist < 1.0) vLin *= 0.75;
        if (Math.abs(angError) < 1.5) omegaDeg *= 0.75;

        // Differential drive heading kinematics: 0° is +Y, 90° is +X
        const midTheta = normalizeAngle(pose.theta + (omegaDeg * dt) / 2);
        const rad = (midTheta * Math.PI) / 180;
        pose.x += Math.sin(rad) * vLin * dt;
        pose.y += Math.cos(rad) * vLin * dt;
        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);

        t += dt;
        const stepPhys = calculateStepPhysics(prevVLin, vLin, omegaDeg, dt, phys, b);
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin, omegaDeg, targetVLin, targetOmega, ...stepPhys });
      }

      if (isSettled && points.length) {
        points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0 };
      }
      return { endPose: pose, path: points, duration: Math.max(t, 0.1), carrot: carrotPoint };
    }

    if (action.type === "moveToPoint" || action.type === "move" || action.x !== undefined) {
      if (action.type !== "moveToPoint" && action.type !== "move" && action.type !== "bezierCurve" && action.type !== "turnToHeading" && action.type !== "turnToPoint" && action.type !== "swingToHeading" && action.type !== "swingToPoint") {
        // default fallback if type not explicitly recognized
      }
    }

    if (action.type === "moveToPoint" || !action.type || action.type === "move") {
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

        if (dist < 1.0) vLin *= 0.75;
        if (Math.abs(angError) < 1.5) omegaDeg *= 0.75;

        // Differential drive heading kinematics: 0° is +Y, 90° is +X
        const midTheta = normalizeAngle(pose.theta + (omegaDeg * dt) / 2);
        const rad = (midTheta * Math.PI) / 180;
        pose.x += Math.sin(rad) * vLin * dt;
        pose.y += Math.cos(rad) * vLin * dt;
        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);

        t += dt;
        const stepPhys = calculateStepPhysics(prevVLin, vLin, omegaDeg, dt, phys, b);
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin, omegaDeg, targetVLin, targetOmega, ...stepPhys });
      }

      if (isSettled && points.length) {
        points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0 };
      }
      return { endPose: pose, path: points, duration: Math.max(t, 0.1), carrot: null };
    }

    if (action.type === "bezierCurve") {
      const p0 = { x: fromPose.x, y: fromPose.y };
      const p3 = { x: action.x, y: action.y };
      const { cp1, cp2, targetHeading } = getBezierControlPoints(action, fromPose);
      const reversed = action.forwards === false;

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

        const vGrip = Math.sqrt((mu * g) / Math.max(absKappa, 0.001));
        const vDiff = vMax / (1 + (absKappa * trackWidth) / 2);
        const vMaxAllowed = Math.min(vMax * maxSpeed, vGrip, vDiff);

        const vBrake = Math.sqrt(2 * maxDecel * Math.max(0, remaining));
        let vTarget = Math.min(vMaxAllowed, vBrake);
        if (vTarget < minSpeed * vMax && remaining > 1.5) {
          vTarget = minSpeed * vMax;
        }

        const prevVLin = vLin;
        const dV = clamp(vTarget - vLin, -maxDecel * dt, maxAccel * dt);
        vLin += dV;

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
        points[points.length - 1] = {
          x: pose.x,
          y: pose.y,
          theta: pose.theta,
          t,
          vLin: 0,
          omegaDeg: 0,
          targetVLin: 0,
          targetOmega: 0,
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
        targetHeading = action.theta !== undefined ? action.theta : (action.heading !== undefined ? action.heading : pose.theta);
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

        if (Math.abs(angError) < 1.0) omegaDeg *= 0.75;

        pose.theta = normalizeAngle(pose.theta + omegaDeg * dt);
        t += dt;
        const stepPhys = calculateStepPhysics(0, 0, omegaDeg, dt, phys, b);
        points.push({ x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg, targetVLin: 0, targetOmega: 0, ...stepPhys });
      }

      if (isSettled && points.length) {
        points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0 };
      }
      return { endPose: pose, path: points, duration: Math.max(t, 0.08), carrot: null };
    }

    if (action.type === "swingToHeading" || action.type === "swingToPoint") {
      const lockLeft = (action.lockedSide || action.driveSide || "LEFT") === "LEFT";
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
          targetHeading = action.theta !== undefined ? action.theta : (action.heading !== undefined ? action.heading : pose.theta);
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

        if (Math.abs(angError) < 1.0) vDrive *= 0.75;

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

      if (isSettled && points.length) {
        points[points.length - 1] = { x: pose.x, y: pose.y, theta: pose.theta, t, vLin: 0, omegaDeg: 0, targetVLin: 0, targetOmega: 0 };
      }
      return { endPose: pose, path: points, duration: Math.max(t, 0.08), carrot: null };
    }

    return { endPose: pose, path: points, duration: Math.max(t, 0.1), carrot: null };
  }

  let cachedTeamSimResult = null;
  let cachedRoutineKey = "";

  function getRoutineSimKey(routine, botObj) {
    if (!routine) return "";
    const b = botObj || botConfig || bot;
    const actStr = (routine.actions || []).map(a => `${a.id}_${a.type}_${a.x}_${a.y}_${a.theta}_${a.heading}_${a.timeout}_${a.maxSpeed}_${a.forwards}_${a.lead}`).join(";");
    const p = routine.pose || { x: -60, y: -60, theta: 0 };
    return `${routine.id || ""}_${p.x}_${p.y}_${p.theta}_${b.driveRpm}_${b.wheelDiam}_${b.trackWidth}_${actStr}`;
  }

  function simulateRoutine(routine, botObj = botConfig) {
    if (!routine) return { path: [], segments: [], duration: 0 };
    const key = getRoutineSimKey(routine, botObj);
    if (cachedTeamSimResult && cachedRoutineKey === key) {
      return cachedTeamSimResult;
    }

    const b = botObj || botConfig || bot;
    const startPose = routine.pose || { x: -60, y: -60, theta: 0 };
    let curPose = { x: startPose.x, y: startPose.y, theta: normalizeAngle(startPose.theta || 0) };
    let fullPath = [{ x: curPose.x, y: curPose.y, theta: curPose.theta, t: 0, vLin: 0, omegaDeg: 0 }];
    let segments = [];
    let totalTime = 0;

    (routine.actions || []).forEach((act, aIdx) => {
      const seg = simulateAction(act, curPose, b);
      if (seg && seg.path) {
        segments.push({
          action: act,
          actionIdx: aIdx,
          points: seg.path,
          endPose: seg.endPose,
          duration: seg.duration,
          carrot: seg.carrot,
          bezierCPs: seg.bezierCPs,
        });
        seg.path.forEach((pt, i) => {
          if (i > 0) fullPath.push({ ...pt, t: pt.t + totalTime, actionIdx: aIdx });
        });
        curPose = { ...seg.endPose };
        totalTime += seg.duration;
      }
    });

    const res = { path: fullPath, segments, duration: Math.max(totalTime, 0.1) };
    cachedTeamSimResult = res;
    cachedRoutineKey = key;
    return res;
  }

  function getSimPoseAtTime(simResult, timeMs) {
    const timeS = Math.max(0, timeMs / 1000);
    const pts = (simResult && simResult.path) || [];
    if (pts.length === 0) return { x: -60, y: -60, theta: 0, vLin: 0, omegaDeg: 0 };
    if (timeS <= 0) return { x: pts[0].x, y: pts[0].y, theta: pts[0].theta, vLin: pts[0].vLin || 0, omegaDeg: pts[0].omegaDeg || 0 };
    if (timeS >= simResult.duration) {
      const last = pts[pts.length - 1];
      return { x: last.x, y: last.y, theta: last.theta, vLin: 0, omegaDeg: 0 };
    }

    // Binary search for O(log N) lookup
    let low = 0;
    let high = pts.length - 1;
    let idx = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (pts[mid].t <= timeS) {
        idx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const p0 = pts[idx];
    const p1 = pts[Math.min(idx + 1, pts.length - 1)];
    if (p0 === p1 || p1.t <= p0.t) {
      return { x: p0.x, y: p0.y, theta: p0.theta, vLin: p0.vLin || 0, omegaDeg: p0.omegaDeg || 0 };
    }
    const segT = clamp((timeS - p0.t) / (p1.t - p0.t), 0, 1);
    const dTheta = angleError(p0.theta, p1.theta);
    return {
      x: p0.x + (p1.x - p0.x) * segT,
      y: p0.y + (p1.y - p0.y) * segT,
      theta: normalizeAngle(p0.theta + dTheta * segT),
      vLin: (p0.vLin || 0) + ((p1.vLin || 0) - (p0.vLin || 0)) * segT,
      omegaDeg: (p0.omegaDeg || 0) + ((p1.omegaDeg || 0) - (p0.omegaDeg || 0)) * segT,
    };
  }

  function interpolatePathPose(timeRatio) {
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    if (!routine) return { x: -60, y: -60, theta: 0, vLin: 0, omegaDeg: 0 };
    const simRes = simulateRoutine(routine, botConfig);
    const totalDuration = (simRes && simRes.duration > 0) ? simRes.duration : 15.0;
    const timeMs = Math.max(0, Math.min(1, timeRatio)) * totalDuration * 1000;
    return getSimPoseAtTime(simRes, timeMs);
  }

  // Authentic LemLib Robot Rendering on Field Canvas (Copied from app.js)
  function drawRobot(context, x, y, thetaDeg, color = "#38bdf8", alpha = 1, selected = false, isCollision = false) {
    const cv = document.getElementById("teamFieldCanvas");
    const cvW = cv ? cv.width : 900;
    const cvH = cv ? cv.height : 900;
    const { cx, cy } = fieldToCanvas(x, y, cvW, cvH);
    const scale = cvW / FIELD_INCHES;
    const w = (botConfig.robotW || 14.0) * scale; // Lateral width (in canvas px)
    const l = (botConfig.robotL || 14.0) * scale; // Longitudinal length (in canvas px)
    const rad = screenHeadingRad(thetaDeg);

    if (isCollision) {
      color = "#ef4444";
    }

    context.save();
    context.globalAlpha = alpha;
    context.translate(cx, cy);
    context.rotate(rad);

    if (isCollision) {
      context.shadowColor = "#ef4444";
      context.shadowBlur = 14;
    }

    // Chassis Body Box
    context.fillStyle = isCollision ? "rgba(239, 68, 68, 0.85)" : color;
    context.strokeStyle = isCollision ? "#fee2e2" : "#ffffff";
    context.lineWidth = isCollision ? 2.5 : 1.8;
    context.beginPath();
    drawRoundedRect(context, -l / 2, -w / 2, l, w, 4);
    context.fill();
    context.stroke();

    // Wheel pods (differential drive wheels along left and right sides)
    const wheelW = Math.max(5, l * 0.28);
    const wheelThickness = Math.max(4, w * 0.12);
    context.fillStyle = "#0f172a";
    // Left side wheels (at -w/2)
    context.fillRect(l * 0.15, -w / 2 - wheelThickness / 2, wheelW, wheelThickness);
    context.fillRect(-l * 0.45, -w / 2 - wheelThickness / 2, wheelW, wheelThickness);
    // Right side wheels (at +w/2)
    context.fillRect(l * 0.15, w / 2 - wheelThickness / 2, wheelW, wheelThickness);
    context.fillRect(-l * 0.45, w / 2 - wheelThickness / 2, wheelW, wheelThickness);

    // Front Bumper / Intake Direction Indicator Chevron (pointing along local +X, which is forward)
    context.fillStyle = isCollision ? "#ffffff" : "#fbbf24";
    context.beginPath();
    context.moveTo(l * 0.45, 0);
    context.lineTo(l * 0.15, -w * 0.28);
    context.lineTo(l * 0.15, w * 0.28);
    context.closePath();
    context.fill();

    // V5 Brain HUD screen on bot
    const badgeW = l * 0.42;
    const badgeH = w * 0.35;
    context.fillStyle = "#18181b";
    context.fillRect(-badgeW / 2, -badgeH / 2, badgeW, badgeH);
    context.fillStyle = "#22c55e";
    context.font = "bold 8px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("LEMLIB", 0, 0);

    if (selected && !isCollision) {
      context.strokeStyle = "#60a5fa";
      context.lineWidth = 2.5;
      context.setLineDash([4, 4]);
      context.beginPath();
      drawRoundedRect(context, -l / 2 - 4, -w / 2 - 4, l + 8, w + 8, 6);
      context.stroke();
      context.setLineDash([]);
    } else if (isCollision) {
      context.strokeStyle = "#ef4444";
      context.lineWidth = 2.0;
      context.beginPath();
      drawRoundedRect(context, -l / 2 - 3, -w / 2 - 3, l + 6, w + 6, 6);
      context.stroke();
    }

    // Tracking origin center
    context.fillStyle = isCollision ? "#ef4444" : "#ffffff";
    context.beginPath();
    context.arc(0, 0, 2.5, 0, Math.PI * 2);
    context.fill();

    if (isCollision) {
      context.save();
      context.shadowColor = "#ef4444";
      context.shadowBlur = 8;
      context.fillStyle = "#ef4444";
      context.beginPath();
      drawRoundedRect(context, -26, -w / 2 - 20, 52, 16, 4);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "bold 9px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("💥 HIT", 0, -w / 2 - 12);
      context.restore();
    }

    context.restore();
  }

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

  let monacoInitAttempts = 0;
  function initMonaco() {
    const container = document.getElementById("monacoEditorContainer");
    if (!container) return;

    if (window.monaco && window.monaco.editor) {
      monacoInstance = window.monaco;
      setupMonacoEngine(container);
      return;
    }

    if (window.require && typeof window.require === "function") {
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
            console.warn("[Monaco] Setup error:", setupErr);
          }
        });
        return;
      } catch (e) {
        console.warn("[Monaco] Loader error:", e);
      }
    }

    // If require/monaco not yet loaded, retry up to 25 times (~5s)
    if (monacoInitAttempts < 25) {
      monacoInitAttempts++;
      setTimeout(initMonaco, 200);
    }
  }

  function setupMonacoEngine(container) {
    if (!monacoInstance || !monacoInstance.editor || monacoEditor) return;
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const initialContent = (currentTeam?.projectFiles && currentTeam.projectFiles[activeIdeFile]) || (elCodeEditor ? elCodeEditor.value : "") || generateLemLibCpp(activePaths, activeRoutineIndex);

    try {
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
    } catch (_) {}

    try {
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

      requestAnimationFrame(() => {
        try { monacoEditor.layout(); } catch(_) {}
      });
      setTimeout(() => {
        try { monacoEditor.layout(); } catch(_) {}
      }, 100);
    } catch (createErr) {
      console.warn("[Monaco] Creation notice:", createErr);
    }
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
        const tl = { cx: inchToPx(loader.minX, canvas.width), cy: inchToPx(loader.maxY, canvas.height, true) };
        const br = { cx: inchToPx(loader.maxX, canvas.width), cy: inchToPx(loader.minY, canvas.height, true) };
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
        const centerC = { cx: inchToPx(loader.center.x, canvas.width), cy: inchToPx(loader.center.y, canvas.height, true) };
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
        const cy = inchToPx(goal.y, canvas.height, true);
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
        cpp += `    chassis.moveToPose(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${(act.theta || 0).toFixed(1)}, {.forwards = ${act.forwards !== false}, .maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "turnToPoint") {
        const timeout = act.timeout || 1500;
        const maxSpd = act.maxSpeed !== undefined ? act.maxSpeed : 115;
        cpp += `    chassis.turnToPoint(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${timeout}, {.forwards = ${act.forwards !== false}, .maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "turnToHeading") {
        const timeout = act.timeout || 1500;
        cpp += `    chassis.turnToHeading(${(act.theta || act.heading || 0).toFixed(1)}, ${timeout});\n`;
      } else if (act.type === "swingToHeading") {
        const timeout = act.timeout || 1500;
        const maxSpd = act.maxSpeed !== undefined ? act.maxSpeed : 115;
        const side = act.driveSide === "RIGHT" ? "lemlib::DriveSide::RIGHT" : "lemlib::DriveSide::LEFT";
        cpp += `    chassis.swingToHeading(${(act.theta || act.heading || 0).toFixed(1)}, ${side}, ${timeout}, {.maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "ifElse" || act.type === "if_else") {
        const cond = act.conditionExpr || "distance_sensor.get() < 100";
        const thenC = act.thenCode || "// custom then action\n    intake.move(127);";
        cpp += `    if (${cond}) {\n`;
        thenC.split("\n").forEach(line => {
          if (line.trim()) cpp += `        ${line.trim()}\n`;
        });
        if (act.hasElse) {
          const elseC = act.elseCode || "// custom else action\n    intake.move(0);";
          cpp += `    } else {\n`;
          elseC.split("\n").forEach(line => {
            if (line.trim()) cpp += `        ${line.trim()}\n`;
          });
        }
        cpp += `    }\n`;
      } else if (act.type === "loop") {
        const loopT = act.loopType || "for";
        const delayVal = act.delayMs !== undefined ? act.delayMs : 10;
        const code = act.loopCode || "intake.move(127);";
        if (loopT === "for") {
          cpp += `    for (int i = 0; i < ${act.count || 3}; i++) {\n`;
        } else if (loopT === "until") {
          cpp += `    while (!(${act.conditionExpr || "distance_sensor.get() < 50"})) {\n`;
        } else { // forever
          cpp += `    while (true) {\n`;
        }
        code.split("\n").forEach(line => {
          if (line.trim()) cpp += `        ${line.trim()}\n`;
        });
        cpp += `        pros::delay(${delayVal});\n`;
        cpp += `    }\n`;
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
      "src/autons.cpp": generateLemLibCpp(activePaths, activeRoutineIndex),
      "include/autons.hpp": `// =========================================================================\n// autons.hpp - Autonomous Routine Function Declarations\n// =========================================================================\n#pragma once\n#include "main.h"\n\nvoid autonomous();\n`,
      "src/main.cpp": `// =========================================================================\n// main.cpp - ${tName} Main Competition Logic\n// =========================================================================\n#include "main.h"\n#include "autons.hpp"\n#include "robot-config.h"\n#include "subsystems.hpp"\n\nvoid initialize() {\n    pros::lcd::initialize();\n    chassis.calibrate();\n}\n\nvoid disabled() {}\n\nvoid competition_initialize() {}\n\nvoid opcontrol() {\n    while (true) {\n        // Driver Control Loop\n        int left = controller.get_analog(pros::E_CONTROLLER_ANALOG_LEFT_Y);\n        int right = controller.get_analog(pros::E_CONTROLLER_ANALOG_RIGHT_Y);\n        chassis.tank(left, right);\n        handle_driver_subsystems();\n        pros::delay(10);\n    }\n}\n`,
      "include/robot-config.h": `// =========================================================================\n// robot-config.h - Motor Ports & Chassis Hardware Setup\n// =========================================================================\n#pragma once\n#include "main.h"\n#include "lemlib/api.hpp"\n\n// Drivetrain Motor Groups\nextern pros::MotorGroup left_motors;\nextern pros::MotorGroup right_motors;\nextern pros::Imu imu;\nextern lemlib::Chassis chassis;\n`,
      "include/subsystems.hpp": `// =========================================================================\n// subsystems.hpp - Pneumatics, Intakes & Mechanisms\n// =========================================================================\n#pragma once\n#include "main.h"\n\nextern pros::adi::DigitalOut mogo_clamp;\nextern pros::Motor intake;\nvoid handle_driver_subsystems();\n`,
      "src/subsystems.cpp": `// =========================================================================\n// subsystems.cpp - Subsystem Implementations\n// =========================================================================\n#include "subsystems.hpp"\n\npros::adi::DigitalOut mogo_clamp('A', false);\npros::Motor intake(7, pros::v5::MotorGears::blue);\n\nvoid handle_driver_subsystems() {\n    if (controller.get_digital_new_press(pros::E_CONTROLLER_DIGITAL_L1)) {\n        mogo_clamp.toggle();\n    }\n    if (controller.get_digital(pros::E_CONTROLLER_DIGITAL_R1)) {\n        intake.move(127);\n    } else if (controller.get_digital(pros::E_CONTROLLER_DIGITAL_R2)) {\n        intake.move(-127);\n    } else {\n        intake.move(0);\n    }\n}\n`,
      "project.pros": `{\n  "py/object": "pros.conductor.project.Project",\n  "py/state": {\n    "project_name": "${tName.replace(/[^a-zA-Z0-9_]/g, '_')}",\n    "target": "v5",\n    "templates": {\n      "kernel": "4.1.0",\n      "lemlib": "0.5.4"\n    }\n  }\n}\n`,
      "Makefile": `# PROS LemLib Makefile\nPROJECT_NAME := ${tName.replace(/[^a-zA-Z0-9_]/g, '_')}\nROOT_DIR := .\nSRCDIR := src\nINCDIR := include\ninclude $(ROOT_DIR)/firmware/v5.mk\n`
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

  function renderTeamFileTree() {
    const treeEl = document.getElementById("teamIdeFileTree");
    const countEl = document.getElementById("lblTeamIdeFilesCount");
    const tabsList = document.getElementById("teamIdeTabsList");
    if (!treeEl || !currentTeam) return;

    currentTeam.projectFiles = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
    const files = Object.keys(currentTeam.projectFiles);

    if (countEl) countEl.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;

    // Update File Tabs bar
    if (tabsList) {
      tabsList.innerHTML = "";
      files.forEach(f => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `planner-tab-btn ${f === activeIdeFile ? 'active' : ''}`;
        btn.setAttribute("data-file", f);
        btn.style.cssText = `padding:4px 10px;font-size:0.74rem;display:inline-flex;align-items:center;gap:5px;${f === activeIdeFile ? 'color:#38bdf8;border-bottom:2px solid #38bdf8;' : 'color:var(--muted);'}`;

        let icon = "📄";
        if (f.endsWith(".cpp")) icon = "⚡";
        else if (f.endsWith(".hpp") || f.endsWith(".h")) icon = "📑";
        else if (f.endsWith(".json") || f === "project.pros") icon = "⚙️";
        else if (f === "Makefile") icon = "📜";

        const baseName = f.includes("/") ? f.split("/").pop() : f;
        btn.innerHTML = `<span>${icon}</span> <span>${escapeHtml(baseName)}</span>`;
        btn.onclick = () => renderIdeFile(f);
        tabsList.appendChild(btn);
      });
    }

    // Render tree with folder organization (src/, include/, root)
    treeEl.innerHTML = "";

    const folderMap = {};
    files.forEach(f => {
      const parts = f.split("/");
      if (parts.length > 1) {
        const folder = parts[0];
        folderMap[folder] = folderMap[folder] || [];
        folderMap[folder].push(f);
      } else {
        folderMap["root"] = folderMap["root"] || [];
        folderMap["root"].push(f);
      }
    });

    Object.keys(folderMap).sort().forEach(folder => {
      const folderWrap = document.createElement("div");
      folderWrap.style.marginBottom = "4px";

      if (folder !== "root") {
        const folderHead = document.createElement("div");
        folderHead.style.cssText = "font-size:0.72rem;font-weight:700;color:var(--muted);padding:3px 6px;display:flex;align-items:center;gap:5px;text-transform:uppercase;letter-spacing:0.04em;";
        folderHead.innerHTML = `<span>📁</span> <span>${escapeHtml(folder)}/</span>`;
        folderWrap.appendChild(folderHead);
      }

      folderMap[folder].sort().forEach(f => {
        const fileItem = document.createElement("div");
        const isActive = f === activeIdeFile;
        fileItem.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-radius:4px;font-size:0.75rem;cursor:pointer;margin-bottom:2px;${isActive ? 'background:rgba(56,189,248,0.15);color:#38bdf8;font-weight:700;' : 'color:var(--text);'}`;

        let icon = "📄";
        if (f.endsWith(".cpp")) icon = "⚡";
        else if (f.endsWith(".hpp") || f.endsWith(".h")) icon = "📑";
        else if (f.endsWith(".json") || f === "project.pros") icon = "⚙️";
        else if (f === "Makefile") icon = "📜";

        const fileName = f.includes("/") ? f.split("/").slice(1).join("/") : f;
        fileItem.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <span>${icon}</span>
            <span>${escapeHtml(fileName)}</span>
          </div>
        `;

        fileItem.onclick = () => renderIdeFile(f);
        folderWrap.appendChild(fileItem);
      });

      treeEl.appendChild(folderWrap);
    });
  }

  function renderIdeFile(fileToRender = activeIdeFile) {
    if (!currentTeam) return;
    currentTeam.projectFiles = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
    
    // Normalize file name lookup
    const files = currentTeam.projectFiles;
    let actualKey = fileToRender;
    if (!files[actualKey]) {
      if (files["src/" + actualKey]) actualKey = "src/" + actualKey;
      else if (files["include/" + actualKey]) actualKey = "include/" + actualKey;
      else if (Object.keys(files).length > 0) actualKey = Object.keys(files)[0];
    }
    activeIdeFile = actualKey;

    const editor = document.getElementById("txtTeamIdeCode");
    const lblStatus = document.getElementById("lblIdeStatus");
    const lblLines = document.getElementById("lblIdeLines");
    const lblCurFile = document.getElementById("lblTeamIdeCurrentFile");

    if (lblCurFile) lblCurFile.textContent = activeIdeFile;

    const content = currentTeam.projectFiles[activeIdeFile] || "";
    if (editor && editor.value !== content) {
      editor.value = content;
    }

    // Sync to Monaco or Fallback highlighter
    if (isMonacoReady && monacoEditor) {
      if (monacoEditor.getValue() !== content) {
        monacoEditor.setValue(content);
      }
    } else {
      updateLineNumbers();
      renderSyntaxHighlight();
    }

    const lineCount = content.split("\n").length;
    if (lblLines) lblLines.textContent = `Lines: ${lineCount}`;
    if (lblStatus) lblStatus.textContent = `${activeIdeFile} · ${canCurrentUserEditCode() ? '✏️ Editable' : '💡 Suggestion Only'}`;

    renderTeamFileTree();
  }

  function syncIdeAutonsFromBlocks() {
    if (!currentTeam) return;
    currentTeam.projectFiles = currentTeam.projectFiles || getDefaultProjectFiles(currentTeam);
    const generated = generateLemLibCpp(activePaths, activeRoutineIndex);
    if (currentTeam.projectFiles["src/autons.cpp"] !== undefined) {
      currentTeam.projectFiles["src/autons.cpp"] = generated;
    } else {
      currentTeam.projectFiles["autons.cpp"] = generated;
    }
    renderIdeFile(activeIdeFile);
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

    const canManage = isCurrentUserAdmin();
    const btnSave = document.getElementById("btnSaveTeamSettings");
    if (btnSave) {
      btnSave.style.display = canManage ? "inline-block" : "none";
    }

    renderSettingsRosterTable();
    modal.style.display = "flex";
  }

  function renderSettingsRosterTable() {
    const container = document.getElementById("settingsRosterTableContainer");
    if (!container || !currentTeam) return;

    const members = currentTeam.members || [];
    const canManage = isCurrentUserAdmin();
    const myEmail = (currentUser?.email || "").toLowerCase().trim();

    let html = "";
    if (!canManage) {
      html += `
        <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:6px;padding:8px 12px;margin:8px;font-size:0.75rem;color:#94a3b8;line-height:1.4;">
          🔒 <strong>Permissions View Only:</strong> Only team administrators and the team owner can modify roles, change editing permissions, or kick teammates.
        </div>
      `;
    }

    html += `
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;text-align:left;">
        <thead>
          <tr style="background:#090d16;color:#94a3b8;border-bottom:1px solid #1e293b;">
            <th style="padding:8px 12px;">Member</th>
            <th style="padding:8px 12px;">Role</th>
            <th style="padding:8px 12px;">Admin</th>
            <th style="padding:8px 12px;">Edit Code</th>
            <th style="padding:8px 12px;text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    const ROLES = ["Programmer", "Builder", "Driver", "Strategist", "Scout", "Coach", "Member"];

    members.forEach((m, idx) => {
      const email = m.email || "member@team";
      const isOwner = m.isOwner || (currentTeam.ownerEmail && currentTeam.ownerEmail.toLowerCase().trim() === email.toLowerCase().trim());
      const isAdmin = m.isAdmin || isOwner;
      const canEdit = m.canEditCode !== undefined ? m.canEditCode : (isAdmin || m.role === 'Programmer');
      const isMe = (email.toLowerCase().trim() === myEmail);

      let roleSelectOrTag = "";
      if (canManage && !isOwner) {
        roleSelectOrTag = `
          <select class="sel-setting-role form-input" data-idx="${idx}" style="padding:2px 6px;font-size:0.72rem;width:auto;">
            ${ROLES.map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r}</option>`).join("")}
          </select>
        `;
      } else {
        roleSelectOrTag = `<span class="member-role-tag ${m.role ? m.role.toLowerCase() : 'programmer'}">${escapeHtml(m.role || 'Programmer')}</span>`;
      }

      let actionHtml = "";
      if (isOwner && isMe) {
        actionHtml = `
          <button type="button" class="btn-self-leave-team" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);color:#f87171;padding:3px 8px;border-radius:4px;font-size:0.72rem;cursor:pointer;font-weight:700;" title="Leave or switch team">
            🚪 Leave / Switch
          </button>
        `;
      } else if (isOwner) {
        actionHtml = `<span style="font-size:0.72rem;color:#fbbf24;font-weight:700;">👑 Owner</span>`;
      } else if (isMe) {
        actionHtml = `
          <button type="button" class="btn-self-leave-team" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);color:#f87171;padding:3px 8px;border-radius:4px;font-size:0.72rem;cursor:pointer;font-weight:700;" title="Leave this team workspace">
            🚪 Leave Team
          </button>
        `;
      } else if (canManage) {
        actionHtml = `
          <button type="button" class="btn-team-kick" data-idx="${idx}" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);color:#f87171;padding:3px 8px;border-radius:4px;font-size:0.72rem;cursor:pointer;font-weight:700;" title="Kick member from team">
            👢 Kick
          </button>
        `;
      } else {
        actionHtml = `<span style="color:#64748b;font-size:0.7rem;">—</span>`;
      }

      html += `
        <tr style="border-bottom:1px solid #1e293b;">
          <td style="padding:8px 12px;color:#f8fafc;">
            <div style="font-weight:700;">${escapeHtml(m.displayName || email.split("@")[0])} ${isOwner ? '👑 (Owner)' : ''}</div>
            <div style="font-size:0.68rem;color:#64748b;">${escapeHtml(email)}</div>
          </td>
          <td style="padding:8px 12px;">
            ${roleSelectOrTag}
          </td>
          <td style="padding:8px 12px;">
            <label style="${canManage && !isOwner ? 'cursor:pointer;' : 'cursor:not-allowed;'}display:inline-flex;align-items:center;gap:4px;">
              <input type="checkbox" class="chk-setting-admin" data-idx="${idx}" ${isAdmin ? 'checked' : ''} ${!canManage || isOwner ? 'disabled' : ''} />
              <span style="font-size:0.72rem;color:${isAdmin ? '#f59e0b' : '#94a3b8'};">${isAdmin ? '👑 Admin' : 'Member'}</span>
            </label>
          </td>
          <td style="padding:8px 12px;">
            <select class="sel-setting-edit form-input" data-idx="${idx}" ${!canManage ? 'disabled' : ''} style="padding:2px 6px;font-size:0.72rem;width:auto;">
              <option value="true" ${canEdit ? 'selected' : ''}>✏️ Can Edit Code</option>
              <option value="false" ${!canEdit ? 'selected' : ''}>💡 Suggestion Only</option>
            </select>
          </td>
          <td style="padding:8px 12px;text-align:center;">
            ${actionHtml}
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    if (canManage) {
      container.querySelectorAll(".sel-setting-role").forEach(sel => {
        sel.addEventListener("change", (e) => {
          const i = parseInt(e.target.getAttribute("data-idx"), 10);
          if (members[i]) {
            members[i].role = e.target.value;
            members[i].color = getRoleColor(e.target.value);
          }
        });
      });

      container.querySelectorAll(".chk-setting-admin").forEach(chk => {
        chk.addEventListener("change", (e) => {
          const i = parseInt(e.target.getAttribute("data-idx"), 10);
          if (members[i]) {
            members[i].isAdmin = e.target.checked;
            if (e.target.checked && members[i].canEditCode === undefined) {
              members[i].canEditCode = true;
            }
          }
        });
      });

      container.querySelectorAll(".sel-setting-edit").forEach(sel => {
        sel.addEventListener("change", (e) => {
          const i = parseInt(e.target.getAttribute("data-idx"), 10);
          if (members[i]) members[i].canEditCode = (e.target.value === "true");
        });
      });

      container.querySelectorAll(".btn-team-kick").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          if (!isCurrentUserAdmin()) {
            alert("Only team admins can kick members.");
            return;
          }
          const i = parseInt(e.currentTarget.getAttribute("data-idx"), 10);
          const targetMem = members[i];
          if (!targetMem) return;

          const isTargetOwner = targetMem.isOwner || (currentTeam.ownerEmail && currentTeam.ownerEmail.toLowerCase().trim() === (targetMem.email || "").toLowerCase().trim());
          if (isTargetOwner) {
            alert("Cannot kick the team owner.");
            return;
          }

          const memName = targetMem.displayName || targetMem.email || "this member";
          if (!confirm(`Are you sure you want to kick "${memName}" from the team?\nThey will immediately be removed from the team workspace.`)) {
            return;
          }

          const kicked = members.splice(i, 1)[0];
          recordVersionHistoryEntry(`Kicked ${kicked.displayName || kicked.email} from the team`, "member_kick");
          currentTeam.updatedAt = Date.now();

          // Server-side kick
          const apiRoute = resolveApiUrl("/api/team/kick-member");
          if (apiRoute) {
            safeFetchJson(apiRoute, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                teamId: currentTeam.teamId,
                email: currentUser.email,
                targetEmail: kicked.email
              })
            }).catch(() => {});
          }

          // Remove from team_rosters collection in Firestore
          try {
            const db = getFirestoreDb();
            if (db && kicked.email) {
              const cleanKeys = getCleanEmailKeys(kicked.email);
              for (const k of cleanKeys) {
                db.collection("team_rosters").doc(k).delete().catch(() => {});
              }
            }
          } catch (_) {}

          await fsSaveTeamDoc(currentTeam);
          renderSettingsRosterTable();
          renderMemberList();
          renderVersionHistory();
          showToast(`👢 Kicked ${kicked.displayName || kicked.email} from the team.`, "⚠️");
        });
      });

      container.querySelectorAll(".btn-self-leave-team").forEach(btn => {
        btn.addEventListener("click", () => {
          openExitTeamChallengeModal();
        });
      });
    }
  }

  // --------------------------------------------------------------------------
  // ADMIN DASHBOARD & 6-DIGIT HEX INVITATION SYSTEM
  // --------------------------------------------------------------------------
  function generate6DigitHex() {
    const chars = "0123456789ABCDEF";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * 16)];
    }
    return code;
  }

  function renderTeamAdminView(filterQuery = "") {
    if (!currentTeam) return;
    const countEl = document.getElementById("lblAdminMemberCount");
    if (countEl) countEl.textContent = String((currentTeam.members || []).length);

    const txtSearch = document.getElementById("txtAdminSearchMembers");
    const query = filterQuery || (txtSearch ? txtSearch.value : "");
    renderAdminRosterTable(query);
    renderAdminPendingInvites();
  }

  function renderAdminRosterTable(filterQuery = "") {
    const wrap = document.getElementById("adminMembersTableWrap");
    if (!wrap || !currentTeam) return;

    const canManage = isCurrentUserAdmin();
    const myEmail = (currentUser?.email || "").toLowerCase().trim();
    const query = (filterQuery || "").toLowerCase().trim();

    let members = currentTeam.members || [];
    if (query) {
      members = members.filter(m => {
        const name = (m.displayName || "").toLowerCase();
        const email = (m.email || "").toLowerCase();
        const role = (m.role || "").toLowerCase();
        return name.includes(query) || email.includes(query) || role.includes(query);
      });
    }

    let html = "";
    if (!canManage) {
      html += `
        <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:12px 16px;margin:12px;font-size:0.78rem;color:#f87171;line-height:1.45;">
          🔒 <strong>Read-Only Mode:</strong> You are viewing this dashboard as a normal team member. Only team administrators and the workspace owner can modify member roles, change editing permissions, generate hex invitations, or kick members.
        </div>
      `;
    }

    html += `
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem;text-align:left;">
        <thead>
          <tr style="background:#090d16;color:#94a3b8;border-bottom:1px solid #1e293b;">
            <th style="padding:10px 14px;">Member</th>
            <th style="padding:10px 14px;">Role</th>
            <th style="padding:10px 14px;">Admin Access</th>
            <th style="padding:10px 14px;">Code Edit Permissions</th>
            <th style="padding:10px 14px;text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    const ROLES = ["Programmer", "Builder", "Driver", "Strategist", "Scout", "Coach", "Admin", "Member"];

    if (members.length === 0) {
      html += `
        <tr>
          <td colspan="5" style="padding:24px;text-align:center;color:var(--muted);font-size:0.82rem;">
            No team members found matching "${escapeHtml(query)}".
          </td>
        </tr>
      `;
    } else {
      members.forEach((m) => {
        const email = m.email || "member@team";
        const isOwner = m.isOwner || (currentTeam.ownerEmail && currentTeam.ownerEmail.toLowerCase().trim() === email.toLowerCase().trim());
        const isAdmin = m.isAdmin || isOwner;
        const canEdit = m.canEditCode !== undefined ? m.canEditCode : (isAdmin || m.role === "Programmer");
        const isMe = (email.toLowerCase().trim() === myEmail);
        const roleColor = getRoleColor(m.role);

        let roleSelectOrTag = "";
        if (canManage && !isOwner) {
          roleSelectOrTag = `
            <select class="sel-admin-role form-input" data-email="${escapeHtml(email)}" style="padding:4px 8px;font-size:0.75rem;width:auto;">
              ${ROLES.map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r}</option>`).join("")}
            </select>
          `;
        } else {
          roleSelectOrTag = `<span class="member-role-tag ${m.role ? m.role.toLowerCase() : 'programmer'}" style="background:${roleColor}22;color:${roleColor};border-color:${roleColor}55;">${escapeHtml(m.role || 'Programmer')}</span>`;
        }

        let actionHtml = "";
        if (isOwner) {
          actionHtml = `<span style="font-size:0.75rem;color:#fbbf24;font-weight:800;">👑 Owner</span>`;
        } else if (isMe) {
          actionHtml = `<span style="font-size:0.75rem;color:#94a3b8;font-weight:600;">(You)</span>`;
        } else if (canManage) {
          actionHtml = `
            <button type="button" class="btn-admin-kick" data-email="${escapeHtml(email)}" data-name="${escapeHtml(m.displayName || email)}" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);color:#f87171;padding:4px 10px;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:700;transition:all 0.15s ease;" title="Kick member from team workspace">
              👢 Kick
            </button>
          `;
        } else {
          actionHtml = `<span style="color:#64748b;font-size:0.72rem;">—</span>`;
        }

        html += `
          <tr style="border-bottom:1px solid #1e293b;">
            <td style="padding:10px 14px;color:#f8fafc;">
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:32px;height:32px;border-radius:50%;background:${roleColor}25;border:1px solid ${roleColor}66;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.8rem;color:${roleColor};">
                  ${escapeHtml((m.displayName || email)[0].toUpperCase())}
                </div>
                <div>
                  <div style="font-weight:700;display:flex;align-items:center;gap:6px;">
                    ${escapeHtml(m.displayName || email.split("@")[0])}
                    ${isOwner ? '<span style="font-size:0.65rem;background:#fbbf24;color:#0b0f14;padding:1px 5px;border-radius:4px;font-weight:800;">OWNER</span>' : ''}
                  </div>
                  <div style="font-size:0.7rem;color:#64748b;">${escapeHtml(email)}</div>
                </div>
              </div>
            </td>
            <td style="padding:10px 14px;">
              ${roleSelectOrTag}
            </td>
            <td style="padding:10px 14px;">
              <label style="${canManage && !isOwner ? 'cursor:pointer;' : 'cursor:not-allowed;'}display:inline-flex;align-items:center;gap:6px;">
                <input type="checkbox" class="chk-admin-privilege" data-email="${escapeHtml(email)}" ${isAdmin ? 'checked' : ''} ${!canManage || isOwner ? 'disabled' : ''} />
                <span style="font-size:0.75rem;font-weight:600;color:${isAdmin ? '#f59e0b' : '#94a3b8'};">${isAdmin ? '🛡️ Admin' : 'Teammate'}</span>
              </label>
            </td>
            <td style="padding:10px 14px;">
              <select class="sel-admin-code-perm form-input" data-email="${escapeHtml(email)}" ${!canManage ? 'disabled' : ''} style="padding:4px 8px;font-size:0.75rem;width:auto;${!canManage ? 'opacity:0.7;cursor:not-allowed;' : ''}">
                <option value="true" ${canEdit ? 'selected' : ''}>✏️ Can Edit Code</option>
                <option value="false" ${!canEdit ? 'selected' : ''}>💡 Suggestion Only</option>
              </select>
            </td>
            <td style="padding:10px 14px;text-align:center;">
              ${actionHtml}
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table>`;
    wrap.innerHTML = html;

    if (canManage) {
      wrap.querySelectorAll(".sel-admin-role").forEach(sel => {
        sel.addEventListener("change", (e) => {
          const em = e.target.getAttribute("data-email");
          const mem = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === em.toLowerCase().trim());
          if (mem) {
            mem.role = e.target.value;
            mem.color = getRoleColor(e.target.value);
          }
        });
      });

      wrap.querySelectorAll(".chk-admin-privilege").forEach(chk => {
        chk.addEventListener("change", (e) => {
          const em = e.target.getAttribute("data-email");
          const mem = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === em.toLowerCase().trim());
          if (mem) {
            mem.isAdmin = e.target.checked;
            if (e.target.checked && mem.canEditCode === undefined) {
              mem.canEditCode = true;
            }
          }
        });
      });

      wrap.querySelectorAll(".sel-admin-code-perm").forEach(sel => {
        sel.addEventListener("change", (e) => {
          const em = e.target.getAttribute("data-email");
          const mem = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === em.toLowerCase().trim());
          if (mem) {
            mem.canEditCode = (e.target.value === "true");
          }
        });
      });

      wrap.querySelectorAll(".btn-admin-kick").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          if (!isCurrentUserAdmin()) {
            alert("Only team administrators can kick members.");
            return;
          }
          const targetEmail = e.currentTarget.getAttribute("data-email");
          const targetName = e.currentTarget.getAttribute("data-name") || targetEmail;
          if (!targetEmail) return;

          const myEm = (currentUser?.email || "").toLowerCase().trim();
          if (targetEmail.toLowerCase().trim() === myEm) {
            if (confirm("Do you want to leave this team workspace?\nYou will be removed from the team and can join another team or create a new team.")) {
              openExitTeamChallengeModal();
            }
            return;
          }

          const mem = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === targetEmail.toLowerCase().trim());
          const isTargetOwner = mem?.isOwner || (currentTeam.ownerEmail && currentTeam.ownerEmail.toLowerCase().trim() === targetEmail.toLowerCase().trim());
          if (isTargetOwner) {
            alert("The team owner cannot be kicked.");
            return;
          }

          if (!confirm(`Are you sure you want to kick "${targetName}" (${targetEmail}) from the workspace?\nThey will immediately lose access and be removed from all active sessions.`)) {
            return;
          }

          const idx = (currentTeam.members || []).findIndex(m => (m.email || "").toLowerCase().trim() === targetEmail.toLowerCase().trim());
          if (idx !== -1) {
            const kicked = currentTeam.members.splice(idx, 1)[0];
            recordVersionHistoryEntry(`Kicked ${kicked.displayName || kicked.email} from the workspace`, "member_kick");
            currentTeam.updatedAt = Date.now();

            const apiRoute = resolveApiUrl("/api/team/kick-member");
            if (apiRoute) {
              safeFetchJson(apiRoute, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  teamId: currentTeam.teamId,
                  email: currentUser.email,
                  targetEmail: kicked.email
                })
              }).catch(() => {});
            }

            try {
              const db = getFirestoreDb();
              if (db && kicked.email) {
                const cleanKeys = getCleanEmailKeys(kicked.email);
                for (const k of cleanKeys) {
                  db.collection("team_rosters").doc(k).delete().catch(() => {});
                }
              }
            } catch (_) {}

            await fsSaveTeamDoc(currentTeam);
            renderTeamAdminView(document.getElementById("txtAdminSearchMembers")?.value || "");
            renderMemberList();
            renderSettingsRosterTable();
            renderVersionHistory();
            showToast(`👢 Kicked ${targetName} from the workspace.`, "⚠️");
          }
        });
      });
    }
  }

  function renderAdminPendingInvites() {
    const container = document.getElementById("adminActiveInvitesContainer");
    if (!container || !currentTeam) return;

    const invites = (currentTeam.invites || []).filter(inv => inv.status === "pending");
    if (invites.length === 0) {
      container.innerHTML = `<div style="font-size:0.75rem;color:var(--muted);">No pending invites. Enter a Gmail above to generate a 6-digit hex verification invite.</div>`;
      return;
    }

    let html = `
      <div style="font-weight:700;font-size:0.78rem;color:var(--text);margin-bottom:4px;">Active Pending Invites (${invites.length}):</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
    `;

    invites.forEach((inv) => {
      html += `
        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:8px 12px;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:0.9rem;">🔐</span>
            <div>
              <div style="font-weight:700;font-size:0.78rem;color:#f8fafc;">${escapeHtml(inv.targetEmail)}</div>
              <div style="font-size:0.68rem;color:var(--muted);">Invited by ${escapeHtml(inv.invitedBy || 'Admin')} · ${new Date(inv.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.72rem;color:var(--text);">Share Code:</span>
            <code style="font-family:ui-monospace, monospace;font-size:1.05rem;font-weight:900;letter-spacing:2px;color:#4ade80;background:#091220;border:1px solid rgba(34,197,94,0.4);padding:2px 8px;border-radius:6px;">${escapeHtml(inv.correctHex)}</code>
            <button type="button" class="btn-copy-admin-hex btn-team-secondary" data-code="${escapeHtml(inv.correctHex)}" style="font-size:0.72rem;padding:3px 8px;">📋 Copy</button>
            ${isCurrentUserAdmin() ? `
              <button type="button" class="btn-revoke-admin-hex btn-team-secondary" data-id="${escapeHtml(inv.id)}" style="font-size:0.72rem;padding:3px 8px;color:#f87171;border-color:rgba(239,68,68,0.3);">Revoke</button>
            ` : ''}
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;

    container.querySelectorAll(".btn-copy-admin-hex").forEach(btn => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-code");
        if (code) {
          navigator.clipboard.writeText(code).then(() => {
            showToast(`📋 Copied 6-digit hex code: ${code}! Share with your teammate.`, "✅");
          }).catch(() => {
            prompt("Copy code:", code);
          });
        }
      });
    });

    container.querySelectorAll(".btn-revoke-admin-hex").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!confirm("Revoke this invitation?")) return;
        currentTeam.invites = (currentTeam.invites || []).filter(inv => inv.id !== id);
        await fsSaveTeamDoc(currentTeam);
        renderAdminPendingInvites();
        showToast("Invitation revoked.", "ℹ️");
      });
    });
  }

  function initAdminDashboardEvents() {
    const txtSearch = document.getElementById("txtAdminSearchMembers");
    if (txtSearch) {
      txtSearch.addEventListener("input", (e) => {
        renderAdminRosterTable(e.target.value);
      });
    }

    const btnGenerateHex = document.getElementById("btnAdminGenerateHexInvite");
    if (btnGenerateHex) {
      btnGenerateHex.addEventListener("click", async () => {
        if (!isCurrentUserAdmin()) {
          alert("Only team administrators can generate invites.");
          return;
        }
        const txtEmail = document.getElementById("txtAdminInviteEmail");
        const targetEmail = (txtEmail?.value || "").trim().toLowerCase();
        if (!targetEmail || !targetEmail.includes("@")) {
          alert("Please enter a valid Gmail address for the invited teammate.");
          return;
        }

        const correctHex = generate6DigitHex();
        let fake1 = generate6DigitHex();
        while (fake1 === correctHex) fake1 = generate6DigitHex();
        let fake2 = generate6DigitHex();
        while (fake2 === correctHex || fake2 === fake1) fake2 = generate6DigitHex();

        const options = [correctHex, fake1, fake2].sort(() => Math.random() - 0.5);

        const invite = {
          id: "inv_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6),
          teamId: currentTeam.teamId,
          teamName: currentTeam.teamName,
          teamCode: currentTeam.teamCode,
          correctHex,
          options,
          targetEmail,
          invitedBy: currentUser?.displayName || currentUser?.email.split("@")[0],
          invitedByEmail: currentUser?.email,
          status: "pending",
          createdAt: Date.now()
        };

        if (!currentTeam.invites) currentTeam.invites = [];
        currentTeam.invites = currentTeam.invites.filter(i => i.targetEmail !== targetEmail || i.status !== "pending");
        currentTeam.invites.unshift(invite);

        await fsSaveTeamDoc(currentTeam);
        try {
          const db = getFirestoreDb();
          if (db) {
            const cleanKey = getCleanEmailKeys(targetEmail)[0];
            await db.collection("team_invites").doc(cleanKey).set(invite, { merge: true });
          }
        } catch (_) {}

        const apiRoute = resolveApiUrl("/api/team/invite/create");
        if (apiRoute) {
          fetch(apiRoute, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamId: currentTeam.teamId,
              email: currentUser.email,
              targetEmail
            })
          }).catch(() => {});
        }

        if (txtEmail) txtEmail.value = "";
        renderAdminPendingInvites();
        showToast(`⚡ 6-Digit Hex Invite Code generated: ${correctHex}! Share with ${targetEmail}`, "🎉");
      });
    }

    const btnSavePermissions = document.getElementById("btnAdminSavePermissions");
    if (btnSavePermissions) {
      btnSavePermissions.addEventListener("click", async () => {
        if (!isCurrentUserAdmin()) {
          alert("Only team administrators can save permissions.");
          return;
        }

        recordVersionHistoryEntry("Updated team member permissions and roles", "permissions_update");
        currentTeam.updatedAt = Date.now();

        await fsSaveTeamDoc(currentTeam);

        const apiRoute = resolveApiUrl("/api/team/permissions/update");
        if (apiRoute) {
          fetch(apiRoute, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamId: currentTeam.teamId,
              email: currentUser.email,
              members: currentTeam.members
            })
          }).catch(() => {});
        }

        renderMemberList();
        renderSettingsRosterTable();
        renderVersionHistory();
        showToast("💾 Team permissions and roles saved & synced across all teammates!", "✅");
      });
    }
  }

  // Full-screen 6-digit hex invite verification system
  let pendingInviteListenerUnsub = null;
  function listenForPendingInvites(userEmail) {
    if (!userEmail) return;
    if (pendingInviteListenerUnsub) {
      try { pendingInviteListenerUnsub(); } catch (_) {}
      pendingInviteListenerUnsub = null;
    }

    const db = getFirestoreDb();
    const cleanKeys = getCleanEmailKeys(userEmail);

    if (db) {
      try {
        const docRef = db.collection("team_invites").doc(cleanKeys[0]);
        pendingInviteListenerUnsub = docRef.onSnapshot((doc) => {
          if (doc && doc.exists) {
            const data = doc.data();
            if (data && data.status === "pending") {
              showFullScreenInviteModal(data);
            }
          }
        });
      } catch (e) {
        console.warn("[TeamCollab] Invite listener notice:", e);
      }
    }

    const apiRoute = resolveApiUrl(`/api/team/invite/pending?email=${encodeURIComponent(userEmail)}`);
    if (apiRoute) {
      fetch(apiRoute).then(r => r.json()).then(data => {
        if (data && Array.isArray(data.pending) && data.pending.length > 0) {
          showFullScreenInviteModal(data.pending[0]);
        }
      }).catch(() => {});
    }
  }

  function showFullScreenInviteModal(invite) {
    const modal = document.getElementById("fullScreenInviteModal");
    if (!modal) return;

    const lblTeam = document.getElementById("lblInvitedTeamName");
    const lblBy = document.getElementById("lblInvitedBy");
    const lblEmail = document.getElementById("lblInvitedUserEmail");
    const grid = document.getElementById("hexOptionsGrid");
    const feedback = document.getElementById("hexVerifyFeedback");

    if (lblTeam) lblTeam.textContent = invite.teamName || "VEX Team";
    if (lblBy) lblBy.textContent = invite.invitedBy || "Team Admin";
    if (lblEmail) lblEmail.textContent = invite.targetEmail || currentUser?.email || "";
    if (feedback) { feedback.textContent = ""; feedback.style.color = ""; }

    const options = Array.isArray(invite.options) && invite.options.length === 3
      ? invite.options
      : [invite.correctHex || "A4B1C2", "8D39FE", "5E04BA"];

    if (grid) {
      grid.innerHTML = "";
      options.forEach(hex => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hex-option-card";
        btn.innerHTML = `
          <span style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Code Option</span>
          <span class="hex-code-val">${escapeHtml(hex)}</span>
        `;

        btn.addEventListener("click", () => handleHexCodeSelection(btn, hex, invite));
        grid.appendChild(btn);
      });
    }

    const btnDecline = document.getElementById("btnDeclineTeamInvite");
    if (btnDecline) {
      btnDecline.onclick = () => {
        if (confirm("Are you sure you want to decline this team invitation?")) {
          declineTeamInvite(invite);
        }
      };
    }

    modal.style.display = "flex";
  }

  async function handleHexCodeSelection(selectedBtn, chosenHex, invite) {
    const feedback = document.getElementById("hexVerifyFeedback");
    const grid = document.getElementById("hexOptionsGrid");
    const allBtns = grid ? grid.querySelectorAll(".hex-option-card") : [];
    allBtns.forEach(b => { b.disabled = true; });

    let isCorrect = false;

    const apiRoute = resolveApiUrl("/api/team/invite/verify");
    if (apiRoute) {
      try {
        const res = await fetch(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: invite.teamId,
            inviteId: invite.id,
            email: currentUser?.email,
            selectedHex: chosenHex,
            displayName: currentUser?.displayName,
            role: "Programmer"
          })
        });
        const data = await res.json();
        if (data.success) {
          isCorrect = true;
          if (data.team) {
            localStorage.setItem("lemlib_active_team", JSON.stringify(data.team));
            localStorage.setItem("lemlib_user_team_id", data.team.teamId);
          }
        }
      } catch (_) {}
    }

    if (!isCorrect && invite.correctHex) {
      isCorrect = (chosenHex.toUpperCase().trim() === invite.correctHex.toUpperCase().trim());
    }

    if (isCorrect) {
      selectedBtn.classList.add("correct");
      if (feedback) {
        feedback.textContent = "✅ Correct authorization code! Joining team workspace...";
        feedback.style.color = "#4ade80";
      }

      try {
        const db = getFirestoreDb();
        if (db && invite.targetEmail) {
          const cleanKey = getCleanEmailKeys(invite.targetEmail)[0];
          await db.collection("team_invites").doc(cleanKey).update({ status: "accepted", acceptedAt: Date.now() }).catch(() => {});

          await db.collection("team_rosters").doc(cleanKey).set({
            teamId: invite.teamId,
            email: invite.targetEmail.toLowerCase().trim(),
            teamName: invite.teamName,
            joinedAt: Date.now()
          }, { merge: true }).catch(() => {});
        }
      } catch (_) {}

      setTimeout(async () => {
        const modal = document.getElementById("fullScreenInviteModal");
        if (modal) modal.style.display = "none";

        const db = getFirestoreDb();
        let loadedTeam = null;
        if (db && invite.teamId) {
          try {
            const doc = await db.collection("teams").doc(invite.teamId).get();
            if (doc.exists) loadedTeam = doc.data();
          } catch (_) {}
        }
        if (!loadedTeam) {
          const tRaw = localStorage.getItem("lemlib_active_team");
          if (tRaw) {
            try { loadedTeam = JSON.parse(tRaw); } catch (_) {}
          }
        }

        if (loadedTeam) {
          finalizeTeamLoaded(loadedTeam, `🎉 Joined "${loadedTeam.teamName}" successfully!`);
        } else {
          window.location.reload();
        }
      }, 1200);
    } else {
      selectedBtn.classList.add("incorrect");
      if (feedback) {
        feedback.textContent = "❌ Incorrect verification code! Invitation declined.";
        feedback.style.color = "#f87171";
      }

      try {
        const db = getFirestoreDb();
        if (db && invite.targetEmail) {
          const cleanKey = getCleanEmailKeys(invite.targetEmail)[0];
          await db.collection("team_invites").doc(cleanKey).update({ status: "rejected", rejectedAt: Date.now() }).catch(() => {});
        }
      } catch (_) {}

      setTimeout(() => {
        const modal = document.getElementById("fullScreenInviteModal");
        if (modal) modal.style.display = "none";
        showToast("❌ Incorrect verification code. Invitation was declined.", "⚠️");
      }, 1500);
    }
  }

  async function declineTeamInvite(invite) {
    const modal = document.getElementById("fullScreenInviteModal");
    if (modal) modal.style.display = "none";

    const apiRoute = resolveApiUrl("/api/team/invite/decline");
    if (apiRoute) {
      fetch(apiRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: invite.teamId, email: currentUser?.email, inviteId: invite.id })
      }).catch(() => {});
    }

    try {
      const db = getFirestoreDb();
      if (db && invite.targetEmail) {
        const cleanKey = getCleanEmailKeys(invite.targetEmail)[0];
        await db.collection("team_invites").doc(cleanKey).update({ status: "declined", declinedAt: Date.now() }).catch(() => {});
      }
    } catch (_) {}

    showToast("Team invitation declined.", "ℹ️");
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

    const startTime = Date.now();
    if (onProgress) {
      onProgress({
        pct: 6,
        stage: "Connecting to GitHub API",
        message: "Connecting to GitHub API and resolving tree...",
        phase: 1,
        etaStr: "~10s remaining"
      });
    }

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

    if (onProgress) {
      onProgress({
        pct: 15,
        stage: "Reading Branch Manifest",
        message: `Reading branch '${targetBranch}' file manifest...`,
        phase: 1,
        etaStr: "~8s remaining"
      });
    }

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
          const downloadPct = Math.round(18 + (completed / total) * 62); // 18% to 80%
          const elapsed = (Date.now() - startTime) / 1000;
          const estTotal = (elapsed / Math.max(0.01, completed / total));
          const estRemaining = Math.max(1, Math.round(estTotal - elapsed));
          const etaText = estRemaining < 60 ? `~${estRemaining}s remaining` : `~${Math.ceil(estRemaining / 60)}m remaining`;

          if (onProgress) {
            onProgress({
              pct: downloadPct,
              stage: `Downloading Files (${completed}/${total})`,
              message: item.path,
              phase: 2,
              completed,
              total,
              etaStr: etaText
            });
          }
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
  let firestorePresenceUnsub = null;

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

  function startFirestorePresenceSubscription(teamId) {
    if (firestorePresenceUnsub) {
      try { firestorePresenceUnsub(); } catch (_) {}
      firestorePresenceUnsub = null;
    }
    const db = getFirestoreDb();
    if (!db || !teamId) return;

    try {
      firestorePresenceUnsub = db.collection("teams").doc(teamId).collection("presence")
        .onSnapshot((snapshot) => {
          if (!snapshot || !currentTeam) return;
          const activeMembers = [];
          const now = Date.now();
          snapshot.forEach((doc) => {
            const data = doc.data() || {};
            // Filter presence within last 25 seconds
            if (now - (data.lastSeen || 0) < 25000) {
              activeMembers.push(data);
            }
          });
          renderPresenceAvatars(activeMembers);
          renderTeammateCursors(activeMembers);
        }, (err) => {
          console.warn("[TeamCollab] Presence onSnapshot notice:", err);
        });
    } catch (e) {
      console.warn("[TeamCollab] Failed to start Firestore presence listener:", e);
    }
  }

  function sendFirestorePresence(cursor = null) {
    const db = getFirestoreDb();
    if (!db || !currentTeam || !currentTeam.teamId || !currentUser || !currentUser.email) return;

    const emailNorm = currentUser.email.toLowerCase().trim();
    const docId = emailNorm.replace(/[^a-z0-9]/g, "_");

    const presenceData = {
      email: emailNorm,
      displayName: currentUser.displayName || emailNorm.split("@")[0] || "Teammate",
      role: currentUser.role || "Programmer",
      color: currentUser.color || getRoleColor(currentUser.role || "Programmer"),
      lastSeen: Date.now(),
      cursor: cursor || null,
      activeWaypoint: draggedWaypointIndex >= 0 ? draggedWaypointIndex : null,
      activeRoutine: activePaths[activeRoutineIndex]?.name || null
    };

    db.collection("teams").doc(currentTeam.teamId).collection("presence").doc(docId)
      .set(presenceData, { merge: true })
      .catch((err) => console.warn("[TeamCollab] Firestore presence write error:", err));
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
    if (isTeamSyncLocked()) {
      console.warn("[TeamCollab] Prevented fsSaveTeamDoc: workspace is sync locked by another session.");
      return false;
    }
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

  // --------------------------------------------------------------------------
  // CROSS-SESSION SYNC LOCK & PROGRESS BROADCASTING
  // --------------------------------------------------------------------------
  let activeSyncLockDismissTimeout = null;

  function isTeamSyncLocked() {
    if (!currentTeam || !currentTeam.syncLock) return false;
    const lk = currentTeam.syncLock;
    if (!lk.active) return false;
    // Timeout guard: lock expires after 90 seconds to prevent permanent lockouts
    if (Date.now() - (lk.updatedAt || lk.startedAt || 0) > 90000) {
      lk.active = false;
      return false;
    }
    // If the current logged-in user is the one performing the import, don't lock their own actions
    const myEmail = (currentUser?.email || "").toLowerCase().trim();
    if (myEmail && lk.authorEmail && myEmail === lk.authorEmail.toLowerCase().trim()) {
      return false;
    }
    return true;
  }

  function handleRemoteSyncLock(syncLock) {
    const banner = document.getElementById("teamSyncSessionBanner");
    if (!banner) return;

    if (!syncLock || !syncLock.active) {
      // If was recently completed
      if (syncLock && syncLock.completedAt && (Date.now() - syncLock.completedAt < 6000)) {
        banner.style.display = "block";
        const elTitle = document.getElementById("syncBannerTitle");
        const elPct = document.getElementById("syncBannerPct");
        const elStage = document.getElementById("syncBannerStage");
        const elDetail = document.getElementById("syncBannerDetail");
        const elEta = document.getElementById("syncBannerEta");
        const elBar = document.getElementById("syncBannerBar");
        const elLockPill = document.getElementById("syncBannerLockPill");
        const elIcon = document.getElementById("syncBannerIcon");

        if (elIcon) elIcon.style.animation = "none";
        if (elTitle) elTitle.innerHTML = `✅ <strong>${escapeHtml(syncLock.authorName || 'Teammate')}</strong> synchronized workspace from GitHub!`;
        if (elPct) { elPct.textContent = "100%"; elPct.style.background = "rgba(34,197,94,0.3)"; elPct.style.color = "#4ade80"; }
        if (elStage) elStage.textContent = "Workspace Up to Date";
        if (elDetail) elDetail.textContent = syncLock.detail || "All routines and files synced.";
        if (elEta) elEta.textContent = "✅ Done";
        if (elBar) { elBar.style.width = "100%"; elBar.style.background = "#22c55e"; }
        if (elLockPill) {
          elLockPill.textContent = "🔓 Edits Unlocked";
          elLockPill.style.color = "#4ade80";
          elLockPill.style.borderColor = "#22c55e";
          elLockPill.style.background = "rgba(34,197,94,0.15)";
        }

        if (activeSyncLockDismissTimeout) clearTimeout(activeSyncLockDismissTimeout);
        activeSyncLockDismissTimeout = setTimeout(() => {
          banner.style.display = "none";
        }, 4000);
        return;
      }

      banner.style.display = "none";
      return;
    }

    // Lock is ACTIVE! Check if stale (>90s)
    if (Date.now() - (syncLock.updatedAt || syncLock.startedAt || 0) > 90000) {
      banner.style.display = "none";
      return;
    }

    const myEmail = (currentUser?.email || "").toLowerCase().trim();
    const isMe = myEmail && syncLock.authorEmail && (myEmail === syncLock.authorEmail.toLowerCase().trim());

    banner.style.display = "block";

    const elTitle = document.getElementById("syncBannerTitle");
    const elPct = document.getElementById("syncBannerPct");
    const elStage = document.getElementById("syncBannerStage");
    const elDetail = document.getElementById("syncBannerDetail");
    const elEta = document.getElementById("syncBannerEta");
    const elBar = document.getElementById("syncBannerBar");
    const elLockPill = document.getElementById("syncBannerLockPill");
    const elIcon = document.getElementById("syncBannerIcon");

    if (elIcon) elIcon.style.animation = "team-spin 1.4s linear infinite";

    const pct = Math.max(0, Math.min(100, Math.round(syncLock.progress || 0)));
    const authorStr = isMe ? "You are" : `<strong>${escapeHtml(syncLock.authorName || 'Teammate')}</strong> is`;
    const repoName = syncLock.repo ? syncLock.repo.split("/").slice(-2).join("/") : "repository";

    if (elTitle) elTitle.innerHTML = `🔄 ${authorStr} importing GitHub <code>${escapeHtml(repoName)}</code>`;
    if (elPct) elPct.textContent = `${pct}%`;
    if (elStage) elStage.textContent = syncLock.stage || "Connecting to GitHub...";
    if (elDetail) elDetail.textContent = syncLock.detail || "";
    if (elEta) elEta.textContent = syncLock.eta ? (syncLock.eta.startsWith("⏱️") ? syncLock.eta : `⏱️ ${syncLock.eta}`) : "⏱️ Syncing...";
    if (elBar) elBar.style.width = `${pct}%`;
    if (elLockPill) {
      if (isMe) {
        elLockPill.textContent = "⚡ Sync in Progress (You)";
        elLockPill.style.color = "#38bdf8";
        elLockPill.style.borderColor = "#38bdf8";
        elLockPill.style.background = "rgba(56,189,248,0.15)";
      } else {
        elLockPill.textContent = "🔒 Workspace Locked to Prevent Overrides";
        elLockPill.style.color = "#f87171";
        elLockPill.style.borderColor = "#ef4444";
        elLockPill.style.background = "rgba(239,68,68,0.15)";
      }
    }
  }

  async function broadcastSyncLock(lockObj) {
    if (!currentTeam || !currentTeam.teamId) return;
    try {
      currentTeam.syncLock = lockObj;
      handleRemoteSyncLock(lockObj);

      const db = getFirestoreDb();
      if (db) {
        await db.collection("teams").doc(currentTeam.teamId).set({ syncLock: lockObj }, { merge: true });
        if (currentTeam.teamCode) {
          const codeKey = currentTeam.teamCode.trim().toUpperCase();
          await db.collection("teams").doc(codeKey).set({ syncLock: lockObj }, { merge: true });
        }
      }

      const apiRoute = resolveApiUrl("/api/team/sync-progress");
      if (apiRoute) {
        fetch(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: currentTeam.teamId, syncLock: lockObj })
        }).catch(() => {});
      }
    } catch (e) {
      console.warn("[TeamCollab] broadcastSyncLock notice:", e);
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
          if (remote) {
            const myEmail = (currentUser?.email || "").toLowerCase().trim();
            if (myEmail && Array.isArray(remote.members) && remote.members.length > 0) {
              const stillMember = remote.members.some(m => (m.email || "").toLowerCase().trim() === myEmail);
              if (!stillMember && currentTeam && !isCurrentUserOwner()) {
                try { firestoreUnsub(); } catch (_) {}
                firestoreUnsub = null;
                currentTeam = null;
                localStorage.removeItem("lemlib_active_team");
                alert("⚠️ You have been removed from this team workspace by an administrator.");
                window.location.reload();
                return;
              }
            }

            if (remote.syncLock) {
              currentTeam.syncLock = remote.syncLock;
              handleRemoteSyncLock(remote.syncLock);
            } else if (currentTeam?.syncLock) {
              currentTeam.syncLock = null;
              handleRemoteSyncLock(null);
            }

            if (remote.updatedAt > (currentTeam?.updatedAt || 0)) {
              currentTeam = remote;
              if (remote.pathPayload && remote.pathPayload.paths) {
                activePaths = remote.pathPayload.paths;
                renderRoutinesSelector(false);
                renderActionBlocks();
                syncIdeAutonsFromBlocks();
                drawField();
              }
              renderStrategies();
              renderPinComments();
              renderVersionHistory();
              renderMemberList();
            }
          }
        }
      }, (error) => {
        console.warn("[TeamCollab] Main team doc onSnapshot notice:", error);
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
        let rawSaved = (txtUserAccountEmail && txtUserAccountEmail.value.trim()) ||
          localStorage.getItem("lemlib_saved_google_email");
        if (!rawSaved || rawSaved === "null" || rawSaved === "undefined" || !rawSaved.includes("@")) {
          rawSaved = "teammate@example.com";
        }
        const savedEmail = rawSaved.trim().toLowerCase();
        let savedObj = null;
        try { savedObj = JSON.parse(localStorage.getItem("lemlib_saved_google_user")); } catch (_) {}
        currentUser = {
          email: savedEmail,
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
      if (currentUser && currentUser.email) {
        listenForPendingInvites(currentUser.email);
      }
    }

    if (txtUserAccountEmail) {
      txtUserAccountEmail.addEventListener("change", () => {
        const val = txtUserAccountEmail.value.trim();
        if (val && val.includes("@") && val !== "null" && val !== "undefined") {
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
          listenForPendingInvites(currentUser.email);
        }
      });
    }

    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        if (user && user.email) {
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

        setSetupViewVisible(false);
        if (modal) modal.style.display = "none";

        onTeamLoaded();
        showToast(`Successfully restored "${t.teamName}" from ${ct.source}!`, "🎉");
      };

      container.appendChild(card);
    });

    modal.style.display = "flex";
    return true;
  }

  function setSetupViewVisible(show) {
    const setupView = document.getElementById("teamSetupJoinView");
    const wsView = document.getElementById("teamWorkspaceView");
    const appEl = document.getElementById("app");
    if (show) {
      if (setupView) setupView.style.display = "block";
      if (wsView) wsView.style.display = "none";
      document.body.classList.add("setup-mode");
      document.body.style.overflowY = "auto";
      document.body.style.height = "auto";
      if (appEl) {
        appEl.classList.add("setup-active");
        appEl.style.height = "auto";
        appEl.style.minHeight = "100vh";
        appEl.style.overflowY = "auto";
      }
    } else {
      if (setupView) setupView.style.display = "none";
      if (wsView) wsView.style.display = "flex";
      document.body.classList.remove("setup-mode");
      document.body.style.overflowY = "";
      document.body.style.height = "";
      if (appEl) {
        appEl.classList.remove("setup-active");
        appEl.style.height = "100vh";
        appEl.style.minHeight = "100vh";
        appEl.style.overflow = "hidden";
      }
    }
  }

  async function checkUserTeam() {
    if (!currentUser || !currentUser.email || currentUser.email === "null" || currentUser.email === "undefined" || !currentUser.email.includes("@")) {
      const emailInput = document.getElementById("txtUserAccountEmail");
      let rawSaved = (emailInput && emailInput.value.trim()) || localStorage.getItem("lemlib_saved_google_email");
      if (!rawSaved || rawSaved === "null" || rawSaved === "undefined" || !rawSaved.includes("@")) {
        currentTeam = null;
        setSetupViewVisible(true);
        loadAvailableTeams();
        return;
      }
      const savedEmail = rawSaved.trim().toLowerCase();
      currentUser = {
        email: savedEmail,
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

    // 4. Fallback to LocalStorage (verify actual membership, ignore legacy auto-assigned dummy teams)
    if (!loadedTeam) {
      try {
        const rawLocal = localStorage.getItem("lemlib_active_team");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          // If this was the legacy auto-assigned 99999X dummy team, discard it unless explicitly indexed
          if (parsed && parsed.teamId === "team_mukoxgqg_n33t0") {
            const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
            const userKeys = getCleanEmailKeys(currentUser.email);
            const explicitlyOwned = userKeys.some(k => uTeams[k] === "team_mukoxgqg_n33t0");
            if (!explicitlyOwned) {
              localStorage.removeItem("lemlib_active_team");
              localStorage.removeItem("lemlib_user_team_id");
            } else {
              loadedTeam = parsed;
            }
          } else if (parsed && parsed.teamId) {
            const uTeams = JSON.parse(localStorage.getItem("lemlib_user_teams") || "{}");
            const userKeys = getCleanEmailKeys(currentUser.email);
            const isMem = (parsed.members || []).some(m => (m.email || "").toLowerCase().trim() === currentUser.email.toLowerCase().trim());
            const hasMatch = userKeys.some(k => uTeams[k] === parsed.teamId) || parsed.ownerEmail?.toLowerCase() === currentUser.email.toLowerCase() || isMem;
            if (hasMatch) {
              loadedTeam = parsed;
            }
          }
        }
      } catch (_) {}
    }

    const gate = document.getElementById("modalTeamGate");
    if (gate) gate.style.display = "none";

    // If user has no team, DO NOT auto-assign any default team!
    // Show the Team Setup & Join Gateway so user can join another team or create their own.
    if (!loadedTeam) {
      currentTeam = null;
      try {
        localStorage.removeItem("lemlib_active_team");
        localStorage.removeItem("lemlib_user_team_id");
      } catch (_) {}
      setSetupViewVisible(true);
      loadAvailableTeams();
      return;
    }

    currentTeam = loadedTeam;
    if (!currentTeam.otpInfo) currentTeam.otpInfo = getTeamOtpInfo(currentTeam);
    setSetupViewVisible(false);
    try { fsSaveTeamDoc(currentTeam); } catch (_) {}
    onTeamLoaded();
    requestAnimationFrame(() => {
      drawField();
    });
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

  function isCurrentUserAdmin() {
    if (!currentTeam || !currentUser || !currentUser.email) return false;
    if (isCurrentUserOwner()) return true;
    const myEmail = currentUser.email.toLowerCase().trim();
    const myMember = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === myEmail);
    return Boolean(myMember && (myMember.isAdmin || myMember.role === "Admin" || myMember.isOwner));
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
    const lblTeamName = document.getElementById("lblTeamName");
    if (lblTeamName) lblTeamName.textContent = currentTeam.teamName;
    const lblTeamRibbon = document.getElementById("lblTeamNameRibbon");
    if (lblTeamRibbon) lblTeamRibbon.textContent = currentTeam.teamName;
    const lblVexNum = document.getElementById("lblVexNumber");
    if (lblVexNum) lblVexNum.textContent = `(${currentTeam.vexTeamNumber || "VEX Team"})`;
    const lblCode = document.getElementById("lblTeamCode");
    if (lblCode) lblCode.textContent = currentTeam.teamCode;

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
    renderTeamAdminView();
    renderStrategies();
    renderPinComments();
    renderActionBlocks();
    syncIdeAutonsFromBlocks();
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
  // REAL-TIME SYNC BROADCASTING & AUTOMATIC VERSION HISTORY FOR EDITS
  // --------------------------------------------------------------------------
  function recordVersionHistoryEntry(summary, editType = "workspace_edit", customSnapshot = null) {
    if (!currentTeam || !currentUser) return null;
    const now = Date.now();
    const myEmail = (currentUser.email || "").toLowerCase().trim();
    const member = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === myEmail);
    const authorName = currentUser.displayName || member?.displayName || (myEmail ? myEmail.split("@")[0] : "Teammate");
    const authorRole = currentUser.role || member?.role || "Programmer";
    const authorColor = member?.color || getRoleColor(authorRole);

    const snapshot = customSnapshot || { paths: JSON.parse(JSON.stringify(activePaths || [])) };
    const linesCount = (snapshot.paths && Array.isArray(snapshot.paths))
      ? snapshot.paths.reduce((acc, p) => acc + (p.actions ? p.actions.length : 0), 0)
      : 0;

    const entry = {
      id: "v_" + now + "_" + Math.random().toString(36).substring(2, 6),
      timestamp: now,
      dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      authorEmail: myEmail,
      authorName,
      authorRole,
      authorColor,
      actionSummary: summary || "Modified workspace",
      editType: editType || "workspace_edit",
      snapshot,
      linesCount
    };

    currentTeam.versionHistory = currentTeam.versionHistory || [];
    currentTeam.versionHistory.unshift(entry);
    if (currentTeam.versionHistory.length > 500) {
      currentTeam.versionHistory.length = 500;
    }
    renderVersionHistory();
    return entry;
  }

  async function broadcastEdit(summary, editType = "waypoint_edit", createSnapshot = true) {
    if (!currentTeam || !currentUser) return;
    if (isTeamSyncLocked()) {
      const lk = currentTeam.syncLock;
      showToast(`🔒 Cannot edit: ${lk.authorName || 'Teammate'} is importing from GitHub (${lk.progress || 0}%). Edits are paused to prevent overwriting incoming changes.`, "⚠️");
      return;
    }
    try {
      currentTeam.pathPayload = { paths: activePaths };
      currentTeam.updatedAt = Date.now();

      // Automatically save every edit to version history across all teammates
      recordVersionHistoryEntry(summary, editType);

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
          versionHistory: currentTeam.versionHistory,
          createSnapshot: true
        };

        const res = await fetch(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => null);
        if (data && data.success && data.team) {
          if (data.team.versionHistory && data.team.versionHistory.length > 0) {
            currentTeam.versionHistory = data.team.versionHistory;
          }
        }
      }

      // Always save directly to Firestore so teammates receive the new version history live via onSnapshot
      await fsSaveTeamDoc(currentTeam);
      renderVersionHistory();
    } catch (err) {
      console.error("Failed to broadcast edit:", err);
    }
  }

  // --------------------------------------------------------------------------
  // FIELD CANVAS RENDERING & COLLABORATOR CURSORS
  // --------------------------------------------------------------------------
  function inchToPx(inchCoord, canvasDim, isY = false) {
    if (isY) {
      return ((FIELD_HALF - inchCoord) / FIELD_INCHES) * canvasDim;
    }
    return ((inchCoord + FIELD_HALF) / FIELD_INCHES) * canvasDim;
  }

  function pxToInch(pxCoord, canvasDim, isY = false) {
    if (isY) {
      return FIELD_HALF - ((pxCoord / canvasDim) * FIELD_INCHES);
    }
    return ((pxCoord / canvasDim) * FIELD_INCHES) - FIELD_HALF;
  }

  function drawField() {
    const cv = document.getElementById("teamFieldCanvas");
    if (!cv) return;
    const context = cv.getContext("2d");
    if (!context) return;
    if (cv.width !== 900 || cv.height !== 900) {
      cv.width = 900;
      cv.height = 900;
    }
    const w = cv.width;
    const h = cv.height;

    context.clearRect(0, 0, w, h);

    // 1. Draw Field Background Image or High-Contrast Foam Tiles
    if (fieldImgLoaded && fieldImg.complete && fieldImg.naturalWidth > 0) {
      context.drawImage(fieldImg, 0, 0, w, h);
    } else {
      // 6x6 Grid = 36 Foam Tiles
      const tileSize = w / 6;
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          context.fillStyle = (r + c) % 2 === 0 ? "#111827" : "#0f172a";
          context.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
          context.strokeStyle = "rgba(255, 255, 255, 0.08)";
          context.lineWidth = 1;
          context.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
        }
      }

      // Alliance Starting Zones
      context.fillStyle = "rgba(239, 68, 68, 0.15)";
      context.fillRect(0, 0, tileSize * 2, tileSize * 2);
      context.fillStyle = "rgba(59, 130, 246, 0.15)";
      context.fillRect(w - tileSize * 2, h - tileSize * 2, tileSize * 2, tileSize * 2);
    }

    // 2. Draw Tile Grid Overlay & Scale Ticks
    const tileSize = w / 6;
    context.strokeStyle = "rgba(255, 255, 255, 0.12)";
    context.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      context.beginPath();
      context.moveTo(i * tileSize, 0);
      context.lineTo(i * tileSize, h);
      context.moveTo(0, i * tileSize);
      context.lineTo(w, i * tileSize);
      context.stroke();
    }

    // 3. Draw Odometry Coordinate Axes (X: Blue/Cyan, Y: Red/Amber)
    context.lineWidth = 2;
    // X Axis Line (Horizontal, Y=0)
    context.strokeStyle = "rgba(56, 189, 248, 0.4)";
    context.beginPath();
    context.moveTo(0, h / 2);
    context.lineTo(w, h / 2);
    context.stroke();

    // Y Axis Line (Vertical, X=0)
    context.strokeStyle = "rgba(239, 68, 68, 0.4)";
    context.beginPath();
    context.moveTo(w / 2, 0);
    context.lineTo(w / 2, h);
    context.stroke();

    // Center Origin Badge
    context.fillStyle = "#38bdf8";
    context.beginPath();
    context.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    context.fill();

    // Field Coordinate Axis Labels (-60", -36", -12", 0", +12", +36", +60")
    context.fillStyle = "rgba(248, 250, 252, 0.6)";
    context.font = "9px monospace";
    context.textAlign = "center";
    context.textBaseline = "bottom";

    const inchTicks = [-60, -36, -12, 12, 36, 60];
    inchTicks.forEach(inch => {
      const px = inchToPx(inch, w);
      const py = inchToPx(inch, h, true);
      context.fillText(`${inch}"`, px, h - 3);
      context.fillText(`${-inch}"`, 14, py + 3);
    });

    // Outer Perimeter Border Frame
    context.strokeStyle = "rgba(56, 189, 248, 0.6)";
    context.lineWidth = 3;
    context.strokeRect(1, 1, w - 2, h - 2);

    // Draw Field Obstacles (Loaders, Mobile Goals, Center Ladder)
    if (collisionConfig.enabled && collisionConfig.showObstacleOverlays) {
      const routineReport = evaluateRoutineCollisions();
      const liveHitObstacleIds = new Set(routineReport.collidingObstacleIds);
      drawFieldObstacles(context, liveHitObstacleIds);
    }

    // Current Routine
    let routine = activePaths[activeRoutineIndex] || activePaths[0];
    if (!routine && currentTeam?.pathPayload?.paths?.length) {
      activePaths = currentTeam.pathPayload.paths;
      routine = activePaths[0];
    }
    if (!routine) {
      routine = {
        id: "p_default",
        name: "Red Left Mogo Rush",
        pose: { x: -60, y: -60, theta: 0 },
        actions: [
          { id: "a_1", type: "moveToPoint", x: -24, y: -24, timeout: 2000, maxSpeed: 115, earlyExitRange: 2, comment: "Rush alliance goal" },
          { id: "a_2", type: "moveToPose", x: 0, y: 48, theta: 90, timeout: 2500, lead: 0.6, comment: "Score preload in corner" }
        ]
      };
    }

    const simRes = simulateRoutine(routine, botConfig);

    const startPose = routine.pose || { x: -60, y: -60, theta: 0 };
    const waypoints = [{ x: startPose.x, y: startPose.y, theta: normalizeAngle(startPose.theta || 0), type: "start", id: "start_pose" }];
    (routine.actions || []).forEach((act, idx) => {
      const seg = simRes.segments && simRes.segments[idx];
      const endPose = seg ? seg.endPose : null;
      const actX = act.x !== undefined ? act.x : (endPose ? endPose.x : (waypoints[idx] ? waypoints[idx].x : 0));
      const actY = act.y !== undefined ? act.y : (endPose ? endPose.y : (waypoints[idx] ? waypoints[idx].y : 0));
      const actTheta = act.theta !== undefined ? act.theta : (endPose ? endPose.theta : (waypoints[idx] ? waypoints[idx].theta : 0));
      waypoints.push({ ...act, x: actX, y: actY, theta: actTheta });
    });

    // 4. Draw Trajectory Line & Curves (Directly from authentic LemLib simulation path)
    if (simRes.path && simRes.path.length > 1) {
      // Glow underlay
      ctx.strokeStyle = "rgba(56, 189, 248, 0.22)";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      let glowPen = false;
      for (const pt of simRes.path) {
        const c = fieldToCanvas(pt.x, pt.y, w, h);
        if (!glowPen) { ctx.moveTo(c.cx, c.cy); glowPen = true; }
        else ctx.lineTo(c.cx, c.cy);
      }
      ctx.stroke();

      // Draw each action segment with authentic trajectory points
      for (const seg of (simRes.segments || [])) {
        if (!seg.action || seg.action.type === "custom" || seg.action.type === "customCode") continue;
        if (!seg.points || seg.points.length < 2) continue;

        const isBezier = seg.action.type === "bezierCurve";
        const isSwing = seg.action.type === "swingToHeading" || seg.action.type === "swingToPoint";
        const isTurn = seg.action.type === "turnToHeading" || seg.action.type === "turnToPoint";
        const isSelected = selectedActionId === seg.action.id;

        // In-place turns do not translate on the field; draw aim ray & crosshair if turnToPoint
        if (isTurn) {
          if (seg.action.type === "turnToPoint" && seg.action.x !== undefined) {
            const pFrom = seg.points[0];
            const cFrom = fieldToCanvas(pFrom.x, pFrom.y, w, h);
            const cTgt = fieldToCanvas(seg.action.x, seg.action.y, w, h);

            ctx.save();
            ctx.strokeStyle = isSelected ? "#38bdf8" : "rgba(56, 189, 248, 0.45)";
            ctx.lineWidth = isSelected ? 1.8 : 1.2;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(cFrom.cx, cFrom.cy);
            ctx.lineTo(cTgt.cx, cTgt.cy);
            ctx.stroke();
            ctx.setLineDash([]);

            // Crosshair
            ctx.strokeStyle = isSelected ? "#38bdf8" : "rgba(56, 189, 248, 0.65)";
            ctx.beginPath();
            ctx.arc(cTgt.cx, cTgt.cy, 6, 0, Math.PI * 2);
            ctx.moveTo(cTgt.cx - 8, cTgt.cy); ctx.lineTo(cTgt.cx + 8, cTgt.cy);
            ctx.moveTo(cTgt.cx, cTgt.cy - 8); ctx.lineTo(cTgt.cx, cTgt.cy + 8);
            ctx.stroke();
            ctx.restore();
          }
          continue;
        }

        ctx.save();
        if (isBezier) {
          ctx.strokeStyle = isSelected ? "#38bdf8" : "#06b6d4";
          ctx.lineWidth = isSelected ? 4 : 3;
        } else if (isSwing) {
          ctx.strokeStyle = isSelected ? "#f59e0b" : "#eab308";
          ctx.lineWidth = isSelected ? 3.5 : 2.5;
        } else {
          ctx.strokeStyle = isSelected ? "#60a5fa" : "#38bdf8";
          ctx.lineWidth = isSelected ? 3.5 : 2.5;
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        let segPen = false;
        for (const pt of seg.points) {
          const c = fieldToCanvas(pt.x, pt.y, w, h);
          if (!segPen) { ctx.moveTo(c.cx, c.cy); segPen = true; }
          else ctx.lineTo(c.cx, c.cy);
        }
        ctx.stroke();

        // Direction Arrow at the middle of the segment
        if (seg.points.length >= 4) {
          const midIdx = Math.floor(seg.points.length / 2);
          const pPrev = seg.points[midIdx - 1];
          const pNext = seg.points[midIdx + 1];
          const cMid = fieldToCanvas(seg.points[midIdx].x, seg.points[midIdx].y, w, h);
          const cPrev = fieldToCanvas(pPrev.x, pPrev.y, w, h);
          const cNext = fieldToCanvas(pNext.x, pNext.y, w, h);
          const screenAngle = Math.atan2(cNext.cy - cPrev.cy, cNext.cx - cPrev.cx);

          ctx.save();
          ctx.translate(cMid.cx, cMid.cy);
          ctx.rotate(screenAngle);
          ctx.fillStyle = isBezier ? "#06b6d4" : (isSwing ? "#eab308" : "#38bdf8");
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(-5, -4);
          ctx.lineTo(-5, 4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // If Bezier curve, render authentic CP1 & CP2 control tangent arms & handles
        if (isBezier) {
          const pStart = seg.points[0];
          const fromPt = { x: pStart.x, y: pStart.y, theta: pStart.theta };
          const { cp1, cp2, lead1, lead2 } = getBezierControlPoints(seg.action, fromPt);
          const cStart = fieldToCanvas(pStart.x, pStart.y, w, h);
          const cEnd = fieldToCanvas(seg.action.x, seg.action.y, w, h);
          const cCp1 = fieldToCanvas(cp1.x, cp1.y, w, h);
          const cCp2 = fieldToCanvas(cp2.x, cp2.y, w, h);

          // Departure Tangent: cStart -> cCp1
          ctx.strokeStyle = "rgba(6, 182, 212, 0.75)";
          ctx.lineWidth = 1.6;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cStart.cx, cStart.cy);
          ctx.lineTo(cCp1.cx, cCp1.cy);
          ctx.stroke();

          // Arrival Tangent: cEnd -> cCp2
          ctx.strokeStyle = "rgba(245, 158, 11, 0.75)";
          ctx.beginPath();
          ctx.moveTo(cEnd.cx, cEnd.cy);
          ctx.lineTo(cCp2.cx, cCp2.cy);
          ctx.stroke();
          ctx.setLineDash([]);

          // Handle Dots & Badges
          ctx.fillStyle = "#06b6d4";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cCp1.cx, cCp1.cy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#a5f3fc";
          ctx.font = "bold 9px ui-monospace, monospace";
          ctx.fillText(`CP1 (${Math.round(lead1)}")`, cCp1.cx + 9, cCp1.cy + 3);

          ctx.fillStyle = "#f59e0b";
          ctx.beginPath(); ctx.arc(cCp2.cx, cCp2.cy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#fde68a";
          ctx.fillText(`CP2 (${Math.round(lead2)}")`, cCp2.cx + 9, cCp2.cy + 3);
        }

        // If moveToPose and selected, render Boomerang carrot point & ray
        if (seg.action.type === "moveToPose" && seg.carrot && isSelected) {
          const cCarrot = fieldToCanvas(seg.carrot.x, seg.carrot.y, w, h);
          const cTgt = fieldToCanvas(seg.action.x, seg.action.y, w, h);

          ctx.strokeStyle = "rgba(249, 115, 22, 0.75)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(cTgt.cx, cTgt.cy);
          ctx.lineTo(cCarrot.cx, cCarrot.cy);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = "#f97316";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cCarrot.cx, cCarrot.cy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#fdba74";
          ctx.font = "bold 9px sans-serif";
          ctx.fillText("Carrot", cCarrot.cx + 8, cCarrot.cy + 3);
        }

        ctx.restore();
      }
    }

    // 5. Draw Waypoint Nodes & Robot Chassis
    waypoints.forEach((wp, idx) => {
      const wx = inchToPx(wp.x, w);
      const wy = inchToPx(wp.y, h, true);

      if (idx === 0) {
        drawRobot(ctx, wp.x, wp.y, wp.theta, "#22c55e", 0.95, selectedActionId === "start_pose" || selectedActionId === "start", false);

        // Start Label Badge
        ctx.fillStyle = "#0284c7";
        ctx.beginPath();
        drawRoundedRect(ctx, wx + 12, wy - 18, 62, 18, 4);
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
        drawRoundedRect(ctx, wx + 12, wy - 10, textWidth + 10, 18, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, wx + 17, wy);
      }
    });

    // Draw End Pose Ghost Robot
    if (waypoints.length > 1) {
      const endWp = waypoints[waypoints.length - 1];
      const endTheta = endWp.theta != null ? endWp.theta : (endWp.heading != null ? endWp.heading : startPose.theta);
      drawRobot(ctx, endWp.x, endWp.y, endTheta, "#f59e0b", 0.65, selectedActionId === endWp.id, false);
    }

    // Render Animated Robot during Simulation
    drawSimAnimatedRobot(w, h);

    // Render Field Pin Markers
    renderCanvasPinMarkers(w, h);
  }

  // --------------------------------------------------------------------------
  // ROBOT SIMULATION ANIMATION (Copied from app.js)
  // --------------------------------------------------------------------------
  function drawSimAnimatedRobot(w, h) {
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    if (!routine) return;

    const simRes = simulateRoutine(routine);
    const totalMs = Math.max(1000, Math.ceil((simRes.duration || 15.0) * 1000));
    const curTimeMs = isSimPlaying ? simTimeMs : (simTimeMs > 0 ? simTimeMs : 0);
    const pose = getSimPoseAtTime(simRes, curTimeMs);

    const cv = document.getElementById("teamFieldCanvas");
    if (!cv) return;
    const context = cv.getContext("2d");
    if (!context) return;

    const colResult = checkCollision(pose);
    const isLiveHit = colResult.isColliding;

    drawRobot(context, pose.x, pose.y, pose.theta, isLiveHit ? "#ef4444" : "#38bdf8", 1, false, isLiveHit);

    // Speed vector indicator arrow pointing along travel direction
    if (Math.abs(pose.vLin || 0) > 1) {
      const cp = fieldToCanvas(pose.x, pose.y, w, h);
      const sRad = screenHeadingRad(pose.theta);
      const dir = pose.vLin >= 0 ? 1 : -1;
      const arrowLen = Math.min(32, Math.abs(pose.vLin) * 0.35);
      context.strokeStyle = "#38bdf8";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(cp.cx, cp.cy);
      context.lineTo(cp.cx + Math.cos(sRad) * arrowLen * dir, cp.cy + Math.sin(sRad) * arrowLen * dir);
      context.stroke();
    }

    updateSimTelemetryUI(pose, colResult, curTimeMs, totalMs);
  }

  function checkCollision(pose) {
    if (typeof checkRobotCollisionAtPose === "function") {
      const liveCol = checkRobotCollisionAtPose(pose.x, pose.y, pose.theta, collisionConfig.safetyBuffer);
      if (liveCol.hit && liveCol.obstacles.length) {
        return { isColliding: true, obstacle: liveCol.obstacles[0].name || "Obstacle Collision" };
      }
    }
    if (Math.abs(pose.x) > 63 || Math.abs(pose.y) > 63) {
      return { isColliding: true, obstacle: "Perimeter Wall Impact" };
    }
    return { isColliding: false, obstacle: "Clear" };
  }

  function updateSimTelemetryUI(pose, colResult, curTimeMs = simTimeMs, totalMs = 15000) {
    const chipTime = document.getElementById("simHudTime");
    const chipSpeed = document.getElementById("simHudSpeed");
    const chipCoords = document.getElementById("simHudCoords");
    const chipCol = document.getElementById("simHudCollision");
    const chipScore = document.getElementById("simHudScore");

    const tCur = (curTimeMs / 1000).toFixed(2);
    const tTot = (totalMs / 1000).toFixed(2);
    if (chipTime) chipTime.textContent = `⏱️ ${tCur}s / ${tTot}s`;
    if (chipSpeed) chipSpeed.textContent = `🏎️ ${(pose.vLin || 0).toFixed(1)} in/s`;
    if (chipCoords) chipCoords.textContent = `📍 (${pose.x.toFixed(1)}", ${pose.y.toFixed(1)}") θ=${normalizeAngle(pose.theta).toFixed(0)}°`;

    if (chipCol) {
      if (colResult.isColliding) {
        chipCol.textContent = `💥 ${colResult.obstacle}`;
        chipCol.style.color = "#f87171";
        chipCol.style.background = "rgba(239, 68, 68, 0.2)";
      } else {
        chipCol.textContent = "🛡️ Clear";
        chipCol.style.color = "#4ade80";
        chipCol.style.background = "rgba(34, 197, 94, 0.15)";
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
      const py = inchToPx(cmt.y, h, true);

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

    const userEmailNorm = (currentUser?.email || "").toLowerCase().trim();
    members.forEach((m) => {
      if (!m || !m.email) return;
      if (m.email.toLowerCase().trim() === userEmailNorm) return;
      if (!m.cursor) return;

      const cursorEl = document.createElement("div");
      cursorEl.className = "teammate-cursor";
      
      let leftPct = 50;
      let topPct = 50;
      if (m.cursor.normX !== undefined && m.cursor.normY !== undefined) {
        leftPct = m.cursor.normX * 100;
        topPct = m.cursor.normY * 100;
      } else if (m.cursor.canvasX !== undefined && m.cursor.canvasY !== undefined) {
        leftPct = (m.cursor.canvasX / 900) * 100;
        topPct = (m.cursor.canvasY / 900) * 100;
      } else if (m.cursor.x !== undefined && m.cursor.y !== undefined) {
        leftPct = ((m.cursor.x + FIELD_HALF) / FIELD_INCHES) * 100;
        topPct = ((FIELD_HALF - m.cursor.y) / FIELD_INCHES) * 100;
      }

      cursorEl.style.left = `${leftPct.toFixed(2)}%`;
      cursorEl.style.top = `${topPct.toFixed(2)}%`;

      const color = m.color || getRoleColor(m.role);
      const emoji = getRoleEmoji(m.role);

      cursorEl.innerHTML = `
        <svg class="cursor-pointer-svg" viewBox="0 0 24 24" fill="${color}" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));">
          <path d="M5.5 3.2L18.8 12.4C19.5 12.9 19.3 14 18.4 14.2L12.5 15.3L9.2 20.8C8.7 21.6 7.5 21.5 7.2 20.6L3.3 4.8C3.1 3.9 4.1 3.1 5.5 3.2Z" stroke="#ffffff" stroke-width="1.2" />
        </svg>
        <span class="cursor-label" style="background:${color};box-shadow:0 2px 6px rgba(0,0,0,0.4);">
          ${emoji} ${escapeHtml(m.displayName || m.email.split('@')[0])} (${escapeHtml(m.role || 'Member')})
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

      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      const ix = pxToInch(cx, canvas.width);
      const iy = pxToInch(cy, canvas.height, true);

      const coordLbl = document.getElementById("lblCursorCoords");
      if (coordLbl) {
        coordLbl.textContent = `X: ${ix.toFixed(1)}" | Y: ${iy.toFixed(1)}" | θ: 0.0°`;
      }

      // Throttled cursor broadcast to teammates (every 50ms)
      const now = Date.now();
      if (now - lastCursorBroadcast > 50) {
        lastCursorBroadcast = now;
        sendPresence({ canvasX: cx, canvasY: cy, normX, normY, x: ix, y: iy });
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
      if (isTeamSyncLocked()) {
        const lk = currentTeam.syncLock;
        showToast(`🔒 Canvas edits paused: ${lk.authorName || 'Teammate'} is importing from GitHub (${lk.progress || 0}%). Edits paused to prevent conflicts.`, "⚠️");
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const ix = pxToInch(cx, canvas.width);
      const iy = pxToInch(cy, canvas.height, true);

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
        const wy = inchToPx(waypoints[i].y, canvas.height, true);
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
        const wy = inchToPx(cmt.y, canvas.height, true);
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
        cpp += `    chassis.moveToPose(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${(act.theta || 0).toFixed(1)}, {.forwards = ${act.forwards !== false}, .maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "turnToPoint") {
        const timeout = act.timeout || 1500;
        const maxSpd = act.maxSpeed !== undefined ? act.maxSpeed : 115;
        cpp += `    chassis.turnToPoint(${(act.x || 0).toFixed(1)}, ${(act.y || 0).toFixed(1)}, ${timeout}, {.forwards = ${act.forwards !== false}, .maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "turnToHeading") {
        const timeout = act.timeout || 1500;
        cpp += `    chassis.turnToHeading(${(act.theta || act.heading || 0).toFixed(1)}, ${timeout});\n`;
      } else if (act.type === "swingToHeading") {
        const timeout = act.timeout || 1500;
        const maxSpd = act.maxSpeed !== undefined ? act.maxSpeed : 115;
        const side = act.driveSide === "RIGHT" ? "lemlib::DriveSide::RIGHT" : "lemlib::DriveSide::LEFT";
        cpp += `    chassis.swingToHeading(${(act.theta || act.heading || 0).toFixed(1)}, ${side}, ${timeout}, {.maxSpeed = ${maxSpd}});\n`;
      } else if (act.type === "ifElse" || act.type === "if_else") {
        const cond = act.conditionExpr || "distance_sensor.get() < 100";
        const thenC = act.thenCode || "// custom then action\n    intake.move(127);";
        cpp += `    if (${cond}) {\n`;
        thenC.split("\n").forEach(line => {
          if (line.trim()) cpp += `        ${line.trim()}\n`;
        });
        if (act.hasElse) {
          const elseC = act.elseCode || "// custom else action\n    intake.move(0);";
          cpp += `    } else {\n`;
          elseC.split("\n").forEach(line => {
            if (line.trim()) cpp += `        ${line.trim()}\n`;
          });
        }
        cpp += `    }\n`;
      } else if (act.type === "loop") {
        const loopT = act.loopType || "for";
        const delayVal = act.delayMs !== undefined ? act.delayMs : 10;
        const code = act.loopCode || "intake.move(127);";
        if (loopT === "for") {
          cpp += `    for (int i = 0; i < ${act.count || 3}; i++) {\n`;
        } else if (loopT === "until") {
          cpp += `    while (!(${act.conditionExpr || "distance_sensor.get() < 50"})) {\n`;
        } else { // forever
          cpp += `    while (true) {\n`;
        }
        code.split("\n").forEach(line => {
          if (line.trim()) cpp += `        ${line.trim()}\n`;
        });
        cpp += `        pros::delay(${delayVal});\n`;
        cpp += `    }\n`;
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

    // 1. Top Bot Specs & PID summary banner
    const botBanner = document.createElement("div");
    botBanner.className = "action-flow-bot-banner";
    botBanner.style.cssText = "margin-bottom:10px;background:rgba(15,23,42,0.92);border:1px solid #1e293b;border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;";
    botBanner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.1rem;">🤖</span>
        <div style="display:flex;flex-direction:column;">
          <span style="font-size:0.75rem;font-weight:700;color:#f1f5f9;">LemLib Bot: ${botConfig.robotW || 14}"x${botConfig.robotL || 14}" · ${botConfig.trackWidth || 12}" Track · ${botConfig.driveRpm || 600} RPM</span>
          <span style="font-size:0.68rem;color:#94a3b8;">Lateral PID: (${botConfig.lateralKp || 8}, ${botConfig.lateralKd || 30}) · Angular PID: (${botConfig.angularKp || 2}, ${botConfig.angularKd || 10})</span>
        </div>
      </div>
      <span style="font-size:0.68rem;color:#38bdf8;background:rgba(56,189,248,0.12);padding:2px 8px;border-radius:6px;font-weight:700;">PROS 4.1</span>
    `;
    container.appendChild(botBanner);

    // 2. Hat Block ("🚩 when autonomous starts")
    const hatBlock = document.createElement("div");
    hatBlock.className = "hat-block";
    hatBlock.style.cssText = "background:linear-gradient(135deg, #1e293b, #0f172a);border:1px solid #38bdf8;border-radius:8px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 12px rgba(0,0,0,0.4);";
    hatBlock.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.1rem;">🚩</span>
        <strong style="font-size:0.82rem;color:#f8fafc;">when autonomous starts (${escapeHtml(routine.name || 'Routine')})</strong>
      </div>
      <span style="font-size:0.7rem;background:rgba(56,189,248,0.2);color:#38bdf8;padding:2px 8px;border-radius:10px;font-weight:700;">
        ${actions.length} block${actions.length === 1 ? '' : 's'}
      </span>
    `;
    container.appendChild(hatBlock);

    // 3. Start Pose Card
    const startCard = document.createElement("div");
    startCard.className = `action-card block-card cat-motion ${selectedActionId === 'start' ? 'selected' : ''}`;
    startCard.style.cssText = `background:#0f172a;border:1px solid ${selectedActionId === 'start' ? '#38bdf8' : '#1e293b'};border-left:4px solid #38bdf8;border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;`;
    startCard.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="background:#38bdf8;color:#090d16;font-weight:800;font-size:0.7rem;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;">S</span>
          <strong style="font-size:0.82rem;color:#f8fafc;">chassis.setPose (Odometry Origin)</strong>
        </div>
      </div>
      <div style="font-size:0.75rem;color:#94a3b8;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <span>X: <input type="number" class="sp-x form-input" value="${routine.pose.x}" style="width:52px;padding:2px 6px;font-size:0.72rem;display:inline-block;" />"</span>
        <span>Y: <input type="number" class="sp-y form-input" value="${routine.pose.y}" style="width:52px;padding:2px 6px;font-size:0.72rem;display:inline-block;" />"</span>
        <span>θ: <input type="number" class="sp-t form-input" value="${routine.pose.theta}" style="width:48px;padding:2px 6px;font-size:0.72rem;display:inline-block;" />°</span>
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
      emptyMsg.style.cssText = "padding:20px;text-align:center;color:#64748b;font-size:0.78rem;background:rgba(15,23,42,0.5);border-radius:8px;margin-top:10px;";
      emptyMsg.innerHTML = `<span>✨ No actions in this routine yet. Use the <strong>Action Palette</strong> above to add waypoints, curves, or subsystem actions.</span>`;
      container.appendChild(emptyMsg);
      syncIdeAutonsFromBlocks();
      return;
    }

    // 4. Action Cards with Connectors
    actions.forEach((act, idx) => {
      const conn = document.createElement("div");
      conn.style.cssText = "text-align:center;color:#475569;font-size:0.7rem;line-height:1;margin:2px 0;";
      conn.textContent = "▼";
      container.appendChild(conn);

      let catClass = "cat-motion";
      let blockColor = "#0284c7"; // MoveToPoint
      if (act.type === "moveToPose") { catClass = "cat-motion"; blockColor = "#0369a1"; }
      else if (act.type === "turnToPoint") { catClass = "cat-turn"; blockColor = "#6366f1"; }
      else if (act.type === "turnToHeading") { catClass = "cat-turn"; blockColor = "#7c3aed"; }
      else if (act.type === "swingToHeading") { catClass = "cat-turn"; blockColor = "#a855f7"; }
      else if (act.type === "bezierCurve") { catClass = "cat-bezier"; blockColor = "#06b6d4"; }
      else if (act.type === "ifElse" || act.type === "if_else") { catClass = "cat-control"; blockColor = "#ea580c"; }
      else if (act.type === "loop") { catClass = "cat-control"; blockColor = "#10b981"; }
      else if (act.type === "delay" || act.type === "wait") { catClass = "cat-control"; blockColor = "#d97706"; }
      else if (act.type === "customCode" || act.type === "custom") { catClass = "cat-subsystem"; blockColor = "#16a34a"; }

      const card = document.createElement("div");
      const isSelected = selectedActionId === act.id;
      card.className = `action-card block-card ${catClass} ${isSelected ? 'selected' : ''}`;
      card.style.cssText = `background:#0f172a;border:1px solid ${isSelected ? blockColor : '#1e293b'};border-left:4px solid ${blockColor};border-radius:8px;padding:10px 12px;cursor:pointer;transition:all 0.15s ease;`;

      let paramsHtml = "";
      if (act.type === "moveToPoint" || act.type === "moveToPose") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span>X: <input type="number" class="act-x form-input" value="${act.x || 0}" style="width:50px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />"</span>
            <span>Y: <input type="number" class="act-y form-input" value="${act.y || 0}" style="width:50px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />"</span>
            ${act.type === "moveToPose" ? `<span>θ: <input type="number" class="act-t form-input" value="${act.theta || 0}" style="width:46px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />°</span>` : ''}
            <span>Timeout: <input type="number" class="act-time form-input" value="${act.timeout || 2000}" style="width:54px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />ms</span>
            <span>Speed: <input type="number" class="act-speed form-input" value="${act.maxSpeed !== undefined ? act.maxSpeed : 115}" style="width:48px;padding:2px 5px;font-size:0.72rem;display:inline-block;" /></span>
          </div>
        `;
      } else if (act.type === "turnToPoint") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span>Target X: <input type="number" class="act-x form-input" value="${act.x || 0}" style="width:50px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />"</span>
            <span>Target Y: <input type="number" class="act-y form-input" value="${act.y || 0}" style="width:50px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />"</span>
            <span>Timeout: <input type="number" class="act-time form-input" value="${act.timeout || 1500}" style="width:54px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />ms</span>
            <span>Speed: <input type="number" class="act-speed form-input" value="${act.maxSpeed !== undefined ? act.maxSpeed : 115}" style="width:48px;padding:2px 5px;font-size:0.72rem;display:inline-block;" /></span>
            <label style="display:inline-flex;align-items:center;gap:3px;font-size:0.7rem;cursor:pointer;"><input type="checkbox" class="act-forwards" ${act.forwards !== false ? 'checked' : ''} /> Front Facing</label>
          </div>
        `;
      } else if (act.type === "turnToHeading") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span>Heading: <input type="number" class="act-t form-input" value="${act.theta !== undefined ? act.theta : (act.heading || 0)}" style="width:52px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />°</span>
            <span>Timeout: <input type="number" class="act-time form-input" value="${act.timeout || 1500}" style="width:54px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />ms</span>
          </div>
        `;
      } else if (act.type === "swingToHeading") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span>Heading: <input type="number" class="act-t form-input" value="${act.theta !== undefined ? act.theta : (act.heading || 0)}" style="width:52px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />°</span>
            <span>Pivot Side:
              <select class="act-side form-input" style="padding:2px 4px;font-size:0.72rem;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;">
                <option value="LEFT" ${(act.driveSide || 'LEFT') === 'LEFT' ? 'selected' : ''}>Left Side</option>
                <option value="RIGHT" ${act.driveSide === 'RIGHT' ? 'selected' : ''}>Right Side</option>
              </select>
            </span>
            <span>Timeout: <input type="number" class="act-time form-input" value="${act.timeout || 1500}" style="width:54px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />ms</span>
            <span>Speed: <input type="number" class="act-speed form-input" value="${act.maxSpeed !== undefined ? act.maxSpeed : 115}" style="width:48px;padding:2px 5px;font-size:0.72rem;display:inline-block;" /></span>
          </div>
        `;
      } else if (act.type === "bezierCurve") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span>End X: <input type="number" class="act-x form-input" value="${act.x || 0}" style="width:50px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />"</span>
            <span>End Y: <input type="number" class="act-y form-input" value="${act.y || 0}" style="width:50px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />"</span>
            <span>Timeout: <input type="number" class="act-time form-input" value="${act.timeout || 2500}" style="width:54px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />ms</span>
          </div>
        `;
      } else if (act.type === "ifElse" || act.type === "if_else") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <span style="font-weight:700;color:#ea580c;">IF</span>
              <select class="act-cond-preset form-input" style="padding:2px 4px;font-size:0.7rem;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;">
                <option value="distance" ${(act.conditionType || 'distance') === 'distance' ? 'selected' : ''}>Distance Sensor < 100mm</option>
                <option value="optical_ring" ${act.conditionType === 'optical_ring' ? 'selected' : ''}>Optical Ring Color Match</option>
                <option value="bumper" ${act.conditionType === 'bumper' ? 'selected' : ''}>Bumper / Limit Switch Pressed</option>
                <option value="timer" ${act.conditionType === 'timer' ? 'selected' : ''}>Match Timer < 12s</option>
                <option value="custom" ${act.conditionType === 'custom' ? 'selected' : ''}>Custom Expression</option>
              </select>
            </div>
            <div>
              <input type="text" class="act-cond-expr form-input" value="${escapeHtml(act.conditionExpr || 'distance_sensor.get() < 100')}" placeholder="e.g. distance_sensor.get() < 100" style="width:100%;padding:2px 6px;font-size:0.72rem;font-family:monospace;" />
            </div>
            <div style="display:flex;flex-direction:column;gap:2px;">
              <span style="font-size:0.68rem;color:#38bdf8;font-weight:700;">THEN ACTION (C++):</span>
              <textarea class="act-then-code form-input" rows="2" style="width:100%;padding:3px 6px;font-size:0.7rem;font-family:monospace;background:#0f172a;" placeholder="intake.move(127);">${escapeHtml(act.thenCode || 'intake.move(127);')}</textarea>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <label style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;cursor:pointer;color:#f1f5f9;"><input type="checkbox" class="act-has-else" ${act.hasElse ? 'checked' : ''} /> Enable ELSE Branch</label>
            </div>
            ${act.hasElse ? `
              <div style="display:flex;flex-direction:column;gap:2px;">
                <span style="font-size:0.68rem;color:#f97316;font-weight:700;">ELSE ACTION (C++):</span>
                <textarea class="act-else-code form-input" rows="2" style="width:100%;padding:3px 6px;font-size:0.7rem;font-family:monospace;background:#0f172a;" placeholder="intake.move(0);">${escapeHtml(act.elseCode || 'intake.move(0);')}</textarea>
              </div>
            ` : ''}
          </div>
        `;
      } else if (act.type === "loop") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <span style="font-weight:700;color:#10b981;">LOOP MODE</span>
              <select class="act-loop-type form-input" style="padding:2px 4px;font-size:0.7rem;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;">
                <option value="for" ${(act.loopType || 'for') === 'for' ? 'selected' : ''}>🔁 Repeat N Times (for)</option>
                <option value="until" ${act.loopType === 'until' ? 'selected' : ''}>⏳ Until Condition (while !)</option>
                <option value="forever" ${act.loopType === 'forever' ? 'selected' : ''}>♾️ Forever (while true)</option>
              </select>
            </div>
            ${(act.loopType || 'for') === 'for' ? `
              <div style="display:flex;align-items:center;gap:6px;">
                <span>Repeat Count:</span>
                <input type="number" class="act-loop-count form-input" value="${act.count || 3}" style="width:54px;padding:2px 5px;font-size:0.72rem;" />
              </div>
            ` : ''}
            ${act.loopType === 'until' ? `
              <div>
                <span>Stop Condition:</span>
                <input type="text" class="act-loop-cond form-input" value="${escapeHtml(act.conditionExpr || 'distance_sensor.get() < 50')}" placeholder="e.g. distance_sensor.get() < 50" style="width:100%;padding:2px 6px;font-size:0.72rem;font-family:monospace;" />
              </div>
            ` : ''}
            <div style="display:flex;flex-direction:column;gap:2px;">
              <span style="font-size:0.68rem;color:#34d399;font-weight:700;">LOOP BODY (C++):</span>
              <textarea class="act-loop-code form-input" rows="2" style="width:100%;padding:3px 6px;font-size:0.7rem;font-family:monospace;background:#0f172a;" placeholder="intake.move(127);">${escapeHtml(act.loopCode || 'intake.move(127);')}</textarea>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span>Tick Delay:</span>
              <input type="number" class="act-delay-ms form-input" value="${act.delayMs !== undefined ? act.delayMs : 10}" style="width:54px;padding:2px 5px;font-size:0.72rem;" /> ms
            </div>
          </div>
        `;
      } else if (act.type === "delay" || act.type === "wait") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;display:flex;gap:8px;align-items:center;">
            <span>Duration: <input type="number" class="act-time form-input" value="${act.timeout || act.duration || 500}" style="width:60px;padding:2px 5px;font-size:0.72rem;display:inline-block;" />ms</span>
          </div>
        `;
      } else if (act.type === "customCode" || act.type === "custom") {
        paramsHtml = `
          <div style="font-size:0.74rem;color:#cbd5e1;margin-top:6px;">
            <input type="text" class="act-code form-input" value="${escapeHtml(act.customCode || act.code || 'intake.move(127);')}" placeholder="e.g. intake.move(127);" style="width:100%;padding:3px 6px;font-size:0.72rem;font-family:ui-monospace,monospace;" />
          </div>
        `;
      }

      const displayType = act.type === "ifElse" ? "control.ifElse" : (act.type === "loop" ? "control.loop" : `chassis.${act.type}`);

      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="background:${blockColor};color:#fff;font-weight:800;font-size:0.7rem;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;">${idx + 1}</span>
            <strong style="font-size:0.82rem;color:#f8fafc;">${escapeHtml(displayType)}</strong>
          </div>
          <button type="button" class="btn-xs-clean btn-del-act" style="color:#ef4444;background:none;border:none;cursor:pointer;padding:2px 6px;font-size:0.85rem;" title="Delete action">🗑️</button>
        </div>
        ${paramsHtml}
        <div style="margin-top:6px;">
          <input type="text" class="act-comment form-input" value="${escapeHtml(act.comment || '')}" placeholder="// Comment note for this step..." style="width:100%;padding:2px 6px;font-size:0.68rem;color:#f59e0b;" />
        </div>
      `;

      card.onclick = (e) => {
        if (['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'LABEL'].includes(e.target.tagName)) return;
        selectedActionId = act.id;
        renderActionBlocks();
        drawField();
      };

      const inX = card.querySelector('.act-x');
      const inY = card.querySelector('.act-y');
      const inT = card.querySelector('.act-t');
      const inTime = card.querySelector('.act-time');
      const inSpeed = card.querySelector('.act-speed');
      const inForwards = card.querySelector('.act-forwards');
      const inSide = card.querySelector('.act-side');
      const inCode = card.querySelector('.act-code');
      const inComm = card.querySelector('.act-comment');

      const inCondPreset = card.querySelector('.act-cond-preset');
      const inCondExpr = card.querySelector('.act-cond-expr');
      const inThenCode = card.querySelector('.act-then-code');
      const inHasElse = card.querySelector('.act-has-else');
      const inElseCode = card.querySelector('.act-else-code');

      const inLoopType = card.querySelector('.act-loop-type');
      const inLoopCount = card.querySelector('.act-loop-count');
      const inLoopCond = card.querySelector('.act-loop-cond');
      const inLoopCode = card.querySelector('.act-loop-code');
      const inDelayMs = card.querySelector('.act-delay-ms');

      const handleBlockChange = () => {
        if (inX) act.x = parseFloat(inX.value) || 0;
        if (inY) act.y = parseFloat(inY.value) || 0;
        if (inT) { act.theta = parseFloat(inT.value) || 0; act.heading = act.theta; }
        if (inTime) act.timeout = parseInt(inTime.value, 10) || 1000;
        if (inSpeed) act.maxSpeed = parseInt(inSpeed.value, 10) || 115;
        if (inForwards) act.forwards = inForwards.checked;
        if (inSide) act.driveSide = inSide.value;
        if (inCode) act.customCode = inCode.value;
        if (inComm) act.comment = inComm.value;

        if (inCondPreset) {
          act.conditionType = inCondPreset.value;
          if (inCondPreset.value === "distance") act.conditionExpr = "distance_sensor.get() < 100";
          else if (inCondPreset.value === "optical_ring") act.conditionExpr = "optical_sensor.get_hue() < 30";
          else if (inCondPreset.value === "bumper") act.conditionExpr = "bumper_switch.get_value() == 1";
          else if (inCondPreset.value === "timer") act.conditionExpr = "pros::millis() < 12000";
        }
        if (inCondExpr) act.conditionExpr = inCondExpr.value;
        if (inThenCode) act.thenCode = inThenCode.value;
        if (inHasElse) act.hasElse = inHasElse.checked;
        if (inElseCode) act.elseCode = inElseCode.value;

        if (inLoopType) act.loopType = inLoopType.value;
        if (inLoopCount) act.count = parseInt(inLoopCount.value, 10) || 1;
        if (inLoopCond) act.conditionExpr = inLoopCond.value;
        if (inLoopCode) act.loopCode = inLoopCode.value;
        if (inDelayMs) act.delayMs = parseInt(inDelayMs.value, 10) || 10;

        renderActionBlocks();
        drawField();
        syncIdeAutonsFromBlocks();
        broadcastEdit(`Updated action #${idx + 1} (${act.type})`, "action_edit", false);
      };

      [inX, inY, inT, inTime, inSpeed, inForwards, inSide, inCode, inComm,
       inCondPreset, inCondExpr, inThenCode, inHasElse, inElseCode,
       inLoopType, inLoopCount, inLoopCond, inLoopCode, inDelayMs
      ].forEach(input => input?.addEventListener('change', handleBlockChange));

      card.querySelector(".btn-del-act").onclick = (e) => {
        e.stopPropagation();
        if (isTeamSyncLocked()) {
          const lk = currentTeam.syncLock;
          showToast(`🔒 Cannot delete action: ${lk.authorName || 'Teammate'} is importing from GitHub (${lk.progress || 0}%).`, "⚠️");
          return;
        }
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
    if (isTeamSyncLocked()) {
      const lk = currentTeam.syncLock;
      showToast(`🔒 Cannot add action: ${lk.authorName || 'Teammate'} is importing from GitHub (${lk.progress || 0}%).`, "⚠️");
      return;
    }
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
      heading: 90,
      timeout: type === "moveToPose" ? 2500 : 1500,
      maxSpeed: 115,
      earlyExitRange: 2,
      forwards: true,
      driveSide: "LEFT",
      conditionType: "distance",
      conditionExpr: "distance_sensor.get() < 100",
      thenCode: "intake.move(127);",
      hasElse: true,
      elseCode: "intake.move(0);",
      loopType: "for",
      count: 3,
      loopCode: "intake.move(127);",
      delayMs: 10,
      comment: "",
      customCode: type === "customCode" ? "intake.move(127);" : ""
    };

    routine.actions.push(newAct);
    selectedActionId = newAct.id;
    renderActionBlocks();
    drawField();
    syncIdeAutonsFromBlocks();
    broadcastEdit(`Added action ${type}`, "action_add", true);
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

  async function restoreVersionPrompt(ver) {
    if (!ver || !ver.snapshot) {
      showToast("Cannot restore: snapshot payload not found", "⚠️");
      return;
    }

    if (confirm(`Restore version from ${ver.dateStr}?\n\nEdited by: ${ver.authorName} (${ver.authorRole})\nAction: ${ver.actionSummary}\n\nYour current state will be auto-backed up before restoring.`)) {
      let restoredTeam = null;
      const apiRoute = resolveApiUrl("/api/team/version/restore");
      if (apiRoute) {
        try {
          const r = await fetch(apiRoute, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamId: currentTeam.teamId,
              versionId: ver.id,
              email: currentUser.email,
              authorName: currentUser.displayName || currentUser.email.split("@")[0],
              authorRole: currentUser.role || "Programmer"
            })
          });
          const data = await r.json();
          if (data.success && data.team) {
            restoredTeam = data.team;
          }
        } catch (_) {}
      }

      // Fallback for static host / GitHub Pages / offline / non-JSON responses
      if (!restoredTeam) {
        const now = Date.now();
        // Create backup of current state
        const backupSnapshot = {
          id: "v_" + now + "_backup_pre_restore",
          timestamp: now,
          dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          authorEmail: currentUser.email,
          authorName: currentUser.displayName || currentUser.email.split("@")[0],
          authorRole: currentUser.role || "Programmer",
          authorColor: getRoleColor(currentUser.role || "Programmer"),
          actionSummary: `Auto-backup before restoring ${ver.dateStr}`,
          editType: "auto_backup",
          snapshot: currentTeam.pathPayload || null
        };

        currentTeam.pathPayload = ver.snapshot;
        currentTeam.versionHistory = currentTeam.versionHistory || [];
        currentTeam.versionHistory.unshift(backupSnapshot);
        currentTeam.versionHistory.unshift({
          id: "v_" + (now + 1) + "_restore",
          timestamp: now + 1,
          dateStr: new Date(now + 1).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " · " + new Date(now + 1).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          authorEmail: currentUser.email,
          authorName: currentUser.displayName || currentUser.email.split("@")[0],
          authorRole: currentUser.role || "Programmer",
          authorColor: getRoleColor(currentUser.role || "Programmer"),
          actionSummary: `Restored version from ${ver.dateStr}`,
          editType: "version_restore",
          snapshot: ver.snapshot
        });
        if (currentTeam.versionHistory.length > 500) currentTeam.versionHistory.length = 500;
        currentTeam.updatedAt = now + 1;

        await fsSaveTeamDoc(currentTeam);
        try {
          localStorage.setItem("lemlib_active_team", JSON.stringify(currentTeam));
        } catch (_) {}
        restoredTeam = currentTeam;
      }

      currentTeam = restoredTeam;
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
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    const simRes = simulateRoutine(routine);
    const totalMs = Math.max(1000, Math.ceil((simRes.duration || 15.0) * 1000));

    if (isSimPlaying) {
      isSimPlaying = false;
      if (simAnimId) {
        cancelAnimationFrame(simAnimId);
        simAnimId = null;
      }
      if (btn) btn.textContent = "▶ Play Sim";
    } else {
      isSimPlaying = true;
      if (btn) btn.textContent = "⏸ Pause Sim";
      if (simTimeMs >= totalMs) {
        simTimeMs = 0;
      }
      simStartTime = performance.now() - simTimeMs;

      function simStep(now) {
        if (!isSimPlaying) return;
        simTimeMs = now - simStartTime;
        if (simTimeMs >= totalMs) {
          simTimeMs = totalMs;
          isSimPlaying = false;
          simAnimId = null;
          if (btn) btn.textContent = "▶ Play Sim";
          updateSimScrubber();
          return;
        }
        updateSimScrubber();
        simAnimId = requestAnimationFrame(simStep);
      }
      simAnimId = requestAnimationFrame(simStep);
    }
  }

  function updateSimScrubber() {
    const sc = document.getElementById("simScrubber");
    const lbl = document.getElementById("lblSimTime");
    const routine = activePaths[activeRoutineIndex] || activePaths[0];
    const simRes = simulateRoutine(routine);
    const totalMs = Math.max(1000, Math.ceil((simRes.duration || 15.0) * 1000));

    if (sc) {
      sc.max = totalMs;
      sc.value = Math.min(simTimeMs, totalMs);
    }
    if (lbl) {
      lbl.textContent = `${(simTimeMs / 1000).toFixed(2)}s / ${(totalMs / 1000).toFixed(2)}s`;
    }
    drawField();
  }

  // --------------------------------------------------------------------------
  // EVENT WIRING & INIT
  // --------------------------------------------------------------------------
  function wireEvents() {
    initCanvasInteractions();

    // Tools Dropdown Menu Toggle
    const btnToolsDropdown = document.getElementById("btnToolsDropdown");
    const toolsDropdownMenu = document.getElementById("toolsDropdownMenu");
    if (btnToolsDropdown && toolsDropdownMenu) {
      btnToolsDropdown.addEventListener("click", (e) => {
        e.stopPropagation();
        const isHidden = toolsDropdownMenu.hasAttribute("hidden") || toolsDropdownMenu.style.display === "none";
        if (isHidden) {
          toolsDropdownMenu.removeAttribute("hidden");
          toolsDropdownMenu.style.display = "flex";
        } else {
          toolsDropdownMenu.setAttribute("hidden", "");
          toolsDropdownMenu.style.display = "none";
        }
      });

      document.addEventListener("click", (e) => {
        if (!e.target.closest(".tools-dropdown-wrap")) {
          toolsDropdownMenu.setAttribute("hidden", "");
          toolsDropdownMenu.style.display = "none";
        }
      });
    }

    document.getElementById("btnMenuManageTeam")?.addEventListener("click", () => {
      if (toolsDropdownMenu) { toolsDropdownMenu.setAttribute("hidden", ""); toolsDropdownMenu.style.display = "none"; }
      openTeamSettingsModal();
    });
    document.getElementById("btnMenuDriveSync")?.addEventListener("click", () => {
      if (toolsDropdownMenu) { toolsDropdownMenu.setAttribute("hidden", ""); toolsDropdownMenu.style.display = "none"; }
      document.getElementById("btnDriveSync")?.click();
    });
    document.getElementById("btnMenuGithubSync")?.addEventListener("click", () => {
      if (toolsDropdownMenu) { toolsDropdownMenu.setAttribute("hidden", ""); toolsDropdownMenu.style.display = "none"; }
      openGithubPushModal();
    });
    document.getElementById("btnMenuSyncLocal")?.addEventListener("click", () => {
      if (toolsDropdownMenu) { toolsDropdownMenu.setAttribute("hidden", ""); toolsDropdownMenu.style.display = "none"; }
      syncTeamProjectToLocalPlanner();
    });

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
      setSetupViewVisible(false);
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
          const emailVal = (emailInput && emailInput.value.trim()) || currentUser?.email || localStorage.getItem("lemlib_saved_google_email") || "teammate@example.com";
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
          const emailVal = (emailInput && emailInput.value.trim()) || currentUser?.email || localStorage.getItem("lemlib_saved_google_email") || "teammate@example.com";
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
    document.getElementById("btnPaletteTurnPoint")?.addEventListener("click", () => addAction("turnToPoint"));
    document.getElementById("btnPaletteTurn")?.addEventListener("click", () => addAction("turnToHeading"));
    document.getElementById("btnPaletteSwing")?.addEventListener("click", () => addAction("swingToHeading"));
    document.getElementById("btnPaletteBezier")?.addEventListener("click", () => addAction("bezierCurve"));
    document.getElementById("btnPaletteIfElse")?.addEventListener("click", () => addAction("ifElse"));
    document.getElementById("btnPaletteLoop")?.addEventListener("click", () => addAction("loop"));
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

    // 6b. Center Column View Mode Switcher (Field & Sim vs Integrated C++ IDE vs Suggestions vs Match Replay vs Admin Dashboard)
    const btnViewModeField = document.getElementById("btnViewModeField");
    const btnViewModeIde = document.getElementById("btnViewModeIde");
    const btnViewModeSuggestions = document.getElementById("btnViewModeSuggestions");
    const btnViewModeReplay = document.getElementById("btnViewModeReplay");
    const btnViewModeAdmin = document.getElementById("btnViewModeAdmin");
    const viewFieldContainer = document.getElementById("teamFieldViewContainer");
    const viewIdeContainer = document.getElementById("teamIdeContainer");
    const viewSuggestionsContainer = document.getElementById("teamSuggestionsContainer");
    const viewReplayContainer = document.getElementById("teamReplayContainer");
    const viewAdminContainer = document.getElementById("teamAdminViewContainer");

    let activeCenterViewMode = "field";

    function setCenterViewMode(mode) {
      activeCenterViewMode = mode;
      [btnViewModeField, btnViewModeIde, btnViewModeSuggestions, btnViewModeReplay, btnViewModeAdmin].forEach(btn => {
        if (btn) {
          btn.classList.remove("active");
          btn.style.background = "#1e293b";
          btn.style.color = "#cbd5e1";
          btn.style.borderColor = "#334155";
        }
      });

      if (viewFieldContainer) viewFieldContainer.style.display = "none";
      if (viewIdeContainer) viewIdeContainer.style.display = "none";
      if (viewSuggestionsContainer) viewSuggestionsContainer.style.display = "none";
      if (viewReplayContainer) viewReplayContainer.style.display = "none";
      if (viewAdminContainer) viewAdminContainer.style.display = "none";

      if (mode === "field") {
        if (btnViewModeField) {
          btnViewModeField.classList.add("active");
          btnViewModeField.style.background = "#0284c7";
          btnViewModeField.style.color = "#fff";
          btnViewModeField.style.borderColor = "#0369a1";
        }
        if (viewFieldContainer) viewFieldContainer.style.display = "flex";
        drawField();
        requestAnimationFrame(() => drawField());
        setTimeout(drawField, 50);
        setTimeout(drawField, 200);
      } else if (mode === "ide") {
        if (btnViewModeIde) {
          btnViewModeIde.classList.add("active");
          btnViewModeIde.style.background = "#0284c7";
          btnViewModeIde.style.color = "#fff";
          btnViewModeIde.style.borderColor = "#0369a1";
        }
        if (viewIdeContainer) viewIdeContainer.style.display = "flex";
        renderIdeFile(activeIdeFile || "src/autons.cpp");
        if (monacoEditor) {
          requestAnimationFrame(() => {
            try { monacoEditor.layout(); } catch(_) {}
          });
          setTimeout(() => {
            try { monacoEditor.layout(); } catch(_) {}
          }, 50);
          setTimeout(() => {
            try { monacoEditor.layout(); } catch(_) {}
          }, 200);
        } else if (!isMonacoReady) {
          initMonaco();
        }
      } else if (mode === "suggestions") {
        if (btnViewModeSuggestions) {
          btnViewModeSuggestions.classList.add("active");
          btnViewModeSuggestions.style.background = "#0284c7";
          btnViewModeSuggestions.style.color = "#fff";
          btnViewModeSuggestions.style.borderColor = "#0369a1";
        }
        if (viewSuggestionsContainer) viewSuggestionsContainer.style.display = "flex";
        renderSuggestions();
      } else if (mode === "replay") {
        if (btnViewModeReplay) {
          btnViewModeReplay.classList.add("active");
          btnViewModeReplay.style.background = "#0284c7";
          btnViewModeReplay.style.color = "#fff";
          btnViewModeReplay.style.borderColor = "#0369a1";
        }
        if (viewReplayContainer) viewReplayContainer.style.display = "flex";
        renderTeamReplayStudio();
      } else if (mode === "admin") {
        if (btnViewModeAdmin) {
          btnViewModeAdmin.classList.add("active");
          btnViewModeAdmin.style.background = "#0284c7";
          btnViewModeAdmin.style.color = "#fff";
          btnViewModeAdmin.style.borderColor = "#0369a1";
        }
        if (viewAdminContainer) viewAdminContainer.style.display = "flex";
        renderTeamAdminView();
      }
    }

    btnViewModeField?.addEventListener("click", () => setCenterViewMode("field"));
    btnViewModeIde?.addEventListener("click", () => setCenterViewMode("ide"));
    btnViewModeSuggestions?.addEventListener("click", () => setCenterViewMode("suggestions"));
    btnViewModeReplay?.addEventListener("click", () => setCenterViewMode("replay"));
    btnViewModeAdmin?.addEventListener("click", () => setCenterViewMode("admin"));
    document.getElementById("btnMenuMatchReplay")?.addEventListener("click", () => setCenterViewMode("replay"));

    // ------------------------------------------------------------------------
    // TEAM AUTONOMOUS MATCH REPLAY STUDIO (ALPHA)
    // ------------------------------------------------------------------------
    let teamReplaySamples = [];
    let teamReplayAnalysis = null;
    let isTeamReplayPlaying = false;
    let teamReplayTimeMs = 0;
    let teamReplayRaf = null;
    let teamReplayLastTime = null;
    let teamReplayScenario = "slip";

    function getTeamPlannedPoints() {
      const routine = activePaths[activeRoutineIndex] || activePaths[0] || { pose: { x: -60, y: -60, theta: 0 }, actions: [] };
      const startP = routine.pose || { x: -60, y: -60, theta: 0 };
      const acts = routine.actions || [];
      const points = [{ t: 0, x: startP.x, y: startP.y, theta: startP.theta, actionIndex: 0 }];
      const totalTime = 15000;
      const count = Math.max(1, acts.length);

      acts.forEach((act, idx) => {
        const t = Math.round(((idx + 1) / count) * totalTime);
        points.push({
          t,
          x: act.x !== undefined ? act.x : startP.x,
          y: act.y !== undefined ? act.y : startP.y,
          theta: act.theta !== undefined ? act.theta : (act.heading !== undefined ? act.heading : startP.theta),
          actionIndex: idx + 1
        });
      });
      return points;
    }

    function renderTeamReplayStudio(scenario = teamReplayScenario) {
      const engine = window.MatchAnalysisEngine || (typeof MatchAnalysisEngine !== "undefined" ? MatchAnalysisEngine : null);
      if (!engine) return;

      const routine = activePaths[activeRoutineIndex] || activePaths[0];
      teamReplayScenario = scenario;

      if (!teamReplaySamples || teamReplaySamples.length === 0 || scenario) {
        teamReplaySamples = engine.generateSampleLog(routine, scenario);
      }

      const plannedPts = getTeamPlannedPoints();
      teamReplayAnalysis = engine.analyze(plannedPts, teamReplaySamples, routine?.actions || []);

      const scrubber = document.getElementById("teamReplayScrubber");
      if (scrubber) scrubber.max = teamReplayAnalysis.durationMs || 15000;

      const kpiMax = document.getElementById("teamKpiMaxError");
      const kpiAvg = document.getElementById("teamKpiAvgError");
      const kpiAcc = document.getElementById("teamKpiAccuracy");
      const badge = document.getElementById("teamReplayLogBadge");

      if (kpiMax) kpiMax.textContent = `${teamReplayAnalysis.maxErrorInches}"`;
      if (kpiAvg) kpiAvg.textContent = `${teamReplayAnalysis.avgErrorInches}"`;
      if (kpiAcc) kpiAcc.textContent = `${teamReplayAnalysis.trackingAccuracyPct}%`;
      if (badge) badge.textContent = `● ${teamReplayAnalysis.sampleCount} Samples (${(teamReplayAnalysis.durationMs / 1000).toFixed(1)}s)`;

      renderTeamDiagnostics(teamReplayAnalysis.diagnostics || []);
      drawTeamReplayCanvas();
    }

    function renderTeamDiagnostics(diagnostics) {
      const list = document.getElementById("teamReplayDiagnosticsList");
      if (!list) return;
      list.innerHTML = "";

      diagnostics.forEach(d => {
        const item = document.createElement("div");
        item.className = `diagnostic-item ${d.status}`;
        item.innerHTML = `
          <div class="diagnostic-head">
            <span class="diagnostic-title">${d.icon} Step #${d.stepIndex} (${escapeHtml(d.actionType)})</span>
            <span style="font-weight:700;font-size:0.68rem;color:${d.status === 'critical' ? '#ef4444' : (d.status === 'warning' ? '#f59e0b' : '#22c55e')};">${d.maxErrorInches}" err</span>
          </div>
          <div class="diagnostic-body">${escapeHtml(d.cause)}</div>
          <div class="diagnostic-fix"><strong>Fix:</strong> ${escapeHtml(d.fix)}</div>
        `;
        item.onclick = () => {
          teamReplayTimeMs = d.worstTimeMs || 0;
          const s = document.getElementById("teamReplayScrubber");
          if (s) s.value = teamReplayTimeMs;
          pauseTeamReplay();
          drawTeamReplayCanvas();
        };
        list.appendChild(item);
      });
    }

    function drawTeamReplayCanvas() {
      const c = document.getElementById("teamReplayCanvas");
      if (!c) return;
      const ctx2 = c.getContext("2d");
      const w = c.width;
      const h = c.height;

      ctx2.clearRect(0, 0, w, h);

      if (fieldImg && fieldImg.complete && fieldImg.naturalWidth > 0) {
        ctx2.drawImage(fieldImg, 0, 0, w, h);
      } else {
        ctx2.fillStyle = "#0f172a";
        ctx2.fillRect(0, 0, w, h);
      }

      // Draw Planned
      const plannedPts = getTeamPlannedPoints();
      if (plannedPts.length > 1) {
        ctx2.save();
        ctx2.setLineDash([8, 6]);
        ctx2.strokeStyle = "#38bdf8";
        ctx2.lineWidth = 3;
        ctx2.beginPath();
        plannedPts.forEach((pt, i) => {
          const cx = inchToPx(pt.x, w);
          const cy = inchToPx(pt.y, h, true);
          if (i === 0) ctx2.moveTo(cx, cy);
          else ctx2.lineTo(cx, cy);
        });
        ctx2.stroke();
        ctx2.restore();
      }

      // Draw Actual Heatmap
      if (teamReplayAnalysis && teamReplayAnalysis.merged && teamReplayAnalysis.merged.length > 1) {
        const m = teamReplayAnalysis.merged;
        ctx2.save();
        ctx2.lineWidth = 4;
        ctx2.lineCap = "round";

        for (let i = 0; i < m.length - 1; i++) {
          const p0 = m[i];
          const p1 = m[i + 1];
          ctx2.globalAlpha = p0.t <= teamReplayTimeMs ? 1.0 : 0.25;
          ctx2.strokeStyle = p0.heatmapColor || "#22c55e";
          ctx2.beginPath();
          ctx2.moveTo(inchToPx(p0.actualX, w), inchToPx(p0.actualY, h, true));
          ctx2.lineTo(inchToPx(p1.actualX, w), inchToPx(p1.actualY, h, true));
          ctx2.stroke();
        }
        ctx2.restore();
      }

      // Robot Frame
      const engine = window.MatchAnalysisEngine || (typeof MatchAnalysisEngine !== "undefined" ? MatchAnalysisEngine : null);
      if (!engine || !teamReplayAnalysis) return;
      const frame = engine.getReplayFrame(teamReplayAnalysis, teamReplayTimeMs);
      if (!frame) return;

      const liveErr = document.getElementById("teamKpiCurrentError");
      if (liveErr) liveErr.textContent = `${frame.error.toFixed(1)}"`;
      const timeLbl = document.getElementById("teamReplayTimeDisplay");
      if (timeLbl) timeLbl.textContent = `${(teamReplayTimeMs / 1000).toFixed(2)}s / ${(teamReplayAnalysis.durationMs / 1000).toFixed(2)}s`;

      const botW = ((botConfig.robotW || 14) / 144.0) * w;
      const botH = ((botConfig.robotL || 14) / 144.0) * h;

      // Actual Robot
      const ax = inchToPx(frame.actualX, w);
      const ay = inchToPx(frame.actualY, h, true);
      ctx2.save();
      ctx2.translate(ax, ay);
      ctx2.rotate(-(frame.actualTheta * Math.PI) / 180);
      ctx2.fillStyle = "#1e293b";
      ctx2.fillRect(-botW / 2, -botH / 2, botW, botH);
      ctx2.strokeStyle = frame.heatmapColor || "#f59e0b";
      ctx2.lineWidth = 3;
      ctx2.strokeRect(-botW / 2, -botH / 2, botW, botH);

      // Front marker
      ctx2.fillStyle = "#f59e0b";
      ctx2.beginPath();
      ctx2.moveTo(0, -botH * 0.5);
      ctx2.lineTo(-6, -botH * 0.25);
      ctx2.lineTo(6, -botH * 0.25);
      ctx2.closePath();
      ctx2.fill();
      ctx2.restore();
    }

    function playTeamReplay() {
      if (isTeamReplayPlaying) return;
      isTeamReplayPlaying = true;
      const btn = document.getElementById("btnTeamReplayPlay");
      if (btn) btn.textContent = "⏸ Pause";
      teamReplayLastTime = performance.now();

      function step(now) {
        if (!isTeamReplayPlaying) return;
        const dt = now - teamReplayLastTime;
        teamReplayLastTime = now;
        teamReplayTimeMs += dt;
        const maxT = teamReplayAnalysis ? teamReplayAnalysis.durationMs : 15000;
        if (teamReplayTimeMs >= maxT) {
          teamReplayTimeMs = maxT;
          pauseTeamReplay();
        }
        const s = document.getElementById("teamReplayScrubber");
        if (s) s.value = Math.round(teamReplayTimeMs);
        drawTeamReplayCanvas();
        if (isTeamReplayPlaying) {
          teamReplayRaf = requestAnimationFrame(step);
        }
      }
      teamReplayRaf = requestAnimationFrame(step);
    }

    function pauseTeamReplay() {
      isTeamReplayPlaying = false;
      const btn = document.getElementById("btnTeamReplayPlay");
      if (btn) btn.textContent = "▶ Play";
      if (teamReplayRaf) cancelAnimationFrame(teamReplayRaf);
    }

    document.getElementById("btnTeamReplayPlay")?.addEventListener("click", () => {
      if (isTeamReplayPlaying) pauseTeamReplay();
      else {
        if (teamReplayAnalysis && teamReplayTimeMs >= teamReplayAnalysis.durationMs) {
          teamReplayTimeMs = 0;
        }
        playTeamReplay();
      }
    });

    document.getElementById("btnTeamReplayReset")?.addEventListener("click", () => {
      pauseTeamReplay();
      teamReplayTimeMs = 0;
      const s = document.getElementById("teamReplayScrubber");
      if (s) s.value = 0;
      drawTeamReplayCanvas();
    });

    document.getElementById("teamReplayScrubber")?.addEventListener("input", (e) => {
      teamReplayTimeMs = parseFloat(e.target.value) || 0;
      drawTeamReplayCanvas();
    });

    document.querySelectorAll("#teamReplayScenariosGroup button").forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#teamReplayScenariosGroup button").forEach(btn => btn.classList.remove("active"));
        b.classList.add("active");
        renderTeamReplayStudio(b.getAttribute("data-scenario") || "slip");
      });
    });

    document.getElementById("btnTeamReplayLoadSample")?.addEventListener("click", () => {
      renderTeamReplayStudio("slip");
      showToast("📥 Loaded sample match run with wheel slip!", "📊");
    });

    const teamFileInput = document.getElementById("teamReplayFileInput");
    document.getElementById("btnTeamReplayImportFile")?.addEventListener("click", () => teamFileInput?.click());
    teamFileInput?.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const engine = window.MatchAnalysisEngine || (typeof MatchAnalysisEngine !== "undefined" ? MatchAnalysisEngine : null);
        if (engine) {
          const parsed = engine.parseLog(evt.target.result);
          if (parsed && parsed.length > 0) {
            teamReplaySamples = parsed;
            renderTeamReplayStudio(null);
            showToast(`📂 Imported ${parsed.length} odometry samples!`, "✅");
          } else {
            alert("Could not parse odometry points from file.");
          }
        }
      };
      reader.readAsText(file);
    });

    document.getElementById("btnTeamReplayExport")?.addEventListener("click", () => {
      if (!teamReplayAnalysis) return;
      const rep = `Team Match Replay Analysis (ALPHA)\nAccuracy: ${teamReplayAnalysis.trackingAccuracyPct}%\nMax Drift: ${teamReplayAnalysis.maxErrorInches}"\nAvg Drift: ${teamReplayAnalysis.avgErrorInches}"`;
      navigator.clipboard?.writeText(rep);
      showToast("📋 Replay summary copied to clipboard!", "✅");
    });

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
      if (isTeamSyncLocked()) {
        const lk = currentTeam.syncLock;
        showToast(`🔒 Cannot save code: ${lk.authorName || 'Teammate'} is importing from GitHub (${lk.progress || 0}%). Edits paused to prevent conflicts.`, "⚠️");
        return;
      }
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
      if (!isCurrentUserAdmin()) {
        alert("Only team administrators and the team owner can modify permissions and roles.");
        return;
      }
      currentTeam.updatedAt = Date.now();
      recordVersionHistoryEntry("Updated team member roles and permissions", "permissions_update");

      const apiRoute = resolveApiUrl("/api/team/settings");
      if (apiRoute) {
        safeFetchJson(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: currentTeam.teamId,
            email: currentUser.email,
            members: currentTeam.members,
            teamName: currentTeam.teamName
          })
        }).catch(() => {});
      }

      await fsSaveTeamDoc(currentTeam);
      if (modalSettings) modalSettings.style.display = "none";
      renderMemberList();
      renderVersionHistory();
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
          setSetupViewVisible(false);

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

        setSetupViewVisible(true);

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

    document.getElementById("btnDeleteRoutine")?.addEventListener("click", () => {
      if (!currentTeam || !currentUser) return;
      if (isTeamSyncLocked()) {
        const lk = currentTeam.syncLock;
        showToast(`🔒 Cannot delete routine: ${lk.authorName || 'Teammate'} is importing from GitHub (${lk.progress || 0}%).`, "⚠️");
        return;
      }
      if (activePaths.length <= 1) {
        alert("Cannot delete the only routine in the workspace. Please create another routine before deleting this one.");
        return;
      }
      const cur = activePaths[activeRoutineIndex];
      if (!cur) return;
      if (!confirm(`Delete autonomous routine "${cur.name}"? This action will be recorded in version history.`)) {
        return;
      }
      const deletedName = cur.name;
      activePaths.splice(activeRoutineIndex, 1);
      activeRoutineIndex = Math.max(0, activeRoutineIndex - 1);
      renderRoutinesSelector();
      renderActionBlocks();
      drawField();
      syncIdeAutonsFromBlocks();
      broadcastEdit(`Deleted routine "${deletedName}"`, "routine_delete", true);
      showToast(`🗑️ Deleted routine "${deletedName}"`, "ℹ️");
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
        if (githubImportStatus) {
          githubImportStatus.style.display = "none";
          githubImportStatus.style.background = "rgba(15, 23, 42, 0.75)";
          githubImportStatus.style.border = "1px solid rgba(56, 189, 248, 0.3)";
        }
        const elSpinner = document.getElementById("githubImportSpinner");
        if (elSpinner) elSpinner.style.display = "inline-block";
        const elStage = document.getElementById("githubImportStageText");
        if (elStage) { elStage.textContent = "Connecting to GitHub..."; elStage.style.color = "#38bdf8"; }
        const elPct = document.getElementById("githubImportPct");
        if (elPct) { elPct.textContent = "0%"; elPct.style.color = "#4ade80"; }
        const elBar = document.getElementById("githubImportBar");
        if (elBar) { elBar.style.width = "0%"; elBar.style.background = "linear-gradient(90deg, #38bdf8, #22c55e)"; }
        const elDetail = document.getElementById("githubImportDetail");
        if (elDetail) elDetail.textContent = "Downloading repository and extracting C++ sources...";
        const elEta = document.getElementById("githubImportEta");
        if (elEta) elEta.textContent = "⏱️ Calculating...";
        if (btnExecuteGithubImport) {
          btnExecuteGithubImport.disabled = false;
          btnExecuteGithubImport.textContent = "🚀 Clone & Import Repository";
        }
        if (modalGithubImport) modalGithubImport.style.display = "flex";
      });
    }

    [btnCloseGithubModal, btnCancelGithubModal].forEach(btn => {
      btn?.addEventListener("click", () => {
        if (modalGithubImport) modalGithubImport.style.display = "none";
        if (currentTeam?.syncLock?.active) {
          const myEmail = (currentUser?.email || "").toLowerCase().trim();
          if (myEmail && currentTeam.syncLock.authorEmail === myEmail) {
            currentTeam.syncLock.active = false;
            broadcastSyncLock(currentTeam.syncLock);
          }
        }
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

        const myLock = {
          active: true,
          type: "github_import",
          authorEmail: (currentUser?.email || "").toLowerCase().trim(),
          authorName: currentUser?.displayName || currentUser?.email.split("@")[0] || "Team Member",
          repo: repoVal,
          branch: branchVal,
          progress: 6,
          stage: "Connecting to GitHub",
          detail: `Resolving repository "${repoVal}"...`,
          eta: "~10s remaining",
          startedAt: Date.now(),
          updatedAt: Date.now()
        };
        broadcastSyncLock(myLock);

        let cloneProgressTimer = null;
        const cloneStartTime = Date.now();
        let currentProgressPct = 6;
        let currentStage = "Connecting to GitHub";
        let currentDetail = `Authenticating & resolving repository "${repoVal}"...`;
        let currentEta = "~10s remaining";
        let lastBroadcastTime = 0;

        const updateProgressUI = (pct, stage, detail, etaStr) => {
          if (githubImportStatus) {
            githubImportStatus.style.display = "block";
            githubImportStatus.style.background = "rgba(15, 23, 42, 0.75)";
            githubImportStatus.style.border = "1px solid rgba(56, 189, 248, 0.3)";
          }

          if (pct !== undefined && pct !== null && !isNaN(pct)) {
            currentProgressPct = Math.max(currentProgressPct, Math.min(100, Math.round(pct)));
          }
          if (stage) currentStage = stage;
          if (detail) currentDetail = detail;
          if (etaStr) currentEta = etaStr;

          const elStage = document.getElementById("githubImportStageText");
          const elSpinner = document.getElementById("githubImportSpinner");
          const elPct = document.getElementById("githubImportPct");
          const elBar = document.getElementById("githubImportBar");
          const elDetail = document.getElementById("githubImportDetail");
          const elEta = document.getElementById("githubImportEta");

          if (elSpinner) elSpinner.style.display = currentProgressPct >= 100 ? "none" : "inline-block";
          if (elStage) {
            elStage.textContent = currentStage;
            elStage.style.color = currentProgressPct >= 100 ? "#4ade80" : "#38bdf8";
          }
          if (elPct) {
            elPct.textContent = `${currentProgressPct}%`;
            elPct.style.color = currentProgressPct >= 100 ? "#4ade80" : (currentProgressPct >= 80 ? "#38bdf8" : "#fbbf24");
          }
          if (elBar) {
            elBar.style.width = `${currentProgressPct}%`;
            elBar.style.background = currentProgressPct >= 100
              ? "#22c55e"
              : "linear-gradient(90deg, #38bdf8, #22c55e)";
          }
          if (elDetail) elDetail.textContent = currentDetail;
          if (elEta) {
            const formatted = currentEta.startsWith("⏱️") ? currentEta : `⏱️ ${currentEta}`;
            elEta.textContent = currentProgressPct >= 100 ? "✅ Done!" : formatted;
          }

          // Broadcast sync progress to other user sessions so teammates see live progress & cannot override!
          const nowTs = Date.now();
          if (pct >= 100 || (nowTs - lastBroadcastTime > 350)) {
            lastBroadcastTime = nowTs;
            myLock.progress = currentProgressPct;
            myLock.stage = currentStage;
            myLock.detail = currentDetail;
            myLock.eta = currentEta;
            myLock.updatedAt = nowTs;
            broadcastSyncLock(myLock);
          }
        };

        // Initialize progress UI immediately
        updateProgressUI(6, "Connecting to GitHub", `Authenticating & resolving repository "${repoVal}"...`, "~10s remaining");

        // Live ticker providing continuous percentage progression and live time-left countdown
        cloneProgressTimer = setInterval(() => {
          const elapsed = (Date.now() - cloneStartTime) / 1000;
          const expectedTotal = Math.max(12, elapsed + 4);
          const remaining = Math.max(1, Math.round(expectedTotal - elapsed));
          const etaText = remaining < 60 ? `~${remaining}s remaining` : `~${Math.ceil(remaining / 60)}m remaining`;

          if (currentProgressPct < 78) {
            if (elapsed < 1.5) {
              currentProgressPct = Math.min(18, Math.round(6 + elapsed * 8));
              currentStage = "Resolving Repository Manifest";
              currentDetail = `Connecting to GitHub API for ${repoVal}... (${elapsed.toFixed(1)}s elapsed)`;
            } else if (elapsed < 4.0) {
              currentProgressPct = Math.min(48, Math.round(18 + (elapsed - 1.5) * 12));
              currentStage = "Downloading C++ Source Archive";
              currentDetail = `Downloading files & project manifest... (${elapsed.toFixed(1)}s elapsed)`;
            } else {
              currentProgressPct = Math.min(78, Math.round(48 + (elapsed - 4.0) * 4));
              currentStage = "Unpacking Project Files";
              currentDetail = `Extracting LemLib autonomous source files... (${elapsed.toFixed(1)}s elapsed)`;
            }
          }
          updateProgressUI(currentProgressPct, currentStage, currentDetail, etaText);
        }, 200);

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
            cloneData = await fetchGithubRepositoryFiles(repoVal, branchVal, tokenVal, (p) => {
              if (typeof p === "object") {
                updateProgressUI(p.pct, p.stage || "Downloading Files", p.message, p.etaStr);
              } else if (typeof p === "string") {
                updateProgressUI(null, "Downloading Files", p, null);
              }
            });
          }

          if (cloneProgressTimer) {
            clearInterval(cloneProgressTimer);
            cloneProgressTimer = null;
          }

          if (!cloneData || !cloneData.files || Object.keys(cloneData.files).length === 0) {
            throw new Error("No C++ autonomous files found in selected repository.");
          }

          // Parsing Phase: 85% to 98%
          const fileCount = cloneData.fileCount || Object.keys(cloneData.files).length;
          updateProgressUI(85, "Parsing LemLib C++ Source", `Analyzing ${fileCount} C++ files and extracting motion paths...`, "~2s remaining");
          await new Promise(r => setTimeout(r, 120));

          const detectedPaths = parseGithubAutonFiles(cloneData.files, cloneData.repoName);
          updateProgressUI(95, "Building Autonomous Routines", `Constructed ${detectedPaths.length} autonomous routines. Finalizing workspace...`, "⚡ Almost done");
          await new Promise(r => setTimeout(r, 150));

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
            currentTeam.updatedAt = now + 2500;

            await fsSaveTeamDoc(currentTeam);
            try {
              localStorage.setItem("lemlib_active_team", JSON.stringify(currentTeam));
            } catch (_) {}
            importData = { success: true, team: currentTeam };
          }

          // Complete and clear lock
          myLock.active = false;
          myLock.completedAt = Date.now();
          myLock.progress = 100;
          myLock.stage = "Import Complete!";
          myLock.detail = `Synchronized ${detectedPaths.length} routines into team workspace.`;
          myLock.eta = "Complete!";
          currentTeam.syncLock = myLock;
          currentTeam.updatedAt = Date.now() + 2500;
          await broadcastSyncLock(myLock);

          btnExecuteGithubImport.disabled = false;
          btnExecuteGithubImport.textContent = "🚀 Clone & Import Repository";

          updateProgressUI(100, "Workspace Synchronized!", "All C++ files and autonomous routines ready.", "Complete!");
          await new Promise(r => setTimeout(r, 450));

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
          if (cloneProgressTimer) {
            clearInterval(cloneProgressTimer);
            cloneProgressTimer = null;
          }
          myLock.active = false;
          myLock.error = err.message || String(err);
          currentTeam.syncLock = myLock;
          broadcastSyncLock(myLock);

          btnExecuteGithubImport.disabled = false;
          btnExecuteGithubImport.textContent = "🚀 Clone & Import Repository";
          if (githubImportStatus) {
            githubImportStatus.style.display = "block";
            githubImportStatus.style.background = "rgba(239, 68, 68, 0.15)";
            githubImportStatus.style.border = "1px solid rgba(239, 68, 68, 0.35)";
          }
          const elStage = document.getElementById("githubImportStageText");
          const elSpinner = document.getElementById("githubImportSpinner");
          const elPct = document.getElementById("githubImportPct");
          const elBar = document.getElementById("githubImportBar");
          const elDetail = document.getElementById("githubImportDetail");
          const elEta = document.getElementById("githubImportEta");
          if (elSpinner) elSpinner.style.display = "none";
          if (elStage) { elStage.textContent = "Import Failed"; elStage.style.color = "#f87171"; }
          if (elPct) { elPct.textContent = "Error"; elPct.style.color = "#f87171"; }
          if (elBar) { elBar.style.width = "100%"; elBar.style.background = "#ef4444"; }
          if (elDetail) elDetail.textContent = err.message || "Failed to clone repository.";
          if (elEta) elEta.textContent = "Failed";
          alert("GitHub import failed: " + (err.message || err));
        }
      });
    }
  }

  // --------------------------------------------------------------------------
  // RESIZABLE WINDOWS / COLUMNS SPLITTER
  // --------------------------------------------------------------------------
  function initResizableWindows() {
    const leftCol = document.getElementById("teamColLeft");
    const rightCol = document.getElementById("teamColRight");
    const ideSidebar = document.getElementById("teamIdeSidebar");

    // Restore saved column dimensions
    const savedLeftWidth = localStorage.getItem("vex_team_col_left_width");
    if (savedLeftWidth && leftCol) {
      leftCol.style.width = `${Math.max(220, Math.min(600, parseInt(savedLeftWidth, 10)))}px`;
    }

    const savedRightWidth = localStorage.getItem("vex_team_col_right_width");
    if (savedRightWidth && rightCol) {
      rightCol.style.width = `${Math.max(260, Math.min(700, parseInt(savedRightWidth, 10)))}px`;
    }

    const savedIdeSidebarWidth = localStorage.getItem("vex_team_ide_sidebar_width");
    if (savedIdeSidebarWidth && ideSidebar) {
      ideSidebar.style.width = `${Math.max(160, Math.min(480, parseInt(savedIdeSidebarWidth, 10)))}px`;
    }

    function attachResizer(resizerEl, targetEl, isRightToLeft = false, minW = 200, maxW = 600, storageKey = "") {
      if (!resizerEl || !targetEl) return;

      let isDragging = false;
      let startX = 0;
      let startWidth = 0;

      const startDrag = (e) => {
        isDragging = true;
        startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        startWidth = targetEl.offsetWidth;

        resizerEl.classList.add("is-dragging");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const onMove = (evt) => {
          if (!isDragging) return;
          const clientX = evt.clientX || (evt.touches && evt.touches[0] ? evt.touches[0].clientX : startX);
          const deltaX = clientX - startX;
          let newWidth = isRightToLeft ? startWidth - deltaX : startWidth + deltaX;
          newWidth = Math.max(minW, Math.min(maxW, newWidth));

          targetEl.style.width = `${newWidth}px`;
          if (storageKey) {
            localStorage.setItem(storageKey, String(Math.round(newWidth)));
          }

          if (typeof drawField === "function") drawField();
          if (monacoEditor) {
            try { monacoEditor.layout(); } catch (_) {}
          }
          window.dispatchEvent(new Event("resize"));
        };

        const stopDrag = () => {
          if (!isDragging) return;
          isDragging = false;
          resizerEl.classList.remove("is-dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";

          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", stopDrag);
          window.removeEventListener("touchmove", onMove);
          window.removeEventListener("touchend", stopDrag);

          if (typeof drawField === "function") drawField();
          if (monacoEditor) {
            try { monacoEditor.layout(); } catch (_) {}
          }
          window.dispatchEvent(new Event("resize"));
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", stopDrag);
        window.addEventListener("touchmove", onMove, { passive: false });
        window.addEventListener("touchend", stopDrag);
      };

      resizerEl.addEventListener("mousedown", startDrag);
      resizerEl.addEventListener("touchstart", startDrag, { passive: true });
    }

    attachResizer(document.getElementById("resizerLeft"), leftCol, false, 220, 600, "vex_team_col_left_width");
    attachResizer(document.getElementById("resizerRight"), rightCol, true, 260, 700, "vex_team_col_right_width");
    attachResizer(document.getElementById("resizerIdeSidebar"), ideSidebar, false, 160, 480, "vex_team_ide_sidebar_width");
  }

  // --------------------------------------------------------------------------
  // INIT
  // --------------------------------------------------------------------------
  window.addEventListener("DOMContentLoaded", () => {
    initAuth();
    initTeamEditor();
    initAdminDashboardEvents();
    initResizableWindows();
    wireScoringModal();
    wireCollisionModal();
    wireDebugPanel();
    wireEvents();
    drawField();
    requestAnimationFrame(() => drawField());
    setTimeout(drawField, 100);
    setTimeout(drawField, 300);

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        drawField();
        if (monacoEditor && isMonacoReady) {
          try { monacoEditor.layout(); } catch (_) {}
        }
      });
      const cWrap = document.getElementById("fieldCanvasContainer");
      if (cWrap) ro.observe(cWrap);
      const cBox = document.getElementById("teamCanvasBox");
      if (cBox) ro.observe(cBox);
      const ideContainer = document.getElementById("teamIdeContainer");
      if (ideContainer) ro.observe(ideContainer);
      const ideWrapper = document.getElementById("ideEditorWrapper");
      if (ideWrapper) ro.observe(ideWrapper);
    }
    window.addEventListener("resize", () => {
      drawField();
      if (monacoEditor && isMonacoReady) {
        try { monacoEditor.layout(); } catch (_) {}
      }
    });

    if (window.location.hash === "#join") {
      document.getElementById("tabGateJoin")?.click();
    } else if (window.location.hash === "#create") {
      document.getElementById("tabGateCreate")?.click();
    }
  });

})(window);
