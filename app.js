(() => {
  "use strict";

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

  let pose = { x: -60, y: -60, theta: 0 };
  let actions = [];
  let selectedId = null;
  let drag = null;

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
      timeout: 2000,
      forwards: true,
      maxSpeed: 127,
      minSpeed: 0,
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

  /** Rough linear speed inches/sec from bot settings + maxSpeed 0-127 */
  function estimateLinearIps(maxSpeed) {
    const theoretical = (bot.wheelDiam * Math.PI * bot.driveRpm) / 60;
    // drivetrain efficiency / slip factor
    return theoretical * 0.22 * (clamp(maxSpeed, 1, 127) / 127);
  }

  /** Rough turn rate deg/sec */
  function estimateTurnDps(maxSpeed) {
    // scale with track width: narrower turns faster for same wheel speed
    const base = 200 * (clamp(maxSpeed, 1, 127) / 127);
    return base * (12 / Math.max(bot.trackWidth, 4));
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

  // -- Persistence --------------------------------------------------
  function markDirty() {
    saveStatus.textContent = "Unsaved...";
    saveStatus.className = "save-status dirty";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLocal, 400);
    try { updateTimeDisplay(); } catch (_) {}
  }

  function saveLocal() {
    const data = { version: 1, pose, actions, bot, savedAt: new Date().toISOString() };
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
      if (data.pose) pose = data.pose;
      if (Array.isArray(data.actions)) actions = data.actions;
      if (data.bot) bot = { ...bot, ...data.bot };
      syncBotInputs();
      syncStartInputs();
      renderFlow();
      draw();
      saveStatus.textContent = "Restored";
      saveStatus.className = "save-status ok";
    } catch (_) {}
  }

  function exportVPath() {
    const data = {
      version: 1,
      format: "vpath",
      game: "Push Back 2025-26",
      pose,
      actions,
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
        if (!data.pose || !Array.isArray(data.actions)) throw new Error("Invalid .vpath");
        pose = data.pose;
        actions = data.actions.map((a) => ({
          ...defaultAction(a.type || "moveToPoint"),
          ...a,
          id: a.id || uid(),
        }));
        selectedId = null;
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
      ctx.roundRect(-w / 2 - 3, -l / 2 - 3, w + 6, l + 6, 6);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -l / 2, w, l, 4);
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
    const poses = [{ x: pose.x, y: pose.y, theta: pose.theta }];
    let cur = { ...poses[0] };
    for (const a of actions) {
      if (a.type === "custom") {
        poses.push({ ...cur });
        continue;
      }
      if (isMove(a.type)) {
        cur.x = a.x;
        cur.y = a.y;
        if (a.type === "moveToPose") cur.theta = a.theta;
        else {
          const prev = poses[poses.length - 1];
          let face = angleToPoint(prev.x, prev.y, a.x, a.y);
          if (a.forwards === false) face = normalizeAngle(face + 180);
          cur.theta = face;
        }
      } else if (a.type === "turnToPoint" || a.type === "swingToPoint") {
        let face = angleToPoint(cur.x, cur.y, a.x, a.y);
        if (a.forwards === false) face = normalizeAngle(face + 180);
        cur.theta = face;
      } else if (a.type === "turnToHeading" || a.type === "swingToHeading") {
        cur.theta = a.theta;
      }
      poses.push({ ...cur });
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

    const poses = computePoses();

    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < poses.length; i++) {
      const a = i === 0 ? null : actions[i - 1];
      if (i > 0 && a && !isMove(a.type) && a.type !== "custom") continue;
      const p = fieldToCanvas(poses[i].x, poses[i].y);
      if (!started) { ctx.moveTo(p.cx, p.cy); started = true; }
      else ctx.lineTo(p.cx, p.cy);
    }
    ctx.stroke();

    for (let i = 1; i < poses.length; i++) {
      const a = actions[i - 1];
      if (a.type === "custom") continue;
      if (!needsPoint(a.type) && !isMove(a.type)) continue;
      const p = fieldToCanvas(poses[i].x, poses[i].y);
      const sel = a.id === selectedId;
      ctx.fillStyle = sel ? "#60a5fa" : "#3b82f6";
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, sel ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "11px sans-serif";
      ctx.fillText(String(i), p.cx + 8, p.cy - 6);
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
    }

    if (simRunning && simPath.length) {
      const p = simPath[Math.min(simIdx, simPath.length - 1)];
      drawRobot(p.x, p.y, p.theta, "#c084fc", 1);
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
            <label>Timeout ms <input type="number" data-f="timeout" step="100" value="${a.timeout}"/></label>
            ${sideField}
          </div>
          <div class="check-row">
            <label><input type="checkbox" data-f="forwards" ${a.forwards ? "checked" : ""}/> Forwards</label>
            <label><input type="checkbox" data-f="async" ${a.async ? "checked" : ""}/> async</label>
          </div>
          <div class="row">
            <label>MaxSpd <input type="number" data-f="maxSpeed" min="0" max="127" value="${a.maxSpeed}"/></label>
            <label>MinSpd <input type="number" data-f="minSpeed" min="0" max="127" value="${a.minSpeed}"/></label>
            <label>EarlyExit <input type="number" data-f="earlyExitRange" step="0.1" value="${a.earlyExitRange}"/></label>
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
          if (el.type === "checkbox") v = el.checked;
          else if (el.type === "number") v = Number(el.value);
          else v = el.value;
          a[f] = v;
          markDirty();
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

  function generateCode() {
    let code = `// Auto-generated by VEX LemLib Path Planner\n`;
    code += `// Push Back 2025-26 · inches · heading 0° = +Y, increases clockwise\n`;
    code += `// Bot: trackWidth=${bot.trackWidth}" robot=${bot.robotW}x${bot.robotL}" wheels=${bot.wheelDiam}" @ ${bot.driveRpm}rpm\n`;
    code += `// (Configure lemlib::Drivetrain with track width ${bot.trackWidth} in)\n\n`;
    code += `chassis.setPose(${num(pose.x)}, ${num(pose.y)}, ${num(pose.theta)});\n\n`;

    for (const a of actions) {
      if (a.label) code += `// ${a.label}\n`;

      if (a.type === "custom") {
        if (a.customCode.trim()) code += a.customCode.trim() + "\n\n";
        continue;
      }

      const px = (a.x ?? 0) + (a.offsetX || 0);
      const py = (a.y ?? 0) + (a.offsetY || 0);
      const pt = (a.theta ?? 0) + (a.offsetTheta || 0);

      const params = [];
      if (!a.forwards) params.push(".forwards = false");
      if (a.maxSpeed !== 127) params.push(`.maxSpeed = ${a.maxSpeed}`);
      if (a.minSpeed !== 0) params.push(`.minSpeed = ${a.minSpeed}`);
      if (a.earlyExitRange) params.push(`.earlyExitRange = ${a.earlyExitRange}`);
      const paramStr = params.length ? `, {${params.join(", ")}}` : "";
      const asyncArg = a.async ? "" : ", false";

      switch (a.type) {
        case "moveToPoint":
          code += `chassis.moveToPoint(${num(px)}, ${num(py)}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "moveToPose":
          code += `chassis.moveToPose(${num(px)}, ${num(py)}, ${num(pt)}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "turnToPoint":
          code += `chassis.turnToPoint(${num(px)}, ${num(py)}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "turnToHeading":
          code += `chassis.turnToHeading(${num(pt)}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "swingToPoint":
          code += `chassis.swingToPoint(${num(px)}, ${num(py)}, DriveSide::${a.lockedSide}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
        case "swingToHeading":
          code += `chassis.swingToHeading(${num(pt)}, DriveSide::${a.lockedSide}, ${a.timeout}${paramStr}${asyncArg});\n`;
          break;
      }
      if (!a.async) code += `chassis.waitUntilDone();\n`;
      code += "\n";
    }

    codeOut.value = code;
  }

  // -- Simulation ---------------------------------------------------
  function estimateActionTime(a, fromPose) {
    // Returns estimated seconds for one action (physical estimate, capped by timeout)
    const timeoutS = Math.max(0.1, (a.timeout || 2000) / 1000);
    if (a.type === "custom") return Math.min(0.4, timeoutS);

    const maxS = a.maxSpeed != null ? a.maxSpeed : 127;
    const ips = estimateLinearIps(maxS);
    const dps = estimateTurnDps(maxS);

    if (isMove(a.type)) {
      const dist = Math.hypot(a.x - fromPose.x, a.y - fromPose.y);
      let face = angleToPoint(fromPose.x, fromPose.y, a.x, a.y);
      if (a.forwards === false) face = normalizeAngle(face + 180);
      const ang = Math.abs(angleError(fromPose.theta, face));
      const tLin = dist / Math.max(ips, 0.1);
      const tAng = ang / Math.max(dps, 1);
      // moveToPoint blends turn+drive; roughly max + partial overlap
      const t = a.type === "moveToPose" ? tLin + tAng * 0.35 : Math.max(tLin, tAng * 0.5) + Math.min(tLin, tAng) * 0.3;
      return Math.min(Math.max(t, 0.15), timeoutS);
    }

    // turns / swings
    let endTh = fromPose.theta;
    if (a.type === "turnToHeading" || a.type === "swingToHeading") endTh = a.theta;
    else {
      endTh = angleToPoint(fromPose.x, fromPose.y, a.x, a.y);
      if (a.forwards === false) endTh = normalizeAngle(endTh + 180);
    }
    const ang = Math.abs(angleError(fromPose.theta, endTh));
    // swing is a bit slower (one side driven)
    const factor = isSwing(a.type) ? 1.25 : 1;
    const t = (ang / Math.max(dps, 1)) * factor;
    return Math.min(Math.max(t, 0.1), timeoutS);
  }

  function estimateTotalTime() {
    let cur = { x: pose.x, y: pose.y, theta: pose.theta };
    let total = 0;
    for (const a of actions) {
      if (a.async) {
        // async: doesn't block the chain for full duration — count partial
        total += estimateActionTime(a, cur) * 0.15;
      } else {
        total += estimateActionTime(a, cur);
      }
      // advance pose for next estimate
      if (a.type === "custom") continue;
      if (isMove(a.type)) {
        cur.x = a.x;
        cur.y = a.y;
        if (a.type === "moveToPose") cur.theta = a.theta;
        else {
          let face = angleToPoint(cur.x, cur.y, a.x, a.y);
          // after move, already at point — face toward last approach
          face = angleToPoint(
            // use previous position approx: from slightly behind
            cur.x, cur.y, a.x, a.y
          );
          // at target, heading faces the point we came toward from previous
        }
        const prevX = cur.x, prevY = cur.y;
        // recompute properly
      }
    }
    // cleaner second pass
    cur = { x: pose.x, y: pose.y, theta: pose.theta };
    total = 0;
    for (const a of actions) {
      const t = estimateActionTime(a, cur);
      total += a.async ? t * 0.15 : t;
      if (a.type === "custom") continue;
      if (isMove(a.type)) {
        const from = { ...cur };
        cur.x = a.x;
        cur.y = a.y;
        if (a.type === "moveToPose") cur.theta = a.theta;
        else {
          let face = angleToPoint(from.x, from.y, a.x, a.y);
          if (a.forwards === false) face = normalizeAngle(face + 180);
          cur.theta = face;
        }
      } else if (a.type === "turnToPoint" || a.type === "swingToPoint") {
        let face = angleToPoint(cur.x, cur.y, a.x, a.y);
        if (a.forwards === false) face = normalizeAngle(face + 180);
        cur.theta = face;
      } else if (a.type === "turnToHeading" || a.type === "swingToHeading") {
        cur.theta = a.theta;
      }
    }
    return total;
  }

  function updateTimeDisplay(elapsed, totalEst) {
    const el = document.getElementById("timeEst");
    if (!el) return;
    if (elapsed != null && totalEst != null) {
      el.textContent = `Time: ${elapsed.toFixed(2)}s / ~${totalEst.toFixed(2)}s est`;
    } else {
      const t = estimateTotalTime();
      el.textContent = actions.length ? `Est. time: ~${t.toFixed(2)}s` : `Est. time: —`;
    }
  }

  function buildSimPath() {
    simPath = [];
    let cur = { x: pose.x, y: pose.y, theta: pose.theta };
    const stepsPerSec = 50;
    let t = 0;
    simPath.push({ ...cur, t });

    for (const a of actions) {
      if (a.type === "custom") {
        const dur = 0.35;
        const n = Math.max(6, Math.round(dur * stepsPerSec));
        for (let i = 1; i <= n; i++) {
          t += dur / n;
          simPath.push({ x: cur.x, y: cur.y, theta: cur.theta, t });
        }
        continue;
      }

      const duration = estimateActionTime(a, cur);
      const n = Math.max(12, Math.round(duration * stepsPerSec));

      if (isMove(a.type)) {
        // LemLib moveToPoint: face target continuously; lateral = dist * cos(angularError)
        // When |angularError| > 90°, lateral contribution ~ 0 (don't drive into reverse awkwardly)
        const start = { ...cur };
        const endX = a.x;
        const endY = a.y;
        const backwards = a.forwards === false;

        let endTheta;
        if (a.type === "moveToPose") {
          endTheta = a.theta;
        } else {
          endTheta = angleToPoint(start.x, start.y, endX, endY);
          if (backwards) endTheta = normalizeAngle(endTheta + 180);
        }

        for (let i = 1; i <= n; i++) {
          const u = i / n;
          const e = u * u * (3 - 2 * u); // smoothstep position

          // position along straight chord (LemLib curves via continuous heading correction)
          cur.x = start.x + (endX - start.x) * e;
          cur.y = start.y + (endY - start.y) * e;

          if (a.type === "moveToPoint") {
            // Keep facing the target point (or opposite if backwards) — LemLib behaviour
            let face = angleToPoint(cur.x, cur.y, endX, endY);
            if (backwards) face = normalizeAngle(face + 180);
            // near the end, settle
            if (u > 0.92) {
              const dth = angleError(cur.theta, endTheta);
              cur.theta = normalizeAngle(cur.theta + dth * ((u - 0.92) / 0.08));
            } else {
              cur.theta = face;
            }
          } else {
            // moveToPose: blend toward target heading (simplified boomerang)
            const dth = angleError(start.theta, endTheta);
            cur.theta = normalizeAngle(start.theta + dth * e);
          }

          t += duration / n;
          simPath.push({ x: cur.x, y: cur.y, theta: cur.theta, t });
        }
        cur.x = endX;
        cur.y = endY;
        cur.theta = endTheta;
      } else {
        // turnTo* / swingTo*
        let endTheta = cur.theta;
        if (a.type === "turnToHeading" || a.type === "swingToHeading") {
          endTheta = a.theta;
        } else {
          endTheta = angleToPoint(cur.x, cur.y, a.x, a.y);
          if (a.forwards === false) endTheta = normalizeAngle(endTheta + 180);
        }

        const startTheta = cur.theta;
        const isSw = a.type === "swingToPoint" || a.type === "swingToHeading";
        const halfTrack = bot.trackWidth / 2;
        const startX0 = cur.x, startY0 = cur.y;
        const dthTotal = angleError(startTheta, endTheta);

        for (let i = 1; i <= n; i++) {
          const u = i / n;
          const th = normalizeAngle(startTheta + dthTotal * u);

          if (isSw) {
            const lockLeft = (a.lockedSide || "LEFT") === "LEFT";
            const pivotLocalX = lockLeft ? -halfTrack : halfTrack;
            const rightX = Math.sin(((startTheta + 90) * Math.PI) / 180);
            const rightY = Math.cos(((startTheta + 90) * Math.PI) / 180);
            const pivotWX = startX0 + rightX * pivotLocalX;
            const pivotWY = startY0 + rightY * pivotLocalX;
            const relX = startX0 - pivotWX;
            const relY = startY0 - pivotWY;
            const ang = (dthTotal * u * Math.PI) / 180;
            const cosA = Math.cos(ang), sinA = Math.sin(ang);
            // CW rotation of relative vector
            const nx = relX * cosA + relY * sinA;
            const ny = -relX * sinA + relY * cosA;
            cur.x = pivotWX + nx;
            cur.y = pivotWY + ny;
            cur.theta = th;
          } else {
            cur.theta = th;
          }
          t += duration / n;
          simPath.push({ x: cur.x, y: cur.y, theta: cur.theta, t });
        }
        cur.theta = endTheta;
      }
    }
  }

  function startSim() {
    if (!actions.length) return;
    buildSimPath();
    simRunning = true;
    simIdx = 0;
    const startTime = performance.now();
    const totalT = simPath[simPath.length - 1].t;
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
      updateTimeDisplay(Math.min(elapsed, totalT), totalEst);
      draw();
      if (elapsed < totalT + 0.25) animId = requestAnimationFrame(frame);
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

  window.addEventListener("mouseup", () => {
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
      if (p === "redL") pose = { x: -60, y: -60, theta: 0 };
      if (p === "redR") pose = { x: 60, y: -60, theta: 0 };
      if (p === "blueL") pose = { x: -60, y: 60, theta: 180 };
      if (p === "blueR") pose = { x: 60, y: 60, theta: 180 };
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
    if (!confirm("Clear entire path?")) return;
    actions = [];
    selectedId = null;
    markDirty();
    renderFlow();
    stopSim();
    draw();
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
  }

  function wireBotSettings() {
    const map = {
      trackWidth: "trackWidth",
      robotW: "robotW",
      robotL: "robotL",
      wheelDiam: "wheelDiam",
      driveRpm: "driveRpm",
    };
    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        bot[key] = Number(el.value) || bot[key];
        markDirty();
        draw();
      });
    });
  }

  // -- Init ---------------------------------------------------------
  wireBotSettings();
  loadLocal();
  syncBotInputs();
  if (!actions.length) {
    syncStartInputs();
    renderFlow();
    draw();
  } else {
    syncStartInputs();
    renderFlow();
    draw();
  }
  generateCode();
  try { updateTimeDisplay(); } catch (_) {}
})();
