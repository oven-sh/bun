import { describe, expect, it } from "bun:test";
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
