import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/31503
//
// The resolver interns every directory-entry name longer than 31 bytes into a
// single process-global store (`filename_store_backing`, a `BSSStringList`).
// Once its inline buffer fills, entries spill into an `OverflowGroup` whose
// block-pointer array is fixed-size. Two bugs combined to make a large `bun
// --bun` build — e.g. a webpack production build driven by a `Module._resolveFilename`
// hook that probes several extensions — crash with
// `index out of bounds: the len is 4095 but the index is 4095`:
//
//   1. `OverflowGroup::tail` wrote `ptrs[allocated]` at index `max` (4095) on a
//      `max`-length array, one past the end.
//   2. The overflow block size was a placeholder 64 instead of the Zig value
//      (`count / 4` = 2048 for this store), which shrank the ceiling ~32x, from
//      ~8.4M names down to ~270k — low enough for a real monorepo build to hit.
//
// Reproducing it means interning more than `8192 + 4095 * 64 = 270272` names.
// Rather than create that many files, exploit two resolver facts to reach the
// count from one small directory:
//
//   - The directory cache keys on the *literal* path spelling, not the realpath,
//     so resolving through N distinct symlinks to the same directory triggers N
//     separate `readdir`s — and the interner is append-only, so each re-reads and
//     re-appends every entry name.
//   - A mixed-case name longer than 31 bytes is interned twice (once as-is, once
//     lowercased), so each file contributes two names per read.
//
// FILES files * 2 names * SPELLINGS reads = interned names. 300 * 2 * 500 = 300000,
// comfortably past the 270272 ceiling, from only ~300 files + ~500 symlinks.
const FILES = 300;
const SPELLINGS = 500;
// Mixed-case and > 31 bytes: the case forces the second (lowercased) intern, the
// length forces it into the store instead of the inline small-string path.
const LONG_PREFIX = "ZzThisIsAFilenameWellOverThirtyOneBytesLong_";

const DRIVER = /* js */ `
const fs = require("fs");
const path = require("path");
const base = process.argv[2];
const files = Number(process.argv[3]);
const spellings = Number(process.argv[4]);
const prefix = ${JSON.stringify(LONG_PREFIX)};
const real = path.join(base, "real");
fs.mkdirSync(real, { recursive: true });
for (let i = 0; i < files; i++) {
  fs.closeSync(fs.openSync(path.join(real, prefix + i + ".js"), "w"));
}
fs.closeSync(fs.openSync(path.join(real, "target.js"), "w"));
// Each symlink is a distinct cache key -> a fresh readdir -> re-interns every name.
for (let s = 0; s < spellings; s++) {
  const link = path.join(base, "s" + s);
  fs.symlinkSync(real, link, "dir");
  Bun.resolveSync("./target.js", link);
}
console.log("resolved-ok");
`;

// Uses directory symlinks (privileged on Windows) and is otherwise
// platform-independent; the overflowing code path is in the libc/arch-independent
// allocator, so Linux + macOS coverage is sufficient.
test.skipIf(isWindows)(
  "resolver filename store survives interning >270k long names (#31503)",
  async () => {
    using dir = tempDir("issue-31503", { "driver.js": DRIVER });
    const driverJs = join(String(dir), "driver.js");
    const base = join(String(dir), "tree");

    // Before the fix this aborts with `index out of bounds: the len is 4095 but
    // the index is 4095` partway through interning; after, it resolves every
    // spelling and exits cleanly.
    await using proc = Bun.spawn({
      cmd: [bunExe(), driverJs, base, String(FILES), String(SPELLINGS)],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stdout is "resolved-ok" on success and carries the panic stack on the pre-fix
    // crash, so it distinguishes the two even when the process aborts. Assert stdout
    // before the exit code for a legible failure; stderr is kept for diagnostics but
    // not asserted empty (ASAN builds print harmless signal-handler warnings).
    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({
      stdout: "resolved-ok",
      exitCode: 0,
    });
    // The fixed binary finishes in a few seconds; the ceiling is only the headroom
    // the pre-fix crash and the crash handler's backtrace need under debug+ASAN.
  },
  30_000,
);
