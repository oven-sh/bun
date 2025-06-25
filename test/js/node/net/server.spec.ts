import { isWindows } from "harness";
import EventEmitter from "node:events";
import type { SocketConnectOpts } from "node:net";
import net from "node:net";

describe("net.createServer(connectionListener)", () => {
  const onListen = jest.fn((socket: net.Socket) => {
    expect(socket).toBeInstanceOf(net.Socket);
  });
  let server: net.Server;
  beforeEach(() => {
    server = net.createServer(onListen);
  });
  afterEach(() => {
    server.close();
    onListen.mockClear();
  });

  it("creates a new Server", () => {
    expect(server).toBeInstanceOf(net.Server);
  });

  it("calls the connection listener when a socket connects", async () => {
    await new Promise<void>(resolve => server.listen(() => resolve()));

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const address = server.address();
    expect(address).not.toBeNull();
    expect(address).not.toBeTypeOf("string");
    await using client = net.createConnection(address as net.AddressInfo, resolve);
    await promise;
    await Bun.sleep(1); // next event loop cycle
    expect(onListen).toHaveBeenCalled();
  });
});

describe("net.Server", () => {
  const defaultServer = new net.Server();

  it("extends EventEmitter", () => {
    expect(defaultServer).toBeInstanceOf(EventEmitter);
    expect(net.Server.__proto__).toBe(EventEmitter);
  });

  // @ts-expect-error -- Types lie. Server constructor is callable
  it("is callable", () => expect(net.Server()).toBeInstanceOf(net.Server));
  it("has a length of 2", () => expect(net.Server).toHaveLength(2));

  it.each([null, undefined, {}])("new Server(%p) acts as new Server()", (options: any) => {
    const server = new net.Server(options);
    expect(server).toBeInstanceOf(net.Server);
    expect(server).toMatchObject(defaultServer);
  });

  it.each([1, false, "string", Symbol("symbol")])(
    "when options is not an object, throws ERR_INVALID_ARG_TYPE ",
    (badObject: any) => {
      expect(() => new net.Server(badObject)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    },
  );
}); // </net.Server constructor>

describe("net.Server.prototype", () => {
  it("has the expected methods", () => {
    expect(net.Server.prototype).toMatchObject(
      expect.objectContaining({
        address: expect.any(Function),
        close: expect.any(Function),
        getConnections: expect.any(Function),
        listen: expect.any(Function),
        ref: expect.any(Function),
        unref: expect.any(Function),
      }),
    );
  });

  it("is disposable", () => {
    expect(Symbol.asyncDispose in net.Server.prototype).toBe(true);
  });

  it("has EventEmitter methods", () => {
    expect(net.Server.prototype.__proto__).toBe(EventEmitter.prototype);
    expect(net.Server.prototype).toMatchObject(EventEmitter.prototype);
  });
}); // </net.Server.prototype>

describe("new net.Server()", () => {
  let server: net.Server;

  beforeAll(() => {
    server = new net.Server();
  });

  afterAll(() => {
    try {
      server.close();
    } catch {
      // ignore
    }
  });

  it("creates a new Server", () => expect(server).toBeInstanceOf(net.Server));
  describe("the server instance", () => {
    it("has no address", () => expect(server.address()).toBeNull());
    it("is not listening", () => expect(server.listening).toBe(false));
    it("has no connections", () => {
      expect(server._connections).toBe(0);
      expect(server.connections).toBeUndefined();
    });
    it("is not unrefed", () => expect(server._unref).toBe(false));
    it("will not pause on connections", () => expect(server.pauseOnConnect).toBe(false));
    it("does not allow half-open connections", () => expect(server.allowHalfOpen).toBe(false));
    it("does not keep the socket alive", () => {
      expect(server.keepAlive).toBe(false);
      expect(server.keepAliveInitialDelay).toBe(0);
    });
    it.skipIf(isWindows)("has a high water mark of 65,536 on posix", () => expect(server.highWaterMark).toBe(65_536));
    it.skipIf(!isWindows)("has a high water mark of 16,384 on Windows", () =>
      expect(server.highWaterMark).toBe(16_384),
    );
    it("has no event listeners", () => {
      expect(server._eventsCount).toBe(0);
      expect(server._events).toEqual({});
      expect(server.eventNames()).toEqual([]);
    });
    it("is not using workers", () => expect(server._usingWorkers).toBe(false));
    it.skip("has a listening id", () => {
      expect((server as unknown as { _listeningId: number })._listeningId).toEqual(expect.any(Number));
    });
  }); // </the server instance>
}); // </new net.Server()>

describe("server.address()", () => {
  let server: net.Server;

  beforeEach(() => {
    server = net.createServer(() => {});
  });
  afterEach(() => {
    server.close();
  });

  it("returns null when the server is not listening", () => {
    expect(server.address()).toBeNull();
  });

  describe("when the server listens to an unspecified port", () => {
    beforeEach(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.listen(resolve);
      await promise;
    });

    it("address defaults to ipv6 any address", () => {
      const address = server.address();
      expect(address.address).toBe("::");
      expect(address.family).toBe("IPv6");
    });

    it("picks a random, valid port", () => {
      const port = server.address().port;
      expect(port).toBeTypeOf("number");
      expect(port).not.toBeNaN();
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThanOrEqual(65_535);
    });
  }); // </when the server listens to an unspecified port>

  it("when listening on a specified port, returns an AddressInfo object with the same port", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    server.listen(6543, resolve);
    await promise;
    expect(server.address()).toEqual({ address: "::", port: 6543, family: "IPv6" });
  });

  // FIXME: hostname is not resolved
  it.skip("when server.listen(port, hostname), returns an AddressInfo object with the same port and hostname", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    server.listen(1234, "localhost", resolve);
    await promise;
    expect(server.address()).toEqual({
      address: "127.0.0.1",
      port: 1234,
      family: "IPv4",
    });
  });

  it("when listening on a specified host and port, returns an AddressInfo object with the same host and port", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    server.listen({ port: 1234, host: "127.0.0.1" }, resolve);
    await promise;
    expect(server.address()).toEqual({ address: "127.0.0.1", port: 1234, family: "IPv4" });
  });
}); // </server.address()>

describe("server.close()", () => {
  let server: net.Server;
  const handlers = {
    close: jest.fn(),
    error: jest.fn(),
    connection: jest.fn(),
  } as const;

  beforeEach(() => {
    server = new net.Server();
    for (const handler in handlers) {
      server.on(handler, handlers[handler]);
    }
  });

  afterEach(() => {
    server.close();
    for (const handler in handlers) {
      handlers[handler].mockClear();
    }
  });

  it("if the server is not listening, does nothing", () => {
    expect(server.listening).toBe(false);
    expect(() => server.close()).not.toThrow();
    expect(server.listening).toBe(false);
  });

  describe("given a server listening for connections", () => {
    let address: net.AddressInfo;
    beforeEach(async () => {
      await new Promise<void>(resolve =>
        server.listen(() => {
          address = server.address() as net.AddressInfo;
          resolve();
        }),
      );
    });

    it("is listening", () => expect(server.listening).toBe(true));

    describe("when closed", () => {
      beforeEach(() => server.close());
      // FIXME: should emit with `hasError: false`, but emits `undefined`
      it("emits a 'close' event", () => expect(handlers.close).toHaveBeenCalled());
      it("does not emit an 'error' event", () => expect(handlers.error).not.toHaveBeenCalled());
      it("server is no longer listening", () => expect(server.listening).toBe(false));
      it("server will not accept new connections", async () => {
        let client = new net.Socket();
        const { promise, resolve, reject } = Promise.withResolvers();
        const onError = jest.fn();
        const onConnect = jest.fn();
        client.on("error", e => {
          onError(e);
          resolve();
        });
        client.connect(address as SocketConnectOpts, () => {
          onConnect();
          resolve();
        });
        await promise;
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "ECONNREFUSED" }));
        expect(onConnect).not.toHaveBeenCalled();
        expect(handlers.connection).not.toHaveBeenCalled();
      });

      it(".address() returns null", () => {
        expect(server.address()).toBeNull();
      });
    });
  }); // </given a server listening for connections>
}); // </server.close()>
