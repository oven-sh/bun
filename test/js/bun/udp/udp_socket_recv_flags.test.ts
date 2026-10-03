// Coverage for the fifth parameter of Bun.udpSocket's `data` callback
// (`ReceiveFlags.truncated` from MSG_TRUNC) and for Linux's IP_RECVERR
// surfacing ICMP errors as `error` events on the socket.

import { udpSocket } from "bun";
import { dlopen } from "bun:ffi";
import { getEventLoopStats } from "bun:internal-for-testing";
import { afterAll, describe, expect, test } from "bun:test";
import { isLinux, libcPathForDlopen } from "harness";
import dgram from "node:dgram";

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

  // IP_RECVERR is Linux-specific. On BSDs and Windows, ICMP errors on
  // unconnected UDP sockets either propagate by default or are delivered
  // through different channels that we don't currently surface.
  test.skipIf(!isLinux)(
    "surfaces ECONNREFUSED from ICMP port unreachable (IP_RECVERR) and keeps the socket usable",
    async () => {
      const { promise: errPromise, resolve: resolveErr } = Promise.withResolvers<Error & { code?: string }>();
      const { promise: msgPromise, resolve: resolveMsg } = Promise.withResolvers<string>();

      const receiver = await udpSocket({
        socket: {
          data(_socket, data) {
            resolveMsg(data.toString());
          },
        },
      });

      const sender = await udpSocket({
        socket: {
          error(err: Error & { code?: string }) {
            resolveErr(err);
          },
        },
      });

      // Send to a closed port on localhost. The kernel replies with ICMP
      // port unreachable; with IP_RECVERR the next recv surfaces ECONNREFUSED.
      let gotError = false;
      function sendDead() {
        if (!gotError && !sender.closed) {
          sender.send("dead", 1, "127.0.0.1");
          setTimeout(sendDead, 10);
        }
      }
      sendDead();

      try {
        const err = await errPromise;
        gotError = true;
        expect(err?.code).toBe("ECONNREFUSED");
        // The sender socket must remain usable after an ICMP error.
        expect(sender.closed).toBe(false);

        function sendAlive() {
          if (!sender.closed && !receiver.closed) {
            sender.send("alive", receiver.port, "127.0.0.1");
            setTimeout(sendAlive, 10);
          }
        }
        sendAlive();
        expect(await msgPromise).toBe("alive");
      } finally {
        sender.close();
        receiver.close();
      }
    },
  );
});

// With IP_RECVERR the kernel queues one "report" for each ICMP error of a
// socket. The sockets under test are connected to a port where no socket takes
// their datagrams, so every datagram that reaches the wire comes back as a
// report.
const LIBUS_LISTEN_REUSE_PORT = 4;

// Where the socket under test binds, where it connects to, and the address of
// the host behind that.
type Route = { name: string; bind: string; connect: string; host: string };
const ipv4: Route = { name: "IPv4", bind: "127.0.0.1", connect: "127.0.0.1", host: "127.0.0.1" };
const ipv6: Route = { name: "IPv6", bind: "::1", connect: "::1", host: "::1" };
// Its reports come from ICMP, and the kernel hands them over in the IPv6 form
// (IPV6_RECVERR), as it does for every report of an IPv6 socket.
const ipv4Mapped: Route = {
  name: "IPv4 from an IPv6 socket",
  bind: "::",
  connect: "::ffff:127.0.0.1",
  host: "127.0.0.1",
};

// harness's isIPv6() is hardcoded false on BuildKite Linux. A route needs only
// that its address can be bound.
const unusable = new Set<Route>();
for (const route of [ipv6, ipv4Mapped]) {
  const bound = isLinux && (await udpSocket({ hostname: route.bind }).catch(() => undefined));
  if (bound) bound.close();
  else unusable.add(route);
}

// Keeps a port of `host` reserved: bound to it, and connected to a port that
// nothing sends from. The datagrams of another socket never match it, so the
// kernel still answers them with "port unreachable".
function reservePort(host: string) {
  return udpSocket({
    hostname: host,
    flags: LIBUS_LISTEN_REUSE_PORT,
    connect: { hostname: host, port: 1 },
    socket: { data() {}, error() {} },
  });
}

// A socket on the reserved port that is not connected: what it sends arrives
// at a socket that is connected to the port. While it is open it also takes
// the datagrams sent to the port, so the tests close it before they send there.
function openPeer(host: string, port: number) {
  return udpSocket({ hostname: host, port, flags: LIBUS_LISTEN_REUSE_PORT, socket: { data() {}, error() {} } });
}

const nextLoopIteration = () => new Promise<void>(resolve => setImmediate(resolve));

async function iterateUntil(done: () => boolean) {
  while (!done()) await nextLoopIteration();
}

// Bun.udpSocket passes the error to `error` as the last argument. What comes
// before it is the subject of https://github.com/oven-sh/bun/issues/44274.
const lastArgument =
  (handle: (err: any) => void) =>
  (...args: unknown[]) =>
    handle(args.at(-1));

// What an error handler received, by the iteration of the event loop.
function errorLog() {
  const errors: Record<string, number> = {};
  const perIteration = new Map<number, number>();
  let total = 0;
  let withoutErrqueue = 0;
  return {
    add(err: any) {
      total++;
      if (err.errqueue !== true) withoutErrqueue++;
      errors[err.code] = (errors[err.code] ?? 0) + 1;
      const { iteration } = getEventLoopStats();
      perIteration.set(iteration, (perIteration.get(iteration) ?? 0) + 1);
    },
    get total() {
      return total;
    },
    get errors() {
      return errors;
    },
    // The errors that are not a report: the pending error of the socket.
    get withoutErrqueue() {
      return withoutErrqueue;
    },
    get mostInOneIteration() {
      return Math.max(0, ...perIteration.values());
    },
  };
}

let libcHandle: ReturnType<typeof openLibc> | undefined;
const openLibc = () =>
  dlopen(libcPathForDlopen(), {
    poll: { args: ["ptr", "u64", "int"], returns: "int" },
    setsockopt: { args: ["int", "int", "int", "ptr", "u32"], returns: "int" },
    getsockopt: { args: ["int", "int", "int", "ptr", "ptr"], returns: "int" },
  });
const libc = () => (libcHandle ??= openLibc()).symbols;
afterAll(() => libcHandle?.close());

// Whether the kernel holds an error for the socket: its pending error, or a
// report on its error queue. For as long as it does, EPOLLERR wakes the loop.
function errorIsPending(fd: number) {
  const POLLERR = 8;
  const pollfd = new Int32Array([fd, 0]); // struct pollfd { int fd; short events, revents; }
  if (libc().poll(pollfd, 1, 0) < 0) throw new Error("poll() failed");
  return (new Int16Array(pollfd.buffer)[3] & POLLERR) !== 0;
}

// Whether a send fails with the pending error of the socket.
function refused(send: () => unknown) {
  try {
    send();
    return false;
  } catch (err: any) {
    if (err.code !== "ECONNREFUSED") throw err;
    return true;
  }
}

// Sends `count` datagrams that reach the wire. The ICMP error of a datagram
// sets the pending error of the socket, and the next send fails with it and
// clears it. So every datagram is followed by one send that has to fail.
// Returns how many sends went another way: then the kernel delivered an ICMP
// error late (its softirq was deferred) and the test cannot count on what is
// queued. `afterEach` returns the same count for the sends that it makes.
function refusedSends(socket: { send(data: string): unknown }, count: number, afterEach?: () => number) {
  let late = 0;
  for (let i = 0; i < count; i++) {
    // The late ICMP error of an earlier datagram fails this send.
    if (refused(() => socket.send("refused"))) late++;
    if (!refused(() => socket.send("refused"))) late++;
    late += afterEach?.() ?? 0;
  }
  return late;
}

// Sets a scenario up again when the kernel delivered an ICMP error late. The
// last run is the result when none is usable, for the test to fail on.
async function firstUsable<T extends { late: number }>(scenario: () => Promise<T>) {
  for (let attempt = 1; ; attempt++) {
    const run = await scenario();
    if (run.late === 0 || attempt === 5) return run;
  }
}

// `reportsPerRound` reports and `datagramsPerRound` datagrams are queued for
// each loop iteration. With `otherErrno` every refused datagram is followed by
// one that is too large to send: the kernel queues an EMSGSIZE report for it.
async function reportsAndDatagrams(
  route: Route,
  rounds: number,
  reportsPerRound: number,
  datagramsPerRound: number,
  otherErrno: boolean,
) {
  using holder = await reservePort(route.host);
  const log = errorLog();
  let datagrams = 0;
  let markerArrived = false;
  using socket = await udpSocket({
    hostname: route.bind,
    connect: { hostname: route.connect, port: holder.port },
    socket: {
      error: lastArgument(err => log.add(err)),
      data(_socket, data) {
        if (data.length === 1) markerArrived = true;
        else datagrams++;
      },
    },
  });
  const payload = Buffer.alloc(1024, "d");
  const tooLarge = Buffer.alloc(65535);
  const sendTooLarge = () => {
    try {
      socket.send(tooLarge);
    } catch (err: any) {
      if (err.code === "EMSGSIZE") return 0;
      // A late ICMP error failed the send first.
      if (err.code === "ECONNREFUSED") return 1;
      throw err;
    }
    throw new Error("the kernel accepted a datagram of 65535 bytes");
  };
  let late = 0;
  for (let round = 0; round < rounds; round++) {
    // The reports first: the kernel charges them to the receive buffer, so
    // reports that stay queued leave no room for the datagrams.
    late += refusedSends(socket, reportsPerRound, otherErrno ? sendTooLarge : undefined);
    using peer = await openPeer(route.host, holder.port);
    for (let i = 0; i < datagramsPerRound; i++) peer.send(payload, socket.port, route.host);
    await nextLoopIteration();
  }
  // Everything that was queued before the marker is handled before it.
  using peer = await openPeer(route.host, holder.port);
  await iterateUntil(() => {
    if (!markerArrived) peer.send("m", socket.port, route.host);
    return markerArrived;
  });
  return { datagrams, errors: log.errors, withoutErrqueue: log.withoutErrqueue, late };
}

// Not concurrent: the tests share the event loop of this process, and what one
// of them does in an iteration is time in the iterations of the others.
describe.skipIf(!isLinux)("error queue (IP_RECVERR)", () => {
  // https://github.com/oven-sh/bun/issues/44218: the loop took the report of
  // the datagram that a handler sent in the same event, so the event never
  // ended while the handler sent again.
  const chains: [kind: string, route: Route][] = [
    ["Bun.udpSocket send()", ipv4],
    ["Bun.udpSocket send()", ipv6],
    ["Bun.udpSocket sendMany()", ipv4],
    ["node:dgram send()", ipv4],
    ["node:dgram send()", ipv6],
    ["node:dgram send() from process.nextTick", ipv4],
  ];
  for (const [kind, route] of chains) {
    const title = `an error handler that sends again gets the next report in the next loop iteration: ${kind}, ${route.name}`;
    test.skipIf(unusable.has(route))(title, async () => {
      using holder = await reservePort(route.host);
      const port = holder.port;
      const log = errorLog();
      let immediateRan = false;
      let immediateRanDuringChain: boolean | undefined;
      let sendFailure: unknown;
      let sendAgain = () => {};
      const onError = (err: any) => {
        log.add(err);
        if (log.total === 1) setImmediate(() => (immediateRan = true));
        if (log.total === 100) {
          // A loop that has not left the first event has not run the immediate.
          immediateRanDuringChain = immediateRan;
          return;
        }
        try {
          sendAgain();
        } catch (err) {
          sendFailure = err;
        }
      };

      const viaDgram = kind.startsWith("node:dgram");
      let close = () => {};
      try {
        if (viaDgram) {
          const socket = dgram.createSocket(route === ipv6 ? "udp6" : "udp4");
          close = () => socket.close();
          socket.on("error", onError);
          const send = () => socket.send("retry");
          sendAgain = kind.endsWith("process.nextTick") ? () => process.nextTick(send) : send;
          socket.connect(port, route.connect, send);
        } else {
          const socket = await udpSocket({
            hostname: route.bind,
            connect: { hostname: route.connect, port },
            socket: { error: lastArgument(onError) },
          });
          close = () => socket.close();
          sendAgain = kind.endsWith("sendMany()") ? () => socket.sendMany(["retry"]) : () => socket.send("retry");
          sendAgain();
        }

        await iterateUntil(() => log.total >= 100 || sendFailure !== undefined);
        if (sendFailure) throw sendFailure;
        const counted = {
          errors: log.errors,
          mostInOneIteration: log.mostInOneIteration,
          immediateRanDuringChain,
        };
        const expected = { errors: { ECONNREFUSED: 100 }, mostInOneIteration: 1, immediateRanDuringChain: true };
        if (viaDgram) {
          // node has no IP_RECVERR: there the same errors are the pending
          // error of the socket. So node:dgram does not promise reports.
          expect(counted).toEqual(expected);
        } else {
          expect({ ...counted, withoutErrqueue: log.withoutErrqueue }).toEqual({ ...expected, withoutErrqueue: 0 });
        }
      } finally {
        close();
      }
    });
  }

  test("reports that wait in the kernel do not cost inbound datagrams", async () => {
    // 64 reports and 16 datagrams for each of 8 loop iterations. A queued
    // report takes room in the receive buffer: the default buffer holds about
    // 220 of them, then the kernel drops what arrives. A loop that leaves
    // reports in the kernel loses datagrams here.
    expect(await firstUsable(() => reportsAndDatagrams(ipv4, 8, 64, 16, false))).toEqual({
      datagrams: 128,
      errors: { ECONNREFUSED: 512 },
      withoutErrqueue: 0,
      late: 0,
    });
  });

  // A report whose errno the loop does not find counts as ECONNREFUSED, so
  // only another errno shows that the loop reads it.
  for (const route of [ipv4, ipv6, ipv4Mapped]) {
    test.skipIf(unusable.has(route))(`every report arrives with its own errno: ${route.name}`, async () => {
      expect(await firstUsable(() => reportsAndDatagrams(route, 3, 16, 8, true))).toEqual({
        datagrams: 24,
        errors: { ECONNREFUSED: 48, EMSGSIZE: 48 },
        withoutErrqueue: 0,
        late: 0,
      });
    });
  }

  test("no error handler runs after one of them closed the socket", async () => {
    const scenario = async () => {
      using holder = await reservePort(ipv4.host);
      const log = errorLog();
      using socket = await udpSocket({
        hostname: ipv4.bind,
        connect: { hostname: ipv4.connect, port: holder.port },
        socket: {
          error: lastArgument(err => {
            log.add(err);
            if (log.total === 3) socket.close();
          }),
        },
      });
      const late = refusedSends(socket, 10);
      await iterateUntil(() => socket.closed);
      await nextLoopIteration();
      return { errors: log.errors, closed: socket.closed, late };
    };
    expect(await firstUsable(scenario)).toEqual({ errors: { ECONNREFUSED: 3 }, closed: true, late: 0 });
  });

  // https://github.com/oven-sh/bun/issues/29436: a report that stays on the
  // error queue keeps EPOLLERR raised, and the loop never sleeps again.
  test("no error stays with the socket after the event that reported it", async () => {
    const scenario = async () => {
      using holder = await reservePort(ipv4.host);
      const log = errorLog();
      using socket = await udpSocket({
        hostname: ipv4.bind,
        connect: { hostname: ipv4.connect, port: holder.port },
        socket: { error: lastArgument(err => log.add(err)) },
      });
      const late = refusedSends(socket, 3);
      const pendingBefore = errorIsPending(socket.fd);
      await iterateUntil(() => log.total >= 3);
      return { errors: log.errors, pendingBefore, pendingAfter: errorIsPending(socket.fd), late };
    };
    expect(await firstUsable(scenario)).toEqual({
      errors: { ECONNREFUSED: 3 },
      pendingBefore: true,
      pendingAfter: false,
      late: 0,
    });
  });

  test("an ICMP error that the kernel had no room to queue is reported once", async () => {
    const SOL_SOCKET = 1;
    const SO_RCVBUF = 8;
    const scenario = async () => {
      using holder = await reservePort(ipv4.host);
      const log = errorLog();
      let datagrams = 0;
      let late = 0;
      let sendFailure: unknown;
      using socket = await udpSocket({
        hostname: ipv4.bind,
        connect: { hostname: ipv4.connect, port: holder.port },
        socket: {
          error: lastArgument(err => {
            log.add(err);
            if (log.total !== 32) return;
            // The last queued report. The datagram below is still unread and
            // fills the receive buffer, so the kernel cannot queue the report
            // of this send: its errno is only the pending error of the socket.
            try {
              if (refused(() => socket.send("no room")) || !errorIsPending(socket.fd)) late++;
            } catch (err) {
              sendFailure = err;
            }
          }),
          data() {
            datagrams++;
          },
        },
      });
      late += refusedSends(socket, 32);

      {
        using peer = await openPeer(ipv4.host, holder.port);
        peer.send(Buffer.alloc(4000, "d"), socket.port, ipv4.host);
      }
      // The smallest receive buffer: the one datagram is more than it holds.
      const size = new Int32Array([1]);
      const sizeLength = new Uint32Array([size.byteLength]);
      expect(libc().setsockopt(socket.fd, SOL_SOCKET, SO_RCVBUF, size, size.byteLength)).toBe(0);
      expect(libc().getsockopt(socket.fd, SOL_SOCKET, SO_RCVBUF, size, sizeLength)).toBe(0);
      expect(size[0]).toBeLessThan(4000);

      // The errno is reported before the datagram that held its place.
      await iterateUntil(() => datagrams === 1 || sendFailure !== undefined);
      if (sendFailure) throw sendFailure;
      return { errors: log.errors, withoutErrqueue: log.withoutErrqueue, datagrams, late };
    };
    expect(await firstUsable(scenario)).toEqual({
      errors: { ECONNREFUSED: 33 },
      withoutErrqueue: 1,
      datagrams: 1,
      late: 0,
    });
  });

  // The datagram of a handler leaves its ICMP error as the pending error of
  // the socket, and a receive fails with a pending error. The two tests below
  // hold on the loop that took the report of that datagram in the same event:
  // the kernel clears the pending error when the last report leaves the queue.
  test("a datagram that waits behind a report is delivered in the event of the report", async () => {
    const scenario = async () => {
      using holder = await reservePort(ipv4.host);
      const log = errorLog();
      let late = 0;
      let firstError: number | undefined;
      let datagram: number | undefined;
      using socket = await udpSocket({
        hostname: ipv4.bind,
        connect: { hostname: ipv4.connect, port: holder.port },
        socket: {
          error: lastArgument(err => {
            log.add(err);
            if (log.total !== 1) return;
            firstError = getEventLoopStats().iteration;
            if (refused(() => socket.send("retry")) || !errorIsPending(socket.fd)) late++;
          }),
          data() {
            datagram = getEventLoopStats().iteration;
          },
        },
      });
      {
        using peer = await openPeer(ipv4.host, holder.port);
        peer.send("datagram", socket.port, ipv4.host);
      }
      late += refusedSends(socket, 1);
      await iterateUntil(() => datagram !== undefined && log.total >= 2);
      await nextLoopIteration();
      return {
        errors: log.errors,
        withoutErrqueue: log.withoutErrqueue,
        iterationsFromFirstErrorToDatagram: datagram! - firstError!,
        late,
      };
    };
    expect(await firstUsable(scenario)).toEqual({
      errors: { ECONNREFUSED: 2 },
      withoutErrqueue: 0,
      iterationsFromFirstErrorToDatagram: 0,
      late: 0,
    });
  });

  // A send that no event separates from a refused datagram still fails with
  // the pending error: refusedSends() counts on it.
  test("a send after the event does not fail with the error of the datagram that a handler sent", async () => {
    const scenario = async () => {
      using holder = await reservePort(ipv4.host);
      let errors = 0;
      let late = 0;
      let sendAfterEvent: string | undefined;
      using socket = await udpSocket({
        hostname: ipv4.bind,
        connect: { hostname: ipv4.connect, port: holder.port },
        socket: {
          error() {
            if (++errors > 1) return;
            if (refused(() => socket.send("retry")) || !errorIsPending(socket.fd)) late++;
            // Runs before the loop polls the socket again.
            setImmediate(() => {
              try {
                socket.send("after the event");
                sendAfterEvent = "sent";
              } catch (err: any) {
                sendAfterEvent = err.code;
              }
            });
          },
        },
      });
      late += refusedSends(socket, 1);
      await iterateUntil(() => sendAfterEvent !== undefined);
      return { sendAfterEvent, late };
    };
    expect(await firstUsable(scenario)).toEqual({ sendAfterEvent: "sent", late: 0 });
  });
});
