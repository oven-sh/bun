import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen } from "harness";

// On Linux, Bun.spawn opens a pidfd after posix_spawn so the event loop can
// observe the child's exit. When the process is at its RLIMIT_NOFILE, the
// socketpairs for stdin/stdout can succeed and pidfd_open can still fail with
// EMFILE. That arm used to block the JS thread in wait4() until the child
// exited on its own. A child that reads its stdin (cat) never exits, because
// the write end of that pipe belongs to the blocked parent: a deadlock with
// no timers firing.
//
// The fixture walks the spare-fd count up from 1 so the exact boundary does not
// matter: every attempt must finish, as a thrown EMFILE or a clean exit.
test.skipIf(!isLinux)("Bun.spawn at the fd limit fails with EMFILE instead of blocking in wait4", async () => {
  const fixture = `
const fs = require("fs");
const held = [];
for (;;) {
  try {
    held.push(fs.openSync("/dev/null", "r"));
  } catch {
    break;
  }
}
for (let spare = 1; spare <= 6; spare++) {
  fs.closeSync(held.pop());
  let result;
  try {
    const p = Bun.spawn(["/bin/cat"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    p.stdin.end();
    const [text, code] = await Promise.all([p.stdout.text(), p.exited]);
    result = "ok " + code + " " + JSON.stringify(text);
  } catch (e) {
    result = "err " + e.code + " " + e.syscall;
  }
  console.log(spare + ": " + result);
}
`;

  await using proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Without the fix the fixture blocks forever inside Bun.spawn at the
  // pidfd_open boundary and this test times out.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  expect(lines).toHaveLength(6);
  expect(lines.filter(l => l.includes("err EMFILE pidfd_open"))).toHaveLength(1);
  expect(lines.at(-1)).toBe('6: ok 0 ""');
  for (const line of lines) {
    expect(line).toMatch(/^\d: (err EMFILE (socketpair|pidfd_open)|ok 0 "")$/);
  }
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// With every stdio slot inherited, nothing allocates an fd before posix_spawn,
// so at zero free fds pidfd_open is the first call that fails. The fixture's
// stdin is a pipe whose write end this test keeps open, so a blocked wait4 on
// `cat` would never return. node:child_process reaches the same arm and must
// report the failure as an "error" event, as node does at its fd limit.
test.skipIf(!isLinux)(
  "Bun.spawn with inherited stdio at zero free fds fails with EMFILE instead of blocking in wait4",
  async () => {
    const fixture = `
const fs = require("fs");
const { spawn } = require("child_process");
// Run the deferred "error" path once while fds are still free: a debug build
// reads the builtins it lazily requires (process.nextTick's queue) from disk.
await new Promise(resolve => spawn("/nonexistent", { stdio: "ignore" }).once("error", resolve));
const held = [];
for (;;) {
  try {
    held.push(fs.openSync("/dev/null", "r"));
  } catch {
    break;
  }
}
try {
  const p = Bun.spawn(["/bin/cat"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  p.kill();
  console.log("Bun.spawn: ok");
} catch (e) {
  console.log("Bun.spawn: err " + e.code + " " + e.syscall);
}
const child = spawn("/bin/cat", { stdio: "inherit" });
const result = await new Promise(resolve => {
  child.once("error", e => resolve("err " + e.code + " " + e.syscall));
  child.once("spawn", () => {
    child.kill();
    resolve("ok");
  });
});
console.log("child_process.spawn: " + result);
// LeakSanitizer reads /proc/self/task at exit, which needs a free fd.
for (const fd of held) fs.closeSync(fd);
`;

    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), "-e", fixture],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("Bun.spawn: err EMFILE pidfd_open\nchild_process.spawn: err EMFILE spawn /bin/cat\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

// A process that ignores SIGCHLD keeps no zombie, so pidfd_open can find no process: that child has no pidfd to watch.
test.concurrent.skipIf(!isLinux)("a child that is gone before its pidfd is opened still reports its exit", async () => {
  const fixture = `
const { dlopen, ptr } = require("bun:ffi");
const { SIGCHLD } = require("node:os").constants.signals;
const SIG_IGN = 1;
const PR_SET_NO_NEW_PRIVS = 38;
const PR_SET_SECCOMP = 22;
const SECCOMP_MODE_FILTER = 2;
const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, {
  prctl: { args: ["int", "u64", "u64", "u64", "u64"], returns: "int" },
  signal: { args: ["int", "ptr"], returns: "ptr" },
});
// struct sock_filter { u16 code; u8 jt; u8 jf; u32 k; }
const instruction = (code, jt, jf, k) => [code | (jt << 16) | (jf << 24), k];
// Whether a child is gone before pidfd_open runs is a race, so this filter makes every pidfd_open fail with ESRCH.
const instructions = new Uint32Array([
  ...instruction(0x20, 0, 0, 0), // load the number of the system call
  ...instruction(0x15, 0, 1, 434), // skip one unless it is pidfd_open
  ...instruction(0x06, 0, 0, 0x00050000 | 3), // SECCOMP_RET_ERRNO | ESRCH
  ...instruction(0x06, 0, 0, 0x7fff0000), // SECCOMP_RET_ALLOW
]);
// struct sock_fprog { u16 len; struct sock_filter *filter; }
const program = new BigUint64Array([4n, BigInt(ptr(instructions))]);
const filter = [
  libc.symbols.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0),
  libc.symbols.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ptr(program), 0, 0),
];
// A trap "" CHLD in dash does not reach the program that it execs.
libc.symbols.signal(SIGCHLD, SIG_IGN);
let exits = 0;
let unreported = 0;
let withoutPidfd = 0;
const settled = [];
const { promise, resolve } = Promise.withResolvers();
for (let i = 0; i < 3; i++) {
  let reported = false;
  const proc = Bun.spawn({
    cmd: ["true"],
    stdio: ["ignore", "ignore", "ignore"],
    onExit() {
      reported = true;
      if (++exits === 3) resolve();
    },
  });
  const exited = proc.exited;
  // wait4 has nothing to report for a child that the kernel reaped.
  settled.push(exited.then(code => "resolved " + code, e => "rejected " + e.code));
  // Without a pidfd the exit is known when Bun.spawn returns.
  if (Bun.peek.status(exited) !== "pending") {
    withoutPidfd++;
    if (!reported) unreported++;
  }
}
// Waiting for an exit that Bun.spawn did not report would hang.
if (unreported === 0) await promise;
// signal() returns the disposition that it replaces. LeakSanitizer needs the default one when the process exits.
const sigchldIgnored = libc.symbols.signal(SIGCHLD, null) === SIG_IGN;
// Unloaded, so that LeakSanitizer has nothing of dlopen() to look up when the process exits.
libc.close();
const outcomes = new Set(await Promise.all(settled));
console.log(JSON.stringify({ filter, sigchldIgnored, withoutPidfd, unreported, exits, exited: [...outcomes] }));
`;

  // The pipe on fd 0 stays open and silent: bun used to watch fd 0 for a child that has no pidfd.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      JSON.stringify({
        filter: [0, 0],
        sigchldIgnored: true,
        withoutPidfd: 3,
        unreported: 0,
        exits: 3,
        exited: ["rejected ECHILD"],
      }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});
