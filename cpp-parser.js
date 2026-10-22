// C++ LemLib Autonomous to Blocks Translation Engine
// Shared across Planner and Standalone Translator Page

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CppTranslator = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this), function () {
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

    const driftM = rawParamsStr.match(/\.(?:horizontalDrift|driftScaler|drift)\s*=\s*([-\d.]+)/i);
    if (driftM) res.driftScaler = parseFloat(driftM[1]);

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

  // Parse multiple statements or code block into an array of actions
  function parseStatementsToList(codeStr, defaultMaxSpeed = 127, defaultMinSpeed = 0, recursionDepth = 0, visitedFns = null, customFnsMap = null) {
    if (!codeStr || typeof codeStr !== "string" || recursionDepth > 3) return [];
    const trimmed = codeStr.trim();
    if (!trimmed) return [];

    // Split code by semicolons and nested blocks safely
    const statements = [];
    let cur = "";
    let parenDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let stringChar = "";

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      const prev = i > 0 ? trimmed[i - 1] : "";

      if (inString) {
        cur += ch;
        if (ch === stringChar && prev !== "\\") {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        cur += ch;
        continue;
      }

      if (ch === "(") parenDepth++;
      else if (ch === ")") { if (parenDepth > 0) parenDepth--; }
      else if (ch === "{") braceDepth++;
      else if (ch === "}") { if (braceDepth > 0) braceDepth--; }

      cur += ch;

      if (braceDepth === 0 && parenDepth === 0) {
        if (ch === ";" || ch === "\n" || (ch === "}" && prev !== "\\")) {
          const stmt = cur.trim();
          if (stmt && stmt !== ";") {
            statements.push(stmt);
          }
          cur = "";
        }
      }
    }
    const rem = cur.trim();
    if (rem && rem !== ";") statements.push(rem);

    const result = [];
    statements.forEach((stmt) => {
      const act = parseStatementToAction(stmt, defaultMaxSpeed, defaultMinSpeed, recursionDepth, visitedFns, customFnsMap);
      if (act) result.push(act);
    });

    return result;
  }

  // Parse a single C++ statement line into a LemLib action object or custom action
  function parseStatementToAction(stmtStr, defaultMaxSpeed = 127, defaultMinSpeed = 0, recursionDepth = 0, visitedFns = null, customFnsMap = null) {
    if (!stmtStr || recursionDepth > 4) return null;
    const line = stmtStr.trim().replace(/;$/, "").trim();
    if (!line) return null;

    const activeFnsMap = customFnsMap || getActiveCustomFunctionsMap();

    // Check if statement contains an if-else loop or ternary
    if (recursionDepth <= 2 && (/^if\s*\(/i.test(line) || tryParseTernary(line))) {
      const ifElseAct = parseIfElseFromCode(line, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, activeFnsMap);
      if (ifElseAct) {
        return ifElseAct;
      }
    }

    // Check if statement contains a while or for loop
    if (recursionDepth <= 2 && /^(while|for)\s*\(/i.test(line)) {
      const loopAct = parseLoopFromCode(line, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, activeFnsMap);
      if (loopAct) {
        return loopAct;
      }
    }

    // moveToPoint (supports both chassis.moveToPoint and custom moveToPoint(x, y, theta))
    const mtPointMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?moveToPoint\s*\(([^;]+)\)$/i);
    if (mtPointMatch && isValidChassisReceiver(mtPointMatch[1], "moveToPoint", activeFnsMap)) {
      const hasChassisPrefix = !!mtPointMatch[1];
      return buildMoveToPointOrThetaAction(mtPointMatch[2], hasChassisPrefix, defaultMaxSpeed, defaultMinSpeed, activeFnsMap);
    }

    // moveToPose (supports both chassis.moveToPose and custom moveToPose(x, y, theta))
    const mtPoseMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?moveToPose\s*\(([^;]+)\)$/i);
    if (mtPoseMatch && isValidChassisReceiver(mtPoseMatch[1], "moveToPose", activeFnsMap)) {
      const isBezier = /bezier|spline/i.test(line);
      const args = splitCppArgsSafe(mtPoseMatch[2]);
      const act = createDefaultAction(isBezier ? "bezierCurve" : "moveToPose", defaultMaxSpeed, defaultMinSpeed);
      act.x = evaluateNumericArg(args[0]) || 0;
      act.y = evaluateNumericArg(args[1]) || 0;
      act.theta = evaluateNumericArg(args[2]) || 0;
      act.timeout = parseInt(evaluateNumericArg(args[3]), 10) || 2500;
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
      if (args[args.length - 1]?.trim().toLowerCase() === "true") act.async = true;
      return act;
    }

    // Check if statement is a call to a user-defined custom function that ONLY contains chassis motion commands
    if (recursionDepth <= 2) {
      const expandedFromFn = expandCustomFunctionCall(line, activeFnsMap, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, null, visitedFns);
      if (expandedFromFn && expandedFromFn.length > 0) {
        const motionAct = expandedFromFn.find((a) => a && REAL_MOTION_TYPES.has(a.type));
        if (motionAct) return motionAct;
      }
    }

    // chassis.followCurve or spline
    const followCurveMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?(?:followCurve|followSpline|follow)\s*\(([^;]+)\)$/i);
    if (followCurveMatch && isValidChassisReceiver(followCurveMatch[1], "followCurve", activeFnsMap)) {
      const args = splitCppArgsSafe(followCurveMatch[2]);
      const act = createDefaultAction("bezierCurve", defaultMaxSpeed, defaultMinSpeed);
      if (args.length >= 3 && !isNaN(parseFloat(args[0]))) {
        act.x = parseFloat(args[0]) || 0;
        act.y = parseFloat(args[1]) || 0;
        act.theta = parseFloat(args[2]) || 0;
        act.timeout = parseInt(args[3], 10) || 2500;
      }
      return act;
    }

    // turnToPoint
    const ttPointMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?turnToPoint\s*\(([^;]+)\)$/i);
    if (ttPointMatch && isValidChassisReceiver(ttPointMatch[1], "turnToPoint", activeFnsMap)) {
      const args = splitCppArgsSafe(ttPointMatch[2]);
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
      if (args[args.length - 1]?.trim().toLowerCase() === "true") act.async = true;
      return act;
    }

    // turnToHeading
    const ttHeadingMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?turnToHeading\s*\(([^;]+)\)$/i);
    if (ttHeadingMatch && isValidChassisReceiver(ttHeadingMatch[1], "turnToHeading", activeFnsMap)) {
      const args = splitCppArgsSafe(ttHeadingMatch[2]);
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
      if (args[args.length - 1]?.trim().toLowerCase() === "true") act.async = true;
      return act;
    }

    // swingToPoint
    const swPointMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?swingToPoint\s*\(([^;]+)\)$/i);
    if (swPointMatch && isValidChassisReceiver(swPointMatch[1], "swingToPoint", activeFnsMap)) {
      const args = splitCppArgsSafe(swPointMatch[2]);
      const act = createDefaultAction("swingToPoint", defaultMaxSpeed, defaultMinSpeed);
      act.x = parseFloat(args[0]) || 0;
      act.y = parseFloat(args[1]) || 0;
      act.lockedSide = parseDriveSideEnum(args[2]);
      act.timeout = parseInt(args[3], 10) || 2000;
      return act;
    }

    // swingToHeading
    const swHeadingMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?swingToHeading\s*\(([^;]+)\)$/i);
    if (swHeadingMatch && isValidChassisReceiver(swHeadingMatch[1], "swingToHeading", activeFnsMap)) {
      const args = splitCppArgsSafe(swHeadingMatch[2]);
      const act = createDefaultAction("swingToHeading", defaultMaxSpeed, defaultMinSpeed);
      act.theta = parseFloat(args[0]) || 0;
      act.lockedSide = parseDriveSideEnum(args[1]);
      act.timeout = parseInt(args[2], 10) || 2000;
      return act;
    }

    // waitUntil distance
    const waitDistMatch = line.match(/^(?:chassis|bot|drive|drivetrain|robot)\.waitUntil\s*\(\s*([-\d.]+)\s*\)$/i);
    if (waitDistMatch) {
      const act = createDefaultAction("wait", defaultMaxSpeed, defaultMinSpeed);
      act.waitType = "distance";
      act.distance = parseFloat(waitDistMatch[1]) || 12;
      return act;
    }

    // waitUntilDone
    if (/^(?:chassis|bot|drive|drivetrain|robot)\.waitUntilDone\s*\(\s*\)$/i.test(line)) {
      const act = createDefaultAction("wait", defaultMaxSpeed, defaultMinSpeed);
      act.waitType = "done";
      return act;
    }

    // pros::delay
    const delayMatch = line.match(/^(?:pros::(?:c::)?)?delay\s*\(\s*(\d+)\s*\)$/i);
    if (delayMatch) {
      const act = createDefaultAction("wait", defaultMaxSpeed, defaultMinSpeed);
      act.waitType = "time";
      act.delayMs = parseInt(delayMatch[1], 10) || 250;
      return act;
    }

    // Auto-detect if-loop or ternary in custom code statement
    if (recursionDepth <= 2) {
      const ifElseAct = parseIfElseFromCode(line, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, activeFnsMap);
      if (ifElseAct) {
        return ifElseAct;
      }
    }

    // Default custom action
    const act = createDefaultAction("custom", defaultMaxSpeed, defaultMinSpeed);
    act.customCode = line + ";";
    return act;
  }

  // Detect and extract C++ ternary expressions: condition ? expr_if_true : expr_if_false;
  function tryParseTernary(line) {
    if (!line || !line.includes("?") || !line.includes(":")) return null;
    let parenDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let stringChar = "";
    let questionIndex = -1;
    let colonIndex = -1;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inString) {
        if (c === stringChar && line[i - 1] !== "\\") inString = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        stringChar = c;
      } else if (c === "(") {
        parenDepth++;
      } else if (c === ")") {
        if (parenDepth > 0) parenDepth--;
      } else if (c === "{" || c === "<") {
        braceDepth++;
      } else if (c === "}" || c === ">") {
        if (braceDepth > 0) braceDepth--;
      } else if (c === "?" && parenDepth === 0 && braceDepth === 0 && questionIndex === -1) {
        questionIndex = i;
      } else if (c === ":" && parenDepth === 0 && braceDepth === 0 && questionIndex !== -1) {
        // Guard against C++ namespace '::'
        if (line[i - 1] === ":" || line[i + 1] === ":") {
          continue;
        }
        colonIndex = i;
        break;
      }
    }

    if (questionIndex !== -1 && colonIndex !== -1 && colonIndex > questionIndex) {
      const condition = line.slice(0, questionIndex).trim().replace(/^\(/, "").replace(/\)$/, "").trim();
      const thenExpr = line.slice(questionIndex + 1, colonIndex).trim().replace(/;$/, "").trim();
      const elseExpr = line.slice(colonIndex + 1).trim().replace(/;$/, "").trim();
      if (condition && thenExpr && elseExpr) {
        return { condition, thenExpr, elseExpr };
      }
    }
    return null;
  }

  // Comprehensive C++ if-else loop & ternary detector for custom code
  function parseIfElseFromCode(codeStr, defaultMaxSpeed = 127, defaultMinSpeed = 0, recursionDepth = 0, visitedFns = null, customFnsMap = null) {
    if (!codeStr || typeof codeStr !== "string" || recursionDepth > 3) return null;
    const trimmed = codeStr.trim();
    if (!trimmed) return null;

    // 1. Check ternary expression: condition ? expr_if_true : expr_if_false;
    const ternary = tryParseTernary(trimmed);
    if (ternary) {
      const act = createDefaultAction("ifElse", defaultMaxSpeed, defaultMinSpeed);
      act.condition = ternary.condition;
      act.thenCode = ternary.thenExpr + (ternary.thenExpr.endsWith(";") ? "" : ";");
      act.elseCode = ternary.elseExpr + (ternary.elseExpr.endsWith(";") ? "" : ";");
      act.thenAction = parseStatementToAction(ternary.thenExpr, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
      act.elseAction = parseStatementToAction(ternary.elseExpr, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
      act.thenChildren = parseStatementsToList(act.thenCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
      act.elseChildren = parseStatementsToList(act.elseCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
      act.thenLabel = getActionHumanLabel(act.thenAction, ternary.thenExpr);
      act.elseLabel = getActionHumanLabel(act.elseAction, ternary.elseExpr);
      act.isTernary = true;
      return act;
    }

    // 2. Check for C++ if statement: if (...) { ... } [else { ... }]
    const ifMatch = trimmed.match(/(?:^|\n|\r|\s|;)if\s*\(/i);
    if (!ifMatch) return null;
    const startIdx = ifMatch.index + ifMatch[0].toLowerCase().indexOf("if");
    const sub = trimmed.slice(startIdx);

    const openParen = sub.indexOf("(");
    if (openParen === -1) return null;

    let parenDepth = 1;
    let closeParen = -1;
    for (let k = openParen + 1; k < sub.length; k++) {
      if (sub[k] === "(") parenDepth++;
      else if (sub[k] === ")") {
        parenDepth--;
        if (parenDepth === 0) {
          closeParen = k;
          break;
        }
      }
    }
    if (closeParen === -1) return null;

    const condition = sub.slice(openParen + 1, closeParen).trim() || "true";
    let rem = sub.slice(closeParen + 1).trim();

    let thenCode = "";
    let elseCode = "";

    if (rem.startsWith("{")) {
      let braceDepth = 1;
      let closeBrace = -1;
      for (let k = 1; k < rem.length; k++) {
        if (rem[k] === "{") braceDepth++;
        else if (rem[k] === "}") {
          braceDepth--;
          if (braceDepth === 0) {
            closeBrace = k;
            break;
          }
        }
      }
      if (closeBrace !== -1) {
        thenCode = rem.slice(1, closeBrace).trim();
        rem = rem.slice(closeBrace + 1).trim();
      } else {
        thenCode = rem.slice(1).trim();
        rem = "";
      }
    } else {
      const elseMatch = rem.match(/\belse\b/i);
      if (elseMatch) {
        thenCode = rem.slice(0, elseMatch.index).trim();
        rem = rem.slice(elseMatch.index);
      } else {
        thenCode = rem.trim();
        rem = "";
      }
    }

    if (/^else\b/i.test(rem)) {
      rem = rem.replace(/^else\s*/i, "").trim();
      if (rem.startsWith("{")) {
        let braceDepth = 1;
        let closeBrace = -1;
        for (let k = 1; k < rem.length; k++) {
          if (rem[k] === "{") braceDepth++;
          else if (rem[k] === "}") {
            braceDepth--;
            if (braceDepth === 0) {
              closeBrace = k;
              break;
            }
          }
        }
        if (closeBrace !== -1) {
          elseCode = rem.slice(1, closeBrace).trim();
        } else {
          elseCode = rem.slice(1).trim();
        }
      } else {
        elseCode = rem.trim();
      }
    }

    const act = createDefaultAction("ifElse", defaultMaxSpeed, defaultMinSpeed);
    act.condition = condition;
    act.thenCode = thenCode || "chassis.moveToPoint(24, 24, 2000);";
    act.elseCode = elseCode || (elseCode === "" ? "" : "chassis.moveToPoint(-24, -24, 2000, {.forwards = false});");
    if (act.thenCode && !act.thenCode.endsWith(";") && !act.thenCode.endsWith("}")) act.thenCode += ";";
    if (act.elseCode && !act.elseCode.endsWith(";") && !act.elseCode.endsWith("}")) act.elseCode += ";";

    act.thenAction = parseStatementToAction(act.thenCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
    act.elseAction = act.elseCode ? parseStatementToAction(act.elseCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap) : null;
    act.thenChildren = parseStatementsToList(act.thenCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
    act.elseChildren = act.elseCode ? parseStatementsToList(act.elseCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap) : [];
    act.thenLabel = getActionHumanLabel(act.thenAction, act.thenCode);
    act.elseLabel = act.elseAction ? getActionHumanLabel(act.elseAction, act.elseCode) : (act.elseCode ? "Custom Action" : "No Action");
    act.isTernary = false;
    return act;
  }

  // Comprehensive C++ loop detector for custom code
  function parseLoopFromCode(codeStr, defaultMaxSpeed = 127, defaultMinSpeed = 0, recursionDepth = 0, visitedFns = null, customFnsMap = null) {
    if (!codeStr || typeof codeStr !== "string" || recursionDepth > 3) return null;
    const trimmed = codeStr.trim();
    if (!trimmed) return null;

    // 1. Check for standard while loop: while (...) { ... }
    const whileMatch = trimmed.match(/(?:^|\n|\r|\s|;)while\s*\(/i);
    if (whileMatch) {
      const startIdx = whileMatch.index + whileMatch[0].toLowerCase().indexOf("while");
      const sub = trimmed.slice(startIdx);
      const openParen = sub.indexOf("(");
      if (openParen !== -1) {
        let parenDepth = 1;
        let closeParen = -1;
        for (let k = openParen + 1; k < sub.length; k++) {
          if (sub[k] === "(") parenDepth++;
          else if (sub[k] === ")") {
            parenDepth--;
            if (parenDepth === 0) {
              closeParen = k;
              break;
            }
          }
        }
        if (closeParen !== -1) {
          let condition = sub.slice(openParen + 1, closeParen).trim() || "true";
          let rem = sub.slice(closeParen + 1).trim();
          let loopCode = "";

          if (rem.startsWith("{")) {
            let braceDepth = 1;
            let closeBrace = -1;
            for (let k = 1; k < rem.length; k++) {
              if (rem[k] === "{") braceDepth++;
              else if (rem[k] === "}") {
                braceDepth--;
                if (braceDepth === 0) {
                  closeBrace = k;
                  break;
                }
              }
            }
            if (closeBrace !== -1) {
              loopCode = rem.slice(1, closeBrace).trim();
            } else {
              loopCode = rem.slice(1).trim();
            }
          } else {
            loopCode = rem.trim();
          }

          const act = createDefaultAction("loop", defaultMaxSpeed, defaultMinSpeed);
          // If condition is while(!(limit_switch.get_value())), strip !() to make it "limit_switch.get_value()"
          if (condition.startsWith("!(") && condition.endsWith(")")) {
            act.loopMode = "until";
            act.condition = condition.slice(2, -1).trim();
          } else if (condition.startsWith("!") && !condition.startsWith("!(")) {
            act.loopMode = "until";
            act.condition = condition.slice(1).trim();
          } else if (condition === "true") {
            act.loopMode = "forever";
            act.condition = "true";
          } else {
            act.loopMode = "until";
            act.condition = "!(" + condition + ")"; // loop until not
          }
          act.times = 5;
          act.loopCode = loopCode || "chassis.moveToPoint(24, 24, 2000);";
          if (act.loopCode && !act.loopCode.endsWith(";") && !act.loopCode.endsWith("}")) act.loopCode += ";";
          act.loopAction = parseStatementToAction(act.loopCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
          act.loopLabel = getActionHumanLabel(act.loopAction, act.loopCode);
          return act;
        }
      }
    }

    // 2. Check for standard for loop: for (int i = 0; i < 5; i++) { ... }
    const forMatch = trimmed.match(/(?:^|\n|\r|\s|;)for\s*\(/i);
    if (forMatch) {
      const startIdx = forMatch.index + forMatch[0].toLowerCase().indexOf("for");
      const sub = trimmed.slice(startIdx);
      const openParen = sub.indexOf("(");
      if (openParen !== -1) {
        let parenDepth = 1;
        let closeParen = -1;
        for (let k = openParen + 1; k < sub.length; k++) {
          if (sub[k] === "(") parenDepth++;
          else if (sub[k] === ")") {
            parenDepth--;
            if (parenDepth === 0) {
              closeParen = k;
              break;
            }
          }
        }
        if (closeParen !== -1) {
          const initCondInc = sub.slice(openParen + 1, closeParen).trim();
          let rem = sub.slice(closeParen + 1).trim();
          let loopCode = "";

          if (rem.startsWith("{")) {
            let braceDepth = 1;
            let closeBrace = -1;
            for (let k = 1; k < rem.length; k++) {
              if (rem[k] === "{") braceDepth++;
              else if (rem[k] === "}") {
                braceDepth--;
                if (braceDepth === 0) {
                  closeBrace = k;
                  break;
                }
              }
            }
            if (closeBrace !== -1) {
              loopCode = rem.slice(1, closeBrace).trim();
            } else {
              loopCode = rem.slice(1).trim();
            }
          } else {
            loopCode = rem.trim();
          }

          const act = createDefaultAction("loop", defaultMaxSpeed, defaultMinSpeed);
          act.loopMode = "for";
          act.condition = "!limit_switch.get_value()";
          let tVal = 5;
          const matchLt = initCondInc.match(/<\s*(\d+)/);
          if (matchLt) tVal = parseInt(matchLt[1], 10) || 5;
          act.times = tVal;
          act.loopCode = loopCode || "chassis.moveToPoint(24, 24, 2000);";
          if (act.loopCode && !act.loopCode.endsWith(";") && !act.loopCode.endsWith("}")) act.loopCode += ";";
          act.loopAction = parseStatementToAction(act.loopCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
          act.loopLabel = getActionHumanLabel(act.loopAction, act.loopCode);
          return act;
        }
      }
    }

    return null;
  }

  // Human-readable action label helper
  function getActionHumanLabel(act, defaultCode = "") {
    if (!act) {
      if (/clamp/i.test(defaultCode)) return defaultCode.includes("false") ? "Release Clamp" : "Clamp Goal";
      if (/intake/i.test(defaultCode)) return defaultCode.includes("0") ? "Intake Off" : "Intake On";
      return defaultCode.split("\n")[0] || "Custom Action";
    }
    if (act.type === "moveToPoint") {
      return act.forwards !== false ? "Move forward" : "Move backwards";
    }
    if (act.type === "moveToPose") {
      return act.forwards !== false ? "Move forward (Pose)" : "Move backwards (Pose)";
    }
    if (act.type === "turnToHeading") {
      return `Turn to ${act.theta}°`;
    }
    if (act.type === "turnToPoint") {
      return `Turn to (${act.x}, ${act.y})`;
    }
    if (act.type === "swingToHeading") {
      return `Swing to ${act.theta}° (${act.lockedSide || 'LEFT'})`;
    }
    if (act.type === "swingToPoint") {
      return `Swing to (${act.x}, ${act.y})`;
    }
    if (act.type === "wait") {
      return act.waitType === "distance" ? `Wait ${act.distance}"` : (act.waitType === "done" ? "Wait Until Done" : `Delay ${act.delayMs}ms`);
    }
    if (act.type === "custom") {
      const code = act.customCode || "";
      if (/clamp.*true/i.test(code)) return "Clamp Goal";
      if (/clamp.*false/i.test(code)) return "Release Clamp";
      if (/intake.*0/i.test(code)) return "Intake Off";
      if (/intake/i.test(code)) return "Intake On";
      return code.split("\n")[0] || "Custom Action";
    }
    return act.type;
  }

  function createDefaultAction(type, defaultMaxSpeed = 127, defaultMinSpeed = 0) {
    if (type === "ifElse") {
      const defThen = {
        id: uid(),
        type: "moveToPoint",
        x: 24,
        y: 24,
        timeout: 2000,
        forwards: true,
        maxSpeed: defaultMaxSpeed,
        minSpeed: defaultMinSpeed,
        earlyExitRange: 0,
      };
      const defElse = {
        id: uid(),
        type: "moveToPoint",
        x: -24,
        y: -24,
        timeout: 2000,
        forwards: false,
        maxSpeed: defaultMaxSpeed,
        minSpeed: defaultMinSpeed,
        earlyExitRange: 0,
      };
      return {
        id: uid(),
        type: "ifElse",
        condition: "true",
        thenLabel: "Move forward",
        elseLabel: "Move backwards",
        thenCode: "chassis.moveToPoint(24, 24, 2000);",
        elseCode: "chassis.moveToPoint(-24, -24, 2000, {.forwards = false});",
        thenAction: defThen,
        elseAction: defElse,
        thenChildren: [defThen],
        elseChildren: [defElse],
        activeSimBranch: "then",
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
      lead: 0.6,
      cp1X: null,
      cp1Y: null,
      cp2X: null,
      cp2Y: null,
      lead1: 18,
      lead2: 18,
      timeout: type === "bezierCurve" ? 2500 : 2000,
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
      // Wait / Event Trigger properties
      waitType: "distance", // "distance" | "done" | "time"
      distance: 12,
      delayMs: 250,
      driftScaler: 1.0,
    };
  }

  // -------------------------------------------------------------
  // Custom Function Definition Extraction & Motion Inference
  // -------------------------------------------------------------
  const THETA_PARAM_REGEX = /^(theta|heading|angle|deg|degrees|dir|h|th|yaw|target_?theta|target_?heading|end_?theta|final_?heading)$/i;
  const CHASSIS_OBJ_REGEX = /^(?:chassis|bot|drive|drivetrain|robot|lemlib|odom)$/i;
  const RESERVED_CPP_CALLS = new Set([
    "if", "else", "while", "for", "switch", "case", "return", "sizeof", "alignof",
    "setPose", "moveToPoint", "moveToPose", "turnToPoint", "turnToHeading",
    "swingToPoint", "swingToHeading", "waitUntil", "waitUntilDone", "follow",
    "followCurve", "followSpline", "delay", "Task", "move", "move_velocity",
    "move_absolute", "move_relative", "move_voltage", "brake", "set_value", "printf", "print"
  ]);
  const REAL_MOTION_TYPES = new Set([
    "moveToPoint",
    "moveToPose",
    "turnToHeading",
    "turnToPoint",
    "swingToHeading",
    "swingToPoint",
    "bezierCurve"
  ]);

  function isPureChassisAction(a) {
    if (!a) return false;
    if (REAL_MOTION_TYPES.has(a.type)) return true;
    if (a.type === "wait" && (a.waitType === "distance" || a.waitType === "done")) return true;
    return false;
  }

  function isValidChassisReceiver(objName, methodName = "", fnsMap = null) {
    if (objName) {
      return CHASSIS_OBJ_REGEX.test(objName.trim());
    }
    if (methodName && fnsMap && fnsMap.has(methodName)) {
      const def = fnsMap.get(methodName);
      if (def && !def.onlyContainsChassisMotions) {
        return false;
      }
    }
    return true;
  }

  // Strictly verify that a function body ONLY contains chassis motion commands (moveToPoint, moveToPose, turnToHeading, etc.)
  // and no lift/subsystem/motor/PID/control-flow commands.
  function checkBodyOnlyContainsChassisMotions(bodyStr, knownPureFnNames = null) {
    if (!bodyStr || typeof bodyStr !== "string") return false;
    const clean = stripCommentsPreserveLength(bodyStr).trim();
    if (!clean) return false;

    const stmts = [];
    let cur = "";
    let parenDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let quoteChar = "";

    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      const prev = i > 0 ? clean[i - 1] : "";
      if (inString) {
        cur += c;
        if (c === quoteChar && prev !== "\\") inString = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        quoteChar = c;
        cur += c;
        continue;
      }
      if (c === "(") {
        parenDepth++;
        cur += c;
        continue;
      }
      if (c === ")") {
        if (parenDepth > 0) parenDepth--;
        cur += c;
        continue;
      }
      if (c === "{") {
        // Braces are only allowed inside (...) for LemLib struct params like {.forwards = false}
        if (parenDepth === 0) return false;
        braceDepth++;
        cur += c;
        continue;
      }
      if (c === "}") {
        if (parenDepth === 0) return false;
        if (braceDepth > 0) braceDepth--;
        cur += c;
        continue;
      }
      if (c === ";" && parenDepth === 0 && braceDepth === 0) {
        const s = cur.trim();
        if (s) stmts.push(s);
        cur = "";
        continue;
      }
      cur += c;
    }

    const trailing = cur.trim();
    if (trailing) stmts.push(trailing);
    if (stmts.length === 0) return false;

    const directMotionRe = /^(?:(?:chassis|bot|drive|drivetrain|robot|lemlib|odom)\s*(?:\.|->)\s*)?(moveToPoint|moveToPose|turnToHeading|turnToPoint|swingToHeading|swingToPoint|followCurve|followSpline|follow|waitUntil|waitUntilDone|setPose)\s*\([\s\S]*\)$/i;
    const realMoveCmdRe = /^(?:moveToPoint|moveToPose|turnToHeading|turnToPoint|swingToHeading|swingToPoint|followCurve|followSpline|follow)$/i;
    const standaloneCallRe = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\([\s\S]*\)$/;

    let hasAtLeastOneMove = false;
    for (let i = 0; i < stmts.length; i++) {
      const st = stmts[i].trim();
      if (!st) continue;
      if (/^(?:if|else|while|for|switch|return)\b/i.test(st)) return false;

      const dm = st.match(directMotionRe);
      if (dm) {
        const cmdName = dm[1];
        if (realMoveCmdRe.test(cmdName)) {
          hasAtLeastOneMove = true;
        }
        continue;
      }

      const sc = st.match(standaloneCallRe);
      if (sc && knownPureFnNames && knownPureFnNames.has(sc[1])) {
        hasAtLeastOneMove = true;
        continue;
      }

      // Any other statement (e.g. lift.move_absolute, intake.move, pros::delay, variables) disqualifies this function
      return false;
    }

    return hasAtLeastOneMove;
  }

  let cachedCustomFunctions = new Map();
  let cachedProjectFunctionsMap = new Map();
  let cachedProjectFingerprint = "";
  const inferredCustomCodeCache = new Map();

  function evaluateNumericArg(exprStr, env = {}) {
    if (exprStr == null) return NaN;
    let s = String(exprStr).trim();
    if (!s) return NaN;
    // Substitute known parameter values from env
    if (env && typeof env === "object") {
      for (const [k, v] of Object.entries(env)) {
        if (k.startsWith("__")) continue;
        if (v != null && !isNaN(Number(v))) {
          const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
          s = s.replace(re, `(${Number(v)})`);
        }
      }
    }
    // Strip trailing float suffixes like 24.0f
    s = s.replace(/(\d)f\b/gi, "$1");
    // Only evaluate if expression consists purely of numbers, arithmetic operators, and parens
    if (/^[0-9.+\-*/()\s]+$/.test(s)) {
      try {
        const val = Function(`"use strict"; return (${s});`)();
        if (typeof val === "number" && isFinite(val)) {
          return Number(val.toFixed(3));
        }
      } catch (_) {}
    }
    const direct = parseFloat(s);
    return isNaN(direct) ? NaN : direct;
  }

  function parseFunctionParamsList(paramsStr) {
    if (!paramsStr || !paramsStr.trim() || paramsStr.trim() === "void") return [];
    const parts = splitCppArgsSafe(paramsStr);
    const params = [];
    parts.forEach((part, idx) => {
      let clean = part.replace(/\/\*.*?\*\//g, "").trim();
      if (!clean) return;
      let defaultVal = null;
      const eqIdx = clean.indexOf("=");
      if (eqIdx !== -1) {
        defaultVal = clean.slice(eqIdx + 1).trim();
        clean = clean.slice(0, eqIdx).trim();
      }
      const tokens = clean.replace(/[&*]+/g, " ").trim().split(/\s+/);
      const name = tokens[tokens.length - 1] || `param${idx}`;
      const type = tokens.slice(0, -1).join(" ") || "double";
      const isThetaLike = THETA_PARAM_REGEX.test(name) || (idx === 2 && /^(x|target_?x|px)$/i.test(params[0]?.name || "") && /^(y|target_?y|py)$/i.test(params[1]?.name || ""));
      params.push({ name, type, defaultVal, index: idx, isThetaLike });
    });
    return params;
  }

  // Replace comments with spaces (preserving newlines and character indices) so commented-out functions are ignored
  function stripCommentsPreserveLength(codeStr) {
    const chars = codeStr.split("");
    let inString = false;
    let strQuote = "";
    let inSingle = false;
    let inMulti = false;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const prev = i > 0 ? codeStr[i - 1] : "";
      const next = i < chars.length - 1 ? chars[i + 1] : "";
      if (inSingle) {
        if (c === "\n") {
          inSingle = false;
        } else {
          chars[i] = " ";
        }
        continue;
      }
      if (inMulti) {
        if (c === "*" && next === "/") {
          chars[i] = " ";
          chars[i + 1] = " ";
          inMulti = false;
          i++;
        } else if (c !== "\n") {
          chars[i] = " ";
        }
        continue;
      }
      if (inString) {
        if (c === strQuote && prev !== "\\") inString = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        strQuote = c;
        continue;
      }
      if (c === "/" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        inSingle = true;
        i++;
        continue;
      }
      if (c === "/" && next === "*") {
        chars[i] = " ";
        chars[i + 1] = " ";
        inMulti = true;
        i++;
        continue;
      }
    }
    return chars.join("");
  }

  function extractFunctionsFromCodeString(codeStr, sourceFile = "inline", existingPureNames = null) {
    const fnMap = new Map();
    const fnList = [];
    fnMap._orderedList = fnList;
    if (!codeStr || typeof codeStr !== "string" || codeStr.length > 120000) return fnMap;

    const pureFnNames = existingPureNames ? new Set(existingPureNames) : new Set();
    const cleanCode = stripCommentsPreserveLength(codeStr);
    const fnHeaderRegex = /(?:^|[\n;{}])\s*(?:inline\s+|static\s+)?(?:void|int|bool|double|float|auto)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^);{}]*)\)\s*\{/g;
    let match;
    while ((match = fnHeaderRegex.exec(cleanCode)) !== null) {
      const fnName = match[1];
      if (RESERVED_CPP_CALLS.has(fnName) && fnName !== "moveToPoint" && fnName !== "moveToPose") {
        continue;
      }
      const paramsRaw = match[2] || "";
      const startBodyIdx = fnHeaderRegex.lastIndex;

      let depth = 1;
      let endBodyIdx = startBodyIdx;
      let inString = false;
      let strQuote = "";

      for (let i = startBodyIdx; i < cleanCode.length; i++) {
        const char = cleanCode[i];
        const prevChar = i > startBodyIdx ? cleanCode[i - 1] : "";

        if (inString) {
          if (char === strQuote && prevChar !== "\\") inString = false;
          continue;
        }
        if (char === '"' || char === "'") {
          inString = true;
          strQuote = char;
          continue;
        }
        if (char === "{") {
          depth++;
        } else if (char === "}") {
          depth--;
          if (depth === 0) {
            endBodyIdx = i;
            fnHeaderRegex.lastIndex = i + 1;
            break;
          }
        }
      }

      // Ignore unclosed / malformed function blocks
      if (depth !== 0) {
        continue;
      }

      const body = codeStr.substring(startBodyIdx, endBodyIdx);
      const prefixMatch = match[0].match(/^\s*[\n;{}]/);
      const headerStartIdx = match.index + (prefixMatch ? prefixMatch[0].length : 0);
      const params = parseFunctionParamsList(paramsRaw);
      const isThreeCoordThetaSignature = Boolean(params.length >= 3 && params[2].isThetaLike);
      const onlyContainsChassisMotions = checkBodyOnlyContainsChassisMotions(body, pureFnNames);
      if (onlyContainsChassisMotions) {
        pureFnNames.add(fnName);
      }

      // Check if body contains moveToPoint(x, y, theta) or other LemLib movements (only if pure motion function)
      const mtpInBodyMatch = onlyContainsChassisMotions
        ? body.match(/(?:(?:chassis|bot|drive|drivetrain|robot|lemlib|odom)\s*(?:\.|->)\s*)?moveToPoint\s*\(([^;)]+)\)/i)
        : null;
      let hasMoveToPointTheta = Boolean(onlyContainsChassisMotions && isThreeCoordThetaSignature && fnName === "moveToPoint");
      if (mtpInBodyMatch) {
        const bodyMtpArgs = splitCppArgsSafe(mtpInBodyMatch[1]).filter((a) => {
          const t = a.trim();
          return !(t.startsWith("{") && t.endsWith("}"));
        });
        if (bodyMtpArgs.length >= 3) {
          const thirdArg = bodyMtpArgs[2].trim();
          const matchedParam = params.find((p) => p.name === thirdArg);
          if (matchedParam && !/^(timeout|time|ms|duration)$/i.test(matchedParam.name)) {
            matchedParam.isThetaLike = true;
            hasMoveToPointTheta = true;
          } else if (THETA_PARAM_REGEX.test(thirdArg) || bodyMtpArgs.length >= 4) {
            hasMoveToPointTheta = true;
          } else if (!isNaN(parseFloat(thirdArg)) && Math.abs(parseFloat(thirdArg)) <= 360) {
            hasMoveToPointTheta = true;
          }
        }
      }
      const hasMoveToPoint3 = !!mtpInBodyMatch;
      const hasAnyMotion = onlyContainsChassisMotions;

      const fnDef = {
        name: fnName,
        params,
        paramsRaw: paramsRaw.trim(),
        body,
        sourceFile,
        headerStartIdx,
        fullEndIdx: endBodyIdx + 1,
        hasMoveToPoint3,
        hasMoveToPointTheta,
        hasAnyMotion,
        onlyContainsChassisMotions,
        isThreeCoordThetaSignature,
      };
      // If overloaded in same file, prefer the overload that onlyContainsChassisMotions
      const prevDef = fnMap.get(fnName);
      if (!prevDef || fnDef.onlyContainsChassisMotions || !prevDef.onlyContainsChassisMotions) {
        fnMap.set(fnName, fnDef);
      }
      fnList.push(fnDef);
    }

    // Second pass: resolve transitive pure motion wrappers (e.g. wrapper calling another pure motion function defined below it)
    let changed = true;
    while (changed) {
      changed = false;
      for (const def of fnList) {
        if (!def.onlyContainsChassisMotions && checkBodyOnlyContainsChassisMotions(def.body, pureFnNames)) {
          def.onlyContainsChassisMotions = true;
          def.hasAnyMotion = true;
          if (def.isThreeCoordThetaSignature && def.name === "moveToPoint") {
            def.hasMoveToPointTheta = true;
          }
          pureFnNames.add(def.name);
          fnMap.set(def.name, def);
          changed = true;
        }
      }
    }

    return fnMap;
  }

  function shouldScanProjectFile(fileName, content) {
    if (!fileName || typeof content !== "string") return false;
    if (content.length > 100000) return false;
    if (!/\.(cpp|cc|cxx|c|hpp|hh|h)$/i.test(fileName)) return false;
    // Skip vendor/SDK headers and build artifacts (liblvgl, pros, lemlib, okapi, firmware, etc.)
    if (/(?:^|\/)(?:include\/(?:liblvgl|pros|lemlib|okapi|display|Eigen)|firmware|bin|build|\.cache|\.d\b)/i.test(fileName)) {
      return false;
    }
    return true;
  }

  function computeProjectFingerprint(filesObj) {
    if (!filesObj || typeof filesObj !== "object") return "";
    const parts = [];
    const keys = Object.keys(filesObj).sort();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = filesObj[k];
      if (!shouldScanProjectFile(k, v)) continue;
      parts.push(`${k}:${v.length}:${v.slice(0, 48)}:${v.slice(-48)}`);
    }
    return parts.join("|");
  }

  function extractCustomFunctions(rawCode = "", extraFiles = null) {
    let filesObj = extraFiles || (typeof window !== "undefined" && window.ProjectManager && window.ProjectManager.project && window.ProjectManager.project.files
      ? window.ProjectManager.project.files
      : null);

    if (!filesObj && cachedProjectFunctionsMap.size === 0 && typeof localStorage !== "undefined") {
      try {
        const savedProj = localStorage.getItem("vex_pros_project_v1");
        if (savedProj) {
          const parsedProj = JSON.parse(savedProj);
          if (parsedProj && parsedProj.files && typeof parsedProj.files === "object") {
            filesObj = parsedProj.files;
          }
        }
      } catch (_) {}
    }

    if (filesObj && typeof filesObj === "object") {
      const fp = computeProjectFingerprint(filesObj);
      if (fp !== cachedProjectFingerprint) {
        const nextProjMap = new Map();
        const projPureNames = new Set();
        Object.entries(filesObj).forEach(([fileName, content]) => {
          if (!shouldScanProjectFile(fileName, content)) return;
          const fileFns = extractFunctionsFromCodeString(content, fileName, projPureNames);
          fileFns.forEach((def, name) => {
            if (def.onlyContainsChassisMotions) projPureNames.add(name);
            const prev = nextProjMap.get(name);
            if (!prev || def.onlyContainsChassisMotions || !prev.onlyContainsChassisMotions) {
              nextProjMap.set(name, def);
            }
          });
        });
        cachedProjectFunctionsMap = nextProjMap;
        cachedCustomFunctions = new Map(nextProjMap);
        cachedProjectFingerprint = fp;
        inferredCustomCodeCache.clear();
      }
    }

    const combined = new Map(cachedCustomFunctions);
    cachedProjectFunctionsMap.forEach((def, name) => {
      const prev = combined.get(name);
      if (!prev || def.onlyContainsChassisMotions || !prev.onlyContainsChassisMotions) {
        combined.set(name, def);
      }
    });

    const knownPure = new Set();
    combined.forEach((def, name) => {
      if (def.onlyContainsChassisMotions) knownPure.add(name);
    });

    // 2. Collect from current rawCode (overrides project files if redefined locally)
    if (rawCode && typeof rawCode === "string") {
      const localFns = extractFunctionsFromCodeString(rawCode, "local", knownPure);
      localFns.forEach((def, name) => {
        const prev = combined.get(name);
        if (!prev || def.onlyContainsChassisMotions || !prev.onlyContainsChassisMotions) {
          combined.set(name, def);
        }
      });
    }

    cachedCustomFunctions = combined;
    return combined;
  }

  function getActiveCustomFunctionsMap(rawCode = "", extraFiles = null) {
    if (rawCode || extraFiles || cachedCustomFunctions.size === 0) {
      return extractCustomFunctions(rawCode, extraFiles);
    }
    if (typeof window !== "undefined" && window.ProjectManager && window.ProjectManager.project && window.ProjectManager.project.files) {
      return extractCustomFunctions("", window.ProjectManager.project.files);
    }
    return cachedCustomFunctions;
  }

  // Build either a moveToPoint or moveToPose action, inferring theta when moveToPoint(x, y, theta) is used
  function buildMoveToPointOrThetaAction(rawArgsStr, hasChassisPrefix, defaultMaxSpeed = 127, defaultMinSpeed = 0, customFnsMap = null, paramEnv = null) {
    const args = splitCppArgsSafe(rawArgsStr);
    const structParamStr = args.find((a) => a.startsWith("{") && a.endsWith("}"));
    const lastArg = args[args.length - 1]?.trim().toLowerCase();
    const hasExplicitAsyncBool = lastArg === "true" || lastArg === "false";

    // Extract scalar positional arguments (excluding {...} struct and trailing async bool)
    const scalarArgs = args.filter((a, idx) => {
      const t = a.trim();
      if (t.startsWith("{") && t.endsWith("}")) return false;
      if (idx === args.length - 1 && (t.toLowerCase() === "true" || t.toLowerCase() === "false") && idx >= 3) return false;
      return true;
    });

    // Determine if moveToPoint is being called with (x, y, theta, [timeout])
    let hasThetaArg = false;
    let inferredTheta = 0;
    let inferredTimeout = 2000;

    const customMoveToPointDef = customFnsMap && customFnsMap.get("moveToPoint");
    const isCustomPureMoveToPoint = Boolean(customMoveToPointDef && customMoveToPointDef.onlyContainsChassisMotions);

    if (scalarArgs.length >= 4) {
      // 4 scalar args: moveToPoint(x, y, theta, timeout)
      hasThetaArg = true;
      inferredTheta = evaluateNumericArg(scalarArgs[2], paramEnv);
      if (isNaN(inferredTheta)) inferredTheta = 0;
      inferredTimeout = parseInt(evaluateNumericArg(scalarArgs[3], paramEnv), 10) || 2000;
    } else if (scalarArgs.length === 3) {
      const rawArg3 = scalarArgs[2].trim();
      const val3 = evaluateNumericArg(rawArg3, paramEnv);

      // Numeric values > 360 are always timeouts in milliseconds (e.g., 2000ms), never heading angles
      if (!isNaN(val3) && Math.abs(val3) > 360) {
        hasThetaArg = false;
        inferredTimeout = parseInt(val3, 10) || 2000;
      } else {
        const arg3IsThetaIdent =
          Boolean(paramEnv && paramEnv.__forceMoveToPointTheta) ||
          THETA_PARAM_REGEX.test(rawArg3) ||
          (paramEnv && paramEnv.__thetaParams && paramEnv.__thetaParams.has(rawArg3)) ||
          (isCustomPureMoveToPoint && (customMoveToPointDef.hasMoveToPointTheta || customMoveToPointDef.isThreeCoordThetaSignature || (customMoveToPointDef.params.length >= 3 && customMoveToPointDef.params[2].isThetaLike)));

        if (arg3IsThetaIdent || (!hasChassisPrefix && !isNaN(val3) && Math.abs(val3) <= 360)) {
          hasThetaArg = true;
          inferredTheta = isNaN(val3) ? 0 : val3;
          inferredTimeout = 2000;
        } else {
          inferredTimeout = parseInt(val3, 10) || 2000;
        }
      }
    }

    const actType = hasThetaArg ? "moveToPose" : "moveToPoint";
    const act = createDefaultAction(actType, defaultMaxSpeed, defaultMinSpeed);
    act.x = evaluateNumericArg(scalarArgs[0], paramEnv);
    if (isNaN(act.x)) act.x = 0;
    act.y = evaluateNumericArg(scalarArgs[1], paramEnv);
    if (isNaN(act.y)) act.y = 0;

    if (hasThetaArg) {
      act.theta = inferredTheta;
      act.timeout = inferredTimeout;
      act.lead = 0.4;
      act.inferredFromMoveToPointTheta = true;
    } else {
      act.timeout = inferredTimeout;
    }

    if (structParamStr) {
      const p = parseLemlibStructParams(structParamStr);
      act.forwards = p.forwards;
      if (p.lead != null) act.lead = p.lead;
      if (p.maxSpeed != null) act.maxSpeed = p.maxSpeed;
      if (p.minSpeed != null) act.minSpeed = p.minSpeed;
      if (p.earlyExitRange) act.earlyExitRange = p.earlyExitRange;
      if (p.async) act.async = true;
    }
    if (hasExplicitAsyncBool && lastArg === "true") act.async = true;
    return act;
  }

  function substituteParamsInBody(bodyStr, params, callArgs, parentEnv = null, fnDef = null) {
    const env = {};
    const thetaParams = new Set();
    if (parentEnv) {
      Object.entries(parentEnv).forEach(([k, v]) => {
        if (k !== "__thetaParams" && k !== "__forceMoveToPointTheta") env[k] = v;
      });
      if (parentEnv.__thetaParams) {
        parentEnv.__thetaParams.forEach((p) => thetaParams.add(p));
      }
      if (parentEnv.__forceMoveToPointTheta) {
        env.__forceMoveToPointTheta = true;
      }
    }
    if (fnDef && fnDef.onlyContainsChassisMotions && (fnDef.hasMoveToPointTheta || fnDef.isThreeCoordThetaSignature)) {
      env.__forceMoveToPointTheta = true;
    }

    params.forEach((p, idx) => {
      const rawArg = idx < callArgs.length ? callArgs[idx] : p.defaultVal;
      if (rawArg != null && String(rawArg).trim() !== "") {
        const evalNum = evaluateNumericArg(rawArg, env);
        env[p.name] = !isNaN(evalNum) ? evalNum : String(rawArg).trim();
      } else {
        env[p.name] = 0;
      }
      if (p.isThetaLike && fnDef && fnDef.onlyContainsChassisMotions) {
        thetaParams.add(p.name);
        env.__forceMoveToPointTheta = true;
      }
    });
    env.__thetaParams = thetaParams;

    // Substitute parameter identifiers outside comments/strings
    let substituted = bodyStr;
    params.forEach((p) => {
      const val = env[p.name];
      if (val == null) return;
      const re = new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      substituted = substituted.replace(re, String(val));
    });

    return { substituted, env };
  }

  function expandCustomFunctionCall(stmtStr, customFnsMap = null, defaultMaxSpeed = 127, defaultMinSpeed = 0, depth = 0, parentEnv = null, visitedFns = null) {
    if (!stmtStr || depth > 3) return null;
    const clean = stmtStr.trim().replace(/;$/, "").trim();
    if (!clean) return null;

    // Match standalone function call: fnName(args...)
    const callMatch = clean.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)$/s);
    if (!callMatch) return null;

    const fnName = callMatch[1];
    if (RESERVED_CPP_CALLS.has(fnName)) return null;

    const activeVisited = visitedFns ? new Set(visitedFns) : new Set();
    if (activeVisited.has(fnName)) {
      return null; // Prevent direct or mutual recursion cycles
    }
    activeVisited.add(fnName);

    const rawArgsStr = callMatch[2].trim();
    const callArgs = rawArgsStr ? splitCppArgsSafe(rawArgsStr) : [];
    const fns = customFnsMap || getActiveCustomFunctionsMap();

    // Only assume a custom function is a moving function if its definition exists
    // AND its body ONLY contains chassis movement commands (moveToPoint, moveToPose, turnToHeading, etc.)
    if (fns && fns.has(fnName)) {
      const fnDef = fns.get(fnName);
      if (!fnDef || !fnDef.onlyContainsChassisMotions) {
        return null;
      }

      const { substituted, env } = substituteParamsInBody(fnDef.body, fnDef.params, callArgs, parentEnv, fnDef);
      const subResult = parseCppAuton(substituted, {
        defaultMaxSpeed,
        defaultMinSpeed,
        customFunctionsMap: fns,
        paramEnv: env,
        _recursionDepth: depth + 1,
        _visitedFns: activeVisited,
      });

      const callSig = `${fnName}(${callArgs.map((a) => {
        const v = evaluateNumericArg(a, parentEnv);
        return !isNaN(v) ? v : a;
      }).join(", ")})`;

      if (
        subResult &&
        Array.isArray(subResult.actions) &&
        subResult.actions.length > 0 &&
        subResult.actions.every(isPureChassisAction)
      ) {
        const realMotionActions = subResult.actions.filter((a) => a && REAL_MOTION_TYPES.has(a.type));
        if (realMotionActions.length > 0) {
          realMotionActions.forEach((a) => {
            a.inferredFromCustomFn = callSig;
            if (!a.label) {
              a.label = `via ${callSig}`;
            }
          });
          return realMotionActions;
        }
      }
    }

    return null;
  }

  // Comprehensive C++ Autonomous Parser
  function parseCppAuton(rawCode, options = {}) {
    const defaultMaxSpeed = options.defaultMaxSpeed || 127;
    const defaultMinSpeed = options.defaultMinSpeed || 0;
    const recursionDepth = options._recursionDepth || 0;
    const visitedFns = options._visitedFns || null;
    let paramEnv = options.paramEnv || null;

    if (!rawCode || !rawCode.trim() || recursionDepth > 4) {
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

    // Build custom functions map from project files + rawCode
    const customFnsMap = options.customFunctionsMap || extractCustomFunctions(rawCode, options.projectFiles);
    const localFnsMap = recursionDepth === 0 ? extractFunctionsFromCodeString(rawCode, "snippet") : new Map();

    // Determine which function in rawCode is the primary autonomous routine vs helper functions
    let targetCodeToParse = rawCode;

    if (localFnsMap.size > 0 && recursionDepth === 0) {
      const fnList = localFnsMap._orderedList || Array.from(localFnsMap.values());
      // Find which functions are called by other functions in this snippet
      const calledFnNames = new Set();
      fnList.forEach((f) => {
        fnList.forEach((other) => {
          if (f.name !== other.name) {
            const callRe = new RegExp(`\\b${other.name}\\s*\\(`, "g");
            if (callRe.test(f.body)) calledFnNames.add(other.name);
          }
        });
      });

      // Main routine candidate: prefer "autonomous", else a 0-param function not called by others, else last 0-param function
      let mainFn =
        fnList.find((f) => f.name.toLowerCase() === "autonomous") ||
        fnList.find((f) => f.params.length === 0 && !calledFnNames.has(f.name)) ||
        fnList.find((f) => !calledFnNames.has(f.name)) ||
        fnList[fnList.length - 1];

      if (mainFn) {
        const rawFn = mainFn.name;
        if (rawFn.toLowerCase() === "autonomous") {
          routineName = "Autonomous";
        } else {
          const formatted = rawFn
            .replace(/_/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/\b\w/g, (c) => c.toUpperCase());
          routineName = formatted || "Imported Auton";
        }
        log.push(`Detected autonomous routine function: ${mainFn.name} -> "${routineName}"`);

        // Also check if there are top-level statements outside all function definitions
        let outsideCode = "";
        let lastIdx = 0;
        fnList.forEach((f) => {
          if (f.headerStartIdx >= lastIdx) {
            outsideCode += rawCode.slice(lastIdx, f.headerStartIdx) + "\n";
            lastIdx = f.fullEndIdx;
          }
        });
        outsideCode += rawCode.slice(lastIdx);
        const hasOutsideExecutable = outsideCode
          .split("\n")
          .some((l) => {
            const t = l.trim();
            return t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("#") && !t.startsWith("using ");
          });

        if (fnList.length === 1 && mainFn.params.length > 0 && hasOutsideExecutable) {
          // Helper function defined at top of snippet + calls to it below!
          targetCodeToParse = outsideCode;
        } else if (fnList.length === 1 && mainFn.params.length > 0 && !hasOutsideExecutable && mainFn.onlyContainsChassisMotions) {
          // Only a parameterized custom motion function definition was provided (e.g. void driveTo(x, y, theta) { moveToPoint(x, y, theta); })
          // Bind parameters to defaults or sample preview values so its body still infers blocks & simulation
          const sampleArgs = mainFn.params.map((p, idx) => {
            if (p.defaultVal != null) return p.defaultVal;
            if (p.isThetaLike) return "90";
            return idx === 0 ? "24" : idx === 1 ? "24" : "0";
          });
          const sub = substituteParamsInBody(mainFn.body, mainFn.params, sampleArgs, paramEnv, mainFn);
          paramEnv = sub.env;
          targetCodeToParse = sub.substituted;
          log.push(`Inferred motion blocks from parameterized function definition: ${mainFn.name}(${mainFn.paramsRaw})`);
        } else {
          targetCodeToParse = mainFn.body + (hasOutsideExecutable ? "\n" + outsideCode : "");
        }
      }
    }

    const rawLines = targetCodeToParse.replace(/\r\n/g, "\n").split("\n");
    const cleanedLines = [];
    let insideFn = false;

    for (let i = 0; i < rawLines.length; i++) {
      let l = rawLines[i].trim();
      if (!l) continue;

      if (/^(?:void|int|bool|double|float)\s+[a-zA-Z0-9_]+\s*\([^)]*\)\s*\{/i.test(l)) {
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

      // Check if custom code block contains an if-else loop or ternary (only at top level or shallow depth)
      if (recursionDepth <= 1) {
        const detectedIf = parseIfElseFromCode(fullCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
        if (detectedIf) {
          if (pendingComments.length > 0) {
            detectedIf.label = pendingComments.join(" · ").trim();
            pendingComments = [];
          } else {
            const cMatch = fullCode.match(/\/\/\s*(.+)$/m);
            if (cMatch) {
              detectedIf.label = cleanCommentText(cMatch[1]);
            }
          }
          actions.push(detectedIf);
          log.push(`Auto-detected if loop in custom code block: if (${detectedIf.condition}) then "${detectedIf.thenLabel}" else "${detectedIf.elseLabel}"`);
          pendingCustomLines = [];
          return;
        }

        // Check if custom code block contains a while or for loop
        const detectedLoop = parseLoopFromCode(fullCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
        if (detectedLoop) {
          if (pendingComments.length > 0) {
            detectedLoop.label = pendingComments.join(" · ").trim();
            pendingComments = [];
          } else {
            const cMatch = fullCode.match(/\/\/\s*(.+)$/m);
            if (cMatch) {
              detectedLoop.label = cleanCommentText(cMatch[1]);
            }
          }
          actions.push(detectedLoop);
          log.push(`Auto-detected loop in custom code block: mode ${detectedLoop.loopMode}, condition ${detectedLoop.condition}`);
          pendingCustomLines = [];
          return;
        }
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

      // Check for C++ ternary conditional: condition ? expression_if_true : expression_if_false;
      const ternary = recursionDepth <= 2 ? tryParseTernary(line) : null;
      if (ternary) {
        flushCustomBlock();
        const act = createDefaultAction("ifElse", defaultMaxSpeed, defaultMinSpeed);
        act.condition = ternary.condition;
        act.thenCode = ternary.thenExpr + (!ternary.thenExpr.endsWith(";") ? ";" : "");
        act.elseCode = ternary.elseExpr + (!ternary.elseExpr.endsWith(";") ? ";" : "");
        act.thenAction = parseStatementToAction(ternary.thenExpr, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
        act.elseAction = parseStatementToAction(ternary.elseExpr, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap);
        act.thenLabel = getActionHumanLabel(act.thenAction, ternary.thenExpr);
        act.elseLabel = getActionHumanLabel(act.elseAction, ternary.elseExpr);
        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }
        actions.push(act);
        log.push(`Parsed ternary conditional: "${ternary.condition}" ? "${act.thenLabel}" : "${act.elseLabel}"`);
        continue;
      }

      // Check for C++ if (...) loops / conditionals
      if (recursionDepth <= 2 && /^if\s*\(/i.test(line)) {
        flushCustomBlock();
        // Extract condition between if ( and matching )
        const openParenIdx = line.indexOf("(");
        let parenDepth = 1;
        let closeParenIdx = -1;
        for (let k = openParenIdx + 1; k < line.length; k++) {
          if (line[k] === "(") parenDepth++;
          else if (line[k] === ")") {
            parenDepth--;
            if (parenDepth === 0) {
              closeParenIdx = k;
              break;
            }
          }
        }

        let condition = "true";
        if (closeParenIdx !== -1) {
          condition = line.slice(openParenIdx + 1, closeParenIdx).trim();
        }

        let remaining = closeParenIdx !== -1 ? line.slice(closeParenIdx + 1).trim() : "";
        let thenLines = [];
        let elseLines = [];

        // Collect then-block
        if (remaining.startsWith("{")) {
          let curBlock = remaining.slice(1).trim();
          let braceDepth = 1;
          if (curBlock.includes("}")) {
            const closeIdx = curBlock.lastIndexOf("}");
            thenLines.push(curBlock.slice(0, closeIdx).trim());
            remaining = curBlock.slice(closeIdx + 1).trim();
            braceDepth = 0;
          } else {
            if (curBlock) thenLines.push(curBlock);
            idx++;
            while (idx < cleanedLines.length) {
              const nextL = cleanedLines[idx].text;
              for (let c = 0; c < nextL.length; c++) {
                if (nextL[c] === "{") braceDepth++;
                else if (nextL[c] === "}") {
                  braceDepth--;
                  if (braceDepth === 0) {
                    const beforeBrace = nextL.slice(0, c).trim();
                    if (beforeBrace) thenLines.push(beforeBrace);
                    remaining = nextL.slice(c + 1).trim();
                    break;
                  }
                }
              }
              if (braceDepth === 0) break;
              thenLines.push(nextL);
              idx++;
            }
          }
        } else if (remaining.length > 0) {
          thenLines.push(remaining);
          remaining = "";
        } else {
          idx++;
          if (idx < cleanedLines.length) {
            const nextL = cleanedLines[idx].text;
            if (nextL.startsWith("{")) {
              let curBlock = nextL.slice(1).trim();
              let braceDepth = 1;
              if (curBlock.includes("}")) {
                const closeIdx = curBlock.lastIndexOf("}");
                thenLines.push(curBlock.slice(0, closeIdx).trim());
                remaining = curBlock.slice(closeIdx + 1).trim();
              } else {
                if (curBlock) thenLines.push(curBlock);
                idx++;
                while (idx < cleanedLines.length) {
                  const innerL = cleanedLines[idx].text;
                  for (let c = 0; c < innerL.length; c++) {
                    if (innerL[c] === "{") braceDepth++;
                    else if (innerL[c] === "}") {
                      braceDepth--;
                      if (braceDepth === 0) {
                        const beforeBrace = innerL.slice(0, c).trim();
                        if (beforeBrace) thenLines.push(beforeBrace);
                        remaining = innerL.slice(c + 1).trim();
                        break;
                      }
                    }
                  }
                  if (braceDepth === 0) break;
                  thenLines.push(innerL);
                  idx++;
                }
              }
            } else {
              thenLines.push(nextL);
            }
          }
        }

        // Now check for else
        let hasElse = false;
        let elseRemaining = remaining;
        if (/^else\b/i.test(elseRemaining)) {
          hasElse = true;
          elseRemaining = elseRemaining.replace(/^else\s*/i, "").trim();
        } else if (idx + 1 < cleanedLines.length && /^else\b/i.test(cleanedLines[idx + 1].text)) {
          hasElse = true;
          idx++;
          elseRemaining = cleanedLines[idx].text.replace(/^else\s*/i, "").trim();
        }

        if (hasElse) {
          if (elseRemaining.startsWith("{")) {
            let curBlock = elseRemaining.slice(1).trim();
            let braceDepth = 1;
            if (curBlock.includes("}")) {
              const closeIdx = curBlock.lastIndexOf("}");
              elseLines.push(curBlock.slice(0, closeIdx).trim());
            } else {
              if (curBlock) elseLines.push(curBlock);
              idx++;
              while (idx < cleanedLines.length) {
                const nextL = cleanedLines[idx].text;
                for (let c = 0; c < nextL.length; c++) {
                  if (nextL[c] === "{") braceDepth++;
                  else if (nextL[c] === "}") {
                    braceDepth--;
                    if (braceDepth === 0) {
                      const beforeBrace = nextL.slice(0, c).trim();
                      if (beforeBrace) elseLines.push(beforeBrace);
                      break;
                    }
                  }
                }
                if (braceDepth === 0) break;
                elseLines.push(nextL);
                idx++;
              }
            }
          } else if (elseRemaining.length > 0) {
            elseLines.push(elseRemaining);
          } else if (idx + 1 < cleanedLines.length) {
            idx++;
            const nextL = cleanedLines[idx].text;
            if (nextL.startsWith("{")) {
              let curBlock = nextL.slice(1).trim();
              let braceDepth = 1;
              if (curBlock.includes("}")) {
                const closeIdx = curBlock.lastIndexOf("}");
                elseLines.push(curBlock.slice(0, closeIdx).trim());
              } else {
                if (curBlock) elseLines.push(curBlock);
                idx++;
                while (idx < cleanedLines.length) {
                  const innerL = cleanedLines[idx].text;
                  for (let c = 0; c < innerL.length; c++) {
                    if (innerL[c] === "{") braceDepth++;
                    else if (innerL[c] === "}") {
                      braceDepth--;
                      if (braceDepth === 0) {
                        const beforeBrace = innerL.slice(0, c).trim();
                        if (beforeBrace) elseLines.push(beforeBrace);
                        break;
                      }
                    }
                  }
                  if (braceDepth === 0) break;
                  elseLines.push(innerL);
                  idx++;
                }
              }
            } else {
              elseLines.push(nextL);
            }
          }
        }

        const act = createDefaultAction("ifElse", defaultMaxSpeed, defaultMinSpeed);
        act.condition = condition;
        act.thenCode = thenLines.filter(Boolean).join("\n").trim();
        act.elseCode = elseLines.filter(Boolean).join("\n").trim();
        act.thenAction = act.thenCode ? parseStatementToAction(act.thenCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap) : null;
        act.elseAction = act.elseCode ? parseStatementToAction(act.elseCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap) : null;
        act.thenChildren = act.thenCode ? parseStatementsToList(act.thenCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap) : [];
        act.elseChildren = act.elseCode ? parseStatementsToList(act.elseCode, defaultMaxSpeed, defaultMinSpeed, recursionDepth + 1, visitedFns, customFnsMap) : [];
        act.thenLabel = act.thenAction ? getActionHumanLabel(act.thenAction, act.thenCode) : (act.thenCode ? "Custom Action" : "No Action");
        act.elseLabel = act.elseAction ? getActionHumanLabel(act.elseAction, act.elseCode) : (act.elseCode ? "Custom Action" : "No Action");

        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }

        actions.push(act);
        log.push(`Parsed if-else block: if (${condition}) then "${act.thenLabel}" else "${act.elseLabel}"`);
        continue;
      }

      // LemLib Movements (supporting both chassis.moveToPoint and custom moveToPoint(x, y, theta))
      const mtPointMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?moveToPoint\s*\(([^;]+)\)\s*;?$/i);
      if (mtPointMatch && isValidChassisReceiver(mtPointMatch[1], "moveToPoint", customFnsMap)) {
        flushCustomBlock();
        const hasChassisPrefix = !!mtPointMatch[1];
        const act = buildMoveToPointOrThetaAction(
          mtPointMatch[2],
          hasChassisPrefix,
          defaultMaxSpeed,
          defaultMinSpeed,
          customFnsMap,
          paramEnv
        );

        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        }

        if (act.async) act.showFlowchart = true;
        actions.push(act);
        if (act.type === "moveToPose" && act.inferredFromMoveToPointTheta) {
          log.push(`Inferred moveToPoint(${act.x}, ${act.y}, ${act.theta}°) with heading -> moveToPose block`);
        } else {
          log.push(`Parsed moveToPoint(${act.x}, ${act.y}) timeout: ${act.timeout}ms, async: ${act.async}`);
        }
        continue;
      }

      const mtPoseMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?moveToPose\s*\(([^;]+)\)\s*;?$/i);
      if (mtPoseMatch && isValidChassisReceiver(mtPoseMatch[1], "moveToPose", customFnsMap)) {
        flushCustomBlock();
        const args = splitCppArgsSafe(mtPoseMatch[2]);
        const act = createDefaultAction("moveToPose", defaultMaxSpeed, defaultMinSpeed);
        act.x = evaluateNumericArg(args[0], paramEnv) || 0;
        act.y = evaluateNumericArg(args[1], paramEnv) || 0;
        act.theta = evaluateNumericArg(args[2], paramEnv) || 0;
        act.timeout = parseInt(evaluateNumericArg(args[3], paramEnv), 10) || 2500;

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

      const ttPointMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?turnToPoint\s*\(([^;]+)\)\s*;?$/i);
      if (ttPointMatch && isValidChassisReceiver(ttPointMatch[1], "turnToPoint", customFnsMap)) {
        flushCustomBlock();
        const args = splitCppArgsSafe(ttPointMatch[2]);
        const act = createDefaultAction("turnToPoint", defaultMaxSpeed, defaultMinSpeed);
        act.x = evaluateNumericArg(args[0], paramEnv) || 0;
        act.y = evaluateNumericArg(args[1], paramEnv) || 0;
        act.timeout = parseInt(evaluateNumericArg(args[2], paramEnv), 10) || 1500;

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

      const ttHeadingMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?turnToHeading\s*\(([^;]+)\)\s*;?$/i);
      if (ttHeadingMatch && isValidChassisReceiver(ttHeadingMatch[1], "turnToHeading", customFnsMap)) {
        flushCustomBlock();
        const args = splitCppArgsSafe(ttHeadingMatch[2]);
        const act = createDefaultAction("turnToHeading", defaultMaxSpeed, defaultMinSpeed);
        act.theta = evaluateNumericArg(args[0], paramEnv) || 0;
        act.timeout = parseInt(evaluateNumericArg(args[1], paramEnv), 10) || 1500;

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

      const swPointMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?swingToPoint\s*\(([^;]+)\)\s*;?$/i);
      if (swPointMatch && isValidChassisReceiver(swPointMatch[1], "swingToPoint", customFnsMap)) {
        flushCustomBlock();
        const args = splitCppArgsSafe(swPointMatch[2]);
        const act = createDefaultAction("swingToPoint", defaultMaxSpeed, defaultMinSpeed);
        act.x = evaluateNumericArg(args[0], paramEnv) || 0;
        act.y = evaluateNumericArg(args[1], paramEnv) || 0;
        act.lockedSide = parseDriveSideEnum(args[2]);
        act.timeout = parseInt(evaluateNumericArg(args[3], paramEnv), 10) || 2000;

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

      const swHeadingMatch = line.match(/^(?:([a-zA-Z0-9_]+)\s*(?:\.|->)\s*)?swingToHeading\s*\(([^;]+)\)\s*;?$/i);
      if (swHeadingMatch && isValidChassisReceiver(swHeadingMatch[1], "swingToHeading", customFnsMap)) {
        flushCustomBlock();
        const args = splitCppArgsSafe(swHeadingMatch[2]);
        const act = createDefaultAction("swingToHeading", defaultMaxSpeed, defaultMinSpeed);
        act.theta = evaluateNumericArg(args[0], paramEnv) || 0;
        act.lockedSide = parseDriveSideEnum(args[1]);
        act.timeout = parseInt(evaluateNumericArg(args[2], paramEnv), 10) || 2000;

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

      // Check if line is a call to a custom function whose definition ONLY contains moveToPoint(x, y, theta) or other chassis motions
      const expandedActs = expandCustomFunctionCall(
        line,
        customFnsMap,
        defaultMaxSpeed,
        defaultMinSpeed,
        recursionDepth,
        paramEnv,
        visitedFns
      );
      if (expandedActs && expandedActs.length > 0) {
        flushCustomBlock();
        expandedActs.forEach((ea, eaIdx) => {
          if (eaIdx === 0) {
            if (inlineComment) ea.label = inlineComment;
            else if (pendingComments.length > 0) {
              ea.label = pendingComments.join(" · ").trim();
              pendingComments = [];
            }
          }
          actions.push(ea);
        });
        log.push(`Inferred ${expandedActs.length} action(s) from custom function call: ${line}`);
        continue;
      }

      // chassis.waitUntil(distance) - Distance-based event trigger
      const waitDistMatch = line.match(/^(?:chassis|bot|drive|drivetrain|robot)\.waitUntil\s*\(\s*([-\d.]+)\s*\)\s*;?$/i);
      if (waitDistMatch) {
        flushCustomBlock();
        const dist = parseFloat(waitDistMatch[1]) || 12;
        const act = createDefaultAction("wait", defaultMaxSpeed, defaultMinSpeed);
        act.waitType = "distance";
        act.distance = dist;
        act.async = true;
        act.showFlowchart = true;
        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        } else {
          act.label = `Trigger @ ${dist}" into motion`;
        }
        actions.push(act);
        log.push(`Parsed distance trigger: chassis.waitUntil(${dist}) -> "${act.label}"`);
        continue;
      }

      // chassis.waitUntilDone() - Chassis settle sync point
      const waitDoneMatch = line.match(/^(?:chassis|bot|drive|drivetrain|robot)\.waitUntilDone\s*\(\s*\)\s*;?$/i);
      if (waitDoneMatch) {
        flushCustomBlock();
        const act = createDefaultAction("wait", defaultMaxSpeed, defaultMinSpeed);
        act.waitType = "done";
        act.async = false;
        act.showFlowchart = true;
        if (inlineComment) act.label = inlineComment;
        else if (pendingComments.length > 0) {
          act.label = pendingComments.join(" · ").trim();
          pendingComments = [];
        } else {
          act.label = "Wait until chassis settles";
        }
        actions.push(act);
        log.push(`Parsed sync point: chassis.waitUntilDone()`);
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
    let controlCount = 0;
    let asyncCount = 0;
    let commentsCount = 0;

    actions.forEach((a) => {
      if (a.type === "custom") customCount++;
      else if (a.type === "ifElse") controlCount++;
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
        controlCount,
        asyncCount,
        commentsCount,
      },
      log,
    };
  }

  // Parse LemLib Drivetrain & ControllerSettings from raw C++ code
  function parseLemlibRobotConfig(cppCode) {
    if (!cppCode) return null;
    const resolveWheel = (raw) => {
      if (!raw) return 3.25;
      const str = String(raw).trim();
      if (str.includes("NEW_2") && !str.includes("NEW_275")) return 2.0;
      if (str.includes("OLD_275") || str.includes("NEW_275")) return 2.75;
      if (str.includes("OLD_325") || str.includes("NEW_325")) return 3.25;
      if (str.includes("OLD_4") || str.includes("NEW_4")) return 4.0;
      const num = parseFloat(str.replace(/[^0-9.]/g, ""));
      return isNaN(num) || num <= 0 ? 3.25 : num;
    };

    const res = {
      found: false,
      trackWidth: 12.0,
      wheelDiam: 3.25,
      driveRpm: 600,
      horizontalDrift: 2.0,
      lateralKp: 8.0,
      lateralKi: 0.0,
      lateralKd: 30.0,
      lateralWindup: 3.0,
      lateralSmallErr: 1.0,
      lateralSmallTime: 100,
      lateralLargeErr: 3.0,
      lateralLargeTime: 500,
      lateralSlew: 0,
      angularKp: 2.0,
      angularKi: 0.0,
      angularKd: 10.0,
      angularWindup: 3.0,
      angularSmallErr: 1.0,
      angularSmallTime: 100,
      angularLargeErr: 3.0,
      angularLargeTime: 500,
      angularSlew: 0,
    };

    // Drivetrain
    const dtM = cppCode.match(/(?:extern\s+)?(?:lemlib::)?Drivetrain\s+([a-zA-Z0-9_]+)\s*\(([^;]+)\);/);
    if (dtM && dtM[2]) {
      res.found = true;
      const args = dtM[2].split(",").map(a => a.trim().replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/gm, "").trim());
      if (args.length >= 3 && !isNaN(parseFloat(args[2]))) res.trackWidth = parseFloat(args[2]);
      if (args.length >= 4) res.wheelDiam = resolveWheel(args[3]);
      if (args.length >= 5 && !isNaN(parseFloat(args[4]))) res.driveRpm = parseFloat(args[4]);
      if (args.length >= 6 && !isNaN(parseFloat(args[5]))) res.horizontalDrift = parseFloat(args[5]);
    }

    // Lateral Controller
    const latM = cppCode.match(/(?:extern\s+)?(?:lemlib::)?ControllerSettings\s+(?:lateral_controller|lateralController|lateral_pid|[a-zA-Z0-9_]*lat[a-zA-Z0-9_]*)\s*\(([^;]+)\);/i);
    if (latM && latM[1]) {
      res.found = true;
      const args = latM[1].split(",").map(a => parseFloat(a.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/gm, "").trim()));
      if (!isNaN(args[0])) res.lateralKp = args[0];
      if (!isNaN(args[1])) res.lateralKi = args[1];
      if (!isNaN(args[2])) res.lateralKd = args[2];
      if (!isNaN(args[3])) res.lateralWindup = args[3];
      if (!isNaN(args[4])) res.lateralSmallErr = args[4];
      if (!isNaN(args[5])) res.lateralSmallTime = args[5];
      if (!isNaN(args[6])) res.lateralLargeErr = args[6];
      if (!isNaN(args[7])) res.lateralLargeTime = args[7];
      if (!isNaN(args[8])) res.lateralSlew = args[8];
    }

    // Angular Controller
    const angM = cppCode.match(/(?:extern\s+)?(?:lemlib::)?ControllerSettings\s+(?:angular_controller|angularController|angular_pid|[a-zA-Z0-9_]*ang[a-zA-Z0-9_]*)\s*\(([^;]+)\);/i);
    if (angM && angM[1]) {
      res.found = true;
      const args = angM[1].split(",").map(a => parseFloat(a.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/gm, "").trim()));
      if (!isNaN(args[0])) res.angularKp = args[0];
      if (!isNaN(args[1])) res.angularKi = args[1];
      if (!isNaN(args[2])) res.angularKd = args[2];
      if (!isNaN(args[3])) res.angularWindup = args[3];
      if (!isNaN(args[4])) res.angularSmallErr = args[4];
      if (!isNaN(args[5])) res.angularSmallTime = args[5];
      if (!isNaN(args[6])) res.angularLargeErr = args[6];
      if (!isNaN(args[7])) res.angularLargeTime = args[7];
      if (!isNaN(args[8])) res.angularSlew = args[8];
    }

    return res;
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

    conditional_scratch: `// Autonomous: Scratch-Style Conditional Loops
void autonomous() {
  chassis.setPose(0, -60, 0);

  // If true move forward else move backwards
  if (true) {
    chassis.moveToPoint(24, 24, 2000);
  } else {
    chassis.moveToPoint(-24, -24, 2000, {.forwards = false});
  }

  // Ternary decision check
  isRedAlliance ? chassis.moveToPoint(48, 0, 1800) : chassis.moveToPoint(-48, 0, 1800);
}`,
  };

  // Infer LemLib motion/control actions from a custom C++ snippet or custom function call
  function inferActionsFromCustomCode(customCode, options = {}) {
    if (!customCode || typeof customCode !== "string" || !customCode.trim() || customCode.length > 20000) {
      return { hasMotion: false, motionActions: [], allActions: [], summaryLabel: "" };
    }
    const defaultMaxSpeed = options.defaultMaxSpeed || 127;
    const defaultMinSpeed = options.defaultMinSpeed || 0;

    // Ensure project functions cache is fresh before computing cache key
    if (!options.projectFiles) {
      getActiveCustomFunctionsMap();
    }
    const cacheKey = !options.projectFiles
      ? `${defaultMaxSpeed}|${defaultMinSpeed}|${cachedProjectFingerprint}|${customCode}`
      : null;

    if (cacheKey && inferredCustomCodeCache.has(cacheKey)) {
      return inferredCustomCodeCache.get(cacheKey);
    }

    const parsed = parseCppAuton(customCode, {
      defaultMaxSpeed,
      defaultMinSpeed,
      projectFiles: options.projectFiles || null,
    });
    const allActions = (parsed && Array.isArray(parsed.actions)) ? parsed.actions : [];
    const rawMotionActions = allActions.filter((a) => a && REAL_MOTION_TYPES.has(a.type));
    // Only treat custom code as a moving function if it ONLY contains chassis motion commands
    const isPureMotionSnippet = allActions.length > 0 && rawMotionActions.length > 0 && allActions.every(isPureChassisAction);
    const motionActions = isPureMotionSnippet ? rawMotionActions : [];
    const summaryParts = motionActions.map((a) => getActionHumanLabel(a, ""));
    const result = {
      hasMotion: isPureMotionSnippet,
      motionActions,
      allActions: isPureMotionSnippet ? allActions : [],
      summaryLabel: summaryParts.join(" → "),
    };

    if (cacheKey) {
      if (inferredCustomCodeCache.size > 250) {
        inferredCustomCodeCache.clear();
      }
      inferredCustomCodeCache.set(cacheKey, result);
    }
    return result;
  }

  return {
    splitCppArgsSafe,
    parseLemlibStructParams,
    parseDriveSideEnum,
    cleanCommentText,
    parseCppAuton,
    createDefaultAction,
    parseLemlibRobotConfig,
    parseStatementToAction,
    parseStatementsToList,
    tryParseTernary,
    parseIfElseFromCode,
    parseLoopFromCode,
    extractCustomFunctions,
    expandCustomFunctionCall,
    inferActionsFromCustomCode,
    SAMPLE_ROUTINES,
  };
});
