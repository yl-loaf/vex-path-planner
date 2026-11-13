/* ==========================================================================
   VEX V5 Competition & Tournament Manager (DWAB VEX TM Inspired)
   Full Event Operations: Field Control, Match Queue, Scorekeeper, Rankings,
   Hardware Inspection, Elimination Bracket, Audience/Pit Displays & V5 USB Link
   ========================================================================== */
(function () {
  "use strict";

  const STORAGE_KEY = "vex_tm_tournament_state_v1";
  const CHANNEL_NAME = "vex_tm_live_sync";

  let state = createDefaultState();
  let activeView = "field";
  let queueFilter = "all";
  let teamFilter = "all";
  let scoringSubmode = "match";
  let audioMuted = false;
  let audioCtx = null;
  let timerInterval = null;
  let saveTimeout = null;
  let inspTeamIndex = -1;
  let activeElimId = null;
  let broadcastChan = null;
  let isStandaloneDisplay = false;
  let standaloneMode = null; // 'audience' | 'pit'
  let lastBroadcastSig = "";

  function createDefaultState() {
    return {
      version: 1,
      updatedAt: Date.now(),
      event: {
        name: "V5RC Override Regional Qualifier",
        sku: "RE-V5RC-26-0001",
        date: new Date().toISOString().slice(0, 10),
        location: "Main Competition Gym",
        program: "override",
        division: "Science Division",
        autonSeconds: 15,
        driverSeconds: 105,
        skillsSeconds: 60,
        allianceCount: 8,
        elimFormat: "bo1"
      },
      dwabBridge: {
        host: "http://localhost:8080",
        connected: false,
        lastSync: null
      },
      fields: [
        { id: "field_1", name: "Competition Field 1", set: "Field Set 1", activeMatchId: null },
        { id: "field_2", name: "Competition Field 2", set: "Field Set 1", activeMatchId: null },
        { id: "skills_1", name: "Skills Field A", set: "Skills Area", activeMatchId: null }
      ],
      teams: [],
      matches: [],
      elimMatches: [],
      alliances: [],
      skillsRuns: [],
      liveTimer: {
        fieldId: "field_1",
        matchId: null,
        mode: "match",
        phase: "IDLE",
        remainingSec: 15,
        running: false,
        autonWinner: "none",
        displayMode: "match",
        updatedAt: Date.now()
      }
    };
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatClock(sec) {
    const s = Math.max(0, Math.ceil(Number(sec) || 0));
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return `${mins}:${String(rem).padStart(2, "0")}`;
  }

  /* ------------------------------------------------------------------------
     AUDIO CUES (Web Audio Synthesized VEX Match Horns & Bells)
     ------------------------------------------------------------------------ */
  function ensureAudio() {
    if (audioMuted) return null;
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function playCue(kind) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const playTone = (freq, startOffset, dur, type = "sawtooth", gainVal = 0.14) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.linearRampToValueAtTime(gainVal, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + dur + 0.03);
    };

    if (kind === "start") {
      playTone(880, 0, 0.22, "triangle", 0.18);
      playTone(1175, 0.18, 0.3, "triangle", 0.2);
    } else if (kind === "auton_end") {
      playTone(523, 0, 0.25, "square", 0.14);
      playTone(392, 0.26, 0.35, "square", 0.14);
    } else if (kind === "endgame") {
      playTone(987, 0, 0.14, "sine", 0.2);
      playTone(987, 0.18, 0.14, "sine", 0.2);
      playTone(1318, 0.36, 0.24, "sine", 0.22);
    } else if (kind === "match_end") {
      playTone(220, 0, 0.75, "sawtooth", 0.18);
      playTone(277, 0, 0.75, "sawtooth", 0.14);
    } else if (kind === "abort") {
      playTone(196, 0, 0.2, "sawtooth", 0.16);
      playTone(164, 0.22, 0.35, "sawtooth", 0.16);
    }
  }

  /* ------------------------------------------------------------------------
     PERSISTENCE & MULTI-TAB / SERVER SYNC
     ------------------------------------------------------------------------ */
  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function persistState(immediate = false) {
    state.updatedAt = Date.now();
    saveLocal();
    if (broadcastChan) {
      try {
        broadcastChan.postMessage({ type: "tm_state", state });
      } catch (_) {}
    }

    const pushToServer = () => {
      const url = window.getApiUrl ? window.getApiUrl("/api/tm/state") : "/api/tm/state";
      if (!url) return;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      }).catch(() => {});
    };

    if (immediate) {
      clearTimeout(saveTimeout);
      pushToServer();
    } else {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(pushToServer, 220);
    }
  }

  async function loadInitialState() {
    let loaded = null;
    try {
      const url = window.getApiUrl ? window.getApiUrl("/api/tm/state") : "/api/tm/state";
      if (url) {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === "object" && data.event) {
            loaded = data;
          }
        }
      }
    } catch (_) {}

    if (!loaded) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) loaded = JSON.parse(raw);
      } catch (_) {}
    }

    if (loaded) {
      state = mergeDefaultState(loaded);
    }
    if (!state.teams || state.teams.length === 0) {
      // Populate clean default starter state only if completely untouched; keep ready for sample load
      saveLocal();
    }
    syncAllViews();
  }

  function mergeDefaultState(raw) {
    const def = createDefaultState();
    return {
      ...def,
      ...raw,
      event: { ...def.event, ...(raw.event || {}) },
      dwabBridge: { ...def.dwabBridge, ...(raw.dwabBridge || {}) },
      fields: Array.isArray(raw.fields) && raw.fields.length ? raw.fields : def.fields,
      teams: Array.isArray(raw.teams) ? raw.teams : [],
      matches: Array.isArray(raw.matches) ? raw.matches : [],
      elimMatches: Array.isArray(raw.elimMatches) ? raw.elimMatches : [],
      alliances: Array.isArray(raw.alliances) ? raw.alliances : [],
      skillsRuns: Array.isArray(raw.skillsRuns) ? raw.skillsRuns : [],
      liveTimer: { ...def.liveTimer, ...(raw.liveTimer || {}) }
    };
  }

  function initLiveSyncStream() {
    if (typeof BroadcastChannel !== "undefined") {
      broadcastChan = new BroadcastChannel(CHANNEL_NAME);
      broadcastChan.onmessage = (ev) => {
        if (ev.data && ev.data.type === "tm_state" && ev.data.state) {
          if ((ev.data.state.updatedAt || 0) >= (state.updatedAt || 0)) {
            state = mergeDefaultState(ev.data.state);
            syncAllViews();
          }
        }
      };
    }

    if (typeof EventSource !== "undefined") {
      try {
        const streamUrl = window.getApiUrl ? window.getApiUrl("/api/tm/stream") : "/api/tm/stream";
        if (!streamUrl) return;
        const es = new EventSource(streamUrl);
        es.addEventListener("tm_update", (ev) => {
          try {
            const incoming = JSON.parse(ev.data);
            if (incoming && (incoming.updatedAt || 0) > (state.updatedAt || 0)) {
              state = mergeDefaultState(incoming);
              saveLocal();
              syncAllViews();
            }
          } catch (_) {}
        });
      } catch (_) {}
    }
  }

  /* ------------------------------------------------------------------------
     SAMPLE EVENT GENERATOR
     ------------------------------------------------------------------------ */
  function loadSampleEvent() {
    const sampleTeams = [
      { number: "1010A", name: "Ten Ton Robotics", org: "West Vancouver Secondary", location: "Vancouver, BC" },
      { number: "2145Z", name: "Apex Autonomous", org: "Central High School", location: "Columbus, OH" },
      { number: "8888X", name: "Vector Drive", org: "Bay Area Robotics", location: "San Jose, CA" },
      { number: "44785A", name: "Kinetic Override", org: "Northgate STEM", location: "Austin, TX" },
      { number: "99904B", name: "Cobalt Systems", org: "Oak Ridge Academy", location: "Oak Ridge, TN" },
      { number: "7700R", name: "Rolling Robots", org: "Rolling Hills Prep", location: "Torrance, CA" },
      { number: "315G", name: "Paradigm Shift", org: "Silicon Valley Club", location: "Cupertino, CA" },
      { number: "5225A", name: "Pilons Legacy", org: "Brampton Robotics", location: "Brampton, ON" },
      { number: "6030J", name: "Zero Latency", org: "Eastside Tech", location: "Bellevue, WA" },
      { number: "169A", name: "Cavalry Precision", org: "Haverford Robotics", location: "Haverford, PA" },
      { number: "2775V", name: "Jackson Area", org: "JEC Robotics", location: "Jackson, TN" },
      { number: "9123C", name: "Overclocked", org: "Metro Magnet", location: "Atlanta, GA" }
    ];

    state = createDefaultState();
    state.teams = sampleTeams.map((t, idx) => ({
      ...t,
      checkedIn: idx < 11,
      inspectionStatus: idx < 10 ? "Passed" : idx === 10 ? "Partial" : "Not Started",
      inspectionChecklist: {
        sizing: idx < 11,
        brain: idx < 10,
        battery: idx < 10,
        motors: idx < 10,
        radio: idx < 10,
        plates: idx < 10,
        safety: idx < 10
      },
      inspector: idx < 10 ? "J. Miller" : "",
      inspectionNotes: ""
    }));

    generateQualSchedule(5, false);

    // Score first 6 matches with realistic Override data
    const sampleScores = [
      { redPins: 5, redYellowPins: 2, redToggles: 2, redBonus: 0, bluePins: 4, blueYellowPins: 1, blueToggles: 1, blueBonus: 0, autonWinner: "red", redAwp: true, blueAwp: false },
      { redPins: 3, redYellowPins: 1, redToggles: 1, redBonus: 0, bluePins: 6, blueYellowPins: 2, blueToggles: 2, blueBonus: 0, autonWinner: "blue", redAwp: false, blueAwp: true },
      { redPins: 4, redYellowPins: 2, redToggles: 1, redBonus: 5, bluePins: 4, blueYellowPins: 1, blueToggles: 2, blueBonus: 0, autonWinner: "tie", redAwp: true, blueAwp: true },
      { redPins: 7, redYellowPins: 3, redToggles: 2, redBonus: 0, bluePins: 3, blueYellowPins: 0, blueToggles: 1, blueBonus: 0, autonWinner: "red", redAwp: true, blueAwp: false },
      { redPins: 2, redYellowPins: 1, redToggles: 1, redBonus: 0, bluePins: 5, blueYellowPins: 3, blueToggles: 3, blueBonus: 0, autonWinner: "blue", redAwp: false, blueAwp: true },
      { redPins: 5, redYellowPins: 1, redToggles: 2, redBonus: 0, bluePins: 5, blueYellowPins: 1, blueToggles: 2, blueBonus: 0, autonWinner: "red", redAwp: false, blueAwp: false }
    ];

    sampleScores.forEach((sc, i) => {
      const m = state.matches[i];
      if (!m) return;
      m.breakdown = { ...sc, mode: "override" };
      const calc = computeOverrideBreakdown(sc);
      m.redScore = calc.redScore;
      m.blueScore = calc.blueScore;
      m.autonWinner = sc.autonWinner;
      m.redAwp = sc.redAwp;
      m.blueAwp = sc.blueAwp;
      m.state = "SUBMITTED";
    });

    if (state.matches[6]) {
      state.matches[6].state = "ACTIVE";
      state.liveTimer.matchId = state.matches[6].id;
      if (state.fields[0]) state.fields[0].activeMatchId = state.matches[6].id;
    }
    if (state.matches[7]) state.matches[7].state = "ON_DECK";
    if (state.matches[8]) state.matches[8].state = "QUEUED";

    state.skillsRuns = [
      { id: "sk_1", team: "1010A", type: "driver", attempt: 1, score: 65, stopSec: 4 },
      { id: "sk_2", team: "1010A", type: "programming", attempt: 1, score: 50, stopSec: 2 },
      { id: "sk_3", team: "5225A", type: "driver", attempt: 1, score: 60, stopSec: 0 },
      { id: "sk_4", team: "5225A", type: "programming", attempt: 1, score: 55, stopSec: 6 },
      { id: "sk_5", team: "2145Z", type: "driver", attempt: 1, score: 50, stopSec: 0 },
      { id: "sk_6", team: "2145Z", type: "programming", attempt: 1, score: 45, stopSec: 1 }
    ];

    persistState(true);
    syncAllViews();
  }

  /* ------------------------------------------------------------------------
     SCHEDULE GENERATOR & SCORING ENGINE
     ------------------------------------------------------------------------ */
  function generateQualSchedule(matchesPerTeam = 6, shouldPersist = true) {
    const eligible = state.teams.map((t) => t.number);
    if (eligible.length < 4) {
      alert("Add at least 4 teams before generating a 2v2 qualification schedule.");
      return;
    }

    const totalSlotsNeeded = eligible.length * matchesPerTeam;
    const matchCount = Math.ceil(totalSlotsNeeded / 4);
    const appearances = {};
    const partnerCounts = {};
    eligible.forEach((num) => {
      appearances[num] = 0;
      partnerCounts[num] = {};
    });

    const newMatches = [];
    for (let m = 1; m <= matchCount; m++) {
      // Pick 4 teams with fewest appearances so far, shuffled slightly for fairness
      const pool = [...eligible].sort((a, b) => {
        const diff = appearances[a] - appearances[b];
        return diff !== 0 ? diff : Math.random() - 0.5;
      });
      const four = pool.slice(0, 4);

      // Evaluate 3 possible 2v2 splits to minimize repeated partnerships
      const splits = [
        { red: [four[0], four[1]], blue: [four[2], four[3]] },
        { red: [four[0], four[2]], blue: [four[1], four[3]] },
        { red: [four[0], four[3]], blue: [four[1], four[2]] }
      ];
      splits.sort((s1, s2) => {
        const p1 = (partnerCounts[s1.red[0]][s1.red[1]] || 0) + (partnerCounts[s1.blue[0]][s1.blue[1]] || 0);
        const p2 = (partnerCounts[s2.red[0]][s2.red[1]] || 0) + (partnerCounts[s2.blue[0]][s2.blue[1]] || 0);
        return p1 - p2;
      });

      const chosen = splits[0];
      four.forEach((n) => appearances[n]++);
      partnerCounts[chosen.red[0]][chosen.red[1]] = (partnerCounts[chosen.red[0]][chosen.red[1]] || 0) + 1;
      partnerCounts[chosen.red[1]][chosen.red[0]] = (partnerCounts[chosen.red[1]][chosen.red[0]] || 0) + 1;
      partnerCounts[chosen.blue[0]][chosen.blue[1]] = (partnerCounts[chosen.blue[0]][chosen.blue[1]] || 0) + 1;
      partnerCounts[chosen.blue[1]][chosen.blue[0]] = (partnerCounts[chosen.blue[1]][chosen.blue[0]] || 0) + 1;

      newMatches.push({
        id: `Q${m}`,
        label: `Q${m}`,
        round: "QUAL",
        number: m,
        fieldId: state.fields[(m - 1) % Math.max(1, state.fields.length - 1)]?.id || "field_1",
        state: "UNPLAYED",
        red: chosen.red,
        blue: chosen.blue,
        redScore: 0,
        blueScore: 0,
        autonWinner: "none",
        redAwp: false,
        blueAwp: false,
        redDq: false,
        blueDq: false,
        breakdown: null
      });
    }

    state.matches = newMatches;
    if (newMatches[0]) {
      state.liveTimer.matchId = newMatches[0].id;
    }
    if (shouldPersist) {
      persistState(true);
      syncAllViews();
    }
  }

  function computeOverrideBreakdown(b) {
    const rPins = Math.max(0, Number(b.redPins) || 0);
    const rYel = Math.max(0, Number(b.redYellowPins) || 0);
    const rTog = Math.max(0, Number(b.redToggles) || 0);
    const rBonus = Math.max(0, Number(b.redBonus) || 0);

    const bPins = Math.max(0, Number(b.bluePins) || 0);
    const bYel = Math.max(0, Number(b.blueYellowPins) || 0);
    const bTog = Math.max(0, Number(b.blueToggles) || 0);
    const bBonus = Math.max(0, Number(b.blueBonus) || 0);

    let redScore = rPins * 5 + rTog * 10 + (rTog > 0 ? rYel * 10 : 0) + rBonus;
    let blueScore = bPins * 5 + bTog * 10 + (bTog > 0 ? bYel * 10 : 0) + bBonus;

    if (b.autonWinner === "red") redScore += 10;
    else if (b.autonWinner === "blue") blueScore += 10;
    else if (b.autonWinner === "tie") {
      redScore += 5;
      blueScore += 5;
    }

    if (b.redDq) redScore = 0;
    if (b.blueDq) blueScore = 0;

    return { redScore, blueScore };
  }

  /* ------------------------------------------------------------------------
     RANKINGS & SKILLS COMPUTATION
     ------------------------------------------------------------------------ */
  function computeRankings() {
    const map = {};
    state.teams.forEach((t) => {
      map[t.number] = {
        number: t.number,
        name: t.name,
        wp: 0,
        ap: 0,
        sp: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        played: 0,
        totalPoints: 0,
        highScore: 0
      };
    });

    state.matches.forEach((m) => {
      if (m.state !== "SCORED" && m.state !== "SUBMITTED") return;
      const rScore = Number(m.redScore) || 0;
      const bScore = Number(m.blueScore) || 0;
      const rWon = !m.redDq && (m.blueDq || rScore > bScore);
      const bWon = !m.blueDq && (m.redDq || bScore > rScore);
      const isTie = !m.redDq && !m.blueDq && rScore === bScore;
      const spAward = Math.min(rScore, bScore);

      const applyTeam = (num, isRed) => {
        if (!map[num]) return;
        const rec = map[num];
        rec.played++;
        const myScore = isRed ? rScore : bScore;
        rec.totalPoints += myScore;
        if (myScore > rec.highScore) rec.highScore = myScore;

        const won = isRed ? rWon : bWon;
        const dq = isRed ? m.redDq : m.blueDq;
        const awp = isRed ? m.redAwp : m.blueAwp;

        if (!dq) {
          if (won) {
            rec.wins++;
            rec.wp += 2;
          } else if (isTie) {
            rec.ties++;
            rec.wp += 1;
          } else {
            rec.losses++;
          }
          if (awp) rec.wp += 1;
          rec.sp += spAward;

          if (m.autonWinner === (isRed ? "red" : "blue")) rec.ap += 10;
          else if (m.autonWinner === "tie") rec.ap += 5;
        }
      };

      (m.red || []).forEach((n) => applyTeam(n, true));
      (m.blue || []).forEach((n) => applyTeam(n, false));
    });

    const list = Object.values(map).map((r) => ({
      ...r,
      avg: r.played > 0 ? (r.totalPoints / r.played).toFixed(1) : "0.0"
    }));

    list.sort((a, b) => {
      if (b.wp !== a.wp) return b.wp - a.wp;
      if (b.ap !== a.ap) return b.ap - a.ap;
      if (b.sp !== a.sp) return b.sp - a.sp;
      if (b.highScore !== a.highScore) return b.highScore - a.highScore;
      return a.number.localeCompare(b.number);
    });

    return list;
  }

  function computeSkillsStandings() {
    const map = {};
    state.teams.forEach((t) => {
      map[t.number] = {
        number: t.number,
        name: t.name,
        highDriver: 0,
        highProg: 0,
        combined: 0,
        runs: 0
      };
    });

    state.skillsRuns.forEach((run) => {
      if (!map[run.team]) {
        map[run.team] = { number: run.team, name: "", highDriver: 0, highProg: 0, combined: 0, runs: 0 };
      }
      const r = map[run.team];
      r.runs++;
      const sc = Number(run.score) || 0;
      if (run.type === "driver" && sc > r.highDriver) r.highDriver = sc;
      if (run.type === "programming" && sc > r.highProg) r.highProg = sc;
      r.combined = r.highDriver + r.highProg;
    });

    return Object.values(map).sort((a, b) => {
      if (b.combined !== a.combined) return b.combined - a.combined;
      if (b.highProg !== a.highProg) return b.highProg - a.highProg;
      return b.highDriver - a.highDriver;
    });
  }

  /* ------------------------------------------------------------------------
     FIELD CONTROL & LIVE MATCH TIMER ENGINE
     ------------------------------------------------------------------------ */
  function pushHardwareCompetitionState(mode, durationSec) {
    if (!window.V5BrainSerial) return;
    try {
      const st = window.V5BrainSerial.getStatus ? window.V5BrainSerial.getStatus() : null;
      if (st && st.connected && typeof window.V5BrainSerial.setCompetitionMode === "function") {
        window.V5BrainSerial.setCompetitionMode(mode, durationSec);
      }
    } catch (_) {}
  }

  function stopTimerInterval() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function startMatchTimerLoop() {
    stopTimerInterval();
    let endgameBeeped = false;
    timerInterval = setInterval(() => {
      const lt = state.liveTimer;
      if (!lt.running) {
        stopTimerInterval();
        return;
      }

      if (lt.remainingSec > 0) {
        lt.remainingSec = Math.max(0, lt.remainingSec - 1);
        if (lt.phase === "DRIVER" && lt.remainingSec === 20 && !endgameBeeped) {
          endgameBeeped = true;
          playCue("endgame");
        }
      }

      if (lt.remainingSec <= 0) {
        if (lt.phase === "AUTON") {
          lt.running = false;
          lt.phase = "AUTON_PAUSE";
          lt.remainingSec = Number(state.event.driverSeconds) || 105;
          playCue("auton_end");
          pushHardwareCompetitionState("disabled", 0);
          stopTimerInterval();
        } else if (lt.phase === "DRIVER" || lt.phase === "SKILLS") {
          lt.running = false;
          lt.phase = "ENDED";
          lt.remainingSec = 0;
          playCue("match_end");
          pushHardwareCompetitionState("disabled", 0);
          stopTimerInterval();
        }
      }

      persistState(false);
      renderFieldControl();
      if (isStandaloneDisplay) renderStandaloneDisplay();
    }, 1000);
  }

  function handleStartMatch() {
    ensureAudio();
    const lt = state.liveTimer;
    if (lt.mode === "match") {
      if (lt.phase === "IDLE" || lt.phase === "ENDED") {
        lt.phase = "AUTON";
        lt.remainingSec = Number(state.event.autonSeconds) || 15;
        lt.running = true;
        setActiveMatchState("ACTIVE");
        playCue("start");
        pushHardwareCompetitionState("autonomous", lt.remainingSec);
      } else if (!lt.running) {
        lt.running = true;
        playCue("start");
        pushHardwareCompetitionState(lt.phase === "AUTON" ? "autonomous" : "driver", lt.remainingSec);
      }
    } else {
      if (lt.phase === "IDLE" || lt.phase === "ENDED") {
        lt.phase = "SKILLS";
        lt.remainingSec = Number(state.event.skillsSeconds) || 60;
        lt.running = true;
        playCue("start");
        pushHardwareCompetitionState(lt.mode === "prog_skills" ? "autonomous" : "driver", lt.remainingSec);
      } else if (!lt.running) {
        lt.running = true;
        playCue("start");
        pushHardwareCompetitionState(lt.mode === "prog_skills" ? "autonomous" : "driver", lt.remainingSec);
      }
    }
    startMatchTimerLoop();
    persistState(true);
    syncAllViews();
  }

  function handleStartDriverPhase() {
    ensureAudio();
    const lt = state.liveTimer;
    lt.phase = "DRIVER";
    lt.remainingSec = Number(state.event.driverSeconds) || 105;
    lt.running = true;
    playCue("start");
    pushHardwareCompetitionState("driver", lt.remainingSec);
    startMatchTimerLoop();
    persistState(true);
    syncAllViews();
  }

  function handlePauseMatch() {
    state.liveTimer.running = false;
    stopTimerInterval();
    pushHardwareCompetitionState("disabled", 0);
    persistState(true);
    syncAllViews();
  }

  function handleAbortMatch() {
    state.liveTimer.running = false;
    state.liveTimer.phase = "ENDED";
    state.liveTimer.remainingSec = 0;
    stopTimerInterval();
    playCue("abort");
    pushHardwareCompetitionState("disabled", 0);
    persistState(true);
    syncAllViews();
  }

  function handleResetField() {
    stopTimerInterval();
    const lt = state.liveTimer;
    lt.running = false;
    lt.phase = "IDLE";
    lt.autonWinner = "none";
    lt.remainingSec = lt.mode === "match"
      ? (Number(state.event.autonSeconds) || 15)
      : (Number(state.event.skillsSeconds) || 60);
    pushHardwareCompetitionState("disabled", 0);
    persistState(true);
    syncAllViews();
  }

  function setActiveMatchState(newState) {
    const m = findMatchById(state.liveTimer.matchId);
    if (m && (m.state === "UNPLAYED" || m.state === "QUEUED" || m.state === "ON_DECK")) {
      m.state = newState;
    }
  }

  function findMatchById(id) {
    if (!id) return null;
    return state.matches.find((m) => m.id === id) || state.elimMatches.find((m) => m.id === id) || null;
  }

  /* ------------------------------------------------------------------------
     ELIMINATION BRACKET ENGINE
     ------------------------------------------------------------------------ */
  function autoSeedAlliances() {
    const rankings = computeRankings();
    const count = Number(document.getElementById("tmAllianceCountSelect")?.value) || state.event.allianceCount || 8;
    state.event.allianceCount = count;
    const alliances = [];
    for (let i = 0; i < count; i++) {
      const cap = rankings[i] ? rankings[i].number : "";
      const pick = rankings[count * 2 - 1 - i] ? rankings[count * 2 - 1 - i].number : "";
      alliances.push({
        seed: i + 1,
        captain: cap,
        pick: pick
      });
    }
    state.alliances = alliances;
    persistState(true);
    renderBracketView();
  }

  function buildEliminationBracket() {
    if (!state.alliances || state.alliances.length < 4) {
      autoSeedAlliances();
    }
    const count = state.alliances.length;
    const getAllianceObj = (seed) => state.alliances.find((a) => a.seed === seed) || { seed, captain: `Seed ${seed}`, pick: "" };
    const elim = [];

    if (count >= 8) {
      const qfPairs = [[1, 8], [4, 5], [2, 7], [3, 6]];
      qfPairs.forEach(([rSeed, bSeed], idx) => {
        const ra = getAllianceObj(rSeed);
        const ba = getAllianceObj(bSeed);
        elim.push({
          id: `QF-${idx + 1}`,
          label: `QF ${idx + 1}`,
          round: "QF",
          redSeed: rSeed,
          blueSeed: bSeed,
          red: [ra.captain, ra.pick].filter(Boolean),
          blue: [ba.captain, ba.pick].filter(Boolean),
          redScore: 0,
          blueScore: 0,
          winnerSeed: null,
          nextId: idx < 2 ? "SF-1" : "SF-2",
          nextSlot: idx % 2 === 0 ? "red" : "blue",
          state: "UNPLAYED"
        });
      });
      elim.push(
        { id: "SF-1", label: "SF 1", round: "SF", redSeed: null, blueSeed: null, red: ["TBD"], blue: ["TBD"], redScore: 0, blueScore: 0, winnerSeed: null, nextId: "F-1", nextSlot: "red", state: "UNPLAYED" },
        { id: "SF-2", label: "SF 2", round: "SF", redSeed: null, blueSeed: null, red: ["TBD"], blue: ["TBD"], redScore: 0, blueScore: 0, winnerSeed: null, nextId: "F-1", nextSlot: "blue", state: "UNPLAYED" },
        { id: "F-1", label: "Final", round: "F", redSeed: null, blueSeed: null, red: ["TBD"], blue: ["TBD"], redScore: 0, blueScore: 0, winnerSeed: null, nextId: null, nextSlot: null, state: "UNPLAYED" }
      );
    } else {
      const sfPairs = [[1, 4], [2, 3]];
      sfPairs.forEach(([rSeed, bSeed], idx) => {
        const ra = getAllianceObj(rSeed);
        const ba = getAllianceObj(bSeed);
        elim.push({
          id: `SF-${idx + 1}`,
          label: `SF ${idx + 1}`,
          round: "SF",
          redSeed: rSeed,
          blueSeed: bSeed,
          red: [ra.captain, ra.pick].filter(Boolean),
          blue: [ba.captain, ba.pick].filter(Boolean),
          redScore: 0,
          blueScore: 0,
          winnerSeed: null,
          nextId: "F-1",
          nextSlot: idx === 0 ? "red" : "blue",
          state: "UNPLAYED"
        });
      });
      elim.push({ id: "F-1", label: "Final", round: "F", redSeed: null, blueSeed: null, red: ["TBD"], blue: ["TBD"], redScore: 0, blueScore: 0, winnerSeed: null, nextId: null, nextSlot: null, state: "UNPLAYED" });
    }

    state.elimMatches = elim;
    persistState(true);
    renderBracketView();
  }

  function advanceElimWinner(matchId, redScore, blueScore) {
    const m = state.elimMatches.find((x) => x.id === matchId);
    if (!m) return;
    m.redScore = Number(redScore) || 0;
    m.blueScore = Number(blueScore) || 0;
    m.state = "SUBMITTED";
    const redWins = m.redScore >= m.blueScore;
    m.winnerSeed = redWins ? m.redSeed : m.blueSeed;
    const winTeams = redWins ? m.red : m.blue;

    if (m.nextId) {
      const next = state.elimMatches.find((x) => x.id === m.nextId);
      if (next) {
        if (m.nextSlot === "red") {
          next.redSeed = m.winnerSeed;
          next.red = [...winTeams];
        } else {
          next.blueSeed = m.winnerSeed;
          next.blue = [...winTeams];
        }
      }
    }
    persistState(true);
    syncAllViews();
  }

  /* ------------------------------------------------------------------------
     RENDERERS
     ------------------------------------------------------------------------ */
  function syncAllViews() {
    updateSidebarBadges();
    renderFieldControl();
    renderQueueView();
    renderScoringView();
    renderRankingsView();
    renderBracketView();
    renderTeamsView();
    renderSetupView();
    renderDisplayPreview();
    if (isStandaloneDisplay) renderStandaloneDisplay();
  }

  function updateSidebarBadges() {
    const hdrName = document.getElementById("tmHeaderEventName");
    if (hdrName) hdrName.textContent = state.event.name || "Competition Manager";

    const elPhase = document.getElementById("tmSidePhase");
    if (elPhase) elPhase.textContent = state.liveTimer.phase || "IDLE";

    const elMatches = document.getElementById("tmSideMatchCount");
    if (elMatches) elMatches.textContent = String(state.matches.length);

    const scoredCount = state.matches.filter((m) => m.state === "SCORED" || m.state === "SUBMITTED").length;
    const elScored = document.getElementById("tmSideScoredCount");
    if (elScored) elScored.textContent = String(scoredCount);

    const elTeams = document.getElementById("tmSideTeamCount");
    if (elTeams) elTeams.textContent = String(state.teams.length);
  }

  function renderFieldControl() {
    const selField = document.getElementById("tmFieldSelect");
    if (selField) {
      const prev = state.liveTimer.fieldId;
      selField.innerHTML = state.fields.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join("");
      if (prev) selField.value = prev;
    }

    const lt = state.liveTimer;
    document.querySelectorAll("[data-fc-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-fc-mode") === lt.mode);
    });

    const phaseMap = {
      IDLE: "READY ON FIELD",
      AUTON: "AUTONOMOUS PERIOD",
      AUTON_PAUSE: "AUTON COMPLETE · CALL WINNER",
      DRIVER: "DRIVER CONTROL PERIOD",
      SKILLS: lt.mode === "prog_skills" ? "AUTONOMOUS CODING SKILLS" : "DRIVER SKILLS",
      ENDED: "MATCH COMPLETE"
    };

    const elPhaseBadge = document.getElementById("tmFcPhaseBadge");
    if (elPhaseBadge) {
      elPhaseBadge.textContent = lt.phase;
      elPhaseBadge.className = `tm-phase-tag font-mono phase-${lt.phase.toLowerCase()}`;
    }

    const elPhaseTitle = document.getElementById("tmFcPhaseTitle");
    if (elPhaseTitle) elPhaseTitle.textContent = phaseMap[lt.phase] || lt.phase;

    const elDigits = document.getElementById("tmFcTimerDisplay");
    if (elDigits) elDigits.textContent = formatClock(lt.remainingSec);

    const totalForPhase = lt.phase === "DRIVER"
      ? (Number(state.event.driverSeconds) || 105)
      : lt.phase === "SKILLS"
        ? (Number(state.event.skillsSeconds) || 60)
        : (Number(state.event.autonSeconds) || 15);
    const pct = totalForPhase > 0 ? Math.max(0, Math.min(100, (lt.remainingSec / totalForPhase) * 100)) : 0;
    const elBar = document.getElementById("tmFcProgressBar");
    if (elBar) elBar.style.width = `${pct}%`;

    const btnStart = document.getElementById("btnTmStartMatch");
    const btnPause = document.getElementById("btnTmPauseMatch");
    const btnDriver = document.getElementById("btnTmResumeDriver");
    const btnAbort = document.getElementById("btnTmAbortMatch");

    if (btnStart) {
      btnStart.style.display = lt.phase === "AUTON_PAUSE" ? "none" : "inline-flex";
      btnStart.disabled = lt.running;
      btnStart.textContent = lt.running ? "Running..." : (lt.phase === "IDLE" || lt.phase === "ENDED" ? "Start Match" : "Resume");
    }
    if (btnDriver) btnDriver.style.display = lt.phase === "AUTON_PAUSE" ? "inline-flex" : "none";
    if (btnPause) btnPause.disabled = !lt.running;
    if (btnAbort) btnAbort.disabled = lt.phase === "IDLE" || lt.phase === "ENDED";

    document.querySelectorAll(".tm-auton-choice").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-auton") === (lt.autonWinner || "none"));
    });

    const activeMatch = findMatchById(lt.matchId);
    const lblMatch = document.getElementById("tmFcMatchLabel");
    const lblRed = document.getElementById("tmFcRedTeams");
    const lblBlue = document.getElementById("tmFcBlueTeams");
    const lblRedSc = document.getElementById("tmFcRedScore");
    const lblBlueSc = document.getElementById("tmFcBlueScore");

    if (activeMatch) {
      if (lblMatch) lblMatch.textContent = `${activeMatch.label} · ${activeMatch.state}`;
      if (lblRed) lblRed.textContent = (activeMatch.red || []).join(" · ") || "—";
      if (lblBlue) lblBlue.textContent = (activeMatch.blue || []).join(" · ") || "—";
      if (lblRedSc) lblRedSc.textContent = String(activeMatch.redScore || 0);
      if (lblBlueSc) lblBlueSc.textContent = String(activeMatch.blueScore || 0);
    } else {
      if (lblMatch) lblMatch.textContent = "No Match Loaded";
      if (lblRed) lblRed.textContent = "— · —";
      if (lblBlue) lblBlue.textContent = "— · —";
      if (lblRedSc) lblRedSc.textContent = "0";
      if (lblBlueSc) lblBlueSc.textContent = "0";
    }

    const pending = state.matches.filter((m) => m.state !== "SCORED" && m.state !== "SUBMITTED");
    const elQCount = document.getElementById("tmFcQueueCount");
    if (elQCount) elQCount.textContent = `${pending.length} pending`;

    const miniList = document.getElementById("tmFcMiniQueue");
    if (miniList) {
      if (pending.length === 0) {
        miniList.innerHTML = `<div class="tm-empty-mini">No pending matches. Generate a schedule in Match Queue.</div>`;
      } else {
        miniList.innerHTML = pending.slice(0, 6).map((m) => `
          <div class="tm-mini-q-row ${m.id === lt.matchId ? "is-loaded" : ""}">
            <div class="tm-mini-q-main">
              <strong class="font-mono">${escapeHtml(m.label)}</strong>
              <span class="tm-state-pill state-${m.state.toLowerCase()}">${escapeHtml(m.state)}</span>
            </div>
            <div class="tm-mini-q-teams font-mono">
              <span class="red-txt">${escapeHtml((m.red || []).join(", "))}</span>
              <span class="vs-txt">vs</span>
              <span class="blue-txt">${escapeHtml((m.blue || []).join(", "))}</span>
            </div>
            <button type="button" class="suite-btn-xs" data-load-match="${escapeHtml(m.id)}">Load</button>
          </div>
        `).join("");
      }
    }
  }

  function renderQueueView() {
    const tbody = document.getElementById("tmQueueTableBody");
    if (!tbody) return;
    const search = (document.getElementById("tmQueueSearch")?.value || "").trim().toLowerCase();

    const filtered = state.matches.filter((m) => {
      if (queueFilter === "pending" && (m.state === "SCORED" || m.state === "SUBMITTED")) return false;
      if (queueFilter === "active" && !["QUEUED", "ON_DECK", "ACTIVE"].includes(m.state)) return false;
      if (queueFilter === "scored" && !["SCORED", "SUBMITTED"].includes(m.state)) return false;
      if (search) {
        const hay = `${m.label} ${(m.red || []).join(" ")} ${(m.blue || []).join(" ")}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="tm-empty-cell">No matches found. Add teams and click "Generate Qual Schedule" or "Load Sample Event".</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((m) => `
      <tr>
        <td class="font-mono"><strong>${escapeHtml(m.label)}</strong></td>
        <td><span class="tm-state-pill state-${m.state.toLowerCase()}">${escapeHtml(m.state)}</span></td>
        <td class="font-mono red-txt">${escapeHtml((m.red || []).join(" · "))}</td>
        <td class="font-mono blue-txt">${escapeHtml((m.blue || []).join(" · "))}</td>
        <td class="font-mono tabular-nums">${m.state === "SCORED" || m.state === "SUBMITTED" ? `${m.redScore} – ${m.blueScore}` : "—"}</td>
        <td class="font-mono">${escapeHtml((m.autonWinner || "none").toUpperCase())}</td>
        <td class="text-right tm-row-actions">
          <button type="button" class="suite-btn-xs" data-q-state="${escapeHtml(m.id)}:QUEUED">Queue</button>
          <button type="button" class="suite-btn-xs" data-q-state="${escapeHtml(m.id)}:ON_DECK">On Deck</button>
          <button type="button" class="suite-btn-xs" data-load-match="${escapeHtml(m.id)}">Load Field</button>
          <button type="button" class="suite-btn-xs" data-score-match="${escapeHtml(m.id)}">Score</button>
        </td>
      </tr>
    `).join("");
  }

  function renderScoringView() {
    const sel = document.getElementById("tmSkMatchSelect");
    if (sel) {
      const prev = sel.value || state.liveTimer.matchId || (state.matches[0]?.id || "");
      if (state.matches.length === 0) {
        sel.innerHTML = `<option value="">No matches scheduled</option>`;
      } else {
        sel.innerHTML = state.matches.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)} — ${(m.red || []).join("/")} vs ${(m.blue || []).join("/")} (${m.state})</option>`).join("");
        if (state.matches.some((m) => m.id === prev)) {
          sel.value = prev;
        }
      }
      populateScoreSheetForMatch(sel.value);
    }

    const skTeamSel = document.getElementById("tmSkillsTeamSelect");
    if (skTeamSel) {
      const prevT = skTeamSel.value;
      skTeamSel.innerHTML = state.teams.map((t) => `<option value="${escapeHtml(t.number)}">${escapeHtml(t.number)} — ${escapeHtml(t.name)}</option>`).join("");
      if (prevT && state.teams.some((t) => t.number === prevT)) skTeamSel.value = prevT;
    }

    const skLogBody = document.getElementById("tmSkillsLogBody");
    const skCount = document.getElementById("tmSkillsRunCount");
    if (skCount) skCount.textContent = `${state.skillsRuns.length} runs`;
    if (skLogBody) {
      if (state.skillsRuns.length === 0) {
        skLogBody.innerHTML = `<tr><td colspan="6" class="tm-empty-cell">No skills runs recorded yet.</td></tr>`;
      } else {
        skLogBody.innerHTML = state.skillsRuns.slice().reverse().map((r) => `
          <tr>
            <td class="font-mono"><strong>${escapeHtml(r.team)}</strong></td>
            <td>${r.type === "programming" ? "Autonomous Coding" : "Driver Skills"}</td>
            <td class="font-mono tabular-nums">#${r.attempt || 1}</td>
            <td class="font-mono tabular-nums"><strong>${r.score}</strong></td>
            <td class="font-mono tabular-nums">${r.stopSec || 0}s</td>
            <td class="text-right"><button type="button" class="suite-btn-xs danger" data-del-skill="${escapeHtml(r.id)}">Remove</button></td>
          </tr>
        `).join("");
      }
    }
  }

  function populateScoreSheetForMatch(matchId) {
    const m = findMatchById(matchId);
    const lblRed = document.getElementById("tmSkRedTeams");
    const lblBlue = document.getElementById("tmSkBlueTeams");
    if (!m) {
      if (lblRed) lblRed.textContent = "— · —";
      if (lblBlue) lblBlue.textContent = "— · —";
      return;
    }
    if (lblRed) lblRed.textContent = (m.red || []).join(" · ");
    if (lblBlue) lblBlue.textContent = (m.blue || []).join(" · ");

    const b = m.breakdown || {};
    setVal("skRedPins", b.redPins ?? 0);
    setVal("skRedYellowPins", b.redYellowPins ?? 0);
    setVal("skRedToggles", b.redToggles ?? 0);
    setVal("skRedBonus", b.redBonus ?? 0);
    setVal("skBluePins", b.bluePins ?? 0);
    setVal("skBlueYellowPins", b.blueYellowPins ?? 0);
    setVal("skBlueToggles", b.blueToggles ?? 0);
    setVal("skBlueBonus", b.blueBonus ?? 0);
    setVal("skRedManualScore", m.redScore ?? 0);
    setVal("skBlueManualScore", m.blueScore ?? 0);

    const autonSel = document.getElementById("tmSkAutonWinner");
    if (autonSel) autonSel.value = m.autonWinner || "none";

    const modeSel = document.getElementById("tmSkRulesMode");
    if (modeSel && b.mode) modeSel.value = b.mode;
    toggleScoreModeUi();

    setChecked("skRedAwp", Boolean(m.redAwp));
    setChecked("skBlueAwp", Boolean(m.blueAwp));
    setChecked("skRedDq", Boolean(m.redDq));
    setChecked("skBlueDq", Boolean(m.blueDq));
    recalcScoreSheetPreview();
  }

  function toggleScoreModeUi() {
    const mode = document.getElementById("tmSkRulesMode")?.value || "override";
    const isManual = mode === "manual";
    ["tmSkOverrideRed", "tmSkOverrideBlue"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = isManual ? "none" : "flex";
    });
    ["tmSkManualRed", "tmSkManualBlue"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = isManual ? "flex" : "none";
    });
  }

  function readScoreSheetInputs() {
    const mode = document.getElementById("tmSkRulesMode")?.value || "override";
    const autonWinner = document.getElementById("tmSkAutonWinner")?.value || "none";
    const redAwp = Boolean(document.getElementById("skRedAwp")?.checked);
    const blueAwp = Boolean(document.getElementById("skBlueAwp")?.checked);
    const redDq = Boolean(document.getElementById("skRedDq")?.checked);
    const blueDq = Boolean(document.getElementById("skBlueDq")?.checked);

    const breakdown = {
      mode,
      redPins: numVal("skRedPins"),
      redYellowPins: numVal("skRedYellowPins"),
      redToggles: numVal("skRedToggles"),
      redBonus: numVal("skRedBonus"),
      bluePins: numVal("skBluePins"),
      blueYellowPins: numVal("skBlueYellowPins"),
      blueToggles: numVal("skBlueToggles"),
      blueBonus: numVal("skBlueBonus"),
      autonWinner,
      redDq,
      blueDq
    };

    let redScore = 0;
    let blueScore = 0;
    if (mode === "manual") {
      redScore = redDq ? 0 : numVal("skRedManualScore");
      blueScore = blueDq ? 0 : numVal("skBlueManualScore");
    } else {
      const calc = computeOverrideBreakdown(breakdown);
      redScore = calc.redScore;
      blueScore = calc.blueScore;
    }

    return { breakdown, redScore, blueScore, autonWinner, redAwp, blueAwp, redDq, blueDq };
  }

  function recalcScoreSheetPreview() {
    const res = readScoreSheetInputs();
    const rTot = document.getElementById("tmSkRedTotal");
    const bTot = document.getElementById("tmSkBlueTotal");
    if (rTot) rTot.textContent = String(res.redScore);
    if (bTot) bTot.textContent = String(res.blueScore);
  }

  function renderRankingsView() {
    const divLbl = document.getElementById("tmRankDivisionLabel");
    if (divLbl) divLbl.textContent = state.event.division || "Default Division";

    const rankings = computeRankings();
    const tbody = document.getElementById("tmRankingsBody");
    if (tbody) {
      if (rankings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="tm-empty-cell">No teams registered yet.</td></tr>`;
      } else {
        tbody.innerHTML = rankings.map((r, idx) => `
          <tr>
            <td class="font-mono tabular-nums"><strong>${idx + 1}</strong></td>
            <td><strong class="font-mono">${escapeHtml(r.number)}</strong> <span class="tm-muted-meta">${escapeHtml(r.name)}</span></td>
            <td class="font-mono tabular-nums"><strong>${r.wp}</strong></td>
            <td class="font-mono tabular-nums">${r.ap}</td>
            <td class="font-mono tabular-nums">${r.sp}</td>
            <td class="font-mono tabular-nums">${r.wins}-${r.losses}-${r.ties}</td>
            <td class="font-mono tabular-nums">${r.avg}</td>
            <td class="font-mono tabular-nums">${r.highScore}</td>
          </tr>
        `).join("");
      }
    }

    const skills = computeSkillsStandings();
    const skBody = document.getElementById("tmSkillsStandingsBody");
    if (skBody) {
      if (skills.length === 0) {
        skBody.innerHTML = `<tr><td colspan="6" class="tm-empty-cell">No skills entries yet.</td></tr>`;
      } else {
        skBody.innerHTML = skills.map((s, idx) => `
          <tr>
            <td class="font-mono tabular-nums"><strong>${idx + 1}</strong></td>
            <td><strong class="font-mono">${escapeHtml(s.number)}</strong> <span class="tm-muted-meta">${escapeHtml(s.name)}</span></td>
            <td class="font-mono tabular-nums"><strong>${s.combined}</strong></td>
            <td class="font-mono tabular-nums">${s.highDriver}</td>
            <td class="font-mono tabular-nums">${s.highProg}</td>
            <td class="font-mono tabular-nums">${s.runs}</td>
          </tr>
        `).join("");
      }
    }
  }

  function renderBracketView() {
    const alliancesEl = document.getElementById("tmAlliancesList");
    const treeEl = document.getElementById("tmBracketTree");
    const champEl = document.getElementById("tmChampionBanner");
    const countSel = document.getElementById("tmAllianceCountSelect");
    if (countSel) countSel.value = String(state.event.allianceCount || 8);

    if (alliancesEl) {
      if (!state.alliances || state.alliances.length === 0) {
        alliancesEl.innerHTML = `<div class="tm-empty-cell">Click "Auto-Seed From Rankings" to populate tournament alliances.</div>`;
      } else {
        const teamOptions = state.teams.map((t) => `<option value="${escapeHtml(t.number)}">${escapeHtml(t.number)}</option>`).join("");
        alliancesEl.innerHTML = state.alliances.map((a, idx) => `
          <div class="tm-alliance-seed-row">
            <span class="font-mono tm-seed-num">#${a.seed}</span>
            <select data-alliance-cap="${idx}" class="font-mono"><option value="">Captain</option>${teamOptions}</select>
            <select data-alliance-pick="${idx}" class="font-mono"><option value="">Pick 1</option>${teamOptions}</select>
          </div>
        `).join("");
        state.alliances.forEach((a, idx) => {
          const cSel = alliancesEl.querySelector(`[data-alliance-cap="${idx}"]`);
          const pSel = alliancesEl.querySelector(`[data-alliance-pick="${idx}"]`);
          if (cSel) cSel.value = a.captain || "";
          if (pSel) pSel.value = a.pick || "";
        });
      }
    }

    if (treeEl) {
      if (!state.elimMatches || state.elimMatches.length === 0) {
        treeEl.innerHTML = `<div class="tm-empty-cell">Generate the elimination bracket once alliances are drafted.</div>`;
        if (champEl) champEl.style.display = "none";
      } else {
        const rounds = ["QF", "SF", "F"].filter((r) => state.elimMatches.some((m) => m.round === r));
        treeEl.innerHTML = rounds.map((r) => {
          const ms = state.elimMatches.filter((m) => m.round === r);
          return `
            <div class="tm-bracket-round">
              <div class="tm-bracket-round-title font-mono">${r === "QF" ? "Quarterfinals" : r === "SF" ? "Semifinals" : "Finals"}</div>
              ${ms.map((m) => `
                <div class="tm-bracket-card" data-elim-open="${escapeHtml(m.id)}">
                  <div class="tm-bracket-card-head">
                    <span class="font-mono">${escapeHtml(m.label)}</span>
                    <span class="tm-muted-meta font-mono">${escapeHtml(m.state)}</span>
                  </div>
                  <div class="tm-bracket-slot red ${m.winnerSeed && m.winnerSeed === m.redSeed ? "winner" : ""}">
                    <span class="font-mono">${m.redSeed ? `#${m.redSeed}` : ""} ${escapeHtml((m.red || []).join(" · "))}</span>
                    <strong class="font-mono tabular-nums">${m.state === "SUBMITTED" ? m.redScore : "—"}</strong>
                  </div>
                  <div class="tm-bracket-slot blue ${m.winnerSeed && m.winnerSeed === m.blueSeed ? "winner" : ""}">
                    <span class="font-mono">${m.blueSeed ? `#${m.blueSeed}` : ""} ${escapeHtml((m.blue || []).join(" · "))}</span>
                    <strong class="font-mono tabular-nums">${m.state === "SUBMITTED" ? m.blueScore : "—"}</strong>
                  </div>
                </div>
              `).join("")}
            </div>
          `;
        }).join("");

        const finalMatch = state.elimMatches.find((m) => m.round === "F" && m.state === "SUBMITTED" && m.winnerSeed);
        if (champEl) {
          if (finalMatch) {
            const winA = state.alliances.find((a) => a.seed === finalMatch.winnerSeed);
            champEl.style.display = "inline-flex";
            champEl.textContent = `Champion: Alliance #${finalMatch.winnerSeed} (${winA ? [winA.captain, winA.pick].filter(Boolean).join(" & ") : ""})`;
          } else {
            champEl.style.display = "none";
          }
        }
      }
    }
  }

  function renderTeamsView() {
    const total = state.teams.length;
    const checked = state.teams.filter((t) => t.checkedIn).length;
    const passed = state.teams.filter((t) => t.inspectionStatus === "Passed").length;
    const pending = total - passed;

    setText("tmStatTotalTeams", total);
    setText("tmStatCheckedIn", checked);
    setText("tmStatInspPassed", passed);
    setText("tmStatInspPending", pending);

    const tbody = document.getElementById("tmTeamsTableBody");
    if (!tbody) return;
    const search = (document.getElementById("tmTeamSearch")?.value || "").trim().toLowerCase();

    const filtered = state.teams.filter((t) => {
      if (teamFilter !== "all" && t.inspectionStatus !== teamFilter) return false;
      if (search) {
        const hay = `${t.number} ${t.name} ${t.org} ${t.location}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="tm-empty-cell">No teams match the current filter. Add teams or load the sample event.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((t) => {
      const realIdx = state.teams.indexOf(t);
      const inspClass = t.inspectionStatus === "Passed" ? "passed" : t.inspectionStatus === "Partial" ? "partial" : "not-started";
      return `
        <tr>
          <td class="font-mono"><strong>${escapeHtml(t.number)}</strong></td>
          <td>${escapeHtml(t.name)}</td>
          <td class="tm-muted-meta">${escapeHtml(t.org || "—")}</td>
          <td>
            <button type="button" class="tm-checkin-btn ${t.checkedIn ? "on" : ""}" data-toggle-checkin="${realIdx}">
              ${t.checkedIn ? "Checked In" : "Not Checked In"}
            </button>
          </td>
          <td>
            <button type="button" class="tm-insp-pill ${inspClass}" data-open-insp="${realIdx}">
              ${escapeHtml(t.inspectionStatus || "Not Started")}
            </button>
          </td>
          <td class="text-right tm-row-actions">
            <button type="button" class="suite-btn-xs" data-open-insp="${realIdx}">Inspect</button>
            <button type="button" class="suite-btn-xs" data-edit-team="${realIdx}">Edit</button>
            <button type="button" class="suite-btn-xs danger" data-del-team="${realIdx}">Delete</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  function renderSetupView() {
    setVal("tmCfgName", state.event.name || "");
    setVal("tmCfgSku", state.event.sku || "");
    setVal("tmCfgDivision", state.event.division || "");
    setVal("tmCfgDate", state.event.date || "");
    setVal("tmCfgLocation", state.event.location || "");
    setVal("tmCfgAutonSec", state.event.autonSeconds || 15);
    setVal("tmCfgDriverSec", state.event.driverSeconds || 105);
    setVal("tmCfgSkillsSec", state.event.skillsSeconds || 60);
    setVal("tmDwabHostInput", state.dwabBridge?.host || "http://localhost:8080");
  }

  /* ------------------------------------------------------------------------
     AUDIENCE & PIT DISPLAY RENDERERS
     ------------------------------------------------------------------------ */
  function buildAudienceHtml() {
    const mode = state.liveTimer.displayMode || "match";
    if (mode === "rankings") {
      const rankings = computeRankings().slice(0, 12);
      return `
        <div class="tm-disp-board">
          <div class="tm-disp-board-title">QUALIFICATION RANKINGS · ${escapeHtml(state.event.division)}</div>
          <table class="tm-disp-table">
            <thead><tr><th>Rank</th><th>Team</th><th>WP</th><th>AP</th><th>SP</th><th>W-L-T</th><th>High</th></tr></thead>
            <tbody>
              ${rankings.map((r, i) => `
                <tr>
                  <td class="font-mono">${i + 1}</td>
                  <td><strong class="font-mono">${escapeHtml(r.number)}</strong> ${escapeHtml(r.name)}</td>
                  <td class="font-mono">${r.wp}</td>
                  <td class="font-mono">${r.ap}</td>
                  <td class="font-mono">${r.sp}</td>
                  <td class="font-mono">${r.wins}-${r.losses}-${r.ties}</td>
                  <td class="font-mono">${r.highScore}</td>
                </tr>
              `).join("") || `<tr><td colspan="7">No rankings recorded yet.</td></tr>`}
            </tbody>
          </table>
        </div>`;
    }

    if (mode === "skills") {
      const skills = computeSkillsStandings().slice(0, 10);
      return `
        <div class="tm-disp-board">
          <div class="tm-disp-board-title">ROBOT SKILLS STANDINGS</div>
          <table class="tm-disp-table">
            <thead><tr><th>Rank</th><th>Team</th><th>Combined</th><th>Driver</th><th>Programming</th></tr></thead>
            <tbody>
              ${skills.map((s, i) => `
                <tr>
                  <td class="font-mono">${i + 1}</td>
                  <td><strong class="font-mono">${escapeHtml(s.number)}</strong> ${escapeHtml(s.name)}</td>
                  <td class="font-mono"><strong>${s.combined}</strong></td>
                  <td class="font-mono">${s.highDriver}</td>
                  <td class="font-mono">${s.highProg}</td>
                </tr>
              `).join("") || `<tr><td colspan="5">No skills runs yet.</td></tr>`}
            </tbody>
          </table>
        </div>`;
    }

    if (mode === "bracket") {
      const elims = state.elimMatches || [];
      return `
        <div class="tm-disp-board">
          <div class="tm-disp-board-title">ELIMINATION BRACKET</div>
          <div class="tm-disp-elim-grid">
            ${elims.map((m) => `
              <div class="tm-disp-elim-card">
                <div class="font-mono tm-muted-meta">${escapeHtml(m.label)} · ${escapeHtml(m.state)}</div>
                <div class="red-txt font-mono">R: ${escapeHtml((m.red || []).join(", "))} (${m.redScore})</div>
                <div class="blue-txt font-mono">B: ${escapeHtml((m.blue || []).join(", "))} (${m.blueScore})</div>
              </div>
            `).join("") || `<div>Elimination bracket not generated yet.</div>`}
          </div>
        </div>`;
    }

    const lt = state.liveTimer;
    const m = findMatchById(lt.matchId);
    return `
      <div class="tm-disp-match-stage">
        <div class="tm-disp-meta font-mono">
          <span>${escapeHtml(m ? m.label : "STANDBY")}</span>
          <span>${escapeHtml(lt.phase)}</span>
        </div>
        <div class="tm-disp-clock font-mono tabular-nums">${formatClock(lt.remainingSec)}</div>
        <div class="tm-disp-alliances">
          <div class="tm-disp-side red">
            <div class="tm-disp-side-lbl">RED ALLIANCE</div>
            <div class="tm-disp-teams font-mono">${escapeHtml(m ? (m.red || []).join("  ·  ") : "—  ·  —")}</div>
            <div class="tm-disp-score font-mono tabular-nums">${m ? m.redScore : 0}</div>
          </div>
          <div class="tm-disp-side blue">
            <div class="tm-disp-side-lbl">BLUE ALLIANCE</div>
            <div class="tm-disp-teams font-mono">${escapeHtml(m ? (m.blue || []).join("  ·  ") : "—  ·  —")}</div>
            <div class="tm-disp-score font-mono tabular-nums">${m ? m.blueScore : 0}</div>
          </div>
        </div>
      </div>
    `;
  }

  function buildPitHtml() {
    const pending = state.matches.filter((m) => m.state !== "SCORED" && m.state !== "SUBMITTED").slice(0, 8);
    const rankings = computeRankings().slice(0, 10);
    return `
      <div class="tm-pit-grid">
        <div class="tm-disp-board">
          <div class="tm-disp-board-title">UPCOMING MATCH QUEUE</div>
          <table class="tm-disp-table">
            <thead><tr><th>Match</th><th>Status</th><th>Red Alliance</th><th>Blue Alliance</th></tr></thead>
            <tbody>
              ${pending.map((m) => `
                <tr>
                  <td class="font-mono"><strong>${escapeHtml(m.label)}</strong></td>
                  <td class="font-mono">${escapeHtml(m.state)}</td>
                  <td class="font-mono red-txt">${escapeHtml((m.red || []).join(", "))}</td>
                  <td class="font-mono blue-txt">${escapeHtml((m.blue || []).join(", "))}</td>
                </tr>
              `).join("") || `<tr><td colspan="4">Queue empty.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="tm-disp-board">
          <div class="tm-disp-board-title">TOP 10 RANKINGS</div>
          <table class="tm-disp-table">
            <thead><tr><th>#</th><th>Team</th><th>WP</th><th>AP</th><th>SP</th><th>W-L-T</th></tr></thead>
            <tbody>
              ${rankings.map((r, i) => `
                <tr>
                  <td class="font-mono">${i + 1}</td>
                  <td class="font-mono"><strong>${escapeHtml(r.number)}</strong></td>
                  <td class="font-mono">${r.wp}</td>
                  <td class="font-mono">${r.ap}</td>
                  <td class="font-mono">${r.sp}</td>
                  <td class="font-mono">${r.wins}-${r.losses}-${r.ties}</td>
                </tr>
              `).join("") || `<tr><td colspan="6">No rankings yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderDisplayPreview() {
    document.querySelectorAll("#tmAudienceModePicker [data-disp-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-disp-mode") === (state.liveTimer.displayMode || "match"));
    });
    const el = document.getElementById("tmDisplayPreviewFrame");
    if (el) el.innerHTML = buildAudienceHtml();
  }

  function renderStandaloneDisplay() {
    const titleEl = document.getElementById("tmDispEventTitle");
    const badgeEl = document.getElementById("tmDispBadge");
    const bodyEl = document.getElementById("tmStandaloneBody");
    if (titleEl) titleEl.textContent = state.event.name || "V5RC Tournament";
    if (badgeEl) badgeEl.textContent = standaloneMode === "pit" ? "PIT DISPLAY" : "AUDIENCE DISPLAY";
    if (bodyEl) {
      bodyEl.innerHTML = standaloneMode === "pit" ? buildPitHtml() : buildAudienceHtml();
    }
  }

  /* ------------------------------------------------------------------------
     MODALS & FORMS
     ------------------------------------------------------------------------ */
  function openTeamModal(idx = -1) {
    const modal = document.getElementById("tmTeamModal");
    if (!modal) return;
    setVal("tmEditTeamIdx", idx);
    if (idx >= 0 && state.teams[idx]) {
      const t = state.teams[idx];
      setText("tmTeamModalTitle", `Edit Team ${t.number}`);
      setVal("tmInTeamNum", t.number);
      setVal("tmInTeamName", t.name);
      setVal("tmInTeamOrg", t.org || "");
      setVal("tmInTeamLoc", t.location || "");
    } else {
      setText("tmTeamModalTitle", "Add Team");
      setVal("tmInTeamNum", "");
      setVal("tmInTeamName", "");
      setVal("tmInTeamOrg", "");
      setVal("tmInTeamLoc", "");
    }
    modal.hidden = false;
  }

  function openInspectionModal(idx) {
    const t = state.teams[idx];
    if (!t) return;
    inspTeamIndex = idx;
    const modal = document.getElementById("tmInspModal");
    if (!modal) return;
    setText("tmInspModalTitle", `Inspection: ${t.number} — ${t.name}`);
    const checks = t.inspectionChecklist || {};
    modal.querySelectorAll("[data-insp]").forEach((cb) => {
      const k = cb.getAttribute("data-insp");
      cb.checked = Boolean(checks[k]);
    });
    setVal("tmInspInspector", t.inspector || "");
    setVal("tmInspStatusSelect", t.inspectionStatus || "Not Started");
    setVal("tmInspNotes", t.inspectionNotes || "");
    modal.hidden = false;
  }

  function openElimScoreModal(elimId) {
    const m = state.elimMatches.find((x) => x.id === elimId);
    if (!m) return;
    activeElimId = elimId;
    setText("tmElimModalTitle", `Score ${m.label}`);
    setText("tmElimRedLbl", `Red (${(m.red || []).join(", ")})`);
    setText("tmElimBlueLbl", `Blue (${(m.blue || []).join(", ")})`);
    setVal("tmElimRedScore", m.redScore || 0);
    setVal("tmElimBlueScore", m.blueScore || 0);
    const modal = document.getElementById("tmElimScoreModal");
    if (modal) modal.hidden = false;
  }

  /* ------------------------------------------------------------------------
     DOM HELPERS & EVENT BINDING
     ------------------------------------------------------------------------ */
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }
  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = String(val);
  }
  function setChecked(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(val);
  }
  function numVal(id) {
    const el = document.getElementById(id);
    return Math.max(0, Number(el?.value) || 0);
  }

  function switchTmView(viewName) {
    activeView = viewName;
    document.querySelectorAll(".tm-nav-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-tm-view") === viewName);
    });
    document.querySelectorAll(".tm-view").forEach((v) => {
      v.classList.toggle("active", v.id === `tmView${viewName.charAt(0).toUpperCase()}${viewName.slice(1)}`);
    });
  }

  function bindBrainStatus() {
    const btnConnect = document.getElementById("btnTmConnectBrain");
    const lblStatus = document.getElementById("tmBrainStatusLabel");
    const indicator = document.getElementById("tmBrainIndicator");
    const hwDetail = document.getElementById("tmHwBridgeDetail");

    const updateBrainUi = () => {
      if (!window.V5BrainSerial) return;
      const st = window.V5BrainSerial.getStatus();
      if (st.connected) {
        if (lblStatus) lblStatus.textContent = st.controllerConnected ? "Controller USB Linked" : "V5 Brain Linked";
        if (indicator) indicator.className = "status-indicator online";
        if (hwDetail) hwDetail.textContent = `Connected (${st.name || "V5 Link"}). Match timer automatically pushes Auton/Driver/Disabled states.`;
      } else {
        if (lblStatus) lblStatus.textContent = "Brain: Offline";
        if (indicator) indicator.className = "status-indicator";
        if (hwDetail) hwDetail.textContent = "Connect a V5 Controller via USB in the top bar to automatically push Disabled / Auton / Driver packets during the match timer.";
      }
    };

    if (window.V5BrainSerial && typeof window.V5BrainSerial.onStatusChange === "function") {
      window.V5BrainSerial.onStatusChange(updateBrainUi);
    }

    btnConnect?.addEventListener("click", async () => {
      if (!window.V5BrainSerial) return;
      const st = window.V5BrainSerial.getStatus();
      if (st.connected) {
        await window.V5BrainSerial.disconnect();
      } else {
        await window.V5BrainSerial.connect();
      }
      updateBrainUi();
    });

    document.getElementById("btnTmHwAuton")?.addEventListener("click", () => {
      pushHardwareCompetitionState("autonomous", Number(state.event.autonSeconds) || 15);
    });
    document.getElementById("btnTmHwDriver")?.addEventListener("click", () => {
      pushHardwareCompetitionState("driver", Number(state.event.driverSeconds) || 105);
    });
    document.getElementById("btnTmHwDisable")?.addEventListener("click", () => {
      pushHardwareCompetitionState("disabled", 0);
    });
  }

  function bindEvents() {
    // Sidebar section switch
    document.querySelectorAll("[data-tm-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTmView(btn.getAttribute("data-tm-view"));
      });
    });

    // Audio mute toggle
    const btnMute = document.getElementById("btnTmMuteAudio");
    btnMute?.addEventListener("click", () => {
      audioMuted = !audioMuted;
      btnMute.textContent = audioMuted ? "Audio: Off" : "Audio: On";
    });

    // Quick sample event loader
    document.getElementById("btnTmLoadSampleQuick")?.addEventListener("click", loadSampleEvent);
    document.getElementById("btnTmLoadSample")?.addEventListener("click", loadSampleEvent);

    // Field Control actions
    document.getElementById("tmFieldSelect")?.addEventListener("change", (e) => {
      state.liveTimer.fieldId = e.target.value;
      persistState(true);
    });

    document.querySelectorAll("[data-fc-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.liveTimer.running) return;
        const m = btn.getAttribute("data-fc-mode");
        state.liveTimer.mode = m;
        state.liveTimer.phase = "IDLE";
        state.liveTimer.remainingSec = m === "match"
          ? (Number(state.event.autonSeconds) || 15)
          : (Number(state.event.skillsSeconds) || 60);
        persistState(true);
        syncAllViews();
      });
    });

    document.getElementById("btnTmStartMatch")?.addEventListener("click", handleStartMatch);
    document.getElementById("btnTmPauseMatch")?.addEventListener("click", handlePauseMatch);
    document.getElementById("btnTmResumeDriver")?.addEventListener("click", handleStartDriverPhase);
    document.getElementById("btnTmAbortMatch")?.addEventListener("click", handleAbortMatch);
    document.getElementById("btnTmResetField")?.addEventListener("click", handleResetField);

    document.querySelectorAll(".tm-auton-choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        const winner = btn.getAttribute("data-auton");
        state.liveTimer.autonWinner = winner;
        const activeM = findMatchById(state.liveTimer.matchId);
        if (activeM) {
          activeM.autonWinner = winner;
        }
        persistState(true);
        syncAllViews();
      });
    });

    document.getElementById("btnTmQueueNextMatch")?.addEventListener("click", () => {
      const next = state.matches.find((m) => m.state !== "SCORED" && m.state !== "SUBMITTED");
      if (!next) return;
      state.liveTimer.matchId = next.id;
      handleResetField();
    });

    document.getElementById("btnTmOpenLoadedScore")?.addEventListener("click", () => {
      const mid = state.liveTimer.matchId;
      switchTmView("scoring");
      if (mid) {
        setVal("tmSkMatchSelect", mid);
        populateScoreSheetForMatch(mid);
      }
    });

    // Global delegated clicks for queue/teams/bracket
    document.addEventListener("click", (e) => {
      const loadBtn = e.target.closest("[data-load-match]");
      if (loadBtn) {
        const id = loadBtn.getAttribute("data-load-match");
        state.liveTimer.matchId = id;
        const m = findMatchById(id);
        if (m && m.state === "UNPLAYED") m.state = "QUEUED";
        handleResetField();
        switchTmView("field");
        return;
      }

      const scoreBtn = e.target.closest("[data-score-match]");
      if (scoreBtn) {
        const id = scoreBtn.getAttribute("data-score-match");
        switchTmView("scoring");
        setVal("tmSkMatchSelect", id);
        populateScoreSheetForMatch(id);
        return;
      }

      const qStateBtn = e.target.closest("[data-q-state]");
      if (qStateBtn) {
        const [id, st] = qStateBtn.getAttribute("data-q-state").split(":");
        const m = findMatchById(id);
        if (m) {
          m.state = st;
          persistState(true);
          syncAllViews();
        }
        return;
      }

      const stepBtn = e.target.closest("[data-step]");
      if (stepBtn) {
        const [key, deltaStr] = stepBtn.getAttribute("data-step").split(":");
        const idMap = {
          redPins: "skRedPins",
          redYellowPins: "skRedYellowPins",
          redToggles: "skRedToggles",
          bluePins: "skBluePins",
          blueYellowPins: "skBlueYellowPins",
          blueToggles: "skBlueToggles"
        };
        const input = document.getElementById(idMap[key]);
        if (input) {
          const max = Number(input.max) || 99;
          const next = Math.max(0, Math.min(max, (Number(input.value) || 0) + Number(deltaStr)));
          input.value = String(next);
          recalcScoreSheetPreview();
        }
        return;
      }

      const chkBtn = e.target.closest("[data-toggle-checkin]");
      if (chkBtn) {
        const idx = Number(chkBtn.getAttribute("data-toggle-checkin"));
        if (state.teams[idx]) {
          state.teams[idx].checkedIn = !state.teams[idx].checkedIn;
          persistState(true);
          renderTeamsView();
        }
        return;
      }

      const inspBtn = e.target.closest("[data-open-insp]");
      if (inspBtn) {
        openInspectionModal(Number(inspBtn.getAttribute("data-open-insp")));
        return;
      }

      const editT = e.target.closest("[data-edit-team]");
      if (editT) {
        openTeamModal(Number(editT.getAttribute("data-edit-team")));
        return;
      }

      const delT = e.target.closest("[data-del-team]");
      if (delT) {
        const idx = Number(delT.getAttribute("data-del-team"));
        if (state.teams[idx] && confirm(`Remove team ${state.teams[idx].number}?`)) {
          state.teams.splice(idx, 1);
          persistState(true);
          syncAllViews();
        }
        return;
      }

      const delSkill = e.target.closest("[data-del-skill]");
      if (delSkill) {
        const id = delSkill.getAttribute("data-del-skill");
        state.skillsRuns = state.skillsRuns.filter((r) => r.id !== id);
        persistState(true);
        syncAllViews();
        return;
      }

      const elimCard = e.target.closest("[data-elim-open]");
      if (elimCard) {
        openElimScoreModal(elimCard.getAttribute("data-elim-open"));
      }
    });

    // Queue filters & generator
    document.querySelectorAll("[data-q-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        queueFilter = btn.getAttribute("data-q-filter");
        document.querySelectorAll("[data-q-filter]").forEach((b) => b.classList.toggle("active", b === btn));
        renderQueueView();
      });
    });
    document.getElementById("tmQueueSearch")?.addEventListener("input", renderQueueView);

    document.getElementById("btnTmGenerateSchedule")?.addEventListener("click", () => {
      const mpt = Math.max(1, Number(document.getElementById("tmGenMatchesPerTeam")?.value) || 6);
      if (state.matches.length > 0 && !confirm("Replace existing qualification schedule?")) return;
      generateQualSchedule(mpt, true);
    });

    document.getElementById("btnTmAddManualMatch")?.addEventListener("click", () => {
      if (state.teams.length < 4) {
        alert("Need at least 4 registered teams to add a match.");
        return;
      }
      const nextNum = state.matches.length + 1;
      state.matches.push({
        id: `Q${nextNum}`,
        label: `Q${nextNum}`,
        round: "QUAL",
        number: nextNum,
        fieldId: "field_1",
        state: "UNPLAYED",
        red: [state.teams[0].number, state.teams[1].number],
        blue: [state.teams[2].number, state.teams[3].number],
        redScore: 0,
        blueScore: 0,
        autonWinner: "none",
        redAwp: false,
        blueAwp: false,
        redDq: false,
        blueDq: false,
        breakdown: null
      });
      persistState(true);
      syncAllViews();
    });

    document.getElementById("btnTmClearMatches")?.addEventListener("click", () => {
      if (!confirm("Clear all qualification matches?")) return;
      state.matches = [];
      state.liveTimer.matchId = null;
      persistState(true);
      syncAllViews();
    });

    // Scoring console events
    document.querySelectorAll("[data-sk-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        scoringSubmode = btn.getAttribute("data-sk-mode");
        document.querySelectorAll("[data-sk-mode]").forEach((b) => b.classList.toggle("active", b === btn));
        document.getElementById("tmSkMatchPane").style.display = scoringSubmode === "match" ? "flex" : "none";
        document.getElementById("tmSkSkillsPane").style.display = scoringSubmode === "skills" ? "flex" : "none";
      });
    });

    document.getElementById("tmSkMatchSelect")?.addEventListener("change", (e) => {
      populateScoreSheetForMatch(e.target.value);
    });
    document.getElementById("tmSkRulesMode")?.addEventListener("change", () => {
      toggleScoreModeUi();
      recalcScoreSheetPreview();
    });
    document.getElementById("tmSkAutonWinner")?.addEventListener("change", recalcScoreSheetPreview);

    ["skRedPins", "skRedYellowPins", "skRedToggles", "skRedBonus", "skBluePins", "skBlueYellowPins", "skBlueToggles", "skBlueBonus", "skRedManualScore", "skBlueManualScore", "skRedAwp", "skBlueAwp", "skRedDq", "skBlueDq"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", recalcScoreSheetPreview);
      document.getElementById(id)?.addEventListener("change", recalcScoreSheetPreview);
    });

    document.getElementById("btnTmSkResetInputs")?.addEventListener("click", () => {
      ["skRedPins", "skRedYellowPins", "skRedToggles", "skRedBonus", "skBluePins", "skBlueYellowPins", "skBlueToggles", "skBlueBonus", "skRedManualScore", "skBlueManualScore"].forEach((id) => setVal(id, 0));
      setVal("tmSkAutonWinner", "none");
      ["skRedAwp", "skBlueAwp", "skRedDq", "skBlueDq"].forEach((id) => setChecked(id, false));
      recalcScoreSheetPreview();
    });

    const commitScore = (finalState) => {
      const mid = document.getElementById("tmSkMatchSelect")?.value;
      const m = findMatchById(mid);
      if (!m) return;
      const res = readScoreSheetInputs();
      m.breakdown = res.breakdown;
      m.redScore = res.redScore;
      m.blueScore = res.blueScore;
      m.autonWinner = res.autonWinner;
      m.redAwp = res.redAwp;
      m.blueAwp = res.blueAwp;
      m.redDq = res.redDq;
      m.blueDq = res.blueDq;
      m.state = finalState;
      persistState(true);
      syncAllViews();
    };

    document.getElementById("btnTmSkSaveDraft")?.addEventListener("click", () => commitScore("SCORED"));
    document.getElementById("btnTmSkSubmitOfficial")?.addEventListener("click", () => commitScore("SUBMITTED"));

    document.getElementById("tmSkillsForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const team = document.getElementById("tmSkillsTeamSelect")?.value;
      if (!team) return;
      const type = document.getElementById("tmSkillsType")?.value || "driver";
      const score = numVal("tmSkillsScore");
      const stopSec = numVal("tmSkillsStopSec");
      const existingCount = state.skillsRuns.filter((r) => r.team === team && r.type === type).length;
      state.skillsRuns.push({
        id: `sk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        team,
        type,
        attempt: existingCount + 1,
        score,
        stopSec
      });
      persistState(true);
      syncAllViews();
    });

    // Rankings export
    document.getElementById("btnTmExportRankingsCsv")?.addEventListener("click", () => {
      const rankings = computeRankings();
      const lines = ["Rank,Team,Name,WP,AP,SP,W,L,T,Avg,High"];
      rankings.forEach((r, i) => {
        lines.push(`${i + 1},"${r.number}","${(r.name || "").replace(/"/g, '""')}",${r.wp},${r.ap},${r.sp},${r.wins},${r.losses},${r.ties},${r.avg},${r.highScore}`);
      });
      downloadText("vex_tm_rankings.csv", lines.join("\n"), "text/csv");
    });

    // Alliance & Bracket events
    document.getElementById("btnTmAutoSeedAlliances")?.addEventListener("click", autoSeedAlliances);
    document.getElementById("btnTmBuildBracket")?.addEventListener("click", buildEliminationBracket);
    document.getElementById("tmAlliancesList")?.addEventListener("change", (e) => {
      const capIdx = e.target.getAttribute("data-alliance-cap");
      const pickIdx = e.target.getAttribute("data-alliance-pick");
      if (capIdx !== null && state.alliances[Number(capIdx)]) {
        state.alliances[Number(capIdx)].captain = e.target.value;
        persistState(true);
      } else if (pickIdx !== null && state.alliances[Number(pickIdx)]) {
        state.alliances[Number(pickIdx)].pick = e.target.value;
        persistState(true);
      }
    });

    // Teams & Inspection filters + modals
    document.querySelectorAll("[data-t-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        teamFilter = btn.getAttribute("data-t-filter");
        document.querySelectorAll("[data-t-filter]").forEach((b) => b.classList.toggle("active", b === btn));
        renderTeamsView();
      });
    });
    document.getElementById("tmTeamSearch")?.addEventListener("input", renderTeamsView);
    document.getElementById("btnTmAddTeamModal")?.addEventListener("click", () => openTeamModal(-1));
    document.getElementById("btnTmTeamModalClose")?.addEventListener("click", () => { document.getElementById("tmTeamModal").hidden = true; });
    document.getElementById("btnTmTeamCancel")?.addEventListener("click", () => { document.getElementById("tmTeamModal").hidden = true; });

    document.getElementById("tmTeamForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const idx = Number(document.getElementById("tmEditTeamIdx")?.value);
      const entry = {
        number: document.getElementById("tmInTeamNum").value.trim().toUpperCase(),
        name: document.getElementById("tmInTeamName").value.trim(),
        org: document.getElementById("tmInTeamOrg").value.trim(),
        location: document.getElementById("tmInTeamLoc").value.trim()
      };
      if (!entry.number) return;
      if (idx >= 0 && state.teams[idx]) {
        state.teams[idx] = { ...state.teams[idx], ...entry };
      } else {
        state.teams.push({
          ...entry,
          checkedIn: false,
          inspectionStatus: "Not Started",
          inspectionChecklist: {},
          inspector: "",
          inspectionNotes: ""
        });
      }
      document.getElementById("tmTeamModal").hidden = true;
      persistState(true);
      syncAllViews();
    });

    // CSV Import Modal
    document.getElementById("btnTmOpenCsvImport")?.addEventListener("click", () => { document.getElementById("tmCsvModal").hidden = false; });
    document.getElementById("btnTmCsvClose")?.addEventListener("click", () => { document.getElementById("tmCsvModal").hidden = true; });
    document.getElementById("btnTmCsvCancel")?.addEventListener("click", () => { document.getElementById("tmCsvModal").hidden = true; });
    document.getElementById("btnTmCsvApply")?.addEventListener("click", () => {
      const raw = document.getElementById("tmCsvInput")?.value || "";
      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      lines.forEach((line) => {
        const parts = line.split(",").map((p) => p.trim());
        const num = (parts[0] || "").toUpperCase();
        if (!num) return;
        if (!state.teams.some((t) => t.number === num)) {
          state.teams.push({
            number: num,
            name: parts[1] || `Team ${num}`,
            org: parts[2] || "",
            location: parts[3] || "",
            checkedIn: false,
            inspectionStatus: "Not Started",
            inspectionChecklist: {},
            inspector: "",
            inspectionNotes: ""
          });
        }
      });
      document.getElementById("tmCsvModal").hidden = true;
      persistState(true);
      syncAllViews();
    });

    // Inspection Modal
    const inspModal = document.getElementById("tmInspModal");
    document.getElementById("btnTmInspClose")?.addEventListener("click", () => { inspModal.hidden = true; });
    document.getElementById("btnTmInspCancel")?.addEventListener("click", () => { inspModal.hidden = true; });
    inspModal?.querySelectorAll("[data-insp]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const all = Array.from(inspModal.querySelectorAll("[data-insp]"));
        const checkedCount = all.filter((x) => x.checked).length;
        setVal("tmInspStatusSelect", checkedCount === 0 ? "Not Started" : checkedCount === all.length ? "Passed" : "Partial");
      });
    });
    document.getElementById("btnTmInspSave")?.addEventListener("click", () => {
      const t = state.teams[inspTeamIndex];
      if (!t) return;
      const checklist = {};
      inspModal.querySelectorAll("[data-insp]").forEach((cb) => {
        checklist[cb.getAttribute("data-insp")] = cb.checked;
      });
      t.inspectionChecklist = checklist;
      t.inspector = document.getElementById("tmInspInspector")?.value.trim() || "";
      t.inspectionStatus = document.getElementById("tmInspStatusSelect")?.value || "Not Started";
      t.inspectionNotes = document.getElementById("tmInspNotes")?.value.trim() || "";
      inspModal.hidden = true;
      persistState(true);
      syncAllViews();
    });

    // Elimination Score Modal
    const elimModal = document.getElementById("tmElimScoreModal");
    document.getElementById("btnTmElimClose")?.addEventListener("click", () => { elimModal.hidden = true; });
    document.getElementById("btnTmElimCancel")?.addEventListener("click", () => { elimModal.hidden = true; });
    document.getElementById("btnTmElimSave")?.addEventListener("click", () => {
      if (activeElimId) {
        advanceElimWinner(activeElimId, numVal("tmElimRedScore"), numVal("tmElimBlueScore"));
      }
      elimModal.hidden = true;
    });

    // Audience mode switcher
    document.querySelectorAll("#tmAudienceModePicker [data-disp-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.liveTimer.displayMode = btn.getAttribute("data-disp-mode");
        persistState(true);
        renderDisplayPreview();
      });
    });

    // Event setup form & export/import
    document.getElementById("tmEventSetupForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      state.event.name = document.getElementById("tmCfgName").value.trim() || "V5RC Tournament";
      state.event.sku = document.getElementById("tmCfgSku").value.trim();
      state.event.division = document.getElementById("tmCfgDivision").value.trim() || "Science Division";
      state.event.date = document.getElementById("tmCfgDate").value;
      state.event.location = document.getElementById("tmCfgLocation").value.trim();
      state.event.autonSeconds = Math.max(5, numVal("tmCfgAutonSec") || 15);
      state.event.driverSeconds = Math.max(15, numVal("tmCfgDriverSec") || 105);
      state.event.skillsSeconds = Math.max(15, numVal("tmCfgSkillsSec") || 60);
      persistState(true);
      syncAllViews();
    });

    document.getElementById("btnTmExportJson")?.addEventListener("click", () => {
      downloadText("vex_tm_event.json", JSON.stringify(state, null, 2), "application/json");
    });

    document.getElementById("btnTmImportJson")?.addEventListener("click", () => {
      document.getElementById("tmImportJsonInput")?.click();
    });

    document.getElementById("tmImportJsonInput")?.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          state = mergeDefaultState(parsed);
          persistState(true);
          syncAllViews();
        } catch (err) {
          alert("Invalid tournament JSON file.");
        }
      };
      reader.readAsText(f);
    });

    document.getElementById("btnTmResetAll")?.addEventListener("click", () => {
      if (!confirm("Reset all teams, matches, scores, and rankings?")) return;
      state = createDefaultState();
      persistState(true);
      syncAllViews();
    });

    // DWAB VEX TM LAN Server Proxy Probe
    document.getElementById("btnTmTestDwab")?.addEventListener("click", async () => {
      const host = document.getElementById("tmDwabHostInput")?.value.trim();
      const ep = document.getElementById("tmDwabEndpointInput")?.value.trim() || "/api/v2/event";
      const statusEl = document.getElementById("tmDwabStatusText");
      const outEl = document.getElementById("tmDwabOutput");
      if (!host) return;
      state.dwabBridge.host = host;
      if (statusEl) statusEl.textContent = "Probing server...";
      try {
        const proxyUrl = window.getApiUrl ? window.getApiUrl("/api/tm/dwab-proxy") : "/api/tm/dwab-proxy";
        const res = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseUrl: host, endpoint: ep })
        });
        const payload = await res.json();
        if (payload.ok) {
          state.dwabBridge.connected = true;
          state.dwabBridge.lastSync = Date.now();
          if (statusEl) statusEl.textContent = `Connected (HTTP ${payload.status})`;
          if (outEl) outEl.textContent = typeof payload.data === "string" ? payload.data : JSON.stringify(payload.data, null, 2);
          persistState(false);
        } else {
          state.dwabBridge.connected = false;
          if (statusEl) statusEl.textContent = "Unreachable (Using Standalone Mode)";
          if (outEl) outEl.textContent = payload.error || `HTTP ${payload.status}`;
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = "Offline (Standalone Active)";
        if (outEl) outEl.textContent = err.message || "Proxy error";
      }
    });
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------------------------------------------------
     BOOT
     ------------------------------------------------------------------------ */
  function init() {
    const params = new URLSearchParams(window.location.search);
    const disp = params.get("display");
    if (disp === "audience" || disp === "pit") {
      isStandaloneDisplay = true;
      standaloneMode = disp;
      const appShell = document.getElementById("tmAppShell");
      const standEl = document.getElementById("tmStandaloneDisplay");
      if (appShell) appShell.style.display = "none";
      if (standEl) standEl.hidden = false;
    }

    bindEvents();
    bindBrainStatus();
    initLiveSyncStream();
    loadInitialState();

    // Standalone timer keep-alive sync if console tab is open
    setInterval(() => {
      if (isStandaloneDisplay) {
        const sig = `${state.updatedAt}_${state.liveTimer.remainingSec}_${state.liveTimer.phase}`;
        if (sig !== lastBroadcastSig) {
          lastBroadcastSig = sig;
          renderStandaloneDisplay();
        }
      }
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
