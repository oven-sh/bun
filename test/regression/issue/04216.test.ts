// https://github.com/oven-sh/bun/issues/4216
// `bun build --target=bun` used to inline __dirname/__filename as string
// literals containing the build machine's absolute source path. The bundle
// would then only work from the exact location it was built in.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";

describe("__dirname/__filename resolve at runtime in bundled output", () => {
  for (const target of ["bun", "node"] as const) {
    test.concurrent(`--target=${target}`, async () => {
      using src = tempDir("issue-4216-src", {
        "nested/entry.js": `
          const dep = require("./dep.cjs");
          console.log(JSON.stringify({
            dirname: __dirname,
            filename: __filename,
            depDirname: dep.dir,
            depFilename: dep.file,
          }));
        `,
        "nested/dep.cjs": `
          module.exports = { dir: __dirname, file: __filename };
        `,
      });
      const srcDir = String(src);

      // Build into a subdirectory of the source dir.
      await using build = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          join(srcDir, "nested/entry.js"),
          "--target",
          target,
          "--outfile",
          join(srcDir, "build/bundle.mjs"),
        ],
        env: bunEnv,
        cwd: srcDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [buildStderr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error:");
      expect(buildExit).toBe(0);

      const bundleSource = await Bun.file(join(srcDir, "build/bundle.mjs")).text();
      // The build machine's absolute source path must not appear in the output.
      expect(bundleSource).not.toContain(join(srcDir, "nested"));

      // Copy the bundle somewhere unrelated to the build directory and run it
      // from there, so a hardcoded build-time path cannot accidentally resolve.
      using runDir = tempDir("issue-4216-run", {});
      const runPath = join(String(runDir), "moved.mjs");
      cpSync(join(srcDir, "build/bundle.mjs"), runPath);

      await using proc = Bun.spawn({
        cmd: [bunExe(), runPath],
        env: bunEnv,
        cwd: String(runDir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr).toBe("");
      const out = JSON.parse(stdout.trim());
      // All four should point at the *runtime* bundle location, not the source
      // tree. The wrapped CJS dep sees the same chunk-level `import.meta` as the
      // entry, so its __dirname/__filename match.
      expect(out).toEqual({
        dirname: String(runDir),
        filename: runPath,
        depDirname: String(runDir),
        depFilename: runPath,
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent(`--target=${target} --format=cjs`, async () => {
      using src = tempDir("issue-4216-cjs", {
        "entry.js": `
          console.log(JSON.stringify({ dirname: __dirname, filename: __filename }));
        `,
      });
      const srcDir = String(src);

      await using build = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          join(srcDir, "entry.js"),
          "--target",
          target,
          "--format=cjs",
          "--outfile",
          join(srcDir, "bundle.cjs"),
        ],
        env: bunEnv,
        cwd: srcDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [buildStderr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error:");
      expect(buildExit).toBe(0);

      // The output must not re-declare __dirname/__filename with the build path;
      // the CJS wrapper (Bun's `@bun-cjs` or Node's native module wrapper)
      // already provides them.
      const bundleSource = await Bun.file(join(srcDir, "bundle.cjs")).text();
      expect(bundleSource).not.toContain(srcDir);

      using runDir = tempDir("issue-4216-cjs-run", {});
      const runPath = join(String(runDir), "moved.cjs");
      cpSync(join(srcDir, "bundle.cjs"), runPath);

      await using proc = Bun.spawn({
        cmd: [bunExe(), runPath],
        env: bunEnv,
        cwd: String(runDir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        dirname: String(runDir),
        filename: runPath,
      });
      expect(exitCode).toBe(0);
    });
  }

  // --target=browser has no runtime `import.meta.dir` equivalent, so it keeps
  // the legacy behavior of inlining the build-time path as a string literal.
  test.concurrent("--target=browser still inlines a string literal", async () => {
    using src = tempDir("issue-4216-browser", {
      "entry.js": `console.log(__dirname, __filename);`,
    });
    const srcDir = String(src);

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", join(srcDir, "entry.js"), "--target", "browser"],
      env: bunEnv,
      cwd: srcDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      build.stdout.text(),
      build.stderr.text(),
      build.exited,
    ]);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("var __dirname =");
    expect(stdout).not.toContain("import.meta");
    expect(exitCode).toBe(0);
  });
});
