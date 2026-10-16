import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-shell", () => {
  test("running a shell script works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "something.sh"), "echo wah");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "something.sh")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    console.log(stderr);
    expect(stdout).toEqual("wah\n");
  });

  test("invalid syntax reports the error correctly", async () => {
    const dir = tmpdirSync("bun-shell-test-error");
    mkdirSync(dir, { recursive: true });
    const shellScript = `-h)
  echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`;
    await Bun.write(join(dir, "scripts", "script.sh"), shellScript);
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "scripts", "script.sh")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stderr = await proc.stderr.text();
    expect(stderr).toBe("error: Failed to run script.sh due to error Unexpected ')'\n");
  });
});

// A dependency can place arbitrary executables named "bash"/"sh"/"zsh" into
// node_modules/.bin via its "bin" field. The interpreter that runs
// package.json scripts must never be picked up from there.
describe.concurrent.skipIf(isWindows)(
  "package script shell interpreter is resolved from the original PATH, not node_modules/.bin",
  () => {
    const fakeShell = "#!/bin/sh\necho FAKE_SHELL_USED\n";
    const sayHi = "echo real-shell-ran";
    const bun = bunExe();

    test.each([
      ["bun run <script>", ["run", "say-hi"]],
      // The PATH that the inner `bun run` inherits has node_modules/.bin in front.
      ["bun run <script> started by a script", ["run", "nested"]],
      ["bun run --filter started by a script", ["run", "filtered"]],
      ["bun run --parallel started by a script", ["run", "parallel"]],
    ])("%s", async (_, args) => {
      using dir = tempDir("run-shell-interpreter", {
        "package.json": JSON.stringify({
          name: "shell-interpreter-fixture",
          version: "1.0.0",
          workspaces: ["packages/*"],
          scripts: {
            "say-hi": sayHi,
            nested: `${bun} run say-hi`,
            filtered: `${bun} run --filter a say-hi`,
            parallel: `${bun} run --parallel say-hi`,
          },
        }),
        "packages/a/package.json": JSON.stringify({ name: "a", scripts: { "say-hi": sayHi } }),
        "node_modules/.bin/bash": fakeShell,
        "node_modules/.bin/sh": fakeShell,
        "node_modules/.bin/zsh": fakeShell,
      });
      for (const name of ["bash", "sh", "zsh"]) {
        chmodSync(join(String(dir), "node_modules", ".bin", name), 0o755);
      }

      await using proc = Bun.spawn({
        cmd: [bun, ...args],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The script must run under a real system shell, not the executables a
      // dependency dropped into node_modules/.bin.
      expect(stdout).not.toContain("FAKE_SHELL_USED");
      expect(stderr).not.toContain("FAKE_SHELL_USED");
      expect(stdout).toContain("real-shell-ran");
      expect(exitCode).toBe(0);
    });
  },
);
