// When readdirSync({ recursive: true, withFileTypes: true }) fails partway through
// (e.g. a subdirectory can't be opened), the already-collected Dirent entries must
// be fully released. Each Dirent owns a ref to both .name and .path; previously
// only .name was dereferenced on the sync error path, leaking the .path string.
//
// This fixture builds a wide, shallow tree under a long path, with a
// self-referential symlink two levels deep. The recursive walker is
// breadth-first, so every depth-1 directory is fully scanned (allocating
// distinct Dirent.path strings) before the depth-2 symlink is opened and fails
// with ELOOP. It repeats the failing readdirSync many times and asserts RSS
// growth between a warmed-up baseline and the end of the run stays bounded.

const fs = require("fs");
const path = require("path");
const os = require("os");

const seg = (ch, n = 220) => Buffer.alloc(n, ch).toString();

const base = fs.mkdtempSync(path.join(os.tmpdir(), "readdir-err-leak-"));
const root = path.join(base, seg("r"));
fs.mkdirSync(root);

for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(root, "f" + i), "x");

// Eight subdirectories with long names. Each one visited before the error
// contributes a distinct ~500-byte Dirent.path string.
const subdirs = [];
for (let i = 0; i < 8; i++) {
  const d = path.join(root, seg(String.fromCharCode(97 + i)));
  fs.mkdirSync(d);
  for (let j = 0; j < 2; j++) fs.writeFileSync(path.join(d, "f" + j), "x");
  subdirs.push(d);
}

// Self-referential symlink at depth 2. Opened last (BFS), yields ELOOP, which
// is not in the silently-skipped set (NOENT/NOTDIR/PERM) and so propagates as
// an error after all the Dirents above have been collected.
const loop = path.join(subdirs[0], "zzloop");
fs.symlinkSync("zzloop", loop);

// Sanity: confirm the error path actually fires.
let threw = false;
try {
  fs.readdirSync(root, { recursive: true, withFileTypes: true });
} catch {
  threw = true;
}
if (!threw) throw new Error("expected readdirSync to throw (symlink loop not triggering error path)");

// Warmup: saturate allocator working set / ASAN quarantine so the baseline
// measurement is taken after steady state is reached.
for (let i = 0; i < 10000; i++) {
  try {
    fs.readdirSync(root, { recursive: true, withFileTypes: true });
  } catch {}
}
Bun.gc(true);
const before = process.memoryUsage.rss();

for (let i = 0; i < 20000; i++) {
  try {
    fs.readdirSync(root, { recursive: true, withFileTypes: true });
  } catch {}
}
Bun.gc(true);
const after = process.memoryUsage.rss();

const deltaMB = Math.round((after - before) / 1024 / 1024);
console.log("RSS delta", deltaMB, "MB");

try {
  fs.rmSync(base, { recursive: true, force: true });
} catch {}

// With the leak, each failing call retains ~9 path strings (~5 KB). 20k
// iterations is ~100+ MB of unreclaimable growth on top of the warmed-up
// baseline (observed: ~124-130 MB). Without the leak the delta is allocator /
// ASAN-quarantine noise (observed: ~26 MB in debug+ASAN, ~0 in release).
if (deltaMB > 64) {
  throw new Error("Dirent.path leak: RSS grew " + deltaMB + " MB over 20000 failing readdirSync calls");
}
