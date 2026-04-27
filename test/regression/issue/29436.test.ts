// https://github.com/oven-sh/bun/issues/29436
//
// Sending a UDP datagram to a port with no listener on Linux generates an
// ICMP "port unreachable". With IP_RECVERR enabled the kernel queues this on
// the socket's error queue and raises EPOLLERR. The error queue must be read
// with recvmsg(MSG_ERRQUEUE) — plain recvmsg reports the pending error once
// but does not dequeue it, so EPOLLERR stays level-triggered and epoll_wait
// busy-loops at 100% CPU forever.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// Port 1 (tcpmux) is privileged (< 1024) so the kernel never auto-assigns it
// and no userspace process binds it in CI — guarantees ICMP port-unreachable
// without a bind→close→send TOCTOU race on an ephemeral port.
const deadPort = 1;

// Each test spawns a subprocess that sleeps up to ~3s; debug/ASAN builds add
// several seconds of startup, so budget well above the 5s default.
const timeout = 20_000;

async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  // The error handler should fire exactly once per ICMP error, not zero
  // (event swallowed) and not unbounded (re-fired every loop tick).
  expect(result.errorCount).toBe(1);
  expect(result.errorCode).toBe("ECONNREFUSED");
  // The socket must remain open and usable after a transient ICMP error —
  // a "fix" that closes it on error would also stop the busy-loop.
  expect(result.closed).toBe(false);
  // The buggy build burns ~100% CPU (cpuMs ≈ wallMs). A fixed build idles;
  // even under debug/ASAN it stays well below 75% of wall time.
  expect(result.cpuMs).toBeLessThan(result.wallMs * 0.75);
  expect(exitCode).toBe(0);
}

// IP_RECVERR is Linux-only; on other platforms the send either silently
// succeeds (no ICMP surfaced on unconnected sockets) or errors synchronously.
test.skipIf(!isLinux)(
  "Bun.udpSocket: ICMP error does not busy-loop the event loop",
  () =>
    run(/* js */ `
    let errorCount = 0;
    let errorCode;
    const { promise: gotError, resolve } = Promise.withResolvers();
    const socket = await Bun.udpSocket({
      socket: {
        error(err) {
          errorCount++;
          errorCode ??= err?.code;
          resolve();
        },
      },
    });
    socket.send("x", ${deadPort}, "127.0.0.1");
    await Promise.race([gotError, Bun.sleep(2000)]);

    // Measure CPU time consumed while the process should be idle. With the
    // bug, the event loop spins and CPU time ~= wall time.
    const wallMs = 1000;
    const before = process.cpuUsage();
    await Bun.sleep(wallMs);
    const after = process.cpuUsage(before);
    const cpuMs = (after.user + after.system) / 1000;

    const closed = socket.closed;
    socket.close();
    console.log(JSON.stringify({ errorCount, errorCode, closed, cpuMs, wallMs }));
  `),
  timeout,
);

// Connected UDP: the kernel's udp_err() sets sk->sk_err AND enqueues to the
// error queue. Draining the error queue via MSG_ERRQUEUE clears sk_err (in
// sock_dequeue_err_skb) for the last ICMP entry; a follow-up SO_ERROR read
// consumes any residual sk_err so EPOLLERR deasserts.
test.skipIf(!isLinux)(
  "Bun.udpSocket (connected): ICMP error does not busy-loop the event loop",
  () =>
    run(/* js */ `
    let errorCount = 0;
    let errorCode;
    const { promise: gotError, resolve } = Promise.withResolvers();

    const socket = await Bun.udpSocket({
      connect: { hostname: "127.0.0.1", port: ${deadPort} },
      socket: {
        error(err) {
          errorCount++;
          errorCode ??= err?.code;
          resolve();
        },
      },
    });
    socket.send("x");
    await Promise.race([gotError, Bun.sleep(2000)]);

    const wallMs = 1000;
    const before = process.cpuUsage();
    await Bun.sleep(wallMs);
    const after = process.cpuUsage(before);
    const cpuMs = (after.user + after.system) / 1000;

    const closed = socket.closed;
    socket.close();
    console.log(JSON.stringify({ errorCount, errorCode, closed, cpuMs, wallMs }));
  `),
  timeout,
);

test.skipIf(!isLinux)(
  "node:dgram: ICMP error does not busy-loop the event loop",
  () =>
    run(/* js */ `
    const dgram = require("node:dgram");
    let errorCount = 0;
    let errorCode;
    const { promise: gotError, resolve } = Promise.withResolvers();
    const sock = dgram.createSocket("udp4");
    sock.on("error", err => {
      errorCount++;
      errorCode ??= err?.code;
      resolve();
    });
    sock.send("x", ${deadPort}, "127.0.0.1");
    await Promise.race([gotError, Bun.sleep(2000)]);

    const wallMs = 1000;
    const before = process.cpuUsage();
    await Bun.sleep(wallMs);
    const after = process.cpuUsage(before);
    const cpuMs = (after.user + after.system) / 1000;

    // Still bound and usable — address() throws ERR_SOCKET_DGRAM_NOT_RUNNING
    // if the socket was torn down.
    let closed;
    try { sock.address(); closed = false; } catch { closed = true; }
    sock.close();
    console.log(JSON.stringify({ errorCount, errorCode, closed, cpuMs, wallMs }));
  `),
  timeout,
);
