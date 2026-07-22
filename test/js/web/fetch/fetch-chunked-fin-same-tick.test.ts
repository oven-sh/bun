import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// kqueue used to map EV_EOF (from either filter) straight to dispatch's `eof`,
// so an EVFILT_WRITE event carrying EV_EOF — peer fully closed while we were
// still uploading — closed the socket before the recv loop drained the response
// bytes the same FIN carried. Linux never hit this because the epoll path only
// maps EPOLLHUP and discovers half-close via recv()==0.
test("fetch() drains a chunked body when the server FINs in the same tick (kqueue EV_EOF)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-chunked-fin-same-tick-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
    stdout: "OK 200",
    stderr: "",
    exitCode: 0,
  });
});
