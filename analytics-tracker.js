// Global analytics tracker script for all VEX V5 suite pages
(function() {
  const path = window.location.pathname.toLowerCase();
  let pageKey = 'home';
  if (path.includes('ide.html') || path.endsWith('/ide')) pageKey = 'ide';
  else if (path.includes('translator.html') || path.endsWith('/translator')) pageKey = 'translator';
  else if (path.includes('tools.html') || path.endsWith('/tools')) pageKey = 'tools';
  else if (path.includes('team.html') || path.endsWith('/team')) pageKey = 'team';
  else if (path.includes('admin.html') || path.endsWith('/admin')) pageKey = 'admin';
  else if (path.includes('documentation.html') || path.includes('docs.html') || path.includes('/docs')) pageKey = 'documentation';
  else if (path.includes('stats.html') || path.endsWith('/stats')) pageKey = 'stats';
  else if (path === '/' || path.endsWith('/vex-path-planner/') || path.endsWith('/vex-path-planner/index.html') || path.endsWith('/index.html')) pageKey = 'home';

  let clientId = localStorage.getItem('vex_client_id');
  if (!clientId) {
    clientId = 'user_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('vex_client_id', clientId);
  }

  // Ensure tracking happens once per page session
  const sessionKey = 'tracked_' + pageKey;
  if (sessionStorage.getItem(sessionKey)) return;
  sessionStorage.setItem(sessionKey, 'true');

  window.addEventListener('DOMContentLoaded', async () => {
    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        const db = firebase.firestore();
        const statsRef = db.collection('stats').doc('summary');

        await db.runTransaction(async (transaction) => {
          const doc = await transaction.get(statsRef);
          const now = Date.now();
          if (!doc.exists) {
            const initialPages = { home: 0, ide: 0, translator: 0, stats: 0, tools: 0, team: 0, admin: 0, documentation: 0, other: 0 };
            initialPages[pageKey] = 1;
            transaction.set(statsRef, {
              totalViews: 1,
              pages: initialPages,
              visitors: [{ timestamp: new Date().toISOString(), page: pageKey }],
              updatedAt: now
            });
          } else {
            const d = doc.data();
            const totalViews = (d.totalViews || 0) + 1;
            const pages = d.pages || { home: 0, ide: 0, translator: 0, stats: 0, tools: 0, team: 0, admin: 0, documentation: 0, other: 0 };
            pages[pageKey] = (pages[pageKey] || 0) + 1;
            const visitors = d.visitors || [];
            visitors.unshift({ timestamp: new Date().toISOString(), page: pageKey });
            if (visitors.length > 50) visitors.pop();

            transaction.set(statsRef, {
              totalViews,
              pages,
              visitors,
              updatedAt: now
            }, { merge: true });
          }
        });
      }
    } catch (e) {
      console.warn("Analytics tracker warning:", e);
    }
  });
})();
