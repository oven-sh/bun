import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix } from "harness";

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

// The call that runs out of descriptors takes no file: the socketpair of a
// pipe, the fcntl that moves a descriptor the caller passed above the child's
// stdio slots, and on Linux the pidfd_open after the child has started. The
// error names the command as its `path` all the same: argv[0] as the child
// would have seen it, which is also the path of a posix_spawn that fails.
// bun 1.3 reported the first two as posix_spawn with that path.
test.skipIf(!isPosix)("Bun.spawn at the fd limit names the command as the path of the EMFILE error", async () => {
  const fixture = `
const fs = require("fs");
const cmd = ["/bin/sh", "-c", ":"];
// The first Bun.spawnSync of a process creates an event loop, and that takes
// descriptors of its own (spawn-sync-loop-init-fail.test.ts).
Bun.spawnSync({ cmd, stdio: ["ignore", "ignore", "ignore"] });
const held = [];
for (;;) {
  try {
    held.push(fs.openSync("/dev/null", "r"));
  } catch {
    break;
  }
}
function attempt(spawn) {
  try {
    spawn().kill?.();
    return "spawned";
  } catch (e) {
    return { message: e.message, code: e.code, syscall: e.syscall, path: e.path, fd: e.fd };
  }
}
const pipes = { stdin: "pipe", stdout: "pipe", stderr: "inherit" };
const passedFd = { stdio: ["ignore", "ignore", "ignore", 1] };
const errors = {
  spawnPipes: attempt(() => Bun.spawn(cmd, pipes)),
  spawnSyncPipes: attempt(() => Bun.spawnSync(cmd, pipes)),
  spawnPassedFd: attempt(() => Bun.spawn(cmd, passedFd)),
  spawnSyncPassedFd: attempt(() => Bun.spawnSync(cmd, passedFd)),
  spawnArgv0: attempt(() => Bun.spawn(cmd, { ...pipes, argv0: "pretend" })),
  spawnSyncArgv0: attempt(() => Bun.spawnSync(cmd, { ...pipes, argv0: "pretend" })),
};
if (process.platform === "linux") {
  errors.spawnInherit = attempt(() => Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" }));
  // Elsewhere the search of PATH opens each candidate, so a name is not found with no descriptor left.
  errors.spawnName = attempt(() => Bun.spawn(["sh", "-c", ":"], pipes));
}
// LeakSanitizer reads /proc/self/task at exit, which needs a free fd.
for (const fd of held) fs.closeSync(fd);
console.log(JSON.stringify(errors));
`;

  await using proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const emfile = (syscall: string) => ({ message: "EMFILE: too many open files, " + syscall, code: "EMFILE", syscall });
  const socketpair = { ...emfile("socketpair"), path: "/bin/sh" };
  const fcntl = { ...emfile("fcntl"), path: "/bin/sh", fd: 1 };
  expect({ errors: stdout.startsWith("{") ? JSON.parse(stdout) : stdout, stderr, exitCode }).toEqual({
    errors: {
      spawnPipes: socketpair,
      spawnSyncPipes: socketpair,
      spawnPassedFd: fcntl,
      spawnSyncPassedFd: fcntl,
      spawnArgv0: { ...socketpair, path: "pretend" },
      spawnSyncArgv0: { ...socketpair, path: "pretend" },
      ...(isLinux && {
        spawnInherit: { ...emfile("pidfd_open"), path: "/bin/sh" },
        spawnName: { ...socketpair, path: "sh" },
      }),
    },
    stderr: "",
    exitCode: 0,
  });
});
