// theme.js - Shared High-Contrast Theme Switcher Engine for VEX V5 LemLib Suite
(function () {
  "use strict";

  const STORAGE_KEY = "vex_theme";

  // Determine initial theme
  function getPreferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
    // Fallback default is dark, but respects user OS preference if light
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  }

  function applyTheme(theme, save = true) {
    const root = document.documentElement;
    const isLight = theme === "light";
    
    root.setAttribute("data-theme", theme);
    if (document.body) {
      document.body.setAttribute("data-theme", theme);
    }
    
    if (save) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (e) {
        // Ignore storage access errors in restricted iframe
      }
    }

    // Update all theme toggle buttons on the active page
    updateToggleButtons(isLight);

    // Dispatch global custom event for any embedded components or charts
    window.dispatchEvent(new CustomEvent("vex-theme-changed", { detail: { theme, isLight } }));
  }

  function updateToggleButtons(isLight) {
    const buttons = document.querySelectorAll(".btn-theme-toggle, [data-theme-toggle]");
    buttons.forEach((btn) => {
      btn.setAttribute("aria-pressed", isLight ? "true" : "false");
      btn.setAttribute(
        "title",
        isLight
          ? "Currently Light Theme · Click to switch to Dark Theme"
          : "Currently Dark Theme · Click to switch to High-Contrast Light Theme"
      );

      // Icon & Label updates
      const iconEl = btn.querySelector(".theme-toggle-icon");
      const labelEl = btn.querySelector(".theme-toggle-text, .theme-toggle-label");
      
      if (iconEl) {
        iconEl.textContent = isLight ? "☀️" : "🌙";
      }
      if (labelEl) {
        labelEl.textContent = isLight ? "Light" : "Dark";
      }
    });
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || getPreferredTheme();
    const nextTheme = current === "light" ? "dark" : "light";
    applyTheme(nextTheme, true);
    return nextTheme;
  }

  // Expose globally
  window.vexTheme = {
    getTheme: () => document.documentElement.getAttribute("data-theme") || getPreferredTheme(),
    setTheme: (t) => applyTheme(t, true),
    toggleTheme: toggleTheme,
    isLight: () => (document.documentElement.getAttribute("data-theme") || getPreferredTheme()) === "light"
  };

  // Sync across tabs & storage updates
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark")) {
      applyTheme(e.newValue, false);
    }
  });

  // Attach event handlers once DOM is ready
  function init() {
    const currentTheme = getPreferredTheme();
    applyTheme(currentTheme, false);

    document.addEventListener("click", (e) => {
      const toggleBtn = e.target.closest(".btn-theme-toggle, [data-theme-toggle]");
      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
