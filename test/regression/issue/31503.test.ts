import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/31503
// `bun --bun` overflowed the resolver's process-global filename interner and panicked
// with `index out of bounds: the len is 4095 but the index is 4095`.
//
// Interning >270272 long names reproduces it from one small directory: the dir cache
// keys on the literal path spelling, so resolving through N symlinks to it does N
// re-reads, and the append-only interner re-appends every name (mixed-case >31-byte
// names intern twice). 300 files * 2 * 500 symlinks = 300000.
const FILES = 300;
const SPELLINGS = 500;
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
for (let s = 0; s < spellings; s++) {
  const link = path.join(base, "s" + s);
  fs.symlinkSync(real, link, "dir");
  Bun.resolveSync("./target.js", link);
}
console.log("resolved-ok");
`;

// Skipped on Windows (dir symlinks need privileges) and macOS (resolving through
// ~500 symlinks exhausts its low default fd limit, so `Bun.resolveSync` throws).
// The overflowing code path is in the libc/arch-independent allocator, so Linux
// (glibc + musl, x64 + aarch64) coverage is sufficient.
test.skipIf(isWindows || isMacOS)(
  "resolver filename store survives interning >270k long names (#31503)",
  async () => {
    using dir = tempDir("issue-31503", { "driver.js": DRIVER });
    const driverJs = join(String(dir), "driver.js");
    const base = join(String(dir), "tree");

    await using proc = Bun.spawn({
      cmd: [bunExe(), driverJs, base, String(FILES), String(SPELLINGS)],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({
      stdout: "resolved-ok",
      exitCode: 0,
    });
  },
  30_000,
);
