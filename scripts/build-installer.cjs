// Builds the Windows installer from desktop/dist/win-unpacked using the
// native NSIS compiler (makensis), so it works on Windows, Linux or macOS.
//   node scripts/build-installer.cjs
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const desktop = path.join(__dirname, '..', 'desktop');
const { version } = require(path.join(desktop, 'package.json'));
const src = path.join(desktop, 'dist', 'win-unpacked');
const out = path.join(desktop, 'dist', `Baithak-Setup-${version}.exe`);
if (!fs.existsSync(path.join(src, 'Baithak.exe'))) {
  console.error('desktop/dist/win-unpacked is missing. Run the Windows build first.');
  process.exit(1);
}
const candidates = ['makensis', 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'];
const makensis = candidates.find((c) => c === 'makensis' || fs.existsSync(c));
execFileSync(makensis, ['-V2', `-DVERSION=${version}`, `-DSRC=${src}`, `-DOUT=${out}`, path.join(desktop, 'installer', 'baithak.nsi')], {
  stdio: 'inherit',
});
console.log('installer written to', out);
