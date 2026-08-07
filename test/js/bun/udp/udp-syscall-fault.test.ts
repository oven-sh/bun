import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import dgram from "node:dgram";
import { once } from "node:events";

// Every Bun.udpSocket / node:dgram send reaches the kernel through
// bsd_sendmmsg, which the "sendmsg" fault hook intercepts. Windows maps
// WSAENOBUFS the same way but its errno plumbing differs; land POSIX coverage
// first, like net-syscall-fault.test.ts.
const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

describe.skipIf(skip)("udp send under injected syscall faults", () => {
  // libuv classifies ENOBUFS/ENOMEM from a UDP send as EAGAIN (transient
  // kernel resource exhaustion; macOS returns ENOBUFS when bursty sends fill
  // the interface queue) and retries on the next writable event. send() must
  // report backpressure (false) and arm the drain callback, not throw.
  test.each(["ENOBUFS", "ENOMEM"] as const)("udpSocket.send → %s is backpressure, not an error", async errno => {
    const received = Promise.withResolvers<string>();
    const server = await Bun.udpSocket({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        data(_sock, buf) {
          received.resolve(buf.toString());
        },
      },
    });
    let drained = Promise.withResolvers<void>();
    const client = await Bun.udpSocket({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        data() {},
        drain() {
          drained.resolve();
        },
      },
    });

    // The poll starts out writable, so one creation-time drain may already
    // have fired; only a drain after the failed send may resolve this.
    drained = Promise.withResolvers();
    fault.set({ syscall: "sendmsg", action: "errno", errno, repeat: 1 });
    expect(client.send("hello", server.port, "127.0.0.1")).toBe(false);

    // The failed send must re-arm writable; without it this never resolves.
    await drained.promise;
    expect(client.send("hello", server.port, "127.0.0.1")).toBe(true);
    expect(await received.promise).toBe("hello");

    client.close();
    server.close();
  });

  test("udpSocket.send still throws on a hard errno (EINVAL)", async () => {
    const server = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });
    const client = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });

    fault.set({ syscall: "sendmsg", action: "errno", errno: "EINVAL", repeat: 1 });
    let thrown: any;
    try {
      client.send("x", server.port, "127.0.0.1");
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe("EINVAL");

    client.close();
    server.close();
  });

  // node:dgram queues a backpressured send and retries it from the drain
  // handler, so a transient ENOBUFS must complete the callback with no error
  // once the kernel recovers (three consecutive failures here: the initial
  // try plus two drain retries).
  test("dgram send callback succeeds after transient ENOBUFS", async () => {
    const server = dgram.createSocket("udp4");
    const messageP = once(server, "message");
    server.bind(0, "127.0.0.1");
    await once(server, "listening");
    const client = dgram.createSocket("udp4");

    fault.set({ syscall: "sendmsg", action: "errno", errno: "ENOBUFS", repeat: 3 });
    const cbErr = Promise.withResolvers<Error | null>();
    client.send("ping", server.address().port, "127.0.0.1", err => cbErr.resolve(err ?? null));

    expect(await cbErr.promise).toBeNull();
    const [msg] = await messageP;
    expect(msg.toString()).toBe("ping");

    client.close();
    server.close();
  });

  // More packets than one 16 KiB sendbuf batch holds (~200 on Linux), so
  // us_udp_socket_send issues several sendmmsg calls and the second one fails
  // with ENOBUFS. The partial count must come back without an error and with
  // writable re-armed, so the caller can send the tail from drain.
  test("sendMany resumes after ENOBUFS at a batch boundary", async () => {
    const server = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });
    let drained = Promise.withResolvers<void>();
    const client = await Bun.udpSocket({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        data() {},
        drain() {
          drained.resolve();
        },
      },
    });

    const N = 1000;
    const parts: (string | number)[] = [];
    for (let i = 0; i < N; i++) {
      parts.push("x", server.port, "127.0.0.1");
    }

    drained = Promise.withResolvers();
    fault.set({ syscall: "sendmsg", action: "errno", errno: "ENOBUFS", after: 1, repeat: 1 });
    const first = client.sendMany(parts);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(N);

    let total = first;
    while (total < N) {
      await drained.promise;
      drained = Promise.withResolvers();
      total += client.sendMany(parts.slice(total * 3));
    }
    expect(total).toBe(N);

    client.close();
    server.close();
  });
});
