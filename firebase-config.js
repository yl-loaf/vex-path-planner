// Firebase web config for VEX Path Planner
// Loaded before app.js and ide.js (compat SDK from CDN)
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBkuohuTTM78VwGqXZARPV39lE-Iy4ldIY",
  authDomain: "vex-path-planner.firebaseapp.com",
  projectId: "vex-path-planner",
  storageBucket: "vex-path-planner.firebasestorage.app",
  messagingSenderId: "279801221836",
  appId: "1:279801221836:web:465abca3acc11df3ada869",
  measurementId: "G-XGTSE1D700",
};

// Set true so Google sign-in + cloud path sync are active
window.FIREBASE_ENABLED = true;

// Utility to resolve backend API URLs (supporting cross-origin static hosts like GitHub Pages)
window.getApiUrl = function(path) {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".run.app")) {
    return path;
  }
  const backendBase = "https://ais-dev-fzuazthy5hd4fsmf2jzdep-555640893330.asia-southeast1.run.app";
  return backendBase + path;
};

// Auto-initialize default Firebase App if compat SDK is present
if (typeof firebase !== "undefined" && firebase.initializeApp) {
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
    }
  } catch (e) {
    console.warn("Firebase initialization warning:", e);
  }
}
