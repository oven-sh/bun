import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Bun does not implement Node's permission model. Before this change,
// `bun --permission --allow-fs-read=/nope script.js` ran the script with no
// sandbox, `process.permission` stayed undefined, and the flags were echoed
// back in `process.execArgv` so callers that checked the receipt believed the
// sandbox was active. Bun now refuses to run instead.

const probe =
  "try { require('fs').readFileSync(__filename);" +
  "  console.log('read OK permission=' + typeof process.permission + ' execArgv=' + JSON.stringify(process.execArgv)) }" +
  "catch (e) { console.log('read ' + e.code + ' ' + e.permission) }";

async function run(argv: string[], env: Record<string, string | undefined> = bunEnv) {
  using dir = tempDir("node-permission", { "probe.cjs": probe });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...argv, "probe.cjs"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("Node.js permission-model flags", () => {
  test.concurrent.each([
    [["--permission"], "--permission"],
    [["--permission", "--allow-fs-read=/nope"], "--permission"],
    [["--experimental-permission"], "--experimental-permission"],
    [["--permission-audit"], "--permission-audit"],
    [["--allow-fs-read=/nope"], "--allow-fs-read"],
    [["--allow-fs-write=/nope"], "--allow-fs-write"],
    [["--allow-child-process"], "--allow-child-process"],
    [["--allow-worker"], "--allow-worker"],
    [["--allow-addons"], "--allow-addons"],
    [["--allow-wasi"], "--allow-wasi"],
    [["--allow-net"], "--allow-net"],
    [["--allow-net=example.com"], "--allow-net"],
    [["--allow-inspector"], "--allow-inspector"],
    [["--allow-ffi"], "--allow-ffi"],
  ])("%j refuses to run", async (argv, named) => {
    const { stdout, stderr, exitCode } = await run(argv);
    expect(stdout).toBe("");
    expect(stderr).toContain("does not implement the Node.js permission model");
    expect(stderr).toContain(named);
    expect(stderr).toContain("BUN_IGNORE_NODE_PERMISSION_FLAGS");
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun run --permission refuses to run", async () => {
    using dir = tempDir("node-permission", { "probe.cjs": probe });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--permission", "./probe.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("does not implement the Node.js permission model");
    expect(exitCode).toBe(1);
  });

  test.concurrent(
    "BUN_IGNORE_NODE_PERMISSION_FLAGS=1 runs (unsandboxed) and keeps process.permission undefined",
    async () => {
      const { stdout, stderr, exitCode } = await run(["--permission", "--allow-fs-read=/nope"], {
        ...bunEnv,
        BUN_IGNORE_NODE_PERMISSION_FLAGS: "1",
      });
      expect(stderr).toBe("");
      // The read of __filename succeeds (no sandbox), process.permission stays undefined,
      // and the flags remain visible in execArgv.
      expect(stdout).toBe(
        'read OK permission=undefined execArgv=["--permission","--allow-fs-read=/nope"]\n',
      );
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("--permission is hidden from --help", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--help"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).not.toContain("--permission");
    expect(stdout).not.toContain("--allow-fs-read");
  });

  test.concurrent("does not trip on an unrelated flag", async () => {
    const { stdout, stderr, exitCode } = await run(["--no-warnings"]);
    expect(stderr).toBe("");
    expect(stdout).toContain("read OK");
    expect(exitCode).toBe(0);
  });
});
