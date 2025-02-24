import net from "node:net";
import EventEmitter from "node:events";

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
    expect(net.Server.prototype.__proto__).toBe(EventEmitter.prototype);
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
    it("has a high water mark of 65,536", () => expect(server.highWaterMark).toBe(65_536));
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
  });

  it("when listening on a specified port, returns an AddressInfo object with the same port", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    server.listen(6543, resolve);
    await promise;
    const address = server.address();
    expect(address).toEqual({ address: "::", port: 6543, family: "IPv6" });
  });
}); // </server.address()>
