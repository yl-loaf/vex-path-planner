// Universal Ad Injection Script for Every Page
(function() {
  // 1. Inject Social Bar in head immediately
  if (!document.getElementById('bauval-social-bar')) {
    const sb = document.createElement('script');
    sb.id = 'bauval-social-bar';
    sb.dataset.cfasync = 'false';
    sb.src = 'https://bauval.org/14/b763deb66ca0c9cc39ca0059f4ddfc64';
    document.head.appendChild(sb);
  }

  // Helper to create a reliable 728x90 banner element
  function createBanner728() {
    const bannerDiv = document.createElement('div');
    bannerDiv.className = 'injected-banner-728';
    bannerDiv.style.cssText = 'margin: 24px auto; display: flex; justify-content: center; overflow: hidden; max-width: 100%; width: 728px; height: 90px; z-index: 100; position: relative; background: rgba(0,0,0,0.02); min-height: 90px;';
    
    const scriptOpt = document.createElement('script');
    scriptOpt.textContent = `
      window.atOptions = {
        'key' : 'ac881f7d1373b8450cf069994b060139',
        'format' : 'iframe',
        'height' : 90,
        'width' : 728,
        'params' : {}
      };
    `;
    const scriptSrc = document.createElement('script');
    scriptSrc.async = true;
    scriptSrc.src = 'https://bauval.org/22/ac881f7d1373b8450cf069994b060139';

    bannerDiv.appendChild(scriptOpt);
    bannerDiv.appendChild(scriptSrc);
    return bannerDiv;
  }

  // 2. Inject ads on DOMContentLoaded across all pages
  document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname.toLowerCase();
    const container = document.querySelector('.stats-container, .homepage-container, .ide-container, .tools-container, .team-container, .admin-container, .docs-container, main, body');
    if (!container) return;

    // A. Top Banner 728x90
    if (!container.querySelector('#top-banner-728')) {
      const topBanner = createBanner728();
      topBanner.id = 'top-banner-728';
      container.insertBefore(topBanner, container.firstChild);
    }

    // B. Bottom Banner 728x90 (replacing oversized ads) + Smartlink
    if (!container.querySelector('#bottom-banner-728')) {
      const bottomDiv = document.createElement('div');
      bottomDiv.id = 'bottom-banner-728';
      bottomDiv.style.cssText = 'margin: 36px auto 24px auto; display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%;';
      
      const bottomBanner = createBanner728();
      const smartLinkDiv = document.createElement('div');
      smartLinkDiv.style.cssText = 'text-align: center; font-family: monospace; font-size: 0.78rem;';
      smartLinkDiv.innerHTML = '<a href="https://araplhn.org/4/8f50230ecf2eda8da66a1cf6e107bd91" target="_blank" rel="noopener" style="color: var(--cyan, #38bdf8); text-decoration: underline;">[Sponsored Resource &amp; Partner Network]</a>';

      bottomDiv.appendChild(bottomBanner);
      bottomDiv.appendChild(smartLinkDiv);
      container.appendChild(bottomDiv);
    }

    // C. Insert 728x90 banners between rows and sections in Tools, Documentation, and Team pages
    if (path.includes('tools.html') || path.includes('documentation.html') || path.includes('team.html')) {
      const sections = container.querySelectorAll('.tools-section, .docs-section, .team-card, .tool-card, section, article, .row');
      if (sections.length > 1) {
        let count = 0;
        sections.forEach((sec, idx) => {
          count++;
          if (count % 2 === 0 && idx < sections.length - 1) {
            const midBanner = createBanner728();
            midBanner.style.margin = '32px auto';
            sec.parentNode.insertBefore(midBanner, sec.nextSibling);
          }
        });
      }
    }
  });
})();
