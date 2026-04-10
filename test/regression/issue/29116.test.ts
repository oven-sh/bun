// Regression test for https://github.com/oven-sh/bun/issues/29116
//
// `node:dgram` emits an `ECONNREFUSED ... recv` error and crashes the process
// when sending a UDP datagram to a closed port on Linux, starting in Bun
// 1.3.12 (#28827). Node.js and Bun ≤ 1.3.11 do not fire `'error'` in this
// case because libuv does not enable `IP_RECVERR` by default — the Linux
// kernel silently drops ICMP port-unreachable on unconnected sockets.
//
// Regression exercise is Linux-only — `IP_RECVERR` only exists on Linux.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

async function runScript(source: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(!isLinux)(
  "#29116 unconnected dgram socket does not emit 'error' when sending to a closed port",
  async () => {
    // The exact repro from the issue. Before the fix, this printed 'done'
    // and then crashed with `ECONNREFUSED: connection refused, recv`.
    const { stdout, stderr, exitCode } = await runScript(`
      import { createSocket } from "node:dgram";

      // Allocate a dead port by binding and immediately closing a temp
      // socket. The OS is very unlikely to hand the same port back to
      // another process in the few hundred ms before our send.
      const tmp = createSocket("udp4");
      await new Promise(resolve => tmp.bind(0, "127.0.0.1", resolve));
      const deadPort = tmp.address().port;
      await new Promise(resolve => tmp.close(resolve));

      const socket = createSocket("udp4");
      await new Promise(resolve => socket.bind(0, "127.0.0.1", resolve));
      socket.send(Buffer.from("x"), deadPort, "127.0.0.1");

      // Give the kernel time to deliver ICMP port-unreachable back to us.
      // 250ms matches the user's repro and is well above loopback RTT.
      await Bun.sleep(250);
      await new Promise(resolve => socket.close(resolve));
      console.log("done");
    `);

    expect(stderr).not.toContain("ECONNREFUSED");
    expect(stdout.trim()).toBe("done");
    expect(exitCode).toBe(0);
  },
);

test.skipIf(!isLinux)("#29116 connect() after an unconnected send to a dead port does not leak an error", async () => {
  // TOCTOU exercise. The WebRTC / ICE pattern is:
  //   bind → send(deadCandidate1) → send(deadCandidate2) → ... → connect(winner)
  // The unconnected sends queue ICMP port-unreachable in the socket's
  // error queue; when `connect()` completes, `state.connectState` is
  // CONNECT_STATE_CONNECTED. If the suppression filter checks connect
  // state at delivery time, the queued ICMP from step 2 will slip
  // through once the error queue is drained after the socket becomes
  // connected — crashing the process.
  const { stdout, stderr, exitCode } = await runScript(`
      import { createSocket } from "node:dgram";

      const tmp = createSocket("udp4");
      await new Promise(resolve => tmp.bind(0, "127.0.0.1", resolve));
      const deadPort = tmp.address().port;
      await new Promise(resolve => tmp.close(resolve));

      const socket = createSocket("udp4");
      await new Promise(resolve => socket.bind(0, "127.0.0.1", resolve));
      // Send a handful of probes to the dead port to queue multiple ICMP
      // errors, then immediately connect() to raise the chance that the
      // connect transition races the error-queue drain.
      for (let i = 0; i < 8; i++) socket.send(Buffer.from("x"), deadPort, "127.0.0.1");
      await new Promise(resolve => socket.connect(deadPort, "127.0.0.1", resolve));

      await Bun.sleep(250);
      await new Promise(resolve => socket.close(resolve));
      console.log("done");
    `);

  expect(stderr).not.toContain("ECONNREFUSED");
  expect(stdout.trim()).toBe("done");
  expect(exitCode).toBe(0);
});
