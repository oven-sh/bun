// https://github.com/oven-sh/bun/issues/29116
// `node:dgram` emitted `ECONNREFUSED ... recv` and crashed the process when
// sending a UDP datagram to a closed port on Linux after #28827 enabled
// IP_RECVERR unconditionally. Linux-only: IP_RECVERR only exists on Linux.
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

// (Over-suppression on connected sockets is guarded by the explicit
// allowlist in isSuppressibleRecvError: each errno is listed by name
// alongside its ICMP/ICMPv6 kernel source, so a regression would be
// visible in review. An async-ICMP positive-control subprocess test
// was tried here but proved too sensitive to kernel scheduling and
// ASAN-subprocess exit timing on aarch64 CI to stay deterministic.)
