// Copies the built web app (web/dist) into a desktop or Android project.
//   node scripts/copy-web.cjs <destination>
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'web', 'dist');
const dest = path.resolve(process.argv[2] || '');
if (!process.argv[2]) {
  console.error('usage: copy-web.cjs <destination>');
  process.exit(1);
}
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('web/dist is missing. Run "npm run build" in web/ first.');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`copied web app to ${dest}`);
