/**
 * VEX V5 LemLib Suite - Interactive Onboarding Tutorial
 * Handles new user onboarding for fresh browser visits, new IP addresses,
 * and newly authenticated Google accounts, with spotlighting and visual walkthroughs.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY_GLOBAL = "lemlib_tutorial_completed_v1";
  const STORAGE_KEY_PREFIX_USER = "lemlib_tutorial_user_";
  const STORAGE_KEY_SEEN_MODAL = "lemlib_tutorial_seen_prompt";

  const TUTORIAL_STEPS = [
    {
      title: "Welcome to LemLib Autonomous Studio",
      badge: "Step 1 of 7 · Overview",
      icon: "🤖",
      targetSelector: ".neat-planner-header",
      content: `
        <p>You are in the complete autonomous engineering suite for VEX V5 robotics teams using <strong>LemLib</strong> on the <strong>Override 2026-27</strong> field.</p>
        <div class="tutorial-highlights">
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🗺️</span>
            <div><strong>Visual Path Planner:</strong> Design multi-waypoint trajectories with Boomerang curves &amp; wait triggers.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🏎️</span>
            <div><strong>2D Physics Simulator:</strong> Test match timing, wheel slip, and odometry kinematics in real-time.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">💻</span>
            <div><strong>PROS C++ IDE:</strong> Full multi-file coding studio with cross-file variable indexing and compiler diagnostics.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🔌</span>
            <div><strong>V5 Brain Flasher:</strong> Direct USB Web Serial connection, port telemetry, and 8-slot program flasher.</div>
          </div>
        </div>
        <p class="tut-note"><strong>Coordinate System:</strong> The field is 144&quot;&times;144&quot; with (0,0) at the center. Heading 0° points North (Up), 90° East (Right), 180° South (Down), and 270° West (Left).</p>
      `
    },
    {
      title: "Designing Autonomous Action Flow",
      badge: "Step 2 of 7 · Path Planning",
      icon: "🎯",
      targetSelector: ".flowchart-panel",
      content: `
        <p>Autonomous routines in LemLib are sequential series of kinematic motions and subsystem actions.</p>
        <div class="tutorial-highlights">
          <div class="tut-hl-item">
            <span class="tut-hl-icon">📍</span>
            <div><strong>Start Pose:</strong> Drag the start robot icon on the field or click an alliance preset (<code>Red L</code>, <code>Blue R</code>, etc.) touching the field perimeter.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🚀</span>
            <div><strong>Movement Types:</strong>
              <ul style="margin:4px 0 0 16px;padding:0;font-size:0.8rem;line-height:1.4;">
                <li><code>moveToPoint(x, y)</code>: Direct linear drive to coordinates.</li>
                <li><code>moveToPose(x, y, theta)</code>: LemLib Boomerang pure pursuit curve matching target heading.</li>
                <li><code>turnToHeading(theta)</code>: In-place pivot turn using angular PID.</li>
                <li><code>swingToPoint / swingToHeading</code>: Single-side drivetrain arc turn.</li>
                <li><code>Wait / Subsystem Action</code>: Pneumatic clamp, intake spin, or async event triggers.</li>
              </ul>
            </div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🖱️</span>
            <div><strong>Interactive Waypoints:</strong> Click &amp; drag any waypoint dot directly on the field canvas to adjust coordinates interactively.</div>
          </div>
        </div>
      `
    },
    {
      title: "Realistic 2D Kinematics & Match Simulator",
      badge: "Step 3 of 7 · Simulation",
      icon: "🏎️",
      targetSelector: ".sim-hud-card",
      content: `
        <p>Verify your autonomous timing and trajectory before putting your robot on the physical field.</p>
        <div class="tutorial-highlights">
          <div class="tut-hl-item">
            <span class="tut-hl-icon">▶</span>
            <div><strong>Simulation Controls:</strong> Click <strong>Simulate</strong> to run your routine with true LemLib acceleration profiles, deceleration damping, and tire traction slip.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">⏱️</span>
            <div><strong>Match Clock Telemetry:</strong> Track elapsed seconds against the <strong>15.0s</strong> autonomous match limit or <strong>60.0s</strong> Robot Skills challenge.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">💨</span>
            <div><strong>Variable Speed:</strong> Use the speed slider to slow down simulation to 0.25&times; for frame-by-frame waypoint inspection or speed up to 3&times;.</div>
          </div>
        </div>
      `
    },
    {
      title: "Robot Hardware & LemLib PID Tuning",
      badge: "Step 4 of 7 · Hardware Setup",
      icon: "🤖",
      targetSelector: "#tabBtnBot",
      content: `
        <p>Customize robot dimensions and PID constants to match your physical VEX machine with mathematical precision.</p>
        <div class="tutorial-highlights">
          <div class="tut-hl-item">
            <span class="tut-hl-icon">📐</span>
            <div><strong>Drivetrain Dimensions:</strong> Enter actual track width, wheel diameter (3.25&quot;, 2.75&quot;, etc.), and motor RPM (600, 450, 200).</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🎛️</span>
            <div><strong>Direct PID Tuning:</strong> Tune <code>lateral_controller</code> (linear distance) and <code>angular_controller</code> (heading error) gains (<code>kP</code>, <code>kI</code>, <code>kD</code>, slew rate) right in the UI.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">📷</span>
            <div><strong>Top-Down Robot Graphic:</strong> Upload a transparent photo or CAD render of your robot; it automatically scales to true field dimensions!</div>
          </div>
        </div>
      `
    },
    {
      title: "PROS C++ Multi-File Studio & Smart Sync",
      badge: "Step 5 of 7 · Coding & Compiler",
      icon: "💻",
      targetSelector: ".header-center-modes",
      content: `
        <p>Visual planning and real C++ code work in perfect harmony with zero vendor lock-in.</p>
        <div class="tutorial-highlights">
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🔄</span>
            <div><strong>Two-Way Safe Sync:</strong> Your visual paths generate clean, standard LemLib C++ in <code>src/autons.cpp</code>. Any manual edits made in the C++ IDE are safely preserved.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🔍</span>
            <div><strong>Cross-File Indexing:</strong> Motors, pistons, sensors, and chassis declared in <code>include/robot-config.h</code> are automatically indexed with autocomplete.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">⚡</span>
            <div><strong>Project Compiler (pros make):</strong> Click <strong>Compile Project</strong> to run syntax analysis and generate ARM Cortex binaries.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">📜</span>
            <div><strong>Version Snapshots:</strong> Automatic snapshots and backups let you revert to any prior iteration with 1 click.</div>
          </div>
        </div>
      `
    },
    {
      title: "VEX V5 Brain USB Flashing & Diagnostics",
      badge: "Step 6 of 7 · Hardware Integration",
      icon: "🔌",
      targetSelector: "#bannerBrainStatus",
      content: `
        <p>Direct communication with physical VEX V5 hardware right through the browser using Web Serial USB.</p>
        <div class="tutorial-highlights">
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🔌</span>
            <div><strong>Web Serial CDC:</strong> Plug in your V5 Brain via USB cable. Click <strong>Connect Brain</strong> (or the Brain pill) and select the VEX User CDC port.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">📊</span>
            <div><strong>Live Telemetry:</strong> View battery voltage, brain core temperature, and the status of all 21 Smart Ports.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">⚡</span>
            <div><strong>1-Click Flashing:</strong> Flash your compiled autonomous routines directly into V5 Brain slots 1 through 8!</div>
          </div>
        </div>
      `
    },
    {
      title: "Visual Blocks & C++ Auton Translator FAQ",
      badge: "Step 7 of 7 · Blocks FAQ & Help",
      icon: "❓",
      targetSelector: ".neat-planner-header",
      content: `
        <p>Comprehensive guide and answers for parsing raw C++ code into visual blocks, managing LemLib v0.5+ parameters, and robot sync.</p>
        <div class="tutorial-highlights">
          <div class="tut-hl-item">
            <span class="tut-hl-icon">📥</span>
            <div><strong>C++ to Blocks Parsing:</strong> Paste any LemLib C++ routine into the <a href="translator.html" target="_blank" style="color:#38bdf8;">C++ Translator</a> to instantly parse coordinates, Boomerang parameters, and subsystem calls into visual blocks.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">⚡</span>
            <div><strong>Async Tasks &amp; Concurrency:</strong> Concurrency is automatically detected via <code>pros::Task</code> or <code>.async = true</code> designator structs, keeping intake and drive motors synchronized.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">💾</span>
            <div><strong>Slot Synchronization:</strong> Translated routines can be saved to any of the 8 autonomous slots and sync securely with your Google Cloud profile across devices.</div>
          </div>
          <div class="tut-hl-item">
            <span class="tut-hl-icon">🔧</span>
            <div><strong>Troubleshooting:</strong> If a C++ line fails to parse, ensure it matches standard LemLib v0.5+ syntax (e.g. <code>chassis.moveToPoint(x, y, timeout, opts)</code>). Check inline comments for notes.</div>
          </div>
        </div>
        <div style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px;margin-top:10px;font-size:0.82rem;color:#6ee7b7;">
          🎉 <strong>You're all set!</strong> Start designing paths, converting C++ code, or testing simulation physics.
        </div>
      `
    }
  ];

  class LemLibTutorial {
    constructor() {
      this.currentStep = 0;
      this.active = false;
      this.modalEl = null;
      this.spotlightEl = null;
      this.init();
    }

    init() {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.checkAutoLaunch());
      } else {
        setTimeout(() => this.checkAutoLaunch(), 600);
      }
    }

    /**
     * Determine if the current visitor should be prompted with the tutorial:
     * - Brand new visitor / new IP address (localStorage not set)
     * - Newly signed in Google account that hasn't completed it
     */
    checkAutoLaunch() {
      try {
        const hasCompletedGlobal = localStorage.getItem(STORAGE_KEY_GLOBAL) === "true";
        const hasSeenPrompt = sessionStorage.getItem(STORAGE_KEY_SEEN_MODAL) === "true";

        // Check if user is logged into Google
        const userJson = localStorage.getItem("lemlib_saved_google_user");
        let userUid = null;
        if (userJson) {
          try {
            const parsed = JSON.parse(userJson);
            if (parsed && parsed.uid) userUid = parsed.uid;
          } catch (_) {}
        }

        const userCompleted = userUid ? localStorage.getItem(STORAGE_KEY_PREFIX_USER + userUid) === "true" : false;

        // If neither global nor user has completed, and haven't dismissed this session:
        if (!hasCompletedGlobal && !userCompleted && !hasSeenPrompt) {
          sessionStorage.setItem(STORAGE_KEY_SEEN_MODAL, "true");
          // Offer welcome toast or directly launch tutorial
          setTimeout(() => {
            this.showWelcomeToast();
          }, 1200);
        }
      } catch (e) {
        console.warn("Tutorial auto-launch check:", e);
      }
    }

    showWelcomeToast() {
      if (this.active) return;
      let toast = document.getElementById("tutWelcomeBanner");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "tutWelcomeBanner";
        toast.className = "tut-welcome-banner";
        toast.innerHTML = `
          <div class="tut-welcome-content">
            <span class="tut-welcome-icon">🎓</span>
            <div class="tut-welcome-text">
              <strong>New to VEX V5 LemLib Suite?</strong>
              <span>Take a quick 2-minute interactive tour to master path planning, PID tuning, and V5 Brain flashing.</span>
            </div>
          </div>
          <div class="tut-welcome-actions">
            <button type="button" id="btnStartWelcomeTour" class="btn-tut-primary">Start Tour 🚀</button>
            <button type="button" id="btnDismissWelcomeTour" class="btn-tut-dismiss">Later</button>
          </div>
        `;
        document.body.appendChild(toast);

        document.getElementById("btnStartWelcomeTour").onclick = () => {
          toast.remove();
          this.start(0);
        };
        document.getElementById("btnDismissWelcomeTour").onclick = () => {
          toast.remove();
        };
      }
    }

    start(step = 0) {
      this.currentStep = Math.max(0, Math.min(step, TUTORIAL_STEPS.length - 1));
      this.active = true;
      this.render();
      this.highlightTarget();
    }

    render() {
      this.ensureDOM();
      const stepData = TUTORIAL_STEPS[this.currentStep];
      const totalSteps = TUTORIAL_STEPS.length;
      const isFirst = this.currentStep === 0;
      const isLast = this.currentStep === totalSteps - 1;

      // Render step indicators
      let dotsHtml = "";
      for (let i = 0; i < totalSteps; i++) {
        dotsHtml += `<span class="tut-dot ${i === this.currentStep ? "active" : ""}" data-step="${i}" title="Jump to Step ${i + 1}"></span>`;
      }

      this.modalEl.innerHTML = `
        <div class="tut-dialog-card">
          <div class="tut-header">
            <div class="tut-header-badge">
              <span class="tut-badge-icon">${stepData.icon}</span>
              <span class="tut-badge-text">${stepData.badge}</span>
            </div>
            <button type="button" class="tut-close-btn" id="btnTutClose" title="Close tutorial">✕</button>
          </div>

          <h3 class="tut-title">${stepData.title}</h3>

          <div class="tut-body">
            ${stepData.content}
          </div>

          <div class="tut-footer">
            <div class="tut-progress-wrap">
              <div class="tut-dots">${dotsHtml}</div>
              <label class="tut-dont-show">
                <input type="checkbox" id="chkDontShowAgain" />
                <span>Don't show again on startup</span>
              </label>
            </div>

            <div class="tut-buttons">
              ${!isFirst ? `<button type="button" id="btnTutPrev" class="btn-tut-secondary">← Back</button>` : `<button type="button" id="btnTutSkip" class="btn-tut-secondary">Skip Tour</button>`}
              ${!isLast ? `<button type="button" id="btnTutNext" class="btn-tut-primary">Next Step →</button>` : `<button type="button" id="btnTutFinish" class="btn-tut-primary" style="background:#10b981;border-color:#10b981;">Finish &amp; Start Building 🚀</button>`}
            </div>
          </div>
        </div>
      `;

      // Wire events
      const btnClose = this.modalEl.querySelector("#btnTutClose");
      if (btnClose) btnClose.onclick = () => this.close();

      const btnSkip = this.modalEl.querySelector("#btnTutSkip");
      if (btnSkip) btnSkip.onclick = () => this.close();

      const btnPrev = this.modalEl.querySelector("#btnTutPrev");
      if (btnPrev) btnPrev.onclick = () => this.prev();

      const btnNext = this.modalEl.querySelector("#btnTutNext");
      if (btnNext) btnNext.onclick = () => this.next();

      const btnFinish = this.modalEl.querySelector("#btnTutFinish");
      if (btnFinish) btnFinish.onclick = () => this.finish();

      // Dot clicking
      const dots = this.modalEl.querySelectorAll(".tut-dot");
      dots.forEach(dot => {
        dot.onclick = () => {
          const s = parseInt(dot.getAttribute("data-step"), 10);
          this.start(s);
        };
      });

      // Show modal
      this.modalEl.style.display = "flex";
    }

    highlightTarget() {
      const stepData = TUTORIAL_STEPS[this.currentStep];
      if (!this.spotlightEl) {
        this.spotlightEl = document.createElement("div");
        this.spotlightEl.className = "tut-spotlight-box";
        document.body.appendChild(this.spotlightEl);
      }

      if (stepData.targetSelector) {
        const target = document.querySelector(stepData.targetSelector);
        if (target && target.offsetParent !== null) {
          const rect = target.getBoundingClientRect();
          this.spotlightEl.style.display = "block";
          this.spotlightEl.style.top = `${rect.top - 6}px`;
          this.spotlightEl.style.left = `${rect.left - 6}px`;
          this.spotlightEl.style.width = `${rect.width + 12}px`;
          this.spotlightEl.style.height = `${rect.height + 12}px`;
          return;
        }
      }
      this.spotlightEl.style.display = "none";
    }

    ensureDOM() {
      if (!this.modalEl) {
        this.modalEl = document.createElement("div");
        this.modalEl.id = "tutBackdropModal";
        this.modalEl.className = "tut-backdrop-modal";
        document.body.appendChild(this.modalEl);

        // Close on backdrop click outside dialog
        this.modalEl.addEventListener("click", (e) => {
          if (e.target === this.modalEl) {
            this.close();
          }
        });

        // Keydown navigation
        window.addEventListener("keydown", (e) => {
          if (!this.active) return;
          if (e.key === "Escape") this.close();
          if (e.key === "ArrowRight") this.next();
          if (e.key === "ArrowLeft") this.prev();
        });
      }
    }

    next() {
      if (this.currentStep < TUTORIAL_STEPS.length - 1) {
        this.start(this.currentStep + 1);
      } else {
        this.finish();
      }
    }

    prev() {
      if (this.currentStep > 0) {
        this.start(this.currentStep - 1);
      }
    }

    finish() {
      this.markCompleted();
      this.close();
      if (typeof window.showToast === "function") {
        window.showToast("🎉 Tutorial completed! You can re-open it anytime from Help or Tools menu.");
      }
    }

    markCompleted() {
      try {
        localStorage.setItem(STORAGE_KEY_GLOBAL, "true");
        // Also mark for active Google user if present
        const userJson = localStorage.getItem("lemlib_saved_google_user");
        if (userJson) {
          const parsed = JSON.parse(userJson);
          if (parsed && parsed.uid) {
            localStorage.setItem(STORAGE_KEY_PREFIX_USER + parsed.uid, "true");
            // If firebase is available, sync to Firestore
            if (typeof firebase !== "undefined" && firebase.firestore && firebase.auth) {
              const u = firebase.auth().currentUser;
              if (u) {
                firebase.firestore().collection("users").doc(u.uid).collection("settings").doc("tutorial").set({
                  completed: true,
                  completedAt: Date.now()
                }, { merge: true }).catch(() => {});
              }
            }
          }
        }
      } catch (e) {
        console.warn("Save tutorial completion:", e);
      }
    }

    close() {
      const chk = this.modalEl?.querySelector("#chkDontShowAgain");
      if (chk && chk.checked) {
        this.markCompleted();
      }
      this.active = false;
      if (this.modalEl) this.modalEl.style.display = "none";
      if (this.spotlightEl) this.spotlightEl.style.display = "none";
    }
  }

  // Singleton instance
  global.LemLibTutorial = new LemLibTutorial();
  global.openTutorial = function (stepIndex = 0) {
    if (global.LemLibTutorial) {
      global.LemLibTutorial.start(stepIndex);
    }
  };

  /**
   * Dedicated Interactive Tutorial Dialog for VRC Override Dynamic Comment Triggers
   */
  global.openOverrideCommentTutorial = function () {
    let guideModal = document.getElementById("overrideCommentGuideModal");
    if (!guideModal) {
      guideModal = document.createElement("div");
      guideModal.id = "overrideCommentGuideModal";
      guideModal.className = "modal tutorial-guide-modal";
      guideModal.innerHTML = `
        <div class="modal-card" style="max-width:680px;background:#0f172a;border:1px solid rgba(250,204,21,0.3);border-radius:12px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.85);color:#f8fafc;padding:0;overflow:hidden;">
          <div style="background:linear-gradient(135deg, rgba(234,179,8,0.2), rgba(15,23,42,0.95));padding:16px 20px;border-bottom:1px solid rgba(250,204,21,0.25);display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:1.6rem;background:rgba(234,179,8,0.2);padding:6px;border-radius:8px;border:1px solid rgba(250,204,21,0.4);">🎯</span>
              <div>
                <h3 style="margin:0;font-size:1.15rem;color:#facc15;font-weight:800;">VRC Override Autonomous Comment Guide</h3>
                <span style="font-size:0.75rem;color:#cbd5e1;">How to use action comments to trigger pin collection, goal deposition, and wall toggles</span>
              </div>
            </div>
            <button type="button" class="modal-close-btn" id="btnCloseCommentGuide" style="background:transparent;border:none;color:#94a3b8;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>

          <div style="padding:20px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:16px;font-size:0.85rem;line-height:1.5;">
            
            <div style="background:rgba(30,41,59,0.7);border-radius:8px;padding:12px 16px;border-left:4px solid #38bdf8;">
              <strong style="color:#38bdf8;font-size:0.9rem;">💡 What are Comment Triggers?</strong>
              <p style="margin:4px 0 0;color:#cbd5e1;">In the path planner, you can write natural C++ comments (in any action's <strong>Comment</strong>, <strong>Label</strong>, or <strong>Custom Code</strong> field). During simulation playback, the engine reads these comments and automatically updates the robot and field!</p>
            </div>

            <div style="display:grid;grid-template-columns:1fr;gap:12px;">
              
              <!-- Trigger 1 -->
              <div style="background:#1e293b;border-radius:8px;padding:12px;border:1px solid #334155;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                  <span style="font-weight:700;color:#f87171;font-size:0.88rem;">📌 1. Collecting a Pin</span>
                  <code style="background:#0f172a;color:#facc15;padding:2px 8px;border-radius:4px;border:1px solid rgba(250,204,21,0.3);font-family:monospace;">// pin collected</code>
                </div>
                <p style="margin:0 0 8px;color:#94a3b8;font-size:0.8rem;">
                  When the robot reaches this waypoint, it grabs the nearest pin from the foam tile or from a match loader chute. The pin attaches to the robot and moves with it.
                </p>
                <div style="display:flex;align-items:center;justify-content:space-between;background:#0f172a;padding:6px 10px;border-radius:6px;">
                  <span style="color:#64748b;font-size:0.75rem;">Rule: Robot carries max 1 pin at a time. Match loaders always keep a pin ready.</span>
                  <button type="button" class="btn-xs-clean" onclick="navigator.clipboard.writeText('// pin collected'); if(window.showToast) window.showToast('✓ Copied // pin collected');" style="color:#38bdf8;cursor:pointer;">📋 Copy</button>
                </div>
              </div>

              <!-- Trigger 2 -->
              <div style="background:#1e293b;border-radius:8px;padding:12px;border:1px solid #334155;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                  <span style="font-weight:700;color:#60a5fa;font-size:0.88rem;">🥅 2. Depositing &amp; Stacking on a Goal</span>
                  <code style="background:#0f172a;color:#facc15;padding:2px 8px;border-radius:4px;border:1px solid rgba(250,204,21,0.3);font-family:monospace;">// pin deposited</code>
                </div>
                <p style="margin:0 0 8px;color:#94a3b8;font-size:0.8rem;">
                  When the robot reaches this waypoint, it drops the carried pin into the nearest goal. The goal stacks the pin and displays the live stack count (e.g. <code>🔴 2 🟡 1</code>).
                </p>
                <div style="display:flex;align-items:center;justify-content:space-between;background:#0f172a;padding:6px 10px;border-radius:6px;">
                  <span style="color:#64748b;font-size:0.75rem;">Scoring: +5 pts for alliance pin · +10 pts for yellow pin if toggle owned.</span>
                  <button type="button" class="btn-xs-clean" onclick="navigator.clipboard.writeText('// pin deposited'); if(window.showToast) window.showToast('✓ Copied // pin deposited');" style="color:#38bdf8;cursor:pointer;">📋 Copy</button>
                </div>
              </div>

              <!-- Trigger 3 -->
              <div style="background:#1e293b;border-radius:8px;padding:12px;border:1px solid #334155;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                  <span style="font-weight:700;color:#4ade80;font-size:0.88rem;">🔄 3. Turning Wall Toggles</span>
                  <div style="display:flex;gap:6px;">
                    <code style="background:#0f172a;color:#f87171;padding:2px 6px;border-radius:4px;font-family:monospace;">// turn toggle CW</code>
                    <code style="background:#0f172a;color:#60a5fa;padding:2px 6px;border-radius:4px;font-family:monospace;">// turn toggle CCW</code>
                  </div>
                </div>
                <p style="margin:0 0 8px;color:#94a3b8;font-size:0.8rem;">
                  When near any of the 4 perimeter wall toggles (West, East, North, South), this comment rotates the toggle: <strong>CW</strong> sets it to Red Alliance, and <strong>CCW</strong> sets it to Blue Alliance.
                </p>
                <div style="display:flex;align-items:center;justify-content:space-between;background:#0f172a;padding:6px 10px;border-radius:6px;">
                  <span style="color:#64748b;font-size:0.75rem;">Scoring: +10 pts per controlled toggle · Doubles quadrant yellow pin score!</span>
                  <button type="button" class="btn-xs-clean" onclick="navigator.clipboard.writeText('// turn toggle CW'); if(window.showToast) window.showToast('✓ Copied // turn toggle CW');" style="color:#38bdf8;cursor:pointer;">📋 Copy CW</button>
                </div>
              </div>

            </div>

            <div style="background:rgba(234,179,8,0.1);border:1px solid rgba(250,204,21,0.3);border-radius:8px;padding:10px 14px;">
              <strong style="color:#facc15;">⚡ Quick 1-Click Insert:</strong>
              <p style="margin:2px 0 0;color:#e2e8f0;font-size:0.78rem;">You don't need to type these out manually! Inside any action block in the sidebar, click the quick snippet chips like <strong>[📌 // pin collected]</strong> to insert them instantly into your routine.</p>
            </div>

          </div>

          <div style="background:#1e293b;padding:12px 20px;border-top:1px solid #334155;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:0.75rem;color:#94a3b8;">VRC Override 2026-27 Autonomous Rules</span>
            <button type="button" class="primary" id="btnDoneCommentGuide" style="background:#eab308;color:#0f172a;font-weight:700;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;">Got it!</button>
          </div>
        </div>
      `;
      document.body.appendChild(guideModal);

      const closeBtn = guideModal.querySelector("#btnCloseCommentGuide");
      const doneBtn = guideModal.querySelector("#btnDoneCommentGuide");
      const closeFn = () => {
        guideModal.style.display = "none";
        guideModal.classList.remove("open");
      };
      if (closeBtn) closeBtn.onclick = closeFn;
      if (doneBtn) doneBtn.onclick = closeFn;
      guideModal.onclick = (e) => { if (e.target === guideModal) closeFn(); };
    }

    guideModal.style.display = "flex";
    guideModal.classList.add("open");
  };

})(typeof window !== "undefined" ? window : this);

