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
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix } from "harness";

// Absolute argv[0] so PATH lookup (which_for_spawn) is skipped; on musl that
// lookup fails under EMFILE before the event loop is created and turns the
// failure into ENOENT instead of exercising us_create_loop.
const fixture = /* js */ `
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

  for (const fd of held) fs.closeSync(fd);

  if (!first.ok) { console.error(first.msg); process.exit(1); }
  console.error("spawnSync threw:", first.code, first.msg);

  // Descriptors are free again: the isolated loop was not cached on failure,
  // so this call creates it successfully and runs the child.
  const retry = Bun.spawnSync({ cmd: ["/bin/sh", "-c", ":"], stdio: ["ignore", "ignore", "ignore"] });
  console.error("retry exit:", retry.exitCode);
  console.error("SURVIVED");
`;

const causeFixture = /* js */ `
  import * as fs from "node:fs";
  process.nextTick(() => {});

  const held = [];
  const fill = () => { for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } } };
  const run = () => Bun.spawnSync({ cmd: ["/bin/sh", "-c", ":"], stdio: ["ignore", "ignore", "ignore"] });
  const attempt = () => {
    try {
      run();
      return "returned";
    } catch (e) {
      return e.code + " " + e.errno + " " + e.syscall;
    }
  };

  const report = {};
  fill();
  if (process.platform === "linux") {
    fs.closeSync(held.pop());
    report.oneLeft = attempt();
    fill();
  }
  report.noneLeft = attempt();
  for (const fd of held) fs.closeSync(fd);
  report.retry = run().exitCode;
  console.error(JSON.stringify(report));
`;

// The first fetch() starts the HTTP client thread, which creates its own loop.
const threadLoopFixture = /* js */ `
  import * as fs from "node:fs";
  process.nextTick(() => {});

  const held = [];
  for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } }
  await fetch("http://127.0.0.1:1/").catch(() => {});
  console.log("the fetch settled");
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
    expect(stderr).toContain("retry exit: 0");
    expect(stderr).toContain("SURVIVED");
    expect(exitCode).toBe(0);
  });

  // The error names the call that ran out of descriptors. On Linux the loop
  // takes two: with one left, epoll_create1 gets it and eventfd fails.
  test("the thrown error names the call that failed", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `ulimit -n 512 && exec "$1" --no-install -e "$2"`, "sh", bunExe(), causeFixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const line = stderr.trim().split("\n").pop() ?? "";
    expect({ stdout, line }).toEqual({ stdout: "", line: expect.stringContaining("{") });
    expect(JSON.parse(line)).toEqual(
      isLinux
        ? { oneLeft: "EMFILE -24 eventfd", noneLeft: "EMFILE -24 epoll_create1", retry: 0 }
        : { noneLeft: "EMFILE -24 kqueue", retry: 0 },
    );
    expect(exitCode).toBe(0);
  });
});

// A thread's own loop has no caller that could carry on without it, so the
// process ends. The message names the call and the errno as well.
test.skipIf(!isLinux)("a thread's event loop under EMFILE ends the process with the call and the errno", async () => {
  await using proc = Bun.spawn({
    cmd: [
      "/bin/sh",
      "-c",
      `ulimit -c 0 && ulimit -n 512 && exec "$1" --no-install -e "$2" --debug-crash-handler-use-trace-string`,
      "sh",
      bunExe(),
      threadLoopFixture,
    ],
    env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("failed to create the event loop: epoll_create1() failed: EMFILE: ");
  expect({ stdout, signalCode: proc.signalCode }).toEqual({ stdout: "", signalCode: "SIGABRT" });
});

// The loop also needs its wakeup eventfd in the epoll set. epoll_ctl refuses
// that with ENOSPC at fs.epoll.max_user_watches, or with ENOMEM. A loop that
// is handed out anyway can never be woken by another thread, so this failure
// has to reach the caller like the two above: one thrown error that names the
// call, nothing left open, and a later call that works. epoll only: it is the
// one backend whose wakeup registration goes through the poll_start hook.
const refusedRegistrationFixture = /* js */ `
  const { socketFaultInjection: fault } = require("bun:internal-for-testing");
  const fs = require("node:fs");
  const openFds = () => fs.readdirSync("/proc/self/fd").length;
  const run = () => Bun.spawnSync({ cmd: ["/bin/sh", "-c", ":"], stdio: ["ignore", "ignore", "ignore"] });
  const refused = () => {
    fault.set({ syscall: "poll_start", action: "errno", errno: 28 /* ENOSPC */, repeat: 1 });
    try {
      run();
      return "returned";
    } catch (e) {
      return e.code + " " + e.errno + " " + e.syscall;
    } finally {
      fault.clear();
    }
  };
  const first = refused();
  const afterFirst = openFds();
  const second = refused();
  const leaked = openFds() - afterFirst;
  console.log(JSON.stringify({ first, second, leaked, retry: run().exitCode }));
`;

test.skipIf(!fault.available() || !isLinux)(
  "Bun.spawnSync throws when the wakeup of its event loop cannot be registered",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", refusedRegistrationFixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const line = stdout.trim().split("\n").pop() ?? "";
    expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
    expect(JSON.parse(line)).toEqual({
      first: "ENOSPC -28 epoll_ctl",
      second: "ENOSPC -28 epoll_ctl",
      leaked: 0,
      retry: 0,
    });
    expect(exitCode).toBe(0);
  },
);
