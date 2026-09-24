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

})(typeof window !== "undefined" ? window : this);
