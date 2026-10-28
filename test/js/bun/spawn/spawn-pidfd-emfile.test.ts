import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

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

// A pidfd normally moves off a stdio number that the program closed. With no other number free it stays
// there. It is still the child's pidfd and not the process's stdio, so it is closed when the child exits.
test.skipIf(!isLinux).each([0, 1, 2])(
  "a pidfd that has to stay on the closed fd %d is closed when the child has exited",
  async slot => {
    const fixture = `
const fs = require("fs");
const at = fd => {
  try {
    fs.fstatSync(fd);
  } catch (e) {
    return e.code === "EBADF" ? "closed" : e.code;
  }
  return fs.readlinkSync("/proc/self/fd/" + fd);
};
const nul = fs.openSync("/dev/null", "r+");
const spawnTrue = () => Bun.spawn({ cmd: ["true"], stdio: [nul, nul, nul] });
// Run the path once while fds are still free: a debug build reads the builtins it lazily requires from disk.
await spawnTrue().exited;
const held = [];
for (;;) {
  try {
    held.push(fs.openSync("/dev/null", "r"));
  } catch {
    break;
  }
}
fs.closeSync(${slot});
const child = spawnTrue();
const whileRunning = at(${slot});
const exitCode = await child.exited;
const afterExit = at(${slot});
// LeakSanitizer reads /proc/self/task at exit, which needs a free fd.
for (const fd of held) fs.closeSync(fd);
fs.writeSync(${slot === 1 ? 2 : 1}, JSON.stringify({ whileRunning, exitCode, afterExit }));
`;

    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), "-e", fixture],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The fixture writes its result to stderr when it closed stdout.
    expect({ result: slot === 1 ? stderr : stdout, exitCode }).toEqual({
      result: JSON.stringify({ whileRunning: "anon_inode:[pidfd]", exitCode: 0, afterExit: "closed" }),
      exitCode: 0,
    });
  },
);

// A process that ignores SIGCHLD does not keep a child that has exited. pidfd_open then finds no
// process, and the child has no pidfd to watch.
test.skipIf(!isLinux)("a child that is gone before its pidfd is opened still reports its exit", async () => {
  const fixture = `
let exits = 0;
const children = [];
for (let i = 0; i < 100; i++) {
  children.push(Bun.spawn({ cmd: ["true"], stdio: ["ignore", "ignore", "ignore"], onExit() { exits++; } }).exited);
}
await Promise.all(children);
console.log(exits);
`;
  await using proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", 'trap "" CHLD; exec "$@"', "sh", bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "100\n", stderr: "", exitCode: 0 });
});
