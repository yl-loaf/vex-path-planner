import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cropped tightly so the graphic is as big and prominent as possible
// Colors:
// Green: #36BF50 (vibrant LemLib / robotics path green)
// Red: #D32F2F (competition VEX red)
// Gear: #36BF50

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="subtle-shadow" x="-5%" y="-5%" width="110%" height="110%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.15" />
    </filter>
  </defs>

  <!-- Green Autonomous S-Curve Path -->
  <g filter="url(#subtle-shadow)">
    <!-- Path Line -->
    <path 
      d="M 52 435 
         C 140 435, 290 445, 305 375
         C 320 305, 175 320, 150 250
         C 125 185, 195 140, 295 145" 
      fill="none" 
      stroke="#36BF50" 
      stroke-width="32" 
      stroke-linecap="round" 
      stroke-linejoin="round"
    />

    <!-- Waypoint Nodes on the Path -->
    <circle cx="52" cy="435" r="18" fill="#36BF50" />
    <circle cx="305" cy="375" r="18" fill="#36BF50" />
    <circle cx="195" cy="285" r="18" fill="#36BF50" />
    <circle cx="150" cy="250" r="18" fill="#36BF50" />

    <!-- Trajectory Arrowhead pointing northeast directly into the V -->
    <polygon 
      points="360,140 255,92 265,190" 
      fill="#36BF50" 
    />
  </g>

  <!-- Green Gear under the V apex -->
  <g filter="url(#subtle-shadow)">
    <!-- Gear teeth radiating around the lower half of the V apex -->
    <path 
      d="M 335 240
         L 322 250 L 320 264 L 332 268
         L 332 278 L 344 286 L 356 280
         L 364 294 L 380 298 L 388 288
         L 402 296 L 416 288 L 416 274
         L 430 270 L 434 256 L 424 246
         L 412 242
         C 410 268, 350 268, 346 242 Z"
      fill="#36BF50"
    />
    <circle cx="376" cy="245" r="16" fill="#ffffff" />
  </g>

  <!-- Red VEX 'V' Logo Element -->
  <g filter="url(#subtle-shadow)">
    <polygon 
      points="320,88 366,88 382,196 398,88 444,88 398,245 366,245" 
      fill="#D32F2F" 
    />
  </g>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'favicon.svg'), svgContent, 'utf-8');
console.log('Saved favicon.svg');

// Render PNGs at various resolutions
const sizes = [
  { name: 'favicon-16x16.png', width: 16, height: 16 },
  { name: 'favicon-32x32.png', width: 32, height: 32 },
  { name: 'favicon-48x48.png', width: 48, height: 48 },
  { name: 'apple-touch-icon.png', width: 180, height: 180 },
  { name: 'android-chrome-192x192.png', width: 192, height: 192 },
  { name: 'android-chrome-512x512.png', width: 512, height: 512 },
  { name: 'favicon.png', width: 128, height: 128 }
];

const pngBuffers = {};

for (const s of sizes) {
  const resvg = new Resvg(svgContent, {
    fitTo: {
      mode: 'width',
      value: s.width
    }
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  fs.writeFileSync(path.join(__dirname, s.name), pngBuffer);
  pngBuffers[s.width] = pngBuffer;
  console.log(`Generated ${s.name} (${s.width}x${s.height})`);
}

// Generate Windows/Browser ICO containing 16x16, 32x32, and 48x48 PNG icons
function createIco(buffers) {
  const count = buffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const headerAndDirSize = headerSize + count * dirEntrySize;

  let offset = headerAndDirSize;
  const entries = [];

  for (const item of buffers) {
    const w = item.width >= 256 ? 0 : item.width;
    const h = item.height >= 256 ? 0 : item.height;
    const size = item.buffer.length;

    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(w, 0); // Width
    entry.writeUInt8(h, 1); // Height
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(size, 8); // Size of image data in bytes
    entry.writeUInt32LE(offset, 12); // Offset of image data

    entries.push({ entry, buffer: item.buffer });
    offset += size;
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // ICO type (1 for icon)
  header.writeUInt16LE(count, 4); // Number of images

  const totalSize = offset;
  const finalIco = Buffer.concat([
    header,
    ...entries.map(e => e.entry),
    ...entries.map(e => e.buffer)
  ], totalSize);

  return finalIco;
}

const icoBuffer = createIco([
  { width: 16, height: 16, buffer: pngBuffers[16] },
  { width: 32, height: 32, buffer: pngBuffers[32] },
  { width: 48, height: 48, buffer: pngBuffers[48] }
]);

fs.writeFileSync(path.join(__dirname, 'favicon.ico'), icoBuffer);
console.log(`Generated favicon.ico (${icoBuffer.length} bytes)`);
