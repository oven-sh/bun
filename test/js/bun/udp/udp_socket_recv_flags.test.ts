// Coverage for the fifth parameter of Bun.udpSocket's `data` callback
// (`ReceiveFlags.truncated` from MSG_TRUNC) and for Linux's IP_RECVERR
// surfacing ICMP errors as `error` events on the socket.

import { udpSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

describe("udpSocket() receive flags", () => {
  test("data callback receives flags object with truncated=false for normal packets", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const client = await udpSocket({});
    const server = await udpSocket({
      socket: {
        data(_socket, _data, _port, _address, flags) {
          resolve(flags);
        },
        error(_socket, err) {
          reject(err);
        },
      },
    });
    function sendRec() {
      if (!client.closed) {
        client.send("hello", server.port, "127.0.0.1");
        setTimeout(sendRec, 10);
      }
    }
    sendRec();
    try {
      const flags = await promise;
      expect(flags).toEqual({ truncated: false, ipv6: false });
    } finally {
      client.close();
      server.close();
    }
  });

  // IP_RECVERR is armed on connect (Linux only). An unconnected socket never
  // sees ICMP at all; a connected one surfaces it through the error handler,
  // stays open, and can still send.
  test.skipIf(!isLinux)("connected socket surfaces ECONNREFUSED from ICMP and stays open", async () => {
    const errors: (Error & { code?: string; errqueue?: boolean })[] = [];
    const { promise: errPromise, resolve: resolveErr } = Promise.withResolvers<void>();

    // Bind and close a probe so we own a port nothing is listening on.
    const probe = await udpSocket({ hostname: "127.0.0.1" });
    const deadPort = probe.port;
    probe.close();

    const sender = await udpSocket({
      connect: { hostname: "127.0.0.1", port: deadPort },
      socket: {
        error(err: Error & { code?: string }) {
          errors.push(err);
          resolveErr();
        },
      },
    });

    try {
      let gotError = false;
      function sendDead() {
        if (!gotError && !sender.closed) {
          try {
            sender.send("dead");
          } catch {}
          setTimeout(sendDead, 10);
        }
      }
      sendDead();

      await errPromise;
      gotError = true;
      expect({ code: errors[0]?.code, errqueue: errors[0]?.errqueue, closed: sender.closed }).toEqual({
        code: "ECONNREFUSED",
        errqueue: true,
        closed: false,
      });
    } finally {
      sender.close();
    }
  });
});

// A reply-style server (DNS, statsd, echo) written to the documented shape
// has a `data` handler and no `error` handler. A reply sent to a client
// that has stopped listening triggers ICMP port-unreachable at the server;
// that must not kill the process.
test.skipIf(!isLinux)("unconnected socket with no error handler survives ICMP port unreachable", async () => {
  const src = `
    const server = await Bun.udpSocket({
      port: 0, hostname: "127.0.0.1",
      socket: { data(s, d, port, addr) { s.send(d, port, addr); } },
    });
    const probe = await Bun.udpSocket({ hostname: "127.0.0.1" });
    const deadPort = probe.port;
    probe.close();
    for (let i = 0; i < 5; i++) {
      server.send("reply", deadPort, "127.0.0.1");
      await Bun.sleep(20);
    }
    console.log(JSON.stringify({ closed: server.closed }));
    process.exit(0);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ closed: false });
  expect(exitCode).toBe(0);
});

// A 65508..65535-byte datagram is rejected synchronously with EMSGSIZE, which
// the caller catches. With IP_RECVERR on, the kernel also queues the same
// EMSGSIZE on the error queue and it was re-delivered as an async uncaught
// error. Without an error handler the process must still survive.
test.skipIf(!isLinux)(
  "oversized send caught synchronously does not also kill the process via the error queue",
  async () => {
    const src = `
    const rx = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });
    const tx = await Bun.udpSocket({ socket: { data() {} } });
    let caught = "none";
    try {
      tx.send(new Uint8Array(65510), rx.port, "127.0.0.1");
    } catch (e) { caught = e.code; }
    await Bun.sleep(100);
    console.log(JSON.stringify({ caught, txClosed: tx.closed }));
    process.exit(0);
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ caught: "EMSGSIZE", txClosed: false });
    expect(exitCode).toBe(0);
  },
);

// Belt-and-suspenders for the same contract on a connected socket: even when
// IP_RECVERR is armed and the error queue delivers, a socket with no error
// handler must not turn that into an uncaught exception.
test.skipIf(!isLinux)("connected socket with no error handler survives ICMP port unreachable", async () => {
  const src = `
    const probe = await Bun.udpSocket({ hostname: "127.0.0.1" });
    const deadPort = probe.port;
    probe.close();
    const s = await Bun.udpSocket({
      hostname: "127.0.0.1",
      connect: { hostname: "127.0.0.1", port: deadPort },
      socket: { data() {} },
    });
    for (let i = 0; i < 5; i++) { s.send("x"); await Bun.sleep(20); }
    console.log(JSON.stringify({ closed: s.closed }));
    process.exit(0);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ closed: false });
  expect(exitCode).toBe(0);
});
