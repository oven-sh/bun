// Driver for the "project and cache on different filesystems" test in
// bun-patch.test.ts. It runs on its own so that the test can wrap it in
// `unshare -Urm` and give `proj` a private tmpfs that no other process sees.
//
// usage: bun bun-patch-xdev-fixture.ts <proj> <cache>
//
// <proj> is an empty directory on a small filesystem that this script may
// fill. <cache> is a directory on another filesystem. Prints one JSON line.
import { spawnSync } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const [proj, cache] = process.argv.slice(2);
const env = { ...process.env, BUN_INSTALL_CACHE_DIR: cache };

function run(...args: string[]) {
  const proc = spawnSync({ cmd: [process.execPath, ...args], cwd: proj, env, stdout: "pipe", stderr: "pipe" });
  return { exitCode: proc.exitCode, stderr: proc.stderr.toString() };
}

// Fills the filesystem `proj` is on until `leaveFree` bytes are left.
function fillFilesystem(leaveFree: number) {
  const limit = statfsSync(proj).blocks * statfsSync(proj).bsize;
  writeFileSync(join(proj, "reserve"), Buffer.alloc(leaveFree, 1));
  const chunk = Buffer.alloc(1024 * 1024, 1);
  let written = 0;
  let full = false;
  for (let size = chunk.length; size >= 4096; size = size / 16) {
    try {
      while (written <= limit) {
        writeFileSync(join(proj, "filler"), chunk.subarray(0, size), { flag: "a" });
        written += size;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOSPC") throw e;
      full = true;
    }
  }
  rmSync(join(proj, "reserve"));
  if (!full) throw new Error(`wrote ${written} bytes to ${proj} without ENOSPC`);
}

const result: Record<string, unknown> = {};
try {
  result.sameDevice = statSync(proj).dev === statSync(cache).dev;

  // ~400 KB of source, so that a patch that touches every line is far larger
  // than the space left free below.
  const lines = Array.from({ length: 8000 }, (_, i) => `exports.v${i} = ${i}; // padding padding padding`);
  mkdirSync(join(proj, "tarball-src", "package", "lib"), { recursive: true });
  writeFileSync(
    join(proj, "tarball-src", "package", "package.json"),
    JSON.stringify({ name: "big-pkg", version: "1.0.0", main: "lib/big.js" }),
  );
  writeFileSync(join(proj, "tarball-src", "package", "lib", "big.js"), lines.join("\n") + "\n");
  const tar = spawnSync({
    cmd: ["tar", "-czf", join(proj, "big-pkg-1.0.0.tgz"), "-C", join(proj, "tarball-src"), "package"],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (tar.exitCode !== 0) throw new Error(`tar exited with ${tar.exitCode}`);
  rmSync(join(proj, "tarball-src"), { recursive: true });
  writeFileSync(
    join(proj, "package.json"),
    JSON.stringify({ name: "proj", dependencies: { "big-pkg": "file:./big-pkg-1.0.0.tgz" } }),
  );

  // Commit a small patch first. This is the file that has to survive.
  result.install = run("install");
  result.patch1 = run("patch", "big-pkg");
  writeFileSync(join(proj, "node_modules", "big-pkg", "lib", "big.js"), lines.join("\n") + "\n// small change\n");
  result.commit1 = run("patch", "--commit", "node_modules/big-pkg");
  const names = readdirSync(join(proj, "patches"));
  const firstPatch = readFileSync(join(proj, "patches", names[0]), "utf8");
  result.firstPatch = { names, size: Buffer.byteLength(firstPatch), text: firstPatch };

  // Now prepare a patch that changes every line, and take away the space it
  // would need.
  result.patch2 = run("patch", "big-pkg");
  writeFileSync(
    join(proj, "node_modules", "big-pkg", "lib", "big.js"),
    lines.map(line => line.replace("padding", "PATCHED")).join("\n") + "\n",
  );
  fillFilesystem(128 * 1024);
  try {
    result.commit2 = run("patch", "--commit", "node_modules/big-pkg");
  } finally {
    rmSync(join(proj, "filler"), { force: true });
  }
  const after = readdirSync(join(proj, "patches"));
  const afterText = after.includes(names[0]) ? readFileSync(join(proj, "patches", names[0]), "utf8") : null;
  result.after = { names: after, size: afterText === null ? null : Buffer.byteLength(afterText), text: afterText };

  // And the surviving patch still applies.
  rmSync(join(proj, "node_modules"), { recursive: true, force: true });
  result.reinstall = run("install");
  const bigJsPath = join(proj, "node_modules", "big-pkg", "lib", "big.js");
  const bigJs = existsSync(bigJsPath) ? readFileSync(bigJsPath, "utf8") : "\n";
  result.lastLine = bigJs.slice(bigJs.lastIndexOf("\n", bigJs.length - 2) + 1);
} catch (e) {
  result.error = String((e as Error)?.stack ?? e);
}
console.log(JSON.stringify(result));
