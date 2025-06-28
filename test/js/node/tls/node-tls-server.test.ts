import { readFileSync, realpathSync } from "fs";
import { tls as cert1 } from "harness";
import { AddressInfo } from "net";
import { createTest } from "node-harness";
import { once } from "node:events";
import { tmpdir } from "os";
import { join } from "path";
import type { PeerCertificate } from "tls";
import tls, { connect, createServer, rootCertificates, Server, TLSSocket } from "tls";

const { describe, expect, it, createCallCheckCtx } = createTest(import.meta.path);

const passKeyFile = join(import.meta.dir, "fixtures", "rsa_private_encrypted.pem");
const passKey = readFileSync(passKeyFile);
const rawKeyFile = join(import.meta.dir, "fixtures", "rsa_private.pem");
const rawKey = readFileSync(rawKeyFile);
const certFile = join(import.meta.dir, "fixtures", "rsa_cert.crt");
const cert = readFileSync(certFile);

const COMMON_CERT = { ...cert1 };

const socket_domain = join(realpathSync(tmpdir()), "node-tls-server.sock");

describe("tls.createServer listen", () => {
  it("should throw when no port or path when using options", done => {
    expect(() => createServer(COMMON_CERT).listen({ exclusive: true })).toThrow(
      'The argument \'options\' must have the property "port" or "path". Received {"exclusive":true}',
    );
    done();
  });

  it("should listen on IPv6 by default", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);
    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      0,
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on IPv4", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      0,
      "0.0.0.0",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("0.0.0.0");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv4");
        server.close();
        done();
      }),
    );
  });

  it("should call listening", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };

    server.on("error", closeAndFail).on(
      "listening",
      mustCall(() => {
        clearTimeout(timeout);
        server.close();
        done();
      }),
    );

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0");
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::1");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::1");
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen without port or host", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on unix domain socket", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      socket_domain,
      mustCall(() => {
        const address = server.address();
        expect(address).toStrictEqual(socket_domain);
        server.close();
        done();
      }),
    );
  });

  it("should not listen with wrong password", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer({
      key: passKey,
      passphrase: "invalid",
      cert: cert,
    });

    server.on("error", mustCall());
    let timeout: Timer;
    function closeAndFail() {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    }

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0", closeAndFail);
  });

  it("should not listen without cert", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer({
      key: passKey,
      passphrase: "invalid",
    });

    server.on("error", mustCall());

    let timeout: Timer;
    function closeAndFail() {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    }

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0", closeAndFail);
  });

  it("should not listen without password", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer({
      key: passKey,
      cert: cert,
    });

    server.on("error", mustCall());

    let timeout: Timer;
    function closeAndFail() {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    }

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0", closeAndFail);
  });
});

describe("tls.createServer", () => {
  it("should work with getCertificate", done => {
    let timeout: Timer;
    let client: TLSSocket | null = null;
    const server: Server = createServer(COMMON_CERT, socket => {
      socket.on("secure", () => {
        try {
          expect(socket).toBeDefined();
          const cert = socket.getCertificate() as PeerCertificate;
          expect(cert).toBeDefined();
          expect(cert.subject).toBeDefined();
          expect(cert.subject).toMatchObject({
            C: "US",
            CN: "server-bun",
            L: "San Francisco",
            O: "Oven",
            OU: "Team Bun",
            ST: "CA",
          });

          expect(cert.issuer).toBeDefined();
          expect(cert.issuer).toMatchObject({
            C: "US",
            CN: "server-bun",
            L: "San Francisco",
            O: "Oven",
            OU: "Team Bun",
            ST: "CA",
          });

          expect(cert.ca).toBeFalse();
          expect(cert.bits).toBe(2048);
          expect(cert.modulus).toBe(
            "beee8773af7c8861ec11351188b9b1798734fb0729b674369be3285a29fe5dacbfab700d09d7904cf1027d89298bd68be0ef1df94363012b0deb97f632cb76894bcc216535337b9db6125ef68996dd35b4bea07e86c41da071907a86651e84f8c72141f889cc0f770554791e9f07bbe47c375d2d77b44dbe2ab0ed442bc1f49abe4f8904977e3dfd61cd501d8eff819ff1792aedffaca7d281fd1db8c5d972d22f68fa7103ca11ac9aaed1cdd12c33c0b8b47964b37338953d2415edce8b83d52e2076ca960385cc3a5ca75a75951aafdb2ad3db98a6fdd4baa32f575fea7b11f671a9eaa95d7d9faf958ac609f3c48dec5bddcf1bc1542031ed9d4b281d7dd1",
          );
          expect(cert.exponent).toBe("0x10001");
          expect(cert.pubkey).toBeInstanceOf(Buffer);
          // yes these spaces are intentional
          expect(cert.valid_from).toBe("Sep  6 23:27:34 2023 GMT");
          expect(cert.valid_to).toBe("Sep  5 23:27:34 2025 GMT");
          expect(cert.fingerprint).toBe("E3:90:9C:A8:AB:80:48:37:8D:CE:11:64:45:3A:EB:AD:C8:3C:B3:5C");
          expect(cert.fingerprint256).toBe(
            "53:DD:15:78:60:FD:66:8C:43:9E:19:7E:CF:2C:AF:49:3C:D1:11:EC:61:2D:F5:DC:1D:0A:FA:CD:12:F9:F8:E0",
          );
          expect(cert.fingerprint512).toBe(
            "2D:31:CB:D2:A0:CA:E5:D4:B5:59:11:48:4B:BC:65:11:4F:AB:02:24:59:D8:73:43:2F:9A:31:92:BC:AF:26:66:CD:DB:8B:03:74:0C:C1:84:AF:54:2D:7C:FD:EF:07:6E:85:66:98:6B:82:4F:A5:72:97:A2:19:8C:7B:57:D6:15",
          );
          expect(cert.serialNumber).toBe("1da7a7b8d71402ed2d8c3646a5cedf2b8117efc8");

          expect(cert.raw).toBeInstanceOf(Buffer);
          client?.end();
          server.close();
          done();
        } catch (err) {
          client?.end();
          server.close();
          done(err);
        }
      });
    });

    const closeAndFail = (err: any) => {
      clearTimeout(timeout);
      server.close();
      client?.end();
      done(err || "Timeout");
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 1000);

    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      client = connect({
        port: address.port,
        host: address.address,
        secureContext: tls.createSecureContext(COMMON_CERT),
        rejectUnauthorized: false,
      });
    });
  });
});

describe("tls.createServer events", () => {
  it("should receive data", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let client: any = null;
    let is_done = false;
    const onData = mustCall(data => {
      is_done = true;
      clearTimeout(timeout);
      server.close();
      expect(data.byteLength).toBe(5);
      expect(data.toString("utf8")).toBe("Hello");
      done();
    });

    const server: Server = createServer(COMMON_CERT, (socket: TLSSocket) => {
      socket.on("data", onData);
    });

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      client?.end();
      mustNotCall("no data received")();
    };

    server.on("error", closeAndFail);

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        client = await Bun.connect({
          tls: true,
          hostname: address.address,
          port: address.port,
          socket: {
            data(socket) {},
            handshake(socket, success, verifyError) {
              if (socket.write("Hello")) {
                socket.end();
              }
            },
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });

  it("should call end", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let is_done = false;
    const onEnd = mustCall(() => {
      is_done = true;
      clearTimeout(timeout);
      server.close();
      done();
    });

    const server: Server = createServer(COMMON_CERT, (socket: TLSSocket) => {
      socket.on("end", onEnd);
      socket.end();
    });

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      mustNotCall("end not called")();
    };
    server.on("error", closeAndFail);

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        await Bun.connect({
          tls: true,
          hostname: address.address,
          port: address.port,
          socket: {
            data(socket) {},
            open(socket) {},
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });

  it("should call close", async () => {
    const { promise, reject, resolve } = Promise.withResolvers();
    const server: Server = createServer(COMMON_CERT);
    server.listen().on("close", resolve).on("error", reject);
    server.close();
    await promise;
  });

  it("should call connection and drop", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    let timeout: Timer;
    let is_done = false;
    const server = createServer(COMMON_CERT);
    let maxClients = 2;
    server.maxConnections = maxClients - 1;

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      mustNotCall("drop not called")();
    };

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);
    let connection_called = false;
    server
      .on(
        "connection",
        mustCall(() => {
          connection_called = true;
        }),
      )
      .on(
        "drop",
        mustCall(data => {
          is_done = true;
          server.close();
          clearTimeout(timeout);
          expect(data.localPort).toBeDefined();
          expect(data.remotePort).toBeDefined();
          expect(data.remoteFamily).toBeDefined();
          expect(data.localFamily).toBeDefined();
          expect(data.localAddress).toBeDefined();
          expect(connection_called).toBe(true);
          done();
        }),
      )
      .listen(async () => {
        const address = server.address() as AddressInfo;

        async function spawnClient() {
          await Bun.connect({
            tls: true,
            port: address?.port,
            hostname: address?.address,
            socket: {
              data(socket) {},
              handshake(socket, success, verifyError) {},
              open(socket) {
                socket.end();
              },
            },
          });
        }

        const promises = [];
        for (let i = 0; i < maxClients; i++) {
          promises.push(spawnClient());
        }
        await Promise.all(promises).catch(closeAndFail);
      });
  });

  it("should error on an invalid port", () => {
    const server = createServer(COMMON_CERT);

    expect(() => server.listen(123456)).toThrow(
      expect.objectContaining({
        code: "ERR_SOCKET_BAD_PORT",
      }),
    );
  });

  it("should call abort with signal", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const controller = new AbortController();
    let timeout: Timer;
    const server = createServer(COMMON_CERT);

    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall("close not called")();
    };

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server
      .on(
        "close",
        mustCall(() => {
          clearTimeout(timeout);
          done();
        }),
      )
      .listen({ port: 0, signal: controller.signal }, () => {
        controller.abort();
      });
  });

  it("should echo data", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let client: any = null;
    const server: Server = createServer(COMMON_CERT, (socket: TLSSocket) => {
      socket.pipe(socket);
    });
    let is_done = false;
    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      client?.end();
      mustNotCall("no data received")();
    };

    server.on("error", closeAndFail);

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        client = await Bun.connect({
          tls: true,
          hostname: address.address,
          port: address.port,
          socket: {
            error(socket, err) {
              closeAndFail();
            },
            drain(socket) {
              socket.write("Hello");
            },
            data(socket, data) {
              is_done = true;
              clearTimeout(timeout);
              server.close();
              socket.end();
              expect(data.byteLength).toBe(5);
              expect(data.toString("utf8")).toBe("Hello");
              done();
            },
            handshake(socket) {
              socket.write("Hello");
            },
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });
});

it("tls.rootCertificates should exists", () => {
  expect(tls.rootCertificates).toBeDefined();
  expect(tls.rootCertificates).toBeInstanceOf(Array);
  expect(tls.rootCertificates.length).toBeGreaterThan(0);
  expect(typeof tls.rootCertificates[0]).toBe("string");

  expect(rootCertificates).toBeDefined();
  expect(rootCertificates).toBeInstanceOf(Array);
  expect(rootCertificates.length).toBeGreaterThan(0);
  expect(typeof rootCertificates[0]).toBe("string");
});

it("connectionListener should emit the right amount of times, and with alpnProtocol available", async () => {
  let count = 0;
  const promises = [];
  const server: Server = createServer(
    {
      ...COMMON_CERT,
      ALPNProtocols: ["bun"],
    },
    socket => {
      count++;
      expect(socket.alpnProtocol).toBe("bun");
      socket.end();
    },
  );
  server.setMaxListeners(100);

  server.listen(0);
  await once(server, "listening");
  for (let i = 0; i < 50; i++) {
    const { promise, resolve } = Promise.withResolvers();
    promises.push(promise);
    const socket = connect(
      {
        ca: COMMON_CERT.cert,
        rejectUnauthorized: false,
        port: server.address().port,
        host: "127.0.0.1",
        ALPNProtocols: ["bun"],
      },
      () => {
        socket.on("close", resolve);
        socket.resume();
        socket.end();
      },
    );
  }

  await Promise.all(promises);
  expect(count).toBe(50);
});
