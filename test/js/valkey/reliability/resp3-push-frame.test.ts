import { describe, expect, test } from "bun:test";
import net from "node:net";

/**
 * RESP3 allows the server to send out-of-band push frames (`>` type byte) at
 * any time on any connection, not only on subscriber connections. Examples
 * include client-side-caching `invalidate` pushes and keyspace notifications.
 *
 * These tests use a minimal scripted RESP3 server so the exact bytes on the
 * wire are fully controlled and no external redis/valkey process is required.
 */
describe("Valkey: RESP3 out-of-band push frames", () => {
  const CRLF = "\r\n";
  const bulk = (s: string) => `$${Buffer.byteLength(s, "latin1")}${CRLF}${s}${CRLF}`;
  const arr = (parts: string[]) => `*${parts.length}${CRLF}${parts.join("")}`;
  const push = (parts: string[]) => `>${parts.length}${CRLF}${parts.join("")}`;

  /** Parse complete client->server RESP command frames out of a latin1 buffer. */
  function parseCommandFrames(buffer: string, offset: number): { argvs: string[][]; offset: number } {
    const argvs: string[][] = [];
    while (offset < buffer.length) {
      if (buffer[offset] !== "*") break;
      const headerEnd = buffer.indexOf(CRLF, offset);
      if (headerEnd === -1) break;
      const argc = parseInt(buffer.slice(offset + 1, headerEnd), 10);
      if (!Number.isInteger(argc) || argc < 0) break;
      let pos = headerEnd + 2;
      const argv: string[] = [];
      let complete = true;
      for (let i = 0; i < argc; i++) {
        if (buffer[pos] !== "$") {
          complete = false;
          break;
        }
        const lenEnd = buffer.indexOf(CRLF, pos);
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
        argv.push(buffer.slice(lenEnd + 2, lenEnd + 2 + len));
        pos = next;
      }
      if (!complete) break;
      argvs.push(argv);
      offset = pos;
    }
    return { argvs, offset };
  }

  /**
   * Minimal scripted RESP3 server. The `onCommand` callback receives the
   * parsed argv of each client command and returns the exact bytes to write
   * back (which may include extra unsolicited push frames). Returning
   * `undefined` uses a default reply (+OK for HELLO/CLIENT/RESET, +PONG for PING).
   */
  function createMockRedisServer(
    onCommand: (argv: string[], socket: net.Socket) => string | undefined,
  ): Promise<{ server: net.Server; port: number; sockets: net.Socket[] }> {
    return new Promise((resolve, reject) => {
      const sockets: net.Socket[] = [];
      const server = net.createServer(socket => {
        sockets.push(socket);
        socket.setNoDelay(true);
        socket.on("error", () => {});
        let received = "";
        let parsedOffset = 0;
        socket.on("data", data => {
          received += data.toString("latin1");
          const parsed = parseCommandFrames(received, parsedOffset);
          parsedOffset = parsed.offset;
          for (const argv of parsed.argvs) {
            let out = onCommand(argv, socket);
            if (out === undefined) {
              const cmd = argv[0]?.toUpperCase();
              if (cmd === "PING") out = "+PONG" + CRLF;
              else out = "+OK" + CRLF;
            }
            socket.write(Buffer.from(out, "latin1"));
          }
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as net.AddressInfo;
        resolve({ server, port: address.port, sockets });
      });
      server.on("error", reject);
    });
  }

  test("push frame on a non-subscriber connection does not consume a command's reply slot", async () => {
    // The reply to `GET k3` is preceded by an out-of-band RESP3 push frame
    // (shaped like a client-side-caching invalidate). The push frame must be
    // handled independently and must NOT be delivered as the result of `GET k3`,
    // otherwise every subsequent command resolves with the previous command's
    // reply (permanent off-by-one desync).
    const invalidatePush = push([bulk("invalidate"), arr([bulk("some-key")])]);

    const { server, port, sockets } = await createMockRedisServer(argv => {
      if (argv[0]?.toUpperCase() !== "GET") return undefined;
      const key = argv[1];
      const reply = bulk(`val:${key}`);
      if (key === "k3") return invalidatePush + reply;
      return reply;
    });

    const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
      autoReconnect: false,
      connectionTimeout: 5_000,
    });

    try {
      await client.connect();

      const keys = ["k1", "k2", "k3", "k4", "k5"];
      const results = await Promise.all(keys.map(k => client.get(k)));

      expect(results).toEqual(["val:k1", "val:k2", "val:k3", "val:k4", "val:k5"]);
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  test("multiple push frames interleaved with command replies stay in sync", async () => {
    // Stronger variant: two consecutive pushes before one reply, plus an
    // additional push before a later reply. Every GET must still resolve with
    // its own value and a non-subscription push kind must not fail the client.
    const pushA = push([bulk("invalidate"), arr([bulk("a")])]);
    const pushB = push([bulk("server-cpu-usage"), bulk("0.12")]);

    const { server, port, sockets } = await createMockRedisServer(argv => {
      if (argv[0]?.toUpperCase() !== "GET") return undefined;
      const key = argv[1];
      const reply = bulk(`val:${key}`);
      if (key === "k2") return pushA + pushB + reply;
      if (key === "k4") return pushA + reply;
      return reply;
    });

    const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
      autoReconnect: false,
      connectionTimeout: 5_000,
    });

    try {
      await client.connect();

      const keys = ["k1", "k2", "k3", "k4", "k5"];
      const results: Record<string, unknown> = {};
      await Promise.all(keys.map(k => client.get(k).then(v => (results[k] = v))));

      expect(results).toEqual({
        k1: "val:k1",
        k2: "val:k2",
        k3: "val:k3",
        k4: "val:k4",
        k5: "val:k5",
      });
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  test("push frame received while no commands are in flight does not desync later commands", async () => {
    // The push arrives between two sequential commands, so when it is parsed
    // the in-flight queue is empty. A later command must still get its own
    // reply.
    let pendingPush = "";
    const { server, port, sockets } = await createMockRedisServer(argv => {
      if (argv[0]?.toUpperCase() !== "GET") return undefined;
      const key = argv[1];
      const prefix = pendingPush;
      pendingPush = "";
      return prefix + bulk(`val:${key}`);
    });

    const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
      autoReconnect: false,
      connectionTimeout: 5_000,
    });

    try {
      await client.connect();

      const first = await client.get("a");
      expect(first).toBe("val:a");

      // Inject a push frame before the next command's reply. When the reply to
      // `GET b` is parsed, the push frame will already be in the read buffer
      // ahead of it, and at that moment there is exactly one in-flight command.
      pendingPush = push([bulk("invalidate"), arr([bulk("x")])]);

      const second = await client.get("b");
      expect(second).toBe("val:b");

      const third = await client.get("c");
      expect(third).toBe("val:c");
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  test("push frame with an unknown kind on a subscriber connection does not fail the client", async () => {
    // A subscriber connection can also receive non pub/sub push kinds. They
    // must be ignored, not treated as a protocol error that closes the client,
    // and a pub/sub message delivered afterwards must still reach the listener.
    const { server, port, sockets } = await createMockRedisServer(argv => {
      if (argv[0]?.toUpperCase() !== "SUBSCRIBE") return undefined;
      return push([bulk("subscribe"), bulk(argv[1]), `:1${CRLF}`]);
    });

    const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
      autoReconnect: false,
      connectionTimeout: 5_000,
    });

    const closed = Promise.withResolvers<never>();
    client.onclose = error => closed.reject(error ?? new Error("client closed"));

    const received = Promise.withResolvers<{ message: string; channel: string }>();

    try {
      await client.connect();
      await client.subscribe("news", (message, channel) => received.resolve({ message, channel }));

      // If the client treats the unknown push as a protocol error it closes
      // the connection, so the mock server observes its socket closing.
      sockets[0].once("close", () => closed.reject(new Error("client disconnected after the push frame")));

      // An out-of-band push the client does not recognize, followed by a real
      // pub/sub message. The message must still reach the listener.
      sockets[0].write(
        Buffer.from(
          push([bulk("invalidate"), arr([bulk("some-key")])]) + push([bulk("message"), bulk("news"), bulk("hello")]),
          "latin1",
        ),
      );

      expect(await Promise.race([received.promise, closed.promise])).toEqual({
        message: "hello",
        channel: "news",
      });
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });
});
