import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Bun does not implement Node's permission model. Before this change the whole
// flag family fell through the unknown-flag skip path: the process ran with no
// enforcement, exited 0, and process.execArgv reported the flags as applied.
// For an enforcement flag that is a silent fail-open, so Bun must refuse to
// start instead of running unsandboxed.

const SCRIPT_RAN = "__script_ran__";

const PERMISSION_FLAGS: readonly string[][] = [
  ["--permission"],
  ["--permission", "--allow-fs-read=/tmp"],
  ["--permission-audit"],
  ["--experimental-permission"],
  ["--allow-fs-read=/tmp"],
  ["--allow-fs-read", "/tmp"],
  ["--allow-fs-write=/tmp"],
  ["--allow-child-process"],
  ["--allow-worker"],
  ["--allow-addons"],
  ["--allow-net"],
  ["--allow-net=localhost"],
  ["--allow-wasi"],
  ["--allow-inspector"],
  ["--allow-ffi"],
];

describe.each([undefined, "run"] as const)("bun %s", runArg => {
  test.concurrent.each(PERMISSION_FLAGS)(
    "refuses to start with %s (Node permission model is not implemented)",
    async (...flags) => {
      const cmd = [bunExe()];
      if (runArg) cmd.push(runArg);
      cmd.push(...flags, "-e", `console.log(${JSON.stringify(SCRIPT_RAN)})`);

      await using proc = Bun.spawn({ cmd, env: bunEnv, stderr: "pipe", stdout: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);

      // The script must never have been evaluated.
      expect(stdout).not.toContain(SCRIPT_RAN);
      expect(stdout).toBe("");
      // Error names the first permission-family flag and the reason.
      const bare = flags[0].split("=")[0];
      expect(stderr).toContain(bare);
      expect(stderr).toContain("does not implement the Node.js permission model");
      expect(exitCode).toBe(1);
    },
  );
});

test("refuses to start when --permission is passed to a script file", async () => {
  using dir = tempDir("permission-flags", {
    "probe.js": `
      // Under Node --permission this readFileSync throws ERR_ACCESS_DENIED.
      // Under Bun the model is not implemented, so reaching this line at all is
      // the bug: it means the sandbox the caller asked for was silently skipped.
      require("fs").readFileSync(process.execPath);
      console.log(${JSON.stringify(SCRIPT_RAN)});
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--permission", "--allow-fs-read=/tmp", "probe.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  expect(stdout).not.toContain(SCRIPT_RAN);
  expect(stdout).toBe("");
  expect(stderr).toContain("--permission");
  expect(stderr).toContain("does not implement the Node.js permission model");
  expect(exitCode).toBe(1);
});

test("process.permission is still absent without the flag", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.permission)"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(stdout).toBe("undefined\n");
  expect(exitCode).toBe(0);
});
