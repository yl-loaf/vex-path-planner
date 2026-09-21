// ide.js - PROS LemLib Multi-File C++ Coding IDE Controller
(function() {
  "use strict";

  let activeFile = "src/autons.cpp";
  let openTabs = ["src/autons.cpp", "include/robot-config.h", "src/main.cpp"];
  let pendingNavigationUrl = null;

  // DOM Elements
  const elProjectName = document.getElementById("ideProjectName");
  const elDirtyBadge = document.getElementById("ideDirtyBadge");
  const elFileTree = document.getElementById("ideFileTree");
  const elSymbolsTree = document.getElementById("ideSymbolsTree");
  const elSymbolsCount = document.getElementById("ideSymbolsCount");
  const elTabsBar = document.getElementById("ideTabsBar");
  const elCurrentFile = document.getElementById("ideCurrentFile");
  const elCursorPos = document.getElementById("ideCursorPos");
  const elCharCount = document.getElementById("ideCharCount");
  const elLineNumbers = document.getElementById("ideLineNumbers");
  const elCodeEditor = document.getElementById("ideCodeEditor");
  const elBuildConsole = document.getElementById("ideBuildConsole");
  const elDiagnosticsList = document.getElementById("ideDiagnosticsList");
  const elDiagCount = document.getElementById("ideDiagCount");

  const btnCompile = document.getElementById("btnCompileProject");
  const btnSaveCloud = document.getElementById("btnSaveCloudProject");
  const btnOpenPlanner = document.getElementById("btnOpenInPlanner");
  const btnBackPlanner = document.getElementById("btnBackToPlanner");
  const btnNewFile = document.getElementById("btnIdeNewFile");
  const btnClearLogs = document.getElementById("btnClearBuildLogs");

  // Nav Guard Modal
  const navGuardModal = document.getElementById("navGuardModal");
  const btnNavGuardStay = document.getElementById("btnNavGuardStay");
  const btnNavGuardDiscard = document.getElementById("btnNavGuardDiscard");
  const btnNavGuardSaveAndReturn = document.getElementById("btnNavGuardSaveAndReturn");
  const btnNavGuardCancel = document.getElementById("btnNavGuardCancel");

  // Firebase auth state
  let cloudUser = null;

  function init() {
    initAuth();
    renderProjectHeader();
    renderFileTree();
    renderTabs();
    loadFile(activeFile);
    renderSymbols();
    wireEvents();
    wireTabs();
    wireEditor();
    wireNavGuard();

    ProjectManager.addListener(() => {
      renderProjectHeader();
      renderSymbols();
    });
  }

  // -------------------------------------------------------------
  // Firebase Auth
  // -------------------------------------------------------------
  function initAuth() {
    try {
      if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length || !firebase.auth) return;

      firebase.auth().onAuthStateChanged((user) => {
        cloudUser = user;
        updateAuthUI();
        if (user) {
          ProjectManager.loadFromCloud().then((proj) => {
            if (proj) {
              renderProjectHeader();
              renderFileTree();
              renderTabs();
              loadFile(activeFile);
              renderSymbols();
            }
          }).catch(console.error);
        }
      });

      const btnSignIn = document.getElementById("btnGoogleSignIn");
      const btnSignOut = document.getElementById("btnSignOut");
      const btnSwitch = document.getElementById("btnSwitchAccount");

      if (btnSignIn) {
        btnSignIn.onclick = () => {
          const provider = new firebase.auth.GoogleAuthProvider();
          firebase.auth().signInWithPopup(provider).catch(alert);
        };
      }
      if (btnSignOut) {
        btnSignOut.onclick = () => {
          firebase.auth().signOut().catch(alert);
        };
      }
      if (btnSwitch) {
        btnSwitch.onclick = () => {
          const provider = new firebase.auth.GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          firebase.auth().signInWithPopup(provider).catch(alert);
        };
      }
    } catch (e) {
      console.warn("IDE Auth init skipped or failed:", e);
    }
  }

  function updateAuthUI() {
    const btnIn = document.getElementById("btnGoogleSignIn");
    const btnOut = document.getElementById("btnSignOut");
    const btnSwitch = document.getElementById("btnSwitchAccount");
    const userEl = document.getElementById("authUser");
    const cloudStatus = document.getElementById("cloudStatus");

    if (cloudUser) {
      if (btnIn) btnIn.hidden = true;
      if (btnOut) btnOut.hidden = false;
      if (btnSwitch) btnSwitch.hidden = false;
      if (userEl) {
        userEl.hidden = false;
        userEl.textContent = `👤 ${cloudUser.displayName || cloudUser.email}`;
      }
      if (cloudStatus) cloudStatus.textContent = "☁️ Synced";
    } else {
      if (btnIn) btnIn.hidden = false;
      if (btnOut) btnOut.hidden = true;
      if (btnSwitch) btnSwitch.hidden = true;
      if (userEl) userEl.hidden = true;
      if (cloudStatus) cloudStatus.textContent = "";
    }
  }

  // -------------------------------------------------------------
  // Rendering UI
  // -------------------------------------------------------------
  function renderProjectHeader() {
    if (elProjectName) elProjectName.textContent = ProjectManager.project?.name || "Override_LemLib_Bot";
    if (elDirtyBadge) elDirtyBadge.hidden = !ProjectManager.isDirty;
  }

  function renderFileTree() {
    if (!elFileTree) return;
    elFileTree.innerHTML = "";

    const files = Object.keys(ProjectManager.project?.files || {});
    const groups = {
      "src/": [],
      "include/": [],
      "root": []
    };

    files.forEach(f => {
      if (f.startsWith("src/")) groups["src/"].push(f);
      else if (f.startsWith("include/")) groups["include/"].push(f);
      else groups["root"].push(f);
    });

    const createFolder = (title, fileList) => {
      const folderDiv = document.createElement("div");
      folderDiv.className = "ide-folder-group";

      const header = document.createElement("div");
      header.className = "ide-folder-header";
      header.innerHTML = `<span>📁 ${title}</span>`;
      folderDiv.appendChild(header);

      const listDiv = document.createElement("div");
      listDiv.className = "ide-folder-files";

      fileList.sort().forEach(f => {
        const item = document.createElement("div");
        item.className = `ide-file-item ${f === activeFile ? "active" : ""}`;
        const baseName = f.includes("/") ? f.split("/").pop() : f;
        const icon = f.endsWith(".cpp") ? "📄" : f.endsWith(".h") || f.endsWith(".hpp") ? "📑" : "⚙️";
        item.innerHTML = `<span class="ide-file-icon">${icon}</span> <span class="ide-file-name">${baseName}</span>`;
        item.onclick = () => switchToFile(f);
        listDiv.appendChild(item);
      });

      folderDiv.appendChild(listDiv);
      return folderDiv;
    };

    if (groups["src/"].length > 0) elFileTree.appendChild(createFolder("src", groups["src/"]));
    if (groups["include/"].length > 0) elFileTree.appendChild(createFolder("include", groups["include/"]));
    if (groups["root"].length > 0) elFileTree.appendChild(createFolder("Config & Build", groups["root"]));
  }

  function renderTabs() {
    if (!elTabsBar) return;
    elTabsBar.innerHTML = "";

    openTabs.forEach(f => {
      const tab = document.createElement("div");
      tab.className = `ide-tab ${f === activeFile ? "active" : ""}`;
      const baseName = f.includes("/") ? f.split("/").pop() : f;

      tab.innerHTML = `
        <span class="ide-tab-label">${baseName}</span>
        ${openTabs.length > 1 ? `<button type="button" class="ide-tab-close" data-file="${f}">✕</button>` : ""}
      `;

      tab.onclick = (e) => {
        if (e.target.classList.contains("ide-tab-close")) {
          e.stopPropagation();
          closeTab(f);
          return;
        }
        switchToFile(f);
      };

      elTabsBar.appendChild(tab);
    });
  }

  function saveCurrentEditorState() {
    if (activeFile && elCodeEditor && window.ProjectManager) {
      window.ProjectManager.setFile(activeFile, elCodeEditor.value);
    }
  }

  function switchToFile(filename) {
    saveCurrentEditorState();
    if (!openTabs.includes(filename)) {
      openTabs.push(filename);
    }
    activeFile = filename;
    renderFileTree();
    renderTabs();
    loadFile(filename);
  }

  function closeTab(filename) {
    saveCurrentEditorState();
    openTabs = openTabs.filter(t => t !== filename);
    if (activeFile === filename) {
      activeFile = openTabs[openTabs.length - 1] || "src/autons.cpp";
    }
    renderTabs();
    renderFileTree();
    loadFile(activeFile);
  }

  function loadFile(filename) {
    const content = ProjectManager.getFile(filename);
    if (elCodeEditor) elCodeEditor.value = content;
    if (elCurrentFile) elCurrentFile.textContent = filename;
    updateLineNumbers();
    updateCursorAndCharCount();
  }

  function renderSymbols() {
    if (!elSymbolsTree) return;
    const sym = ProjectManager.indexVariables();
    elSymbolsTree.innerHTML = "";

    let total = sym.motors.length + sym.pistons.length + sym.sensors.length + sym.functions.length;
    if (elSymbolsCount) elSymbolsCount.textContent = `${total} indexed`;

    const createSection = (title, items, icon) => {
      if (!items || items.length === 0) return null;
      const sec = document.createElement("div");
      sec.className = "ide-sym-section";
      sec.innerHTML = `<div class="ide-sym-title">${icon} ${title} (${items.length})</div>`;

      const list = document.createElement("div");
      list.className = "ide-sym-list";

      items.forEach(item => {
        const row = document.createElement("div");
        row.className = "ide-sym-row";
        row.title = `Declared in ${item.file}:${item.line} · Click to insert snippet into code`;
        row.innerHTML = `
          <span class="ide-sym-name">${item.name}</span>
          <span class="ide-sym-type">${item.type ? item.type.replace("pros::", "") : ""}</span>
        `;
        row.onclick = () => {
          insertSnippet(item.snippet || `${item.name};`);
        };
        list.appendChild(row);
      });

      sec.appendChild(list);
      return sec;
    };

    const s1 = createSection("Motors", sym.motors, "⚙️");
    const s2 = createSection("Pistons / ADI", sym.pistons, "📍");
    const s3 = createSection("Sensors & IMU", sym.sensors, "🧭");
    const s4 = createSection("Functions & Routines", sym.functions, "⚡");

    if (s1) elSymbolsTree.appendChild(s1);
    if (s2) elSymbolsTree.appendChild(s2);
    if (s3) elSymbolsTree.appendChild(s3);
    if (s4) elSymbolsTree.appendChild(s4);
  }

  function insertSnippet(snippet) {
    if (!elCodeEditor) return;
    const start = elCodeEditor.selectionStart;
    const end = elCodeEditor.selectionEnd;
    const val = elCodeEditor.value;

    elCodeEditor.value = val.substring(0, start) + snippet + val.substring(end);
    elCodeEditor.selectionStart = elCodeEditor.selectionEnd = start + snippet.length;
    elCodeEditor.focus();
    onEditorChange();
  }

  // -------------------------------------------------------------
  // Code Editor Logic & Line Numbers
  // -------------------------------------------------------------
  function updateLineNumbers() {
    if (!elLineNumbers || !elCodeEditor) return;
    const lines = elCodeEditor.value.split("\n").length;
    let html = "";
    for (let i = 1; i <= lines; i++) {
      html += `<div>${i}</div>`;
    }
    elLineNumbers.innerHTML = html;
  }

  function updateCursorAndCharCount() {
    if (!elCodeEditor) return;
    const text = elCodeEditor.value;
    const selStart = elCodeEditor.selectionStart;
    const upToCursor = text.substring(0, selStart);
    const line = upToCursor.split("\n").length;
    const col = selStart - upToCursor.lastIndexOf("\n");

    if (elCursorPos) elCursorPos.textContent = `Ln ${line}, Col ${col}`;
    if (elCharCount) elCharCount.textContent = `${text.length} chars · ${text.split("\n").length} lines`;
  }

  function onEditorChange() {
    const val = elCodeEditor.value;
    ProjectManager.setFile(activeFile, val);
    ProjectManager.markDirty(true);
    updateLineNumbers();
    updateCursorAndCharCount();
  }

  function wireEditor() {
    if (!elCodeEditor) return;

    elCodeEditor.addEventListener("input", onEditorChange);
    elCodeEditor.addEventListener("keyup", updateCursorAndCharCount);
    elCodeEditor.addEventListener("click", updateCursorAndCharCount);

    elCodeEditor.addEventListener("scroll", () => {
      if (elLineNumbers) elLineNumbers.scrollTop = elCodeEditor.scrollTop;
    });

    // Tab key support in textarea
    elCodeEditor.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = elCodeEditor.selectionStart;
        const end = elCodeEditor.selectionEnd;
        elCodeEditor.value = elCodeEditor.value.substring(0, start) + "    " + elCodeEditor.value.substring(end);
        elCodeEditor.selectionStart = elCodeEditor.selectionEnd = start + 4;
        onEditorChange();
      }
    });
  }

  // -------------------------------------------------------------
  // Tab Bar Switching for Bottom Output Panel
  // -------------------------------------------------------------
  function wireTabs() {
    document.querySelectorAll(".ide-out-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".ide-out-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".ide-tab-content").forEach(c => c.classList.remove("active"));

        tab.classList.add("active");
        const targetId = tab.dataset.tab === "build" ? "tabContentBuild" : tab.dataset.tab === "diagnostics" ? "tabContentDiagnostics" : "tabContentMemory";
        const targetEl = document.getElementById(targetId);
        if (targetEl) targetEl.classList.add("active");
      });
    });
  }

  // -------------------------------------------------------------
  // Events & Compilation
  // -------------------------------------------------------------
  function wireEvents() {
    if (btnCompile) {
      btnCompile.addEventListener("click", runCompilation);
    }

    if (btnSaveCloud) {
      btnSaveCloud.addEventListener("click", async () => {
        saveCurrentEditorState();
        const cloudStatus = document.getElementById("cloudStatus");
        if (cloudStatus) cloudStatus.textContent = "⏳ Saving…";
        try {
          await ProjectManager.saveToCloud();
          ProjectManager.markDirty(false);
          renderProjectHeader();
          if (cloudStatus) cloudStatus.textContent = "☁️ Synced";
          alert("✅ Project workspace saved & synchronized to cloud successfully!");
        } catch (e) {
          ProjectManager.saveLocal();
          ProjectManager.markDirty(false);
          renderProjectHeader();
          if (cloudStatus) cloudStatus.textContent = "💾 Local";
          alert(`💾 Saved locally to browser storage!\n\n(${e.message || "Sign in with Google to sync to cloud."})`);
        }
      });
    }

    if (btnNewFile) {
      btnNewFile.addEventListener("click", () => {
        const name = prompt("Enter file path (e.g. 'src/my_helpers.cpp' or 'include/my_helpers.hpp'):");
        if (name && name.trim()) {
          const cleanName = name.trim();
          ProjectManager.setFile(cleanName, `// ${cleanName}\n#pragma once\n#include "main.h"\n\n`);
          renderFileTree();
          switchToFile(cleanName);
        }
      });
    }

    const btnDownloadCode = document.getElementById("btnDownloadCode");
    if (btnDownloadCode) {
      btnDownloadCode.addEventListener("click", () => {
        saveCurrentEditorState();
        const choices = prompt(
          `Select download format:\n1 = Active File (${activeFile})\n2 = Full Multi-File Project (.json bundle)`,
          "1"
        );
        if (choices === "1") {
          window.ProjectManager.downloadFile(activeFile);
        } else if (choices === "2") {
          window.ProjectManager.exportProjectJson();
        }
      });
    }

    if (btnClearLogs) {
      btnClearLogs.addEventListener("click", () => {
        if (elBuildConsole) elBuildConsole.textContent = "";
      });
    }

    // -------------------------------------------------------------
    // V5 Brain Serial Driver & Telemetry Scanner Modal Wiring
    // -------------------------------------------------------------
    const btnConnectBrain = document.getElementById("btnConnectBrain");
    const ideBrainDot = document.getElementById("ideBrainDot");
    const ideBrainText = document.getElementById("ideBrainText");
    const ideBrainBatt = document.getElementById("ideBrainBatt");
    const ideBrainStatus = document.getElementById("ideBrainStatus");
    const btnUploadToBrain = document.getElementById("btnUploadToBrain");

    const brainModal = document.getElementById("brainModal");
    const brainModalClose = document.getElementById("brainModalClose");
    const btnBrainModalDone = document.getElementById("btnBrainModalDone");
    const btnModalConnect = document.getElementById("btnModalConnectBrain");
    const btnModalDisconnect = document.getElementById("btnModalDisconnectBrain");
    const modalBrainDot = document.getElementById("modalBrainDot");
    const modalBrainName = document.getElementById("modalBrainName");
    const modalBrainSubtext = document.getElementById("modalBrainSubtext");
    const modalBattPct = document.getElementById("modalBattPct");
    const modalBattFill = document.getElementById("modalBattFill");
    const modalBattMv = document.getElementById("modalBattMv");
    const modalBattTemp = document.getElementById("modalBattTemp");
    const modalSmartportsGrid = document.getElementById("modalSmartportsGrid");
    const modalSlotSelect = document.getElementById("modalSlotSelect");
    const btnModalUploadAuton = document.getElementById("btnModalUploadAuton");
    const btnModalRunProgram = document.getElementById("btnModalRunProgram");
    const btnModalStopProgram = document.getElementById("btnModalStopProgram");
    const modalUploadProgressWrap = document.getElementById("modalUploadProgressWrap");
    const modalUploadProgressLabel = document.getElementById("modalUploadProgressLabel");
    const modalUploadProgressBar = document.getElementById("modalUploadProgressBar");

    function openBrainModal() {
      if (!brainModal) return;
      brainModal.hidden = false;
      brainModal.classList.add("open");
      renderModalSmartports();
    }

    function closeBrainModal() {
      if (!brainModal) return;
      brainModal.hidden = true;
      brainModal.classList.remove("open");
    }

    if (btnConnectBrain) btnConnectBrain.addEventListener("click", openBrainModal);
    if (ideBrainStatus) ideBrainStatus.addEventListener("click", openBrainModal);
    if (brainModalClose) brainModalClose.addEventListener("click", closeBrainModal);
    if (btnBrainModalDone) btnBrainModalDone.addEventListener("click", closeBrainModal);
    if (brainModal) {
      brainModal.addEventListener("click", (e) => {
        if (e.target === brainModal) closeBrainModal();
      });
    }

    if (btnModalConnect) {
      btnModalConnect.addEventListener("click", async () => {
        if (!window.V5BrainSerial) return;
        btnModalConnect.disabled = true;
        btnModalConnect.textContent = "⏳ Connecting...";
        await window.V5BrainSerial.connect();
        btnModalConnect.disabled = false;
        btnModalConnect.textContent = "🔌 Connect via USB Serial";
      });
    }

    if (btnModalDisconnect) {
      btnModalDisconnect.addEventListener("click", async () => {
        if (!window.V5BrainSerial) return;
        await window.V5BrainSerial.disconnect();
      });
    }

    if (btnModalRunProgram) {
      btnModalRunProgram.addEventListener("click", () => {
        if (!window.V5BrainSerial) return;
        const slot = parseInt(modalSlotSelect?.value || "1", 10);
        window.V5BrainSerial.startProgram(slot);
      });
    }

    if (btnModalStopProgram) {
      btnModalStopProgram.addEventListener("click", () => {
        if (!window.V5BrainSerial) return;
        window.V5BrainSerial.stopProgram();
      });
    }

    async function handleFlashUpload() {
      if (!window.V5BrainSerial) return;
      if (!window.V5BrainSerial.isConnected) {
        openBrainModal();
        const ok = await window.V5BrainSerial.connect();
        if (!ok) return;
      }

      openBrainModal();
      const slot = parseInt(modalSlotSelect?.value || "1", 10);
      const projName = window.ProjectManager?.project?.name || "Override_Project";

      if (modalUploadProgressWrap) modalUploadProgressWrap.style.display = "block";
      if (btnUploadToBrain) {
        btnUploadToBrain.disabled = true;
        btnUploadToBrain.textContent = "⏳ Flashing...";
      }
      if (btnModalUploadAuton) btnModalUploadAuton.disabled = true;

      try {
        await window.V5BrainSerial.uploadToSlot(slot, projName, (pct) => {
          if (modalUploadProgressLabel) modalUploadProgressLabel.textContent = `Uploading to Slot ${slot}... ${pct}%`;
          if (modalUploadProgressBar) modalUploadProgressBar.style.width = `${pct}%`;
          if (btnUploadToBrain) btnUploadToBrain.textContent = `⏳ Flashing ${pct}%`;
        });
        alert(`🚀 Successfully flashed code to VEX V5 Brain (Slot ${slot})!`);
      } catch (e) {
        alert(`❌ Flash failed: ${e.message}`);
      } finally {
        if (modalUploadProgressWrap) modalUploadProgressWrap.style.display = "none";
        if (btnUploadToBrain) {
          btnUploadToBrain.disabled = false;
          btnUploadToBrain.textContent = "🚀 Flash to Brain";
        }
        if (btnModalUploadAuton) btnModalUploadAuton.disabled = false;
      }
    }

    if (btnUploadToBrain) btnUploadToBrain.addEventListener("click", handleFlashUpload);
    if (btnModalUploadAuton) btnModalUploadAuton.addEventListener("click", handleFlashUpload);

    function renderModalSmartports() {
      if (!modalSmartportsGrid || !window.V5BrainSerial) return;
      const ports = window.V5BrainSerial.status?.smartPorts || {};
      modalSmartportsGrid.innerHTML = "";

      for (let i = 1; i <= 21; i++) {
        const dev = ports[i];
        const card = document.createElement("div");
        card.className = `smartport-item ${dev ? "active" : ""}`;

        if (dev) {
          card.innerHTML = `
            <div class="smartport-num">Port ${i}</div>
            <div class="smartport-type">${dev.type}</div>
            <div class="smartport-val">${dev.name} (${dev.status})</div>
          `;
        } else {
          card.innerHTML = `
            <div class="smartport-num">Port ${i}</div>
            <div class="smartport-type" style="color:#64748b;">Unassigned</div>
            <div class="smartport-val" style="color:#475569;">Empty</div>
          `;
        }
        modalSmartportsGrid.appendChild(card);
      }
    }

    function updateIdeBrainUI(status) {
      const isConn = status && status.connected;

      if (btnConnectBrain) {
        btnConnectBrain.classList.toggle("connected", isConn);
        btnConnectBrain.textContent = isConn ? `🔌 ${status.name}` : "🔌 Connect Brain";
      }
      if (ideBrainDot) ideBrainDot.className = `brain-status-dot ${isConn ? 'connected' : 'disconnected'}`;
      if (ideBrainText) ideBrainText.textContent = isConn ? `Brain: ${status.name} (Slot ${status.activeSlot})` : "Brain: Disconnected";
      if (ideBrainBatt) {
        ideBrainBatt.hidden = !isConn;
        if (isConn) ideBrainBatt.textContent = `⚡ ${status.batteryPct}%`;
      }

      if (modalBrainDot) modalBrainDot.className = `brain-status-dot ${isConn ? 'connected' : 'disconnected'}`;
      if (modalBrainName) modalBrainName.textContent = isConn ? `Brain: ${status.name}` : "Brain: Disconnected";
      if (modalBrainSubtext) modalBrainSubtext.textContent = isConn ? `Connected via USB CDC (Slot ${status.activeSlot} Active)` : "Plug in VEX V5 USB cable to connect Web Serial CDC port";
      if (btnModalConnect) btnModalConnect.style.display = isConn ? "none" : "inline-block";
      if (btnModalDisconnect) btnModalDisconnect.style.display = isConn ? "inline-block" : "none";

      if (modalBattPct) modalBattPct.textContent = `${status.batteryPct}%`;
      if (modalBattFill) modalBattFill.style.width = `${status.batteryPct}%`;
      if (modalBattMv) modalBattMv.textContent = `${(status.batteryMv / 1000).toFixed(2)} V`;
      if (modalBattTemp) modalBattTemp.textContent = `${status.batteryTempC} °C`;

      renderModalSmartports();
    }

    if (window.V5BrainSerial) {
      window.V5BrainSerial.addListener("status", updateIdeBrainUI);
      window.V5BrainSerial.addListener("connected", (d) => updateIdeBrainUI(d.status));
      window.V5BrainSerial.addListener("disconnected", (d) => updateIdeBrainUI(d.status));
      window.V5BrainSerial.addListener("terminal", (line) => {
        if (elBuildConsole) {
          elBuildConsole.textContent += line;
          elBuildConsole.scrollTop = elBuildConsole.scrollHeight;
        }
      });
      updateIdeBrainUI(window.V5BrainSerial.status);
    }
  }

  function runCompilation() {
    saveCurrentEditorState();
    if (!elBuildConsole) return;
    elBuildConsole.textContent = "Compiling project workspace (pros make)...\n";

    // Switch tab to build
    const buildTabBtn = document.querySelector('.ide-out-tab[data-tab="build"]');
    if (buildTabBtn) buildTabBtn.click();

    setTimeout(() => {
      try {
        const pm = window.ProjectManager;
        if (!pm) throw new Error("ProjectManager service is unavailable");
        const res = pm.compileProject();
        elBuildConsole.textContent = res.logs || "Compilation complete.";

        const errCount = (res.errors || []).length;
        const warnCount = (res.warnings || []).length;

        // Update Diagnostics
        if (elDiagCount) elDiagCount.textContent = errCount + warnCount;
        if (elDiagnosticsList) {
          if (errCount === 0 && warnCount === 0) {
            elDiagnosticsList.innerHTML = `<div class="ide-diag-empty">✅ No syntax errors or warnings found across all project files.</div>`;
          } else {
            elDiagnosticsList.innerHTML = "";
            (res.errors || []).forEach(err => {
              const row = document.createElement("div");
              row.className = "ide-diag-item error";
              row.innerHTML = `<span class="ide-diag-badge">ERROR</span> <strong class="ide-diag-file">${err.file}:${err.line}</strong> - <span>${err.message}</span>`;
              row.onclick = () => switchToFile(err.file);
              elDiagnosticsList.appendChild(row);
            });
            (res.warnings || []).forEach(warn => {
              const row = document.createElement("div");
              row.className = "ide-diag-item warning";
              row.innerHTML = `<span class="ide-diag-badge">WARN</span> <strong class="ide-diag-file">${warn.file}:${warn.line}</strong> - <span>${warn.message}</span>`;
              row.onclick = () => switchToFile(warn.file);
              elDiagnosticsList.appendChild(row);
            });
          }
        }

        // Update Memory Map
        if (res.stats) {
          const memFlashFill = document.getElementById("memFlashFill");
          const memFlashText = document.getElementById("memFlashText");
          const memRamFill = document.getElementById("memRamFill");
          const memRamText = document.getElementById("memRamText");

          const flashPct = res.stats.flashPct || 0;
          const flashBytes = res.stats.flashBytes || 0;
          const ramPct = res.stats.ramPct || 0;
          const ramBytes = res.stats.ramBytes || 0;

          if (memFlashFill) memFlashFill.style.width = `${Math.min(100, flashPct)}%`;
          if (memFlashText) memFlashText.textContent = `${(flashBytes / 1024).toFixed(1)} KB / 32.0 MB (${flashPct.toFixed(2)}%)`;
          if (memRamFill) memRamFill.style.width = `${Math.min(100, ramPct)}%`;
          if (memRamText) memRamText.textContent = `${(ramBytes / 1024).toFixed(1)} KB / 32.0 MB (${ramPct.toFixed(2)}%)`;
        }
      } catch (err) {
        elBuildConsole.textContent += `\n❌ Compilation error: ${err.message || err}\n`;
      }
    }, 150);
  }

  // -------------------------------------------------------------
  // Navigation Guard (Mandatory Requirement)
  // "prevent going back to the main site unless the project has been saved and synced"
  // -------------------------------------------------------------
  function wireNavGuard() {
    const navigateToPlanner = () => {
      saveCurrentEditorState();
      if (window.ProjectManager) {
        window.ProjectManager.saveLocal();
        window.ProjectManager.markDirty(false);
      }
      window.location.href = "index.html";
    };

    if (btnBackPlanner) {
      btnBackPlanner.addEventListener("click", navigateToPlanner);
    }

    if (btnOpenPlanner) {
      btnOpenPlanner.addEventListener("click", navigateToPlanner);
    }

    if (btnNavGuardStay) {
      btnNavGuardStay.addEventListener("click", () => {
        if (navGuardModal) {
          navGuardModal.hidden = true;
          navGuardModal.classList.remove("open");
        }
        pendingNavigationUrl = null;
      });
    }

    if (btnNavGuardCancel) {
      btnNavGuardCancel.addEventListener("click", () => {
        if (navGuardModal) {
          navGuardModal.hidden = true;
          navGuardModal.classList.remove("open");
        }
        pendingNavigationUrl = null;
      });
    }

    if (btnNavGuardDiscard) {
      btnNavGuardDiscard.addEventListener("click", () => {
        ProjectManager.markDirty(false);
        window.location.href = pendingNavigationUrl || "index.html";
      });
    }

    if (btnNavGuardSaveAndReturn) {
      btnNavGuardSaveAndReturn.addEventListener("click", async () => {
        saveCurrentEditorState();
        try {
          await ProjectManager.saveToCloud();
        } catch (e) {
          ProjectManager.saveLocal();
        }
        ProjectManager.markDirty(false);
        window.location.href = pendingNavigationUrl || "index.html";
      });
    }

    // Standard Browser BeforeUnload guard
    window.addEventListener("beforeunload", (e) => {
      saveCurrentEditorState();
      if (ProjectManager.isDirty) {
        ProjectManager.saveLocal();
      }
    });
  }

  // Run on DOM Ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
