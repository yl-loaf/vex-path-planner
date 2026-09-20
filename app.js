(() => {
  "use strict";

  // ── Field constants ──────────────────────────────────────────────
  // 12 ft field = 144 in. Image is square; we map the playable area
  // (inside walls) to roughly ±70.5 in from center so walls are visible.
  const FIELD_IN = 144;          // full outer size
  const PLAYABLE = 141;          // approx inside wall-to-wall
  const HALF = PLAYABLE / 2;     // ±70.5

  // Robot visual size (inches) – typical 18" cube start size
  const ROBOT_W = 15;
  const ROBOT_L = 15;

  // ── DOM ──────────────────────────────────────────────────────────
  const canvas = document.getElementById("field");
  const ctx = canvas.getContext("2d");
  const coordsEl = document.getElementById("coords");
  const actionList = document.getElementById("actionList");
  const codeOut = document.getElementById("codeOut");

  const startX = document.getElementById("startX");
  const startY = document.getElementById("startY");
  const startTheta = document.getElementById("startTheta");
  const moveType = document.getElementById("moveType");
  const targetX = document.getElementById("targetX");
  const targetY = document.getElementById("targetY");
  const targetTheta = document.getElementById("targetTheta");
  const timeout = document.getElementById("timeout");
  const forwards = document.getElementById("forwards");
  const lockedSide = document.getElementById("lockedSide");
  const maxSpeed = document.getElementById("maxSpeed");
  const minSpeed = document.getElementById("minSpeed");
  const pointInputs = document.getElementById("pointInputs");
  const headingInput = document.getElementById("headingInput");
  const lockedSideWrap = document.getElementById("lockedSideWrap");
  const speedLabel = document.getElementById("speedLabel");

  // ── State ────────────────────────────────────────────────────────
  let fieldImg = new Image();
  fieldImg.src = "field.jpg";
  fieldImg.onerror = () => { /* fallback solid */ imgReady = true; draw(); };
  let imgReady = false;
  fieldImg.onload = () => {
    imgReady = true;
    draw();
  };

  // Start pose (must touch wall)
  let pose = { x: -60, y: -60, theta: 0 }; // degrees, clockwise from +Y

  // List of actions: { type, x?, y?, theta?, timeout, forwards, lockedSide, maxSpeed, minSpeed }
  let actions = [];

  // Simulation
  let simRunning = false;
  let simT = 0;
  let simPath = []; // array of {x,y,theta, t}
  let animId = null;
  let simSpeed = 1;

  // ── Coordinate helpers ───────────────────────────────────────────
  // Canvas pixels ↔ field inches
  // Image is drawn full canvas; we treat the full image as the outer field.
  function fieldToCanvas(x, y) {
    // x,y in inches, center origin, +Y up
    // Canvas: origin top-left, +Y down
    const scale = canvas.width / FIELD_IN;
    const cx = canvas.width / 2 + x * scale;
    const cy = canvas.height / 2 - y * scale; // flip Y
    return { cx, cy };
  }

  function canvasToField(cx, cy) {
    const scale = canvas.width / FIELD_IN;
    const x = (cx - canvas.width / 2) / scale;
    const y = (canvas.height / 2 - cy) / scale;
    return { x, y };
  }

  // Heading: 0 = +Y (up), increases clockwise (VEX/LemLib convention used here)
  function headingRad(deg) {
    // convert to standard math angle (0 = +X, CCW) for drawing
    // our 0° = +Y → math 90°, our +90° (CW) = +X → math 0°
    return (90 - deg) * Math.PI / 180;
  }

  // ── Wall-touching start enforcement ──────────────────────────────
  function snapToWall(x, y) {
    const margin = 9; // half robot ~ approx, keep center near wall
    const limit = HALF - margin;
    // If already near a wall, keep; else snap to nearest
    const distL = Math.abs(x + HALF);
    const distR = Math.abs(x - HALF);
    const distB = Math.abs(y + HALF);
    const distT = Math.abs(y - HALF);
    const minD = Math.min(distL, distR, distB, distT);
    if (minD < 12) return { x, y }; // already close enough
    // snap to nearest wall
    if (minD === distL) return { x: -limit, y: Math.max(-limit, Math.min(limit, y)) };
    if (minD === distR) return { x: limit, y: Math.max(-limit, Math.min(limit, y)) };
    if (minD === distB) return { x: Math.max(-limit, Math.min(limit, x)), y: -limit };
    return { x: Math.max(-limit, Math.min(limit, x)), y: limit };
  }

  // ── UI updates ───────────────────────────────────────────────────
  function updateMoveUI() {
    const t = moveType.value;
    const needsPoint = ["moveToPoint", "moveToPose", "turnToPoint", "swingToPoint"].includes(t);
    const needsHeading = ["moveToPose", "turnToHeading", "swingToHeading"].includes(t);
    const needsSide = ["swingToPoint", "swingToHeading"].includes(t);

    pointInputs.style.display = needsPoint ? "flex" : "none";
    headingInput.style.display = needsHeading ? "flex" : "none";
    lockedSideWrap.style.display = needsSide ? "flex" : "none";
  }
  moveType.addEventListener("change", updateMoveUI);
  updateMoveUI();

  // ── Drawing ──────────────────────────────────────────────────────
  function drawRobot(x, y, thetaDeg, color = "#a855f7", alpha = 1) {
    const { cx, cy } = fieldToCanvas(x, y);
    const scale = canvas.width / FIELD_IN;
    const w = ROBOT_W * scale;
    const l = ROBOT_L * scale;
    const rad = headingRad(thetaDeg);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(rad);

    // body
    ctx.fillStyle = color;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -l / 2, w, l, 4);
    ctx.fill();
    ctx.stroke();

    // direction arrow (points toward +heading, i.e. "front")
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.moveTo(l * 0.45, 0);
    ctx.lineTo(l * 0.15, -w * 0.28);
    ctx.lineTo(l * 0.15, w * 0.28);
    ctx.closePath();
    ctx.fill();

    // small center dot
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEndArrow(x, y, thetaDeg) {
    const { cx, cy } = fieldToCanvas(x, y);
    const scale = canvas.width / FIELD_IN;
    const rad = headingRad(thetaDeg);
    const len = 28;

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
    // arrowhead
    ctx.beginPath();
    ctx.moveTo(len + 6, 0);
    ctx.lineTo(len - 4, -7);
    ctx.lineTo(len - 4, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background image
    if (imgReady) {
      ctx.drawImage(fieldImg, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#333";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // grid (optional subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    const scale = canvas.width / FIELD_IN;
    for (let i = -72; i <= 72; i += 24) {
      const p1 = fieldToCanvas(i, -72);
      const p2 = fieldToCanvas(i, 72);
      ctx.beginPath();
      ctx.moveTo(p1.cx, p1.cy);
      ctx.lineTo(p2.cx, p2.cy);
      ctx.stroke();
      const p3 = fieldToCanvas(-72, i);
      const p4 = fieldToCanvas(72, i);
      ctx.beginPath();
      ctx.moveTo(p3.cx, p3.cy);
      ctx.lineTo(p4.cx, p4.cy);
      ctx.stroke();
    }

    // path lines
    if (actions.length > 0) {
      let cur = { ...pose };
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.beginPath();
      let first = true;
      const pts = [{ x: cur.x, y: cur.y }];

      for (const a of actions) {
        if (a.type === "moveToPoint" || a.type === "moveToPose") {
          pts.push({ x: a.x, y: a.y });
          cur.x = a.x;
          cur.y = a.y;
          if (a.type === "moveToPose") cur.theta = a.theta;
          else {
            // face toward point
            const dx = a.x - pts[pts.length - 2].x;
            const dy = a.y - pts[pts.length - 2].y;
            cur.theta = (90 - Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          }
        } else if (a.type === "turnToPoint" || a.type === "swingToPoint") {
          const dx = a.x - cur.x;
          const dy = a.y - cur.y;
          cur.theta = (90 - Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        } else if (a.type === "turnToHeading" || a.type === "swingToHeading") {
          cur.theta = a.theta;
        }
      }

      // draw polyline
      for (let i = 0; i < pts.length; i++) {
        const p = fieldToCanvas(pts[i].x, pts[i].y);
        if (i === 0) ctx.moveTo(p.cx, p.cy);
        else ctx.lineTo(p.cx, p.cy);
      }
      ctx.stroke();

      // waypoint dots
      for (let i = 1; i < pts.length; i++) {
        const p = fieldToCanvas(pts[i].x, pts[i].y);
        ctx.fillStyle = "#60a5fa";
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "11px sans-serif";
        ctx.fillText(String(i), p.cx + 7, p.cy - 5);
      }
    }

    // start pose
    drawRobot(pose.x, pose.y, pose.theta, "#22c55e", 0.95);
    const s = fieldToCanvas(pose.x, pose.y);
    ctx.fillStyle = "#22c55e";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("START", s.cx + 14, s.cy - 10);

    // final pose + big direction indicator
    if (actions.length > 0) {
      let end = { ...pose };
      for (const a of actions) {
        if (a.type === "moveToPoint" || a.type === "moveToPose") {
          end.x = a.x;
          end.y = a.y;
          if (a.type === "moveToPose") end.theta = a.theta;
          else {
            const dx = a.x - end.x;
            const dy = a.y - end.y;
            // approximate facing
            end.theta = (90 - Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          }
        } else if (a.type === "turnToPoint" || a.type === "swingToPoint") {
          const dx = a.x - end.x;
          const dy = a.y - end.y;
          end.theta = (90 - Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        } else {
          end.theta = a.theta;
        }
      }
      drawRobot(end.x, end.y, end.theta, "#f59e0b", 0.7);
      drawEndArrow(end.x, end.y, end.theta);
    }

    // live simulation robot
    if (simRunning && simPath.length > 0) {
      const idx = Math.min(Math.floor(simT), simPath.length - 1);
      const p = simPath[idx];
      drawRobot(p.x, p.y, p.theta, "#c084fc", 1);
    }
  }

  // ── Action list UI ───────────────────────────────────────────────
  function refreshList() {
    actionList.innerHTML = "";
    actions.forEach((a, i) => {
      const li = document.createElement("li");
      let desc = `${a.type}`;
      if (a.x !== undefined) desc += ` (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`;
      if (a.theta !== undefined) desc += ` θ=${a.theta}°`;
      if (a.lockedSide) desc += ` ${a.lockedSide}`;
      li.innerHTML = `<span class="idx">${i + 1}.</span> <span style="flex:1">${desc}</span>`;
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "×";
      del.onclick = () => {
        actions.splice(i, 1);
        refreshList();
        draw();
      };
      li.appendChild(del);
      actionList.appendChild(li);
    });
  }

  // ── Add movement ─────────────────────────────────────────────────
  function addAction() {
    const type = moveType.value;
    const a = {
      type,
      timeout: Number(timeout.value) || 2000,
      forwards: forwards.checked,
      maxSpeed: Number(maxSpeed.value) || 127,
      minSpeed: Number(minSpeed.value) || 0,
    };

    if (["moveToPoint", "moveToPose", "turnToPoint", "swingToPoint"].includes(type)) {
      a.x = Number(targetX.value);
      a.y = Number(targetY.value);
    }
    if (["moveToPose", "turnToHeading", "swingToHeading"].includes(type)) {
      a.theta = Number(targetTheta.value);
    }
    if (["swingToPoint", "swingToHeading"].includes(type)) {
      a.lockedSide = lockedSide.value;
    }

    actions.push(a);
    refreshList();
    draw();
  }

  // ── Code generation ──────────────────────────────────────────────
  function generateCode() {
    let code = `// LemLib autonomous path – generated by VEX Path Planner\n`;
    code += `// Field: Push Back 2025-26 | units: inches, degrees (CW from +Y)\n\n`;
    code += `chassis.setPose(${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}, ${pose.theta.toFixed(1)});\n\n`;

    for (const a of actions) {
      const params = [];
      if (!a.forwards) params.push(".forwards = false");
      if (a.maxSpeed !== 127) params.push(`.maxSpeed = ${a.maxSpeed}`);
      if (a.minSpeed !== 0) params.push(`.minSpeed = ${a.minSpeed}`);

      const paramStr = params.length ? `, {${params.join(", ")}}` : "";

      switch (a.type) {
        case "moveToPoint":
          code += `chassis.moveToPoint(${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.timeout}${paramStr});\n`;
          break;
        case "moveToPose":
          code += `chassis.moveToPose(${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.theta.toFixed(1)}, ${a.timeout}${paramStr});\n`;
          break;
        case "turnToPoint":
          code += `chassis.turnToPoint(${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.timeout}${paramStr});\n`;
          break;
        case "turnToHeading":
          code += `chassis.turnToHeading(${a.theta.toFixed(1)}, ${a.timeout}${paramStr});\n`;
          break;
        case "swingToPoint":
          code += `chassis.swingToPoint(${a.x.toFixed(2)}, ${a.y.toFixed(2)}, DriveSide::${a.lockedSide}, ${a.timeout}${paramStr});\n`;
          break;
        case "swingToHeading":
          code += `chassis.swingToHeading(${a.theta.toFixed(1)}, DriveSide::${a.lockedSide}, ${a.timeout}${paramStr});\n`;
          break;
      }
    }

    codeOut.value = code;
  }

  // ── Simple simulation ─────────────────────────────────────────────
  function buildSimPath() {
    simPath = [];
    let cur = { x: pose.x, y: pose.y, theta: pose.theta };
    const stepsPerSec = 30;
    let t = 0;

    simPath.push({ ...cur, t });

    for (const a of actions) {
      const duration = Math.max(0.4, a.timeout / 1000 * 0.7); // approximate
      const n = Math.max(8, Math.round(duration * stepsPerSec));

      if (a.type === "moveToPoint" || a.type === "moveToPose") {
        const start = { ...cur };
        const endX = a.x;
        const endY = a.y;
        let endTheta = a.type === "moveToPose" ? a.theta : cur.theta;
        if (a.type === "moveToPoint") {
          const dx = endX - start.x;
          const dy = endY - start.y;
          endTheta = (90 - Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        }
        for (let i = 1; i <= n; i++) {
          const u = i / n;
          // simple ease
          const e = u * u * (3 - 2 * u);
          cur.x = start.x + (endX - start.x) * e;
          cur.y = start.y + (endY - start.y) * e;
          // lerp angle short way
          let dth = ((endTheta - start.theta + 540) % 360) - 180;
          cur.theta = start.theta + dth * e;
          t += duration / n;
          simPath.push({ x: cur.x, y: cur.y, theta: cur.theta, t });
        }
        cur.theta = endTheta;
      } else {
        // pure turn / swing – stay in place, rotate
        let endTheta = cur.theta;
        if (a.type === "turnToHeading" || a.type === "swingToHeading") {
          endTheta = a.theta;
        } else {
          const dx = a.x - cur.x;
          const dy = a.y - cur.y;
          endTheta = (90 - Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        }
        const startTheta = cur.theta;
        for (let i = 1; i <= n; i++) {
          const u = i / n;
          let dth = ((endTheta - startTheta + 540) % 360) - 180;
          cur.theta = startTheta + dth * u;
          t += duration / n;
          simPath.push({ x: cur.x, y: cur.y, theta: cur.theta, t });
        }
        cur.theta = endTheta;
      }
    }
  }

  function startSim() {
    if (actions.length === 0) return;
    buildSimPath();
    simRunning = true;
    simT = 0;
    const startTime = performance.now();
    const totalT = simPath[simPath.length - 1].t;

    function frame(now) {
      if (!simRunning) return;
      const elapsed = ((now - startTime) / 1000) * simSpeed;
      // find index
      let idx = 0;
      for (let i = 0; i < simPath.length; i++) {
        if (simPath[i].t <= elapsed) idx = i;
        else break;
      }
      simT = idx;
      draw();
      if (elapsed < totalT + 0.3) {
        animId = requestAnimationFrame(frame);
      } else {
        simRunning = false;
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

  // ── Event wiring ─────────────────────────────────────────────────
  document.getElementById("btnSetStart").onclick = () => {
    let x = Number(startX.value);
    let y = Number(startY.value);
    const snapped = snapToWall(x, y);
    pose.x = snapped.x;
    pose.y = snapped.y;
    pose.theta = Number(startTheta.value);
    startX.value = pose.x.toFixed(1);
    startY.value = pose.y.toFixed(1);
    draw();
  };

  // presets (approximate starting zones near walls)
  document.getElementById("btnRedLeft").onclick = () => {
    pose = { x: -60, y: -60, theta: 0 };
    startX.value = -60; startY.value = -60; startTheta.value = 0;
    draw();
  };
  document.getElementById("btnRedRight").onclick = () => {
    pose = { x: 60, y: -60, theta: 0 };
    startX.value = 60; startY.value = -60; startTheta.value = 0;
    draw();
  };
  document.getElementById("btnBlueLeft").onclick = () => {
    pose = { x: -60, y: 60, theta: 180 };
    startX.value = -60; startY.value = 60; startTheta.value = 180;
    draw();
  };
  document.getElementById("btnBlueRight").onclick = () => {
    pose = { x: 60, y: 60, theta: 180 };
    startX.value = 60; startY.value = 60; startTheta.value = 180;
    draw();
  };

  document.getElementById("btnAdd").onclick = addAction;
  document.getElementById("btnClear").onclick = () => {
    actions = [];
    refreshList();
    stopSim();
    draw();
  };
  document.getElementById("btnUndo").onclick = () => {
    actions.pop();
    refreshList();
    draw();
  };
  document.getElementById("btnGenerate").onclick = generateCode;
  document.getElementById("btnCopy").onclick = () => {
    codeOut.select();
    navigator.clipboard.writeText(codeOut.value);
  };
  document.getElementById("btnSim").onclick = startSim;
  document.getElementById("btnStop").onclick = stopSim;

  document.getElementById("simSpeed").oninput = (e) => {
    simSpeed = Number(e.target.value);
    speedLabel.textContent = simSpeed + "×";
  };

  // Canvas click → set target coordinates
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const { x, y } = canvasToField(cx, cy);
    targetX.value = x.toFixed(1);
    targetY.value = y.toFixed(1);
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const { x, y } = canvasToField(cx, cy);
    coordsEl.textContent = `X: ${x.toFixed(1)}  Y: ${y.toFixed(1)}`;
  });

  // initial draw
  draw();
})();
