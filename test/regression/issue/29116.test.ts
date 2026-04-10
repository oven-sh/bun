// Regression test for https://github.com/oven-sh/bun/issues/29116
//
// `node:dgram` emits an `ECONNREFUSED ... recv` error and crashes the process
// when sending a UDP datagram to a closed port on Linux, starting in Bun
// 1.3.12 (#28827). Node.js (and Bun ≤ 1.3.11) do not fire `'error'` in this
// case: libuv/Bun don't enable `IP_RECVERR` on unconnected sockets, so the
// Linux kernel silently drops ICMP port-unreachable errors there.
//
// The regression exercise is Linux-only — `IP_RECVERR` only exists on Linux.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

test.skipIf(!isLinux)(
  "#29116 unconnected dgram socket does not emit 'error' when sending to a closed port",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
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
          // 250ms matches the user repro and is well above loopback RTT.
          await Bun.sleep(250);
          await new Promise(resolve => socket.close(resolve));
          console.log("done");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Script must print 'done' and exit cleanly. Prior to the fix, Bun
    // 1.3.12 crashed after printing 'done' with:
    //   error: ECONNREFUSED: connection refused, recv
    expect(stderr).not.toContain("ECONNREFUSED");
    expect(stdout.trim()).toBe("done");
    expect(exitCode).toBe(0);
  },
);
