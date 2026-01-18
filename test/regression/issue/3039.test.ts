import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Issue #3039: Filename comments in bundler output (e.g., `// src/entry.js`)
// should be relative to the configured `root` option, not the current working directory.
test("bundler output comments should be relative to root, not cwd", async () => {
  using dir = tempDir("bundler-root-3039", {
    "src/entry.js": `export const hello = "world";`,
    "subdir/.gitkeep": "",
  });

  // Create build script with absolute paths baked in
  const buildScript = `
    const result = await Bun.build({
      entrypoints: ["${String(dir)}/src/entry.js"],
      root: "${String(dir)}",
      minify: false,
    });
    console.log(await result.outputs[0].text());
  `;
  await Bun.write(String(dir) + "/build.js", buildScript);

  // Run from root directory
  await using procRoot = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdoutRoot, stderrRoot, exitCodeRoot] = await Promise.all([
    procRoot.stdout.text(),
    procRoot.stderr.text(),
    procRoot.exited,
  ]);

  expect(stderrRoot).toBe("");
  expect(stdoutRoot).toContain("// src/entry.js");
  expect(exitCodeRoot).toBe(0);

  // Run from subdir - should have the same output comment since root is set
  await using procSubdir = Bun.spawn({
    cmd: [bunExe(), "../build.js"],
    cwd: String(dir) + "/subdir",
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdoutSubdir, stderrSubdir, exitCodeSubdir] = await Promise.all([
    procSubdir.stdout.text(),
    procSubdir.stderr.text(),
    procSubdir.exited,
  ]);

  expect(stderrSubdir).toBe("");
  // The key assertion: comment should be relative to root, not cwd
  // Before fix: would show "// ../src/entry.js" when run from subdir
  // After fix: should show "// src/entry.js" in both cases
  expect(stdoutSubdir).toContain("// src/entry.js");
  expect(stdoutSubdir).not.toContain("// ../src/entry.js");
  expect(exitCodeSubdir).toBe(0);
});
