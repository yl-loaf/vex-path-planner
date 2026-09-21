// ide.js - PROS LemLib Multi-File C++ Coding IDE Controller
(function() {
  "use strict";

  let activeFile = "src/autons.cpp";
  let openTabs = ["src/autons.cpp", "include/robot-config.h", "src/main.cpp"];
  let pendingNavigationUrl = null;

  // DOM Elements
  const elProjectName = document.getElementById("ideProjectName");
  const elDirtyBadge = document.getElementById("ideDirtyBadge");
  const elAutosaveBadge = document.getElementById("ideAutosaveBadge");
  const elAutosaveDot = document.getElementById("ideAutosaveDot");
  const elAutosaveText = document.getElementById("ideAutosaveText");
  const btnToggleAutosave = document.getElementById("btnToggleAutosave");
  const elAutosaveToggleLabel = document.getElementById("ideAutosaveToggleLabel");
  const elAutosaveIcon = document.getElementById("ideAutosaveIcon");
  const elAutosaveTimestamp = document.getElementById("ideAutosaveTimestamp");
  const elSaveProgressPill = document.getElementById("ideSaveProgressPill");
  const elSaveProgressText = document.getElementById("ideSaveProgressText");
  const elSaveProgressBarFill = document.getElementById("ideSaveProgressBarFill");

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

  // IDE Autosave Engine State
  let autosaveEnabled = localStorage.getItem("lemlib_ide_autosave_enabled") !== "false";
  let autosaveTimer = null;
  let isAutosaving = false;
  let lastSaveTimestamp = null;

  function init() {
    initAuth();
    initAutosave();
    renderProjectHeader();
    renderFileTree();
    renderTabs();
    loadFile(activeFile);
    renderSymbols();
    wireEvents();
    wireTabs();
    wireEditor();
    wireNavGuard();

    ProjectManager.addListener((pm, reason) => {
      renderProjectHeader();
      if (reason !== "dirty") {
        renderSymbols();
      }
      if (activeFile && elCodeEditor) {
        const latest = ProjectManager.getFile(activeFile);
        if (latest !== elCodeEditor.value) {
          if (window.isSyncingFromPlanner || document.activeElement !== elCodeEditor) {
            loadFile(activeFile);
          }
        }
      }
    });
  }

  // -------------------------------------------------------------
  // Firebase Auth
  // -------------------------------------------------------------
  let cloudIdeUnsub = null;

  function subscribeToIdeCloud(uid) {
    if (cloudIdeUnsub) {
      try { cloudIdeUnsub(); } catch (_) {}
      cloudIdeUnsub = null;
    }
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) return;
    try {
      const db = firebase.firestore();
      const projRef = db.collection("users").doc(uid).collection("data").doc("active_project");
      cloudIdeUnsub = projRef.onSnapshot((snap) => {
        if (!snap.exists || snap.metadata?.hasPendingWrites) return;
        const data = snap.data();
        const cloudTime = Number(data.updatedAt) || 0;
        const isLocalDefault = ProjectManager.isDefaultProject ? ProjectManager.isDefaultProject() : false;
        const localTime = isLocalDefault ? 0 : (ProjectManager.project?.updatedAt || 0);

        if ((cloudTime > localTime || isLocalDefault) && !ProjectManager.isDirty) {
          console.log("[IDE CloudSync] Live project update from server detected, reloading...");
          ProjectManager.loadFromCloud(true).then((proj) => {
            if (proj) {
              renderProjectHeader();
              renderFileTree();
              renderTabs();
              loadFile(activeFile || "src/main.cpp");
              renderSymbols();
              showToast(`☁️ Workspace updated from server ("${proj.name}")`, 3500);
            }
          });
        }
      }, (err) => {
        console.warn("IDE live cloud subscription warning:", err);
      });
    } catch (e) {
      console.warn("IDE live cloud subscription error:", e);
    }
  }

  function initAuth() {
    try {
      if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length || !firebase.auth) return;

      firebase.auth().onAuthStateChanged((user) => {
        cloudUser = user;
        updateAuthUI();
        if (user) {
          ProjectManager.loadFromCloud(false).then((proj) => {
            if (proj) {
              renderProjectHeader();
              renderFileTree();
              renderTabs();
              loadFile(activeFile);
              renderSymbols();
            }
          }).catch(console.error);
          subscribeToIdeCloud(user.uid);
        } else {
          if (cloudIdeUnsub) {
            try { cloudIdeUnsub(); } catch (_) {}
            cloudIdeUnsub = null;
          }
        }
      });

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && cloudUser && !ProjectManager.isDirty) {
          ProjectManager.loadFromCloud(false).then((proj) => {
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
  // IDE Autosave Engine
  // -------------------------------------------------------------
  function initAutosave() {
    updateAutosaveUI(autosaveEnabled ? "ready" : "disabled");

    if (btnToggleAutosave) {
      btnToggleAutosave.addEventListener("click", toggleAutosave);
    }

    // Periodic backup check every 10 seconds
    setInterval(() => {
      if (autosaveEnabled && window.ProjectManager && window.ProjectManager.isDirty) {
        triggerAutosave(true);
      }
    }, 10000);

    // Immediate save when user switches browser tabs or window loses focus
    window.addEventListener("blur", () => {
      if (autosaveEnabled && window.ProjectManager && window.ProjectManager.isDirty) {
        triggerAutosave(true);
      }
    });

    // Save on beforeunload
    window.addEventListener("beforeunload", () => {
      saveCurrentEditorState();
      if (window.ProjectManager && window.ProjectManager.isDirty) {
        window.ProjectManager.saveLocal();
      }
    });

    // Global keyboard shortcut Ctrl+S / Cmd+S
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrentEditorState();
        triggerAutosave(true);
      }
    });
  }

  function updateAutosaveUI(status, customMsg, progressStr = null) {
    if (!autosaveEnabled) {
      if (elAutosaveBadge) {
        elAutosaveBadge.className = "ide-autosave-badge disabled";
        elAutosaveBadge.title = "Autosave paused by user";
      }
      if (elAutosaveDot) elAutosaveDot.className = "autosave-dot off";
      if (elAutosaveText) elAutosaveText.textContent = "Autosave: Paused";
      if (btnToggleAutosave) btnToggleAutosave.className = "ide-autosave-toggle off";
      if (elAutosaveToggleLabel) elAutosaveToggleLabel.textContent = "Autosave: OFF";
      if (elAutosaveIcon) elAutosaveIcon.textContent = "⏸️";
      if (elAutosaveTimestamp) elAutosaveTimestamp.textContent = "Autosave Paused";
      if (elSaveProgressPill) elSaveProgressPill.hidden = true;
      return;
    }

    if (btnToggleAutosave) btnToggleAutosave.className = "ide-autosave-toggle";
    if (elAutosaveToggleLabel) elAutosaveToggleLabel.textContent = "Autosave: ON";
    if (elAutosaveIcon) elAutosaveIcon.textContent = "⚡";

    const timeStr = lastSaveTimestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    let pct = 0;
    if (progressStr) {
      const match = progressStr.match(/\((\d+)%\)/);
      if (match) pct = parseInt(match[1], 10);
    }

    if (status === "pending") {
      if (elAutosaveBadge) {
        elAutosaveBadge.className = "ide-autosave-badge pending";
        elAutosaveBadge.title = "Unsaved changes pending autosave...";
      }
      if (elAutosaveDot) elAutosaveDot.className = "autosave-dot pending";
      if (elAutosaveText) elAutosaveText.textContent = "● Unsaved changes";
      if (elAutosaveTimestamp) elAutosaveTimestamp.textContent = "Unsaved changes";

      if (elSaveProgressPill && elSaveProgressText) {
        elSaveProgressPill.hidden = false;
        elSaveProgressPill.className = "ide-save-progress-pill pending";
        elSaveProgressText.textContent = "● Unsaved changes";
        if (elSaveProgressBarFill) elSaveProgressBarFill.style.width = "0%";
      }
    } else if (status === "saving") {
      const progSuffix = progressStr ? ` ${progressStr}` : "";
      if (elAutosaveBadge) {
        elAutosaveBadge.className = "ide-autosave-badge saving";
        elAutosaveBadge.title = `Autosaving code changes...${progSuffix}`;
      }
      if (elAutosaveDot) elAutosaveDot.className = "autosave-dot saving";
      if (elAutosaveText) elAutosaveText.textContent = `● Saving${progSuffix}`;
      if (elAutosaveTimestamp) elAutosaveTimestamp.textContent = `Saving${progSuffix}`;

      if (elSaveProgressPill && elSaveProgressText) {
        elSaveProgressPill.hidden = false;
        elSaveProgressPill.className = "ide-save-progress-pill saving";
        elSaveProgressText.textContent = `⏳ ${progressStr || "Saving..."}`;
        if (elSaveProgressBarFill) elSaveProgressBarFill.style.width = `${Math.max(12, pct)}%`;
      }
    } else if (status === "synced") {
      const progSuffix = progressStr ? ` ${progressStr}` : "";
      if (elAutosaveBadge) {
        elAutosaveBadge.className = "ide-autosave-badge synced";
        elAutosaveBadge.title = `Cloud synchronized at ${timeStr}${progSuffix}`;
      }
      if (elAutosaveDot) elAutosaveDot.className = "autosave-dot synced";
      if (elAutosaveText) elAutosaveText.textContent = `☁️ Synced${progSuffix}`;
      if (elAutosaveTimestamp) elAutosaveTimestamp.textContent = `Cloud synced${progSuffix} · ${timeStr}`;

      if (elSaveProgressPill && elSaveProgressText) {
        elSaveProgressPill.hidden = false;
        elSaveProgressPill.className = "ide-save-progress-pill done";
        elSaveProgressText.textContent = `☁️ ${progressStr || "100% Synced"}`;
        if (elSaveProgressBarFill) elSaveProgressBarFill.style.width = "100%";
        setTimeout(() => {
          if (elSaveProgressPill && elSaveProgressPill.classList.contains("done")) {
            elSaveProgressPill.hidden = true;
          }
        }, 3500);
      }
    } else {
      // ready / saved
      const progSuffix = progressStr ? ` ${progressStr}` : "";
      if (elAutosaveBadge) {
        elAutosaveBadge.className = "ide-autosave-badge";
        elAutosaveBadge.title = `Autosaved locally at ${timeStr}${progSuffix}`;
      }
      if (elAutosaveDot) elAutosaveDot.className = "autosave-dot";
      if (elAutosaveText) elAutosaveText.textContent = customMsg || `✓ Saved ${timeStr}`;
      if (elAutosaveTimestamp) elAutosaveTimestamp.textContent = customMsg || `Saved ${timeStr}`;

      if (elSaveProgressPill && elSaveProgressText) {
        if (progressStr) {
          elSaveProgressPill.hidden = false;
          elSaveProgressPill.className = "ide-save-progress-pill done";
          elSaveProgressText.textContent = `✓ ${progressStr}`;
          if (elSaveProgressBarFill) elSaveProgressBarFill.style.width = "100%";
          setTimeout(() => {
            if (elSaveProgressPill && elSaveProgressPill.classList.contains("done")) {
              elSaveProgressPill.hidden = true;
            }
          }, 3500);
        } else {
          elSaveProgressPill.hidden = true;
        }
      }
    }
  }

  function triggerAutosave(immediate = false) {
    if (!autosaveEnabled) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);

    // Show pending status immediately while typing without displaying false "saving 0%"
    updateAutosaveUI("pending");

    if (immediate) {
      performAutosave();
    } else {
      autosaveTimer = setTimeout(performAutosave, 1000);
    }
  }

  async function performAutosave() {
    if (isAutosaving) return;
    isAutosaving = true;

    try {
      saveCurrentEditorState();

      const pm = window.ProjectManager;
      if (!pm) return;

      const hasChanges = pm.isDirty || (pm.changedFiles && pm.changedFiles.size > 0);
      if (!hasChanges) {
        updateAutosaveUI("ready", "✓ All changes saved");
        return;
      }

      // ONLY save the changes!
      const changedBytes = pm.getChangedSizeBytes() || 512;
      const initialProg = pm.formatSavingProgress(Math.max(1, Math.round(changedBytes * 0.25)), changedBytes);
      updateAutosaveUI("saving", null, initialProg);

      const onProgress = (curr, total, progStr) => {
        updateAutosaveUI("saving", null, progStr);
      };

      // Save changes locally
      await pm.saveChangesOnly(onProgress);

      const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      lastSaveTimestamp = timeStr;
      const finalProgStr = pm.formatSavingProgress(changedBytes, changedBytes);

      if (cloudUser) {
        try {
          await pm.saveToCloud((curr, total, progStr) => {
            updateAutosaveUI("saving", null, progStr);
          }, true);
          pm.markDirty(false);
          updateAutosaveUI("synced", null, finalProgStr);
        } catch (err) {
          pm.markDirty(false);
          updateAutosaveUI("ready", `✓ Saved ${finalProgStr}`, finalProgStr);
        }
      } else {
        pm.markDirty(false);
        updateAutosaveUI("ready", `✓ Saved ${finalProgStr}`, finalProgStr);
      }
      renderProjectHeader();
    } catch (e) {
      console.warn("IDE Autosave error:", e);
    } finally {
      isAutosaving = false;
    }
  }

  function toggleAutosave() {
    autosaveEnabled = !autosaveEnabled;
    localStorage.setItem("lemlib_ide_autosave_enabled", autosaveEnabled ? "true" : "false");
    updateAutosaveUI(autosaveEnabled ? "ready" : "disabled");
    if (autosaveEnabled && window.ProjectManager && window.ProjectManager.isDirty) {
      triggerAutosave(true);
    }
  }

  // -------------------------------------------------------------
  // Rendering UI
  // -------------------------------------------------------------
  function renderProjectHeader() {
    if (elProjectName) elProjectName.textContent = ProjectManager.project?.name || "Override_LemLib_Bot";
    if (elDirtyBadge) elDirtyBadge.hidden = !ProjectManager.isDirty;
  }

  const collapsedFolders = new Set();

  function renderFileTree() {
    if (!elFileTree) return;
    elFileTree.innerHTML = "";

    const files = Object.keys(ProjectManager.project?.files || {}).sort();
    
    const groups = {};
    const rootFiles = [];

    files.forEach(f => {
      const parts = f.split("/");
      if (parts.length > 1) {
        const topDir = parts[0];
        if (!groups[topDir]) groups[topDir] = [];
        groups[topDir].push(f);
      } else {
        rootFiles.push(f);
      }
    });

    const createFolder = (title, fileList, folderKey) => {
      const folderDiv = document.createElement("div");
      folderDiv.className = "ide-folder-group";

      const isCollapsed = collapsedFolders.has(folderKey);

      const header = document.createElement("div");
      header.className = "ide-folder-header";
      header.style.cursor = "pointer";
      header.style.userSelect = "none";
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.title = "Click to expand/collapse folder";
      header.innerHTML = `
        <span>${isCollapsed ? "📁" : "📂"} <strong>${title}</strong></span>
        <span style="font-size:10px; opacity:0.6; margin-left:8px;">${isCollapsed ? "►" : "▼"}</span>
      `;

      header.onclick = (e) => {
        e.stopPropagation();
        if (collapsedFolders.has(folderKey)) {
          collapsedFolders.delete(folderKey);
        } else {
          collapsedFolders.add(folderKey);
        }
        renderFileTree();
      };

      folderDiv.appendChild(header);

      if (!isCollapsed) {
        const listDiv = document.createElement("div");
        listDiv.className = "ide-folder-files";

        fileList.forEach(f => {
          const item = document.createElement("div");
          item.className = `ide-file-item ${f === activeFile ? "active" : ""}`;
          const subPath = f.includes("/") ? f.substring(f.indexOf("/") + 1) : f;
          const icon = f.endsWith(".cpp") ? "📄" : f.endsWith(".h") || f.endsWith(".hpp") ? "📑" : "⚙️";
          item.innerHTML = `<span class="ide-file-icon">${icon}</span> <span class="ide-file-name" title="${f}">${subPath}</span>`;
          item.onclick = (e) => {
            e.stopPropagation();
            switchToFile(f);
          };
          listDiv.appendChild(item);
        });

        folderDiv.appendChild(listDiv);
      }

      return folderDiv;
    };

    const knownKeys = Object.keys(groups);
    const order = ["src", "include"].filter(k => knownKeys.includes(k));
    knownKeys.forEach(k => { if (!order.includes(k)) order.push(k); });

    order.forEach(k => {
      elFileTree.appendChild(createFolder(k, groups[k], k));
    });

    if (rootFiles.length > 0) {
      elFileTree.appendChild(createFolder("Config & Build", rootFiles, "_root"));
    }
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

  function refreshIdeEditorIfActive(filename) {
    if (activeFile === filename && elCodeEditor && window.ProjectManager) {
      const freshContent = window.ProjectManager.getFile(filename);
      if (elCodeEditor.value !== freshContent) {
        elCodeEditor.value = freshContent;
        if (typeof updateEditorLineNumbers === "function") updateEditorLineNumbers();
        if (typeof updateEditorStageHeader === "function") updateEditorStageHeader();
        if (typeof runLiveAnalysis === "function") runLiveAnalysis();
      }
    }
  }
  window.refreshIdeEditorIfActive = refreshIdeEditorIfActive;

  function saveCurrentEditorState() {
    if (activeFile && elCodeEditor && window.ProjectManager) {
      if (window.isSyncingFromPlanner) {
        // Planner is actively updating ProjectManager, refresh textarea from ProjectManager instead
        const latest = window.ProjectManager.getFile(activeFile);
        if (latest && latest !== elCodeEditor.value) {
          elCodeEditor.value = latest;
        }
        return;
      }
      window.ProjectManager.setFile(activeFile, elCodeEditor.value, false);
      if (window.ProjectManager.project) {
        window.ProjectManager.project.lastAutonEditor = "ide";
        window.ProjectManager.project.rawCppPreserved = true;
      }
      if (window.ProjectManager.debounceSaveTimer) {
        clearTimeout(window.ProjectManager.debounceSaveTimer);
        window.ProjectManager.debounceSaveTimer = null;
      }
      window.ProjectManager.saveLocal();
    }
  }

  // Global helper for version restores
  window.refreshIdeEditorIfActive = function(filename) {
    if (filename === activeFile && elCodeEditor && window.ProjectManager) {
      elCodeEditor.value = window.ProjectManager.getFile(filename) || "";
      updateLineNumbers();
      updateCursorAndCharCount();
      scheduleSyntaxHighlight();
    }
  };

  function switchToFile(filename) {
    saveCurrentEditorState();
    if (autosaveEnabled && window.ProjectManager && window.ProjectManager.isDirty) {
      triggerAutosave(true);
    }
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
    if (autosaveEnabled && window.ProjectManager && window.ProjectManager.isDirty) {
      triggerAutosave(true);
    }
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
    lastLineCount = -1;
    updateLineNumbers();
    updateCursorAndCharCount();
    renderSyntaxHighlight();
  }

  function renderSymbols() {
    if (!elSymbolsTree) return;
    const sym = ProjectManager.symbols || ProjectManager.indexVariables();
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

  // -------------------------------------------------------------
  // Syntax Highlighting Engine
  // -------------------------------------------------------------
  const elCodeHighlightInner = document.getElementById("ideCodeHighlightInner");
  const elCodeHighlight = document.getElementById("ideCodeHighlight");

  function escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function highlightCppCode(code) {
    if (!code) return "";

    const tokenRegex = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#\s*(?:include|define|pragma|ifdef|ifndef|endif|else|elif|undef)[^\n]*|\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b(?:void|int|float|double|bool|char|const|return|if|else|while|for|struct|class|public|private|protected|auto|namespace|using|true|false|nullptr|enum|virtual|override|static|sizeof|typedef|switch|case|default|break|continue|extern)\b|\b(?:lemlib|pros|chassis|ControllerSettings|Drivetrain|OdomSensors|TrackingWheel|Controller|Motor|MotorGroup|ADIPiston|Imu|Optical|Distance|Rotation|AngularDirection|DriveSide)\b|\b(?:moveToPoint|moveToPose|turnToHeading|turnToPoint|swingToHeading|swingToPoint|waitUntilDone|waitUntil|setPose|getPose|calibrate|setSensors|set_value|move|move_velocity|brake|delay|autonomous|initialize|opcontrol|disabled)\b|\b(?:x|y|theta|timeout|maxSpeed|minSpeed|earlyExitRange|lead|forwards|async|driveLeft|driveRight|intake|clamp|arm|imu)\b|[{}()\[\]]|::|->|\.|=|==|!=|<=|>=|&&|\|\||[+\-*\/%<>&|^!;,]/g;

    let result = "";
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(code)) !== null) {
      if (match.index > lastIndex) {
        result += escapeHtml(code.substring(lastIndex, match.index));
      }

      const token = match[0];
      const escaped = escapeHtml(token);

      if (token.startsWith("/*") || token.startsWith("//")) {
        result += `<span class="cpp-comment">${escaped}</span>`;
      } else if (token.startsWith('"') || token.startsWith("'")) {
        result += `<span class="cpp-string">${escaped}</span>`;
      } else if (token.startsWith("#")) {
        result += `<span class="cpp-preproc">${escaped}</span>`;
      } else if (/^\d/.test(token) || token.startsWith("0x")) {
        result += `<span class="cpp-number">${escaped}</span>`;
      } else if (/^(void|int|float|double|bool|char|const|return|if|else|while|for|struct|class|public|private|protected|auto|namespace|using|true|false|nullptr|enum|virtual|override|static|sizeof|typedef|switch|case|default|break|continue|extern)$/.test(token)) {
        result += `<span class="cpp-keyword">${escaped}</span>`;
      } else if (/^(lemlib|pros|chassis|ControllerSettings|Drivetrain|OdomSensors|TrackingWheel|Controller|Motor|MotorGroup|ADIPiston|Imu|Optical|Distance|Rotation|AngularDirection|DriveSide)$/.test(token)) {
        result += `<span class="cpp-type">${escaped}</span>`;
      } else if (/^(moveToPoint|moveToPose|turnToHeading|turnToPoint|swingToHeading|swingToPoint|waitUntilDone|waitUntil|setPose|getPose|calibrate|setSensors|set_value|move|move_velocity|brake|delay|autonomous|initialize|opcontrol|disabled)$/.test(token)) {
        result += `<span class="cpp-fn">${escaped}</span>`;
      } else if (/^(x|y|theta|timeout|maxSpeed|minSpeed|earlyExitRange|lead|forwards|async|driveLeft|driveRight|intake|clamp|arm|imu)$/.test(token)) {
        result += `<span class="cpp-member">${escaped}</span>`;
      } else if (/^[{}()\[\]]$/.test(token)) {
        result += `<span class="cpp-bracket">${escaped}</span>`;
      } else if (/^[+\-*\/%<>&|^!;,=]|::|->|\.$/.test(token)) {
        result += `<span class="cpp-operator">${escaped}</span>`;
      } else {
        result += `<span class="cpp-ident">${escaped}</span>`;
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < code.length) {
      result += escapeHtml(code.substring(lastIndex));
    }

    if (code.endsWith("\n")) {
      result += "\n";
    }

    return result;
  }

  function renderSyntaxHighlight() {
    if (!elCodeEditor || !elCodeHighlightInner) return;
    const code = elCodeEditor.value || "";
    elCodeHighlightInner.innerHTML = highlightCppCode(code);
  }

  // -------------------------------------------------------------
  // VS Code IntelliSense Engine & Catalog
  // -------------------------------------------------------------
  const elIntelliSense = document.getElementById("ideIntelliSense");
  const elIntelList = document.getElementById("ideIntelList");
  const elIntelDocDetail = document.getElementById("ideIntelDocDetail");
  const elIntelDocText = document.getElementById("ideIntelDocText");
  const elParamHint = document.getElementById("ideParamHint");
  const elParamSig = document.getElementById("ideParamSig");
  const elParamDoc = document.getElementById("ideParamDoc");

  let intelItems = [];
  let intelSelectedIndex = 0;
  let currentWord = "";
  let currentWordStart = 0;

  const BUILTIN_INTELLISENSE = [
    // Chassis Methods
    {
      name: "moveToPoint",
      kind: "method",
      icon: "⚡",
      label: "moveToPoint(x, y, timeout, params, async)",
      insertSnippet: "moveToPoint(${x}, ${y}, ${timeout});",
      detail: "void chassis.moveToPoint(float x, float y, int timeout, MoveToPointParams params = {}, bool async = true)",
      doc: "Moves the robot chassis to target field coordinates (x, y) in inches using LemLib PID controllers.",
      scope: "chassis"
    },
    {
      name: "moveToPose",
      kind: "method",
      icon: "⚡",
      label: "moveToPose(x, y, theta, timeout, params, async)",
      insertSnippet: "moveToPose(${x}, ${y}, ${theta}, ${timeout});",
      detail: "void chassis.moveToPose(float x, float y, float theta, int timeout, MoveToPoseParams params = {}, bool async = true)",
      doc: "Moves chassis to target (X, Y) coordinate and aligns heading theta (degrees) using Boomerang curve generator.",
      scope: "chassis"
    },
    {
      name: "turnToHeading",
      kind: "method",
      icon: "⚡",
      label: "turnToHeading(theta, timeout, params, async)",
      insertSnippet: "turnToHeading(${theta}, ${timeout});",
      detail: "void chassis.turnToHeading(float theta, int timeout, TurnToHeadingParams params = {}, bool async = true)",
      doc: "Turns chassis to face absolute field heading angle in degrees (0° = North/up).",
      scope: "chassis"
    },
    {
      name: "turnToPoint",
      kind: "method",
      icon: "⚡",
      label: "turnToPoint(x, y, timeout, params, async)",
      insertSnippet: "turnToPoint(${x}, ${y}, ${timeout});",
      detail: "void chassis.turnToPoint(float x, float y, int timeout, TurnToPointParams params = {}, bool async = true)",
      doc: "Turns chassis to face field coordinate (x, y).",
      scope: "chassis"
    },
    {
      name: "swingToHeading",
      kind: "method",
      icon: "⚡",
      label: "swingToHeading(theta, side, timeout, params, async)",
      insertSnippet: "swingToHeading(${theta}, lemlib::DriveSide::LEFT, ${timeout});",
      detail: "void chassis.swingToHeading(float theta, lemlib::DriveSide side, int timeout, SwingToHeadingParams params = {}, bool async = true)",
      doc: "Swings chassis to target heading while locking one side of the drivetrain.",
      scope: "chassis"
    },
    {
      name: "swingToPoint",
      kind: "method",
      icon: "⚡",
      label: "swingToPoint(x, y, side, timeout, params, async)",
      insertSnippet: "swingToPoint(${x}, ${y}, lemlib::DriveSide::LEFT, ${timeout});",
      detail: "void chassis.swingToPoint(float x, float y, lemlib::DriveSide side, int timeout)",
      doc: "Swings chassis to face coordinate (x, y) while locking one side of drivetrain.",
      scope: "chassis"
    },
    {
      name: "waitUntilDone",
      kind: "method",
      icon: "⚡",
      label: "waitUntilDone()",
      insertSnippet: "waitUntilDone();",
      detail: "void chassis.waitUntilDone()",
      doc: "Blocks task execution thread until current asynchronous chassis motion finishes.",
      scope: "chassis"
    },
    {
      name: "waitUntil",
      kind: "method",
      icon: "⚡",
      label: "waitUntil(dist)",
      insertSnippet: "waitUntil(${dist});",
      detail: "void chassis.waitUntil(float dist)",
      doc: "Blocks task execution until chassis is within dist inches of movement destination.",
      scope: "chassis"
    },
    {
      name: "setPose",
      kind: "method",
      icon: "⚡",
      label: "setPose(x, y, theta)",
      insertSnippet: "setPose(${x}, ${y}, ${theta});",
      detail: "void chassis.setPose(float x, float y, float theta)",
      doc: "Sets starting robot position (x, y) and heading angle (theta) for odometry tracking.",
      scope: "chassis"
    },
    {
      name: "getPose",
      kind: "method",
      icon: "⚡",
      label: "getPose()",
      insertSnippet: "getPose()",
      detail: "lemlib::Pose chassis.getPose()",
      doc: "Returns current robot odometer pose struct (x, y, theta).",
      scope: "chassis"
    },
    {
      name: "calibrate",
      kind: "method",
      icon: "⚡",
      label: "calibrate()",
      insertSnippet: "calibrate();",
      detail: "void chassis.calibrate()",
      doc: "Calibrates IMU inertial sensors and odometry encoders.",
      scope: "chassis"
    },

    // Actuator & Motor Methods
    {
      name: "set_value",
      kind: "method",
      icon: "⚡",
      label: "set_value(state)",
      insertSnippet: "set_value(${true});",
      detail: "void pros::ADIPiston::set_value(bool state)",
      doc: "Toggles pneumatic ADI solenoid output (true = extend, false = retract)."
    },
    {
      name: "move",
      kind: "method",
      icon: "⚡",
      label: "move(voltage)",
      insertSnippet: "move(${127});",
      detail: "void pros::Motor::move(int32_t voltage)",
      doc: "Powers motor with raw voltage input (-127 to 127)."
    },
    {
      name: "move_velocity",
      kind: "method",
      icon: "⚡",
      label: "move_velocity(rpm)",
      insertSnippet: "move_velocity(${600});",
      detail: "void pros::Motor::move_velocity(int32_t velocity)",
      doc: "Runs internal motor PID velocity controller at target RPM."
    },
    {
      name: "brake",
      kind: "method",
      icon: "⚡",
      label: "brake()",
      insertSnippet: "brake();",
      detail: "void pros::Motor::brake()",
      doc: "Brakes motor according to active brake mode (coast, hold, brake)."
    },
    {
      name: "delay",
      kind: "method",
      icon: "⚡",
      label: "pros::delay(ms)",
      insertSnippet: "pros::delay(${500});",
      detail: "void pros::delay(uint32_t milliseconds)",
      doc: "Pauses active task thread for specified milliseconds."
    },

    // Struct Properties
    { name: "forwards", kind: "property", icon: "📦", label: "forwards = true", insertSnippet: "forwards = true", detail: "bool forwards", doc: "Drive forward (true) or backward (false)." },
    { name: "maxSpeed", kind: "property", icon: "📦", label: "maxSpeed = 127", insertSnippet: "maxSpeed = 127", detail: "float maxSpeed", doc: "Maximum motor voltage cap (0-127)." },
    { name: "minSpeed", kind: "property", icon: "📦", label: "minSpeed = 0", insertSnippet: "minSpeed = 0", detail: "float minSpeed", doc: "Minimum motor voltage threshold." },
    { name: "earlyExitRange", kind: "property", icon: "📦", label: "earlyExitRange = 2", insertSnippet: "earlyExitRange = 2", detail: "float earlyExitRange", doc: "Distance or angle range to trigger early exit." },

    // Core C++ Keywords & Types
    { name: "chassis", kind: "variable", icon: "📦", label: "chassis", insertSnippet: "chassis.", detail: "lemlib::Chassis chassis", doc: "Main LemLib chassis controller object." },
    { name: "lemlib", kind: "type", icon: "🧱", label: "lemlib", insertSnippet: "lemlib::", detail: "namespace lemlib", doc: "LemLib autonomous motion profiling namespace." },
    { name: "pros", kind: "type", icon: "🧱", label: "pros", insertSnippet: "pros::", detail: "namespace pros", doc: "PROS Kernel C++ API namespace." },
    { name: "void", kind: "keyword", icon: "🔤", label: "void", insertSnippet: "void ", detail: "C++ Type", doc: "Specifies function returns no value." },
    { name: "int", kind: "keyword", icon: "🔤", label: "int", insertSnippet: "int ", detail: "C++ Type", doc: "32-bit signed integer." },
    { name: "float", kind: "keyword", icon: "🔤", label: "float", insertSnippet: "float ", detail: "C++ Type", doc: "Single-precision floating point number." },

    // Snippets
    { name: "for", kind: "snippet", icon: "💬", label: "for loop", insertSnippet: "for (int i = 0; i < 10; i++) {\n    \n}", detail: "C++ For Loop", doc: "Standard counted iteration loop." },
    { name: "while", kind: "snippet", icon: "💬", label: "while loop", insertSnippet: "while (true) {\n    \n    pros::delay(10);\n}", detail: "C++ While Loop", doc: "Condition-checked task loop." },
    { name: "auton", kind: "snippet", icon: "💬", label: "autonomous routine", insertSnippet: "void auton_new_routine() {\n    chassis.setPose(-60, -60, 0);\n    chassis.moveToPoint(-24, -24, 2000);\n}", detail: "LemLib Autonomous Function", doc: "Creates a new autonomous routine." }
  ];

  function getDynamicProjectItems() {
    if (!window.ProjectManager) return [];
    const sym = window.ProjectManager.symbols || window.ProjectManager.indexVariables();
    const items = [];

    sym.motors.forEach(m => {
      items.push({
        name: m.name,
        kind: "variable",
        icon: "⚙️",
        label: `${m.name} (Motor)`,
        insertSnippet: `${m.name}.`,
        detail: `pros::Motor ${m.name}`,
        doc: `V5 Smart Motor declared in ${m.file}`
      });
    });

    sym.pistons.forEach(p => {
      items.push({
        name: p.name,
        kind: "variable",
        icon: "📍",
        label: `${p.name} (ADI Piston)`,
        insertSnippet: `${p.name}.`,
        detail: `pros::ADIPiston ${p.name}`,
        doc: `Pneumatic ADI Solenoid declared in ${p.file}`
      });
    });

    sym.sensors.forEach(s => {
      items.push({
        name: s.name,
        kind: "variable",
        icon: "🧭",
        label: `${s.name} (Sensor)`,
        insertSnippet: `${s.name}.`,
        detail: `${s.type || "Sensor"} ${s.name}`,
        doc: `Hardware sensor declared in ${s.file}`
      });
    });

    sym.functions.forEach(f => {
      items.push({
        name: f.name,
        kind: "method",
        icon: "⚡",
        label: `${f.name}()`,
        insertSnippet: `${f.name}();`,
        detail: `void ${f.name}()`,
        doc: `Project autonomous function declared in ${f.file}`
      });
    });

    return items;
  }

  function updateIntelliSense(forceShow = false) {
    if (!elCodeEditor || !elIntelliSense) return;

    const text = elCodeEditor.value;
    const pos = elCodeEditor.selectionStart;
    const lineUpToPos = text.substring(0, pos);

    // Check if user is inside function signature parentheses e.g. chassis.moveToPose(
    if (checkParameterSignatureHelp(lineUpToPos)) {
      hideIntelliSense();
      return;
    } else {
      hideParamHint();
    }

    // Match word prefix preceding cursor
    const match = /[a-zA-Z0-9_]*$/.exec(lineUpToPos);
    currentWord = match ? match[0] : "";
    currentWordStart = pos - currentWord.length;

    // Check preceding operator (e.g. `chassis.`, `pros::`, `piston.`)
    const lineBeforeWord = lineUpToPos.substring(0, currentWordStart);
    let targetScope = "";
    if (/chassis\.\s*$/.test(lineBeforeWord)) {
      targetScope = "chassis";
    } else if (/\.\s*$/.test(lineBeforeWord) || /->\s*$/.test(lineBeforeWord)) {
      targetScope = "member";
    }

    if (!forceShow && currentWord.length < 1 && !targetScope) {
      hideIntelliSense();
      return;
    }

    const allItems = [...BUILTIN_INTELLISENSE, ...getDynamicProjectItems()];
    const query = currentWord.toLowerCase();

    intelItems = allItems.filter(item => {
      if (targetScope === "chassis") {
        if (item.scope !== "chassis") return false;
      }
      if (query) {
        return item.name.toLowerCase().includes(query) || item.label.toLowerCase().includes(query);
      }
      return true;
    });

    if (intelItems.length === 0) {
      hideIntelliSense();
      return;
    }

    intelSelectedIndex = 0;
    renderIntelliSenseList();
    positionPopupAtCursor();
    elIntelliSense.hidden = false;
    elIntelliSense.style.display = "flex";
  }

  function renderIntelliSenseList() {
    if (!elIntelList) return;
    elIntelList.innerHTML = "";

    intelItems.forEach((item, idx) => {
      const div = document.createElement("div");
      div.className = `ide-intel-item ${idx === intelSelectedIndex ? "selected" : ""}`;
      div.innerHTML = `
        <span class="ide-intel-icon">${item.icon}</span>
        <span class="ide-intel-label">${item.name}</span>
        <span class="ide-intel-kind-tag">${item.kind}</span>
      `;
      div.onclick = (e) => {
        e.stopPropagation();
        intelSelectedIndex = idx;
        acceptSelectedIntelliSense();
      };
      div.onmouseenter = () => {
        intelSelectedIndex = idx;
        renderIntelliSenseList();
        updateDocPane();
      };
      elIntelList.appendChild(div);
    });

    // Ensure selected item scrolls into view
    const selectedEl = elIntelList.children[intelSelectedIndex];
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }

    updateDocPane();
  }

  function updateDocPane() {
    const item = intelItems[intelSelectedIndex];
    if (!item) return;

    if (elIntelDocDetail) elIntelDocDetail.textContent = item.detail || item.name;
    if (elIntelDocText) elIntelDocText.textContent = item.doc || "No documentation available.";
  }

  function positionPopupAtCursor() {
    if (!elCodeEditor || !elIntelliSense) return;

    const text = elCodeEditor.value.substring(0, currentWordStart);
    const lines = text.split("\n");
    const lineIndex = lines.length - 1;
    const colIndex = lines[lineIndex].length;

    const lineHeight = 20; // Matches line-height 20px
    const charWidth = 8.1;  // Consolas 13.5px font width

    let top = (lineIndex + 1) * lineHeight - elCodeEditor.scrollTop + 8;
    let left = colIndex * charWidth - elCodeEditor.scrollLeft + 12;

    // Boundary constraints
    const maxTop = elCodeEditor.clientHeight - 220;
    if (top > maxTop) top = Math.max(8, top - 250);

    const maxLeft = elCodeEditor.clientWidth - 400;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    if (top < 8) top = 8;
    if (left < 8) left = 8;

    elIntelliSense.style.top = `${top}px`;
    elIntelliSense.style.left = `${left}px`;

    if (elParamHint) {
      elParamHint.style.top = `${Math.max(8, top - 45)}px`;
      elParamHint.style.left = `${left}px`;
    }
  }

  function hideIntelliSense() {
    if (elIntelliSense) {
      elIntelliSense.hidden = true;
      elIntelliSense.style.display = "none";
    }
  }

  function acceptSelectedIntelliSense() {
    const item = intelItems[intelSelectedIndex];
    if (!item || !elCodeEditor) return;

    const val = elCodeEditor.value;
    const endPos = elCodeEditor.selectionStart;

    const snippet = item.insertSnippet || item.name;
    // Strip placeholder numbers like ${1:x} -> x or default placeholder
    const cleanSnippet = snippet.replace(/\$\{\d*?:?(.*?)\}/g, "$1").replace(/\$\{(.*?)\}/g, "$1");

    elCodeEditor.value = val.substring(0, currentWordStart) + cleanSnippet + val.substring(endPos);
    
    // Position cursor at sensible position (inside parens if present)
    const parenIdx = cleanSnippet.indexOf("(");
    let newCursorPos = currentWordStart + cleanSnippet.length;
    if (parenIdx !== -1) {
      newCursorPos = currentWordStart + parenIdx + 1;
    }

    elCodeEditor.selectionStart = elCodeEditor.selectionEnd = newCursorPos;
    elCodeEditor.focus();

    hideIntelliSense();
    hideParamHint();
    onEditorChange();
  }

  // Parameter Signature Hint Engine
  function checkParameterSignatureHelp(lineUpToPos) {
    if (!elParamHint || !elParamSig || !elParamDoc) return false;

    // Search for active function call e.g. chassis.moveToPose(10, 20,
    const match = /(chassis|pros|lemlib|[a-zA-Z0-9_]+)\.(moveToPoint|moveToPose|turnToHeading|turnToPoint|swingToHeading|swingToPoint|waitUntil|setPose|set_value|move)\s*\(([^)]*)$/.exec(lineUpToPos);
    if (!match) return false;

    const fnName = match[2];
    const argsStr = match[3];
    const paramCount = argsStr.split(",").length - 1;

    const builtin = BUILTIN_INTELLISENSE.find(b => b.name === fnName);
    if (!builtin) return false;

    const detailParts = builtin.detail.match(/\((.*?)\)/);
    if (!detailParts) return false;

    const params = detailParts[1].split(",").map(p => p.trim());
    if (params.length === 0) return false;

    let sigHtml = `${builtin.name}(`;
    params.forEach((p, i) => {
      if (i === paramCount) {
        sigHtml += `<span class="active-param">${escapeHtml(p)}</span>`;
      } else {
        sigHtml += escapeHtml(p);
      }
      if (i < params.length - 1) sigHtml += ", ";
    });
    sigHtml += ")";

    elParamSig.innerHTML = sigHtml;
    elParamDoc.textContent = builtin.doc;

    positionPopupAtCursor();
    elParamHint.hidden = false;
    elParamHint.style.display = "block";
    return true;
  }

  function hideParamHint() {
    if (elParamHint) {
      elParamHint.hidden = true;
      elParamHint.style.display = "none";
    }
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
  let lastLineCount = -1;
  function updateLineNumbers() {
    if (!elLineNumbers || !elCodeEditor) return;
    const lines = elCodeEditor.value.split("\n").length;
    if (lines === lastLineCount) return;
    lastLineCount = lines;
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

  let highlightRaf = null;
  function scheduleSyntaxHighlight() {
    if (highlightRaf) return;
    highlightRaf = requestAnimationFrame(() => {
      highlightRaf = null;
      renderSyntaxHighlight();
    });
  }

  function onEditorChange() {
    const val = elCodeEditor.value;
    ProjectManager.setFile(activeFile, val, false);
    if (ProjectManager.project) {
      ProjectManager.project.lastAutonEditor = "ide";
      ProjectManager.project.rawCppPreserved = true;
    }
    if (elDirtyBadge) elDirtyBadge.hidden = false;
    updateLineNumbers();
    updateCursorAndCharCount();
    scheduleSyntaxHighlight();
    triggerAutosave(false);
  }

  let intelInputTimer = null;
  function debouncedUpdateIntelliSense() {
    if (intelInputTimer) clearTimeout(intelInputTimer);
    intelInputTimer = setTimeout(() => {
      intelInputTimer = null;
      updateIntelliSense();
    }, 60);
  }

  function wireEditor() {
    if (!elCodeEditor) return;

    elCodeEditor.addEventListener("input", () => {
      onEditorChange();
      debouncedUpdateIntelliSense();
    });

    elCodeEditor.addEventListener("keyup", (e) => {
      updateCursorAndCharCount();
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        debouncedUpdateIntelliSense();
      }
    });

    elCodeEditor.addEventListener("click", () => {
      updateCursorAndCharCount();
      hideIntelliSense();
    });

    elCodeEditor.addEventListener("scroll", () => {
      if (elLineNumbers) elLineNumbers.scrollTop = elCodeEditor.scrollTop;
      if (elCodeHighlight) {
        elCodeHighlight.scrollTop = elCodeEditor.scrollTop;
        elCodeHighlight.scrollLeft = elCodeEditor.scrollLeft;
      }
    });

    // Keyboard shortcuts & IntelliSense navigation
    elCodeEditor.addEventListener("keydown", (e) => {
      // Ctrl + Space to trigger IntelliSense
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
        e.preventDefault();
        updateIntelliSense(true);
        return;
      }

      // If IntelliSense is open
      const isIntelOpen = elIntelliSense && !elIntelliSense.hidden && elIntelliSense.style.display !== "none";
      if (isIntelOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          intelSelectedIndex = (intelSelectedIndex + 1) % intelItems.length;
          renderIntelliSenseList();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          intelSelectedIndex = (intelSelectedIndex - 1 + intelItems.length) % intelItems.length;
          renderIntelliSenseList();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          acceptSelectedIntelliSense();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          hideIntelliSense();
          hideParamHint();
          return;
        }
      }

      // Tab key support in textarea
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
        const pm = window.ProjectManager;
        if (!pm) return;

        const hasChanges = pm.isDirty || (pm.changedFiles && pm.changedFiles.size > 0);
        const saveBytes = hasChanges ? (pm.getChangedSizeBytes() || 512) : pm.getProjectSizeBytes();

        btnSaveCloud.disabled = true;
        const origBtnText = btnSaveCloud.innerHTML;

        const onProgress = (curr, total, progStr) => {
          btnSaveCloud.innerHTML = `⏳ Saving ${progStr}`;
          if (cloudStatus) cloudStatus.textContent = `⏳ ${progStr}`;
          updateAutosaveUI("saving", null, progStr);
        };

        try {
          if (cloudUser) {
            await pm.saveToCloud(onProgress, hasChanges);
            pm.markDirty(false);
            renderProjectHeader();
            const finalStr = pm.formatSavingProgress(saveBytes, saveBytes);
            if (cloudStatus) cloudStatus.textContent = `☁️ Synced ${finalStr}`;
            updateAutosaveUI("synced", null, finalStr);
            btnSaveCloud.innerHTML = `✓ Synced ${finalStr}`;
            setTimeout(() => { btnSaveCloud.innerHTML = origBtnText; btnSaveCloud.disabled = false; }, 2500);
            showToast(`✅ Cloud synced ${finalStr} successfully!`);
          } else {
            await pm.saveChangesOnly(onProgress);
            pm.markDirty(false);
            renderProjectHeader();
            const finalStr = pm.formatSavingProgress(saveBytes, saveBytes);
            if (cloudStatus) cloudStatus.textContent = `💾 Saved ${finalStr}`;
            updateAutosaveUI("ready", `✓ Saved ${finalStr}`, finalStr);
            btnSaveCloud.innerHTML = `✓ Saved ${finalStr}`;
            setTimeout(() => { btnSaveCloud.innerHTML = origBtnText; btnSaveCloud.disabled = false; }, 2500);
            showToast(`💾 Saved locally: ${finalStr} (Sign in with Google to sync to cloud)`);
          }
        } catch (e) {
          await pm.saveChangesOnly(onProgress);
          pm.markDirty(false);
          renderProjectHeader();
          const finalStr = pm.formatSavingProgress(saveBytes, saveBytes);
          if (cloudStatus) cloudStatus.textContent = `💾 Saved ${finalStr}`;
          updateAutosaveUI("ready", `✓ Saved ${finalStr}`, finalStr);
          btnSaveCloud.innerHTML = `✓ Saved ${finalStr}`;
          setTimeout(() => { btnSaveCloud.innerHTML = origBtnText; btnSaveCloud.disabled = false; }, 2500);
          showToast(`💾 Saved locally: ${finalStr}\n(${e.message})`);
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

    // -------------------------------------------------------------
    // Multi-File Project Folder & Archive Import / Export System
    // -------------------------------------------------------------
    function isIgnoredFile(path, size = 0) {
      if (!path) return true;
      const lower = path.toLowerCase().replace(/\\/g, "/");
      const base = path.split(/[\/\\]/).pop();
      if (base.startsWith(".") && base !== ".gitignore" && base !== ".editorconfig") return true;
      if (lower.includes("/.git/") || lower.includes("/.vscode/") || lower.includes("/.idea/") || lower.includes("/bin/") || lower.includes("/build/") || lower.includes("/node_modules/") || lower.includes("/__macosx/") || lower.includes("/firmware/")) return true;
      if (lower.endsWith(".o") || lower.endsWith(".elf") || lower.endsWith(".bin") || lower.endsWith(".hex") || lower.endsWith(".map") || lower.endsWith(".a") || lower.endsWith(".lib") || lower.endsWith(".so") || lower.endsWith(".dylib") || lower.endsWith(".ds_store") || lower.endsWith(".zip") || lower.endsWith(".tar.gz") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".ico") || lower.endsWith(".pdf") || lower.endsWith(".woff") || lower.endsWith(".woff2") || lower.endsWith(".ttf")) return true;
      if (size && size > 2 * 1024 * 1024) return true;
      return false;
    }

    function applyNewImportedProject(projName, filesMap) {
      // Clean up common root prefix if files are double-nested like "MyProject/src/main.cpp"
      const paths = Object.keys(filesMap);
      if (paths.length > 0) {
        const firstSegment = paths[0].split("/")[0];
        if (firstSegment && paths.length > 1 && paths.every(p => p.startsWith(firstSegment + "/"))) {
          const cleanedMap = {};
          const prefix = firstSegment + "/";
          for (const [k, v] of Object.entries(filesMap)) {
            cleanedMap[k.substring(prefix.length)] = v;
          }
          filesMap = cleanedMap;
        }
      }

      const fileCount = Object.keys(filesMap).length;
      if (fileCount === 0) {
        alert("No valid source files found in selected project folder.");
        return;
      }
      window.promptWipeChallenge(`${projName} (${fileCount} files)`, async () => {
        const totalBytes = Object.values(filesMap).reduce((sum, content) => sum + (typeof content === "string" ? content.length : 0), 0);

        if (window.ImportProgressModal) {
          window.ImportProgressModal.show({
            title: "Importing Project Workspace",
            subtitle: `Importing "${projName}" (${fileCount} files)`,
            totalBytes: totalBytes,
            totalFiles: fileCount
          });
        }

        ProjectManager.wipeProject();
        ProjectManager.project = {
          name: projName,
          version: "1.0.0",
          target: "v5",
          kernel: "4.1.0",
          lemlibVersion: "0.5.4",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          files: filesMap,
          activeAuton: "red_rush_auton",
          cloudSynced: false,
          isDefault: false
        };

        if (window.ImportProgressModal) {
          window.ImportProgressModal.update({
            phase: 2,
            pct: 25,
            currentBytes: Math.round(totalBytes * 0.25),
            totalBytes: totalBytes,
            message: "Indexing C++ motor/sensor devices & LemLib symbols..."
          });
        }

        ProjectManager.indexVariables();

        if (window.ImportProgressModal) {
          window.ImportProgressModal.update({
            phase: 3,
            pct: 45,
            currentBytes: Math.round(totalBytes * 0.45),
            totalBytes: totalBytes,
            message: "Writing workspace files to IndexedDB..."
          });
        }

        updateAutosaveUI("saving", null, ProjectManager.formatSavingProgress(Math.round(totalBytes * 0.20), totalBytes));

        await ProjectManager.saveWithProgress((curr, total, progStr) => {
          updateAutosaveUI("saving", null, progStr);
          if (window.ImportProgressModal) {
            const progressBytes = Math.round(totalBytes * 0.45 + (curr / (total || 1)) * (totalBytes * 0.50));
            const pct = Math.min(95, Math.round((progressBytes / totalBytes) * 100));
            window.ImportProgressModal.update({
              phase: 3,
              pct: pct,
              currentBytes: progressBytes,
              totalBytes: totalBytes,
              message: `Persisting to database: ${progStr}`
            });
          }
        });

        if (window.ImportProgressModal) {
          window.ImportProgressModal.update({
            phase: 4,
            pct: 98,
            currentBytes: totalBytes,
            totalBytes: totalBytes,
            message: "Finalizing workspace & autonomous routines..."
          });
        }

        const finalStr = ProjectManager.formatSavingProgress(totalBytes, totalBytes);
        updateAutosaveUI("ready", `✓ Saved ${finalStr}`, finalStr);
        renderProjectHeader();
        renderFileTree();
        renderTabs();

        const fileList = Object.keys(filesMap);
        const mainCpp = fileList.find(f => f === "src/autons.cpp" || f === "src/main.cpp") ||
                        fileList.find(f => f.startsWith("src/") && f.endsWith(".cpp")) ||
                        fileList.find(f => f.endsWith(".cpp") || f.endsWith(".hpp") || f.endsWith(".h")) ||
                        fileList[0];

        if (mainCpp) loadFile(mainCpp);
        renderSymbols();

        if (window.ImportProgressModal) {
          window.ImportProgressModal.finish({
            bytesSynced: totalBytes,
            totalBytes: totalBytes,
            message: `✓ Synced ${fileCount} files (${finalStr})`
          });
        }

        if (cloudUser) {
          try {
            updateAutosaveUI("saving", null, "☁️ Syncing to server...");
            await ProjectManager.saveToCloud(null, false);
            updateAutosaveUI("synced", null, finalStr);
            showToast(`💥 Workspace imported & synced to server! "${projName}" (${fileCount} files).`);
          } catch (cloudErr) {
            console.error("Cloud sync on import failed:", cloudErr);
            showToast(`💥 Workspace imported locally (${fileCount} files). Cloud sync warning: ${cloudErr.message}`);
          }
        } else {
          showToast(`💥 Workspace updated! Imported "${projName}" (${fileCount} files, ${finalStr}).`);
        }
      });
    }

    async function processFolderFiles(fileList) {
      if (!fileList || fileList.length === 0) return;
      const validFiles = Array.from(fileList).filter(f => !isIgnoredFile(f.webkitRelativePath || f.name, f.size));
      if (validFiles.length === 0) {
        alert("No valid C++/header files found in the chosen folder.");
        return;
      }

      let rootFolder = "";
      for (const f of validFiles) {
        const pathStr = f.webkitRelativePath || f.name;
        const parts = pathStr.split(/[\/\\]/);
        if (parts.length > 1 && !rootFolder) {
          rootFolder = parts[0];
        }
      }

      const rootPrefix = rootFolder ? rootFolder + "/" : "";
      const filesMap = {};

      const totalSize = validFiles.reduce((acc, f) => acc + (f.size || 0), 0);
      if (totalSize > 150 * 1024 && window.ImportProgressModal) {
        window.ImportProgressModal.show({
          title: "Reading Folder Contents",
          subtitle: `Scanning ${validFiles.length} project files...`,
          totalBytes: totalSize,
          totalFiles: validFiles.length
        });
      }

      let readBytes = 0;
      for (let i = 0; i < validFiles.length; i++) {
        const f = validFiles[i];
        try {
          const fullPath = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
          let relPath = fullPath;
          if (rootPrefix && relPath.startsWith(rootPrefix)) {
            relPath = relPath.substring(rootPrefix.length);
          }
          if (!relPath) continue;

          const text = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => resolve("");
            reader.readAsText(f);
          });

          filesMap[relPath] = text;
          readBytes += (f.size || text.length);

          if (totalSize > 150 * 1024 && window.ImportProgressModal) {
            const pct = Math.round((i / validFiles.length) * 100);
            window.ImportProgressModal.update({
              phase: 1,
              pct: Math.min(95, pct),
              currentBytes: readBytes,
              totalBytes: totalSize,
              message: "Reading folder files...",
              currentFile: relPath
            });
          }
        } catch (e) {
          console.warn("Error reading file:", f.name, e);
        }
      }

      if (window.ImportProgressModal && totalSize > 150 * 1024) {
        window.ImportProgressModal.hide();
      }

      applyNewImportedProject(rootFolder || "Imported_PROS_Project", filesMap);
    }

    async function processZipFile(zipFile) {
      if (typeof JSZip === "undefined") {
        alert("JSZip library is unavailable. Please check your network connection.");
        return;
      }
      try {
        if (window.ImportProgressModal) {
          window.ImportProgressModal.show({
            title: "Unpacking ZIP Archive",
            subtitle: `Extracting "${zipFile.name}"...`,
            totalBytes: zipFile.size
          });
          window.ImportProgressModal.update({
            phase: 1,
            pct: 15,
            currentBytes: Math.round(zipFile.size * 0.15),
            totalBytes: zipFile.size,
            message: "Decompressing ZIP archive..."
          });
        }

        const zip = await JSZip.loadAsync(zipFile);
        const filesMap = {};
        const entryPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir && !isIgnoredFile(p));

        if (entryPaths.length === 0) {
          if (window.ImportProgressModal) window.ImportProgressModal.hide();
          alert("No source files found in ZIP archive.");
          return;
        }

        let commonPrefix = "";
        const firstPart = entryPaths[0].split(/[\/\\]/)[0];
        if (firstPart && entryPaths.every(p => p.startsWith(firstPart + "/") || p.startsWith(firstPart + "\\"))) {
          commonPrefix = firstPart + "/";
        }

        const projName = commonPrefix ? commonPrefix.replace(/[\/\\]$/, "") : zipFile.name.replace(/\.zip$/i, "");

        let extractedBytes = Math.round(zipFile.size * 0.15);
        for (let i = 0; i < entryPaths.length; i++) {
          const path = entryPaths[i];
          const entry = zip.files[path];
          let relPath = path.replace(/\\/g, "/");
          if (commonPrefix && relPath.startsWith(commonPrefix)) {
            relPath = relPath.substring(commonPrefix.length);
          }
          if (!relPath) continue;

          const text = await entry.async("string");
          filesMap[relPath] = text;
          extractedBytes += (entry._data?.uncompressedSize || text.length);

          if (window.ImportProgressModal) {
            const pct = Math.min(95, Math.round(15 + (i / entryPaths.length) * 80));
            window.ImportProgressModal.update({
              phase: 1,
              pct: pct,
              currentBytes: Math.min(extractedBytes, zipFile.size),
              totalBytes: zipFile.size,
              message: "Extracting archive file...",
              currentFile: relPath
            });
          }
        }

        if (window.ImportProgressModal) {
          window.ImportProgressModal.hide();
        }

        applyNewImportedProject(projName, filesMap);
      } catch (err) {
        if (window.ImportProgressModal) window.ImportProgressModal.hide();
        console.error("ZIP import error:", err);
        alert("Failed to parse ZIP folder: " + err.message);
      }
    }

    async function selectDirectoryWithNativePicker() {
      if (typeof window.showDirectoryPicker === "function") {
        try {
          const dirHandle = await window.showDirectoryPicker({ mode: "read" });
          const filesMap = {};

          async function scanHandle(handle, currentPath = "") {
            for await (const entry of handle.values()) {
              if (entry.kind === "file") {
                if (isIgnoredFile(entry.name)) continue;
                const file = await entry.getFile();
                const text = await file.text();
                const relPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                filesMap[relPath] = text;
              } else if (entry.kind === "directory") {
                if (entry.name === ".git" || entry.name === "bin" || entry.name === "build" || entry.name === ".vscode" || entry.name === "node_modules" || entry.name === "__MACOSX") continue;
                const childPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                await scanHandle(entry, childPath);
              }
            }
          }

          await scanHandle(dirHandle);
          if (Object.keys(filesMap).length > 0) {
            applyNewImportedProject(dirHandle.name, filesMap);
            return true;
          } else {
            alert("No valid source files found in selected folder.");
            return true;
          }
        } catch (err) {
          if (err.name === "AbortError") return true;
          console.warn("Native showDirectoryPicker failed, falling back to input file:", err);
          return false;
        }
      }
      return false;
    }

    async function scanDirectoryEntry(entry, currentPath = "") {
      const map = {};
      if (entry.isFile) {
        const file = await new Promise(res => entry.file(res));
        if (!isIgnoredFile(file.name, file.size)) {
          const text = await file.text();
          const relPath = currentPath ? `${currentPath}/${file.name}` : file.name;
          map[relPath] = text;
        }
      } else if (entry.isDirectory) {
        if (entry.name === ".git" || entry.name === "bin" || entry.name === "build" || entry.name === ".vscode" || entry.name === "node_modules" || entry.name === "__MACOSX" || entry.name === "firmware") return {};
        const dirReader = entry.createReader();
        let entries = [];
        let batch;
        do {
          batch = await new Promise(res => dirReader.readEntries(res));
          entries = entries.concat(batch);
        } while (batch.length > 0);

        for (const child of entries) {
          const childPath = currentPath ? `${currentPath}/${child.name}` : child.name;
          const sub = await scanDirectoryEntry(child, childPath);
          Object.assign(map, sub);
        }
      }
      return map;
    }

    const btnIdeImportProject = document.getElementById("btnIdeImportProject");
    const ideFolderFileInput = document.getElementById("ideFolderFileInput");
    const ideZipFileInput = document.getElementById("ideZipFileInput");

    if (btnIdeImportProject) {
      btnIdeImportProject.onclick = (e) => {
        e.preventDefault();
        if (ideFolderFileInput) {
          ideFolderFileInput.value = "";
          ideFolderFileInput.click();
        }
      };
    }

    if (ideFolderFileInput) {
      ideFolderFileInput.onchange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
          processFolderFiles(e.target.files);
        }
      };
    }

    if (ideZipFileInput) {
      ideZipFileInput.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.name.endsWith(".zip")) {
          processZipFile(file);
        } else {
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              if (data.files) {
                applyNewImportedProject(data.name || file.name.replace(/\.json$/i, ""), data.files);
              }
            } catch (err) { alert("Invalid project JSON"); }
          };
          reader.readAsText(file);
        }
      };
    }

    // Drag and drop handler for folders or zip files directly on file tree sidebar
    const dropTarget = document.getElementById("ideFileTree") || document.querySelector(".ide-sidebar");
    if (dropTarget) {
      dropTarget.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropTarget.classList.add("drag-hover");
      });
      dropTarget.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dropTarget.classList.remove("drag-hover");
      });
      dropTarget.addEventListener("drop", async (e) => {
        e.preventDefault();
        dropTarget.classList.remove("drag-hover");

        const items = e.dataTransfer.items;
        if (items && items.length > 0) {
          const filesMap = {};
          let folderName = "";

          for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
            if (entry) {
              if (entry.isDirectory) {
                if (!folderName) folderName = entry.name;
                const subMap = await scanDirectoryEntry(entry);
                Object.assign(filesMap, subMap);
              } else if (entry.isFile) {
                const file = await new Promise(res => entry.file(res));
                if (!isIgnoredFile(file.name)) {
                  const text = await file.text();
                  filesMap[file.name] = text;
                }
              }
            }
          }

          if (Object.keys(filesMap).length > 0) {
            applyNewImportedProject(folderName || "Imported_Folder", filesMap);
            return;
          }
        }

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          const first = files[0];
          if (first.name.endsWith(".zip")) {
            processZipFile(first);
          } else {
            processFolderFiles(files);
          }
        }
      });
    }

    const btnDownloadCode = document.getElementById("btnDownloadCode");
    if (btnDownloadCode) {
      btnDownloadCode.addEventListener("click", () => {
        saveCurrentEditorState();
        const choices = prompt(
          `Select download format:\n1 = Active File (${activeFile})\n2 = Complete Multi-File Project Folder (.zip Archive)`,
          "2"
        );
        if (choices === "1") {
          window.ProjectManager.downloadFile(activeFile);
        } else if (choices === "2") {
          window.ProjectManager.exportProjectZip();
        }
      });
    }

    const btnVersionsIDE = document.getElementById("btnVersionHistoryIDE");
    if (btnVersionsIDE) {
      btnVersionsIDE.addEventListener("click", () => {
        saveCurrentEditorState();
        if (window.ProjectManager) {
          window.ProjectManager.openVersionHistoryModal(activeFile);
        }
      });
    }

    // Consolidated IDE Project Dropdown
    const btnIdeProjectDropdown = document.getElementById("btnIdeProjectDropdown");
    const ideProjectMenu = document.getElementById("ideProjectMenu");
    if (btnIdeProjectDropdown && ideProjectMenu) {
      btnIdeProjectDropdown.addEventListener("click", (e) => {
        e.stopPropagation();
        ideProjectMenu.hidden = !ideProjectMenu.hidden;
      });
      document.addEventListener("click", (e) => {
        if (!ideProjectMenu.contains(e.target) && e.target !== btnIdeProjectDropdown) {
          ideProjectMenu.hidden = true;
        }
      });
    }

    // Interactive Tutorial Trigger in IDE
    const btnIdeOpenTutorial = document.getElementById("btnIdeOpenTutorial");
    if (btnIdeOpenTutorial) {
      btnIdeOpenTutorial.addEventListener("click", () => {
        if (ideProjectMenu) ideProjectMenu.hidden = true;
        if (typeof window.openTutorial === "function") {
          window.openTutorial(0);
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
    const btnModalSimulateBrain = document.getElementById("btnModalSimulateBrain");
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

    if (btnModalSimulateBrain) {
      btnModalSimulateBrain.addEventListener("click", () => {
        if (!window.V5BrainSerial) return;
        window.V5BrainSerial.connectSimulated();
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
    const navigateToPlanner = async () => {
      saveCurrentEditorState();
      if (window.ProjectManager) {
        window.ProjectManager.createVersionSnapshot(
          activeFile || "src/autons.cpp",
          "ide",
          `Preserved Raw C++ before visiting Planner (${activeFile || "src/autons.cpp"})`
        );
        if (window.ProjectManager.project) {
          window.ProjectManager.project.lastAutonEditor = "ide";
          window.ProjectManager.project.rawCppPreserved = true;
          window.ProjectManager.project.updatedAt = Date.now();
        }
        await window.ProjectManager.saveLocal();
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
        btnNavGuardSaveAndReturn.disabled = true;
        const onProgress = (curr, total, progStr) => {
          btnNavGuardSaveAndReturn.textContent = `💾 Saving ${progStr}...`;
        };
        try {
          if (cloudUser) {
            await ProjectManager.saveToCloud(onProgress);
          } else {
            await ProjectManager.saveWithProgress(onProgress);
          }
        } catch (e) {
          await ProjectManager.saveWithProgress(onProgress);
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

  function showToast(message, type = "success") {
    let container = document.getElementById("ideToastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "ideToastContainer";
      container.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.style.cssText = `background:${type === 'error' ? '#dc2626' : '#1e293b'};color:#fff;padding:10px 16px;border-radius:8px;font-size:0.85rem;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid ${type === 'error' ? '#ef4444' : '#334155'};pointer-events:auto;transition:all 0.3s ease;opacity:0;transform:translateY(10px);`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    }, 10);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Run on DOM Ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
