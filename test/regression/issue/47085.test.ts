// https://github.com/oven-sh/bun/issues/47085
// A seccomp policy that denies the socket syscalls (sendto/recvfrom) with
// EPERM but allows read/write must not break stdio on a socketpair. Node only
// ever uses read/write on a stream handle, so it keeps working in such a
// sandbox.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "47085-fixture.js");

async function run(denied: "sendto" | "recvfrom", mode: string, stdin?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, denied, mode],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined) proc.stdin.write(stdin);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Some sandboxes forbid installing a seccomp filter at all. Then there is nothing to test.
const canInstallFilter = isLinux && (await run("sendto", "probe")).exitCode === 0;

describe.skipIf(!canInstallFilter)("stdio on a socketpair when seccomp denies the socket syscalls", () => {
  test.concurrent("process.stdout.write when sendto is denied", async () => {
    expect(await run("sendto", "stdout")).toEqual({ stdout: "SA", stderr: "callback:ok", exitCode: 0 });
  });

  test.concurrent("process.stdin when recvfrom is denied", async () => {
    expect(await run("recvfrom", "stdin", "hello")).toEqual({ stdout: "got:hello", stderr: "", exitCode: 0 });
  });

  test.concurrent("Bun.stdin.text() when recvfrom is denied", async () => {
    expect(await run("recvfrom", "bun-stdin", "hello")).toEqual({ stdout: "got:hello", stderr: "", exitCode: 0 });
  });

  test.concurrent("spawnSync captures a child's output when recvfrom is denied", async () => {
    expect(await run("recvfrom", "spawn-sync")).toEqual({
      stdout: JSON.stringify({ status: 0, stdout: "from child", error: null }),
      stderr: "",
      exitCode: 0,
    });
  });
});
