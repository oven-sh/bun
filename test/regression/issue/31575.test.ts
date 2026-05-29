// https://github.com/oven-sh/bun/issues/31575
//
// Regression: `bun build --compile` with a path-preserving `naming.asset`
// (e.g. `[dir]/[name].[ext]`) dropped the `[dir]` segment from the name
// reported by `Bun.embeddedFiles[].name`. An asset imported from a
// subdirectory with `with { type: "file" }` registered its embedded blob as
// `data.txt` instead of `assets/nested/data.txt`, while the import binding
// still resolved to the nested `/$bunfs/root/assets/nested/data.txt`. The two
// disagreed.
//
// On macOS/Linux the content read still happened to succeed (the import path
// was correct); on Windows the embedded-file lookup is keyed by that flattened
// name, so reading the nested import path failed with `ENOENT`.
//
// Root cause: `Bun.embeddedFiles` built its Blob through a duplicate
// constructor (`src/runtime/api/BunObject.rs`) that set the blob name to
// `basename(file.name)` instead of stripping the `/$bunfs/root/` prefix the
// way the canonical `File.blob()` accessor — and the Zig original — do. The
// fix routes `Bun.embeddedFiles` through that canonical accessor so the
// reported name keeps the subdirectory and matches the import binding.
//
// The name flattening reproduces on every OS, so this test runs everywhere.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

test("bun build --compile keeps the asset [dir] in Bun.embeddedFiles[].name (issue #31575)", async () => {
  using dir = tempDir("issue-31575", {
    "assets/nested/data.txt": "hello",
    "entry.ts": `
      import assetPath from './assets/nested/data.txt' with { type: 'file' };
      console.log(JSON.stringify({
        name: Bun.embeddedFiles.map(f => f.name),
        importValue: assetPath,
        content: await Bun.file(assetPath).text(),
      }));
    `,
    "build.mjs": `
      const r = await Bun.build({
        entrypoints: ['entry.ts'],
        compile: { outfile: ${JSON.stringify(isWindows ? "app.exe" : "app")} },
        naming: { asset: '[dir]/[name].[ext]' },
      });
      if (!r.success) { for (const l of r.logs) console.error(String(l)); process.exit(1); }
    `,
  });
  const dirPath = String(dir);
  const outBin = join(dirPath, isWindows ? "app.exe" : "app");

  // Build the standalone executable.
  await using build = Bun.spawn({
    cmd: [bunExe(), "build.mjs"],
    env: bunEnv,
    cwd: dirPath,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [buildStdout, buildStderr, buildExit] = await Promise.all([
    build.stdout.text(),
    build.stderr.text(),
    build.exited,
  ]);
  if (buildExit !== 0) {
    console.error("build stdout:", buildStdout);
    console.error("build stderr:", buildStderr);
  }
  expect(buildExit).toBe(0);

  // Run it from a different cwd so the imported path must resolve against the
  // embedded virtual FS (not a stray on-disk copy).
  await using run = Bun.spawn({
    cmd: [outBin],
    env: bunEnv,
    cwd: "/",
    stderr: "pipe",
    stdout: "pipe",
  });
  const [runStdout, runStderr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  if (runExit !== 0) {
    console.error("run stdout:", runStdout);
    console.error("run stderr:", runStderr);
  }
  // Before the fix, reading the nested import path threw ENOENT on Windows
  // because the embedded blob was registered under the flattened name.
  // (stderr is only asserted for the error signal — debug builds emit an
  // unrelated `hintSourcePagesDontNeed` madvise note here.)
  expect(runStderr).not.toContain("ENOENT");
  expect(runExit).toBe(0);

  const result = JSON.parse(runStdout.trim());

  // The embedded-asset name must keep the `assets/nested/` directory from the
  // `[dir]/[name].[ext]` template. Before the fix this was `["data.txt"]`.
  expect(result.name).toEqual(["assets/nested/data.txt"]);

  // ...and it must agree with the `with { type: "file" }` import binding, which
  // always pointed at the nested path. (The prefix differs per platform:
  // `/$bunfs/root/` vs `B:/~BUN/root/`.)
  expect(result.importValue.endsWith("assets/nested/data.txt")).toBe(true);

  // The content read through the import path must succeed (this is what threw
  // ENOENT on Windows before the fix).
  expect(result.content).toBe("hello");
}, 60_000);
