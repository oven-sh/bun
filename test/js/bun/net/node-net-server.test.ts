import { describe, expect, it } from "bun:test";
import { close } from "fs";
import { createServer } from "net";
import { createCallCheckCtx } from "node-test-helpers";

describe("net.creeateServer listen", () => {
  it("should listen on IPv6 by default", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      0,
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen on IPv4", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      0,
      "127.0.0.1",
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("127.0.0.1");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv4");
        server.close();
      }),
    );
    done();
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::1");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::1");
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen without port or host", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen on the correct port", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      65535,
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::");
        expect(address.port).toStrictEqual(65535);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen on the correct port with IPV4", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      65534,
      "127.0.0.1",
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("127.0.0.1");
        expect(address.port).toStrictEqual(65534);
        expect(address.family).toStrictEqual("IPv4");
        server.close();
      }),
    );
    done();
  });
});
it("should receive data", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);

  const server = createServer(socket => {
    const onData = mustCall(data => {
      server.close();
      expect(data.byteLength).toBe(5);
      expect(data.toString("utf8")).toBe("Hello");
      done();
    });
    socket.on("data", onData);
  });
  function closeAndFail() {
    console.log("closed!");
    server.close();
    expect("").toBe("Hello");
  }
  server.on("error", mustNotCall("no data received"));

  //should be faster than 100ms
  setTimeout(() => {
    closeAndFail();
  }, 100);

  server.listen(
    65534,
    "127.0.0.1",
    mustCall(() => {
      const address = server.address();
      Bun.connect({
        hostname: address.address,
        port: address.port,
        socket: {
          data(socket) {},
          open(socket) {
            socket.write("Hello");
          },
          close: closeAndFail,
          // client-specific handlers
          connectError: closeAndFail, // connection failed
          end: closeAndFail,
        },
      })
        .then(client => {
          client.unref();
        })
        .catch(closeAndFail);
    }),
  );
});
