import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/32728
// `bun build --compile` must keep the `..` parent segment in an out-of-root
// entrypoint's embedded bunfs name. Sanitizing it to `_.._` (correct for
// `--outdir` disk output) breaks runtime `new Worker("/$bunfs/root/../x.js")`
// references, which still use `..`, with ModuleNotFound.
test("compile preserves parent-segment entrypoint path for Worker resolution", async () => {
  using dir = tempDir("compile-parent-entrypoint", {
    "worker.js": `postMessage("worker started");`,
    "app/index.js": `
      const w = new Worker(process.env.WORKER_PATH);
      w.onmessage = e => { console.log("RESULT:" + e.data); process.exit(0); };
      w.onerror = e => { console.log("RESULT:error:" + (e && e.message ? e.message : String(e))); process.exit(1); };
    `,
  });

  const appDir = path.join(String(dir), "app");
  const exe = path.join(appDir, isWindows ? "app.exe" : "app");

  // The worker sits one directory above the main entrypoint, so its `[dir]`
  // placeholder resolves to `..` relative to the compile root.
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "./index.js", "../worker.js", "--outfile", "app"],
    cwd: appDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildOut, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildErr).not.toContain("error:");
  expect(buildExit).toBe(0);

  // A plain-string bunfs path reaches the standalone graph lookup verbatim
  // (no `..` normalization), so it must match the embedded key byte-for-byte.
  const prefix = isWindows ? "B:/~BUN/root/" : "/$bunfs/root/";
  await using run = Bun.spawn({
    cmd: [exe],
    cwd: appDir,
    env: { ...bunEnv, WORKER_PATH: prefix + "../worker.js" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(runOut).toContain("RESULT:worker started");
  expect(runErr).not.toContain("ModuleNotFound");
  expect(runExit).toBe(0);
});

// Keeping `..` in the embedded name must not let the debug-only
// `BUN_FEATURE_FLAG_DUMP_CODE` dump escape its directory: joining `../worker.js`
// with the dump dir normalizes one level above it. The dump site re-sanitizes
// independently of the embedded key. Feature is gated to canary/debug builds.
test.skipIf(!isDebug)("compile code dump stays within BUN_FEATURE_FLAG_DUMP_CODE dir", async () => {
  using dir = tempDir("compile-dump-escape", {
    "worker.js": `postMessage("worker started");`,
    "app/index.js": `console.log("main");`,
  });

  const appDir = path.join(String(dir), "app");
  const dumpDir = path.join(appDir, "dump");

  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "./index.js", "../worker.js", "--outfile", "app"],
    cwd: appDir,
    env: { ...bunEnv, BUN_FEATURE_FLAG_DUMP_CODE: dumpDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildOut, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildErr).not.toContain("error:");
  expect(buildExit).toBe(0);

  // The out-of-root worker dumps to `<dumpDir>/_.._/worker.js` (contained), not
  // `<dumpDir>/../worker.js` which normalizes to `<appDir>/worker.js`.
  expect(existsSync(path.join(appDir, "worker.js"))).toBe(false);
  expect(existsSync(path.join(dumpDir, "_.._", "worker.js"))).toBe(true);
});

// A custom `--entry-naming` can place a literal prefix before `[dir]`, so the
// rendered path carries a non-leading `..` (e.g. `out/../../worker.js`). The
// dump sanitizer must neutralize every `..` segment, not just leading ones.
test.skipIf(!isDebug)("compile code dump stays contained under a custom entry-naming prefix", async () => {
  using dir = tempDir("compile-dump-escape-naming", {
    "worker.js": `postMessage("worker started");`,
    "app/nested/index.js": `console.log("main");`,
  });

  const rootDir = path.join(String(dir), "app", "nested");
  const dumpDir = path.join(rootDir, "dump");

  await using build = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--entry-naming",
      "out/[dir]/[name].[ext]",
      "./index.js",
      "../../worker.js",
      "--outfile",
      "app",
    ],
    cwd: rootDir,
    env: { ...bunEnv, BUN_FEATURE_FLAG_DUMP_CODE: dumpDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildOut, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildErr).not.toContain("error:");
  expect(buildExit).toBe(0);

  // `out/../../worker.js` would normalize to `<rootDir>/worker.js` (one level
  // above the dump dir); sanitizing every `..` keeps it inside the dump dir.
  expect(existsSync(path.join(rootDir, "worker.js"))).toBe(false);
  expect(existsSync(path.join(dumpDir, "out", "_.._", "_.._", "worker.js"))).toBe(true);
});
