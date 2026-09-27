/**
 * VEX V5 LemLib Path Planner - Field Scoring Engine & Dynamic Element State Tracking (BETA)
 * 
 * Rules Reference: VEX Robotics Competition (VRC High Stakes / Override)
 * - Mobile Goal (Mogo) mass: 3.5 lbs (1.59 kg)
 * - Ring outer diam: 7.0", inner diam: 3.0", height: 2.0"
 * - Scoring:
 *   - Ring on Mobile Goal Stake: 1 pt each
 *   - Top Ring Bonus on Mobile Goal Stake: +2 pts (worth 3 pts total)
 *   - Ring on Wall Stake: 1 pt each (top ring 3 pts)
 *   - Ring on High Stake / Ladder: 2 pts (top ring 4 pts)
 *   - Mobile Goal placed in Corner: +5 pts
 *   - Autonomous Win Point (AWP): Alliance Stake scored + Mogo scored + Ladder contact at end
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

  const MOGO_WEIGHT_LBS = 3.5;
  const RING_OUTER_RADIUS = 3.5; // inches (7" diameter)
  const RING_INNER_RADIUS = 1.5; // inches (3" hole)
  const MOGO_RADIUS = 3.1; // inches base radius
  const INTAKE_REACH_INCHES = 5.5; // Reach distance in front of intake
  const CLAMP_REACH_INCHES = 5.0; // Reach distance behind rear bumper

  // Official starting positions for Rings (VRC High Stakes / Override)
  // Field coordinate system: Origin (0,0) = center, X: [-70.5, +70.5], Y: [-70.5, +70.5]
  const DEFAULT_RINGS = [
    // Center Ladder ring clusters
    { id: "ring_c_red_1", color: "red", x: -9.0, y: 0.0 },
    { id: "ring_c_red_2", color: "red", x: -18.0, y: 0.0 },
    { id: "ring_c_red_3", color: "red", x: 0.0, y: -9.0 },
    { id: "ring_c_red_4", color: "red", x: 0.0, y: -18.0 },
    { id: "ring_c_blue_1", color: "blue", x: 9.0, y: 0.0 },
    { id: "ring_c_blue_2", color: "blue", x: 18.0, y: 0.0 },
    { id: "ring_c_blue_3", color: "blue", x: 0.0, y: 9.0 },
    { id: "ring_c_blue_4", color: "blue", x: 0.0, y: 18.0 },

    // Left Quadrant (Red Alliance territory)
    { id: "ring_red_tl_1", color: "red", x: -48.0, y: 48.0 },
    { id: "ring_red_tl_2", color: "red", x: -48.0, y: 24.0 },
    { id: "ring_red_bl_1", color: "red", x: -48.0, y: -48.0 },
    { id: "ring_red_bl_2", color: "red", x: -24.0, y: -24.0 },
    { id: "ring_red_stack_1", color: "red", x: -60.0, y: 0.0 },

    // Right Quadrant (Blue Alliance territory)
    { id: "ring_blue_tr_1", color: "blue", x: 48.0, y: 48.0 },
    { id: "ring_blue_tr_2", color: "blue", x: 24.0, y: 24.0 },
    { id: "ring_blue_br_1", color: "blue", x: 48.0, y: -48.0 },
    { id: "ring_blue_br_2", color: "blue", x: 48.0, y: -24.0 },
    { id: "ring_blue_stack_1", color: "blue", x: 60.0, y: 0.0 },

    // Match Load Preloads / Loading Zones
    { id: "ring_load_red_top", color: "red", x: -65.0, y: 58.5 },
    { id: "ring_load_red_bot", color: "red", x: -65.0, y: -58.5 },
    { id: "ring_load_blue_top", color: "blue", x: 65.0, y: 58.5 },
    { id: "ring_load_blue_bot", color: "blue", x: 65.0, y: -58.5 },
  ];

  // Official Wall Stakes & High Stakes
  const DEFAULT_STAKES = [
    { id: "stake_red_alliance", name: "Red Alliance Stake", color: "red", type: "wall", x: -70.0, y: 0.0, rings: [] },
    { id: "stake_blue_alliance", name: "Blue Alliance Stake", color: "blue", type: "wall", x: 70.0, y: 0.0, rings: [] },
    { id: "stake_neutral_north", name: "North Neutral Stake", color: "neutral", type: "wall", x: 0.0, y: 70.0, rings: [] },
    { id: "stake_neutral_south", name: "South Neutral Stake", color: "neutral", type: "wall", x: 0.0, y: -70.0, rings: [] },
    { id: "stake_ladder_high", name: "Center High Stake", color: "yellow", type: "ladder", x: 0.0, y: 0.0, rings: [] },
  ];

  // Mobile Goal Default Positions
  const DEFAULT_MOGOS = [
    { id: "goal_center", name: "Middle Goal", color: "yellow", x: 0.0, y: 0.0, radius: 3.1, rings: [] },
    { id: "goal_red_1", name: "Red Mobile Goal 1", color: "red", x: -48.0, y: -24.0, radius: 3.1, rings: [] },
    { id: "goal_red_2", name: "Red Mobile Goal 2", color: "red", x: -24.0, y: -48.0, radius: 3.1, rings: [] },
    { id: "goal_blue_1", name: "Blue Mobile Goal 1", color: "blue", x: 48.0, y: 24.0, radius: 3.1, rings: [] },
    { id: "goal_blue_2", name: "Blue Mobile Goal 2", color: "blue", x: 24.0, y: 48.0, radius: 3.1, rings: [] },
    { id: "goal_neutral_tl", name: "Neutral Mobile Goal (TL)", color: "yellow", x: -24.0, y: 48.0, radius: 3.1, rings: [] },
    { id: "goal_neutral_ml", name: "Neutral Mobile Goal (ML)", color: "yellow", x: -48.0, y: 24.0, radius: 3.1, rings: [] },
    { id: "goal_neutral_mr", name: "Neutral Mobile Goal (MR)", color: "yellow", x: 48.0, y: -24.0, radius: 3.1, rings: [] },
    { id: "goal_neutral_br", name: "Neutral Mobile Goal (BR)", color: "yellow", x: 24.0, y: -48.0, radius: 3.1, rings: [] },
  ];

  // State
  let isEnabled = false;
  let rings = [];
  let mogos = [];
  let stakes = [];
  let allianceColor = "red"; // 'red' | 'blue'
  let gameMode = "match15"; // 'match15' | 'skills60'
  let robotSubsystems = {
    intake: false,       // true = spinning forward, false = stopped
    intakeReverse: false,
    clamp: false,        // true = pneumatic clamp locked
    clampedMogoId: null, // ID of currently clamped goal
    onboardRings: [],    // Rings currently inside conveyor hopper (max 2)
  };

  // Timeline telemetry cache: maps time step -> snapshot of score & elements
  let timelineScores = [];

  function init() {
    resetFieldElements();
    try {
      const saved = localStorage.getItem("vex_scoring_engine_beta_v1");
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
      localStorage.setItem("vex_scoring_engine_beta_v1", JSON.stringify({
        isEnabled,
        allianceColor,
        gameMode,
      }));
    } catch (_) {}
  }

  function resetFieldElements() {
    rings = DEFAULT_RINGS.map((r) => ({
      id: r.id,
      color: r.color,
      x: r.x,
      y: r.y,
      initialX: r.x,
      initialY: r.y,
      state: "field", // 'field' | 'hopper' | 'mogo' | 'stake'
      attachedId: null,
    }));

    mogos = DEFAULT_MOGOS.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      x: m.x,
      y: m.y,
      initialX: m.x,
      initialY: m.y,
      radius: m.radius,
      rings: [],
      clamped: false,
    }));

    stakes = DEFAULT_STAKES.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      type: s.type,
      x: s.x,
      y: s.y,
      rings: [],
    }));

    robotSubsystems = {
      intake: false,
      intakeReverse: false,
      clamp: false,
      clampedMogoId: null,
      onboardRings: [],
    };

    timelineScores = [];
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

  function isGoalClamped() {
    return isEnabled && !!robotSubsystems.clampedMogoId;
  }

  function getClampedGoalWeightLbs() {
    return isGoalClamped() ? MOGO_WEIGHT_LBS : 0;
  }

  /**
   * Evaluates action code or comment/label to detect subsystem state changes.
   */
  function parseSubsystemFromAction(action) {
    if (!action) return {};
    const text = [
      action.label || "",
      action.customCode || "",
      action.subsystemCode || "",
      action.comment || "",
    ].join(" ").toLowerCase();

    let intake = null;
    let clamp = null;

    // Detect clamp commands
    if (/(clamp|mogo|piston).*?(true|on|lock|1|close|grab)/i.test(text) || /clamp\.set_value\(\s*(true|1)\s*\)/i.test(text)) {
      clamp = true;
    } else if (/(clamp|mogo|piston).*?(false|off|unlock|0|open|release)/i.test(text) || /clamp\.set_value\(\s*(false|0)\s*\)/i.test(text)) {
      clamp = false;
    }

    // Detect intake commands
    if (/intake.*?(127|100|forward|on|spin|in|move\(127\))/i.test(text)) {
      intake = true;
    } else if (/intake.*?(0|stop|off|brake)/i.test(text) || /intake\.move\(\s*0\s*\)/i.test(text)) {
      intake = false;
    } else if (/intake.*?(-127|-100|reverse|out)/i.test(text)) {
      intake = "reverse";
    }

    return { intake, clamp };
  }

  /**
   * Discrete time-step update for robot pose (x, y, theta) and actions during simulation.
   */
  function updateStep(robotPose, robotDimensions, action, isSimulating) {
    if (!isEnabled || !robotPose) return calculateScore();

    const robotL = robotDimensions.robotL || 14.0;
    const robotW = robotDimensions.robotW || 14.0;
    const rad = (robotPose.theta * Math.PI) / 180;
    const fx = Math.sin(rad), fy = Math.cos(rad);

    // Front intake position (center of front bumper)
    const intakeX = robotPose.x + (robotL / 2) * fx;
    const intakeY = robotPose.y + (robotL / 2) * fy;

    // Rear clamp position (center of rear bumper)
    const clampX = robotPose.x - (robotL / 2) * fx;
    const clampY = robotPose.y - (robotL / 2) * fy;

    // Auto-detect subsystem triggers from action if present
    if (action) {
      const parsed = parseSubsystemFromAction(action);
      if (parsed.clamp !== null) robotSubsystems.clamp = parsed.clamp;
      if (parsed.intake !== null) {
        if (parsed.intake === "reverse") {
          robotSubsystems.intake = false;
          robotSubsystems.intakeReverse = true;
        } else {
          robotSubsystems.intake = parsed.intake;
          robotSubsystems.intakeReverse = false;
        }
      }
    }

    // Handle Mobile Goal Clamp & Drag
    if (robotSubsystems.clamp) {
      if (!robotSubsystems.clampedMogoId) {
        // Search for nearest unclamped mobile goal within reach of rear clamp
        let nearestMogo = null;
        let minDist = CLAMP_REACH_INCHES;
        for (const mogo of mogos) {
          if (mogo.clamped) continue;
          const dist = Math.hypot(mogo.x - clampX, mogo.y - clampY);
          if (dist < minDist) {
            minDist = dist;
            nearestMogo = mogo;
          }
        }
        if (nearestMogo) {
          nearestMogo.clamped = true;
          robotSubsystems.clampedMogoId = nearestMogo.id;
        }
      }
    } else {
      // Unclamped: release goal if held
      if (robotSubsystems.clampedMogoId) {
        const held = mogos.find((m) => m.id === robotSubsystems.clampedMogoId);
        if (held) {
          held.clamped = false;
        }
        robotSubsystems.clampedMogoId = null;
      }
    }

    // Update position of clamped mobile goal (towed directly behind rear bumper)
    if (robotSubsystems.clampedMogoId) {
      const held = mogos.find((m) => m.id === robotSubsystems.clampedMogoId);
      if (held) {
        held.x = robotPose.x - (robotL / 2 + 2.5) * fx;
        held.y = robotPose.y - (robotL / 2 + 2.5) * fy;
      }
    }

    // Handle Ring Intaking
    if (robotSubsystems.intake) {
      for (const ring of rings) {
        if (ring.state !== "field") continue;
        const d = Math.hypot(ring.x - intakeX, ring.y - intakeY);
        if (d <= INTAKE_REACH_INCHES) {
          // Ring intaked!
          if (robotSubsystems.clampedMogoId) {
            // Transfer directly onto clamped mobile goal post!
            const held = mogos.find((m) => m.id === robotSubsystems.clampedMogoId);
            if (held && held.rings.length < 6) {
              ring.state = "mogo";
              ring.attachedId = held.id;
              ring.x = held.x;
              ring.y = held.y;
              held.rings.push(ring);
            } else {
              // Goal is full (max 6 rings), hold in hopper
              ring.state = "hopper";
              robotSubsystems.onboardRings.push(ring);
            }
          } else {
            // No mogo clamped, hold in robot hopper (max 2)
            if (robotSubsystems.onboardRings.length < 2) {
              ring.state = "hopper";
              robotSubsystems.onboardRings.push(ring);
            }
          }
        }
      }
    }

    // If robot holds hopper rings and has a clamped mogo, transfer them onto mogo
    if (robotSubsystems.clampedMogoId && robotSubsystems.onboardRings.length > 0) {
      const held = mogos.find((m) => m.id === robotSubsystems.clampedMogoId);
      if (held && held.rings.length < 6) {
        const ring = robotSubsystems.onboardRings.shift();
        if (ring) {
          ring.state = "mogo";
          ring.attachedId = held.id;
          ring.x = held.x;
          ring.y = held.y;
          held.rings.push(ring);
        }
      }
    }

    return calculateScore(robotPose);
  }

  /**
   * Computes official VRC High Stakes points breakdown.
   */
  function calculateScore(robotPose) {
    let score = 0;
    let ringsOnMogos = 0;
    let mogoTopRingBonus = 0;
    let ringsOnWallStakes = 0;
    let ringsOnHighStake = 0;
    let mogoCornerPoints = 0;
    let awpCriteria = {
      stakeScored: false,
      mogoScored: false,
      endLadderTouch: false,
      totalCount: 0,
      awpCompleted: false,
    };

    // 1. Mobile Goal Scoring
    for (const m of mogos) {
      const count = m.rings.length;
      if (count > 0) {
        // Base ring points: 1 pt each
        ringsOnMogos += count;
        // Top Ring Bonus: +2 pts (so top ring is worth 3 pts total)
        mogoTopRingBonus += 2;

        if (m.color === allianceColor || m.color === "yellow") {
          awpCriteria.mogoScored = true;
        }
      }

      // Check Corner Zones (Inner Corners ±50" to ±70.5")
      const inCorner = (Math.abs(m.x) > 52 && Math.abs(m.y) > 52);
      if (inCorner) {
        mogoCornerPoints += 5;
      }
    }

    // 2. Wall Stakes Scoring
    for (const s of stakes) {
      const count = s.rings.length;
      if (count > 0) {
        if (s.type === "ladder") {
          ringsOnHighStake += count * 2; // High stake = 2 pts
        } else {
          ringsOnWallStakes += count;
          ringsOnWallStakes += 2; // Top ring bonus
          if (s.color === allianceColor) {
            awpCriteria.stakeScored = true;
          }
        }
      }
    }

    // 3. Autonomous Win Point (AWP) Criteria Check
    if (robotPose) {
      // Check if robot is in contact with center ladder at end of auton (|X| < 18, |Y| < 18)
      if (Math.abs(robotPose.x) < 18 && Math.abs(robotPose.y) < 18) {
        awpCriteria.endLadderTouch = true;
      }
    }

    let awpCount = 0;
    if (awpCriteria.stakeScored) awpCount++;
    if (awpCriteria.mogoScored) awpCount++;
    if (awpCriteria.endLadderTouch) awpCount++;
    awpCriteria.totalCount = awpCount;
    awpCriteria.awpCompleted = (awpCount >= 3);

    score = ringsOnMogos + mogoTopRingBonus + ringsOnWallStakes + ringsOnHighStake + mogoCornerPoints;

    return {
      totalScore: score,
      ringsOnMogos,
      mogoTopRingBonus,
      ringsOnWallStakes,
      ringsOnHighStake,
      mogoCornerPoints,
      awpCriteria,
      subsystems: {
        intake: robotSubsystems.intake,
        clamp: robotSubsystems.clamp,
        clampedMogoId: robotSubsystems.clampedMogoId,
        hopperRingCount: robotSubsystems.onboardRings.length,
      },
    };
  }

  /**
   * Renders interactive field game elements (Rings, Mogos, Stakes) on the main canvas.
   */
  function render(ctx, fieldToCanvas, scale, theme = "dark") {
    if (!isEnabled) return;

    ctx.save();

    // 1. Draw Field Rings
    for (const ring of rings) {
      if (ring.state !== "field") continue;
      const { cx, cy } = fieldToCanvas(ring.x, ring.y);
      const outerR = RING_OUTER_RADIUS * scale;
      const innerR = RING_INNER_RADIUS * scale;

      ctx.save();
      // Outer shadow
      ctx.shadowColor = ring.color === "red" ? "rgba(239, 68, 68, 0.6)" : "rgba(59, 130, 246, 0.6)";
      ctx.shadowBlur = 6;

      // Donut outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2, false);
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
      ctx.fillStyle = ring.color === "red" ? "#ef4444" : "#3b82f6";
      ctx.fill();

      // Donut border
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = ring.color === "red" ? "#fee2e2" : "#dbeafe";
      ctx.stroke();

      // Center ring hole dark backdrop
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2, false);
      ctx.fillStyle = "rgba(15, 23, 42, 0.4)";
      ctx.fill();

      ctx.restore();
    }

    // 2. Draw Mobile Goal Stacked Rings
    for (const mogo of mogos) {
      if (mogo.rings.length > 0) {
        const { cx, cy } = fieldToCanvas(mogo.x, mogo.y);
        const ringCount = mogo.rings.length;
        
        ctx.save();
        // Draw ring indicators around the center post
        for (let i = 0; i < ringCount; i++) {
          const ring = mogo.rings[i];
          const ringRadius = (2.2 + i * 0.4) * scale;
          ctx.beginPath();
          ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = ring.color === "red" ? "#f87171" : "#60a5fa";
          ctx.stroke();
        }

        // Top ring badge count
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.max(10, Math.round(11 * scale))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 4;
        ctx.fillText(`${ringCount}`, cx, cy);
        ctx.restore();
      }
    }

    // 3. Draw Wall Stakes
    for (const stake of stakes) {
      const { cx, cy } = fieldToCanvas(stake.x, stake.y);
      const r = 2.4 * scale;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = stake.color === "red" ? "#dc2626" : (stake.color === "blue" ? "#2563eb" : "#eab308");
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      if (stake.rings.length > 0) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.max(9, Math.round(9 * scale))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${stake.rings.length}`, cx, cy);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // Pre-calculate full routine score telemetry across the simulation path
  function precomputeRoutine(simPath, robotDimensions, actions) {
    if (!isEnabled || !simPath || !simPath.length) return calculateScore();

    resetFieldElements();
    let currentScore = calculateScore();

    for (let i = 0; i < simPath.length; i++) {
      const pt = simPath[i];
      // Find matching action if available
      const action = actions ? actions[pt.actionIdx || 0] : null;
      currentScore = updateStep(pt, robotDimensions, action, true);
    }

    return currentScore;
  }

  // Public API
  return {
    init,
    setEnabled,
    getIsEnabled,
    setAllianceColor,
    getAllianceColor,
    setGameMode,
    getGameMode,
    isGoalClamped,
    getClampedGoalWeightLbs,
    resetFieldElements,
    updateStep,
    calculateScore,
    render,
    precomputeRoutine,
    parseSubsystemFromAction,
    getRings: () => rings,
    getMogos: () => mogos,
    getStakes: () => stakes,
    getSubsystems: () => robotSubsystems,
    toggleIntake: () => { robotSubsystems.intake = !robotSubsystems.intake; },
    toggleClamp: () => { robotSubsystems.clamp = !robotSubsystems.clamp; },
  };
});
