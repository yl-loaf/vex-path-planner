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

  // 2. Inject Banner 728x90 at top and Native Banner + Smartlink at bottom on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.querySelector('.stats-container, .homepage-container, .ide-container, .tools-container, .team-container, .admin-container, .docs-container, main, body');
    if (!container) return;

    // Top Banner 728x90
    if (!document.getElementById('injected-banner-728')) {
      const bannerDiv = document.createElement('div');
      bannerDiv.id = 'injected-banner-728';
      bannerDiv.style.cssText = 'margin: 20px auto; display: flex; justify-content: center; overflow: hidden; max-width: 100%; z-index: 100; position: relative;';
      
      const scriptOpt = document.createElement('script');
      scriptOpt.textContent = `
        atOptions = {
          'key' : 'ac881f7d1373b8450cf069994b060139',
          'format' : 'iframe',
          'height' : 90,
          'width' : 728,
          'params' : {}
        };
      `;
      const scriptSrc = document.createElement('script');
      scriptSrc.src = 'https://bauval.org/22/ac881f7d1373b8450cf069994b060139';

      bannerDiv.appendChild(scriptOpt);
      bannerDiv.appendChild(scriptSrc);

      container.insertBefore(bannerDiv, container.firstChild);
    }

    // Bottom Native Banner & Smartlink
    if (!document.getElementById('injected-native-smartlink')) {
      const bottomDiv = document.createElement('div');
      bottomDiv.id = 'injected-native-smartlink';
      bottomDiv.style.cssText = 'margin: 36px auto 24px auto; display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%;';

      const nativeScript = document.createElement('script');
      nativeScript.async = true;
      nativeScript.dataset.cfasync = 'false';
      nativeScript.src = 'https://bauval.org/21/82587de86e8b36bf614466d2b29a09c6';

      const nativeContainer = document.createElement('div');
      nativeContainer.id = 'container-82587de86e8b36bf614466d2b29a09c6';

      const smartLinkDiv = document.createElement('div');
      smartLinkDiv.style.cssText = 'text-align: center; font-family: monospace; font-size: 0.78rem; margin-top: 8px;';
      smartLinkDiv.innerHTML = '<a href="https://araplhn.org/4/8f50230ecf2eda8da66a1cf6e107bd91" target="_blank" rel="noopener" style="color: var(--cyan, #38bdf8); text-decoration: underline;">[Sponsored Resource &amp; Partner Network]</a>';

      bottomDiv.appendChild(nativeScript);
      bottomDiv.appendChild(nativeContainer);
      bottomDiv.appendChild(smartLinkDiv);

      container.appendChild(bottomDiv);
    }
  });
})();
