import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows, tmpdirSync } from "harness";
import * as fs from "node:fs";
import * as path from "node:path";

const runScanFixture = (pattern: string, opts: Record<string, unknown>) => `
  const { Glob } = require("bun");
  const g = new Glob(${JSON.stringify(pattern)});
  const opts = ${JSON.stringify(opts)};
  let count = 0;
  try {
    for (const p of g.scanSync(opts)) {
      count++;
      if (count > 100000) break;
    }
    console.log("OK:" + count);
  } catch (err) {
    console.log("ERR:" + (err && err.code ? err.code : String(err)));
  }
`;

describe.skipIf(isWindows)("Glob path length", () => {
  test("deep directory tree does not overflow path buffer", async () => {
    const root = tmpdirSync("bun-glob-overflow-deep-");
    // Build a deep directory tree using bash cd+mkdir loops so each
    // individual syscall uses a short relative path. The cumulative
    // path length grows past MAX_PATH_BYTES (1024 on macOS, 4096 on
    // Linux) even though the tree is legal on the filesystem.
    const depth = 18;
    const segName = "D".repeat(255);
    await using buildProc = Bun.spawn({
      cmd: ["bash", "-c", `SEG=${segName}; for i in $(seq 1 ${depth}); do mkdir "$SEG" && cd "$SEG" || exit 1; done`],
      env: bunEnv,
      cwd: root,
      stderr: "pipe",
    });
    const [buildStderr, buildCode] = await Promise.all([buildProc.stderr.text(), buildProc.exited]);
    // On musl, getcwd(3) fails once the cumulative path exceeds PATH_MAX. bash
    // prints a cd warning for each subsequent level but mkdir/cd still succeed,
    // so filter that one known warning out before asserting stderr is clean.
    const filteredBuildStderr = buildStderr
      .split("\n")
      .filter(line => !(isMusl && line.startsWith("cd: error retrieving current directory: getcwd:")))
      .join("\n");
    expect(filteredBuildStderr).toBe("");
    expect(buildCode).toBe(0);

    await using scanProc = Bun.spawn({
      cmd: [bunExe(), "-e", runScanFixture("**/*", { cwd: root, onlyFiles: false })],
      env: bunEnv,
      stderr: "pipe",
    });
    const [scanStdout, scanStderr, scanCode] = await Promise.all([
      scanProc.stdout.text(),
      scanProc.stderr.text(),
      scanProc.exited,
    ]);

    expect(scanStderr).not.toContain("panic");
    expect(scanStderr).not.toContain("Segmentation fault");
    expect(scanCode).toBe(0);
    // Walker must surface ENAMETOOLONG rather than keep walking past the
    // fixed-size PathBuffer it copies each work item into.
    expect(scanStdout.trim()).toBe("ERR:ENAMETOOLONG");
  });

  test("self-referential symlink does not overflow path buffer", async () => {
    const root = tmpdirSync("bun-glob-overflow-symlink-");
    const segName = "S".repeat(255);
    try {
      fs.symlinkSync(".", path.join(root, segName));
    } catch (err: any) {
      // Skip if we can't create symlinks in this environment.
      if (err.code === "EPERM" || err.code === "EACCES") return;
      throw err;
    }

    await using scanProc = Bun.spawn({
      cmd: [bunExe(), "-e", runScanFixture("**/*", { cwd: root, onlyFiles: false, followSymlinks: true })],
      env: bunEnv,
      stderr: "pipe",
    });
    const [scanStdout, scanStderr, scanCode] = await Promise.all([
      scanProc.stdout.text(),
      scanProc.stderr.text(),
      scanProc.exited,
    ]);

    expect(scanStderr).not.toContain("panic");
    expect(scanStderr).not.toContain("Segmentation fault");
    expect(scanCode).toBe(0);
    // Each hop through the self-loop appends a 256-byte segment, so after a
    // few iterations work_item.path exceeds MAX_PATH_BYTES. The walker must
    // terminate the loop with ENAMETOOLONG instead of copying the oversized
    // path into its fixed-size PathBuffer.
    expect(scanStdout.trim()).toBe("ERR:ENAMETOOLONG");
  });

  for (const component of ["..", "."] as const) {
    test(`pattern with many leading "${component}/" components does not overflow path buffer`, async () => {
      const root = tmpdirSync("bun-glob-overflow-dots-");
      // collapseDots() appends "/." or "/.." per leading Dot/DotBack pattern
      // component into a fixed-size PathBuffer. With enough components the
      // running length exceeds MAX_PATH_BYTES; the walker must report
      // ENAMETOOLONG instead of panicking or writing past the buffer.
      const repeats = 2200;
      const pattern = `${component}/`.repeat(repeats) + "*";

      await using scanProc = Bun.spawn({
        cmd: [bunExe(), "-e", runScanFixture(pattern, { cwd: root, onlyFiles: false })],
        env: bunEnv,
        stderr: "pipe",
      });
      const [scanStdout, scanStderr, scanCode] = await Promise.all([
        scanProc.stdout.text(),
        scanProc.stderr.text(),
        scanProc.exited,
      ]);

      expect(scanStderr).not.toContain("panic");
      expect(scanStderr).not.toContain("Segmentation fault");
      expect(scanStdout.trim()).toBe("ERR:ENAMETOOLONG");
      expect(scanCode).toBe(0);
    });
  }
});
