const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
  } catch (err) {
    console.error("[after-pack] ad-hoc signing failed:", err.message);
  }
};
