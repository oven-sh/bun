import { describe, expect, test } from "bun:test";
import { createSocket } from "dgram";

import { disableAggressiveGCScope } from "harness";
import path from "path";
import { nodeDataCases } from "./testdata";

describe("createSocket()", () => {
  test("connect", done => {
    const PORT = 12345;
    const client = createSocket("udp4");
    client.on("close", done);

    client.connect(PORT, () => {
      const remoteAddr = client.remoteAddress();
      expect(remoteAddr.port).toBe(PORT);
      expect(() => client.connect(PORT)).toThrow();

      client.disconnect();
      expect(() => client.disconnect()).toThrow();

      expect(() => client.remoteAddress()).toThrow();

      client.once("connect", () => client.close());
      client.connect(PORT);
    });
  });

  test("IPv4 address", done => {
    const socket = createSocket("udp4");

    socket.on("listening", () => {
      const address = socket.address();

      expect(address.address).toBe("127.0.0.1");
      expect(address.port).toBeNumber();
      expect(address.port).toBeFinite();
      expect(address.port).toBeGreaterThan(0);
      expect(address.family).toBe("IPv4");
      socket.close(done);
    });

    socket.on("error", err => {
      expect(err).toBeNull();
      socket.close(done);
    });

    socket.bind(0, "127.0.0.1");
  });

  test("IPv6 address", done => {
    const socket = createSocket("udp6");
    const localhost = "::1";

    socket.on("listening", () => {
      const address = socket.address();

      expect(address.address).toBe(localhost);
      expect(address.port).toBeNumber();
      expect(address.port).toBeFinite();
      expect(address.port).toBeGreaterThan(0);
      expect(address.family).toBe("IPv6");
      socket.close(done);
    });

    socket.on("error", err => {
      expect(err).toBeNull();
      socket.close(done);
    });

    socket.bind(0, localhost);
  });

  test("address before/after connecting", done => {
    const socket = createSocket("udp4");
    socket.bind(0, () => {
      expect(socket.address().address).toBe("0.0.0.0");
      socket.connect(socket.address().port, "127.0.0.1", () => {
        expect(socket.address().address).toBe("127.0.0.1");
        socket.close(done);
      });
    });
  });

  const validateRecv = (server, data, rinfo, bytes) => {
    using _ = disableAggressiveGCScope();
    try {
      expect(rinfo.port).toBeInteger();
      expect(rinfo.port).toBeWithin(1, 65535 + 1);
      expect(rinfo.address).toBeString();
      expect(rinfo.address).not.toBeEmpty();
      expect(rinfo.port).not.toBe(server.address().port);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  for (const { label, data, bytes } of nodeDataCases) {
    test(`send ${label}`, done => {
      const client = createSocket("udp4");
      const closed = { closed: false };
      client.on("close", () => {
        closed.closed = true;
      });
      const server = createSocket("udp4");
      client.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("message", (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);

        server.close();
        client.close();
        done();
      });
      function sendRec() {
        if (!closed.closed) {
          client.send(data, server.address().port, "127.0.0.1", () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on("listening", () => {
        sendRec();
      });
      server.bind();
    });

    test(`send connected ${label}`, done => {
      const client = createSocket("udp4");
      const closed = { closed: false };
      client.on("close", () => {
        closed.closed = true;
      });
      const server = createSocket("udp4");
      client.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("message", (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);

        server.close();
        client.close();
        done();
      });
      function sendRec() {
        if (!closed.closed) {
          client.send(data, () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on("listening", () => {
        const addr = server.address();
        client.connect(addr.port, "127.0.0.1", () => {
          sendRec();
        });
      });
      server.bind();
    });

    test(`send array ${label}`, done => {
      const client = createSocket("udp4");
      const closed = { closed: false };
      client.on("close", () => {
        closed.closed = true;
      });
      const server = createSocket("udp4");
      client.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("message", (data, rinfo) => {
        validateRecv(server, data, rinfo, Buffer.from([...bytes, ...bytes, ...bytes].flat()));

        server.close();
        client.close();
        done();
      });
      function sendRec() {
        if (!closed.closed) {
          client.send([data, data, data], server.address().port, "127.0.0.1", () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on("listening", () => {
        sendRec();
      });
      server.bind();
    });
  }
});

describe("unref()", () => {
  test("call before bind() does not hang", async () => {
    expect([path.join(import.meta.dir, "dgram-unref-hang-fixture.ts")]).toRun();
  });
});

describe("buffer sizes", () => {
  // Linux reports SO_RCVBUF/SO_SNDBUF doubled relative to what was requested
  // (the kernel reserves half for bookkeeping). Other platforms echo the
  // request back. Node's own test-dgram-socket-buffer-size.js branches the
  // same way.
  const applied = (n: number) => (process.platform === "linux" ? 2 * n : n);

  async function bound(options: { recvBufferSize?: number; sendBufferSize?: number } = {}) {
    const socket = createSocket({ type: "udp4", ...options });
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    socket.on("error", reject);
    socket.bind(0, resolve);
    await promise;
    return socket;
  }

  test("setRecvBufferSize/setSendBufferSize reach the kernel and the getters read it back", async () => {
    const socket = await bound();
    try {
      socket.setRecvBufferSize(10000);
      socket.setSendBufferSize(12000);
      // Distinct values so a SO_RCVBUF/SO_SNDBUF mix-up fails the assertion.
      expect({ recv: socket.getRecvBufferSize(), send: socket.getSendBufferSize() }).toEqual({
        recv: applied(10000),
        send: applied(12000),
      });

      // A second set must be observable: the getter reads the socket, not a cache.
      socket.setRecvBufferSize(16000);
      expect(socket.getRecvBufferSize()).toBe(applied(16000));
      expect(socket.getSendBufferSize()).toBe(applied(12000));
    } finally {
      socket.close();
    }
  });

  test("recvBufferSize/sendBufferSize options are applied at bind", async () => {
    const socket = await bound({ recvBufferSize: 4096, sendBufferSize: 6000 });
    try {
      expect({ recv: socket.getRecvBufferSize(), send: socket.getSendBufferSize() }).toEqual({
        recv: applied(4096),
        send: applied(6000),
      });
    } finally {
      socket.close();
    }
  });

  test("throws ERR_SOCKET_BUFFER_SIZE before the socket is bound", () => {
    const socket = createSocket("udp4");
    try {
      for (const fn of ["getRecvBufferSize", "getSendBufferSize"] as const) {
        expect(() => socket[fn]()).toThrow(
          expect.objectContaining({ code: "ERR_SOCKET_BUFFER_SIZE", name: "SystemError" }),
        );
      }
      for (const fn of ["setRecvBufferSize", "setSendBufferSize"] as const) {
        expect(() => socket[fn](8192)).toThrow(
          expect.objectContaining({ code: "ERR_SOCKET_BUFFER_SIZE", name: "SystemError" }),
        );
      }
    } finally {
      socket.close();
    }
  });

  test("throws ERR_SOCKET_BAD_BUFFER_SIZE for a size that is not a uint32", async () => {
    const socket = await bound();
    try {
      for (const bad of [-1, Infinity, "Doh!"]) {
        expect(() => socket.setRecvBufferSize(bad as number)).toThrow(
          expect.objectContaining({ code: "ERR_SOCKET_BAD_BUFFER_SIZE", name: "TypeError" }),
        );
        expect(() => socket.setSendBufferSize(bad as number)).toThrow(
          expect.objectContaining({ code: "ERR_SOCKET_BAD_BUFFER_SIZE", name: "TypeError" }),
        );
      }
    } finally {
      socket.close();
    }
  });

  test("validates the recvBufferSize/sendBufferSize options in createSocket", () => {
    expect(() => createSocket({ type: "udp4", recvBufferSize: -1 })).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE", name: "RangeError" }),
    );
    expect(() => createSocket({ type: "udp4", sendBufferSize: "x" as unknown as number })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" }),
    );
  });
});
