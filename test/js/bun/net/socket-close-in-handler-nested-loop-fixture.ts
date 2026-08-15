// Run with `bun test` (socket.test.ts spawns it): `expect().resolves` below is
// what drives the event loop re-entrantly from inside a socket handler.
//
// Each case closes a socket from inside one of that socket's own handlers and
// then runs nested event loop iterations before the handler returns. The
// dispatch that invoked the handler (loop.c: the read path, the accept path and
// the peer-FIN path) still holds the socket and reads it once the handler
// returns, so the nested iterations must leave the loop's closed list alone.
// epoll/kqueue defer that free with tick_depth; the libuv (Windows) backend did
// not maintain tick_depth, so the nested iterations freed the socket and the
// debug build crashed on the poisoned memory as soon as the handler returned
// (release builds corrupted the heap instead).
import type { Socket } from "bun";
import { expect, test } from "bun:test";

const HOST = "127.0.0.1";

interface HandlerReport {
  /** Nothing had arrived on the side channel when the handler started waiting... */
  pongBeforeWait: boolean;
  /** ...and the round trip had completed when the nested run returned, so iterations really ran. */
  pongAfterWait: boolean;
}

/**
 * `closeAndWait` closes `socket` from inside one of its handlers and blocks
 * there, running the event loop re-entrantly, until a byte written to an
 * unrelated, already established connection comes back out of its peer's
 * `data` handler. That takes at least one full nested iteration, during which
 * `socket` is on the loop's closed list while the dispatch that called the
 * handler is still on the stack.
 *
 * The progress signal is deliberately not "the peer of `socket` noticed the
 * close": on Windows the peer's own pending event may have been dequeued in the
 * same batch as the event being dispatched, and a nested run never sees that
 * batch, so waiting on it would deadlock.
 */
async function createScenario() {
  let pong = false;
  const pongReceived = Promise.withResolvers<void>();
  const report = Promise.withResolvers<HandlerReport>();
  const sideChannelOpen = Promise.withResolvers<Socket>();

  const sideChannelListener = Bun.listen({
    hostname: HOST,
    port: 0,
    socket: {
      open(socket) {
        sideChannelOpen.resolve(socket);
      },
      data() {},
      close() {},
    },
  });
  const pinger = await Bun.connect({
    hostname: HOST,
    port: sideChannelListener.port,
    socket: {
      data() {
        pong = true;
        pongReceived.resolve();
      },
      close() {},
    },
  });
  const ponger = await sideChannelOpen.promise;
  sideChannelListener.stop();

  return {
    closeAndWait(socket: { terminate(): void }) {
      const pongBeforeWait = pong;
      socket.terminate();
      ponger.write("pong");
      expect(pongReceived.promise).resolves.toBeUndefined();
      report.resolve({ pongBeforeWait, pongAfterWait: pong });
    },
    report: report.promise,
    close() {
      pinger.terminate();
      ponger.terminate();
    },
  };
}

const expectedReport: HandlerReport = { pongBeforeWait: false, pongAfterWait: true };

test("client socket closed inside its own data handler", async () => {
  const scenario = await createScenario();

  using listener = Bun.listen({
    hostname: HOST,
    port: 0,
    socket: {
      open(socket) {
        socket.write("x");
      },
      data() {},
      close() {},
    },
  });

  await Bun.connect({
    hostname: HOST,
    port: listener.port,
    socket: {
      data(socket) {
        scenario.closeAndWait(socket);
      },
      close() {},
    },
  });

  expect(await scenario.report).toEqual(expectedReport);
  scenario.close();
  console.log("data: ok");
});

test("accepted socket closed inside its own open handler", async () => {
  const scenario = await createScenario();

  using listener = Bun.listen({
    hostname: HOST,
    port: 0,
    socket: {
      open(socket) {
        scenario.closeAndWait(socket);
      },
      data() {},
      close() {},
    },
  });

  const client = Bun.connect({
    hostname: HOST,
    port: listener.port,
    socket: {
      data() {},
      close() {},
      connectError() {},
    },
  });

  expect(await scenario.report).toEqual(expectedReport);
  await client.then(
    socket => socket.terminate(),
    () => {},
  );
  scenario.close();
  console.log("open: ok");
});

test("accepted socket closed inside its own end handler", async () => {
  const scenario = await createScenario();

  using listener = Bun.listen({
    hostname: HOST,
    port: 0,
    socket: {
      data() {},
      end(socket) {
        scenario.closeAndWait(socket);
      },
      close() {},
    },
  });

  const client = await Bun.connect({
    hostname: HOST,
    port: listener.port,
    socket: {
      data() {},
      close() {},
    },
  });
  // Half-close: the FIN is what fires the server's `end` handler.
  client.shutdown();

  expect(await scenario.report).toEqual(expectedReport);
  client.terminate();
  scenario.close();
  console.log("end: ok");
});
