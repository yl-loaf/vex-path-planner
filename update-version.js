import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function updateBuildVersion() {
  const versionFile = path.join(__dirname, 'version.js');
  let currentContent = '';
  if (fs.existsSync(versionFile)) {
    currentContent = fs.readFileSync(versionFile, 'utf8');
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayPrefix = `${y}${m}${d}`;

  let nextBuild = '';
  const explicitBuild = process.env.BUILD_NUMBER || process.env.APP_BUILD;

  if (explicitBuild) {
    nextBuild = explicitBuild;
  } else {
    // Check if there is an existing build in version.js
    const match = currentContent.match(/APP_BUILD\s*=\s*["']([^"']+)["']/);
    const currentBuild = match ? match[1] : '';

    const kMatch = currentBuild.match(new RegExp(`^${todayPrefix}\\.k(\\d+)`));
    if (kMatch) {
      const nextNum = parseInt(kMatch[1], 10) + 1;
      nextBuild = `${todayPrefix}.k${nextNum}`;
    } else {
      nextBuild = `${todayPrefix}.k1`;
    }
  }

  // Update version.js
  const outputContent = `// Auto-displayed build; bump this when you deploy\nwindow.APP_BUILD = "${nextBuild}";\n`;
  fs.writeFileSync(versionFile, outputContent, 'utf8');
  console.log(`[build] Updated version.js to build: ${nextBuild}`);

  // Also update cache-busting query strings in index.html, ide.html, translator.html
  const htmlFiles = ['index.html', 'ide.html', 'translator.html'];
  for (const f of htmlFiles) {
    const filePath = path.join(__dirname, f);
    if (fs.existsSync(filePath)) {
      let html = fs.readFileSync(filePath, 'utf8');
      html = html.replace(/(style\.css\?v=)[^"']+/g, `$1${nextBuild}`);
      html = html.replace(/(version\.js\?v=)[^"']+/g, `$1${nextBuild}`);
      html = html.replace(/(app\.js\?v=)[^"']+/g, `$1${nextBuild}`);
      html = html.replace(/(ide\.js\?v=)[^"']+/g, `$1${nextBuild}`);
      html = html.replace(/(project-manager\.js\?v=)[^"']+/g, `$1${nextBuild}`);
      html = html.replace(/(v5-brain-serial\.js\?v=)[^"']+/g, `$1${nextBuild}`);
      html = html.replace(/(firebase-config\.js\?v=)[^"']+/g, `$1${nextBuild}`);
      fs.writeFileSync(filePath, html, 'utf8');
      console.log(`[build] Updated asset cache-busters in ${f} to ${nextBuild}`);
    }
  }

  return nextBuild;
}

// Run when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateBuildVersion();
}
