#!/usr/bin/env node
/**
 * build.js — dynamic, cross-platform build orchestrator
 *
 * Usage:
 *   node build.js                                   # default targets
 *   node build.js --targets=win-x64,mac-arm64
 *   node build.js --targets=win-x64,win-x86,mac-x64,mac-arm64
 *   node build.js --clean                           # wipe dist/ first
 *
 * Behavior:
 *   - Uses pkg to produce a standalone binary per target
 *   - If BOTH mac-x64 and mac-arm64 are built AND we're on macOS,
 *     merges them into a universal binary via `lipo`
 *   - If win-x64 is built, also writes a silent-launch VBS for the installer
 *   - Writes dist/manifest.json with filename, sha256, size, version
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = __dirname;
const DIST = path.resolve(ROOT, "dist");
const pkg = require(path.join(ROOT, "package.json"));
const VERSION = pkg.version;

// ---- args ----
const args = process.argv.slice(2);
const getArg = (k) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};
const hasFlag = (k) => args.includes(`--${k}`);

if (hasFlag("clean") && fs.existsSync(DIST)) {
  console.log("🧹 Cleaning dist/");
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

// ---- target registry ----
// node 14 is the newest pkg-supported runtime that can emit win-x86.
// All others use node 18.
const TARGETS = {
  "win-x64": { node: "node18", platform: "win", arch: "x64", ext: ".exe" },
  "win-x86": { node: "node14", platform: "win", arch: "x86", ext: ".exe" },
  "win-arm64": { node: "node18", platform: "win", arch: "arm64", ext: ".exe" },
  "mac-x64": { node: "node18", platform: "macos", arch: "x64", ext: "" },
  "mac-arm64": { node: "node18", platform: "macos", arch: "arm64", ext: "" },
  "linux-x64": { node: "node18", platform: "linux", arch: "x64", ext: "" },
  "linux-arm64": { node: "node18", platform: "linux", arch: "arm64", ext: "" },
};

const DEFAULT_TARGETS = ["win-x64", "mac-x64", "mac-arm64", "linux-x64"];

const requested = (getArg("targets") || DEFAULT_TARGETS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---- run ----
const built = {};

for (const name of requested) {
  const t = TARGETS[name];
  if (!t) {
    console.warn(`⚠  Unknown target "${name}" — skipped`);
    continue;
  }

  const out = path.join(DIST, `print-agent-${VERSION}-${name}${t.ext}`);
  const cmd = `npx pkg . --targets ${t.node}-${t.platform}-${t.arch} --output "${out}"`;

  console.log(`\n▶ Building ${name}`);
  console.log(`  ${cmd}`);

  try {
    execSync(cmd, { stdio: "inherit", cwd: ROOT });
    if (t.ext === "" && os.platform() !== "win32") {
      fs.chmodSync(out, 0o755);
    }
    built[name] = out;
    console.log(`✅ ${name} → ${path.relative(ROOT, out)}`);
  } catch (e) {
    console.error(`❌ ${name} build failed:`, e.message);
  }
}

// ---- Windows VBS launcher (needed by installer/windows.iss) ----
if (built["win-x64"]) {
  const vbsPath = path.join(DIST, "print-agent-launcher.vbs");
  const vbsContent = [
    "' Silent launcher for Silent Print Agent",
    "' Launches print-agent.exe hidden (no console window).",
    "' A shortcut to this file lives in the Startup folder.",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    "scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)",
    'Set WshShell = CreateObject("WScript.Shell")',
    'WshShell.Run """" & scriptDir & "\\print-agent.exe""", 0, False',
    "Set WshShell = Nothing",
    "Set fso = Nothing",
    "",
  ].join("\r\n");
  fs.writeFileSync(vbsPath, vbsContent, "utf8");
  console.log(`✅ VBS launcher → ${path.relative(ROOT, vbsPath)}`);
}

// ---- macOS universal (only on macOS with both archs built) ----
if (built["mac-x64"] && built["mac-arm64"]) {
  if (os.platform() === "darwin") {
    const universal = path.join(DIST, `print-agent-${VERSION}-mac-universal`);
    console.log(`\n▶ Merging into macOS universal binary via lipo`);
    try {
      execSync(
        `lipo -create -output "${universal}" "${built["mac-x64"]}" "${built["mac-arm64"]}"`,
        { stdio: "inherit" },
      );
      fs.chmodSync(universal, 0o755);
      built["mac-universal"] = universal;
      console.log(`✅ mac-universal → ${path.relative(ROOT, universal)}`);
    } catch (e) {
      console.warn(`⚠  lipo merge skipped: ${e.message}`);
    }
  } else {
    console.warn(
      `⚠  mac-x64 + mac-arm64 built, but lipo requires macOS. ` +
        `Universal merge skipped (binaries still usable separately).`,
    );
  }
}

// ---- manifest.json ----
const manifest = {
  name: pkg.name,
  version: VERSION,
  built_at: new Date().toISOString(),
  artifacts: {},
};

for (const [name, file] of Object.entries(built)) {
  const buf = fs.readFileSync(file);
  manifest.artifacts[name] = {
    file: path.basename(file),
    size: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}

const manifestPath = path.join(DIST, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\n📝 ${path.relative(ROOT, manifestPath)} written`);

// ---- summary ----
console.log("\n📦 Build summary");
console.log("────────────────────────────────────────────────────");
if (Object.keys(built).length === 0) {
  console.log("  (no artifacts produced)");
} else {
  for (const [k, v] of Object.entries(built)) {
    const st = fs.statSync(v);
    console.log(
      `  ${k.padEnd(15)} ${(st.size / 1024 / 1024).toFixed(1).padStart(6)} MB  ${path.basename(v)}`,
    );
  }
}
console.log("────────────────────────────────────────────────────\n");
