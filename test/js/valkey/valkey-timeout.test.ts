import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

const CRLF = "\r\n";
const bulk = (value: string) => `$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`;
const HELLO_REPLY = `%3${CRLF}${bulk("server")}${bulk("redis")}${bulk("proto")}:3${CRLF}${bulk("version")}${bulk("7.4.0")}`;

/** Pull every complete `*N $len arg ...` command out of the socket's buffer. */
function takeCommands(state: { buf: Buffer }): string[][] {
  const commands: string[][] = [];
  for (;;) {
    const buf = state.buf;
    if (buf.length === 0 || buf[0] !== 0x2a /* * */) break;
    const argcEnd = buf.indexOf(CRLF);
    if (argcEnd < 0) break;
    const argc = Number(buf.subarray(1, argcEnd).toString());
    const args: string[] = [];
    let offset = argcEnd + 2;
    let complete = true;
    for (let i = 0; i < argc; i++) {
      if (offset >= buf.length || buf[offset] !== 0x24 /* $ */) {
        complete = false;
        break;
      }
      const lengthEnd = buf.indexOf(CRLF, offset);
      if (lengthEnd < 0) {
        complete = false;
        break;
      }
      const length = Number(buf.subarray(offset + 1, lengthEnd).toString());
      if (buf.length < lengthEnd + 2 + length + 2) {
        complete = false;
        break;
      }
      args.push(buf.subarray(lengthEnd + 2, lengthEnd + 2 + length).toString());
      offset = lengthEnd + 2 + length + 2;
    }
    if (!complete) break;
    state.buf = buf.subarray(offset);
    commands.push(args);
  }
  return commands;
}

/**
 * A RESP3 server just real enough to handshake, answer GET, and reply `+OK` to
 * anything else, so these tests run without a redis/valkey server.
 *
 * - `answerHello: false` accepts the socket but never completes the handshake.
 * - `endFirstConnectionAfterMs` makes the server hang up on its first client,
 *   the way a server enforcing its own idle timeout would.
 */
function startMockRedis({
  answerHello = true,
  endFirstConnectionAfterMs = 0,
}: { answerHello?: boolean; endFirstConnectionAfterMs?: number } = {}) {
  const state = { hellos: 0 };
  const listener = Bun.listen<{ buf: Buffer }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buf: Buffer.alloc(0) };
      },
      error() {},
      close() {},
      data(socket, chunk) {
        socket.data.buf = socket.data.buf.length ? Buffer.concat([socket.data.buf, chunk]) : chunk;
        for (const command of takeCommands(socket.data)) {
          switch (command[0].toUpperCase()) {
            case "HELLO":
              state.hellos++;
              if (answerHello) socket.write(HELLO_REPLY);
              // Scripted server behaviour, not a wait: the hangup has to land
              // at a known point relative to the client's idle deadline.
              if (endFirstConnectionAfterMs > 0 && state.hellos === 1) {
                setTimeout(() => socket.end(), endFirstConnectionAfterMs);
              }
              break;
            case "GET":
              socket.write(bulk("v"));
              break;
            default:
              socket.write(`+OK${CRLF}`);
          }
        }
      },
    },
  });
  return {
    port: listener.port,
    /** how many handshakes the server has seen, so reconnects are visible */
    get hellos() {
      return state.hellos;
    },
    stop() {
      listener.stop(true);
    },
  };
}

describe("RedisClient timeouts", () => {
  test("a busy connection outlives connectionTimeout when idleTimeout is set", async () => {
    const server = startMockRedis();
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, {
      idleTimeout: 60_000,
      connectionTimeout: 400,
    });
    const closes: Error[] = [];
    client.onclose = error => {
      closes.push(error);
    };

    try {
      await client.connect();

      // Keep the connection busy well past connectionTimeout. Neither timeout
      // may fire while commands are flowing.
      let answered = 0;
      const deadline = Date.now() + 3 * 400;
      while (Date.now() < deadline) {
        expect(await client.get(`key-${answered}`)).toBe("v");
        answered++;
        await Bun.sleep(25);
      }

      expect({
        busy: answered > 1,
        closes,
        connected: client.connected,
        hellos: server.hellos,
      }).toEqual({ busy: true, closes: [], connected: true, hellos: 1 });
    } finally {
      client.close();
      server.stop();
    }
  });

  test("an idle connection is closed after idleTimeout and reopens on the next command", async () => {
    const server = startMockRedis();
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, {
      idleTimeout: 300,
      connectionTimeout: 10_000,
    });
    const { promise: closed, resolve } = Promise.withResolvers<Error>();
    client.onclose = resolve;

    try {
      await client.connect();
      expect(client.connected).toBe(true);

      const error: any = await closed;
      expect({ code: error?.code, connected: client.connected }).toEqual({
        code: "ERR_REDIS_CONNECTION_CLOSED",
        connected: false,
      });

      // The connection was dropped because it was idle, not because it broke:
      // the next command opens a fresh one.
      expect(await client.get("key")).toBe("v");
      expect(server.hellos).toBe(2);
    } finally {
      client.close();
      server.stop();
    }
  });

  // A command that cannot be auto-pipelined takes the write-immediately path in
  // enqueue() unless connection_ready() is false, so reopening must not leave
  // the closed connection's `is_authenticated` behind: the bytes would be
  // written to a socket that has not opened yet, dropped by on_open, and the
  // promise orphaned in the in-flight queue.
  for (const [name, options, run] of [
    ["a non-pipelineable command", {}, (c: RedisClient) => c.send("INFO", [])],
    ["enableAutoPipelining: false", { enableAutoPipelining: false }, (c: RedisClient) => c.send("INFO", [])],
  ] as const) {
    test(`${name} reopens the connection after an idle-timeout close`, async () => {
      const server = startMockRedis();
      const client = new RedisClient(`redis://127.0.0.1:${server.port}`, { idleTimeout: 300, ...options });
      const { promise: closed, resolve } = Promise.withResolvers<Error>();
      client.onclose = resolve;

      try {
        await client.connect();
        await closed;

        expect(await run(client)).toBe("OK");
        // And the in-flight queue is still aligned: this reply is the GET's.
        expect(await client.get("key")).toBe("v");
        expect(server.hellos).toBe(2);
      } finally {
        client.close();
        server.stop();
      }
    });
  }

  test("a server-initiated close does not leave the idle timer armed", async () => {
    // Deadlines, all in the same timer heap so their order is fixed: the server
    // hangs up at 270ms, the idle timer would fire at 300ms, auto-reconnect runs
    // at 270+50ms. A timer left armed by the close fires inside that window,
    // against a disconnected client, and rejects the offline queue.
    const server = startMockRedis({ endFirstConnectionAfterMs: 270 });
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, { idleTimeout: 300 });

    try {
      await client.connect();
      while (client.connected) await Bun.sleep(1);

      // Queued while disconnected: it must ride out the reconnect, not be
      // rejected by the dead connection's timer.
      expect(await client.get("key")).toBe("v");
      expect({ connected: client.connected, hellos: server.hellos }).toEqual({ connected: true, hellos: 2 });
    } finally {
      client.close();
      server.stop();
    }
  });

  test("connectionTimeout still fires when the handshake never completes", async () => {
    const server = startMockRedis({ answerHello: false });
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, {
      idleTimeout: 60_000,
      connectionTimeout: 300,
    });

    try {
      const error: any = await client.connect().then(
        () => null,
        e => e,
      );
      expect({ code: error?.code, connected: client.connected }).toEqual({
        code: "ERR_REDIS_CONNECTION_CLOSED",
        connected: false,
      });
    } finally {
      client.close();
      server.stop();
    }
  });
});

describe("RedisClient reconnect state", () => {
  // Closing leaves the client marked authenticated, so a command issued before
  // the reopened socket came up took enqueue()'s write-immediately path: on_open
  // dropped the bytes, the promise stayed in the in-flight queue, and every
  // later reply was paired with the wrong command.
  test("a command racing an un-awaited connect() gets its own reply", async () => {
    const server = startMockRedis();
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`);

    try {
      await client.connect();
      expect(await client.get("key")).toBe("v");

      client.close();
      client.connect(); // deliberately not awaited: the socket is still opening

      expect(await client.send("INFO", [])).toBe("OK");
      expect(await client.get("key")).toBe("v");
      expect(server.hellos).toBe(2);
    } finally {
      client.close();
      server.stop();
    }
  });
});
