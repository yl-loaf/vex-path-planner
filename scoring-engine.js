/**
 * VEX V5 LemLib Path Planner - VRC OVERRIDE (2026-27) Game Engine & Dynamic Element Tracker
 * Official Rules & Terminology Reference:
 * - Game Pieces: PINS (Red Pins, Blue Pins, Yellow Pins). Total 63 pins on field.
 * - Toggles: 4 Field Toggles on perimeter walls. Turned CW or CCW to set Alliance Color.
 * - Loaders: 4 Wall Match Loaders adjacent to alliance stations (always have a pin ready).
 * - Goals: 9 Goals (1 Neutral Tall center, 4 Neutral Quadrant, 2 Red Alliance, 2 Blue Alliance).
 * - Stacking: Pins stacked on goals (track colored vs yellow pins).
 * - Robot Capacity: Exactly ONE pin at a time on the robot.
 * 
 * Comment Trigger Mechanics:
 * - "// pin collected" -> Grabs nearest pin (field or loader), carries on bot. Loader replenishes immediately.
 * - "// pin deposited" -> Drops carried pin into nearest goal, stacks on goal.
 * - "// turn toggle CW" -> Turns nearest wall toggle Clockwise, sets Red alliance.
 * - "// turn toggle CCW" -> Turns nearest wall toggle Counter-Clockwise, sets Blue alliance.
 */

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ScoringEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Official Dimensions (Inches)
  const PIN_RADIUS = 1.4;       // ~2.8" diameter base
  const PIN_HEIGHT = 6.5;       // 6.5" height
  const GOAL_BASE_RADIUS = 3.6; // Goal base radius
  const TOGGLE_REACH = 48.0;    // Interaction radius for wall toggles
  const PIN_PICKUP_REACH = 36.0; // Reach distance for collecting pins
  const GOAL_DEPOSIT_REACH = 48.0; // Reach distance for depositing into goals
  const PIN_MASS_LBS = 0.45;    // Pin weight

  // 4 Official Wall Match Loaders (Loaders always have a pin ready)
  const DEFAULT_LOADERS = [
    { id: "loader_red_tl", name: "Red Top-Left Loader", wall: "west", color: "red", x: -65.25, y: 58.5 },
    { id: "loader_red_bl", name: "Red Bottom-Left Loader", wall: "west", color: "red", x: -65.25, y: -58.5 },
    { id: "loader_blue_tr", name: "Blue Top-Right Loader", wall: "east", color: "blue", x: 65.25, y: 58.5 },
    { id: "loader_blue_br", name: "Blue Bottom-Right Loader", wall: "east", color: "blue", x: 65.25, y: -58.5 },
  ];

  // 4 Official Perimeter Wall Toggles (North, South, East, West wall centers)
  const DEFAULT_TOGGLES = [
    { id: "toggle_west", name: "West Wall Toggle", wall: "west", x: -70.5, y: 0.0, state: "neutral", rotation: 0, label: "West Toggle" },
    { id: "toggle_east", name: "East Wall Toggle", wall: "east", x: 70.5, y: 0.0, state: "neutral", rotation: 0, label: "East Toggle" },
    { id: "toggle_north", name: "North Wall Toggle", wall: "north", x: 0.0, y: 70.5, state: "neutral", rotation: 0, label: "North Toggle" },
    { id: "toggle_south", name: "South Wall Toggle", wall: "south", x: 0.0, y: -70.5, state: "neutral", rotation: 0, label: "South Toggle" },
  ];

  // 9 Official Override Goals
  const DEFAULT_GOALS = [
    { id: "goal_center", name: "Neutral Tall Goal (Center)", type: "neutral_tall", color: "yellow", x: 0.0, y: 0.0, height: 8.7, radius: 4.2 },
    { id: "goal_neutral_tl", name: "Neutral Goal (Top-Left)", type: "neutral_short", color: "yellow", x: -24.0, y: 48.0, height: 5.8, radius: 3.6 },
    { id: "goal_neutral_ml", name: "Neutral Goal (Mid-Left)", type: "neutral_short", color: "yellow", x: -48.0, y: 24.0, height: 5.8, radius: 3.6 },
    { id: "goal_neutral_mr", name: "Neutral Goal (Mid-Right)", type: "neutral_short", color: "yellow", x: 48.0, y: -24.0, height: 5.8, radius: 3.6 },
    { id: "goal_neutral_br", name: "Neutral Goal (Bottom-Right)", type: "neutral_short", color: "yellow", x: 24.0, y: -48.0, height: 5.8, radius: 3.6 },
    { id: "goal_red_1", name: "Red Alliance Goal 1", type: "alliance", color: "red", x: -48.0, y: -24.0, height: 3.25, radius: 3.6 },
    { id: "goal_red_2", name: "Red Alliance Goal 2", type: "alliance", color: "red", x: -24.0, y: -48.0, height: 3.25, radius: 3.6 },
    { id: "goal_blue_1", name: "Blue Alliance Goal 1", type: "alliance", color: "blue", x: 48.0, y: 24.0, height: 3.25, radius: 3.6 },
    { id: "goal_blue_2", name: "Blue Alliance Goal 2", type: "alliance", color: "blue", x: 24.0, y: 48.0, height: 3.25, radius: 3.6 },
  ];

  // Starting Field Pins (Red, Blue, and Yellow Pins distributed on tiles)
  const DEFAULT_FIELD_PINS = [
    // Center Neutral Pins
    { id: "pin_c_yel_1", color: "yellow", x: -8.0, y: 8.0 },
    { id: "pin_c_yel_2", color: "yellow", x: 8.0, y: 8.0 },
    { id: "pin_c_yel_3", color: "yellow", x: -8.0, y: -8.0 },
    { id: "pin_c_yel_4", color: "yellow", x: 8.0, y: -8.0 },
    { id: "pin_c_yel_5", color: "yellow", x: 0.0, y: 16.0 },
    { id: "pin_c_yel_6", color: "yellow", x: 0.0, y: -16.0 },
    { id: "pin_c_yel_7", color: "yellow", x: -16.0, y: 0.0 },
    { id: "pin_c_yel_8", color: "yellow", x: 16.0, y: 0.0 },

    // Red Alliance Quadrant Pins
    { id: "pin_red_1", color: "red", x: -48.0, y: 48.0 },
    { id: "pin_red_2", color: "red", x: -36.0, y: 36.0 },
    { id: "pin_red_3", color: "red", x: -48.0, y: -12.0 },
    { id: "pin_red_4", color: "red", x: -12.0, y: -48.0 },
    { id: "pin_red_5", color: "red", x: -36.0, y: -36.0 },
    { id: "pin_red_6", color: "red", x: -60.0, y: 24.0 },
    { id: "pin_red_7", color: "red", x: -24.0, y: 60.0 },
    { id: "pin_red_8", color: "red", x: -60.0, y: -24.0 },
    { id: "pin_red_9", color: "red", x: -24.0, y: -60.0 },

    // Blue Alliance Quadrant Pins
    { id: "pin_blue_1", color: "blue", x: 48.0, y: -48.0 },
    { id: "pin_blue_2", color: "blue", x: 36.0, y: -36.0 },
    { id: "pin_blue_3", color: "blue", x: 48.0, y: 12.0 },
    { id: "pin_blue_4", color: "blue", x: 12.0, y: 48.0 },
    { id: "pin_blue_5", color: "blue", x: 36.0, y: 36.0 },
    { id: "pin_blue_6", color: "blue", x: 60.0, y: -24.0 },
    { id: "pin_blue_7", color: "blue", x: 24.0, y: -60.0 },
    { id: "pin_blue_8", color: "blue", x: 60.0, y: 24.0 },
    { id: "pin_blue_9", color: "blue", x: 24.0, y: 60.0 },
  ];

  // Dynamic State - Default state is OFF (disabled)
  let isEnabled = false;
  let pins = [];
  let loaders = [];
  let toggles = [];
  let goals = [];
  let carriedPin = null; // Robot carries exactly ONE pin at a time
  let allianceColor = "red"; // 'red' | 'blue'
  let gameMode = "match15"; // 'match15' | 'skills60'
  let pinCounter = 100;
  let executedActionTriggers = new Set();

  function init() {
    resetFieldElements();
    try {
      const saved = localStorage.getItem("vex_override_engine_v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.isEnabled === "boolean") {
          isEnabled = parsed.isEnabled;
        } else {
          isEnabled = false;
        }
        if (parsed.allianceColor) allianceColor = parsed.allianceColor;
        if (parsed.gameMode) gameMode = parsed.gameMode;
      } else {
        isEnabled = false;
      }
    } catch (_) {
      isEnabled = false;
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem("vex_override_engine_v2", JSON.stringify({
        isEnabled,
        allianceColor,
        gameMode,
      }));
    } catch (_) {}
  }

  function resetFieldElements() {
    carriedPin = null;
    executedActionTriggers.clear();

    // Initialize Loaders (each with a ready pin)
    loaders = DEFAULT_LOADERS.map((l) => ({
      ...l,
      hasPin: true,
      pinColor: l.color,
    }));

    // Initialize Toggles
    toggles = DEFAULT_TOGGLES.map((t) => ({
      ...t,
      state: "neutral",
      rotationDeg: 0,
    }));

    // Initialize Goals with empty stacked pins
    goals = DEFAULT_GOALS.map((g) => ({
      ...g,
      stackedPins: [],
      redCount: 0,
      blueCount: 0,
      yellowCount: 0,
      totalCount: 0,
    }));

    // Initialize Field Pins
    pins = DEFAULT_FIELD_PINS.map((p) => ({
      id: p.id,
      color: p.color,
      x: p.x,
      y: p.y,
      initialX: p.x,
      initialY: p.y,
      state: "field",
      goalId: null,
    }));
  }

  function setEnabled(val) {
    isEnabled = !!val;
    saveConfig();
  }

  function getIsEnabled() {
    return isEnabled;
  }

  function setAllianceColor(col) {
    allianceColor = col === "blue" ? "blue" : "red";
    saveConfig();
  }

  function getAllianceColor() {
    return allianceColor;
  }

  function setGameMode(mode) {
    gameMode = mode === "skills60" ? "skills60" : "match15";
    saveConfig();
  }

  function getGameMode() {
    return gameMode;
  }

  function getCarriedPin() {
    return carriedPin;
  }

  function getCarriedPinWeightLbs() {
    return carriedPin ? PIN_MASS_LBS : 0;
  }

  /**
   * Flexible detection of comment triggers in action properties
   */
  function parseOverrideTriggers(action) {
    if (!action) return {};
    const text = [
      action.label || "",
      action.comment || "",
      action.customCode || "",
      action.subsystemCode || "",
      action.commentText || "",
    ].join(" ").toLowerCase();

    const pinCollected = /\/\/\s*pin\s*collected|pin\s*collected|collect\s*pin|grab\s*pin|pickup\s*pin|intake\s*pin/i.test(text);
    const pinDeposited = /\/\/\s*pin\s*deposited|pin\s*deposited|deposit\s*pin|score\s*pin|drop\s*pin|stack\s*pin|place\s*pin/i.test(text);
    const turnToggleCcw = /\/\/\s*turn\s*toggle\s*ccw|\bturn\s*toggle\s*ccw\b|\btoggle\s*ccw\b|\bturn\s*toggle\s*blue\b/i.test(text);
    const turnToggleCw = (/\/\/\s*turn\s*toggle\s*cw|\bturn\s*toggle\s*cw\b|\btoggle\s*cw\b|\bturn\s*toggle\s*red\b|\bturn\s*toggle\b/i.test(text)) && !turnToggleCcw;

    return {
      pinCollected,
      pinDeposited,
      turnToggleCw,
      turnToggleCcw,
    };
  }

  /**
   * Action: Collect Pin (grabs nearest pin from field or loader; robot only holds 1 pin at a time)
   */
  function collectNearestPin(robotX, robotY) {
    if (carriedPin) {
      return carriedPin;
    }

    let nearestPin = null;
    let nearestDist = PIN_PICKUP_REACH;
    let fromLoader = null;

    // Check Wall Loaders
    for (const loader of loaders) {
      const dist = Math.hypot(loader.x - robotX, loader.y - robotY);
      if (dist <= TOGGLE_REACH) {
        if (dist < nearestDist) {
          nearestDist = dist;
          fromLoader = loader;
        }
      }
    }

    if (fromLoader) {
      pinCounter++;
      const newPin = {
        id: `pin_loader_${fromLoader.id}_${pinCounter}`,
        color: fromLoader.pinColor || allianceColor,
        x: robotX,
        y: robotY,
        state: "held",
        goalId: null,
      };
      carriedPin = newPin;
      fromLoader.hasPin = true; // Always keeps pin ready
      return carriedPin;
    }

    // Check on-field pins
    for (const pin of pins) {
      if (pin.state !== "field") continue;
      const dist = Math.hypot(pin.x - robotX, pin.y - robotY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPin = pin;
      }
    }

    if (nearestPin) {
      nearestPin.state = "held";
      nearestPin.x = robotX;
      nearestPin.y = robotY;
      carriedPin = nearestPin;
      return carriedPin;
    }

    // Fallback: spawn an alliance pin
    pinCounter++;
    const spawnedPin = {
      id: `pin_spawned_${pinCounter}`,
      color: allianceColor,
      x: robotX,
      y: robotY,
      state: "held",
      goalId: null,
    };
    carriedPin = spawnedPin;
    return carriedPin;
  }

  /**
   * Action: Deposit Pin (drops carried pin into nearest goal, stacks on goal)
   */
  function depositCarriedPin(robotX, robotY) {
    // If not holding a pin, auto-collect an alliance pin first so depositing always succeeds
    if (!carriedPin) {
      collectNearestPin(robotX, robotY);
    }
    if (!carriedPin) return null;

    let nearestGoal = null;
    let nearestDist = 9999;
    for (const goal of goals) {
      const dist = Math.hypot(goal.x - robotX, goal.y - robotY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestGoal = goal;
      }
    }

    if (!nearestGoal || nearestDist > GOAL_DEPOSIT_REACH) {
      nearestGoal = goals[0]; // Center goal fallback
    }

    carriedPin.state = "stacked";
    carriedPin.goalId = nearestGoal.id;
    carriedPin.x = nearestGoal.x;
    carriedPin.y = nearestGoal.y;

    nearestGoal.stackedPins.push({
      id: carriedPin.id,
      color: carriedPin.color,
    });

    if (carriedPin.color === "red") nearestGoal.redCount++;
    else if (carriedPin.color === "blue") nearestGoal.blueCount++;
    else nearestGoal.yellowCount++;

    nearestGoal.totalCount = nearestGoal.stackedPins.length;

    const deposited = carriedPin;
    carriedPin = null;
    return { deposited, goal: nearestGoal };
  }

  /**
   * Action: Turn Toggle (CW or CCW)
   * The toggle that changes is strictly the closest one to the robot.
   */
  function turnToggle(robotX, robotY, direction) {
    if (!toggles || toggles.length === 0) return null;

    let nearestToggle = null;
    let minDistance = Infinity;

    for (const toggle of toggles) {
      const dist = Math.hypot(toggle.x - robotX, toggle.y - robotY);
      if (dist < minDistance) {
        minDistance = dist;
        nearestToggle = toggle;
      }
    }

    if (nearestToggle) {
      if (direction === "CW") {
        nearestToggle.rotationDeg = (nearestToggle.rotationDeg + 120) % 360;
        // 2x CW turns flips toggle from red to blue (CCW state); otherwise sets to red (CW state)
        nearestToggle.state = nearestToggle.state === "red" ? "blue" : "red";
      } else {
        nearestToggle.rotationDeg = (nearestToggle.rotationDeg - 120 + 360) % 360;
        // 2x CCW turns flips toggle from blue to red (CW state); otherwise sets to blue (CCW state)
        nearestToggle.state = nearestToggle.state === "blue" ? "red" : "blue";
      }
      return nearestToggle;
    }
    return null;
  }

  /**
   * Evaluates the entire routine ahead of time for static projected scoring & visual stacking
   */
  function evaluateFullRoutine(actionsList, posesList, botConfig) {
    resetFieldElements();
    if (!Array.isArray(actionsList) || actionsList.length === 0) return calculateScore();

    let curX = (posesList && posesList[0] && !isNaN(posesList[0].x)) ? posesList[0].x : 0;
    let curY = (posesList && posesList[0] && !isNaN(posesList[0].y)) ? posesList[0].y : 0;

    for (let i = 0; i < actionsList.length; i++) {
      const a = actionsList[i];
      let px = curX;
      let py = curY;

      if (posesList && posesList[i + 1] && !isNaN(posesList[i + 1].x) && !isNaN(posesList[i + 1].y)) {
        px = posesList[i + 1].x;
        py = posesList[i + 1].y;
        curX = px;
        curY = py;
      } else if (a.x != null && a.y != null && !isNaN(Number(a.x)) && !isNaN(Number(a.y)) && a.type !== "turnToPoint") {
        px = Number(a.x);
        py = Number(a.y);
        curX = px;
        curY = py;
      }

      const triggers = parseOverrideTriggers(a);

      if (triggers.pinCollected) {
        collectNearestPin(px, py);
      }
      if (triggers.pinDeposited) {
        depositCarriedPin(px, py);
      }
      if (triggers.turnToggleCw) {
        turnToggle(px, py, "CW");
      }
      if (triggers.turnToggleCcw) {
        turnToggle(px, py, "CCW");
      }
    }

    return calculateScore();
  }

  /**
   * Simulation Discrete Step Update
   */
  function updateStep(robotPose, robotDimensions, action, isSimulating) {
    if (!robotPose) return calculateScore();

    if (carriedPin) {
      carriedPin.x = robotPose.x;
      carriedPin.y = robotPose.y;
    }

    if (action) {
      const actKey = action.id || `act_${action.x}_${action.y}_${action.label || ''}`;
      if (!executedActionTriggers.has(actKey)) {
        const triggers = parseOverrideTriggers(action);
        const rx = (robotPose && !isNaN(robotPose.x)) ? robotPose.x : (action.x || 0);
        const ry = (robotPose && !isNaN(robotPose.y)) ? robotPose.y : (action.y || 0);

        if (triggers.pinCollected) {
          executedActionTriggers.add(actKey);
          collectNearestPin(rx, ry);
        }
        if (triggers.pinDeposited) {
          executedActionTriggers.add(actKey);
          depositCarriedPin(rx, ry);
        }
        if (triggers.turnToggleCw) {
          executedActionTriggers.add(actKey);
          turnToggle(rx, ry, "CW");
        }
        if (triggers.turnToggleCcw) {
          executedActionTriggers.add(actKey);
          turnToggle(rx, ry, "CCW");
        }
      }
    }

    return calculateScore(robotPose);
  }

  /**
   * Computes official VRC Override match score
   */
  function calculateScore(robotPose) {
    let redScore = 0;
    let blueScore = 0;
    let totalPinsStacked = 0;
    let redTogglesOwned = 0;
    let blueTogglesOwned = 0;

    for (const toggle of toggles) {
      if (toggle.state === "red") redTogglesOwned++;
      else if (toggle.state === "blue") blueTogglesOwned++;
    }

    for (const goal of goals) {
      totalPinsStacked += goal.totalCount;

      redScore += goal.redCount * 5;
      blueScore += goal.blueCount * 5;

      if (redTogglesOwned > 0) {
        redScore += goal.yellowCount * 10;
      }
      if (blueTogglesOwned > 0) {
        blueScore += goal.yellowCount * 10;
      }
    }

    redScore += redTogglesOwned * 10;
    blueScore += blueTogglesOwned * 10;

    const myScore = (allianceColor === "blue") ? blueScore : redScore;

    return {
      totalScore: myScore,
      redScore,
      blueScore,
      totalPinsStacked,
      redTogglesOwned,
      blueTogglesOwned,
      carriedPin: carriedPin ? { ...carriedPin } : null,
      loaders: loaders.map((l) => ({ ...l })),
      toggles: toggles.map((t) => ({ ...t })),
      goals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        redCount: g.redCount,
        blueCount: g.blueCount,
        yellowCount: g.yellowCount,
        totalCount: g.totalCount,
        stackedPins: g.stackedPins ? [...g.stackedPins] : [],
      })),
    };
  }

  /**
   * Renders dynamic VRC Override Field elements (Pins on Goals, Active Toggles, Carried Pin)
   * Purely visual graphics without any text words or labels cluttering the field.
   */
  function render(ctx, fieldToCanvas, scale, theme = "dark") {
    if (!ctx) return;

    ctx.save();

    // 1. Draw Active Perimeter Wall Toggles (Clean physical indicator bar, no text words)
    for (const toggle of toggles) {
      if (toggle.state === "neutral") continue;

      const { cx, cy } = fieldToCanvas(toggle.x, toggle.y);
      const len = 16.0 * scale;
      const th = 4.5 * scale;

      ctx.save();
      ctx.translate(cx, cy);

      const isVertical = (toggle.wall === "west" || toggle.wall === "east");
      if (isVertical) ctx.rotate(Math.PI / 2);

      const isRed = toggle.state === "red";
      const toggleBg = isRed ? "rgba(220, 38, 38, 0.85)" : "rgba(37, 99, 235, 0.85)";
      const toggleBorder = isRed ? "#fca5a5" : "#93c5fd";
      const glowColor = isRed ? "rgba(239, 68, 68, 0.9)" : "rgba(59, 130, 246, 0.9)";

      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 10;

      // Toggle outer bar
      ctx.fillStyle = toggleBg;
      ctx.strokeStyle = toggleBorder;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-len / 2, -th / 2, len, th, 3) : ctx.rect(-len / 2, -th / 2, len, th);
      ctx.fill();
      ctx.stroke();

      // Sleek physical indicator dot
      ctx.beginPath();
      ctx.arc(0, 0, th * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      ctx.restore();
    }

    // 2. Draw Stacked Pins directly ON the Goals (Clean 3D stacked pins, no text badges)
    for (const goal of goals) {
      if (!goal.totalCount || goal.totalCount <= 0) continue;

      const { cx, cy } = fieldToCanvas(goal.x, goal.y);
      const goalR = (goal.radius || GOAL_BASE_RADIUS) * scale;

      ctx.save();

      // Goal Radiant Scored Halo
      const hasRed = goal.redCount > 0;
      const hasBlue = goal.blueCount > 0;
      const dominantHalo = hasRed && !hasBlue ? "rgba(239, 68, 68, 0.35)" : (hasBlue && !hasRed ? "rgba(59, 130, 246, 0.35)" : "rgba(250, 204, 21, 0.35)");
      ctx.beginPath();
      ctx.arc(cx, cy, goalR * 1.4, 0, Math.PI * 2);
      ctx.fillStyle = dominantHalo;
      ctx.fill();

      // Draw Individual Stacked 3D Pins in Goal
      const pinCount = goal.stackedPins.length;
      for (let i = 0; i < pinCount; i++) {
        const pin = goal.stackedPins[i];
        let pX = cx;
        let pY = cy;

        // Radial offset if multiple pins stacked
        if (pinCount > 1) {
          const angle = (i * 2 * Math.PI) / pinCount;
          const dist = goalR * 0.52;
          pX = cx + Math.cos(angle) * dist;
          pY = cy + Math.sin(angle) * dist;
        }

        const pinRadiusPx = Math.max(6.5, PIN_RADIUS * scale * 1.35);

        ctx.save();
        const pinFill = pin.color === "red" ? "#dc2626" : (pin.color === "blue" ? "#2563eb" : "#eab308");
        const pinHighlight = pin.color === "red" ? "#f87171" : (pin.color === "blue" ? "#60a5fa" : "#fde047");

        ctx.shadowColor = pinHighlight;
        ctx.shadowBlur = 8;

        // Pin Outer Cone Base
        ctx.beginPath();
        ctx.arc(pX, pY, pinRadiusPx, 0, Math.PI * 2);
        ctx.fillStyle = pinFill;
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        // Pin Inner Cone Tip
        ctx.beginPath();
        ctx.arc(pX, pY, pinRadiusPx * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = pinHighlight;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.restore();
      }

      ctx.restore();
    }

    // 3. Draw Carried Pin on Robot (Clean 3D pin icon, no text box)
    if (carriedPin) {
      const { cx, cy } = fieldToCanvas(carriedPin.x, carriedPin.y);
      const pinR = PIN_RADIUS * scale * 1.5;

      ctx.save();
      const pinColor = carriedPin.color === "red" ? "#ef4444" : (carriedPin.color === "blue" ? "#3b82f6" : "#eab308");
      const pinLight = carriedPin.color === "red" ? "#fca5a5" : (carriedPin.color === "blue" ? "#93c5fd" : "#fef08a");
      ctx.shadowColor = pinColor;
      ctx.shadowBlur = 14;

      // Outer cone
      ctx.beginPath();
      ctx.arc(cx, cy, pinR, 0, Math.PI * 2);
      ctx.fillStyle = pinColor;
      ctx.fill();
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      // Inner tip
      ctx.beginPath();
      ctx.arc(cx, cy, pinR * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = pinLight;
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();
  }

  return {
    init,
    setEnabled,
    getIsEnabled,
    setAllianceColor,
    getAllianceColor,
    setGameMode,
    getGameMode,
    getCarriedPin,
    getCarriedPinWeightLbs,
    getClampedGoalWeightLbs: getCarriedPinWeightLbs,
    isGoalClamped: () => !!carriedPin,
    resetFieldElements,
    collectNearestPin,
    depositCarriedPin,
    turnToggle,
    updateStep,
    evaluateFullRoutine,
    calculateScore,
    render,
    parseOverrideTriggers,
    getPins: () => pins,
    getLoaders: () => loaders,
    getToggles: () => toggles,
    getGoals: () => goals,
  };
});
