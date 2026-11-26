// Renders the app icon from SVG into the PNG and ICO files the desktop and
// Android builds need. Uses the Chromium that Playwright provides.
//   node scripts/make-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');

// Handshake symbol (Material Symbols, Apache 2.0) in white on the brand blue.
const HANDSHAKE = require('node:fs')
  .readFileSync(path.join(root, 'web', 'node_modules', '@material-symbols', 'svg-400', 'rounded', 'handshake-fill.svg'), 'utf8')
  .match(/ d="([^"]+)"/)[1];

function iconSvg({ rounded = true } = {}) {
  // Glyph spans 960 units; draw it 600 units wide, centred in 1024.
  const scale = 600 / 960;
  const tx = (1024 - 600) / 2;
  const ty = (1024 - 600) / 2 + 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" rx="${rounded ? 232 : 0}" fill="#0b57d0"/>
  <path fill="#ffffff" transform="translate(${tx} ${ty}) scale(${scale})" d="${HANDSHAKE}"/>
</svg>`;
}

function ico(pngs) {
  // ICO with PNG-compressed entries (supported since Windows Vista).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (svg, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`,
    );
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  const svg = iconSvg();
  fs.mkdirSync(path.join(root, 'desktop', 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'desktop', 'build', 'icon.png'), await render(svg, 512));
  fs.writeFileSync(path.join(root, 'desktop', 'build', 'icon-1024.png'), await render(svg, 1024));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) pngs.push({ size, data: await render(svg, size) });
  fs.writeFileSync(path.join(root, 'desktop', 'build', 'icon.ico'), ico(pngs));
  fs.writeFileSync(path.join(root, 'web', 'public', 'icon-512.png'), await render(svg, 512));
  fs.writeFileSync(path.join(root, 'docs', 'icon.png'), await render(svg, 256));
  await browser.close();
  console.log('icons written');
})();
