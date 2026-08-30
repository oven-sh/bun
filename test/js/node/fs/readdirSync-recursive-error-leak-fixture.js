// When readdirSync({ recursive: true, withFileTypes: true }) fails partway through
// (e.g. a subdirectory can't be opened), the already-collected Dirent entries must
// be fully released. Each Dirent owns a ref to both .name and .path; previously
// only .name was dereferenced on the sync error path, leaking the .path string.
//
// This fixture builds a tree of long directory names: root/mid/leaf_0..leaf_63,
// with a self-referential symlink inside leaf_0. The recursive walker is
// breadth-first, so it scans root, mid and every leaf (allocating one distinct
// Dirent.path string of 500 to 800 bytes per directory) before it opens the
// symlink and fails with ELOOP. It repeats the failing readdirSync and prints
// the RSS growth between a warmed-up baseline and the end of the run as JSON.
//
// Usage: bun readdirSync-recursive-error-leak-fixture.js <iterations>

const fs = require("fs");
const path = require("path");
const os = require("os");

const iterations = Number(process.argv[2]);
if (!Number.isInteger(iterations) || iterations <= 0) {
  throw new Error("usage: readdirSync-recursive-error-leak-fixture.js <iterations>");
}

const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
const toMB = bytes => Math.round((bytes / 1024 / 1024) * 100) / 100;

// Directory names are close to NAME_MAX so that every leaked path string is as
// large as possible. Three levels of them put the longest absolute path at
// TMPDIR + 785 bytes, under macOS's 1024-byte PATH_MAX for any TMPDIR shorter
// than 230 bytes.
const LEAF_COUNT = 64;
const seg = i => Buffer.alloc(246, String.fromCharCode(97 + (i % 26))).toString() + String(i).padStart(4, "0");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "readdir-err-leak-"));
const root = path.join(base, seg(LEAF_COUNT));
const mid = path.join(root, seg(LEAF_COUNT + 1));
fs.mkdirSync(mid, { recursive: true });

// Each leaf holds one file so that the walker creates a Dirent.path string for
// it (an empty directory yields no Dirent and no path string).
const leaves = [];
for (let i = 0; i < LEAF_COUNT; i++) {
  const d = path.join(mid, seg(i));
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "f"), "x");
  leaves.push(d);
}

// Self-referential symlink inside a leaf. It is queued while that leaf is
// scanned, after every leaf was queued, so BFS opens it last. ELOOP is not in
// the silently-skipped set (NOENT/NOTDIR/PERM) and so propagates as an error
// after all the Dirents above have been collected.
fs.symlinkSync("zzloop", path.join(leaves[0], "zzloop"));

// Every error code seen across all calls. A call that does not throw records null.
const codes = new Set();
function failingReaddir() {
  try {
    fs.readdirSync(root, { recursive: true, withFileTypes: true });
    codes.add(null);
  } catch (e) {
    codes.add(e.code);
  }
}

// Warmup: run chunks of calls until RSS stops growing between two samples, so
// that the baseline is taken from the allocator's steady state (the first
// calls grow RSS by a few MB without any leak). A real leak grows RSS on every
// chunk, so the cap is what ends the warmup in that case.
const WARMUP_CHUNK = 50;
const WARMUP_MAX = 1000;
let warmup = 0;
Bun.gc(true);
let before = rss();
do {
  for (let i = 0; i < WARMUP_CHUNK; i++) failingReaddir();
  warmup += WARMUP_CHUNK;
  Bun.gc(true);
  const now = rss();
  const grew = now - before >= 1024 * 1024;
  before = now;
  if (!grew) break;
} while (warmup < WARMUP_MAX);

for (let i = 0; i < iterations; i++) failingReaddir();
Bun.gc(true);
const after = rss();

fs.rmSync(base, { recursive: true, force: true });

console.log(
  JSON.stringify({
    iterations,
    warmup,
    codes: [...codes],
    rssBeforeMB: toMB(before),
    rssAfterMB: toMB(after),
    deltaMB: toMB(after - before),
  }),
);
