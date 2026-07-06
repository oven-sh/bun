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
 * A RESP3 server just real enough to handshake and answer GET, so these tests
 * run without a redis/valkey server. `answerHello: false` accepts the socket
 * but never completes the handshake.
 */
function startMockRedis({ answerHello = true }: { answerHello?: boolean } = {}) {
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
