import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

/**
 * A reconnect hands the client a brand-new server-side connection, which
 * carries none of the previous connection's subscriptions. These tests pin the
 * replay of the subscription set against a scripted RESP3 server so they run
 * without a real Valkey/Redis instance.
 */

const CRLF = "\r\n";

function bulk(value: string): string {
  return `$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`;
}

const HELLO_REPLY =
  `%3${CRLF}` + bulk("server") + bulk("redis") + bulk("proto") + `:3${CRLF}` + bulk("version") + bulk("7.4.0");

type Connection = {
  socket: { write(data: string): number; end(): void } | null;
  commands: string[][];
  channels: Set<string>;
};

/** Pull every complete RESP array-of-bulk-strings command out of `buffer`. */
function parseCommands(buffer: Buffer): { commands: string[][]; rest: Buffer } {
  const commands: string[][] = [];
  let offset = 0;

  while (offset < buffer.length && buffer[offset] === 0x2a /* '*' */) {
    const headerEnd = buffer.indexOf(CRLF, offset);
    if (headerEnd === -1) break;

    const fieldCount = Number(buffer.subarray(offset + 1, headerEnd));
    const fields: string[] = [];
    let cursor = headerEnd + 2;
    let complete = true;

    for (let i = 0; i < fieldCount; i++) {
      if (cursor >= buffer.length || buffer[cursor] !== 0x24 /* '$' */) {
        complete = false;
        break;
      }
      const lengthEnd = buffer.indexOf(CRLF, cursor);
      if (lengthEnd === -1) {
        complete = false;
        break;
      }
      const byteLength = Number(buffer.subarray(cursor + 1, lengthEnd));
      if (buffer.length < lengthEnd + 2 + byteLength + 2) {
        complete = false;
        break;
      }
      fields.push(buffer.subarray(lengthEnd + 2, lengthEnd + 2 + byteLength).toString());
      cursor = lengthEnd + 2 + byteLength + 2;
    }

    if (!complete) break;
    commands.push(fields);
    offset = cursor;
  }

  return { commands, rest: buffer.subarray(offset) };
}

type ServerOptions = {
  /** Refuse SUBSCRIBE with -NOPERM on every connection from this index onwards. */
  refuseSubscribeFromConnection?: number;
};

function startRespServer({ refuseSubscribeFromConnection = Infinity }: ServerOptions = {}) {
  const connections: Connection[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];

  const server = Bun.listen<{ buffer: Buffer; connection: Connection }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        const connection: Connection = { socket, commands: [], channels: new Set() };
        connections.push(connection);
        socket.data = { buffer: Buffer.alloc(0), connection };
        for (const waiter of waiters.splice(0)) {
          if (connections.length >= waiter.count) waiter.resolve();
          else waiters.push(waiter);
        }
      },
      close(socket) {
        if (socket.data) socket.data.connection.socket = null;
      },
      error() {},
      data(socket, chunk) {
        const state = socket.data;
        state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
        const { commands, rest } = parseCommands(state.buffer);
        state.buffer = rest;

        for (const command of commands) {
          state.connection.commands.push(command);

          switch (command[0].toUpperCase()) {
            case "HELLO":
              socket.write(HELLO_REPLY);
              break;

            case "SUBSCRIBE":
              // Redis rejects the whole command once, with no per-channel confirmations.
              if (connections.indexOf(state.connection) >= refuseSubscribeFromConnection) {
                socket.write(`-NOPERM this user has no permissions to access one of the channels${CRLF}`);
                break;
              }
              for (const channel of command.slice(1)) {
                state.connection.channels.add(channel);
                socket.write(
                  `>3${CRLF}` + bulk("subscribe") + bulk(channel) + `:${state.connection.channels.size}${CRLF}`,
                );
              }
              break;

            case "UNSUBSCRIBE": {
              const channels = command.length > 1 ? command.slice(1) : [...state.connection.channels];
              for (const channel of channels) {
                state.connection.channels.delete(channel);
                socket.write(
                  `>3${CRLF}` + bulk("unsubscribe") + bulk(channel) + `:${state.connection.channels.size}${CRLF}`,
                );
              }
              break;
            }

            case "PING":
              socket.write(`+PONG${CRLF}`);
              break;

            case "PUBLISH": {
              let receivers = 0;
              for (const target of connections) {
                if (target.socket && target.channels.has(command[1])) {
                  receivers++;
                  target.socket.write(`>3${CRLF}` + bulk("message") + bulk(command[1]) + bulk(command[2]));
                }
              }
              socket.write(`:${receivers}${CRLF}`);
              break;
            }

            default:
              socket.write(`+OK${CRLF}`);
          }
        }
      },
    },
  });

  return {
    connections,
    url: `redis://127.0.0.1:${server.port}`,
    /** Resolves once the server has accepted at least `count` connections. */
    waitForConnections(count: number): Promise<void> {
      if (connections.length >= count) return Promise.resolve();
      return new Promise<void>(resolve => waiters.push({ count, resolve }));
    },
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

/** An async queue so tests await the next delivered message instead of a timer. */
function messageQueue() {
  const buffered: string[] = [];
  const waiters: ((message: string) => void)[] = [];
  return {
    push(message: string) {
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else buffered.push(message);
    },
    next(): Promise<string> {
      const message = buffered.shift();
      if (message !== undefined) return Promise.resolve(message);
      return new Promise<string>(resolve => waiters.push(resolve));
    },
  };
}

const commandLines = (connection: Connection) => connection.commands.map(command => command.join(" "));

describe("Valkey: subscriber reconnect", () => {
  test("replays SUBSCRIBE for every channel with a listener", async () => {
    using server = startRespServer();
    const messages = messageQueue();

    const subscriber = new RedisClient(server.url, { autoReconnect: true, maxRetries: 10 });
    const publisher = new RedisClient(server.url, { autoReconnect: false });

    try {
      await subscriber.connect();
      await subscriber.subscribe(["news", "sports"], message => messages.push(message));
      await publisher.connect();

      expect(await publisher.publish("news", "before")).toBe(1);
      expect(await messages.next()).toBe("before");

      // Drop the subscriber's connection from the server side.
      server.connections[0].socket!.end();
      await server.waitForConnections(3);

      // PING is written after the reconnect handshake, so its reply proves the
      // server has already seen everything else the client sent on the new
      // connection. Without a replay, SUBSCRIBE is simply missing below.
      expect(await subscriber.ping()).toBe("PONG");

      const reconnected = server.connections[2];
      expect(commandLines(reconnected)).toEqual(["HELLO 3", "SUBSCRIBE news sports", "PING"]);
      expect(subscriber.connected).toBe(true);

      // Both channels are live again, and messages reach the original listener.
      expect(await publisher.publish("sports", "after")).toBe(1);
      expect(await messages.next()).toBe("after");
    } finally {
      subscriber.close();
      publisher.close();
    }
  });

  test("does not replay channels the client unsubscribed from", async () => {
    using server = startRespServer();
    const messages = messageQueue();

    const subscriber = new RedisClient(server.url, { autoReconnect: true, maxRetries: 10 });

    try {
      await subscriber.connect();
      await subscriber.subscribe(["news", "sports"], message => messages.push(message));
      await subscriber.unsubscribe("sports");

      server.connections[0].socket!.end();
      await server.waitForConnections(2);
      expect(await subscriber.ping()).toBe("PONG");

      expect(commandLines(server.connections[1])).toEqual(["HELLO 3", "SUBSCRIBE news", "PING"]);
    } finally {
      subscriber.close();
    }
  });

  test("a client that never subscribed sends no SUBSCRIBE on reconnect", async () => {
    using server = startRespServer();

    const client = new RedisClient(server.url, { autoReconnect: true, maxRetries: 10 });

    try {
      await client.connect();
      expect(await client.ping()).toBe("PONG");

      server.connections[0].socket!.end();
      await server.waitForConnections(2);
      expect(await client.ping()).toBe("PONG");

      expect(commandLines(server.connections[1])).toEqual(["HELLO 3", "PING"]);
    } finally {
      client.close();
    }
  });

  test("an error reply to the replay settles the in-flight command instead of eating its reply slot", async () => {
    using server = startRespServer({ refuseSubscribeFromConnection: 1 });

    const subscriber = new RedisClient(server.url, { autoReconnect: true, maxRetries: 10 });

    try {
      await subscriber.connect();
      await subscriber.subscribe("news", () => {});

      server.connections[0].socket!.end();
      await server.waitForConnections(2);

      // The replayed SUBSCRIBE carries no promise, so its -NOPERM must not consume
      // the pair PING parked in the in-flight queue behind it. It used to, and the
      // pair was then dropped unsettled, hanging this await forever.
      await expect(subscriber.ping()).rejects.toThrow(/NOPERM/);
      expect(commandLines(server.connections[1])).toEqual(["HELLO 3", "SUBSCRIBE news", "PING"]);
    } finally {
      subscriber.close();
    }
  });

  test("replays SUBSCRIBE after SELECT when the URL names a database", async () => {
    using server = startRespServer();
    const messages = messageQueue();

    // The replay is written while SELECT's reply is still outstanding, so it has
    // to land behind SELECT on the wire or it would subscribe on database 0.
    const subscriber = new RedisClient(`${server.url}/3`, { autoReconnect: true, maxRetries: 10 });
    const publisher = new RedisClient(`${server.url}/3`, { autoReconnect: false });

    try {
      await subscriber.connect();
      await subscriber.subscribe("news", message => messages.push(message));
      expect(commandLines(server.connections[0])).toEqual(["HELLO 3", "SELECT 3", "SUBSCRIBE news"]);

      await publisher.connect();
      server.connections[0].socket!.end();
      await server.waitForConnections(3);
      expect(await subscriber.ping()).toBe("PONG");

      expect(commandLines(server.connections[2])).toEqual(["HELLO 3", "SELECT 3", "SUBSCRIBE news", "PING"]);

      expect(await publisher.publish("news", "after")).toBe(1);
      expect(await messages.next()).toBe("after");
    } finally {
      subscriber.close();
      publisher.close();
    }
  });
});
