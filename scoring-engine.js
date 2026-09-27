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
 * - "// turn toggle CW" -> Turns nearest wall toggle Clockwise, sets alliance color.
 * - "// turn toggle CCW" -> Turns nearest wall toggle Counter-Clockwise, sets alliance color.
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
  const GOAL_BASE_RADIUS = 3.2; // Goal base radius
  const TOGGLE_REACH = 24.0;    // Interaction radius for wall toggles
  const PIN_PICKUP_REACH = 8.0; // Reach distance for collecting pins
  const GOAL_DEPOSIT_REACH = 20.0; // Reach distance for depositing into goals
  const PIN_MASS_LBS = 0.45;    // Pin weight

  // 4 Official Wall Match Loaders (Loaders always have a pin ready)
  const DEFAULT_LOADERS = [
    { id: "loader_red_tl", name: "Red Top-Left Loader", wall: "west", color: "red", x: -65.25, y: 58.5 },
    { id: "loader_red_bl", name: "Red Bottom-Left Loader", wall: "west", color: "red", x: -65.25, y: -58.5 },
    { id: "loader_blue_tr", name: "Blue Top-Right Loader", wall: "east", color: "blue", x: 65.25, y: 58.5 },
    { id: "loader_blue_br", name: "Blue Bottom-Right Loader", wall: "east", color: "blue", x: 65.25, y: -58.5 },
  ];

  // 4 Official Perimeter Wall Toggles
  const DEFAULT_TOGGLES = [
    { id: "toggle_west", name: "West Wall Toggle", wall: "west", x: -70.5, y: 0.0, state: "neutral", rotation: 0, label: "West Toggle" },
    { id: "toggle_east", name: "East Wall Toggle", wall: "east", x: 70.5, y: 0.0, state: "neutral", rotation: 0, label: "East Toggle" },
    { id: "toggle_north", name: "North Wall Toggle", wall: "north", x: 0.0, y: 70.5, state: "neutral", rotation: 0, label: "North Toggle" },
    { id: "toggle_south", name: "South Wall Toggle", wall: "south", x: 0.0, y: -70.5, state: "neutral", rotation: 0, label: "South Toggle" },
  ];

  // 9 Official Override Goals
  const DEFAULT_GOALS = [
    { id: "goal_center", name: "Neutral Tall Goal (Center)", type: "neutral_tall", color: "yellow", x: 0.0, y: 0.0, height: 8.7, radius: 3.4 },
    { id: "goal_neutral_tl", name: "Neutral Goal (Top-Left)", type: "neutral_short", color: "yellow", x: -24.0, y: 48.0, height: 5.8, radius: 3.1 },
    { id: "goal_neutral_ml", name: "Neutral Goal (Mid-Left)", type: "neutral_short", color: "yellow", x: -48.0, y: 24.0, height: 5.8, radius: 3.1 },
    { id: "goal_neutral_mr", name: "Neutral Goal (Mid-Right)", type: "neutral_short", color: "yellow", x: 48.0, y: -24.0, height: 5.8, radius: 3.1 },
    { id: "goal_neutral_br", name: "Neutral Goal (Bottom-Right)", type: "neutral_short", color: "yellow", x: 24.0, y: -48.0, height: 5.8, radius: 3.1 },
    { id: "goal_red_1", name: "Red Alliance Goal 1", type: "alliance", color: "red", x: -48.0, y: -24.0, height: 3.25, radius: 3.1 },
    { id: "goal_red_2", name: "Red Alliance Goal 2", type: "alliance", color: "red", x: -24.0, y: -48.0, height: 3.25, radius: 3.1 },
    { id: "goal_blue_1", name: "Blue Alliance Goal 1", type: "alliance", color: "blue", x: 48.0, y: 24.0, height: 3.25, radius: 3.1 },
    { id: "goal_blue_2", name: "Blue Alliance Goal 2", type: "alliance", color: "blue", x: 24.0, y: 48.0, height: 3.25, radius: 3.1 },
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

  // Dynamic State
  let isEnabled = true; // Enabled by default for Override tracking
  let pins = [];
  let loaders = [];
  let toggles = [];
  let goals = [];
  let carriedPin = null; // Robot carries exactly ONE pin at a time: { id, color, x, y }
  let allianceColor = "red"; // 'red' | 'blue'
  let gameMode = "match15"; // 'match15' | 'skills60'
  let pinCounter = 100;

  function init() {
    resetFieldElements();
    try {
      const saved = localStorage.getItem("vex_override_engine_v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.isEnabled === "boolean") isEnabled = parsed.isEnabled;
        if (parsed.allianceColor) allianceColor = parsed.allianceColor;
        if (parsed.gameMode) gameMode = parsed.gameMode;
      }
    } catch (_) {}
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
      state: "field", // 'field' | 'held' | 'stacked' | 'loader'
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
   * Evaluates action comments / code to detect Override triggers:
   * 1. "// pin collected"
   * 2. "// pin deposited"
   * 3. "// turn toggle CW"
   * 4. "// turn toggle CCW"
   */
  function parseOverrideTriggers(action) {
    if (!action) return {};
    const text = [
      action.comment || "",
      action.label || "",
      action.customCode || "",
      action.subsystemCode || "",
    ].join(" ").toLowerCase();

    const pinCollected = /\/\/\s*pin\s*collected|pin\s*collected|collect\s*pin|grab\s*pin/i.test(text);
    const pinDeposited = /\/\/\s*pin\s*deposited|pin\s*deposited|deposit\s*pin|score\s*pin|drop\s*pin/i.test(text);
    const turnToggleCw = /\/\/\s*turn\s*toggle\s*cw|turn\s*toggle\s*cw|toggle\s*cw/i.test(text);
    const turnToggleCcw = /\/\/\s*turn\s*toggle\s*ccw|turn\s*toggle\s*ccw|toggle\s*ccw/i.test(text);

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
      // Robot already holds 1 pin (capacity = 1 pin)
      return carriedPin;
    }

    let nearestPin = null;
    let nearestDist = PIN_PICKUP_REACH;
    let fromLoader = null;

    // Check Wall Loaders (Loaders ALWAYS have a pin ready!)
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
      // Collected from Loader -> create pin for bot, and loader immediately keeps a pin ready!
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
      // Loader ALWAYS stays full with another pin ready
      fromLoader.hasPin = true;
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

    // Fallback: spawn a new pin if right near pickup area
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
    if (!carriedPin) return null;

    // Find nearest goal
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
      // If robot is not within range of any goal, drop at center goal or nearest
      nearestGoal = goals[0];
    }

    // Stack the pin on the goal
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
   * Action: Turn Toggle (CW or CCW if near a wall toggle)
   */
  function turnToggle(robotX, robotY, direction) {
    let nearestToggle = null;
    let nearestDist = TOGGLE_REACH;

    for (const toggle of toggles) {
      const dist = Math.hypot(toggle.x - robotX, toggle.y - robotY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestToggle = toggle;
      }
    }

    if (!nearestToggle) {
      // Find absolute nearest toggle even if slightly outside buffer
      let minD = 9999;
      for (const toggle of toggles) {
        const d = Math.hypot(toggle.x - robotX, toggle.y - robotY);
        if (d < minD) {
          minD = d;
          nearestToggle = toggle;
        }
      }
    }

    if (nearestToggle) {
      if (direction === "CW") {
        nearestToggle.rotationDeg = (nearestToggle.rotationDeg + 120) % 360;
        nearestToggle.state = "red"; // CW sets Red Alliance
      } else {
        nearestToggle.rotationDeg = (nearestToggle.rotationDeg - 120 + 360) % 360;
        nearestToggle.state = "blue"; // CCW sets Blue Alliance
      }
      return nearestToggle;
    }
    return null;
  }

  /**
   * Simulation Discrete Step Update
   */
  function updateStep(robotPose, robotDimensions, action, isSimulating) {
    if (!robotPose) return calculateScore();

    // 1. If robot carries a pin, update pin position to follow the robot exactly
    if (carriedPin) {
      carriedPin.x = robotPose.x;
      carriedPin.y = robotPose.y;
    }

    // 2. Parse action comment triggers
    if (action) {
      const triggers = parseOverrideTriggers(action);

      if (triggers.pinCollected) {
        collectNearestPin(robotPose.x, robotPose.y);
      }

      if (triggers.pinDeposited) {
        depositCarriedPin(robotPose.x, robotPose.y);
      }

      if (triggers.turnToggleCw) {
        turnToggle(robotPose.x, robotPose.y, "CW");
      }

      if (triggers.turnToggleCcw) {
        turnToggle(robotPose.x, robotPose.y, "CCW");
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

    // 1. Toggles Ownership
    for (const toggle of toggles) {
      if (toggle.state === "red") redTogglesOwned++;
      else if (toggle.state === "blue") blueTogglesOwned++;
    }

    // 2. Goals & Stacking (5 pts per alliance pin; 10 pts per yellow pin if toggle owned)
    for (const goal of goals) {
      totalPinsStacked += goal.totalCount;

      // Base Pin Points
      redScore += goal.redCount * 5;
      blueScore += goal.blueCount * 5;

      // Yellow Pins (10 pts for alliance owning the toggle in that quadrant)
      if (redTogglesOwned > 0) {
        redScore += goal.yellowCount * 10;
      }
      if (blueTogglesOwned > 0) {
        blueScore += goal.yellowCount * 10;
      }
    }

    // Toggles ownership bonus (10 pts per toggle)
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
      })),
    };
  }

  /**
   * Renders dynamic VRC Override Field elements (Active Toggles, Goal Stacking Badges, Carried Pin)
   * Designed to blend seamlessly with the high-resolution 3D field background.
   */
  function render(ctx, fieldToCanvas, scale, theme = "dark") {
    if (!ctx) return;

    ctx.save();

    // 1. Draw Active Perimeter Wall Toggles (only highlight when state has been changed from neutral)
    for (const toggle of toggles) {
      if (toggle.state === "neutral") continue; // Keep field graphic clean when neutral

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

      ctx.fillStyle = toggleBg;
      ctx.strokeStyle = toggleBorder;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-len / 2, -th / 2, len, th, 3) : ctx.rect(-len / 2, -th / 2, len, th);
      ctx.fill();
      ctx.stroke();

      // Compact Toggle State Label
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.max(8, Math.round(7.5 * scale))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(isRed ? "🔴 RED" : "🔵 BLUE", 0, 0);

      ctx.restore();
    }

    // 2. Draw Goal Stacking Badges (only when 1 or more pins are stacked on that goal)
    for (const goal of goals) {
      if (!goal.totalCount || goal.totalCount <= 0) continue; // Keep empty goals clean

      const { cx, cy } = fieldToCanvas(goal.x, goal.y);
      const r = (goal.radius || GOAL_BASE_RADIUS) * scale;

      ctx.save();

      // Draw stacked pin rings around the post
      for (let i = 0; i < goal.stackedPins.length; i++) {
        const pin = goal.stackedPins[i];
        const ringR = r * (0.6 + i * 0.18);
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = pin.color === "red" ? "#f87171" : (pin.color === "blue" ? "#60a5fa" : "#fde047");
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }

      // Compact Stacking Badge above Goal
      const badgeW = 46;
      const badgeH = 18;
      ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1.2;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(cx - badgeW / 2, cy - r - 18, badgeW, badgeH, 4) : ctx.rect(cx - badgeW / 2, cy - r - 18, badgeW, badgeH);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#facc15";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`🥅 ${goal.totalCount} Pins`, cx, cy - r - 9);

      // Breakdown tag (e.g. "🔴2 🟡1")
      const tagParts = [];
      if (goal.redCount > 0) tagParts.push(`🔴${goal.redCount}`);
      if (goal.blueCount > 0) tagParts.push(`🔵${goal.blueCount}`);
      if (goal.yellowCount > 0) tagParts.push(`🟡${goal.yellowCount}`);

      if (tagParts.length) {
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 8.5px monospace";
        ctx.fillText(tagParts.join(" "), cx, cy + r + 10);
      }

      ctx.restore();
    }

    // 3. Draw Carried Pin on Robot (when robot is currently holding a pin)
    if (carriedPin) {
      const { cx, cy } = fieldToCanvas(carriedPin.x, carriedPin.y);
      const pinR = PIN_RADIUS * scale * 1.2;

      ctx.save();
      const pinColor = carriedPin.color === "red" ? "#ef4444" : (carriedPin.color === "blue" ? "#3b82f6" : "#eab308");
      ctx.shadowColor = pinColor;
      ctx.shadowBlur = 12;

      // Carried Pin glowing circle
      ctx.beginPath();
      ctx.arc(cx, cy, pinR, 0, Math.PI * 2);
      ctx.fillStyle = pinColor;
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      // Sleek floating badge: 📌 1 PIN HELD
      const bW = 62;
      const bH = 15;
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(cx - bW / 2, cy - 24, bW, bH, 4) : ctx.rect(cx - bW / 2, cy - 24, bW, bH);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#facc15";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`📌 1 PIN HELD`, cx, cy - 16.5);

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
    calculateScore,
    render,
    parseOverrideTriggers,
    getPins: () => pins,
    getLoaders: () => loaders,
    getToggles: () => toggles,
    getGoals: () => goals,
  };
});
