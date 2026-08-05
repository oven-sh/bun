import type { RedisOptions } from "bun";
import { describe, expect, test } from "bun:test";
import net from "net";

/**
 * A connection-level failure must close the socket, so `on_close` gets to run the
 * client's reconnect / `onclose` policy. Without that the client is stranded in
 * `failed && connected`: every command rejects, but nothing ever tells the app.
 */

const CRLF = "\r\n";
const bulk = (value: string) => `$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`;
const HELLO_REPLY = `%3${CRLF}${bulk("server")}${bulk("redis")}${bulk("proto")}:3${CRLF}${bulk("version")}${bulk("7.4.0")}`;
/** `\x01` is not a RESP type byte, so the client must treat the reply as a protocol failure. */
const UNPARSEABLE_REPLY = `\x01not-a-resp-type${CRLF}`;

/** Pull every complete `*N\r\n$len\r\n…` command frame out of `buffer`. */
function takeCommands(buffer: Buffer): { commands: string[][]; rest: Buffer } {
  const commands: string[][] = [];
  let rest = buffer;
  while (rest.length > 0 && rest[0] === 0x2a /* '*' */) {
    const headerEnd = rest.indexOf(CRLF);
    if (headerEnd < 0) break;
    const argCount = Number(rest.subarray(1, headerEnd).toString());
    if (!Number.isInteger(argCount) || argCount < 0) break;

    let pos = headerEnd + 2;
    const argv: string[] = [];
    let complete = true;
    for (let i = 0; i < argCount; i++) {
      if (pos >= rest.length || rest[pos] !== 0x24 /* '$' */) {
        complete = false;
        break;
      }
      const lengthEnd = rest.indexOf(CRLF, pos);
      if (lengthEnd < 0) {
        complete = false;
        break;
      }
      const length = Number(rest.subarray(pos + 1, lengthEnd).toString());
      if (!Number.isInteger(length) || length < 0 || rest.length < lengthEnd + 2 + length + 2) {
        complete = false;
        break;
      }
      argv.push(rest.subarray(lengthEnd + 2, lengthEnd + 2 + length).toString());
      pos = lengthEnd + 2 + length + 2;
    }
    if (!complete) break;

    commands.push(argv);
    rest = rest.subarray(pos);
  }
  return { commands, rest };
}

type MockServer = Disposable & {
  port: number;
  /** Resolves once a client connection has been torn down. */
  disconnected: Promise<void>;
};

async function startMockValkey(respond: (socket: net.Socket, argv: string[]) => void) {
  const { promise: disconnected, resolve: onDisconnected } = Promise.withResolvers<void>();
  const sockets: net.Socket[] = [];

  const server = net.createServer(socket => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    socket.on("data", chunk => {
      buffered = buffered.length > 0 ? Buffer.concat([buffered, chunk]) : chunk;
      const { commands, rest } = takeCommands(buffered);
      buffered = rest;
      for (const argv of commands) respond(socket, argv);
    });
    socket.on("error", () => {});
    socket.on("close", () => onDisconnected());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    disconnected,
    [Symbol.dispose]() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  } satisfies MockServer;
}

function createClient(port: number, options: RedisOptions) {
  return new Bun.RedisClient(`redis://127.0.0.1:${port}`, { connectionTimeout: 5_000, ...options });
}

describe("Valkey: a failed connection is torn down", () => {
  test("a protocol error closes the socket and fires onclose", async () => {
    using server = await startMockValkey((socket, argv) => {
      if (argv[0].toUpperCase() === "HELLO") socket.write(HELLO_REPLY);
      else socket.write(UNPARSEABLE_REPLY);
    });
    const client = createClient(server.port, { autoReconnect: false });
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    client.onclose = () => onClosed();

    try {
      await client.connect();
      const rejection = await client.ping().then(
        () => null,
        (thrown: any) => thrown,
      );
      expect(rejection?.code).toBe("ERR_REDIS_INVALID_RESPONSE_TYPE");

      await closed;
      await server.disconnected;
      expect(client.connected).toBe(false);
    } finally {
      client.close();
    }
  });

  // `onclose` only fires on the terminal branch of `on_close` — the reconnecting branch
  // never calls it — so seeing it here is proof the client did not re-dial. That matters:
  // a repeatable post-handshake failure would otherwise loop forever, because a successful
  // HELLO resets `retry_attempts` and `maxRetries` is never reached.
  test("a protocol error is terminal even with autoReconnect enabled, and connect() revives", async () => {
    let handshakes = 0;
    let pings = 0;

    using server = await startMockValkey((socket, argv) => {
      switch (argv[0].toUpperCase()) {
        case "HELLO":
          handshakes++;
          socket.write(HELLO_REPLY);
          break;
        case "PING":
          // Break the first connection mid-stream, then answer normally.
          socket.write(++pings === 1 ? UNPARSEABLE_REPLY : `+PONG${CRLF}`);
          break;
        default:
          socket.write(`+OK${CRLF}`);
          break;
      }
    });
    const client = createClient(server.port, { autoReconnect: true });
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    client.onclose = () => onClosed();

    try {
      await client.connect();
      const rejection = await client.ping().then(
        () => null,
        (thrown: any) => thrown,
      );
      expect(rejection?.code).toBe("ERR_REDIS_INVALID_RESPONSE_TYPE");

      await closed;
      await server.disconnected;
      expect(client.connected).toBe(false);

      // The app is handed the failure and can re-dial on its own terms.
      await client.connect();
      expect(await client.ping()).toBe("PONG");
      expect({ connected: client.connected, handshakes }).toEqual({ connected: true, handshakes: 2 });
    } finally {
      client.close();
    }
  });
});
