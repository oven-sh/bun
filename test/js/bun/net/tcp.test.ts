import { SocketHandler, TCPSocketListener } from "bun";
import type { Mock } from "bun:test";
import { jest, afterEach, test, expect } from "bun:test";
import jsc from "bun:jsc";

const handlerNames: Set<keyof SocketHandler<any>> = new Set([
  "open",
  "handshake",
  "close",
  "error",
  "end",
  "data",
  "drain",
]);

class MockSocket<Data = void> implements SocketHandler<Data> {
  open = undefined as any;
  handshake = undefined as any;
  close = undefined as any;
  error = undefined as any;
  end = undefined as any;
  data = undefined as any;

  events: string[];

  constructor(impls: Partial<SocketHandler<Data>> = {}) {
    this.events = [];
    for (const method of handlerNames) {
      const impl = impls[method] ? impls[method].bind(this) : () => this.events.push(method);
      this[method] = jest.fn(impl as any);
    }
  }

  public mockClear() {
    for (const method of Object.keys(this)) {
      if ("mockClear" in this[method]) {
        (this[method] as Mock<any>).mockClear();
      }
    }
    this.events.length = 0;
  }
}

const nextEventLoopCycle = () => new Promise(resolve => setTimeout(resolve, 0));
const nextTick = () => new Promise(resolve => process.nextTick(resolve));

const makeClient = async <Data = unknown>(handlerOverrides?: Partial<SocketHandler<Data>>, options?) => {
  const handler = new MockSocket<Data>(handlerOverrides);
  const socket = await Bun.connect({
    hostname: "localhost",
    port: 3000,
    ...options,
    socket: handler,
  });

  return {
    socket,
    handler,
    [Symbol.dispose]() {
      socket[Symbol.dispose]();
    },
  };
};

const makeServer = <Data = unknown>(handlerOverrides?: Partial<SocketHandler<Data>>, options?) => {
  const handler = new MockSocket<Data>(handlerOverrides);
  const socket: TCPSocketListener<Data> = Bun.listen({
    hostname: "localhost",
    port: 3000,
    ...options,
    socket: handler,
  });
  return {
    socket,
    handler,
    [Symbol.dispose]() {
      socket[Symbol.dispose]();
    },
  };
};

afterEach(async () => {
  await nextEventLoopCycle();
  jsc.drainMicrotasks();
});

test("open() event timing", async () => {
  const socket = { server: new MockSocket(), client: new MockSocket() };

  using server = Bun.listen({
    port: 1234,
    hostname: "localhost",
    socket: socket.server,
  });

  // just starting a server doesn't trigger any events
  await nextEventLoopCycle();
  expect(socket.server.events).toBeEmpty();
  expect(socket.client.events).toBeEmpty();

  const clientPromise = Bun.connect({
    port: 1234,
    hostname: "localhost",
    socket: socket.client,
  });
  expect(socket.client.open).not.toHaveBeenCalled();
  await nextTick();
  expect(socket.client.open).not.toHaveBeenCalled();

  // Promise resolves when client connects. Server's open only fires when
  // event loop polls for events again and finds a connection event on the
  // server socket
  using client = await clientPromise;
  expect(socket.client.open).toHaveBeenCalled();
  expect(socket.server.open).not.toHaveBeenCalled();

  // next tick loop gets drained before event loop polls again. This check makes
  // sure that open(), indeed, only fires in the next event loop cycle
  await nextTick();
  expect(socket.server.open).not.toHaveBeenCalled();

  await nextEventLoopCycle();
  expect(socket.server.open).toHaveBeenCalled();
  expect(socket.client.open).toHaveBeenCalled();
});

/**
 * Client sends FIN, so server emits `end` event. Client still reads data before
 * closing.
 */
test("client writes then closes the socket", async () => {
  using server = makeServer({
    data(socket, data) {
      expect(data.toString("utf8")).toBe("hello");
      this.events.push("data");
    },
  });
  using client = await makeClient();

  server.socket;
  client.socket.end("hello");
  await nextEventLoopCycle();
  expect(server.handler.events).toEqual(["open", "data", "end", "close"]);
  expect(client.handler.events).toEqual(["open", "close"]);
});

test.skip("client writes while server closes in the same tick", async () => {
  using server = makeServer({
    open(socket) {
      socket.write("hello");
      socket.end();
      this.events.push("open");
    },
  });
  using client = await makeClient();
  await nextEventLoopCycle();
  expect(server.handler.events).toEqual(["open", "close"]);
  expect(client.handler.events).toEqual(["open", "data", "end", "close"]);
});
