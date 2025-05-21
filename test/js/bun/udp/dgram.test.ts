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
