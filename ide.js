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
    if (typeof firebase === "undefined" || !firebase.auth) return;

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

    if (btnClearLogs) {
      btnClearLogs.addEventListener("click", () => {
        if (elBuildConsole) elBuildConsole.textContent = "";
      });
    }

    // V5 Brain Connection & Telemetry Wiring in IDE
    const btnConnectBrain = document.getElementById("btnConnectBrain");
    const ideBrainDot = document.getElementById("ideBrainDot");
    const ideBrainText = document.getElementById("ideBrainText");
    const ideBrainBatt = document.getElementById("ideBrainBatt");
    const ideBrainStatus = document.getElementById("ideBrainStatus");
    const btnUploadToBrain = document.getElementById("btnUploadToBrain");

    function updateIdeBrainUI(status) {
      const isConn = status && status.connected;
      if (btnConnectBrain) {
        btnConnectBrain.classList.toggle("connected", isConn);
        btnConnectBrain.textContent = isConn ? `🔌 ${status.name}` : "🔌 Connect Brain";
      }
      if (ideBrainDot) {
        ideBrainDot.className = `brain-status-dot ${isConn ? 'connected' : 'disconnected'}`;
      }
      if (ideBrainText) {
        ideBrainText.textContent = isConn ? `Brain: ${status.name} (Slot ${status.activeSlot})` : "Brain: Disconnected";
      }
      if (ideBrainBatt) {
        ideBrainBatt.hidden = !isConn;
        if (isConn) ideBrainBatt.textContent = `⚡ ${status.batteryPct}%`;
      }
    }

    if (btnConnectBrain) {
      btnConnectBrain.addEventListener("click", async () => {
        if (!window.V5BrainSerial) return;
        if (window.V5BrainSerial.isConnected) {
          await window.V5BrainSerial.disconnect();
        } else {
          await window.V5BrainSerial.connect();
        }
      });
    }

    if (btnUploadToBrain) {
      btnUploadToBrain.addEventListener("click", async () => {
        if (!window.V5BrainSerial) return;
        if (!window.V5BrainSerial.isConnected) {
          const ok = await window.V5BrainSerial.connect();
          if (!ok) return;
        }
        try {
          btnUploadToBrain.disabled = true;
          btnUploadToBrain.textContent = "⏳ Flashing...";
          await window.V5BrainSerial.uploadToSlot(1, ProjectManager.project?.name || "Override_Project", (pct) => {
            btnUploadToBrain.textContent = `⏳ Flashing ${pct}%`;
          });
          alert("🚀 Successfully flashed compiled project to VEX V5 Brain (Slot 1)!");
        } catch (e) {
          alert(`❌ Flash failed: ${e.message}`);
        } finally {
          btnUploadToBrain.disabled = false;
          btnUploadToBrain.textContent = "🚀 Flash to Brain";
        }
      });
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
    const handleNavigationAttempt = (targetUrl) => {
      if (ProjectManager.isDirty) {
        pendingNavigationUrl = targetUrl;
        if (navGuardModal) {
          navGuardModal.hidden = false;
          navGuardModal.classList.add("open");
        }
      } else {
        window.location.href = targetUrl;
      }
    };

    if (btnBackPlanner) {
      btnBackPlanner.addEventListener("click", () => handleNavigationAttempt("index.html"));
    }

    if (btnOpenPlanner) {
      btnOpenPlanner.addEventListener("click", () => handleNavigationAttempt("index.html"));
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
        if (pendingNavigationUrl) {
          window.location.href = pendingNavigationUrl;
        } else {
          window.location.href = "index.html";
        }
      });
    }

    if (btnNavGuardSaveAndReturn) {
      btnNavGuardSaveAndReturn.addEventListener("click", async () => {
        try {
          await ProjectManager.saveToCloud();
          ProjectManager.markDirty(false);
          if (pendingNavigationUrl) {
            window.location.href = pendingNavigationUrl;
          } else {
            window.location.href = "index.html";
          }
        } catch (e) {
          // If not signed in to Firebase, save locally and proceed
          ProjectManager.saveLocal();
          ProjectManager.markDirty(false);
          if (pendingNavigationUrl) {
            window.location.href = pendingNavigationUrl;
          } else {
            window.location.href = "index.html";
          }
        }
      });
    }

    // Standard Browser BeforeUnload guard
    window.addEventListener("beforeunload", (e) => {
      if (ProjectManager.isDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved project edits. Please save and sync to the cloud first.";
        return e.returnValue;
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
