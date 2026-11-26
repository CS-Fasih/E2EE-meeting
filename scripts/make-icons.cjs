// Renders the app icon from SVG into the PNG and ICO files the desktop and
// Android builds need. Uses the Chromium that Playwright provides.
//   node scripts/make-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');

// Arch doorway with a lattice (jaali) inside and a turmeric eight-point star.
function iconSvg({ rounded = true } = {}) {
  const lattice = [];
  for (let x = 300; x <= 724; x += 53) lattice.push(`M${x} 300V860`);
  for (let y = 380; y <= 860; y += 53) lattice.push(`M300 ${y}H724`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <clipPath id="arch"><path d="M292 868V470C292 330 410 236 512 196C614 236 732 330 732 470V868Z"/></clipPath>
  </defs>
  <rect width="1024" height="1024" rx="${rounded ? 228 : 0}" fill="#1e2446"/>
  <path d="M292 868V470C292 330 410 236 512 196C614 236 732 330 732 470V868Z" fill="#161a33"/>
  <g clip-path="url(#arch)" stroke="#2c356d" stroke-width="6" fill="none"><path d="${lattice.join('')}"/></g>
  <path d="M292 868V470C292 330 410 236 512 196C614 236 732 330 732 470V868" fill="none" stroke="#f1efe6" stroke-width="40" stroke-linejoin="round" stroke-linecap="round"/>
  <g fill="none" stroke="#e6b43d" stroke-width="30" stroke-linejoin="round">
    <rect x="436" y="512" width="152" height="152"/>
    <path d="M512 480 620 588 512 696 404 588Z"/>
  </g>
  <path d="M232 868H792" stroke="#f1efe6" stroke-width="40" stroke-linecap="round"/>
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
