import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import net from "node:net";

// Byte-scripted RESP3 server for reply-integrity tests: a command's
// promise must never resolve with another command's data.

const HELLO_MAP = "%1\r\n+proto\r\n:3\r\n";

type CommandFrame = { name: string; args: string[] };

function parseFrames(buffer: string, offset: number): { frames: CommandFrame[]; offset: number } {
  const frames: CommandFrame[] = [];
  while (offset < buffer.length) {
    if (buffer[offset] !== "*") break;
    const headerEnd = buffer.indexOf("\r\n", offset);
    if (headerEnd === -1) break;
    const argc = parseInt(buffer.slice(offset + 1, headerEnd), 10);
    if (!Number.isInteger(argc) || argc < 0) break;
    let pos = headerEnd + 2;
    const args: string[] = [];
    let complete = true;
    for (let i = 0; i < argc; i++) {
      if (buffer[pos] !== "$") {
        complete = false;
        break;
      }
      const lenEnd = buffer.indexOf("\r\n", pos);
      if (lenEnd === -1) {
        complete = false;
        break;
      }
      const len = parseInt(buffer.slice(pos + 1, lenEnd), 10);
      if (!Number.isInteger(len) || len < 0) {
        complete = false;
        break;
      }
      const next = lenEnd + 2 + len + 2;
      if (next > buffer.length) {
        complete = false;
        break;
      }
      args.push(buffer.slice(lenEnd + 2, lenEnd + 2 + len));
      pos = next;
    }
    if (!complete) break;
    frames.push({ name: args[0].toUpperCase(), args: args.slice(1) });
    offset = pos;
  }
  return { frames, offset };
}

type Mock = {
  server: net.Server;
  port: number;
  sockets: net.Socket[];
  close: () => void;
};

function createMockServer(
  onCommand: (frame: CommandFrame, socket: net.Socket, connectionIndex: number) => void,
): Promise<Mock> {
  return new Promise((resolve, reject) => {
    const sockets: net.Socket[] = [];
    let connectionIndex = 0;
    const server = net.createServer(socket => {
      const idx = connectionIndex++;
      sockets.push(socket);
      socket.setNoDelay(true);
      socket.on("error", () => {});
      let received = "";
      let parsedOffset = 0;
      socket.on("data", data => {
        received += data.toString("latin1");
        const parsed = parseFrames(received, parsedOffset);
        parsedOffset = parsed.offset;
        for (const frame of parsed.frames) {
          onCommand(frame, socket, idx);
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        server,
        port,
        sockets,
        close: () => {
          for (const s of sockets) s.destroy();
          server.close();
        },
      });
    });
    server.on("error", reject);
  });
}

function bulk(s: string): string {
  return `$${s.length}\r\n${s}\r\n`;
}

function settled<T>(p: Promise<T>): Promise<{ status: "fulfilled"; value: T } | { status: "rejected"; reason: any }> {
  return p.then(
    value => ({ status: "fulfilled" as const, value }),
    reason => ({ status: "rejected" as const, reason }),
  );
}

describe("Valkey reply/command pairing", () => {
  // RESP3 push frames (`>`) are out-of-band: an `invalidate` push on a
  // non-subscriber connection must not be delivered as the reply to the
  // oldest in-flight command.
  test("RESP3 push frame on a non-subscriber connection does not consume a command's reply slot", async () => {
    const invalidatePush = ">2\r\n" + bulk("invalidate") + "*1\r\n" + bulk("some-key");
    const mock = await createMockServer((frame, socket) => {
      if (frame.name === "HELLO") {
        socket.write(HELLO_MAP);
        return;
      }
      if (frame.name === "GET") {
        // Interleave an unsolicited push before every GET reply.
        socket.write(invalidatePush + bulk("value-of-" + frame.args[0]));
      }
    });
    const client = new RedisClient(`redis://127.0.0.1:${mock.port}`, {
      autoReconnect: false,
      connectionTimeout: 5000,
    });
    try {
      const [k1, k2, k3] = await Promise.all([client.get("k1"), client.get("k2"), client.get("k3")]);
      // Each GET must resolve with its own value. When push frames are
      // mis-routed as command replies, k1 resolves with the push object
      // and k2/k3 shift one slot and receive the previous key's value.
      expect({ k1, k2, k3 }).toEqual({
        k1: "value-of-k1",
        k2: "value-of-k2",
        k3: "value-of-k3",
      });
    } finally {
      client.close();
      mock.close();
    }
  });

  // Commands sent on a dropped socket must reject; if their slots survive
  // the reconnect they pair with the new connection's replies.
  // https://github.com/oven-sh/bun/issues/27861
  test("in-flight commands are rejected on disconnect instead of re-pairing with the next connection's replies", async () => {
    const seen: Record<number, CommandFrame[]> = { 0: [], 1: [] };
    const conn1Ready = Promise.withResolvers<void>();

    const mock = await createMockServer((frame, socket, idx) => {
      if (frame.name === "HELLO") {
        socket.write(HELLO_MAP);
        if (idx === 1) conn1Ready.resolve();
        return;
      }
      seen[idx].push(frame);
      if (idx === 0) {
        // First connection: accept commands but never reply, then drop.
        if (seen[0].length === 2) socket.destroy();
        return;
      }
      // Second connection: reply to every GET with its own key's value.
      if (frame.name === "GET") {
        socket.write(bulk("value-of-" + frame.args[0]));
      }
    });

    const client = new RedisClient(`redis://127.0.0.1:${mock.port}`, {
      autoReconnect: true,
      maxRetries: 5,
      connectionTimeout: 5000,
    });
    try {
      await client.connect();
      // Pipeline two GETs on connection 0; the server will drop the socket
      // after receiving them without replying.
      const staleA = settled(client.get("a"));
      const staleB = settled(client.get("b"));

      // After reconnect, issue two fresh commands.
      await conn1Ready.promise;
      const freshD = settled(client.get("d"));
      const freshE = settled(client.get("e"));

      // The stale commands settle in both cases: rejected when the dead
      // socket's in-flight queue is cleared (correct), or fulfilled with
      // d/e's replies when it isn't (the bug).
      const [resA, resB] = await Promise.all([staleA, staleB]);
      expect({ a: resA.status, b: resB.status }).toEqual({ a: "rejected", b: "rejected" });
      expect((resA as any).value).toBeUndefined();
      expect((resB as any).value).toBeUndefined();

      // Fresh commands must receive their own replies. This point is only
      // reached once the stale commands have been proven rejected, so the
      // fresh replies cannot have been consumed elsewhere.
      const [resD, resE] = await Promise.all([freshD, freshE]);
      expect({ d: resD, e: resE }).toEqual({
        d: { status: "fulfilled", value: "value-of-d" },
        e: { status: "fulfilled", value: "value-of-e" },
      });
    } finally {
      client.close();
      mock.close();
    }
  });

  // SUBSCRIBE with N channels produces N per-channel `subscribe` push
  // confirmations. Confirmations 2..N belong to the same SUBSCRIBE command
  // and must not consume the reply slots of unrelated in-flight commands.
  test("multi-channel SUBSCRIBE confirmations do not steal other in-flight commands' reply slots", async () => {
    const afterSubscribe = Promise.withResolvers<void>();
    const mock = await createMockServer((frame, socket) => {
      if (frame.name === "HELLO") {
        socket.write(HELLO_MAP);
        return;
      }
      if (frame.name === "SUBSCRIBE") {
        // One push per channel in the SUBSCRIBE.
        let reply = "";
        for (let i = 0; i < frame.args.length; i++) {
          reply += ">3\r\n" + bulk("subscribe") + bulk(frame.args[i]) + `:${i + 1}\r\n`;
        }
        socket.write(reply);
        afterSubscribe.resolve();
        return;
      }
      if (frame.name === "PING") {
        socket.write("+PONG\r\n");
        return;
      }
      if (frame.name === "GET") {
        socket.write(bulk("value-of-" + frame.args[0]));
        return;
      }
    });
    const client = new RedisClient(`redis://127.0.0.1:${mock.port}`, {
      autoReconnect: false,
      connectionTimeout: 5000,
    });
    try {
      const subP = client.subscribe(["ch-a", "ch-b", "ch-c"], () => {});
      await afterSubscribe.promise;
      // These are sent after SUBSCRIBE. Their replies must not be displaced
      // by the 2nd/3rd subscribe confirmations.
      const pingP = client.ping();
      const getP = client.get("k1");

      const [sub, ping, got] = await Promise.all([subP, pingP, getP]);
      expect({ ping, got }).toEqual({ ping: "PONG", got: "value-of-k1" });
      expect(typeof sub).toBe("number");
    } finally {
      client.close();
      mock.close();
    }
  });

  // A `-ERR ...` reply on a subscriber connection is still an ordinary
  // per-command error. It rejects exactly the command it answers and leaves
  // the rest of the in-flight queue and the connection intact.
  test("an error reply in subscriber mode rejects only its own command", async () => {
    let pingCount = 0;
    const mock = await createMockServer((frame, socket) => {
      if (frame.name === "HELLO") {
        socket.write(HELLO_MAP);
        return;
      }
      if (frame.name === "SUBSCRIBE") {
        socket.write(">3\r\n" + bulk("subscribe") + bulk(frame.args[0]) + ":1\r\n");
        return;
      }
      if (frame.name === "PING") {
        pingCount++;
        if (pingCount === 1) {
          socket.write("-LOADING Redis is loading the dataset in memory\r\n");
        } else {
          socket.write("+PONG\r\n");
        }
        return;
      }
    });
    const client = new RedisClient(`redis://127.0.0.1:${mock.port}`, {
      autoReconnect: false,
      connectionTimeout: 5000,
    });
    try {
      await client.subscribe("ch-a", () => {});
      // In subscriber mode only a restricted command set is allowed; PING
      // is one of them. Issue two: the server answers the first with a
      // transient -LOADING error and the second with +PONG.
      const ping1 = settled(client.ping());
      const ping2 = settled(client.ping());

      // ping2 settles on both paths: fulfilled "PONG" when the error is
      // routed to its own command, or rejected when the error is treated as
      // a connection failure that sweeps the whole queue.
      const ping2Res = await ping2;
      expect(ping2Res).toEqual({ status: "fulfilled", value: "PONG" });

      // Once ping2 is known correct, ping1 has already been handled (its
      // reply arrived first) and must have rejected with the server error.
      const ping1Res = await ping1;
      expect(ping1Res.status).toBe("rejected");
      if (ping1Res.status === "rejected") {
        expect(String(ping1Res.reason?.message ?? ping1Res.reason)).toContain("LOADING");
      }
    } finally {
      client.close();
      mock.close();
    }
  });

  // PSUBSCRIBE/PUNSUBSCRIBE reply with `psubscribe`/`punsubscribe` pushes;
  // each must pair with its own slot so the next PING reply isn't stolen.
  test("PSUBSCRIBE and PUNSUBSCRIBE confirmations pair with their own reply slots", async () => {
    const mock = await createMockServer((frame, socket) => {
      if (frame.name === "HELLO") {
        socket.write(HELLO_MAP);
        return;
      }
      if (frame.name === "PSUBSCRIBE") {
        let reply = "";
        for (let i = 0; i < frame.args.length; i++) {
          reply += ">3\r\n" + bulk("psubscribe") + bulk(frame.args[i]) + `:${i + 1}\r\n`;
        }
        // Follow with an unsolicited pmessage to verify it doesn't
        // consume a reply slot either.
        reply += ">4\r\n" + bulk("pmessage") + bulk(frame.args[0]) + bulk("news.1") + bulk("hello");
        socket.write(reply);
        return;
      }
      if (frame.name === "PUNSUBSCRIBE") {
        let reply = "";
        for (let i = 0; i < frame.args.length; i++) {
          reply += ">3\r\n" + bulk("punsubscribe") + bulk(frame.args[i]) + ":0\r\n";
        }
        socket.write(reply);
        return;
      }
      if (frame.name === "PING") {
        socket.write("+PONG\r\n");
        return;
      }
    });
    const client = new RedisClient(`redis://127.0.0.1:${mock.port}`, {
      autoReconnect: false,
      connectionTimeout: 5000,
    });
    try {
      const sub = await client.psubscribe("news.*");
      expect(typeof sub).toBe("number");
      expect(await client.ping()).toBe("PONG");
      const unsub = await client.punsubscribe("news.*");
      expect(unsub).toBeUndefined();
      expect(await client.ping()).toBe("PONG");
    } finally {
      client.close();
      mock.close();
    }
  });

  // The raw `send()` escape hatch must derive subscription flags from the
  // command name so its confirmation push pairs with its own reply slot.
  test.each([
    ["SUBSCRIBE", "subscribe"],
    ["subscribe", "subscribe"],
    ["SSUBSCRIBE", "ssubscribe"],
  ])("raw send(%p, [...]) pairs its confirmation push with its own reply slot", async (commandName, pushKind) => {
    const mock = await createMockServer((frame, socket) => {
      if (frame.name === "HELLO") {
        socket.write(HELLO_MAP);
        return;
      }
      if (frame.name === commandName.toUpperCase()) {
        socket.write(">3\r\n" + bulk(pushKind) + bulk(frame.args[0]) + ":1\r\n");
        return;
      }
      if (frame.name === "PING") {
        socket.write("+PONG\r\n");
        return;
      }
    });
    const client = new RedisClient(`redis://127.0.0.1:${mock.port}`, {
      autoReconnect: false,
      connectionTimeout: 5000,
    });
    try {
      const sub = await client.send(commandName, ["ch"]);
      expect(typeof sub).toBe("number");
      expect(await client.ping()).toBe("PONG");
    } finally {
      client.close();
      mock.close();
    }
  });

  // An `unsubscribe` confirmation must only count against an UNSUBSCRIBE
  // head. Argless UNSUBSCRIBE emits one push per channel; the extras must
  // not be charged to a following SUBSCRIBE drained into in_flight.
  test("extra unsubscribe confirmations do not consume a queued SUBSCRIBE's reply slot", async () => {
    let subscribed = new Set<string>();
    const mock = await createMockServer((frame, socket) => {
      if (frame.name === "HELLO") {
        socket.write(HELLO_MAP);
        return;
      }
      if (frame.name === "SUBSCRIBE") {
        let reply = "";
        for (const ch of frame.args) {
          subscribed.add(ch);
          reply += ">3\r\n" + bulk("subscribe") + bulk(ch) + `:${subscribed.size}\r\n`;
        }
        socket.write(reply);
        return;
      }
      if (frame.name === "UNSUBSCRIBE") {
        const channels = frame.args.length > 0 ? frame.args : [...subscribed];
        let reply = "";
        for (const ch of channels) {
          subscribed.delete(ch);
          reply += ">3\r\n" + bulk("unsubscribe") + bulk(ch) + `:${subscribed.size}\r\n`;
        }
        socket.write(reply);
        return;
      }
    });
    const client = new RedisClient(`redis://127.0.0.1:${mock.port}`, {
      autoReconnect: false,
      connectionTimeout: 5000,
    });
    try {
      await client.subscribe(["a", "b", "c"], () => {});
      // Issue UNSUBSCRIBE-all (3 confirmation pushes) and a new SUBSCRIBE
      // back to back so the SUBSCRIBE is drained into in_flight while
      // unsubscribe confirmations are still arriving.
      const unsubP = client.unsubscribe();
      const subP = client.subscribe(["d"], () => {});
      const [unsub, sub] = await Promise.all([unsubP, subP]);
      expect(unsub).toBeUndefined();
      // The new SUBSCRIBE must resolve with its own channel count. If an
      // unsubscribe push stole its slot it would resolve with `undefined`
      // via the unsubscribe dispatch arm.
      expect(typeof sub).toBe("number");
    } finally {
      client.close();
      mock.close();
    }
  });
});
