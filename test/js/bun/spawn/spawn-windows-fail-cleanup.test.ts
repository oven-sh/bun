import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isWindows, normalizeBunSnapshot } from "harness";
import { join } from "node:path";

// On Windows uv_spawn can fail after CreateProcessW succeeds: either
// AssignProcessToJobObject (non-detached spawns) or ResumeThread (detached
// spawns, which use CREATE_SUSPENDED). Both go through libuv's done_created
// label, which must terminate the child and close the hProcess/hThread
// handles CreateProcessW returned. Before oven-sh/libuv#13 those handles
// leaked (2 per failed spawn).
//
// These tests force each failure via IAT hooks on the exe and assert the
// process handle count is flat across many iterations.
describe.skipIf(!isWindows)("uv_spawn cleanup after CreateProcessW", () => {
  const N = 200;

  async function run() {
    const dll = compileFixture(join(import.meta.dirname, "spawn-fault-inject.c"));
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dirname, "spawn-fault-inject-fixture.ts")],
      env: { ...bunEnv, SPAWN_FAULT_DLL: dll, SPAWN_FAULT_N: String(N) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const byTag: Record<string, any> = {};
    for (const line of stdout.split("\n")) {
      if (!line.startsWith("{")) continue;
      const obj = JSON.parse(line);
      byTag[obj.tag] = obj;
    }
    return { byTag, stdout, stderr, exitCode };
  }

  let result: Awaited<ReturnType<typeof run>>;

  test("fixture runs", async () => {
    result = await run();
    expect(normalizeBunSnapshot(result.stderr)).toBe("");
    expect(result.byTag.hooks).toEqual({
      tag: "hooks",
      assignProcessToJobObject: true,
      resumeThread: true,
    });
    expect(result.exitCode).toBe(0);
  }, 120_000);

  test("AssignProcessToJobObject failure: throws EBADF, no handle leak", () => {
    const r = result.byTag.assignProcessToJobObject;
    expect({
      threw: r.threw,
      hookCalls: r.hookCalls,
      code: r.code,
      syscall: r.syscall,
      otherErr: r.otherErr,
    }).toEqual({
      threw: N,
      hookCalls: N,
      code: "EBADF",
      syscall: "uv_spawn",
      otherErr: undefined,
    });
    // 2*N would be the leak (hProcess + hThread per spawn); allow a small
    // amount of unrelated background-thread jitter.
    expect(r.delta).toBeLessThan(N / 4);
    expect(result.byTag["recover-after-A"].exitCode).toBe(0);
  });

  test("ResumeThread failure (detached): throws EBADF, no handle leak", () => {
    const r = result.byTag.resumeThread;
    expect({
      threw: r.threw,
      hookCalls: r.hookCalls,
      code: r.code,
      syscall: r.syscall,
      otherErr: r.otherErr,
    }).toEqual({
      threw: N,
      hookCalls: N,
      code: "EBADF",
      syscall: "uv_spawn",
      otherErr: undefined,
    });
    expect(r.delta).toBeLessThan(N / 4);
    expect(result.byTag["recover-after-B"].exitCode).toBe(0);
  });
});
