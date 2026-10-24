// On Linux, a subprocess's pidfd is the only exit-notification poll when
// stdio is ignored. It was registered with EPOLLONESHOT, so the kernel
// disarms the fd the instant epoll_wait returns it — before user-space
// has dispatched it. If the event is then dropped in user-space before
// `onUpdate` reaches it, the fd is left permanently disarmed with no
// re-arm path, and the subprocess's `'exit'` event arrives only when the
// next unrelated timer happens to wake the loop.
//
// The drop happens when a poll callback re-enters `us_loop_run_bun_tick`
// (e.g. `expect(p).resolves` → `waitForPromise` → `autoTick`), which
// overwrites the shared `loop->ready_polls` / `num_ready_polls` /
// `current_ready_poll` while the outer dispatch is still mid-iteration.
// The outer loop resumes with the inner tick's indices and silently skips
// its own remaining events.
//
// Observed in the wild as a 5s `afterAll` timeout in
// anthropic-experimental/sandbox-runtime on GH Actions ubuntu-24.04 x86
// runners (two socat bridges SIGTERM'd together; one's event lost).
//
// Fix: register the pidfd level-triggered (no EPOLLONESHOT). A pidfd stays
// readable from process exit until close, so a dropped ready_polls slot is
// harmless — the next epoll_wait returns it again.
import { createSocketPair } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isLinux, isWindows } from "harness";
import { closeSync, readSync, writeSync } from "node:fs";

// pidfd path is Linux-only; macOS/FreeBSD use EVFILT_PROC which is keyed
// on pid and auto-removed by the kernel when the process is reaped.
test.skipIf(!isLinux)(
  "subprocess pidfd exit survives nested event-loop tick dropping its ready_polls slot",
  async () => {
    // Spawn a batch of short-lived children with stdio ignored so the pidfd
    // is each one's only poll. They all exit ~together, so a single
    // epoll_wait returns most of their pidfd events in one batch.
    const N = 20;
    const exits: Array<Promise<void>> = [];
    let nested = false;

    for (let i = 0; i < N; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      exits.push(promise);
      Bun.spawn({
        cmd: ["true"],
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        onExit() {
          // First onExit to run forces a synchronous nested tick of the
          // main uws loop. Bun.sleep(1) resolves via the timer queue, which
          // only drains inside autoTick() AFTER us_loop_run_bun_tick — so
          // waitForPromise must enter autoTick → epoll_wait to resolve it.
          // That overwrites the outer dispatch's ready_polls state; any
          // sibling pidfd events queued after this one in the outer batch
          // are dropped. With EPOLLONESHOT those pidfds are now disarmed in
          // the kernel with no re-arm path.
          if (!nested) {
            nested = true;
            expect(Bun.sleep(1)).resolves.toBe(undefined);
          }
          resolve();
        },
      });
    }

    // Every child must report exit. With the EPOLLONESHOT bug, the children
    // whose events were dropped never fire onExit and this await hangs until
    // the test's own 5s timeout — there is no other wake source.
    await Promise.all(exits);
  },
);

test.skipIf(isWindows)("a nested event-loop tick dispatches the rest of the outer tick's batch", async () => {
  const [socketFd, socketPeer] = createSocketPair();
  const [streamFd, streamPeer] = createSocketPair();
  const received = Promise.withResolvers<void>();
  using _socket = await Bun.connect({ fd: socketFd, socket: { data: () => received.resolve() } });
  // The stream polls its fd one-shot, like a subprocess's stdout.
  const text = new Response(Bun.file(streamFd).stream()).text();
  await new Promise(resolve => setImmediate(resolve));
  // Both fds are ready before the next poll, the socket first.
  writeSync(socketPeer, "x");
  writeSync(streamPeer, "hi");
  closeSync(streamPeer);
  closeSync(socketPeer);
  await received.promise;
  // This runs in a microtask under the socket's poll callback, so waiting for the timer ticks the loop from inside it.
  expect(Bun.sleep(1)).resolves.toBe(undefined);
  expect(await text).toBe("hi");
});

// kqueue reports a socket's read and write filters as two events of one batch, and the loop merges them into one dispatch.
test.skipIf(isWindows)("a nested event-loop tick doesn't dispatch a socket's writable event again", async () => {
  const [fd, peerFd] = createSocketPair();
  const big = Buffer.alloc(4 * 1024 * 1024, "x");
  const scratch = Buffer.alloc(1024 * 1024);
  const received = Promise.withResolvers<void>();
  let drains = 0;
  try {
    using _socket = await Bun.connect({
      fd,
      socket: {
        open(socket) {
          // The partial write polls for writable. The peer then makes the socket readable first, writable second.
          const written = socket.write(big);
          writeSync(peerFd, "x");
          for (let read = 0; read < written;) read += readSync(peerFd, scratch);
        },
        drain(socket) {
          if (++drains > 1) return;
          // Fill the send buffer again, so the socket still polls for writable while the loop ticks from inside this handler.
          socket.write(big);
          expect(Bun.sleep(1)).resolves.toBe(undefined);
        },
        data: () => received.resolve(),
      },
    });
    await received.promise;
    expect(drains).toBe(1);
  } finally {
    closeSync(peerFd);
  }
});
