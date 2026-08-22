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
