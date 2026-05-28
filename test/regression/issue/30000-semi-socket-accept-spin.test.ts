/**
 * Regression test for a kqueue dispatch bug that caused 100% CPU busy-loop on
 * `accept(2)` after a long-lived TCP client socket transitioned to CLOSE_WAIT
 * (observed in the wild after a macOS sleep/wake cycle on `bun-v1.3.14`).
 *
 * Bug summary
 * -----------
 *  - `packages/bun-usockets/src/loop.c::us_internal_dispatch_ready_poll`
 *    used a single `POLL_TYPE_SEMI_SOCKET` for two roles:
 *      1. CONNECTING client sockets (poll for `LIBUS_SOCKET_WRITABLE`)
 *      2. LISTEN  server  sockets (poll for `LIBUS_SOCKET_READABLE`)
 *  - The dispatcher told them apart with
 *      `if (us_poll_events(p) == LIBUS_SOCKET_WRITABLE) { connecting } else { listen }`
 *  - If a CONNECTING socket's polled events ever drifted off pure WRITABLE
 *    (e.g. because uSockets adds a EVFILT_WRITE filter for FIN-detection when
 *    a poll is paused, or because a coalesced batch surfaced both filters),
 *    the dispatcher treated it as a LISTEN socket and called
 *    `bsd_accept_socket(client_fd, ...)` on a connected FD. `accept(2)` then
 *    failed with `EINVAL`/`ENOTSOCK`, but the kqueue level-trigger kept the
 *    read-ready event pending (FIN buffered, not drained), so every event
 *    loop tick re-fired the same accept → ~600 failing accept() syscalls per
 *    second per stuck FD. With ~30 such FDs per process, the main thread
 *    pegged near 100% CPU.
 *
 * The fix (this PR)
 * -----------------
 *  - Introduce a dedicated `POLL_TYPE_LISTEN_SOCKET` kind for listener polls,
 *    eliminating the events-based role inference entirely.
 *  - Any `POLL_TYPE_SEMI_SOCKET` ready event now unconditionally routes into
 *    `us_internal_socket_after_open` (which handles both connect-complete and
 *    connect-error cleanly).
 *
 * Test strategy
 * -------------
 * We can't easily simulate a macOS sleep/wake from a test, but we can drive
 * the same SEMI_SOCKET dispatcher branch by:
 *   1. Listening on a fresh TCP port (the server side).
 *   2. From a *separate* tick, calling `net.connect()` — this primes a
 *      `POLL_TYPE_SEMI_SOCKET` poll for the connecting client.
 *   3. Server accepts and IMMEDIATELY destroys the socket with RST,
 *      delivering EOF on the client's poll before the client side has
 *      consumed the WRITABLE-fires-on-connect event.
 *   4. We hold the test event loop open with a no-op timer for ~500ms,
 *      sampling CPU. With the bug, the loop spins. With the fix, it idles.
 *
 * @see {root}/private/research/2026-05-28/high-cpu/REPORT.md
 */
import { test, expect } from "bun:test";
import * as net from "node:net";
import { resourceUsage } from "node:process";

async function measureIdleCpu(wallMs: number) {
  const t0 = resourceUsage();
  const w0 = Date.now();
  await new Promise(r => setTimeout(r, wallMs));
  const t1 = resourceUsage();
  const wall = Date.now() - w0;
  const cpuMs = (t1.userCPUTime - t0.userCPUTime + t1.systemCPUTime - t0.systemCPUTime) / 1000;
  return { cpuMs, wall, ratio: cpuMs / wall };
}

test(
  "POLL_TYPE_SEMI_SOCKET dispatch does not spin on accept after peer RST (issue #30000)",
  async () => {
    const server = net.createServer();
    const port: number = await new Promise(res => {
      server.listen(0, "127.0.0.1", () => res((server.address() as any).port));
    });

    // The server destroys every accepted socket without sending data,
    // which on macOS delivers a TCP RST and surfaces as an early EOF on
    // the client poll.
    server.on("connection", (sock) => {
      sock.resetAndDestroy?.() ?? sock.destroy();
    });

    // Spawn 8 connects in a tight loop to maximize the chance of the
    // dispatch race triggering at least once.
    const clients = Array.from({ length: 8 }, () => {
      const c = net.connect(port, "127.0.0.1");
      // Intentionally do NOT add a 'connect' or 'error' handler that
      // would `close()` synchronously — we want the SEMI_SOCKET poll to
      // sit through at least one event-loop tick in its degenerate
      // state. Bun's default unhandled-error behavior will close the
      // socket on the next microtask, but the poll has already cycled
      // by then.
      c.on("error", () => {});
      return c;
    });

    // Idle for 500ms — long enough that a stuck accept loop would
    // consume hundreds of CPU-ms.
    const cpu = await measureIdleCpu(500);

    // Cleanup
    for (const c of clients) c.destroy();
    await new Promise<void>(r => server.close(() => r()));

    // With the bug: ratio approaches 1.0 (one core pegged).
    // With the fix: ratio stays well below 0.25 (test runner +
    // GC + macOS background noise — still idle for our purposes).
    expect(cpu.ratio).toBeLessThan(0.25);
  },
  /* timeout */ 10_000,
);
