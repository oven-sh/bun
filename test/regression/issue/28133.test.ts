import { spawn, write } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/28133
// On Windows, FileCopier passed relative paths to CopyFileW which requires
// absolute paths. This caused ENOENT errors during `bun install` with
// copyfile backend, especially for packages with long scoped names.
test("isolated install with copyfile backend handles scoped packages", async () => {
  using dir = tempDir("issue-28133", {
    "package.json": JSON.stringify({
      name: "test-issue-28133",
      dependencies: {
        // Use a scoped file dependency with a long name similar to
        // @emotion/use-insertion-effect-with-fallbacks to exercise
        // the copyfile path with long paths.
        "@scoped/long-package-name-for-testing": "file:./scoped-pkg",
        "file-dep": "file:./file-dep",
      },
    }),
    "bunfig.toml": `[install]\nlinker = "isolated"\n`,
    "scoped-pkg/package.json": JSON.stringify({
      name: "@scoped/long-package-name-for-testing",
      version: "1.0.0",
    }),
    "scoped-pkg/lib/index.js": "module.exports = 'scoped';",
    "file-dep/package.json": JSON.stringify({
      name: "file-dep",
      version: "1.0.0",
    }),
    "file-dep/src/nested/deep/index.js": "module.exports = 'deep';",
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--backend", "copyfile"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("ENOENT");

  // Verify scoped package was copied correctly
  const scopedPkgJson = await Bun.file(
    join(
      String(dir),
      "node_modules",
      ".bun",
      "@scoped+long-package-name-for-testing@file+scoped-pkg",
      "node_modules",
      "@scoped",
      "long-package-name-for-testing",
      "package.json",
    ),
  ).json();
  expect(scopedPkgJson.name).toBe("@scoped/long-package-name-for-testing");

  // Verify nested files were copied
  const deepFile = await Bun.file(
    join(
      String(dir),
      "node_modules",
      ".bun",
      "file-dep@file+file-dep",
      "node_modules",
      "file-dep",
      "src",
      "nested",
      "deep",
      "index.js",
    ),
  ).text();
  expect(deepFile).toBe("module.exports = 'deep';");

  expect(exitCode).toBe(0);
});
