import { spawn, spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { spawnSync as nodeSpawnSync } from "node:child_process";

it("process.exit(1) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-1.js"]);
  expect(exitCode).toBe(1);
});

it("await on a thrown value reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-await-throw-1.js"]);
  expect(exitCode).toBe(1);
});

it("unhandled promise rejection reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-unhandled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("handled promise rejection reports exit code 0", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-handled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("process.exit(0) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-0.js"]);
  expect(exitCode).toBe(0);
});

// Windows exit codes are a full 32-bit DWORD. NTSTATUS crash codes
// (e.g. 0xC0000005 access violation) live in the high bits and must not be
// truncated to 8 bits on the way to JS.
describe.skipIf(!isWindows)("Windows 32-bit exit codes", () => {
  const comspec = process.env.comspec || "cmd.exe";

  it("spawnSync preserves codes > 255", () => {
    const { exitCode, success } = spawnSync({
      cmd: [comspec, "/c", "exit 300"],
      env: bunEnv,
    });
    expect({ exitCode, success }).toEqual({ exitCode: 300, success: false });
  });

  it("spawn preserves codes > 255", async () => {
    await using proc = spawn({
      cmd: [comspec, "/c", "exit 300"],
      env: bunEnv,
    });
    const exited = await proc.exited;
    expect({ exited, exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
      exited: 300,
      exitCode: 300,
      signalCode: null,
    });
  });

  it("spawn onExit callback receives codes > 255", async () => {
    const { promise, resolve } = Promise.withResolvers<number | null>();
    await using proc = spawn({
      cmd: [comspec, "/c", "exit 300"],
      env: bunEnv,
      onExit(_proc, exitCode) {
        resolve(exitCode);
      },
    });
    await proc.exited;
    expect(await promise).toBe(300);
  });

  it("preserves NTSTATUS-range codes (e.g. 0xC0000005)", () => {
    // cmd.exe parses `exit N` as a signed 32-bit integer. -1073741819 is
    // 0xC0000005 reinterpreted as a DWORD, i.e. STATUS_ACCESS_VIOLATION.
    const { exitCode } = spawnSync({
      cmd: [comspec, "/c", "exit -1073741819"],
      env: bunEnv,
    });
    expect(exitCode).toBe(0xc0000005);
  });

  it("node:child_process spawnSync preserves codes > 255", () => {
    const { status } = nodeSpawnSync(comspec, ["/c", "exit 300"], { env: bunEnv });
    expect(status).toBe(300);
  });
});
