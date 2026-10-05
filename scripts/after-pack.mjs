// electron-builder afterPack hook (electron-builder.yml): runs on each packed app, before
// signing. macOS: the app icon comes from build-resources/Isoline.icon (Icon Composer),
// which electron-builder compiles with actool into Contents/Resources/Assets.car and names
// in Info.plist (CFBundleIconName): macOS 26+ draws its own surfaces (Game Mode, the
// notifications, the menu bar, the Dock) from it. The icns it derives from the .icon only
// goes up to 256 px, so the hand-drawn one (16 → 1024, simplified at 16 and 32) replaces it
// for macOS 12 to 25, which read CFBundleIconFile.
import fs from 'node:fs';
import path from 'node:path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resources = path.join(app, 'Contents', 'Resources');
  const icns = path.join(context.packager.info.projectDir, 'build-resources', 'icon.icns');
  if (!fs.existsSync(path.join(resources, 'Assets.car')))
    throw new Error(
      `afterPack: no Assets.car in ${resources} (is mac.icon the .icon file, Xcode 26+ installed?)`,
    );
  fs.copyFileSync(icns, path.join(resources, 'icon.icns'));
}
