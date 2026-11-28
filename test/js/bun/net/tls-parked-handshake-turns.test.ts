// Kept separate from socket-syscall-fault.test.ts, which has the other cases of the TLS
// low-priority queue, for the reason parallel-startup-failure.test.ts gives: file-level
// pass/fail is what the surrounding tooling checks, and on a debug build several cases of that
// file run close to the 5 s default timeout.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir, tls } from "harness";
import { join } from "node:path";

// A parked socket has no readable poll, and the queue gives 5 sockets back at the start of each
// loop iteration. So the loop has to iterate by itself while sockets are parked: it used to wait
// for the next timer, or for an event of some other socket, before it gave the next 5 back.
//
// The fixture parks 59 of 64 accepted sockets and pauses all of them but the one the queue gives
// back last. A paused socket comes back silent, so nothing leads the loop to that one, and only
// 6 clients complete a handshake: the 5 of the budget and that one. It needs ceil(58 / 5) = 12
// iterations to be given back, plus the round trips of its handshake. After that the queue is
// empty and the loop has to wait again: `turnsWhileQuiet` is the fixture's own 250 ms timer and
// what is left of that handshake, not a loop that spins.
//
// On macOS the fixture gets a directory for unix sockets (see tls-fixture-transport.ts).
test("TLS low-prio queue: the loop gives parked sockets back without an event from outside", async () => {
  using unixDir = isMacOS ? tempDir("tlsq", {}) : undefined;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "tls-parked-handshake-turns-fixture.ts")],
    env: { ...bunEnv, TLS_CERT: tls.cert, TLS_KEY: tls.key, TLS_FIXTURE_UNIX_DIR: unixDir && String(unixDir) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let summary: any = stdout.trim();
  try {
    summary = JSON.parse(stdout.trim().split("\n").pop()!);
  } catch {}

  expect({
    summary,
    signalCode: proc.signalCode,
    exitCode,
    stderrTail: exitCode === 0 ? "" : stderr.slice(-2000),
  }).toEqual({
    summary: {
      opened: 64,
      clientHandshakes: 6,
      pickedHandshake: true,
      turnsToPicked: expect.any(Number),
      turnsWhileQuiet: expect.any(Number),
      errors: 0,
    },
    signalCode: null,
    exitCode: 0,
    stderrTail: "",
  });
  expect(summary.turnsToPicked).toBeGreaterThanOrEqual(12);
  expect(summary.turnsToPicked).toBeLessThanOrEqual(24);
  expect(summary.turnsWhileQuiet).toBeLessThanOrEqual(8);
});
