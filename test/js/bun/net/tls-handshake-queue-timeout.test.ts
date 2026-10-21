// uSockets reads at most 5 handshaking TLS sockets per loop iteration and parks the others in
// its low-priority queue: reads off, unlinked from their group. The loop holds back the reads of
// a parked socket, so the socket's timeouts must not run there: the owner would act on a peer
// whose bytes nobody read. They run again once the queue releases the socket, and after 30 sweep
// ticks (120 s) in the queue at the latest.
//
// Each fixture prints one JSON summary line. The explicit timeouts are for debug builds, where a
// fixture of one or two Bun processes takes seconds.
import { expect, test } from "bun:test";
import { bunRun, isLinux, isMacOS, tempDir } from "harness";
import { join } from "node:path";

async function runFixture(name: string) {
  // See tls-fixture-transport.ts.
  using unixDir = isMacOS ? tempDir("tlsq", {}) : undefined;
  const result = await bunRun(join(import.meta.dir, name), { TLS_FIXTURE_UNIX_DIR: unixDir && String(unixDir) });
  expect(result).toSpawn();
  return JSON.parse(result.stdout);
}

// The fixture parks 15 of 20 Bun.listen sockets, runs the timeout sweep by hand and counts the
// `timeout` handlers per step:
//   oneTick: 5 while the 15 are parked (the sockets that were read), 15 once the queue let them
//     go. A timeout that runs on a parked socket gives "20,0", one that is lost in the queue "5,0".
//   unarmed: a parked socket with no timeout never gets one.
//   parkedTooLong: after 30 ticks in the queue the timeout runs there.
test.concurrent(
  "the timeouts of a parked socket run after the queue releases it",
  async () => {
    expect(await runFixture("tls-parked-handshake-timeout-fixture.ts")).toEqual({
      opened: 20,
      oneTick: ["5,15"],
      unarmed: [0, 0],
      parkedTooLong: [5, 15],
      errors: 0,
    });
  },
  30_000,
);

// The same rule seen from a client of Bun.serve. The server accepts a burst of 40 TLS clients in
// one loop iteration and then lets the loop iterate once per sweep tick, for the 3 ticks of the
// 10 s that a connection has to send its request. Most of the burst is still in the queue when
// that timeout comes due (`queueFullAtLastTick`). A server that runs it there resets those
// clients: answered 10, ECONNRESET 30.
test.concurrent(
  "Bun.serve answers every client of a burst that outwaits its idle timeout in the queue",
  async () => {
    expect(await runFixture("tls-serve-parked-burst-fixture.ts")).toEqual({
      clients: 40,
      answered: 40,
      errors: {},
      queueFullAtLastTick: true,
    });
  },
  60_000,
);

// With a deferred accept (Linux) the accept path itself dispatches the first readable event of a
// new socket, and over the handshake budget that dispatch parks the socket. A socket that arrived
// with input must be parked at once, so that its timeout stops: of 12 such connections the server
// closes the 5 that it read after 3 hand-run ticks, and the 7 in the queue only after the queue
// released them and 3 more ticks passed.
test.concurrent.skipIf(!isLinux)(
  "Bun.serve parks a connection that arrives with input over the handshake budget at once",
  async () => {
    expect(await runFixture("tls-serve-deferred-accept-fixture.ts")).toEqual({
      clients: 12,
      closedWhileParked: 5,
      closedAfterRelease: 12,
    });
  },
  30_000,
);
