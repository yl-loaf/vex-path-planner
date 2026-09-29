/**
 * match-analysis-engine.js - Autonomous Match Replay & Log Analysis Suite (ALPHA)
 * VEX V5 LemLib Suite
 *
 * Core capabilities:
 * - Parses V5 Brain odometry telemetry (CSV, PROS printf streams, JSON)
 * - Compares Planned LemLib Trajectories vs. Actual Recorded Odometry
 * - Computes Lateral Error, Angular Drift, Slip Index, and Deviation Heatmap
 * - Performs "Why Did We Fail?" Root-Cause Analysis with actionable LemLib recommendations
 * - Dual-scrubber playback synchronization for 2D field canvas visualization
 */

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MatchAnalysisEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  class MatchAnalysisEngine {
    constructor() {
      this.version = "1.0.0-alpha";
    }

    /**
     * Parse raw log text into structured telemetry points
     * @param {string} rawText 
     * @returns {Array<{t: number, x: number, y: number, theta: number, battMv?: number, extra?: any}>}
     */
    parseLog(rawText) {
      if (!rawText || typeof rawText !== "string") return [];
      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return [];

      // Try JSON first
      if (rawText.trim().startsWith("[") || rawText.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(rawText);
          const list = Array.isArray(parsed) ? parsed : (parsed.telemetry || parsed.samples || parsed.log || []);
          if (Array.isArray(list) && list.length > 0) {
            return this._normalizeSamples(list.map(pt => ({
              t: Number(pt.t ?? pt.time ?? pt.timeMs ?? pt.timestamp ?? 0),
              x: Number(pt.x ?? pt.posX ?? 0),
              y: Number(pt.y ?? pt.posY ?? 0),
              theta: Number(pt.theta ?? pt.heading ?? pt.angle ?? 0),
              battMv: Number(pt.battMv ?? pt.batteryMv ?? pt.batt ?? 12600)
            })));
          }
        } catch (_) {}
      }

      // Check CSV Header
      const headerLine = lines[0].toLowerCase();
      const isCsv = headerLine.includes("time") || headerLine.includes(",") || headerLine.includes("\t");

      const results = [];
      let startTime = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Format 1: [ODOM] t=1200 x=14.2 y=-30.5 theta=90.2 batt=12400
        const tagMatch = line.match(/(?:ODOM|LEM_LOG|PROS|LOG)[\s:\]]+t[=:]\s*([0-9.]+).*?x[=:]\s*([-0-9.]+).*?y[=:]\s*([-0-9.]+).*?th(?:eta)?[=:]\s*([-0-9.]+)/i);
        if (tagMatch) {
          const t = parseFloat(tagMatch[1]);
          const x = parseFloat(tagMatch[2]);
          const y = parseFloat(tagMatch[3]);
          const theta = parseFloat(tagMatch[4]);
          const battM = line.match(/batt[=:]\s*([0-9.]+)/i);
          const battMv = battM ? parseFloat(battM[1]) : 12400;
          results.push({ t, x, y, theta, battMv });
          continue;
        }

        // Format 2: CSV with commas or tabs
        const parts = line.split(/[,\t]+/).map(p => p.trim());
        if (parts.length >= 4) {
          // If first row is headers, skip
          if (i === 0 && isNaN(Number(parts[0]))) continue;

          const tVal = parseFloat(parts[0]);
          const xVal = parseFloat(parts[1]);
          const yVal = parseFloat(parts[2]);
          const thVal = parseFloat(parts[3]);

          if (!isNaN(tVal) && !isNaN(xVal) && !isNaN(yVal)) {
            const battVal = parts[4] ? parseFloat(parts[4]) : 12500;
            results.push({
              t: tVal,
              x: xVal,
              y: yVal,
              theta: isNaN(thVal) ? 0 : thVal,
              battMv: isNaN(battVal) ? 12500 : battVal
            });
          }
        }
      }

      return this._normalizeSamples(results);
    }

    _normalizeSamples(samples) {
      if (!samples || samples.length === 0) return [];
      // Sort by time
      samples.sort((a, b) => a.t - b.t);

      // Normalize starting time to 0ms
      const t0 = samples[0].t;
      return samples.map(s => ({
        t: Math.max(0, Math.round(s.t - t0)),
        x: Math.round(s.x * 100) / 100,
        y: Math.round(s.y * 100) / 100,
        theta: Math.round(s.theta * 10) / 10,
        battMv: s.battMv || 12500
      }));
    }

    /**
     * Generates a realistic simulated V5 Brain match odometry log for testing and demo
     * @param {object} routine The active path routine
     * @param {"slip" | "collision" | "oscillation" | "clean"} scenario 
     * @returns {Array<object>}
     */
    generateSampleLog(routine, scenario = "slip") {
      const actions = (routine && routine.actions) ? routine.actions : [];
      const startPose = routine && routine.pose ? routine.pose : { x: -60, y: -60, theta: 0 };

      const totalTimeMs = 15000;
      const stepMs = 50; // 20Hz VEX telemetry
      const samples = [];

      let curX = startPose.x || -60;
      let curY = startPose.y || -60;
      let curTheta = startPose.theta || 0;

      // Extract target waypoints
      const waypoints = [
        { x: curX, y: curY, theta: curTheta, timePct: 0 }
      ];

      const count = Math.max(1, actions.length);
      actions.forEach((act, idx) => {
        const timePct = (idx + 1) / count;
        waypoints.push({
          x: act.x !== undefined ? act.x : curX,
          y: act.y !== undefined ? act.y : curY,
          theta: act.theta !== undefined ? act.theta : (act.heading !== undefined ? act.heading : curTheta),
          timePct
        });
      });

      if (waypoints.length === 1) {
        waypoints.push({ x: 0, y: 0, theta: 90, timePct: 0.5 });
        waypoints.push({ x: 24, y: 48, theta: 180, timePct: 1.0 });
      }

      let battMv = 12800;

      for (let t = 0; t <= totalTimeMs; t += stepMs) {
        const normT = t / totalTimeMs;

        // Find surrounding waypoints
        let p0 = waypoints[0];
        let p1 = waypoints[waypoints.length - 1];

        for (let w = 0; w < waypoints.length - 1; w++) {
          if (normT >= waypoints[w].timePct && normT <= waypoints[w + 1].timePct) {
            p0 = waypoints[w];
            p1 = waypoints[w + 1];
            break;
          }
        }

        const segmentSpan = (p1.timePct - p0.timePct) || 0.001;
        const segT = Math.min(1, Math.max(0, (normT - p0.timePct) / segmentSpan));
        // Smooth S-curve easing
        const ease = segT * segT * (3 - 2 * segT);

        let idealX = p0.x + (p1.x - p0.x) * ease;
        let idealY = p0.y + (p1.y - p0.y) * ease;
        let idealTheta = p0.theta + (p1.theta - p0.theta) * ease;

        let actX = idealX;
        let actY = idealY;
        let actTheta = idealTheta;

        // Inject realistic noise and scenario errors
        const noiseX = (Math.sin(t / 180) * 0.15) + (Math.random() - 0.5) * 0.12;
        const noiseY = (Math.cos(t / 210) * 0.15) + (Math.random() - 0.5) * 0.12;
        const noiseTh = (Math.sin(t / 150) * 0.4);

        if (scenario === "slip") {
          // Wheel slip during high acceleration around t = 2.5s - 7.0s
          if (t >= 2200 && t <= 7500) {
            const slipFactor = Math.sin(((t - 2200) / 5300) * Math.PI);
            actX += slipFactor * 4.2; // 4.2" lateral displacement
            actY -= slipFactor * 2.8;
            actTheta += slipFactor * 11.5; // +11.5 deg angular slip
            battMv = Math.max(11100, battMv - 1.2);
          } else if (t > 7500) {
            // Residual uncorrected error
            actX += 2.6;
            actY -= 1.8;
            actTheta += 4.5;
          }
        } else if (scenario === "collision") {
          // Field element collision around t = 5.5s - 9.0s
          if (t >= 5500 && t <= 9000) {
            const col = Math.min(1, (t - 5500) / 1200);
            actX -= col * 5.4;
            actY += col * 3.8;
            actTheta -= col * 16.0;
            battMv = Math.max(10900, battMv - 2.5); // heavy motor stall current
          } else if (t > 9000) {
            actX -= 4.8;
            actY += 3.2;
            actTheta -= 12.0;
          }
        } else if (scenario === "oscillation") {
          // Underdamped PID ringing / oscillation
          const osc = Math.sin(t / 220) * 3.4 * (1 - Math.exp(-t / 3000));
          actX += osc;
          actY += Math.cos(t / 220) * 2.1;
          actTheta += osc * 4.0;
        } else {
          // Clean run: minor sensor noise
          actX += noiseX;
          actY += noiseY;
          actTheta += noiseTh;
        }

        battMv = Math.max(11200, battMv - 0.05);

        samples.push({
          t,
          x: Math.round(actX * 100) / 100,
          y: Math.round(actY * 100) / 100,
          theta: Math.round(actTheta * 10) / 10,
          battMv: Math.round(battMv)
        });
      }

      return samples;
    }

    /**
     * Compares planned points vs actual odometry samples and performs root-cause analysis
     * @param {Array<object>} plannedPoints Array of {t, x, y, theta, actionIndex}
     * @param {Array<object>} actualSamples Array of {t, x, y, theta, battMv}
     * @param {Array<object>} actions Original routine action blocks
     * @returns {object} Analysis result package
     */
    analyze(plannedPoints, actualSamples, actions = []) {
      if (!actualSamples || actualSamples.length === 0) {
        return {
          valid: false,
          error: "No actual odometry log samples provided."
        };
      }

      const durationMs = actualSamples[actualSamples.length - 1].t;
      let maxError = 0;
      let sumError = 0;
      let maxAngularError = 0;
      let maxErrorPoint = null;
      let maxErrorTime = 0;

      const merged = [];

      // Sample every 50ms for smooth replay
      for (let i = 0; i < actualSamples.length; i++) {
        const act = actualSamples[i];
        const plan = this._interpolatePlanned(plannedPoints, act.t, durationMs);

        const dx = act.x - plan.x;
        const dy = act.y - plan.y;
        const error = Math.sqrt(dx * dx + dy * dy);

        let dTheta = Math.abs(act.theta - plan.theta);
        while (dTheta > 180) dTheta = Math.abs(dTheta - 360);

        if (error > maxError) {
          maxError = error;
          maxErrorPoint = { x: act.x, y: act.y };
          maxErrorTime = act.t;
        }
        if (dTheta > maxAngularError) {
          maxAngularError = dTheta;
        }

        sumError += error;

        // Heatmap color code:
        // Green < 1.0", Yellow 1.0" - 2.5", Orange 2.5" - 4.5", Red > 4.5"
        let heatmapColor = "#22c55e"; // Green
        let severity = "good";
        if (error >= 4.5) {
          heatmapColor = "#ef4444"; // Red
          severity = "critical";
        } else if (error >= 2.5) {
          heatmapColor = "#f97316"; // Orange
          severity = "warning";
        } else if (error >= 1.0) {
          heatmapColor = "#eab308"; // Yellow
          severity = "moderate";
        }

        merged.push({
          t: act.t,
          plannedX: plan.x,
          plannedY: plan.y,
          plannedTheta: plan.theta,
          actualX: act.x,
          actualY: act.y,
          actualTheta: act.theta,
          error: Math.round(error * 100) / 100,
          angularError: Math.round(dTheta * 10) / 10,
          battMv: act.battMv || 12400,
          heatmapColor,
          severity,
          actionIndex: plan.actionIndex
        });
      }

      const avgError = actualSamples.length > 0 ? (sumError / actualSamples.length) : 0;
      const trackingAccuracyPct = Math.max(0, Math.min(100, Math.round(100 - (avgError / 36) * 100)));

      // Step-by-step root-cause diagnostics
      const diagnostics = this._generateDiagnostics(merged, actions);

      return {
        valid: true,
        durationMs,
        sampleCount: actualSamples.length,
        maxErrorInches: Math.round(maxError * 100) / 100,
        avgErrorInches: Math.round(avgError * 100) / 100,
        maxAngularErrorDeg: Math.round(maxAngularError * 10) / 10,
        maxErrorPoint,
        maxErrorTimeMs: maxErrorTime,
        trackingAccuracyPct,
        merged,
        diagnostics
      };
    }

    _interpolatePlanned(plannedPoints, tMs, maxDurationMs) {
      if (!plannedPoints || plannedPoints.length === 0) {
        return { x: 0, y: 0, theta: 0, actionIndex: 0 };
      }
      if (plannedPoints.length === 1) {
        return { ...plannedPoints[0], actionIndex: 0 };
      }

      // Check if plannedPoints already have t timestamps
      if (plannedPoints[0].t !== undefined) {
        // Binary search or linear interpolate
        if (tMs <= plannedPoints[0].t) return plannedPoints[0];
        if (tMs >= plannedPoints[plannedPoints.length - 1].t) {
          return plannedPoints[plannedPoints.length - 1];
        }

        for (let i = 0; i < plannedPoints.length - 1; i++) {
          const p0 = plannedPoints[i];
          const p1 = plannedPoints[i + 1];
          if (tMs >= p0.t && tMs <= p1.t) {
            const dt = (p1.t - p0.t) || 1;
            const factor = (tMs - p0.t) / dt;
            return {
              x: p0.x + (p1.x - p0.x) * factor,
              y: p0.y + (p1.y - p0.y) * factor,
              theta: p0.theta + (p1.theta - p0.theta) * factor,
              actionIndex: p1.actionIndex !== undefined ? p1.actionIndex : p0.actionIndex
            };
          }
        }
      }

      // Fallback: Uniform time distribution across planned points
      const norm = Math.min(1, Math.max(0, tMs / (maxDurationMs || 15000)));
      const idxF = norm * (plannedPoints.length - 1);
      const idx0 = Math.floor(idxF);
      const idx1 = Math.min(plannedPoints.length - 1, idx0 + 1);
      const f = idxF - idx0;

      const p0 = plannedPoints[idx0];
      const p1 = plannedPoints[idx1];

      return {
        x: p0.x + (p1.x - p0.x) * f,
        y: p0.y + (p1.y - p0.y) * f,
        theta: (p0.theta || 0) + ((p1.theta || 0) - (p0.theta || 0)) * f,
        actionIndex: p1.actionIndex !== undefined ? p1.actionIndex : idx0
      };
    }

    /**
     * Analyzes deviations and assigns blame/remedies for each action block
     */
    _generateDiagnostics(merged, actions = []) {
      const stepCount = Math.max(1, actions.length);
      const results = [];

      for (let s = 0; s < stepCount; s++) {
        const act = actions[s] || { type: "moveToPoint", x: 0, y: 0 };
        const actionIdx = s;

        // Extract points during this action window
        // Partition merged points into action bins
        const startIdx = Math.floor((s / stepCount) * merged.length);
        const endIdx = Math.floor(((s + 1) / stepCount) * merged.length);
        const pts = merged.slice(startIdx, Math.max(startIdx + 1, endIdx));

        let maxErr = 0;
        let sumErr = 0;
        let maxDegErr = 0;
        let worstPt = pts[0] || { t: 0, error: 0 };
        let minBatt = 13000;

        pts.forEach(p => {
          if (p.error > maxErr) {
            maxErr = p.error;
            worstPt = p;
          }
          if (p.angularError > maxDegErr) {
            maxDegErr = p.angularError;
          }
          if (p.battMv < minBatt) minBatt = p.battMv;
          sumErr += p.error;
        });

        const avgErr = pts.length > 0 ? (sumErr / pts.length) : 0;
        let status = "clean";
        let title = "Nominal Tracking";
        let cause = "Robot executed this path segment within target tolerance.";
        let fix = "No adjustments needed.";
        let icon = "✅";

        if (maxErr >= 4.5 || maxDegErr >= 15) {
          status = "critical";
          icon = "🚨";
          if (minBatt < 11400) {
            title = "Severe Battery Voltage Droop";
            cause = `Battery voltage dropped to ${(minBatt / 1000).toFixed(2)}V during high motor torque draw, causing trajectory lag and ${maxErr.toFixed(1)}" deviation.`;
            fix = "Ensure battery is >12.4V prior to match, or lower maximum motor velocity on this block.";
          } else if (maxDegErr >= 15) {
            title = "Severe Angular Drift / Inertial Slip";
            cause = `Robot heading deviated by ${maxDegErr.toFixed(1)}° from target, throwing off subsequent coordinates.`;
            fix = "Increase angular kD gain in LemLib, check IMU calibration, or decrease turn velocity.";
          } else {
            title = "Major Path Deviation / Obstacle Collision";
            cause = `Lateral error spiked to ${maxErr.toFixed(1)}" at t=${(worstPt.t / 1000).toFixed(1)}s. Likely wheel slip or physical contact with goal/perimeter.`;
            fix = "Increase lateralLargeTime settling timeout, verify field clearance, or smooth curve curvature.";
          }
        } else if (maxErr >= 2.0 || maxDegErr >= 7) {
          status = "warning";
          icon = "⚠️";
          title = "Moderate Odometry Scrub / Wheel Slew";
          cause = `Error peaked at ${maxErr.toFixed(1)}" (${maxDegErr.toFixed(1)}° heading error). Typical of rapid acceleration or unweighted tracking wheels.`;
          fix = "Tune lateral slew rate to ramp voltage gradually, and check downward spring tension on tracking wheels.";
        }

        results.push({
          stepIndex: s + 1,
          actionType: act.type || "moveToPoint",
          targetCoords: `(${act.x !== undefined ? act.x : 0}", ${act.y !== undefined ? act.y : 0}")`,
          timeWindowSec: `${((s / stepCount) * (merged[merged.length - 1]?.t || 15000) / 1000).toFixed(1)}s - ${(((s + 1) / stepCount) * (merged[merged.length - 1]?.t || 15000) / 1000).toFixed(1)}s`,
          worstTimeMs: worstPt.t,
          maxErrorInches: Math.round(maxErr * 10) / 10,
          avgErrorInches: Math.round(avgErr * 10) / 10,
          maxAngularErrorDeg: Math.round(maxDegErr * 10) / 10,
          status,
          icon,
          title,
          cause,
          fix
        });
      }

      return results;
    }

    /**
     * Returns interpolated actual and planned poses at timestamp tMs
     */
    getReplayFrame(analysisResult, tMs) {
      if (!analysisResult || !analysisResult.merged || analysisResult.merged.length === 0) {
        return null;
      }
      const list = analysisResult.merged;
      if (tMs <= list[0].t) return list[0];
      if (tMs >= list[list.length - 1].t) return list[list.length - 1];

      // Binary search
      let low = 0;
      let high = list.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (list[mid].t === tMs) return list[mid];
        if (list[mid].t < tMs) low = mid + 1;
        else high = mid - 1;
      }

      const p0 = list[Math.max(0, high)];
      const p1 = list[Math.min(list.length - 1, low)];
      const span = (p1.t - p0.t) || 1;
      const frac = (tMs - p0.t) / span;

      return {
        t: tMs,
        plannedX: p0.plannedX + (p1.plannedX - p0.plannedX) * frac,
        plannedY: p0.plannedY + (p1.plannedY - p0.plannedY) * frac,
        plannedTheta: p0.plannedTheta + (p1.plannedTheta - p0.plannedTheta) * frac,
        actualX: p0.actualX + (p1.actualX - p0.actualX) * frac,
        actualY: p0.actualY + (p1.actualY - p0.actualY) * frac,
        actualTheta: p0.actualTheta + (p1.actualTheta - p0.actualTheta) * frac,
        error: p0.error + (p1.error - p0.error) * frac,
        angularError: p0.angularError + (p1.angularError - p0.angularError) * frac,
        battMv: p0.battMv,
        heatmapColor: p0.heatmapColor,
        severity: p0.severity
      };
    }
  }

  return new MatchAnalysisEngine();
});
