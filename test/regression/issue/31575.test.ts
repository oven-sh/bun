// https://github.com/oven-sh/bun/issues/31575

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

  // Run from a different cwd so the import path must resolve against the embedded FS.
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
  expect(runStderr).not.toContain("ENOENT");

  const result = JSON.parse(runStdout.trim());
  expect(result.name).toEqual(["assets/nested/data.txt"]);
  expect(result.importValue.endsWith("assets/nested/data.txt")).toBe(true);
  expect(result.content).toBe("hello");
  expect(runExit).toBe(0);
});
