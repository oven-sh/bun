// #20258 — fs.existsSync crashed on Windows for paths of 49151-98302 bytes.
// osPathKernel32 reinterpreted a [98302]u8 as []u16 (49151 slots) and simdutf
// wrote past it. Spawns subprocesses so a broken build doesn't panic the runner.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

async function runInSubprocess(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

test.skipIf(!isWindows)("#20258 existsSync does not crash in the [49151, 98302] length range", async () => {
  const { stdout, stderr, exitCode } = await runInSubprocess(/* js */ `
    const { existsSync } = require("fs");
    const out = [];
    for (const n of [49150, 49151, 60000, 98302, 98303]) {
      out.push(n + ":" + existsSync(Buffer.alloc(n, "A").toString()));
    }
    process.stdout.write(out.join(" "));
  `);

  expect(stderr).not.toContain("index out of bounds");
  expect(stdout).toBe("49150:false 49151:false 60000:false 98302:false 98303:false");
  expect(exitCode).toBe(0);
});

test.skipIf(!isWindows)(
  "#20258 accessSync surfaces ENAMETOOLONG (not a crash) for paths past the WPathBuffer limit",
  async () => {
    // Boundary is PATH_MAX_WIDE - 5 (\\?\ prefix + null terminator).
    const { stdout, exitCode } = await runInSubprocess(/* js */ `
    const { accessSync } = require("fs");
    const out = [];
    for (const n of [32762, 32763, 49151, 98302]) {
      try { accessSync(Buffer.alloc(n, "A").toString()); out.push(n + ":none"); }
      catch (e) { out.push(n + ":" + e.code); }
    }
    try { accessSync(Buffer.alloc(50000, "A").toString()); }
    catch (e) { out.push("path_len:" + (e.path?.length ?? "missing")); }
    process.stdout.write(out.join(" "));
  `);

    expect(stdout).toBe("32762:ENOENT 32763:ENAMETOOLONG 49151:ENAMETOOLONG 98302:ENAMETOOLONG path_len:50000");
    expect(exitCode).toBe(0);
  },
);

test.skipIf(!isWindows)(
  "#20258 paths with large UTF-8 byte count but small UTF-16 count are not wrongly rejected",
  async () => {
    // 15000 3-byte chars = 45000 UTF-8 bytes but only 15000 UTF-16 units.
    // A naive byte-count clamp would wrongly reject this.
    const { stdout, exitCode } = await runInSubprocess(/* js */ `
    const { existsSync } = require("fs");
    const cjk = new Array(15001).join("\u6587");
    if (Buffer.byteLength(cjk) !== 45000 || cjk.length !== 15000) throw new Error("wrong encoding assumption");
    process.stdout.write(String(existsSync(cjk)));
  `);

    expect(stdout).toBe("false");
    expect(exitCode).toBe(0);
  },
);
