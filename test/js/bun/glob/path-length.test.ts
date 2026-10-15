import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isWindows, tmpdirSync } from "harness";
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

// Same as runScanFixture but prints the matched paths instead of the count.
const runScanPathsFixture = (pattern: string, opts: Record<string, unknown>) => `
  const { Glob } = require("bun");
  const g = new Glob(${JSON.stringify(pattern)});
  const opts = ${JSON.stringify(opts)};
  try {
    console.log("OK:" + JSON.stringify([...g.scanSync(opts)].sort()));
  } catch (err) {
    console.log("ERR:" + (err && err.code ? err.code : String(err)));
  }
`;

// Build a deep directory tree using bash cd+mkdir loops so each individual
// syscall uses a short relative path. The cumulative path length grows past
// MAX_PATH_BYTES (1024 on macOS, 4096 on Linux) even though the tree is
// legal on the filesystem. If `fileName` is given, the file is created in
// the deepest directory.
async function buildDeepTree(root: string, depth: number, segName: string, fileName?: string) {
  const touchFile = fileName ? ` && touch "${fileName}"` : "";
  await using buildProc = Bun.spawn({
    cmd: [
      "bash",
      "-c",
      `SEG=${segName}; for i in $(seq 1 ${depth}); do mkdir "$SEG" && cd "$SEG" || exit 1; done${touchFile}`,
    ],
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
}

describe.skipIf(isWindows)("Glob path length", () => {
  test("deep directory tree does not overflow path buffer", async () => {
    const root = tmpdirSync("bun-glob-overflow-deep-");
    await buildDeepTree(root, 18, "D".repeat(255));

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

  test("deep directory tree with absolute: true does not overflow the join buffer", async () => {
    const root = tmpdirSync("bun-glob-overflow-abs-");
    await buildDeepTree(root, 18, "D".repeat(255));

    await using scanProc = Bun.spawn({
      cmd: [bunExe(), "-e", runScanFixture("**/*", { cwd: root, absolute: true, onlyFiles: false })],
      env: bunEnv,
      stderr: "pipe",
    });
    const [scanStdout, scanStderr, scanCode] = await Promise.all([
      scanProc.stdout.text(),
      scanProc.stderr.text(),
      scanProc.exited,
    ]);

    // The absolute walk joins dir + entry through ResolvePath's fixed
    // thread-local buffer; an over-long directory must surface
    // ENAMETOOLONG like the relative walk above, not abort the process.
    expect(scanStdout.trim()).toBe("ERR:ENAMETOOLONG");
    expect(scanCode).toBe(0);
  });

  // Linux-only: this needs a directory that is still walkable (absolute path
  // under MAX_PATH_BYTES, 4096 there) while joining one more name onto it
  // exceeds the 4096-byte join buffer. Everywhere else MAX_PATH_BYTES is
  // 1024, so a matched path can never reach the join buffer's size.
  test.skipIf(!isLinux)("matched file whose absolute path exceeds the join buffer is returned", async () => {
    const root = tmpdirSync("bun-glob-overflow-abs-file-");
    const segName = "D".repeat(255);
    const fileName = "F".repeat(255);
    // Deepest directory stays under 4096 bytes so the walker can open it,
    // while joining the 255-byte file name onto it exceeds the join buffer.
    const joinBufLen = 4096;
    const depth = Math.floor((joinBufLen - 1 - root.length) / (segName.length + 1));
    await buildDeepTree(root, depth, segName, fileName);

    const expected = [root, ...Array(depth).fill(segName), fileName].join("/");
    await using scanProc = Bun.spawn({
      cmd: [bunExe(), "-e", runScanPathsFixture("**/*", { cwd: root, absolute: true })],
      env: bunEnv,
      stderr: "pipe",
    });
    const [scanStdout, scanStderr, scanCode] = await Promise.all([
      scanProc.stdout.text(),
      scanProc.stderr.text(),
      scanProc.exited,
    ]);

    expect(scanStdout.trim()).toBe("OK:" + JSON.stringify([expected]));
    expect(scanCode).toBe(0);
  });

  test("self-referential symlink terminates without overflowing the path buffer", async () => {
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
    // The walker descends a directory symlink that resolves to a directory it
    // is already inside exactly once, so the scan completes with the symlink
    // entry and its single nested visit instead of growing work_item.path
    // toward MAX_PATH_BYTES.
    expect(scanStdout.trim()).toBe("OK:2");
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
