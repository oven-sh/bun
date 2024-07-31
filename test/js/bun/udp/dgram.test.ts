import { createSocket } from "dgram";
import { describe, test, expect, it } from "bun:test";

import { nodeDataCases } from "./testdata";
import { disableAggressiveGCScope } from "harness";
import path from "path";

describe("createSocket()", () => {
  test("connect", async () => {
    const PORT = 12345;
    const { promise, resolve } = Promise.withResolvers();
    const client = createSocket("udp4");
    client.on("close", resolve);

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

    await promise;
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
    test(`send ${label}`, async () => {
      const client = createSocket("udp4");
      const closed = { closed: false };
      const { promise, resolve, reject } = Promise.withResolvers();
      client.on("close", () => {
        closed.closed = true;
      });
      const server = createSocket("udp4");
      server.on("message", (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);
        resolve();
      });
      function sendRec() {
        if (!closed.closed) {
          const port = server.address().port;
          client.send(data, 0, data.length, port, "127.0.0.1", () => {
            if (!closed.closed) {
              setTimeout(sendRec, 10);
            }
          });
        }
      }

      try {
        server.on("listening", () => {
          sendRec();
        });
        server.bind();
        await promise;
      } finally {
        server.close();
        client.close();
      }
    });

    test(`send connected ${label}`, async () => {
      const client = createSocket("udp4");
      const server = createSocket("udp4");
      const closed = { closed: false };
      const { promise, resolve, reject } = Promise.withResolvers();

      try {
        client.on("close", () => {
          closed.closed = true;
        });
        server.on("message", (data, rinfo) => {
          validateRecv(server, data, rinfo, bytes);
          resolve();
        });
        function sendRec() {
          if (!closed.closed) {
            client.send(data, () => {
              setTimeout(sendRec, 10);
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

        await promise;
      } finally {
        server.close();
        client.close();
      }
    });

    test(`send array ${label}`, async () => {
      const client = createSocket("udp4");
      const server = createSocket("udp4");
      const closed = { closed: false };
      const { promise, resolve, reject } = Promise.withResolvers();

      try {
        client.on("close", () => {
          closed.closed = true;
        });

        client.on("error", err => {
          expect(err).toBeNull();
        });
        server.on("error", err => {
          expect(err).toBeNull();
        });
        server.on("message", (data, rinfo) => {
          validateRecv(server, data, rinfo, Buffer.from([...bytes, ...bytes, ...bytes].flat()));

          resolve();
        });
        function sendRec() {
          if (!closed.closed) {
            client.send([data, data, data], server.address().port, "127.0.0.1", () => {
              setTimeout(sendRec, 10);
            });
          }
        }
        server.on("listening", () => {
          sendRec();
        });
        server.bind();

        await promise;
      } finally {
        server.close();
        client.close();
      }
    });
  }
});

describe("unref()", () => {
  test("call before bind() does not hang", async () => {
    expect([path.join(import.meta.dir, "dgram-unref-hang-fixture.ts")]).toRun();
  });
});
