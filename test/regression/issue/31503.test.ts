import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows, tempDir } from "harness";
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
// Driving the resolver past ~270k interned long filenames reproduces the panic.
// No `Module._resolveFilename` hook or webpack is needed — plain `Bun.resolveSync`
// of a relative specifier reads (and interns) the whole containing directory.

// The old ceiling was `8192 + 4095 * 64 = 270272` interned names; go comfortably
// past it so the pre-fix binary panics deterministically, while staying far below
// the fixed `8192 + 4095 * 2048` ceiling so the fixed binary resolves cleanly.
const TOTAL_FILES = 280_000;
const WORKERS = 4;
const PER_WORKER = Math.ceil(TOTAL_FILES / WORKERS);
// Names must exceed the 31-byte inline threshold so each one is actually
// appended to the store rather than stored inline.
const LONG_PREFIX = "zz_this_is_a_filename_well_over_thirty_one_bytes_long_";

// Each worker fills one directory with many uniquely-named long files plus a
// `target.js` for the resolver to aim at.
const CREATOR = /* js */ `
const fs = require("fs");
const path = require("path");
const base = process.argv[2];
const worker = Number(process.argv[3]);
const count = Number(process.argv[4]);
const prefix = ${JSON.stringify(LONG_PREFIX)};
const dir = path.join(base, "d" + worker);
fs.mkdirSync(dir, { recursive: true });
for (let i = 0; i < count; i++) {
  fs.closeSync(fs.openSync(path.join(dir, prefix + worker + "_" + i + ".js"), "w"));
}
fs.closeSync(fs.openSync(path.join(dir, "target.js"), "w"));
`;

// Resolving a relative specifier in each directory forces the resolver to read
// the whole directory, interning every long filename into the process-global
// store. Before the fix the store overflows partway through and the process
// aborts; after, it resolves everything and prints "resolved-ok".
const RESOLVER = /* js */ `
const path = require("path");
const base = process.argv[2];
const workers = Number(process.argv[3]);
for (let w = 0; w < workers; w++) {
  Bun.resolveSync("./target.js", path.join(base, "d" + w));
}
console.log("resolved-ok");
`;

// Interning ~280k names is inherently heavy: it needs that many files on disk at
// once (CI puts the temp dir on a tmpfs, so it is also memory). Skip musl/Alpine,
// whose CI containers are too small to hold the working set — the overflowing
// code path is in the platform- and libc-independent allocator, so the glibc
// Linux and macOS lanes provide equivalent coverage.
test.skipIf(isWindows || isMusl)(
  "resolver filename store survives interning >270k long filenames (#31503)",
  async () => {
    using dir = tempDir("issue-31503", {
      "create.js": CREATOR,
      "resolve.js": RESOLVER,
    });
    const base = join(String(dir), "tree");
    const createJs = join(String(dir), "create.js");
    const resolveJs = join(String(dir), "resolve.js");

    // Fill the tree in parallel so wall-clock creation time stays reasonable
    // even under the debug build.
    const creators = Array.from({ length: WORKERS }, (_, w) =>
      Bun.spawn({
        cmd: [bunExe(), createJs, base, String(w), String(PER_WORKER)],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      }),
    );
    // Collect each creator's output and assert on the combined object so a
    // failed worker surfaces its stderr in the diff. The exit code is the
    // signal; stderr is reported, not asserted empty, because ASAN builds can
    // print harmless warnings (e.g. "ASAN interferes with JSC signal handlers")
    // that would otherwise flake the assertion.
    const creatorResults = await Promise.all(
      creators.map(async proc => {
        // Drain stdout too so the child can't block on a full pipe.
        const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stderr, exitCode };
      }),
    );
    for (const result of creatorResults) {
      expect(result).toMatchObject({ exitCode: 0 });
    }

    // Before the fix this process aborts with `index out of bounds: the len is
    // 4095 but the index is 4095` partway through interning; after, it resolves
    // everything and exits cleanly.
    await using proc = Bun.spawn({
      cmd: [bunExe(), resolveJs, base, String(WORKERS)],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stdout is "resolved-ok" on success and carries the panic stack on the
    // pre-fix crash, so it distinguishes the two even when the process aborts.
    // Assert stdout before the exit code for a legible failure; stderr is kept
    // in the object for diagnostics but not asserted empty (ASAN noise).
    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({
      stdout: "resolved-ok",
      exitCode: 0,
    });
  },
  240_000,
);
