import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// The first spawnSync in a process creates its own isolated event loop. That
// loop needs fds of its own (epoll + eventfd on Linux, kqueue on macOS). When
// the process is at RLIMIT_NOFILE, loop creation used to abort the whole
// process with "panic: eventfd() failed during loop init". An async Bun.spawn
// at the same point already returned a plain EMFILE.
//
// The fixture walks the spare-fd count up from 0: every attempt must finish as
// a thrown EMFILE or a clean exit, and the first attempt (zero spare fds) must
// fail at the loop's own fd.
test.skipIf(isWindows)("Bun.spawnSync at the fd limit throws EMFILE instead of aborting the process", async () => {
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
for (let spare = 0; spare <= 8; spare++) {
  if (spare > 0) fs.closeSync(held.pop());
  let result;
  try {
    const r = Bun.spawnSync(["/bin/echo", "hi"]);
    result = "ok " + r.exitCode + " " + JSON.stringify(r.stdout.toString());
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  expect(lines).toHaveLength(9);
  expect(lines[0]).toMatch(/^0: err EMFILE (eventfd|kqueue)$/);
  expect(lines.at(-1)).toBe('8: ok 0 "hi\\n"');
  for (const line of lines) {
    expect(line).toMatch(/^\d: (err EMFILE (eventfd|kqueue|socketpair|posix_spawn|pidfd_open)|ok 0 "hi\\n")$/);
  }
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
