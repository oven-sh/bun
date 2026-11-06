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

// Absolute argv[0] so PATH lookup (which_for_spawn) is skipped; on musl that
// lookup fails under EMFILE before the event loop is created and turns the
// failure into ENOENT instead of exercising us_create_loop.
const fixture = /* js */ `
  import { spawnSync as nodeSpawnSync } from "node:child_process";
  import * as fs from "node:fs";
  // Warm anything lazily opened on first use so the fd fill below leaves zero
  // descriptors for us_create_loop itself (not for a module loader read).
  process.nextTick(() => {});

  const held = [];
  for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } }

  let first;
  try {
    Bun.spawnSync({ cmd: ["/bin/sh", "-c", ":"], stdio: ["ignore", "ignore", "ignore"] });
    first = { ok: false, msg: "UNEXPECTED: spawnSync succeeded" };
  } catch (e) {
    first = { ok: true, code: e?.code, msg: String(e?.message ?? e) };
  }
  // node:child_process has a failure of the spawn in result.error.
  const { error, status, pid, output } = nodeSpawnSync("/bin/sh", ["-c", ":"], { stdio: "ignore" });
  const node = JSON.stringify({ code: error?.code, syscall: error?.syscall, status, pid, output });

  for (const fd of held) fs.closeSync(fd);

  if (!first.ok) { console.error(first.msg); process.exit(1); }
  console.error("spawnSync threw:", first.code, first.msg);
  console.error("child_process.spawnSync returned:", node);

  // Descriptors are free again: the isolated loop was not cached on failure,
  // so this call creates it successfully and runs the child.
  const retry = Bun.spawnSync({ cmd: ["/bin/sh", "-c", ":"], stdio: ["ignore", "ignore", "ignore"] });
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
    expect(stdout).toBe("");
    expect(stderr).toContain("spawnSync threw: EMFILE");
    expect(stderr).toContain(
      'child_process.spawnSync returned: {"code":"EMFILE","syscall":"spawnSync /bin/sh","status":null,"pid":0,"output":null}',
    );
    expect(stderr).toContain("retry exit: 0");
    expect(stderr).toContain("SURVIVED");
    expect(exitCode).toBe(0);
  });
});
