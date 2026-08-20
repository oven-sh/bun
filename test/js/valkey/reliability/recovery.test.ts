import { RedisClient, type Socket, type TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/29925
//
// Regression: after the valkey client lifecycle refactor (#23141), the old
// `.failed` connection status became a sticky `flags.failed` boolean. Once
// set, it was never cleared — not on `client.connect()`, not on a successful
// reconnect — so every subsequent command rejected with "Connection has
// failed" forever. The original intent (pre-refactor) was that `connect()`
// would call `reconnect()` on the `.failed` status and recover the client.
//
// The pre-refactor `doConnect` handled `.failed` explicitly:
//     .failed => {
//         this.client.flags.is_reconnecting = true;
//         this.client.retry_attempts = 0;
//         this.reconnect();
//     },
// but the refactor folded `.failed` into `.disconnected` without clearing
// the new `flags.failed` anywhere. Plus on reconnect, the lingering
// `is_authenticated = true` from the prior session caused the new HELLO
// response to be silently dropped, so `status` never transitioned back to
// `.connected`.
//
// These tests exercise the client-side state machine only. An in-process
// RESP server is enough (and lets this file run without docker; see also
// test/regression/issue/29925.test.ts for the real-redis-server version).

const CRLF = "\r\n";
const bulk = (s: string) => `$${Buffer.byteLength(s)}${CRLF}${s}${CRLF}`;

type SocketState = { buf: Buffer };

/**
 * Minimal in-process RESP server with a key-value store, answering HELLO
 * (simple `+OK`, which the client accepts as an authenticated handshake),
 * SET/GET, and `+OK` for anything else. Enough to drive the client through
 * connected → closed → connect() → connected and back.
 */
function createRespServer() {
  const store = new Map<string, string>();
  let connections = 0;
  const server: TCPSocketListener<SocketState> = Bun.listen<SocketState>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        s.data = { buf: Buffer.alloc(0) };
        connections++;
      },
      error() {},
      close() {},
      data(s, raw) {
        const st = s.data;
        st.buf = Buffer.concat([st.buf, raw]);
        // Parse complete client RESP command frames: `*N\r\n($len\r\n<data>\r\n){N}`.
        for (;;) {
          const b = st.buf;
          if (!b.length || b[0] !== 0x2a) break; // '*'
          const headerEnd = b.indexOf(CRLF);
          if (headerEnd < 0) break;
          const argc = parseInt(b.subarray(1, headerEnd).toString("latin1"), 10);
          let pos = headerEnd + 2;
          const fields: string[] = [];
          let complete = true;
          for (let i = 0; i < argc; i++) {
            if (pos >= b.length || b[pos] !== 0x24) {
              complete = false;
              break;
            } // '$'
            const lenEnd = b.indexOf(CRLF, pos);
            if (lenEnd < 0) {
              complete = false;
              break;
            }
            const len = parseInt(b.subarray(pos + 1, lenEnd).toString("latin1"), 10);
            const next = lenEnd + 2 + len + 2;
            if (next > b.length) {
              complete = false;
              break;
            }
            fields.push(b.subarray(lenEnd + 2, lenEnd + 2 + len).toString("latin1"));
            pos = next;
          }
          if (!complete) break;
          st.buf = b.subarray(pos);
          dispatch(s, fields);
        }
      },
    },
  });

  function dispatch(s: Socket<SocketState>, fields: string[]) {
    const cmd = fields[0]?.toUpperCase();
    if (cmd === "HELLO") {
      s.write(`+OK${CRLF}`);
    } else if (cmd === "SET") {
      store.set(fields[1], fields[2]);
      s.write(`+OK${CRLF}`);
    } else if (cmd === "GET") {
      const v = store.get(fields[1]);
      s.write(v === undefined ? `_${CRLF}` : bulk(v));
    } else {
      s.write(`+OK${CRLF}`);
    }
  }

  return {
    url: `redis://127.0.0.1:${server.port}`,
    get connections() {
      return connections;
    },
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

describe("Valkey: Recovery after failure (#29925)", () => {
  test("client.connect() recovers after the client enters the failed state", async () => {
    using server = createRespServer();
    const client = new RedisClient(server.url, {
      connectionTimeout: 2000,
      autoReconnect: false,
      maxRetries: 0,
    });
    try {
      // Initial round-trip to authenticate and settle the client into the
      // connected state.
      await client.set("recovery:k", "before");
      expect(await client.get("recovery:k")).toBe("before");
      expect(client.connected).toBe(true);

      // Force the same end state the issue reporter hits: the socket
      // closes, the client moves to disconnected, and `flags.failed` is
      // set. `close()` is the deterministic way to reach it without
      // having to wait for the reconnect-exhaustion retry loop.
      client.close();
      expect(client.connected).toBe(false);

      // While the client is failed, commands reject. Before the fix this
      // was terminal — every subsequent command got "Connection has
      // failed" and there was no way to recover short of replacing the
      // client instance.
      await expect(client.get("recovery:k")).rejects.toThrow(/connection/i);

      // The key assertion: explicit connect() recovers the client.
      // Without the fix this either hung forever (because the new HELLO
      // response was dropped and `.connected` was never reached) or
      // resolved into a still-dead client that rejected the next
      // command.
      await client.connect();
      expect(client.connected).toBe(true);
      expect(server.connections).toBe(2);

      // A full round-trip after recovery confirms the client is actually
      // usable, not just carrying a stale `connected` flag.
      await client.set("recovery:k", "after");
      expect(await client.get("recovery:k")).toBe("after");
    } finally {
      client.close();
    }
  });

  // Also covers #22808: tight close()/connect()/send() cycles used to lock
  // up on the second iteration because `flags.is_authenticated` was still
  // true from the prior session, causing the new HELLO response to be
  // dropped by `handleResponse` and the connect promise to hang.
  test("repeated close()/connect()/send() cycles do not lock up", async () => {
    using server = createRespServer();
    const client = new RedisClient(server.url, { connectionTimeout: 2000 });
    try {
      const replies: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        if (client.connected) {
          client.close();
        }
        await client.connect();
        expect(client.connected).toBe(true);
        replies.push(await client.send("FLUSHALL", ["SYNC"]));
      }
      expect(replies).toEqual(["OK", "OK", "OK"]);
      expect(server.connections).toBe(3);
    } finally {
      client.close();
    }
  });
});
