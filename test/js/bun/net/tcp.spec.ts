import { Socket, SocketHandler, type TCPSocketListener } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "bun:test";

const createMockHandler = <Data = undefined>() =>
  ({
    close: jest.fn(),
    connectError: jest.fn(),
    data: jest.fn(),
    drain: jest.fn(),
    end: jest.fn(),
    error: jest.fn(),
    handshake: jest.fn(),
    open: jest.fn(),
    timeout: jest.fn(),
  }) satisfies SocketHandler<Data>;

const clearMockHandler = <Data = undefined>(handler: SocketHandler<Data>) => {
  for (const key in handler) {
    if ("mockClear" in handler[key]) handler[key].mockClear();
  }
};

const nextEventLoopTick = () => new Promise(resolve => setTimeout(resolve, 0));
describe("Bun.listen(options)", () => {
  describe("socket options", () => {
    // @ts-expect-error
    it("must be provided", () => expect(() => Bun.listen()).toThrow(TypeError));
    it.each([undefined, null, 1, true, function foo() {}, "foo", Symbol.for("hi")])(
      "must be an object (%p)",
      // @ts-expect-error
      badOptions => expect(() => Bun.listen(badOptions)).toThrow(TypeError),
    );
  }); // </socket options>

  describe("When called with valid options", () => {
    let listener: TCPSocketListener;

    beforeAll(() => {
      listener = Bun.listen({
        port: 6543,
        hostname: "localhost",
        socket: {
          data(socket, data) {},
        },
      });
    });

    afterAll(() => {
      expect(listener).toBeDefined();
      listener.stop();
      listener = undefined as any;
    });

    it("returns an object", () => expect(listener).toBeTypeOf("object"));

    // FIXME: this is overriding properties of `listener`
    it.skip("listener has the expected methods", () => {
      expect(listener).toMatchObject({
        stop: expect.any(Function),
        ref: expect.any(Function),
        unref: expect.any(Function),
        reload: expect.any(Function),
      });
    });

    it("is listening on localhost:6543", () => {
      expect(listener.port).toBe(6543);
      expect(listener.hostname).toBe("localhost");
    });

    it("does not have .data", () => {
      expect(listener).toHaveProperty("data");
      expect(listener.data).toBeUndefined();
    });
  }); // </When called with valid options>
}); // </Bun.listen(options)>

describe("Given a TCP server listening on port 1234", () => {
  let listener: TCPSocketListener;
  const serverHandler = createMockHandler();

  // FIXME: switching this to `beforeAll` then using `listener.reload() in
  // `beforeEach` causes a segfault.
  beforeEach(() => {
    listener = Bun.listen({
      hostname: "localhost",
      port: 0,
      socket: serverHandler,
    });
  });

  afterEach(() => {
    listener.stop(true);
    clearMockHandler(serverHandler);
    // listener.reload({ socket: serverHandler });
  });

  describe("When a client connects and waits 1 event loop cycle", () => {
    let client: Socket;
    const events = {
      client: [] as string[],
      server: [] as string[],
    };
    const clientHandler = createMockHandler();
    const getClient = (port: number) =>
      Bun.connect({
        hostname: "localhost",
        port,
        socket: clientHandler,
      });

    beforeEach(async () => {
      client = await getClient(listener.port);

      for (const event of Object.keys(clientHandler)) {
        if (typeof clientHandler[event] === "function") {
          clientHandler[event].mockImplementation(() => events.client.push(event));
        }
      }

      for (const event of Object.keys(serverHandler)) {
        if (typeof serverHandler[event] === "function") {
          serverHandler[event].mockImplementation(() => events.server.push(event));
        }
      }

      await nextEventLoopTick();
    });

    afterEach(() => {
      client.end();
      events.client.length = 0;
      events.server.length = 0;
      clearMockHandler(clientHandler);
    });

    // FIXME: readyState is 1.
    it.skip("the client enters 'open' state", () => {
      expect(client.readyState).toBe("open");
    });

    it("client.open() gets called", () => expect(clientHandler.open).toHaveBeenCalledTimes(1));
    it("server.open() gets called", () => expect(serverHandler.open).toHaveBeenCalledTimes(1));

    it.each(["handshake", "close", "error", "end"])(
      "neither client nor server's %s handler is called",
      async handler => {
        expect(clientHandler[handler]).not.toHaveBeenCalled();
        expect(serverHandler[handler]).not.toHaveBeenCalled();
      },
    );

    it("has sent no data", () => expect(client.bytesWritten).toBe(0));

    it("when the client sends data, the server's data handler gets called after data are flushed", async () => {
      const bytesWritten = client.write("hello");
      expect(bytesWritten).toBe(5);
      expect(serverHandler.data).not.toHaveBeenCalled();
      client.flush();
      expect(serverHandler.data).not.toHaveBeenCalled();
      await nextEventLoopTick();
      expect(serverHandler.data).toHaveBeenCalledTimes(1);
    });

    // FIXME: three bugs:
    // 1&2. client/server handshake callbacks are not called
    // 3.   un-commenting this and moving Bun.listen into `beforeAll` causes the
    //      `expect(server.end).toHaveBeenCalledTimes(1)` in the neighboring test
    //      to fail (it gets called twice)
    //
    describe.skip("on the next event loop cycle", () => {
      beforeEach(nextEventLoopTick);
      it("server.handshake() gets called", async () => {
        expect(serverHandler.handshake).toHaveBeenCalled();
      });
      it("client.handshake() gets called", async () => {
        expect(clientHandler.handshake).toHaveBeenCalled();
      });
    }); // </on the next event loop cycle>

    describe("When the client disconnects", () => {
      beforeEach(() => {
        client.end();
      });

      // FIXME: readyState is -1.
      it.skip("client enters 'closing' state", () => {
        expect(client.readyState).toBe("closing");
      });

      describe("On the next event loop cycle", () => {
        beforeEach(nextEventLoopTick);

        it("the server's end handler fires", () => {
          expect(serverHandler.end).toHaveBeenCalledTimes(1);
        });

        it("the server's close handler fires after end", () => {
          expect(serverHandler.close).toHaveBeenCalledTimes(1);
          const endIndex = events.server.indexOf("end");
          const closeIndex = events.server.indexOf("close");
          expect(closeIndex).toBeGreaterThan(endIndex);
        });

        it("no client errors occur", () => {
          expect(clientHandler.error).not.toHaveBeenCalled();
          expect(clientHandler.connectError).not.toHaveBeenCalled();
        });

        it("no server errors occur", () => {
          expect(serverHandler.error).not.toHaveBeenCalled();
          expect(serverHandler.connectError).not.toHaveBeenCalled();
        });

        it("can no longer send data", () => {
          expect(client.write("hello")).toBeLessThan(0);
        });

        // FIXME: readyState is detached (-1)
        it.skip("client is closed", () => {
          expect(client.readyState).toBe("closed");
        });

        // FIXME: readyState is -1.
        it.skip("calling client.end() twice does nothing", () => {
          client.end();
          expect(client.readyState).toBe("closed");
        });
      });
    });
  }); // </When a client connects>
}); // </Given a TCP socket listening on port 1234>
