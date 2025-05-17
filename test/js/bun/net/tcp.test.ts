import { Socket, SocketHandler, TCPSocketConnectOptions, TCPSocketListener } from "bun";
import jsc from "bun:jsc";
import type { Mock } from "bun:test";
import { afterEach, expect, jest, test } from "bun:test";
import { isLinux } from "harness";

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

interface ClientState<Data> extends Disposable {
  socket: Socket<Data>;
  handler: MockSocket<Data>;
}

const isServer = (value: unknown): value is TCPSocketListener<unknown> =>
  !!value && typeof value === "object" && "stop" in value && "ref" in value && "reload" in value;

function makeClient<Data = unknown>(
  handlerOverrides?: Partial<SocketHandler<Data>>,
  options?: TCPSocketConnectOptions<Data>,
): Promise<ClientState<Data>>;
function makeClient<Data = unknown>(server: TCPSocketListener<Data>): Promise<ClientState<Data>>;
async function makeClient<Data = unknown>(
  serverOrHandlerOverrides?: Partial<SocketHandler<Data>>,
  options: Partial<TCPSocketConnectOptions<Data>> = {},
) {
  let handlerOverrides: Partial<SocketHandler<Data>> | undefined;
  if (isServer(serverOrHandlerOverrides)) {
    options.port = serverOrHandlerOverrides.port;
    options.hostname = serverOrHandlerOverrides.hostname;
  } else {
    handlerOverrides = serverOrHandlerOverrides;
    if (options.port == null) throw new Error("port is required");
  }
  const handler = new MockSocket<Data>(handlerOverrides);
  const socket = await Bun.connect({
    hostname: "localhost",
    // port: 0,
    ...options,
    socket: handler,
  } as any);

  return {
    socket,
    handler,
    [Symbol.dispose]() {
      socket[Symbol.dispose]();
    },
  };
}

const makeServer = <Data = unknown>(handlerOverrides?: Partial<SocketHandler<Data>>, options?) => {
  const handler = new MockSocket<Data>(handlerOverrides);
  const socket: TCPSocketListener<Data> = Bun.listen({
    hostname: "localhost",
    port: 0,
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
    port: 0,
    hostname: "localhost",
    socket: socket.server,
  });

  // just starting a server doesn't trigger any events
  await nextEventLoopCycle();
  expect(socket.server.events).toBeEmpty();
  expect(socket.client.events).toBeEmpty();

  const clientPromise = Bun.connect({
    port: server.port,
    hostname: "localhost",
    socket: socket.client,
  });
  expect(socket.client.open).not.toHaveBeenCalled();
  await nextTick();
  expect(socket.client.open).not.toHaveBeenCalled();

  // Promise resolves when client connects. Server's open only fires when
  // event loop polls for events again and finds a connection event on the
  // server socket
  using _client = await clientPromise;
  expect(socket.client.open).toHaveBeenCalled();
  // FIXME: server's open handler is called on linux, but not on macOS or windows.
  if (!isLinux) expect(socket.server.open).not.toHaveBeenCalled();

  // next tick loop gets drained before event loop polls again. This check makes
  // sure that open(), indeed, only fires in the next event loop cycle
  await nextTick();
  // FIXME: server's open handler is called on linux, but not on macOS or windows.
  if (!isLinux) expect(socket.server.open).not.toHaveBeenCalled();

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
    data(_socket, data) {
      expect(data.toString("utf8")).toBe("hello");
      this.events.push("data");
    },
  });
  using client = await makeClient(server.socket);

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
  using client = await makeClient(server.socket);
  await nextEventLoopCycle();
  expect(server.handler.events).toEqual(["open", "close"]);
  expect(client.handler.events).toEqual(["open", "data", "end", "close"]);
});
