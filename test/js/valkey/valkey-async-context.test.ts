import { RedisClient } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

// In-process stand-in for a RESP3 server: just HELLO, SUBSCRIBE and PUBLISH,
// which is all the tests below exercise. Commands arrive as RESP arrays of bulk
// strings; everything the test data contains is ASCII, so latin1 keeps string
// offsets equal to byte offsets.
function listenRespStub() {
  type Conn = { buf: string; channels: Set<string> };
  const bulk = (s: string) => `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  const connections = new Set<Bun.Socket<Conn>>();

  // Splits every complete command off the front of the connection's buffer.
  function takeCommands(conn: Conn): string[][] {
    const commands: string[][] = [];
    for (;;) {
      const buf = conn.buf;
      const headerEnd = buf.indexOf("\r\n");
      if (!buf.startsWith("*") || headerEnd === -1) return commands;
      const args: string[] = [];
      let pos = headerEnd + 2;
      for (let remaining = Number(buf.slice(1, headerEnd)); remaining > 0; remaining--) {
        const lenEnd = buf.indexOf("\r\n", pos);
        if (buf[pos] !== "$" || lenEnd === -1) return commands;
        const start = lenEnd + 2;
        const end = start + Number(buf.slice(pos + 1, lenEnd));
        if (buf.length < end + 2) return commands;
        args.push(buf.slice(start, end));
        pos = end + 2;
      }
      conn.buf = buf.slice(pos);
      commands.push(args);
    }
  }

  const listener = Bun.listen<Conn>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buf: "", channels: new Set() };
        connections.add(socket);
      },
      close(socket) {
        connections.delete(socket);
      },
      data(socket, chunk) {
        socket.data.buf += chunk.toString("latin1");
        let reply = "";
        for (const [command, ...args] of takeCommands(socket.data)) {
          switch (command.toUpperCase()) {
            case "HELLO":
              reply += "%1\r\n+proto\r\n:3\r\n";
              break;
            case "SUBSCRIBE":
              for (const channel of args) {
                socket.data.channels.add(channel);
                reply += `>3\r\n${bulk("subscribe")}${bulk(channel)}:${socket.data.channels.size}\r\n`;
              }
              break;
            case "PUBLISH": {
              const [channel, message] = args;
              let receivers = 0;
              for (const subscriber of connections) {
                if (!subscriber.data.channels.has(channel)) continue;
                subscriber.write(`>3\r\n${bulk("message")}${bulk(channel)}${bulk(message)}`);
                receivers++;
              }
              reply += `:${receivers}\r\n`;
              break;
            }
            default:
              reply += `-ERR the stub does not implement ${command}\r\n`;
          }
        }
        if (reply) socket.write(reply);
      },
    },
  });

  return {
    url: `redis://127.0.0.1:${listener.port}`,
    connections,
    [Symbol.dispose]() {
      listener.stop(true);
    },
  };
}

// onconnect, onclose and subscribe() listeners are invoked from socket events,
// where no user async context is active, so they have to run in the
// AsyncLocalStorage context that was active when they were registered (the
// same thing a node-redis/ioredis listener observes).
describe.concurrent("RedisClient AsyncLocalStorage propagation", () => {
  type Store = { tenant: string };
  const als = new AsyncLocalStorage<Store>();

  test("onconnect runs in the context it was assigned in", async () => {
    using stub = listenRespStub();
    const clients: RedisClient[] = [];
    try {
      const seen = await Promise.all(
        ["T1", "T2"].map(tenant =>
          als.run({ tenant }, async () => {
            const client = new RedisClient(stub.url);
            clients.push(client);
            const { promise, resolve } = Promise.withResolvers<Store | undefined>();
            const onconnect = () => resolve(als.getStore());
            client.onconnect = onconnect;
            expect(client.onconnect).toBe(onconnect);
            await client.connect();
            return promise;
          }),
        ),
      );
      expect(seen).toEqual([{ tenant: "T1" }, { tenant: "T2" }]);
    } finally {
      for (const client of clients) client.close();
    }
  });

  type Closed = { store: Store | undefined; message: string };

  // Connects a client inside `tenant`'s context with an onclose handler that
  // reports the context it ran in.
  async function connectWithOnClose(url: string, tenant: string) {
    return als.run({ tenant }, async () => {
      const client = new RedisClient(url, { autoReconnect: false });
      const { promise: closed, resolve } = Promise.withResolvers<Closed>();
      const onclose = (error: Error) => resolve({ store: als.getStore(), message: error.message });
      client.onclose = onclose;
      expect(client.onclose).toBe(onclose);
      await client.connect();
      return { client, closed };
    });
  }

  test("onclose runs in the context it was assigned in when close() is called", async () => {
    using stub = listenRespStub();
    const [a, b] = await Promise.all([connectWithOnClose(stub.url, "T1"), connectWithOnClose(stub.url, "T2")]);
    a.client.close();
    b.client.close();
    expect(await Promise.all([a.closed, b.closed])).toEqual([
      { store: { tenant: "T1" }, message: "Connection closed" },
      { store: { tenant: "T2" }, message: "Connection closed" },
    ]);
  });

  test("onclose runs in the context it was assigned in when the server drops the connection", async () => {
    using stub = listenRespStub();
    const { client, closed } = await connectWithOnClose(stub.url, "T1");
    try {
      // connect() resolved on the HELLO reply, so the stub has accepted this client's socket.
      expect(stub.connections.size).toBe(1);
      for (const connection of stub.connections) connection.end();
      expect(await closed).toEqual({ store: { tenant: "T1" }, message: "Connection closed" });
    } finally {
      client.close();
    }
  });

  type Received = { store: Store | undefined; channel: string; message: string };

  test("subscribe() listeners run in the context subscribe() was called in, not the publisher's", async () => {
    using stub = listenRespStub();
    const tenantSubscriber = new RedisClient(stub.url);
    const plainSubscriber = new RedisClient(stub.url);
    const publisher = new RedisClient(stub.url);
    try {
      const fromTenant = Promise.withResolvers<Received>();
      await als.run({ tenant: "T1" }, async () => {
        await tenantSubscriber.connect();
        await tenantSubscriber.subscribe("news", (message, channel) =>
          fromTenant.resolve({ store: als.getStore(), channel, message }),
        );
      });

      const fromPlain = Promise.withResolvers<Received>();
      await plainSubscriber.connect();
      await plainSubscriber.subscribe("news", (message, channel) =>
        fromPlain.resolve({ store: als.getStore(), channel, message }),
      );

      await als.run({ tenant: "publisher" }, async () => {
        await publisher.connect();
        expect(await publisher.publish("news", "hello")).toBe(2);
      });

      expect(await Promise.all([fromTenant.promise, fromPlain.promise])).toEqual([
        { store: { tenant: "T1" }, channel: "news", message: "hello" },
        { store: undefined, channel: "news", message: "hello" },
      ]);
    } finally {
      tenantSubscriber.close();
      plainSubscriber.close();
      publisher.close();
    }
  });

  test("a listener passed to subscribe() with an array of channels runs in the subscribing context", async () => {
    using stub = listenRespStub();
    const subscriber = new RedisClient(stub.url);
    const publisher = new RedisClient(stub.url);
    try {
      const received: Received[] = [];
      const { promise: gotBoth, resolve } = Promise.withResolvers<Received[]>();
      await als.run({ tenant: "T1" }, async () => {
        await subscriber.connect();
        await subscriber.subscribe(["alpha", "beta"], (message, channel) => {
          received.push({ store: als.getStore(), channel, message });
          if (received.length === 2) resolve(received);
        });
      });

      await publisher.connect();
      expect(await publisher.publish("alpha", "a")).toBe(1);
      expect(await publisher.publish("beta", "b")).toBe(1);

      expect(await gotBoth).toEqual([
        { store: { tenant: "T1" }, channel: "alpha", message: "a" },
        { store: { tenant: "T1" }, channel: "beta", message: "b" },
      ]);
    } finally {
      subscriber.close();
      publisher.close();
    }
  });

  test("unsubscribe(channel, listener) still removes a listener that was registered inside a context", async () => {
    using stub = listenRespStub();
    const subscriber = new RedisClient(stub.url);
    const publisher = new RedisClient(stub.url);
    try {
      const removed = mock((_message: string, _channel: string) => {});
      const { promise: survivorReceived, resolve } = Promise.withResolvers<string>();
      await als.run({ tenant: "T1" }, async () => {
        await subscriber.connect();
        await subscriber.subscribe("news", removed);
        await subscriber.subscribe("news", message => resolve(message));
      });

      await subscriber.unsubscribe("news", removed);

      await publisher.connect();
      expect(await publisher.publish("news", "after unsubscribe")).toBe(1);
      // Both listeners were registered on the same channel of the same client,
      // so by the time the surviving one has seen the message, `removed` would
      // have been invoked too had it still been registered.
      expect(await survivorReceived).toBe("after unsubscribe");
      expect(removed).not.toHaveBeenCalled();
    } finally {
      subscriber.close();
      publisher.close();
    }
  });
});
