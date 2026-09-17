import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/40561
// A `catalog:` peer dependency inside a `file:` folder dependency caused the
// hoister to nest a second copy of a sibling absolute-path `file:` dependency,
// which the installer refused with "unsafe folder path".
test("catalog: peer inside a file: dep does not break a sibling absolute file: dep", async () => {
  using dir = tempDir("issue-40561", {
    "external/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    "project/packages/local/package.json": JSON.stringify({
      name: "local",
      version: "0.0.0",
      peerDependencies: { dep: "catalog:" },
    }),
  });
  const base = String(dir);
  await Bun.write(
    `${base}/project/package.json`,
    JSON.stringify({
      name: "proj",
      private: true,
      dependencies: {
        local: "file:./packages/local",
        dep: `file:${base}/external/dep`,
      },
    }),
  );

  async function install() {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: `${base}/project`,
      stdout: "pipe",
      stderr: "pipe",
    });
    return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  }

  // fresh install
  {
    const [stdout, stderr, exitCode] = await install();
    expect(stderr).not.toContain("unsafe folder path");
    expect(stdout).toContain("2 packages installed");
    expect(exitCode).toBe(0);
  }

  // install again from the saved lockfile
  {
    const [, stderr, exitCode] = await install();
    expect(stderr).not.toContain("unsafe folder path");
    expect(exitCode).toBe(0);
  }
});
