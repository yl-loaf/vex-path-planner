// C++ LemLib Autonomous to Blocks Translation Engine
// Shared across Planner and Standalone Translator Page

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CppTranslator = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Safe comma splitter that preserves braces {}, parens (), brackets [], and string literals
  function splitCppArgsSafe(str) {
    if (!str) return [];
    const args = [];
    let cur = "";
    let braceDepth = 0;
    let parenDepth = 0;
    let inString = false;
    let stringChar = "";

    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (inString) {
        cur += c;
        if (c === stringChar && str[i - 1] !== "\\") inString = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        stringChar = c;
        cur += c;
      } else if (c === "{" || c === "<") {
        braceDepth++;
        cur += c;
      } else if (c === "}" || c === ">") {
        if (braceDepth > 0) braceDepth--;
        cur += c;
      } else if (c === "(") {
        parenDepth++;
        cur += c;
      } else if (c === ")") {
        if (parenDepth > 0) parenDepth--;
        cur += c;
      } else if (c === "," && braceDepth === 0 && parenDepth === 0) {
        args.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    if (cur.trim().length > 0) {
      args.push(cur.trim());
    }
    return args;
  }

  // Parse LemLib struct parameters like {.forwards = false, .maxSpeed = 100, .earlyExitRange = 2, .async = true}
  function parseLemlibStructParams(rawParamsStr) {
    const res = {
      forwards: true,
      maxSpeed: null,
      minSpeed: null,
      earlyExitRange: 0,
      lead: 0.6,
      async: false,
    };
    if (!rawParamsStr) return res;

    const fMatch = rawParamsStr.match(/\.forwards\s*=\s*(true|false)/i);
    if (fMatch) res.forwards = fMatch[1].toLowerCase() === "true";

    const maxM = rawParamsStr.match(/\.maxSpeed\s*=\s*([-\d.]+)/i);
    if (maxM) res.maxSpeed = parseFloat(maxM[1]);

    const minM = rawParamsStr.match(/\.minSpeed\s*=\s*([-\d.]+)/i);
    if (minM) res.minSpeed = parseFloat(minM[1]);

    const eerM = rawParamsStr.match(/\.earlyExitRange\s*=\s*([-\d.]+)/i);
    if (eerM) res.earlyExitRange = parseFloat(eerM[1]);

    const leadM = rawParamsStr.match(/\.lead\s*=\s*([-\d.]+)/i);
    if (leadM) res.lead = parseFloat(leadM[1]);

    const asyncM = rawParamsStr.match(/\.async\s*=\s*(true|false)/i);
    if (asyncM) res.async = asyncM[1].toLowerCase() === "true";

    return res;
  }

  // Parse DriveSide enum (e.g. DriveSide::LEFT, lemlib::DriveSide::RIGHT, "LEFT", "RIGHT")
  function parseDriveSideEnum(sideStr) {
    if (!sideStr) return "LEFT";
    const s = sideStr.toUpperCase();
    if (s.includes("RIGHT")) return "RIGHT";
    return "LEFT";
  }

  function cleanCommentText(label) {
    if (!label) return "";
    let clean = String(label).trim();
    if (clean.startsWith("//")) clean = clean.replace(/^\/\/\s*/, "");
    return clean;
  }

  function uid() {
    return "a" + Math.random().toString(36).slice(2, 9);
  }

  function createDefaultAction(type, defaultMaxSpeed = 127, defaultMinSpeed = 0) {
    return {
      id: uid(),
      type,
      x: 0,
      y: 0,
      theta: 0,
      lead: 0.6,
      timeout: 2000,
      forwards: true,
      maxSpeed: defaultMaxSpeed,
      minSpeed: defaultMinSpeed,
      earlyExitRange: 0,
      lockedSide: "LEFT",
      async: false,
      offsetX: 0,
      offsetY: 0,
      offsetTheta: 0,
      customCode: "",
      customDuration: 0,
      label: "",
    };
  }

  // Comprehensive C++ Autonomous Parser
  function parseCppAuton(rawCode, options = {}) {
    const defaultMaxSpeed = options.defaultMaxSpeed || 127;
    const defaultMinSpeed = options.defaultMinSpeed || 0;

    if (!rawCode || !rawCode.trim()) {
      return {
        success: false,
        routineName: "Imported Auton",
        startPose: null,
        actions: [],
        stats: { motionsCount: 0, customCount: 0, asyncCount: 0, commentsCount: 0 },
        log: ["No C++ code provided to parse."],
      };
    }

    const log = [];
    let routineName = "Imported Auton";

    // Detect function signature e.g. void autonomous() or void redLeftAuton()
    const fnMatch = rawCode.match(/void\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/i);
    if (fnMatch && fnMatch[1]) {
      const rawFn = fnMatch[1];
      if (rawFn.toLowerCase() === "autonomous") {
        routineName = "Autonomous";
      } else {
        const formatted = rawFn
          .replace(/_/g, " ")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        routineName = formatted || "Imported Auton";
      }
      log.push(`Detected autonomous routine function: ${fnMatch[1]} -> "${routineName}"`);
    }

    const rawLines = rawCode.replace(/\r\n/g, "\n").split("\n");
    const cleanedLines = [];
    let insideFn = false;

    for (let i = 0; i < rawLines.length; i++) {
      let l = rawLines[i].trim();
      if (!l) continue;

      if (/^void\s+[a-zA-Z0-9_]+\s*\([^)]*\)\s*\{/i.test(l)) {
        insideFn = true;
        continue;
      }
      if (insideFn && l === "}" && i >= rawLines.length - 2) {
        continue;
      }
      cleanedLines.push({ raw: rawLines[i], text: l, lineNum: i + 1 });
    }

    let detectedStartPose = null;
    const actions = [];
    let pendingComments = [];
    let pendingCustomLines = [];

    function flushCustomBlock() {
      if (pendingCustomLines.length === 0) return;

      const fullCode = pendingCustomLines.join("\n").trim();
      if (!fullCode) {
        pendingCustomLines = [];
        return;
      }

      const customAct = createDefaultAction("custom", defaultMaxSpeed, defaultMinSpeed);
      customAct.customCode = fullCode;

      if (pendingComments.length > 0) {
        customAct.label = pendingComments.join(" · ").trim();
        pendingComments = [];
      } else {
        const cMatch = fullCode.match(/\/\/\s*(.+)$/m);
        if (cMatch) {
          customAct.label = cleanCommentText(cMatch[1]);
        }
      }

      let totalDelayMs = 0;
      const delayMatches = fullCode.matchAll(/pros::(?:c::)?delay\s*\(\s*([-\d.]+)\s*\)/g);
      for (const dm of delayMatches) {
        const ms = parseFloat(dm[1]);
        if (!isNaN(ms) && ms > 0) totalDelayMs += ms;
      }
      if (totalDelayMs > 0) {
        customAct.customDuration = Number((totalDelayMs / 1000).toFixed(2));
      } else {
        customAct.customDuration = 0;
      }

      const isTask = /pros::Task\b|pros::task::create\b/i.test(fullCode);
      const isContinuousSubsystem = /intake\.move|conveyor\.move|flywheel\.move|piston\.set_value|clamp\.set_value/i.test(fullCode) && totalDelayMs === 0;

      if (isTask || isContinuousSubsystem) {
        customAct.async = true;
        customAct.showFlowchart = true;
        log.push(`Inferred async concurrency for custom subsystem block: "${customAct.label || 'Subsystem Task'}"`);
      }

      actions.push(customAct);
      pendingCustomLines = [];
    }

    for (let idx = 0; idx < cleanedLines.length; idx++) {
      const item = cleanedLines[idx];
      let line = item.text;

      // Handle pure comment line
      if (line.startsWith("//")) {
        const cText = cleanCommentText(line.replace(/^\/\/\s*/, ""));
        if (cText) pendingComments.push(cText);
        continue;
      }

      // Handle multi-line comment /* ... */
      if (line.startsWith("/*") && line.endsWith("*/")) {
        const cText = cleanCommentText(line.replace(/^\/\*\s*/, "").replace(/\s*\*\/$/, ""));
        if (cText) pendingComments.push(cText);
        continue;
      }

      // Extract inline comment if any
      let inlineComment = "";
      const inlineMatch = line.match(/\/\/\s*(.+)$/);
      if (inlineMatch) {
        inlineComment = cleanCommentText(inlineMatch[1]);
        line = line.replace(/\/\/\s*.+$/, "").trim();
      }

      // Check for chassis.setPose
      const setPoseMatch = line.match(/chassis\.setPose\s*\(\s*(?:lemlib::)?(?:Pose\s*\(\s*)?([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)(?:\s*,\s*([a-zA-Z0-9_]+))?\s*\)?\s*\)/i);
      if (setPoseMatch) {
        flushCustomBlock();
        const px = parseFloat(setPoseMatch[1]);
        const py = parseFloat(setPoseMatch[2]);
        const pt = parseFloat(setPoseMatch[3]);
        detectedStartPose = {
          x: isNaN(px) ? -60 : px,
          y: isNaN(py) ? -60 : py,
          theta: isNaN(pt) ? 0 : pt,
        };
        log.push(`Found start pose: chassis.setPose(${detectedStartPose.x}, ${detectedStartPose.y}, ${detectedStartPose.theta}°)`);
        pendingComments = [];
        continue;
      }

      // LemLib Movements
      const mtPointMatch = line.match(/chassis\.moveToPoint\s*\(([^;]+)\)/i);
      if (mtPointMatch) {
        flushCustomBlock();
        const args = splitCppArgsSafe(mtPointMatch[1]);
        const act = createDefaultAction("moveToPoint", defaultMaxSpeed, defaultMinSpeed);
        act.x = parseFloat(args[0]) || 0;
        act.y = parseFloat(args[1]) || 0;
        act.timeout = parseInt(args[2], 10) || 2000;

        let structParamStr = args.find((a) => a.startsWith("{") && a.endsWith("}"));
        if (structParamStr) {
          const p = parseLemlibStructParams(structParamStr);
          act.forwards = p.forwards;
          if (p.maxSpeed != null) act.maxSpeed = p.maxSpeed;
          if (p.minSpeed != null) act.minSpeed = p.minSpeed;
          if (p.earlyExitRange) act.earlyExitRange = p.earlyExitRange;
          if (p.async) act.async = true;
        }
        const lastArg = args[args.length - 1]?.trim().toLowerCase();
        if (lastArg === "true") act.async = true;

        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }

        if (act.async) act.showFlowchart = true;
        actions.push(act);
        log.push(`Parsed moveToPoint(${act.x}, ${act.y}) timeout: ${act.timeout}ms, async: ${act.async}`);
        continue;
      }

      const mtPoseMatch = line.match(/chassis\.moveToPose\s*\(([^;]+)\)/i);
      if (mtPoseMatch) {
        flushCustomBlock();
        const args = splitCppArgsSafe(mtPoseMatch[1]);
        const act = createDefaultAction("moveToPose", defaultMaxSpeed, defaultMinSpeed);
        act.x = parseFloat(args[0]) || 0;
        act.y = parseFloat(args[1]) || 0;
        act.theta = parseFloat(args[2]) || 0;
        act.timeout = parseInt(args[3], 10) || 2500;

        let structParamStr = args.find((a) => a.startsWith("{") && a.endsWith("}"));
        if (structParamStr) {
          const p = parseLemlibStructParams(structParamStr);
          act.forwards = p.forwards;
          if (p.lead != null) act.lead = p.lead;
          if (p.maxSpeed != null) act.maxSpeed = p.maxSpeed;
          if (p.minSpeed != null) act.minSpeed = p.minSpeed;
          if (p.earlyExitRange) act.earlyExitRange = p.earlyExitRange;
          if (p.async) act.async = true;
        }
        const lastArg = args[args.length - 1]?.trim().toLowerCase();
        if (lastArg === "true") act.async = true;

        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }

        if (act.async) act.showFlowchart = true;
        actions.push(act);
        log.push(`Parsed moveToPose(${act.x}, ${act.y}, ${act.theta}°) timeout: ${act.timeout}ms, lead: ${act.lead}`);
        continue;
      }

      const ttPointMatch = line.match(/chassis\.turnToPoint\s*\(([^;]+)\)/i);
      if (ttPointMatch) {
        flushCustomBlock();
        const args = splitCppArgsSafe(ttPointMatch[1]);
        const act = createDefaultAction("turnToPoint", defaultMaxSpeed, defaultMinSpeed);
        act.x = parseFloat(args[0]) || 0;
        act.y = parseFloat(args[1]) || 0;
        act.timeout = parseInt(args[2], 10) || 1500;

        let structParamStr = args.find((a) => a.startsWith("{") && a.endsWith("}"));
        if (structParamStr) {
          const p = parseLemlibStructParams(structParamStr);
          act.forwards = p.forwards;
          if (p.maxSpeed != null) act.maxSpeed = p.maxSpeed;
          if (p.minSpeed != null) act.minSpeed = p.minSpeed;
          if (p.earlyExitRange) act.earlyExitRange = p.earlyExitRange;
          if (p.async) act.async = true;
        }
        const lastArg = args[args.length - 1]?.trim().toLowerCase();
        if (lastArg === "true") act.async = true;

        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }

        if (act.async) act.showFlowchart = true;
        actions.push(act);
        log.push(`Parsed turnToPoint(${act.x}, ${act.y}) timeout: ${act.timeout}ms`);
        continue;
      }

      const ttHeadingMatch = line.match(/chassis\.turnToHeading\s*\(([^;]+)\)/i);
      if (ttHeadingMatch) {
        flushCustomBlock();
        const args = splitCppArgsSafe(ttHeadingMatch[1]);
        const act = createDefaultAction("turnToHeading", defaultMaxSpeed, defaultMinSpeed);
        act.theta = parseFloat(args[0]) || 0;
        act.timeout = parseInt(args[1], 10) || 1500;

        let structParamStr = args.find((a) => a.startsWith("{") && a.endsWith("}"));
        if (structParamStr) {
          const p = parseLemlibStructParams(structParamStr);
          if (p.maxSpeed != null) act.maxSpeed = p.maxSpeed;
          if (p.minSpeed != null) act.minSpeed = p.minSpeed;
          if (p.earlyExitRange) act.earlyExitRange = p.earlyExitRange;
          if (p.async) act.async = true;
        }
        const lastArg = args[args.length - 1]?.trim().toLowerCase();
        if (lastArg === "true") act.async = true;

        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }

        if (act.async) act.showFlowchart = true;
        actions.push(act);
        log.push(`Parsed turnToHeading(${act.theta}°) timeout: ${act.timeout}ms`);
        continue;
      }

      const swPointMatch = line.match(/chassis\.swingToPoint\s*\(([^;]+)\)/i);
      if (swPointMatch) {
        flushCustomBlock();
        const args = splitCppArgsSafe(swPointMatch[1]);
        const act = createDefaultAction("swingToPoint", defaultMaxSpeed, defaultMinSpeed);
        act.x = parseFloat(args[0]) || 0;
        act.y = parseFloat(args[1]) || 0;
        act.lockedSide = parseDriveSideEnum(args[2]);
        act.timeout = parseInt(args[3], 10) || 2000;

        let structParamStr = args.find((a) => a.startsWith("{") && a.endsWith("}"));
        if (structParamStr) {
          const p = parseLemlibStructParams(structParamStr);
          act.forwards = p.forwards;
          if (p.maxSpeed != null) act.maxSpeed = p.maxSpeed;
          if (p.minSpeed != null) act.minSpeed = p.minSpeed;
          if (p.earlyExitRange) act.earlyExitRange = p.earlyExitRange;
          if (p.async) act.async = true;
        }
        const lastArg = args[args.length - 1]?.trim().toLowerCase();
        if (lastArg === "true") act.async = true;

        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }

        if (act.async) act.showFlowchart = true;
        actions.push(act);
        log.push(`Parsed swingToPoint(${act.x}, ${act.y}, ${act.lockedSide}) timeout: ${act.timeout}ms`);
        continue;
      }

      const swHeadingMatch = line.match(/chassis\.swingToHeading\s*\(([^;]+)\)/i);
      if (swHeadingMatch) {
        flushCustomBlock();
        const args = splitCppArgsSafe(swHeadingMatch[1]);
        const act = createDefaultAction("swingToHeading", defaultMaxSpeed, defaultMinSpeed);
        act.theta = parseFloat(args[0]) || 0;
        act.lockedSide = parseDriveSideEnum(args[1]);
        act.timeout = parseInt(args[2], 10) || 2000;

        let structParamStr = args.find((a) => a.startsWith("{") && a.endsWith("}"));
        if (structParamStr) {
          const p = parseLemlibStructParams(structParamStr);
          act.forwards = p.forwards;
          if (p.maxSpeed != null) act.maxSpeed = p.maxSpeed;
          if (p.minSpeed != null) act.minSpeed = p.minSpeed;
          if (p.earlyExitRange) act.earlyExitRange = p.earlyExitRange;
          if (p.async) act.async = true;
        }
        const lastArg = args[args.length - 1]?.trim().toLowerCase();
        if (lastArg === "true") act.async = true;

        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }

        if (act.async) act.showFlowchart = true;
        actions.push(act);
        log.push(`Parsed swingToHeading(${act.theta}°, ${act.lockedSide}) timeout: ${act.timeout}ms`);
        continue;
      }

      // Non-LemLib line: Subsystem / pros::delay / pros::Task / Custom C++
      let fullLine = item.text;
      if (inlineComment) {
        fullLine = `${item.text} // ${inlineComment}`;
      }
      pendingCustomLines.push(fullLine);
    }

    flushCustomBlock();

    // Contextual Multitask Post-processing
    for (let i = 0; i < actions.length - 1; i++) {
      const cur = actions[i];
      const next = actions[i + 1];
      if (cur.type === "custom" && cur.customDuration === 0 && next.type !== "custom") {
        cur.async = true;
        cur.showFlowchart = true;
      }
    }

    let motionsCount = 0;
    let customCount = 0;
    let asyncCount = 0;
    let commentsCount = 0;

    actions.forEach((a) => {
      if (a.type === "custom") customCount++;
      else motionsCount++;
      if (a.async) asyncCount++;
      if (a.label) commentsCount++;
    });

    return {
      success: actions.length > 0 || detectedStartPose !== null,
      routineName,
      startPose: detectedStartPose,
      actions,
      stats: {
        motionsCount,
        customCount,
        asyncCount,
        commentsCount,
      },
      log,
    };
  }

  const SAMPLE_ROUTINES = {
    preload_rush: `// Autonomous: 4-Ring Alliance Stake & Mogo Rush
void autonomous() {
  // Set robot starting pose touching alliance wall
  chassis.setPose(-60, -60, 0);

  // Spin intake to grab preload ring
  intake.move(127); // spin intake full
  chassis.moveToPoint(-24, -24, 2000, {.forwards = true, .maxSpeed = 110, .earlyExitRange = 2});

  // Rush center mobile goal in reverse
  chassis.moveToPose(0, 48, 90, 2500, {.lead = 0.5, .forwards = false}); // clamp mogo

  // Clamp goal and pause briefly
  clamp.set_value(true); // grab goal
  pros::delay(200);

  // Turn and score alliance stake
  chassis.turnToHeading(180, 1500, {.maxSpeed = 90}); // face stake
  chassis.moveToPoint(24, 48, 2000); // score stack
}`,

    multitask_subsystems: `// Autonomous: Concurrent Subsystems & Async Movement
void redLeftAuton() {
  chassis.setPose(-54, -54, 45);

  // Start concurrent intake task while driving
  pros::Task intakeTask([]{
    intake.move(127);
  }); // async intake task

  // Drive forward to first stack with async enabled
  chassis.moveToPoint(-24, -24, 2000, {.maxSpeed = 120}, true); // drive async

  // Raise lift while chassis is in motion
  lift.move_absolute(1200, 100);
  chassis.waitUntilDone(); // sync barrier

  // Deploy pneumatic clamp on mogo
  clamp.set_value(true);
  pros::delay(150);

  // Swing to corner and score
  chassis.swingToHeading(270, DriveSide::LEFT, 1800); // swing corner
}`,

    boomerang_swings: `// Autonomous: Boomerang Paths & Swing Motions
void skillsAuton() {
  chassis.setPose(0, -60, 0);

  // Boomerang curve to mogo
  chassis.moveToPose(24, -24, 45, 2500, {.lead = 0.65, .forwards = true}); // curved approach

  // Swing turn around obstacle
  chassis.swingToPoint(48, 0, DriveSide::RIGHT, 2000, {.forwards = true}); // swing right side

  // Turn directly to alliance wall
  chassis.turnToHeading(180, 1400); // turn to wall
  chassis.moveToPoint(48, -48, 2000, {.forwards = false, .maxSpeed = 100}); // reverse to stake
}`,
  };

  return {
    splitCppArgsSafe,
    parseLemlibStructParams,
    parseDriveSideEnum,
    cleanCommentText,
    parseCppAuton,
    createDefaultAction,
    SAMPLE_ROUTINES,
  };
});
