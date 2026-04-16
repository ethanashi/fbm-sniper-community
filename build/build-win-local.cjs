const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { getBinFromUrl } = require("app-builder-lib/out/binDownload");

const projectRoot = path.resolve(__dirname, "..");
const electronBuilderCli = path.join(projectRoot, "node_modules", "electron-builder", "cli.js");
const nsisVersion = "3.0.4.1";
const nsisChecksum = "VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j+dCo/hURz9+Q==";

function runElectronBuilder(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [electronBuilderCli, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function findMakensis() {
  const candidates = [
    process.env.MAKENSIS_PATH,
    "/opt/homebrew/opt/makensis/bin/makensis",
    "/usr/local/opt/makensis/bin/makensis",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const whichResult = spawnSync("bash", ["-lc", "command -v makensis"], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (whichResult.status === 0) {
    const resolved = whichResult.stdout.trim();
    if (resolved.length > 0 && fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

async function buildWindowsLocally() {
  const extraArgs = process.argv.slice(2);

  if (!(process.platform === "darwin" && process.arch === "arm64")) {
    runElectronBuilder(["--win", ...extraArgs]);
    return;
  }

  const makensisPath = findMakensis();
  if (!makensisPath) {
    console.error("Windows builds on Apple Silicon need an arm64 makensis binary.");
    console.error("Install it with `brew install makensis`, then rerun `npm run build:win:local`.");
    process.exit(1);
  }

  const downloadedNsisDir = await getBinFromUrl("nsis", nsisVersion, nsisChecksum);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fbm-sniper-nsis-"));
  const customNsisDir = path.join(tempRoot, "nsis");

  try {
    fs.cpSync(downloadedNsisDir, customNsisDir, { recursive: true });
    fs.rmSync(path.join(customNsisDir, "mac", "makensis"), { force: true });
    fs.symlinkSync(makensisPath, path.join(customNsisDir, "mac", "makensis"));

    runElectronBuilder(
      ["--win", "--config.win.signAndEditExecutable=false", ...extraArgs],
      { ELECTRON_BUILDER_NSIS_DIR: customNsisDir }
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
}

buildWindowsLocally().catch((error) => {
  console.error(error);
  process.exit(1);
});
