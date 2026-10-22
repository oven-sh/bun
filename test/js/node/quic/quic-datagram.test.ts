// `ondatagramstatus(id, status)` reports each datagram under the id that
// `sendDatagram()` returned for it, whatever order the acknowledgements and
// the losses are declared in, and whatever lsquic does with the packet.
import { describe, expect, test } from "bun:test";
import { createPrivateKey, randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { SocketAddress } from "node:net";
import { join } from "node:path";
import { connect, listen, type SessionOptions } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const sni = { "*": { keys: [key], certs: [cert] } };

// The relay sees ciphertext, so it tells 1-RTT packets apart by length. The
// sizes below put each kind of packet in a range of its own, whatever small
// frames lsquic adds to it. Two datagrams of LARGE or of MEDIUM bytes do not
// fit in one packet, so each one travels in a packet of its own.
const LARGE = 1100;
const MEDIUM = 750;
const SMALL = 200;
const CHUNK = 300;
const lengthIn = (min: number, max: number) => (packet: Buffer) =>
  !(packet[0] & 0x80) && packet.length >= min && packet.length < max;
/** A packet with a LARGE datagram. A path MTU probe is longer than 1400 bytes. */
const carriesLarge = lengthIn(LARGE, 1400);
const carriesMedium = lengthIn(MEDIUM, LARGE);
const carriesThreeSmall = lengthIn(3 * SMALL, MEDIUM);
/** A packet with CHUNK bytes of stream data. */
const carriesChunk = lengthIn(CHUNK, 3 * SMALL);
// The tests with a retransmission timeout start with this many datagrams.
const WARM_UP = 24;

/** Rejects `waits` when `session` fails or closes before they settle. */
function failWith(session: any, ...waits: PromiseWithResolvers<any>[]) {
  const fail = (error: unknown) => waits.forEach(wait => wait.reject(error));
  for (const wait of waits) wait.promise.catch(() => {});
  session.closed.then(() => fail(new Error("the session closed")), fail);
}

/** A UDP relay between a client and the server at `serverPort`. */
async function relayTo(serverPort: number) {
  const front = createSocket("udp4");
  const upstream = createSocket("udp4");
  let clientPort = 0;
  const forServer: Buffer[] = [];
  const forClient: Buffer[] = [];
  /** What the relay does with a client packet while `holdLarge()` is in effect. */
  let hold = (_packet: Buffer): "pass" | "keep" | "hold" => "pass";
  let held: Buffer | undefined;
  const relay = {
    port: 0,
    /** Returns true for a client packet that the relay must lose. */
    lose: (_packet: Buffer): boolean => false,
    /**
     * Holds the `nth` client packet with a LARGE datagram from now on, until
     * `deliverHeld()`. After that packet, a client packet passes only if it
     * carries a LARGE datagram and nothing else. The relay keeps the others
     * until `release()`. No ACK of the client may reach the server before
     * the server has acknowledged the held packet: an lsquic receiver drops a
     * packet, or its place in the next ACK, when it is older than what the
     * peer has confirmed. A packet with a datagram alone is the shortest of
     * its kind, and an ACK frame adds 5 bytes or more.
     */
    holdLarge(nth: number) {
      let carriers = 0;
      let shortest = Infinity;
      let holding = false;
      hold = packet => {
        if (!carriesLarge(packet)) return holding ? "keep" : "pass";
        shortest = Math.min(shortest, packet.length);
        if (holding) return packet.length < shortest + 5 ? "pass" : "keep";
        holding = ++carriers === nth;
        return holding ? "hold" : "pass";
      };
    },
    /** Forwards the packet that `holdLarge()` held. It arrives after the packets that passed it. */
    deliverHeld() {
      upstream.send(held!, serverPort, "127.0.0.1");
    },
    /** While true, the relay keeps the packets of both sides. */
    outage: false,
    /** How many of the packets kept for the client carry a MEDIUM datagram. */
    keptMedium: () => forClient.filter(carriesMedium).length,
    /** Forwards the packets kept for the client, through the one with the `count`th MEDIUM datagram. */
    deliverMedium(count: number) {
      let end = 0;
      for (let seen = 0; end < forClient.length && seen < count; end++) seen += +carriesMedium(forClient[end]);
      for (const packet of forClient.splice(0, end)) front.send(packet, clientPort, "127.0.0.1");
    },
    /** Ends the outage and `holdLarge()`. What the relay kept goes out, in order. */
    release() {
      relay.outage = false;
      hold = () => "pass";
      for (const packet of forServer.splice(0)) upstream.send(packet, serverPort, "127.0.0.1");
      for (const packet of forClient.splice(0)) front.send(packet, clientPort, "127.0.0.1");
    },
    /** Called for each packet that arrives at the relay from that side. */
    onClientPacket: (_packet: Buffer) => {},
    onServerPacket: () => {},
    [Symbol.dispose]() {
      front.close();
      upstream.close();
    },
  };
  upstream.on("message", packet => {
    if (relay.outage) forClient.push(packet);
    else front.send(packet, clientPort, "127.0.0.1");
    relay.onServerPacket();
  });
  front.on("message", (packet, from) => {
    clientPort = from.port;
    relay.onClientPacket(packet);
    if (relay.lose(packet)) return;
    const action = hold(packet);
    if (action === "hold") held = packet;
    else if (relay.outage || action === "keep") forServer.push(packet);
    else upstream.send(packet, serverPort, "127.0.0.1");
  });
  front.bind(0, "127.0.0.1");
  upstream.bind(0, "127.0.0.1");
  await Promise.all([once(front, "listening"), once(upstream, "listening")]);
  relay.port = front.address().port;
  return relay;
}

/**
 * A server, a relay in front of it, and a client session through the relay.
 * The first byte of each datagram the client sends is its id, so the server
 * side knows which ids arrived.
 */
async function sessionThroughRelay() {
  // Releases what is open when a step of the setup fails. The caller owns it
  // after that.
  await using setup = new AsyncDisposableStack();
  const received: number[] = [];
  let onReceived = () => {};
  // Each wait below races this, so a test that loses a session fails with
  // the cause.
  const failed = Promise.withResolvers<never>();
  const serverSession = Promise.withResolvers<any>();
  const serverSessionClosed = Promise.withResolvers<void>();
  const server = setup.use(
    await listen(
      session => {
        serverSession.resolve(session);
        session.onerror = failed.reject;
        failWith(session, failed);
        session.closed.then(serverSessionClosed.resolve, serverSessionClosed.resolve);
        // The server echoes what the client writes to a stream.
        session.onstream = async (stream: any) => {
          stream.closed.catch(() => {});
          try {
            for await (const batch of stream) for (const chunk of [batch].flat()) stream.writer.writeSync(chunk);
          } catch {}
        };
      },
      {
        sni,
        alpn: ["quic-test"],
        transportParams: { maxIdleTimeout: 10 },
        ondatagram(datagram: Uint8Array) {
          received.push(datagram[0]);
          onReceived();
        },
      },
    ),
  );
  setup.defer(() => void serverSession.promise.then(session => session.destroy()));
  const relay = setup.use(await relayTo(server.address!.port));

  const statuses = new Map<number, string[]>();
  const reported: [id: number, status: string][] = [];
  let onStatus = () => {};
  let fromServer = 0;
  let onServerDatagram = () => {};
  let onServerStream = () => {};
  const client = await connect(new SocketAddress({ address: "127.0.0.1", port: relay.port }), {
    alpn: "quic-test",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 10 },
    onerror: failed.reject,
    ondatagram() {
      fromServer++;
      onServerDatagram();
    },
    ondatagramstatus(id: bigint, status: string) {
      statuses.set(Number(id), [...(statuses.get(Number(id)) ?? []), status]);
      reported.push([Number(id), status]);
      onStatus();
    },
    async onstream(stream: any) {
      stream.closed.catch(() => {});
      try {
        for await (const _ of stream);
      } catch {}
      onServerStream();
    },
  } as SessionOptions);
  setup.defer(() => client.destroy());
  failWith(client, failed);
  await client.opened;
  const resources = setup.move();

  const ids: Promise<bigint>[] = [];
  /** Resolves once `done()` holds. `listen` installs the check at its source. Rejects when a session fails. */
  const until = (done: () => boolean, listen: (check: () => void) => void) =>
    Promise.race([
      failed.promise,
      new Promise<void>(resolve => {
        const check = () => done() && resolve();
        listen(check);
        check();
      }),
    ]);
  /** Sends a datagram of `size` bytes. Returns its id: ids count from 1. */
  const send = (size = LARGE) => {
    ids.push(client.sendDatagram(Buffer.alloc(size, ids.length + 1)));
    return ids.length;
  };
  /** The first status reported for `id`. */
  const status = (id: number) =>
    until(
      () => statuses.has(id),
      check => (onStatus = check),
    ).then(() => statuses.get(id)![0]);
  /** Resolves once one of `ids` is acknowledged. */
  const anyAcknowledged = (ids: number[]) =>
    until(
      () => ids.some(id => statuses.get(id)?.[0] === "acknowledged"),
      check => (onStatus = check),
    );
  /**
   * Resolves once the client has reported what the server's ACKs say about
   * the packets that the server has. The server opens a stream, and the
   * packet with the stream data carries the ACKs that the server still owes.
   * The client queues the statuses from that packet behind the stream, for
   * the same pass: they are out when the pass is over.
   */
  const caughtUp = async () => {
    let read = false;
    let onRead = () => {};
    onServerStream = () => {
      read = true;
      onRead();
    };
    const stream = await (await serverSession.promise).createUnidirectionalStream({ body: new Uint8Array(1) });
    stream.closed.catch(() => {});
    await until(
      () => read,
      check => (onRead = check),
    );
    await new Promise<void>(resolve => setImmediate(resolve));
  };
  return {
    client,
    relay,
    send,
    status,
    anyAcknowledged,
    until,
    /** The ids of the datagrams that the server received, in ascending order. */
    received: () => received.toSorted((a, b) => a - b),
    /**
     * Every status reported for each id: one per id, or 'lost' and then
     * 'acknowledged' for a datagram whose packet arrived late.
     */
    statuses: (): Record<string, unknown[]> => Object.fromEntries(statuses),
    /** Each report, in the order of the callbacks. */
    reported: () => reported.slice(),
    /** Resolves once the server has received datagram `id`. */
    arrival: (id: number) =>
      until(
        () => received.includes(id),
        check => (onReceived = check),
      ),
    /**
     * Round trips of two datagrams, because the server acknowledges every
     * second packet at once. After them the retransmission timers of the
     * client are short. These are datagrams 1 to WARM_UP.
     */
    async warmUp() {
      for (let i = 0; i < WARM_UP; i += 2) {
        send();
        expect(await status(send())).toBe("acknowledged");
      }
    },
    caughtUp,
    /**
     * Resolves once the client has reported what the server's ACKs say about
     * every datagram sent so far. The last one must pass the relay.
     */
    async settled() {
      const last = ids.length;
      await until(
        () => received.includes(last),
        check => (onReceived = check),
      );
      await caughtUp();
      expect((await Promise.all(ids)).map(Number)).toEqual(ids.map((_, i) => i + 1));
    },
    /** A stream to the server. `echoed(n)` resolves once `n` bytes have come back. */
    async echoStream() {
      const stream = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      let count = 0;
      let onEcho = () => {};
      (async () => {
        try {
          for await (const batch of stream) {
            for (const chunk of [batch].flat()) count += chunk.byteLength;
            onEcho();
          }
        } catch {}
      })();
      return {
        write: (size: number) => void stream.writer.writeSync(new Uint8Array(size)),
        echoed: (size: number) =>
          until(
            () => count >= size,
            check => (onEcho = check),
          ),
      };
    },
    /**
     * The server sends `count` datagrams during an outage, each in a packet
     * of its own. Resolves once the relay has them.
     */
    async serverDatagrams(count: number) {
      const session = await serverSession.promise;
      for (let i = 0; i < count; i++) session.sendDatagram(new Uint8Array(MEDIUM));
      await until(
        () => relay.keptMedium() >= count,
        check => (relay.onServerPacket = check),
      );
    },
    /**
     * The relay hands the client the next two datagrams of the server. The
     * client acknowledges every second packet at once, so it owes no ACK
     * when it dispatches the second one. Resolves inside that dispatch,
     * after `inDispatch` ran there.
     */
    async deliverTwo(inDispatch = () => {}) {
      const last = fromServer + 2;
      const dispatched = until(
        () => fromServer >= last,
        check =>
          (onServerDatagram = () => {
            if (fromServer === last) inDispatch();
            check();
          }),
      );
      relay.deliverMedium(2);
      await dispatched;
    },
    /**
     * An outage in which the retransmission timeout of the client fires. A
     * datagram leaves in a packet of its own, then stream data keeps the
     * retransmission timer running. Nothing comes back, so only that timeout
     * can declare the datagram lost. The relay loses the packet of the
     * datagram, unless `lose` keeps it for `release()`. Resolves outside the
     * session's dispatch of that status: from there each `send()` is one
     * lsquic tick.
     */
    async timeout(echo: { write(size: number): void }, lose = carriesLarge) {
      relay.lose = lose;
      relay.outage = true;
      const inOutage = send();
      let atRelay = false;
      await until(
        () => atRelay,
        check =>
          (relay.onClientPacket = () => {
            atRelay = true;
            check();
          }),
      );
      echo.write(64);
      expect(await status(inOutage)).toBe("lost");
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    async [Symbol.asyncDispose]() {
      // The client closes through the relay, which passes everything again.
      relay.lose = () => false;
      relay.release();
      client.close();
      await client.closed.catch(() => {});
      // A client that failed did not tell the server.
      (await serverSession.promise).destroy();
      await serverSessionClosed.promise;
      await resources.disposeAsync();
    },
  };
}

/** The ids from `from` to `to`. */
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** `{ [id]: [status] }` for each id from `from` to `to`. */
const all = <T>(status: T, from: number, to: number) => Object.fromEntries(range(from, to).map(id => [id, [status]]));
/**
 * What `statuses` must hold for the ids `from` to `to` when they arrived:
 * 'acknowledged', after a 'lost' when lsquic gave up on the packet before its
 * ACK came.
 */
const arrived = (statuses: Record<string, unknown[]>, from: number, to: number) =>
  Object.fromEntries(
    range(from, to).map(id => [id, statuses[id]?.[0] === "lost" ? ["lost", "acknowledged"] : ["acknowledged"]]),
  );

describe("ondatagramstatus", () => {
  test.each([
    { lost: 1, of: 6 },
    { lost: 3, of: 8 },
  ])("reports the loss of datagram $lost of $of under its id", async ({ lost, of }) => {
    await using net = await sessionThroughRelay();
    let carriers = 0;
    net.relay.lose = packet => carriesLarge(packet) && ++carriers === lost;

    for (let i = 0; i < of; i++) net.send();
    await net.settled();

    expect(net.received()).toEqual(range(1, of).filter(id => id !== lost));
    expect(net.statuses()).toEqual({ ...all("acknowledged", 1, of), [lost]: ["lost"] });
  });

  test("reports every datagram as acknowledged when no packet is lost", async () => {
    await using net = await sessionThroughRelay();

    for (let i = 0; i < 6; i++) net.send();
    await net.settled();

    expect(net.received()).toEqual(range(1, 6));
    expect(net.statuses()).toEqual(all("acknowledged", 1, 6));
  });

  test("reports each datagram of a lost packet that carried several", async () => {
    await using net = await sessionThroughRelay();
    net.relay.lose = carriesThreeSmall;

    // This `await` resumes inside the session's dispatch of the status, and
    // writes made there leave together: datagrams 2, 3 and 4 share the one
    // packet that the relay loses.
    expect(await net.status(net.send())).toBe("acknowledged");
    for (let i = 0; i < 3; i++) net.send(SMALL);
    for (let i = 0; i < 6; i++) net.send();
    await net.settled();

    expect(net.received()).toEqual([1, ...range(5, 10)]);
    expect(net.statuses()).toEqual({ ...all("acknowledged", 1, 10), ...all("lost", 2, 4) });
  });

  test("keeps an acknowledged datagram and the lost one after it apart", async () => {
    await using net = await sessionThroughRelay();
    const { relay } = net;
    const echo = await net.echoStream();
    // Outside a dispatch of the session, each write below is one packet.
    await new Promise<void>(resolve => setImmediate(resolve));

    // The relay keeps datagram 1, loses datagram 2, and keeps six packets of
    // stream data. Then the server gets them all at once. Its ACK reaches
    // past datagram 2 with stream data alone, so the client acknowledges
    // datagram 1 and then declares datagram 2 lost, in one pass.
    relay.lose = carriesLarge;
    relay.outage = true;
    let chunks = 0;
    const kept = net.until(
      () => chunks >= 6,
      check =>
        (relay.onClientPacket = packet => {
          chunks += +carriesChunk(packet);
          check();
        }),
    );
    net.send(MEDIUM);
    net.send();
    for (let i = 0; i < 6; i++) echo.write(CHUNK);
    await kept;
    relay.release();

    await echo.echoed(6 * CHUNK);
    net.send(MEDIUM);
    await net.settled();

    const statuses = net.statuses();
    expect(net.received()).toEqual([1, 3]);
    expect(statuses).toEqual({ ...arrived(statuses, 1, 1), 2: ["lost"], ...arrived(statuses, 3, 3) });
  });

  // A loss is a guess: the packet can still arrive, and the server then
  // acknowledges it. Node reports 'acknowledged' after 'lost' for such a
  // datagram, and counts it in both stats. In the tests below the relay holds
  // a packet until the client has declared its datagrams lost.
  test("reports 'acknowledged' after 'lost' when the packet of a datagram arrives late", async () => {
    await using net = await sessionThroughRelay();
    const { client, relay } = net;

    // The packets of later datagrams pass the held one, so the server's ACKs
    // make the client declare datagram 4 lost.
    relay.holdLarge(4);
    for (let i = 0; i < 12; i++) net.send();
    expect(await net.status(4)).toBe("lost");

    relay.deliverHeld();
    await net.arrival(4);
    await net.caughtUp();

    const statuses = net.statuses();
    expect(statuses[4]).toEqual(["lost", "acknowledged"]);
    // Datagram 4 is counted under both.
    const reported = Object.values(statuses);
    const { datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
    expect({ acknowledged, lost }).toEqual({
      acknowledged: BigInt(reported.filter(list => list.includes("acknowledged")).length),
      lost: BigInt(reported.filter(list => list.includes("lost")).length),
    });
  });

  test("reports 'acknowledged' after 'lost' when the late packet also carried stream data", async () => {
    await using net = await sessionThroughRelay();
    const { relay } = net;
    const echo = await net.echoStream();

    relay.holdLarge(4);
    const lengths: number[] = [];
    const atRelay = net.until(
      () => lengths.length >= 4,
      check =>
        (relay.onClientPacket = packet => {
          if (carriesLarge(packet)) lengths.push(packet.length);
          check();
        }),
    );
    net.send();
    net.send();
    // This `await` resumes inside the session's dispatch of the status, and
    // writes made there leave together: datagram 4 and the stream data share
    // the packet that the relay holds.
    expect(await net.status(net.send())).toBe("acknowledged");
    echo.write(8);
    net.send();
    await atRelay;
    expect(lengths[3]).toBeGreaterThan(Math.min(...lengths));
    // The tail loss probe of lsquic gives up on the last packet with data
    // that lsquic sends again. One more byte of stream data makes that a
    // later packet, which the relay keeps. So only the ACKs of the server can
    // declare datagram 4 lost.
    echo.write(1);

    // lsquic sends the stream data of a lost packet again, in a packet
    // without the datagram. The id must outlive that.
    for (let i = 0; i < 8; i++) net.send();
    expect(await net.status(4)).toBe("lost");

    relay.deliverHeld();
    await net.arrival(4);
    await echo.echoed(8);
    await net.caughtUp();

    expect(net.statuses()[4]).toEqual(["lost", "acknowledged"]);
  });

  test("remembers a lost datagram while ACKs that do not cover its packet arrive", async () => {
    await using net = await sessionThroughRelay();
    const { relay } = net;

    relay.holdLarge(4);
    for (let i = 0; i < 12; i++) net.send();
    expect(await net.status(4)).toBe("lost");
    // The held packet is still at the relay: the ACK for one of these
    // datagrams comes after the loss and does not cover it.
    await net.anyAcknowledged(range(1, 6).map(() => net.send()));
    expect(net.statuses()[4]).toEqual(["lost"]);

    relay.deliverHeld();
    await net.arrival(4);
    await net.caughtUp();
    expect(net.statuses()[4]).toEqual(["lost", "acknowledged"]);
  });

  test("reports the late acknowledgement once", async () => {
    await using net = await sessionThroughRelay();
    const { client, relay } = net;

    relay.holdLarge(4);
    for (let i = 0; i < 12; i++) net.send();
    expect(await net.status(4)).toBe("lost");
    relay.deliverHeld();
    await net.arrival(4);
    // No ACK of the client has reached the server, so each ACK frame of the
    // server still starts at the first packet. The frames for these
    // datagrams cover the late packet, the second one again.
    await net.anyAcknowledged(range(1, 6).map(() => net.send()));
    await net.anyAcknowledged(range(1, 6).map(() => net.send()));

    const statuses = net.statuses();
    expect(statuses[4]).toEqual(["lost", "acknowledged"]);
    const acknowledged = Object.values(statuses).filter(list => list.includes("acknowledged")).length;
    expect(client.stats.datagramsAcknowledged).toBe(BigInt(acknowledged));
  });

  test("reports a late acknowledgement when no other packet is in flight", async () => {
    await using net = await sessionThroughRelay();
    const { relay } = net;

    // After two round trips the client owes the server no ACK, so each of
    // the packets below carries a datagram and nothing else.
    expect(await net.status(net.send())).toBe("acknowledged");
    expect(await net.status(net.send())).toBe("acknowledged");
    relay.holdLarge(2);
    for (let i = 0; i < 10; i++) net.send();
    // Every other datagram has its status: the late ACK has nothing else to acknowledge.
    for (const id of range(1, 12)) await net.status(id);
    expect(net.statuses()[4]).toEqual(["lost"]);

    relay.deliverHeld();
    await net.arrival(4);
    await net.caughtUp();
    expect(net.statuses()[4]).toEqual(["lost", "acknowledged"]);
  });

  // lsquic remembers the last 32 DATAGRAM frames that it reported lost. The
  // datagrams 2 to `count + 1` share the packet that the relay holds.
  test.each([{ count: 32 }, { count: 33 }, { count: 36 }])(
    "remembers the last 32 lost datagrams when a late packet carried $count",
    async ({ count }) => {
      await using net = await sessionThroughRelay();
      const { relay } = net;

      // Together the small datagrams are as long as a LARGE one, so their
      // packet is the second one of that length.
      relay.holdLarge(2);
      // This `await` resumes inside the session's dispatch of the status, and
      // writes made there leave together: the small datagrams share one packet.
      expect(await net.status(net.send())).toBe("acknowledged");
      for (let i = 0; i < count; i++) net.send(Math.floor(1170 / count) - 2);
      const first = 2;
      const last = first + count - 1;
      for (let i = 0; i < 8; i++) net.send();
      expect(await net.status(last)).toBe("lost");
      expect(net.received()).not.toContain(first);

      relay.deliverHeld();
      await net.arrival(last);
      await net.caughtUp();

      // The late ACK finds the last 32 datagrams that were reported lost before it.
      const reported = net.reported();
      const lateAck = reported.findIndex(([id, status]) => id <= last && id >= first && status === "acknowledged");
      const lostBefore = reported.slice(0, lateAck).filter(([, status]) => status === "lost");
      const remembered = new Set(lostBefore.slice(-32).map(([id]) => id));
      const statuses = net.statuses();
      expect(Object.fromEntries(range(first, last).map(id => [id, statuses[id]]))).toEqual(
        Object.fromEntries(
          range(first, last).map(id => [id, remembered.has(id) ? ["lost", "acknowledged"] : ["lost"]]),
        ),
      );
      // More than 32 of them were in the late packet itself: the first ones are forgotten.
      expect(range(first, last).filter(id => !remembered.has(id))).toEqual(
        expect.arrayContaining(range(first, last - 32)),
      );
    },
  );

  // The retransmission timers of lsquic give up on a packet with no ACK of a
  // later packet. The timer of Node only sends probes: after a stall in which
  // nothing is lost, Node reports 'acknowledged' alone and counts no loss.
  // Both tests below pin what Bun reports: 'lost' during the stall, and
  // 'acknowledged' once the packet has arrived.
  test("reports 'acknowledged' after 'lost' when the retransmission timeout gave up on a packet that was only late", async () => {
    await using net = await sessionThroughRelay();
    const { client, relay } = net;
    const echo = await net.echoStream();

    await net.warmUp();
    // The relay keeps every packet, in order: datagram 25 is only late.
    await net.timeout(echo, () => false);
    relay.release();
    await echo.echoed(64);
    await net.settled();

    expect(net.received()).toEqual(range(1, 25));
    expect(net.statuses()).toEqual({ ...all("acknowledged", 1, 24), 25: ["lost", "acknowledged"] });
    // Datagram 25 is counted under both.
    const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
    expect({ sent, acknowledged, lost }).toEqual({ sent: 25n, acknowledged: 25n, lost: 1n });
  });

  test("reports 'acknowledged' after 'lost' when the tail loss probe gave up on a packet that was only late", async () => {
    await using net = await sessionThroughRelay();
    const { client, relay } = net;
    const echo = await net.echoStream();
    let shortest = Infinity;
    relay.onClientPacket = packet => {
      if (carriesLarge(packet)) shortest = Math.min(shortest, packet.length);
    };

    await net.warmUp();
    // This `await` resumes inside the session's dispatch of the status, and
    // writes made there leave together: datagram 26 and the stream data
    // share a packet. The relay keeps every packet from here on, in order.
    // The tail loss probe gives up on the last packet with data that lsquic
    // sends again, which is this one.
    expect(await net.status(net.send())).toBe("acknowledged");
    relay.outage = true;
    let length = 0;
    const atRelay = net.until(
      () => length > 0,
      check =>
        (relay.onClientPacket = packet => {
          if (carriesLarge(packet)) length ||= packet.length;
          check();
        }),
    );
    echo.write(8);
    net.send();
    await atRelay;
    expect(length).toBeGreaterThan(shortest);
    expect(await net.status(26)).toBe("lost");

    relay.release();
    await echo.echoed(8);
    await net.settled();

    expect(net.received()).toEqual(range(1, 26));
    expect(net.statuses()).toEqual({ ...all("acknowledged", 1, 25), 26: ["lost", "acknowledged"] });
    const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
    expect({ sent, acknowledged, lost }).toEqual({ sent: 26n, acknowledged: 26n, lost: 1n });
  });

  // After a retransmission timeout lsquic sends at most two packets until an
  // ACK arrives, and the stream data it resends is one of them. It still
  // frames each datagram into a packet, and drops the packets it may not
  // send. Node keeps such a datagram queued. Both tests below pin the status
  // that Bun gives it: 'lost', under its id.
  test.each([{ listener: true }, { listener: false }])(
    "counts a datagram that is dropped before the send as lost (ondatagramstatus: $listener)",
    async ({ listener }) => {
      await using net = await sessionThroughRelay();
      const { client, relay } = net;
      const echo = await net.echoStream();

      await net.warmUp();
      await net.timeout(echo);
      if (!listener) client.ondatagramstatus = undefined;

      // The outage ends for all but the packets with a LARGE datagram: the
      // relay loses the one of these three that may leave.
      relay.release();
      for (let i = 0; i < 3; i++) net.send();

      // The echo arrives when the connection has recovered. The datagrams
      // after it pass the relay, and their acknowledgements let the client
      // declare a datagram that did leave lost.
      await echo.echoed(64);
      for (let i = 0; i < 6; i++) net.send(MEDIUM);
      await net.settled();

      // Datagrams 1 to 24 are the warm-up, and 25 is the one of the timeout.
      const statuses = net.statuses();
      expect(net.received()).toEqual([...range(1, 24), ...range(29, 34)]);
      expect(statuses).toEqual(
        listener
          ? { ...all("acknowledged", 1, 24), ...all("lost", 25, 28), ...arrived(statuses, 29, 34) }
          : { ...all("acknowledged", 1, 24), 25: ["lost"] },
      );
      // Each datagram that arrived is counted as acknowledged, and the other
      // four as lost. One of 29 to 34 that was declared lost before its ACK
      // came is counted as both.
      const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
      expect({ sent, acknowledged }).toEqual({ sent: 34n, acknowledged: 30n });
      if (listener) {
        expect(lost).toBe(BigInt(Object.values(statuses).filter(list => list.includes("lost")).length));
      } else {
        expect(lost).toBeGreaterThanOrEqual(4n);
        expect(lost).toBeLessThanOrEqual(10n);
      }
    },
  );

  test("reports a datagram that is cut out of a packet before the send as lost, under its id", async () => {
    await using net = await sessionThroughRelay();
    const { relay } = net;
    const echo = await net.echoStream();

    await net.warmUp();
    // The relay keeps four datagrams of the server for the steps below.
    relay.outage = true;
    await net.serverDatagrams(4);
    await net.timeout(echo);
    // Datagram 26 uses up what lsquic may still send before an ACK.
    net.send();

    // Datagram 27 and stream data, written in one dispatch of the session,
    // share a packet. lsquic may not send that packet yet, and keeps it
    // because of the stream data.
    await net.deliverTwo(() => {
      echo.write(8);
      net.send();
    });
    // The client sends an ACK for the next two. lsquic gives new numbers to
    // the packets that wait behind an ACK, and it cuts the DATAGRAM frame out
    // of a packet that it renumbers.
    await net.deliverTwo();

    relay.release();
    await echo.echoed(72);
    for (let i = 0; i < 6; i++) net.send(MEDIUM);
    await net.settled();

    const statuses = net.statuses();
    expect(net.received()).toEqual([...range(1, 24), ...range(28, 33)]);
    expect(statuses).toEqual({
      ...all("acknowledged", 1, 24),
      ...all("lost", 25, 27),
      ...arrived(statuses, 28, 33),
    });
  });

  test("stops at a callback that destroys the session", async () => {
    const serverSession = Promise.withResolvers<any>();
    await using server = await listen(
      session => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        serverSession.resolve(session);
      },
      { sni, alpn: ["quic-test"], ondatagram() {} },
    );
    const calls: string[] = [];
    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      onerror() {},
      ondatagramstatus(id: bigint, status: string) {
        calls.push(`${id}:${status}`);
        if (id > 1n) throw new Error("from ondatagramstatus");
        // Writes made inside a session callback leave together: one packet,
        // and so one acknowledgement, for datagrams 2, 3 and 4.
        for (let i = 0; i < 3; i++) client.sendDatagram(new Uint8Array(SMALL));
      },
    } as SessionOptions);
    await client.opened;
    await client.sendDatagram(new Uint8Array(SMALL));

    // The throw destroys the session. As in Node, datagrams 3 and 4 are then
    // neither reported nor counted: an uncaught ERR_INTERNAL_ASSERTION for
    // each would fail this test.
    const closed = await client.closed.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    (await serverSession.promise).destroy();
    expect({ closed, calls, acknowledged: client.stats.datagramsAcknowledged }).toEqual({
      closed: "from ondatagramstatus",
      calls: ["1:acknowledged", "2:acknowledged"],
      acknowledged: 2n,
    });
  });

  test("skips a datagram of a rejected 0-RTT flight without moving the ids after it", async () => {
    // Releases the endpoints and the sessions, also when a step below fails.
    await using cleanup = new AsyncDisposableStack();
    const tokenSecret = randomBytes(16);
    const ticket = Promise.withResolvers<any>();
    const token = Promise.withResolvers<any>();
    const onSession = (session: any) => {
      session.onerror = () => {};
      session.closed.catch(() => {});
      cleanup.defer(() => session.destroy());
    };

    // A first server hands out a session ticket and a token.
    const first = cleanup.use(await listen(onSession, { sni, alpn: ["quic-test"], endpoint: { tokenSecret } }));
    const firstClient = await connect(first.address!, {
      alpn: "quic-test",
      verifyPeer: "manual",
      onsessionticket: ticket.resolve,
      onnewtoken: token.resolve,
    } as SessionOptions);
    cleanup.defer(() => firstClient.destroy());
    failWith(firstClient, ticket, token);
    await Promise.all([firstClient.opened, ticket.promise, token.promise]);
    await firstClient.close();
    await first.close();

    // A second one takes the token and rejects the early data.
    const received: number[] = [];
    let onProgress = () => {};
    const serverSession = Promise.withResolvers<any>();
    const second = cleanup.use(
      await listen(
        (session: any) => {
          onSession(session);
          serverSession.resolve(session);
        },
        {
          sni,
          alpn: ["quic-test"],
          endpoint: { tokenSecret },
          enableEarlyData: false,
          ondatagram(datagram: Uint8Array) {
            received.push(datagram[0]);
            onProgress();
          },
        },
      ),
    );
    const statuses = new Map<number, string[]>();
    const reported = Promise.withResolvers<void>();
    const client = await connect(second.address!, {
      alpn: "quic-test",
      verifyPeer: "manual",
      sessionTicket: await ticket.promise,
      token: await token.promise,
      onerror() {},
      onearlyrejected() {},
      ondatagramstatus(id: bigint, status: string) {
        statuses.set(Number(id), [...(statuses.get(Number(id)) ?? []), status]);
        onProgress();
      },
    } as SessionOptions);
    cleanup.defer(() => client.destroy());
    failWith(client, reported);

    // Datagram 1 leaves in the 0-RTT flight, datagrams 2 to 4 after the
    // handshake. No packet is lost. As in Node, datagram 1 gets no status.
    const ids = [await client.sendDatagram(new Uint8Array([1]))];
    const { earlyDataAttempted, earlyDataAccepted } = await client.opened;
    for (let i = 2; i <= 4; i++) ids.push(await client.sendDatagram(new Uint8Array([i])));
    onProgress = () => statuses.size >= 3 && received.length >= 3 && reported.resolve();
    onProgress();
    await reported.promise;
    client.destroy();
    (await serverSession.promise).destroy();

    expect({ earlyDataAttempted, earlyDataAccepted, ids }).toEqual({
      earlyDataAttempted: true,
      earlyDataAccepted: false,
      ids: [1n, 2n, 3n, 4n],
    });
    expect(received.toSorted((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(Object.fromEntries(statuses)).toEqual(all("acknowledged", 2, 4));
  });
});
