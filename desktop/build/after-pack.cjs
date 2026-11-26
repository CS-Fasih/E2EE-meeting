// electron-builder normally edits the Windows .exe resources with rcedit,
// which needs Wine when building on Linux. Instead, set the icon and version
// details here with resedit (pure JavaScript), so Windows builds work from
// any OS.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const { productFilename } = context.packager.appInfo;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [maj, min, pat] = version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(maj, min, pat, 0, 1033);
  vi.setProductVersion(maj, min, pat, 0, 1033);
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      CompanyName: 'Baithak contributors',
      FileDescription: 'Baithak - private video meetings',
      ProductName: 'Baithak',
      InternalName: 'Baithak',
      OriginalFilename: `${productFilename}.exe`,
      LegalCopyright: 'Copyright (c) 2026 CS-Fasih and Baithak contributors. Non-commercial use only.',
      FileVersion: version,
      ProductVersion: version,
    },
  );
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • set icon and version info on', path.basename(exePath));
};
