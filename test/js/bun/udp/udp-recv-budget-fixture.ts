// One readable event of a UDP socket hands over at most 32 datagrams. What is
// left in the kernel queue arrives with the next iteration of the event loop.
// Each scenario queues a backlog, counts the datagrams of every iteration, and
// prints one line of JSON.
//
// Spawned by udp_socket.test.ts and dgram.test.ts with the scenario name.
import { createSocket, type Socket } from "node:dgram";
import { firstUsable, iterateUntil, iterationCounter } from "../../../_util/loop-iterations";

const HOST = "127.0.0.1";
const quiet = { data() {}, error() {} };

// One sendmmsg. Over loopback on Linux the burst is in the receive queue when
// the call returns.
function queue(sender: Bun.udp.Socket<"buffer">, port: number, count: number) {
  const packets: (string | number)[] = [];
  for (let i = 0; i < count; i++) packets.push("x", port, HOST);
  const sent = sender.sendMany(packets);
  if (sent !== count) throw new Error(`sendMany accepted ${sent} of ${count}`);
}

function bound(socket: Socket) {
  return new Promise<number>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, HOST, () => {
      socket.off("error", reject);
      resolve(socket.address().port);
    });
  });
}

type Run = { finished: boolean; total: number; max: number; perIteration: number[] };

// A backlog of `count` on one socket. The run is usable when all of it arrived
// and one iteration had the whole bound to read.
const reachedTheBound = (count: number) => (run: Run) => run.finished && run.total === count && run.max >= 32;

// Linux. The poll reports EPOLLERR for a pending ICMP error, and a send from an
// earlier callback of the same iteration takes that error before the socket's
// own event runs. The error queue is empty and recvmmsg returns only data, so
// the event ends on its bound with no answer about the error. The socket has
// to stay open and deliver the rest.
//
// "adopted": a descriptor bun did not create has no IP_RECVERR, so the kernel
// never queues a report. "full-buffer": a socket bun created, whose receive
// buffer has no room left for the report.
async function residual(kind: "adopted" | "full-buffer") {
  const { _createSocketHandle, kStateSymbol } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const received = iterationCounter();
  let lastDelivery = 0;
  let tookTheError = false;

  const peer = await Bun.udpSocket({ hostname: HOST, port: 0, socket: quiet });
  const nudge = await Bun.udpSocket({ hostname: HOST, port: 0, socket: quiet });

  // Created first and made readable first, so the loop runs this callback
  // before the event of `socket`.
  const first = await Bun.udpSocket({
    hostname: HOST,
    port: 0,
    socket: {
      data() {
        socket.send("y", error => {
          tookTheError = (error as NodeJS.ErrnoException | null)?.code === "ECONNREFUSED";
        });
      },
      error() {},
    },
  });

  const socket = kind === "adopted" ? createSocket("udp4") : createSocket({ type: "udp4", recvBufferSize: 64 * 1024 });
  socket.on("error", () => {});
  socket.on("message", () => {
    received.count();
    lastDelivery = performance.now();
  });
  if (kind === "adopted") {
    const wrap = _createSocketHandle(HOST, 0, "udp4");
    if (typeof wrap === "number") throw new Error(`_createSocketHandle failed: ${wrap}`);
    const { promise, resolve } = Promise.withResolvers<void>();
    socket.once("listening", resolve);
    socket.bind({ fd: wrap.fd });
    await promise;
  } else {
    await bound(socket);
  }
  await new Promise<void>(resolve => socket.connect(peer.port, HOST, () => resolve()));
  const native = socket[kStateSymbol].handle.socket;
  const port = socket.address().port;

  // Every socket starts writable. Let those events pass, so that the order of
  // the two events below is the order they are raised in.
  for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve));

  // All of this before the loop polls again. 400 is more than the 64 KiB
  // receive buffer holds, so how many arrive is the kernel's answer.
  const sent = kind === "adopted" ? 40 : 400;
  nudge.send("go", first.port, HOST);
  queue(peer, port, sent);
  peer.close();
  socket.send("x");

  const finished = await iterateUntil(() => {
    if (native.closed || received.total === sent) return true;
    return kind === "full-buffer" && received.total > 0 && performance.now() - lastDelivery > 300;
  });
  const closed = native.closed;
  socket.close();
  first.close();
  nudge.close();
  return { residual: tookTheError, closed, sent, finished, ...received.summary() };
}

const scenarios = {
  // 100 datagrams queued on a Bun.udpSocket.
  backlog: () =>
    firstUsable(async () => {
      const received = iterationCounter();
      const receiver = await Bun.udpSocket({ hostname: HOST, port: 0, socket: { data: () => received.count() } });
      const sender = await Bun.udpSocket({ hostname: HOST, port: 0, socket: quiet });
      queue(sender, receiver.port, 100);
      const finished = await iterateUntil(() => received.total === 100);
      receiver.close();
      sender.close();
      return { finished, ...received.summary() };
    }, reachedTheBound(100)),

  // The handler of the first datagram queues 100 more on its own socket. The
  // event that has read 7 by then has 25 left: not 32, and not 4 more batches.
  refill: () =>
    firstUsable(async () => {
      const received = iterationCounter();
      const sender = await Bun.udpSocket({ hostname: HOST, port: 0, socket: quiet });
      const receiver = await Bun.udpSocket({
        hostname: HOST,
        port: 0,
        socket: {
          data(socket) {
            received.count();
            if (received.total === 1) queue(sender, socket.port, 100);
          },
        },
      });
      queue(sender, receiver.port, 7);
      const finished = await iterateUntil(() => received.total === 107);
      receiver.close();
      sender.close();
      return { finished, ...received.summary() };
    }, reachedTheBound(107)),

  // 100 datagrams queued on a node:dgram socket.
  "dgram-backlog": () =>
    firstUsable(async () => {
      const received = iterationCounter();
      const receiver = createSocket("udp4");
      receiver.on("message", () => received.count());
      const port = await bound(receiver);
      const sender = await Bun.udpSocket({ hostname: HOST, port: 0, socket: quiet });
      queue(sender, port, 100);
      const finished = await iterateUntil(() => received.total === 100);
      receiver.close();
      sender.close();
      return { finished, ...received.summary() };
    }, reachedTheBound(100)),

  // The bound belongs to one socket and one event: two sockets with 100 each
  // deliver 32 each in the same iteration.
  "dgram-two-sockets": () =>
    firstUsable(
      async () => {
        const received = iterationCounter();
        const each = [iterationCounter(), iterationCounter()];
        const sender = await Bun.udpSocket({ hostname: HOST, port: 0, socket: quiet });
        const receivers: Socket[] = [];
        const ports: number[] = [];
        for (const counter of each) {
          const receiver = createSocket("udp4");
          receiver.on("message", () => {
            counter.count();
            received.count();
          });
          receivers.push(receiver);
          ports.push(await bound(receiver));
        }
        for (const port of ports) queue(sender, port, 100);
        const finished = await iterateUntil(() => received.total === 200);
        for (const receiver of receivers) receiver.close();
        sender.close();
        return { finished, maxOfEach: each.map(counter => counter.summary().max), ...received.summary() };
      },
      run => run.finished && run.total === 200 && run.max >= 64 && run.maxOfEach.every(max => max >= 32),
    ),

  "residual-adopted": () =>
    firstUsable(
      () => residual("adopted"),
      run => run.residual && run.finished,
    ),
  "residual-full-buffer": () =>
    firstUsable(
      () => residual("full-buffer"),
      run => run.residual && run.finished,
    ),
};

const scenario = scenarios[process.argv[2] as keyof typeof scenarios];
if (!scenario) throw new Error(`unknown scenario: ${process.argv[2]}`);
console.log(JSON.stringify(await scenario()));
