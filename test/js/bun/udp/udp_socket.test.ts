import { udpSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { disableAggressiveGCScope, randomPort } from "harness";
import { dataCases, dataTypes } from "./testdata";
import { heapStats } from "bun:jsc";

describe("udpSocket()", () => {
  test("connect with invalid hostname rejects", async () => {
    expect(async () =>
      udpSocket({
        connect: { hostname: "example!!!!!.com", port: 443 },
      }),
    ).toThrow();
  });
  test("can create a socket", async () => {
    const socket = await udpSocket({});
    expect(socket).toBeInstanceOf(Object);
    expect(socket.port).toBeInteger();
    expect(socket.port).toBeWithin(1, 65535 + 1);
    expect(socket.port).toBe(socket.port); // test that property is cached
    expect(socket.hostname).toBeString();
    expect(socket.hostname).toBe(socket.hostname); // test that property is cached
    expect(socket.address).toEqual({
      address: socket.hostname,
      family: socket.hostname === "::" ? "IPv6" : "IPv4",
      port: socket.port,
    });
    expect(socket.address).toBe(socket.address); // test that property is cached
    expect(socket.binaryType).toBe("buffer");
    expect(socket.binaryType).toBe(socket.binaryType); // test that property is cached
    expect(socket.ref).toBeFunction();
    expect(socket.unref).toBeFunction();
    expect(socket.send).toBeFunction();
    expect(socket.close).toBeFunction();
    socket.close();
  });

  test("can create a socket with given port", async () => {
    for (let i = 0; i < 30; i++) {
      const port = randomPort();
      try {
        const socket = await udpSocket({ port });
        expect(socket.port).toBe(port);
        expect(socket.address).toMatchObject({ port: socket.port });
        socket.close();
        break;
      } catch (e) {
        continue;
      }
    }
  });

  test("can create a socket with a random port", async () => {
    const socket = await udpSocket({ port: 0 });
    expect(socket.port).toBeInteger();
    expect(socket.port).toBeWithin(1, 65535 + 1);
    expect(socket.address).toMatchObject({ port: socket.port });
    socket.close();
  });

  describe.each([{ hostname: "localhost" }, { hostname: "127.0.0.1" }, { hostname: "::1" }])(
    "can create a socket with given hostname",
    ({ hostname }) => {
      test(hostname, async () => {
        const socket = await udpSocket({ hostname });
        expect(socket.hostname).toBe(hostname);
        expect(socket.port).toBeInteger();
        expect(socket.port).toBeWithin(1, 65535 + 1);
        expect(socket.address).toMatchObject({ port: socket.port });
        socket.close();
      });
    },
  );

  const validateRecv = (socket, data, port, address, binaryType, bytes) => {
    // This test file takes 1 minute in CI because we are running GC too much.
    using _ = disableAggressiveGCScope();

    expect(socket).toBeInstanceOf(Object);
    expect(socket.binaryType).toBe(binaryType || "buffer");
    expect(data.byteLength).toBe(bytes.byteLength);
    expect(data).toBeBinaryType(binaryType || "buffer");
    expect(data).toEqual(bytes);
    expect(port).toBeInteger();
    expect(port).toBeWithin(1, 65535 + 1);
    expect(port).not.toBe(socket.port);
    expect(address).toBeString();
    expect(address).not.toBeEmpty();
  };

  const validateSend = res => {
    // This test file takes 1 minute in CI because we are running GC too much.
    using _ = disableAggressiveGCScope();

    expect(res).toBeBoolean();
  };

  const validateSendMany = (res, count) => {
    // This test file takes 1 minute in CI because we are running GC too much.
    using _ = disableAggressiveGCScope();

    expect(res).toBeNumber();
    expect(res).toBeGreaterThanOrEqual(0);
    expect(res).toBeLessThanOrEqual(count);
  };

  for (const { binaryType, type } of dataTypes) {
    for (let { label, data, bytes } of dataCases) {
      if (type === ArrayBuffer) {
        bytes = new Uint8Array(bytes).buffer;
      }

      test(`send ${label} (${binaryType || "undefined"})`, async done => {
        const client = await udpSocket({});
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              server.close();
              client.close();
              done();
            },
          },
        });

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSend(client.send(data, server.port, "127.0.0.1"));
            setTimeout(sendRec, 10);
          }
        }
        sendRec();
      });

      test(`send connected ${label} (${binaryType || "undefined"})`, async done => {
        let client;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              server.close();
              client.close();
              done();
            },
          },
        });
        client = await udpSocket({
          connect: {
            port: server.port,
            hostname: "127.0.0.1",
          },
        });

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSend(client.send(data));
            setTimeout(sendRec, 10);
          }
        }
        sendRec();
      });

      test(`sendMany ${label} (${binaryType || "undefined"})`, async done => {
        const client = await udpSocket({});
        let count = 0;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              count += 1;
              if (count === 100) {
                server.close();
                client.close();
                done();
              }
            },
          },
        });

        const payload = Array(100).fill([data, server.port, "127.0.0.1"]).flat();

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSendMany(client.sendMany(payload), 100);
            setTimeout(sendRec, 10);
          }
        }
        sendRec();
      });

      test(`sendMany connected ${label} (${binaryType || "undefined"})`, async done => {
        // const client = await udpSocket({});
        let client;
        let count = 0;
        const server = await udpSocket({
          binaryType: binaryType,
          socket: {
            data(socket, data, port, address) {
              validateRecv(socket, data, port, address, binaryType, bytes);

              count += 1;
              if (count === 100) {
                server.close();
                client.close();
                done();
              }
            },
          },
        });

        client = await udpSocket({
          connect: {
            port: server.port,
            hostname: "127.0.0.1",
          },
        });

        const payload = Array(100).fill(data);

        // handle unreliable transmission in UDP
        function sendRec() {
          if (!client.closed) {
            validateSendMany(client.sendMany(payload), 100);
            setTimeout(sendRec, 10);
          }
        }
        sendRec();
      });
    }
  }
});
