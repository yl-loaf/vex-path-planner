// C++ Autonomous to Blocks Standalone Page Logic
// Fully synchronized with same profile, user auth, and auton slots storage

(function () {
  "use strict";

  const STORAGE_KEY = "lemlib_path_planner_v2";
  const AUTH_STORAGE_KEY = "vex_auth_user_cache";
  const AUTH_EXPLICIT_SIGNOUT_KEY = "vex_auth_explicit_signout";

  let paths = [
    {
      id: "p_default",
      name: "Red Left",
      pose: { x: -60, y: -60, theta: 0 },
      actions: [],
    },
  ];
  let activePathId = "p_default";
  let bot = {
    robotW: 14,
    robotL: 14,
    trackWidth: 12,
    wheelDiam: 3.25,
    driveRpm: 600,
    defaultMaxSpeed: 127,
    defaultMinSpeed: 0,
    botImage: null,
  };

  let cloudReady = false;
  let cloudUser = null;
  let cloudDb = null;
  let cloudApplying = false;

  let lastParsed = null;

  // DOM Elements
  const codeInput = document.getElementById("cppCodeInput");
  const charCounter = document.getElementById("cppCharCounter");
  const statPose = document.getElementById("cppStatPose");
  const statMotions = document.getElementById("cppStatMotions");
  const statCustom = document.getElementById("cppStatCustom");
  const statAsync = document.getElementById("cppStatAsync");
  const statComments = document.getElementById("cppStatComments");
  const analysisStatus = document.getElementById("cppAnalysisStatus");
  const analysisCount = document.getElementById("cppAnalysisCount");
  const previewList = document.getElementById("cppParsedPreviewList");
  const activeNameEl = document.getElementById("cppActiveRoutineName");
  const newNameInput = document.getElementById("cppNewRoutineName");
  const slotSelect = document.getElementById("cppTargetSlotSelect");
  const errorEl = document.getElementById("cppErrorMsg");
  const btnApply = document.getElementById("btnTranslateAndOpen");
  const sampleBtns = document.querySelectorAll(".btn-cpp-sample");
  const targetRadios = document.querySelectorAll('input[name="cppImportTarget"]');
  const buildEl = document.getElementById("buildNumber");
  const footerSync = document.getElementById("footerSyncStatus");

  function uidPath() {
    return "p" + Math.random().toString(36).slice(2, 9);
  }

  function uid() {
    return "a" + Math.random().toString(36).slice(2, 9);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    const el = document.getElementById("toastNotification");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast-notify show";
    setTimeout(() => {
      el.className = "toast-notify";
    }, 3200);
  }

  function setCloudStatus(text, type = "") {
    const el = document.getElementById("cloudStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "cloud-status " + type;
    if (footerSync) {
      if (cloudUser) {
        footerSync.textContent = `Profile: Connected as ${cloudUser.displayName || cloudUser.email || "Google User"}`;
      } else {
        footerSync.textContent = "Profile: Local Storage (sign in to sync cloud across devices)";
      }
    }
  }

  function getSavedGoogleUser() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveGoogleUserProfile(user) {
    if (!user) return;
    try {
      localStorage.removeItem(AUTH_EXPLICIT_SIGNOUT_KEY);
      const profile = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        providerId: user.providerData && user.providerData[0] ? user.providerData[0].providerId : "google.com",
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(profile));
    } catch (_) {}
  }

  function clearSavedGoogleUser() {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.setItem(AUTH_EXPLICIT_SIGNOUT_KEY, "true");
    } catch (_) {}
  }

  function updateAuthUI(user = cloudUser, isCachedSession = false) {
    const btnIn = document.getElementById("btnGoogleSignIn");
    const spanUser = document.getElementById("authUser");
    const btnSwitch = document.getElementById("btnSwitchAccount");
    const btnOut = document.getElementById("btnSignOut");

    if (user) {
      if (btnIn) btnIn.hidden = true;
      if (spanUser) {
        spanUser.hidden = false;
        const name = user.displayName || user.email || "User";
        spanUser.textContent = isCachedSession ? `${name} (offline)` : name;
        spanUser.title = isCachedSession
          ? `Saved profile: ${user.email || name} · Click to reconnect cloud sync`
          : `Signed in as ${user.email || name}`;
      }
      if (btnSwitch) btnSwitch.hidden = false;
      if (btnOut) btnOut.hidden = false;
      setCloudStatus(isCachedSession ? "Saved" : "Connected", isCachedSession ? "" : "ok");
    } else {
      if (btnIn) btnIn.hidden = false;
      if (spanUser) spanUser.hidden = true;
      if (btnSwitch) btnSwitch.hidden = true;
      if (btnOut) btnOut.hidden = true;
      setCloudStatus("");
    }
  }

  // Load and save functions synchronized with same localStorage slot
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.bot) bot = { ...bot, ...data.bot };
      if (Array.isArray(data.paths) && data.paths.length) {
        paths = data.paths.map((p) => ({
          id: p.id || uidPath(),
          name: p.name || "Routine",
          pose: p.pose || { x: -60, y: -60, theta: 0 },
          actions: Array.isArray(p.actions) ? p.actions : [],
        }));
        activePathId = data.activePathId || paths[0].id;
        if (!paths.some((p) => p.id === activePathId)) activePathId = paths[0].id;
      }
    } catch (e) {
      console.warn("Could not load local profile in translator:", e);
    }
    syncSlotUI();
  }

  function saveLocal() {
    const data = {
      version: 2,
      paths,
      activePathId,
      bot,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Local save error:", e);
    }
  }

  async function cloudLoad() {
    if (!cloudReady || !cloudUser) return;
    const isJustLoggedIn = (typeof sessionStorage !== "undefined" && sessionStorage.getItem("lemlib_just_logged_in") === "true");
    if (isJustLoggedIn) {
      console.log("[Translator] User just logged in. Clearing local copy and forcing cloud sync.");
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        console.warn("Error deleting local copy:", e);
      }
    }

    try {
      setCloudStatus("Loading…", "busy");
      const doc = await firebase
        .firestore()
        .collection("users")
        .doc(cloudUser.uid)
        .collection("paths")
        .doc("current")
        .get();
      if (doc.exists) {
        const d = doc.data();
        if (d && Array.isArray(d.paths) && d.paths.length) {
          cloudApplying = true;
          paths = d.paths.map((p) => ({
            id: p.id || uidPath(),
            name: p.name || "Routine",
            pose: p.pose || { x: -60, y: -60, theta: 0 },
            actions: Array.isArray(p.actions) ? p.actions : [],
          }));
          activePathId = d.activePathId || paths[0].id;
          if (d.bot) bot = { ...bot, ...d.bot };
          saveLocal();
          syncSlotUI();
          cloudApplying = false;
          setCloudStatus("In sync", "ok");
          if (isJustLoggedIn && typeof sessionStorage !== "undefined") {
            sessionStorage.removeItem("lemlib_just_logged_in");
          }
          return;
        }
      }

      if (isJustLoggedIn) {
        console.log("[Translator] Cloud is empty for newly logged in user. Initializing clean default routines.");
        paths = [{
          id: uidPath(),
          name: "Routine 1",
          pose: { x: -60, y: -60, theta: 0 },
          actions: []
        }];
        activePathId = paths[0].id;
        saveLocal();
        syncSlotUI();
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("lemlib_just_logged_in");
        }
      }

      setCloudStatus("In sync", "ok");
    } catch (e) {
      console.error("Cloud load error:", e);
      setCloudStatus("Cloud error", "err");
    }
  }

  async function cloudSave() {
    if (window.SessionGuard && !window.SessionGuard.isInstanceActive()) {
      console.warn("[CloudSave] Aborted: Instance is deactivated by single-instance session guard.");
      return;
    }
    if (!cloudReady || !cloudUser || cloudApplying) return;
    try {
      setCloudStatus("Syncing…", "busy");
      await firebase
        .firestore()
        .collection("users")
        .doc(cloudUser.uid)
        .collection("paths")
        .doc("current")
        .set({
          paths,
          activePathId,
          bot,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      setCloudStatus("In sync", "ok");
    } catch (e) {
      console.error("Cloud save error:", e);
      setCloudStatus("Sync error", "err");
    }
  }

  function getActivePath() {
    return paths.find((p) => p.id === activePathId) || paths[0];
  }

  function syncSlotUI() {
    const cur = getActivePath();
    if (activeNameEl && cur) {
      activeNameEl.textContent = cur.name || "Active Routine";
    }
    if (slotSelect) {
      slotSelect.innerHTML = "";
      paths.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.actions ? p.actions.length : 0} steps)`;
        if (p.id === activePathId) opt.selected = true;
        slotSelect.appendChild(opt);
      });
    }
  }

  function runLiveAnalysis() {
    const text = codeInput ? codeInput.value : "";
    if (charCounter) {
      charCounter.textContent = `${text.length} char${text.length === 1 ? '' : 's'}`;
    }

    if (!text || !text.trim()) {
      if (statPose) statPose.textContent = "—";
      if (statMotions) statMotions.textContent = "0";
      if (statCustom) statCustom.textContent = "0";
      if (statAsync) statAsync.textContent = "0";
      if (statComments) statComments.textContent = "0";
      if (analysisStatus) analysisStatus.textContent = "Paste C++ code to analyze";
      if (analysisCount) analysisCount.textContent = "0 items";
      if (previewList) previewList.innerHTML = '<span class="empty-preview-hint">Paste your LemLib C++ autonomous routine on the left to see parsed blocks.</span>';
      lastParsed = null;
      return;
    }

    const res = window.CppTranslator.parseCppAuton(text, {
      defaultMaxSpeed: bot.defaultMaxSpeed || 127,
      defaultMinSpeed: bot.defaultMinSpeed || 0,
    });
    lastParsed = res;

    if (statPose) {
      statPose.textContent = res.startPose
        ? `(${res.startPose.x}, ${res.startPose.y}, ${res.startPose.theta}°)`
        : "— (keep current)";
    }
    if (statMotions) statMotions.textContent = String(res.stats.motionsCount);
    if (statCustom) statCustom.textContent = String(res.stats.customCount);
    if (statAsync) statAsync.textContent = String(res.stats.asyncCount);
    if (statComments) statComments.textContent = String(res.stats.commentsCount);

    const totalItems = res.actions.length + (res.startPose ? 1 : 0);
    if (analysisCount) analysisCount.textContent = `${totalItems} item${totalItems === 1 ? "" : "s"} detected`;

    if (analysisStatus) {
      if (res.actions.length > 0) {
        analysisStatus.innerHTML = `<span style="color:#34d399;font-weight:700;">✓ Parsed ${res.actions.length} action blocks successfully</span>`;
      } else if (res.startPose) {
        analysisStatus.innerHTML = `<span style="color:#38bdf8;font-weight:700;">✓ Parsed start pose</span>`;
      } else {
        analysisStatus.innerHTML = `<span style="color:#fbbf24;font-weight:700;">⚠️ No LemLib movement actions recognized</span>`;
      }
    }

    if (newNameInput && res.routineName && res.routineName !== "Imported Auton") {
      newNameInput.value = res.routineName;
    }

    // Render detailed visual action blocks breakdown
    if (previewList) {
      if (res.actions.length === 0 && !res.startPose) {
        previewList.innerHTML = '<span class="empty-preview-hint">No LemLib motions recognized yet. Check syntax or try a sample routine above.</span>';
      } else {
        let html = "";
        if (res.startPose) {
          html += `
            <div class="parsed-block-item start-block">
              <div class="block-badge start">🏁 START POSE</div>
              <div class="block-info">
                <span class="block-main">chassis.setPose(${res.startPose.x}, ${res.startPose.y}, ${res.startPose.theta}°)</span>
                <span class="block-sub">Initial field coordinate &amp; heading</span>
              </div>
            </div>`;
        }

        res.actions.forEach((a, i) => {
          const isAsync = a.async;
          const isCustom = a.type === "custom";
          let badgeType = "move";
          let icon = "🎯";
          if (isCustom) {
            badgeType = "custom";
            icon = "⚡";
          } else if (a.type === "wait") {
            badgeType = "wait";
            icon = "📍";
          } else if (a.type === "ifElse") {
            badgeType = "control";
            icon = "🔀";
          } else if (a.type === "loop") {
            badgeType = "control";
            icon = "🔁";
          } else if (a.type.includes("turn")) {
            badgeType = "turn";
            icon = "🔄";
          } else if (a.type.includes("swing")) {
            badgeType = "swing";
            icon = "🌊";
          }

          let titleText = a.type;
          let detailsText = "";

          if (isCustom) {
            titleText = "Custom Subsystem / Task";
            const firstLine = (a.customCode || "").split("\n")[0] || "custom code";
            detailsText = firstLine.length > 40 ? firstLine.slice(0, 38) + "…" : firstLine;
            if (a.customDuration > 0) detailsText += ` · Duration: ${a.customDuration}s`;
            else detailsText += " · Instant/Async Task";
          } else if (a.type === "wait") {
            const wType = a.waitType || "distance";
            if (wType === "distance") {
              titleText = `chassis.waitUntil(${a.waitDistance || 0}")`;
              detailsText = `Triggers non-blocking event trigger at ${a.waitDistance || 0} inches into previous motion`;
            } else if (wType === "done") {
              titleText = "chassis.waitUntilDone()";
              detailsText = "Waits for active chassis motion to complete before executing subsequent actions";
            } else {
              titleText = `pros::delay(${a.waitTime || 500}ms)`;
              detailsText = `Pauses autonomous execution thread for ${a.waitTime || 500} milliseconds`;
            }
          } else if (a.type === "ifElse") {
            titleText = `if (${a.condition || 'true'}) { ${a.thenLabel || 'Move forward'} } else { ${a.elseLabel || 'Move backwards'} }`;
            detailsText = `If true: ${a.thenLabel || 'Move forward'} · Else: ${a.elseLabel || 'Move backwards'} · C-Block Conditional`;
          } else if (a.type === "loop") {
            const mode = a.loopMode || "until";
            if (mode === "until") {
              titleText = `while (!(${a.condition || '!limit_switch.get_value()'})) { ... }`;
              detailsText = `Loops until condition ${a.condition || '!limit_switch.get_value()'} becomes true (C++ loop until)`;
            } else if (mode === "for") {
              titleText = `for (int i = 0; i < ${a.times || 5}; i++) { ... }`;
              detailsText = `Loops for ${a.times || 5} iterations consecutively (C++ for loop)`;
            } else {
              titleText = `while (true) { ... }`;
              detailsText = `Loops infinitely (forever loop C++)`;
            }
          } else if (a.type === "moveToPoint") {
            titleText = `moveToPoint(${a.x}, ${a.y})`;
            detailsText = `Timeout: ${a.timeout}ms · Forwards: ${a.forwards !== false} · MaxSpeed: ${a.maxSpeed || 127}`;
          } else if (a.type === "moveToPose") {
            titleText = `moveToPose(${a.x}, ${a.y}, ${a.theta}°)`;
            detailsText = `Timeout: ${a.timeout}ms · Lead: ${a.lead || 0.6} · Forwards: ${a.forwards !== false}`;
          } else if (a.type === "turnToHeading") {
            titleText = `turnToHeading(${a.theta}°)`;
            detailsText = `Timeout: ${a.timeout}ms · MaxSpeed: ${a.maxSpeed || 127}`;
          } else if (a.type === "turnToPoint") {
            titleText = `turnToPoint(${a.x}, ${a.y})`;
            detailsText = `Timeout: ${a.timeout}ms · Forwards: ${a.forwards !== false}`;
          } else if (a.type === "swingToPoint") {
            titleText = `swingToPoint(${a.x}, ${a.y}, ${a.lockedSide || 'LEFT'})`;
            detailsText = `Timeout: ${a.timeout}ms · Locked Side: ${a.lockedSide || 'LEFT'}`;
          } else if (a.type === "swingToHeading") {
            titleText = `swingToHeading(${a.theta}°, ${a.lockedSide || 'LEFT'})`;
            detailsText = `Timeout: ${a.timeout}ms · Locked Side: ${a.lockedSide || 'LEFT'}`;
          }

          const commentHtml = a.label ? `<span class="block-comment">// ${escapeHtml(a.label)}</span>` : "";
          const asyncBadge = isAsync ? `<span class="badge multitask-badge">⚡ MULTITASK</span>` : "";

          html += `
            <div class="parsed-block-item ${isAsync ? 'multitask-item' : ''} ${isCustom ? 'custom-item' : ''}">
              <div class="block-num">${i + 1}</div>
              <div class="block-badge ${badgeType}">${icon} ${a.type}</div>
              <div class="block-info">
                <div class="block-main-row">
                  <span class="block-main">${escapeHtml(titleText)}</span>
                  ${asyncBadge}
                  ${commentHtml}
                </div>
                <span class="block-sub">${escapeHtml(detailsText)}</span>
              </div>
            </div>`;
        });

        previewList.innerHTML = html;
      }
    }
  }

  async function applyAndReturnToPlanner() {
    if (!lastParsed || (!lastParsed.actions.length && !lastParsed.startPose)) {
      if (errorEl) {
        errorEl.textContent = "Please paste valid LemLib C++ autonomous code before applying.";
        errorEl.hidden = false;
      }
      return;
    }

    const selectedTarget = document.querySelector('input[name="cppImportTarget"]:checked')?.value || "active";
    const customName = newNameInput ? newNameInput.value.trim() : "";
    const routineName = customName || lastParsed.routineName || `Routine ${paths.length + 1}`;

    let targetPath = null;

    if (selectedTarget === "new") {
      const newId = uidPath();
      targetPath = {
        id: newId,
        name: routineName,
        pose: lastParsed.startPose ? { ...lastParsed.startPose } : { x: -60, y: -60, theta: 0 },
        actions: [],
      };
      paths.push(targetPath);
      activePathId = newId;
    } else if (selectedTarget === "specific") {
      const chosenId = slotSelect ? slotSelect.value : activePathId;
      targetPath = paths.find((p) => p.id === chosenId) || paths[0];
      activePathId = targetPath.id;
      if (customName && lastParsed.routineName !== "Imported Auton") {
        targetPath.name = routineName;
      }
    } else {
      // active
      targetPath = getActivePath();
      if (customName && lastParsed.routineName !== "Imported Auton") {
        targetPath.name = routineName;
      }
    }

    if (lastParsed.startPose) {
      targetPath.pose = { ...lastParsed.startPose };
    }

    targetPath.actions = lastParsed.actions.map((a) => ({
      ...a,
      id: uid(),
    }));

    // Save to local storage
    saveLocal();
    try {
      localStorage.setItem("lemlib_translator_just_saved", "true");
    } catch (_) {}

    // If cloud connected, save to cloud
    if (cloudReady && cloudUser) {
      await cloudSave();
    }

    showToast(`✓ Translated & saved ${targetPath.actions.length} blocks to "${targetPath.name}". Redirecting to Visual Planner...`);

    // Redirect to index.html to render blocks & field immediately
    setTimeout(() => {
      window.location.href = "index.html";
    }, 450);
  }

  function initAuth() {
    const cfg = window.FIREBASE_CONFIG;
    const enabled = window.FIREBASE_ENABLED === true;
    if (!enabled || !cfg || !cfg.apiKey || cfg.apiKey === "YOUR_API_KEY") {
      setCloudStatus("Cloud off", "");
      const btnIn = document.getElementById("btnGoogleSignIn");
      if (btnIn) {
        btnIn.onclick = () => alert("Google sign-in is not configured yet. Web config in firebase-config.js is required.");
      }
      return;
    }
    if (typeof firebase === "undefined") {
      setCloudStatus("Firebase missing", "err");
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(cfg);
      }
      cloudReady = true;
      firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
        console.warn("Auth persistence warning:", err);
      });
    } catch (e) {
      console.error(e);
      setCloudStatus("Init failed", "err");
      return;
    }

    if (window.SessionGuard) {
      window.SessionGuard.init({ pageName: "Autonomous Translator" });
    }

    const isExplicitSignOut = localStorage.getItem(AUTH_EXPLICIT_SIGNOUT_KEY) === "true";
    const saved = getSavedGoogleUser();
    if (window.SessionGuard && saved && !isExplicitSignOut) {
      window.SessionGuard.setUser(saved);
    }
    if (saved && !isExplicitSignOut) {
      updateAuthUI(saved, false);
      setCloudStatus("Connecting…", "busy");
    }

    const btnIn = document.getElementById("btnGoogleSignIn");
    if (btnIn) {
      btnIn.onclick = async () => {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem("lemlib_just_logged_in", "true");
        }
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        try {
          const res = await firebase.auth().signInWithPopup(provider);
          cloudUser = res.user;
          saveGoogleUserProfile(res.user);
          updateAuthUI();
          await cloudLoad();
        } catch (err) {
          console.error("Sign in failed:", err);
        }
      };
    }

    const btnSwitch = document.getElementById("btnSwitchAccount");
    if (btnSwitch) {
      btnSwitch.onclick = async () => {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem("lemlib_just_logged_in", "true");
        }
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        try {
          const res = await firebase.auth().signInWithPopup(provider);
          cloudUser = res.user;
          saveGoogleUserProfile(res.user);
          updateAuthUI();
          await cloudLoad();
        } catch (err) {
          console.error("Account switch failed:", err);
        }
      };
    }

    const btnOut = document.getElementById("btnSignOut");
    if (btnOut) {
      btnOut.onclick = async () => {
        clearSavedGoogleUser();
        cloudUser = null;
        await firebase.auth().signOut();
        updateAuthUI();
        setCloudStatus("");
      };
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      cloudUser = user;
      if (window.SessionGuard) {
        window.SessionGuard.setUser(user);
      }
      if (user) {
        saveGoogleUserProfile(user);
        updateAuthUI();
        await cloudLoad();
      } else {
        const signedOut = localStorage.getItem(AUTH_EXPLICIT_SIGNOUT_KEY) === "true";
        if (!signedOut) {
          const cached = getSavedGoogleUser();
          if (cached) {
            updateAuthUI(cached, true);
            setCloudStatus("Offline · Reconnect", "busy");
          } else {
            updateAuthUI();
          }
        } else {
          updateAuthUI();
        }
      }
    });
  }

  // Event Listeners
  if (codeInput) {
    codeInput.addEventListener("input", runLiveAnalysis);
    codeInput.addEventListener("paste", () => setTimeout(runLiveAnalysis, 50));
  }

  sampleBtns.forEach((btn) => {
    btn.onclick = () => {
      const sampleKey = btn.dataset.sample;
      if (sampleKey === "clear") {
        if (codeInput) codeInput.value = "";
      } else if (window.CppTranslator.SAMPLE_ROUTINES[sampleKey]) {
        if (codeInput) codeInput.value = window.CppTranslator.SAMPLE_ROUTINES[sampleKey];
      }
      runLiveAnalysis();
    };
  });

  targetRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (slotSelect) {
        slotSelect.disabled = radio.value !== "specific";
      }
      if (newNameInput) {
        newNameInput.disabled = radio.value !== "new";
      }
    });
  });

  if (btnApply) {
    btnApply.onclick = applyAndReturnToPlanner;
  }

  if (buildEl) {
    buildEl.textContent = window.APP_BUILD || "20260920.k16";
  }

  // Initialize
  loadLocal();
  initAuth();

  // Load initial sample code if textarea is empty
  if (codeInput && !codeInput.value.trim()) {
    codeInput.value = window.CppTranslator.SAMPLE_ROUTINES.preload_rush;
  }
  runLiveAnalysis();
})();
