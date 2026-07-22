// Bun.spawnSync lazily creates an isolated uSockets event loop per VM
// (epoll_create1/kqueue on POSIX, uv_loop_new on Windows). When that syscall
// fails under resource exhaustion, us_create_loop used to dereference the
// NULL/invalid result and crash the whole process. The one spawnSync call must
// throw a catchable error instead, and once resources are freed a retry must
// work.
//
// The Windows variant (uv_loop_new -> CreateIoCompletionPort failing under
// handle/non-paged-pool exhaustion) routes through the same NULL propagation
// in us_create_loop / WindowsLoop::create / SpawnSyncEventLoop::init; this
// test exercises the POSIX half where the failure is reproducible with a file
// descriptor limit.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

const fixture = /* js */ `
  import * as fs from "node:fs";
  // Warm anything lazily opened on first use so the fd fill below leaves zero
  // descriptors for us_create_loop itself (not for a module loader read).
  process.nextTick(() => {});

  const held = [];
  for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } }

  let first;
  try {
    Bun.spawnSync({ cmd: ["true"], stdio: ["ignore", "ignore", "ignore"] });
    first = { ok: false, msg: "UNEXPECTED: spawnSync succeeded" };
  } catch (e) {
    first = { ok: true, code: e?.code, msg: String(e?.message ?? e) };
  }

  for (const fd of held) fs.closeSync(fd);

  if (!first.ok) { console.error(first.msg); process.exit(1); }
  console.error("spawnSync threw:", first.code, first.msg);

  // Descriptors are free again: the isolated loop was not cached on failure,
  // so this call creates it successfully and runs the child.
  const retry = Bun.spawnSync({ cmd: ["true"], stdio: ["ignore", "ignore", "ignore"] });
  console.error("retry exit:", retry.exitCode);
  console.error("SURVIVED");
`;

describe.skipIf(!isPosix)("Bun.spawnSync event-loop creation under EMFILE", () => {
  test("throws instead of aborting the process", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `ulimit -n 512 && exec "$1" --no-install -e "$2"`, "sh", bunExe(), fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: expect.stringContaining("SURVIVED"),
      exitCode: 0,
    });
    expect(stderr).toContain("spawnSync threw: EMFILE");
    expect(stderr).toContain("retry exit: 0");
  });
});
