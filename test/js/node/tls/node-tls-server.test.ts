import crypto from "crypto";
import { readFileSync, realpathSync } from "fs";
import { tls as cert1, isDebug } from "harness";
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
    const closeAndFail = () => {
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);

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

    const closeAndFail = () => {
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);

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

    const closeAndFail = () => {
      server.close();
      mustNotCall()();
    };

    server.on("error", closeAndFail).on(
      "listening",
      mustCall(() => {
        server.close();
        done();
      }),
    );

    server.listen(0, "0.0.0.0");
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer(COMMON_CERT);

    const closeAndFail = () => {
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);

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

    const closeAndFail = () => {
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);

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

    const closeAndFail = () => {
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);

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

    const closeAndFail = () => {
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);

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

  it("should reject passphrase longer than PEM_BUFSIZE without crashing", done => {
    // BoringSSL invokes the passphrase callback with a 1024-byte stack buffer.
    // A longer passphrase must fail key decryption rather than overflow that buffer.
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer({
      key: passKey,
      passphrase: Buffer.alloc(2000, "A").toString(),
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

          expect(cert.ca).toBe(true);
          expect(cert.bits).toBe(2048);
          expect(cert.modulus).toBe(
            "E5633A2C8118171CBEAF321D55D0444586CBE566BB51A234B0EAD69FAF7490069854EFDDFFAC68986652FF949F472252E4C7D24C6EE4E3366E54D9E4701E24D021E583E1A088112C0F96475A558B42F883A3E796C937CC4D6BB8791B227017B3E73DEB40B0AC84F033019F580A3216888ACEC71CE52D938FCADD8E29794E38774E33D323EDE89B58E526EF8B513BA465FA4FFD9CF6C1EC7480DE0DCB569DEC295D7B3CCE40256B428D5907E90E7A52E77C3101F4AD4C0E254AB03D75AC42EE1668A5094BC4521B264FB404B6C4B17B6B279E13E6282E1E4FB6303540CB830EA8FF576CA57B7861E4EF797AF824B0987C870718780A1C5141E4F904FD0C5139F5",
          );
          expect(cert.exponent).toBe("0x10001");
          expect(cert.pubkey).toBeInstanceOf(Buffer);
          // yes these spaces are intentional
          expect(cert.valid_from).toBe("Sep  6 03:00:49 2025 GMT");
          expect(cert.valid_to).toBe("Sep  4 03:00:49 2035 GMT");
          expect(cert.fingerprint).toBe("D2:5E:B9:AD:8B:48:3B:7A:35:D3:1A:45:BD:32:AC:AD:55:4A:BA:AD");
          expect(cert.fingerprint256).toBe(
            "85:F4:47:0C:6D:D8:DE:C8:68:77:7C:5E:3F:9B:56:A6:D3:69:C7:C2:1A:E8:B8:F8:1C:16:1D:04:78:A0:E9:91",
          );
          expect(cert.fingerprint512).toBe(
            "CE:00:17:97:29:5E:1C:7E:59:86:8D:1F:F0:F4:AF:A0:B0:10:F2:2E:0E:79:D1:32:D0:44:F9:B4:3A:DE:D5:83:A9:15:0E:E4:47:24:D4:2A:10:FB:21:BE:3A:38:21:FC:40:20:B3:BC:52:64:F7:38:93:EF:C9:3F:C8:57:89:31",
          );
          expect(cert.serialNumber).toBe("71A46AE89FD817EF81A34D5973E1DE42F09B9D63");

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

    timeout = setTimeout(closeAndFail, isDebug ? 2000 : 500);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        client = await Bun.connect({
          tls: { ca: COMMON_CERT.cert, serverName: "localhost" },
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

    timeout = setTimeout(closeAndFail, isDebug ? 2000 : 500);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        await Bun.connect({
          tls: { ca: COMMON_CERT.cert, serverName: "localhost" },
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
            tls: { ca: COMMON_CERT.cert, serverName: "localhost" },
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

    timeout = setTimeout(closeAndFail, isDebug ? 2000 : 500);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        client = await Bun.connect({
          tls: { ca: COMMON_CERT.cert, serverName: "localhost" },
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

it("destroying the socket from inside SNICallback or ALPNCallback does not crash the process", async () => {
  // Both callbacks run synchronously from inside the native handshake; a
  // destroy() there must defer the SSL teardown until the handshake call
  // unwinds instead of freeing it out from under BoringSSL.
  const connections: Array<{ destroy(): void }> = [];
  for (const extra of [
    {
      ALPNCallback(this: unknown, { protocols }: { protocols: string[] }) {
        (this as { destroy(): void }).destroy();
        return protocols[0];
      },
    },
    {
      SNICallback(_name: string, cb: (err: Error | null, ctx?: unknown) => void) {
        connections.at(-1)?.destroy();
        cb(null, undefined);
      },
    },
  ]) {
    // Declared above the for-of's iterable so the SNICallback closure (built
    // once when the array literal is evaluated) captures it; reset per case.
    connections.length = 0;
    const server = tls.createServer({ key: cert1.key, cert: cert1.cert, ...extra }, socket => socket.end());
    server.on("connection", socket => connections.push(socket));
    server.on("tlsClientError", () => {});
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>(resolve => {
      const client = tls.connect(
        {
          port,
          rejectUnauthorized: false,
          ALPNProtocols: ["x/1"],
          servername: "x.test",
          checkServerIdentity: () => undefined,
        },
        () => {
          client.end();
          resolve();
        },
      );
      client.on("error", () => resolve());
      client.on("close", () => resolve());
    });
    server.close();
  }
  // Reaching here without an abort/ASAN report is the assertion.
  expect(true).toBe(true);
});

it("leaves socket.authorized false unless a client certificate was requested and verified", async () => {
  // A server that never requested a client certificate must not report the
  // connection as authorized (matches Node.js fail-closed semantics).
  {
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    const server: Server = createServer(COMMON_CERT, socket => {
      resolve(socket.authorized);
      socket.end();
    });
    server.on("error", reject);
    server.listen(0);
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const client = connect({
      port: address.port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
    });
    client.on("error", reject);
    try {
      expect(await promise).toBe(false);
    } finally {
      client.end();
      server.close();
    }
  }

  // The legitimate mutual-TLS case still works: when the server requests a
  // certificate and the client presents one that verifies against the
  // server's CA, the socket is reported as authorized.
  {
    const fixtures = join(import.meta.dir, "fixtures");
    const agent1Key = readFileSync(join(fixtures, "agent1-key.pem"), "utf8");
    const agent1Cert = readFileSync(join(fixtures, "agent1-cert.pem"), "utf8");
    const ca1 = readFileSync(join(fixtures, "ca1-cert.pem"), "utf8");

    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    const server: Server = createServer(
      {
        key: agent1Key,
        cert: agent1Cert,
        ca: [ca1],
        requestCert: true,
        rejectUnauthorized: false,
      },
      socket => {
        resolve(socket.authorized);
        socket.end();
      },
    );
    server.on("error", reject);
    server.listen(0);
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const client = connect({
      port: address.port,
      host: "127.0.0.1",
      key: agent1Key,
      cert: agent1Cert,
      ca: [ca1],
      rejectUnauthorized: false,
    });
    client.on("error", reject);
    try {
      expect(await promise).toBe(true);
    } finally {
      client.end();
      server.close();
    }
  }
});

it("createServer({pfx, requestCert}) verifies client certificates against the pfx-embedded CA", async () => {
  // agent1.pfx bundles agent1's key/cert plus ca1; a server built from it must
  // be able to verify a client certificate signed by that embedded CA.
  const fixtures = join(import.meta.dir, "../test/fixtures/keys");
  const { promise, resolve, reject } = Promise.withResolvers<boolean>();
  const server: Server = createServer(
    {
      pfx: readFileSync(join(fixtures, "agent1.pfx")),
      passphrase: "sample",
      requestCert: true,
      rejectUnauthorized: false,
    },
    socket => {
      resolve(socket.authorized);
      socket.end();
    },
  );
  server.on("error", reject);
  server.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = connect({
    port: address.port,
    host: "127.0.0.1",
    key: readFileSync(join(fixtures, "agent1-key.pem"), "utf8"),
    cert: readFileSync(join(fixtures, "agent1-cert.pem"), "utf8"),
    rejectUnauthorized: false,
  });
  client.on("error", reject);
  try {
    expect(await promise).toBe(true);
  } finally {
    client.end();
    server.close();
  }
});

it("SNICallback errors abort the handshake and surface as tlsClientError", async () => {
  // Node drops the connection before the handshake completes (no TLS alert is
  // sent) and emits 'tlsClientError' on the server with the callback's error.
  const cases: [string, (name: string, cb: (err: Error | null, ctx?: unknown) => void) => void, string][] = [
    ["cb(error)", (_name, cb) => cb(new Error("sni rejected")), "sni rejected"],
    ["invalid context", (_name, cb) => cb(null, {}), "Invalid SNI context"],
    [
      "throw",
      () => {
        throw new Error("sni threw");
      },
      "sni threw",
    ],
  ];
  for (const [label, SNICallback, expectedMessage] of cases) {
    const server: Server = createServer({ ...COMMON_CERT, SNICallback });
    const tlsClientErrors: Error[] = [];
    server.on("tlsClientError", err => tlsClientErrors.push(err));
    server.on("secureConnection", () => {
      throw new Error(`secureConnection must not fire (${label})`);
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const client = connect({ port, host: "127.0.0.1", servername: "a.example.com", rejectUnauthorized: false });
    const [clientErr] = (await once(client, "error")) as [Error];
    // The server dropped the connection before the handshake completed - the
    // client must NOT see a TLS alert error.
    expect(clientErr.message).toMatch(/disconnected before secure TLS connection was established|ECONNRESET/);
    expect(tlsClientErrors.length).toBe(1);
    expect(tlsClientErrors[0].message).toBe(expectedMessage);
    server.close();
    await once(server, "close");
  }
});

it("SNICallback returning no context falls through to the default context", async () => {
  const server: Server = createServer({ ...COMMON_CERT, SNICallback: (_name, cb) => cb(null, null) }, socket => {
    socket.end();
  });
  server.on("tlsClientError", err => {
    throw err;
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({ port, host: "127.0.0.1", servername: "a.example.com", rejectUnauthorized: false });
  await once(client, "secureConnect");
  client.end();
  server.close();
  await once(server, "close");
});

it("ALPNCallback errors refuse the connection and surface as tlsClientError", async () => {
  const cases: [
    string,
    (arg: { servername: string; protocols: string[] }) => string | undefined,
    RegExp | undefined,
    RegExp,
  ][] = [
    [
      "invalid result",
      () => "not-offered",
      /ERR_TLS_ALPN_CALLBACK_INVALID_RESULT/,
      /did not match any of the client's offered protocols/,
    ],
    [
      "throw",
      () => {
        throw new Error("alpn threw");
      },
      undefined,
      /alpn threw/,
    ],
  ];
  for (const [label, ALPNCallback, codeRe, msgRe] of cases) {
    const server: Server = createServer({ ...COMMON_CERT, ALPNCallback });
    const tlsClientErrors: (Error & { code?: string })[] = [];
    server.on("tlsClientError", err => tlsClientErrors.push(err));
    server.on("secureConnection", () => {
      throw new Error(`secureConnection must not fire (${label})`);
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const client = connect({
      port,
      host: "127.0.0.1",
      ALPNProtocols: ["http/1.1", "h2"],
      rejectUnauthorized: false,
    });
    // The client gets the fatal no_application_protocol alert (or sees the
    // connection drop) - either way the connection must fail.
    await once(client, "error");
    expect(tlsClientErrors.length).toBe(1);
    if (codeRe) expect(String(tlsClientErrors[0].code)).toMatch(codeRe);
    expect(tlsClientErrors[0].message).toMatch(msgRe);
    server.close();
    await once(server, "close");
  }
});

it("ALPNCallback returning an offered protocol completes the handshake with it", async () => {
  const server: Server = createServer({ ...COMMON_CERT, ALPNCallback: () => "h2" }, socket => {
    expect((socket as TLSSocket).alpnProtocol).toBe("h2");
    socket.end();
  });
  server.on("tlsClientError", err => {
    throw err;
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({ port, host: "127.0.0.1", ALPNProtocols: ["http/1.1", "h2"], rejectUnauthorized: false });
  await once(client, "secureConnect");
  expect(client.alpnProtocol).toBe("h2");
  client.end();
  server.close();
  await once(server, "close");
});

it("an asynchronous SNICallback suspends the handshake and resumes with the selected context", async () => {
  // The callback resolves on a later tick - the handshake must wait for it
  // (BoringSSL select-certificate retry) instead of falling through to the
  // default context.
  const sniCert = { ...COMMON_CERT };
  let callbackRan = false;
  const server: Server = createServer({
    ...COMMON_CERT,
    SNICallback: (name, cb) => {
      setTimeout(() => {
        callbackRan = true;
        expect(name).toBe("async.example.com");
        cb(null, tls.createSecureContext(sniCert));
      }, 50);
    },
  });
  server.on("secureConnection", socket => {
    expect((socket as TLSSocket).servername).toBe("async.example.com");
    socket.end();
  });
  server.on("tlsClientError", err => {
    throw err;
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({ port, host: "127.0.0.1", servername: "async.example.com", rejectUnauthorized: false });
  await once(client, "secureConnect");
  expect(callbackRan).toBe(true);
  client.end();
  await once(client, "close");
  server.close();
  await once(server, "close");
});

it("an asynchronous SNICallback error aborts the suspended handshake with tlsClientError", async () => {
  const server: Server = createServer({
    ...COMMON_CERT,
    SNICallback: (_name, cb) => {
      setTimeout(() => cb(new Error("async sni rejected")), 50);
    },
  });
  const tlsClientErrors: Error[] = [];
  server.on("tlsClientError", err => tlsClientErrors.push(err));
  server.on("secureConnection", () => {
    throw new Error("secureConnection must not fire");
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({ port, host: "127.0.0.1", servername: "rejected.example.com", rejectUnauthorized: false });
  await once(client, "error");
  expect(tlsClientErrors.length).toBe(1);
  expect(tlsClientErrors[0].message).toBe("async sni rejected");
  server.close();
  await once(server, "close");
});

it("destroying the connection while an asynchronous SNICallback is pending does not crash", async () => {
  let resolveLater: (() => void) | undefined;
  const server: Server = createServer({
    ...COMMON_CERT,
    SNICallback: (_name, cb) => {
      // Resolve only after the client is long gone.
      resolveLater = () => cb(null, tls.createSecureContext({ ...COMMON_CERT }));
    },
  });
  server.on("tlsClientError", () => {});
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({ port, host: "127.0.0.1", servername: "gone.example.com", rejectUnauthorized: false });
  client.on("error", () => {});
  // Give the ClientHello time to reach the server and suspend, then kill the client.
  await new Promise(r => setTimeout(r, 100));
  client.destroy();
  await new Promise(r => setTimeout(r, 100));
  // The late resolution must be a harmless no-op.
  resolveLater?.();
  await new Promise(r => setTimeout(r, 100));
  server.close();
  await once(server, "close");
  expect(true).toBe(true);
});

it("SNICallback accepts a raw native context (Node's context.context || context)", async () => {
  // cb(null, secureContext.context) - passing the unwrapped native context -
  // must select it, same as passing the wrapper.
  const server: Server = createServer({
    ...COMMON_CERT,
    SNICallback: (_name, cb) => {
      cb(null, (tls.createSecureContext(COMMON_CERT) as any).context);
    },
  });
  server.on("secureConnection", socket => socket.end());
  server.on("tlsClientError", err => {
    throw err;
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({ port, host: "127.0.0.1", servername: "raw.example.com", rejectUnauthorized: false });
  await once(client, "secureConnect");
  expect(client.authorized).toBe(false); // self-signed, but the handshake completed
  client.end();
  await once(client, "close");
  server.close();
  await once(server, "close");
});

it("SNICallback runs even when the requested servername matches the bind hostname", async () => {
  // Node calls a user SNICallback for every SNI; the listener's own bind
  // hostname being pre-registered internally must not shadow it. The callback
  // selects a DIFFERENT certificate (the RSA fixture) than the server's own
  // (COMMON_CERT), and the client must actually receive the callback's pick -
  // not just observe that the callback ran while the internal entry's cert
  // got presented anyway.
  let sniCalls = 0;
  const sniCert = tls.createSecureContext({ key: rawKey, cert: cert });
  const server: Server = createServer({
    ...COMMON_CERT,
    SNICallback: (name, cb) => {
      sniCalls++;
      expect(name).toBe("localhost");
      cb(null, sniCert);
    },
  });
  server.on("secureConnection", socket => socket.end());
  server.on("tlsClientError", err => {
    throw err;
  });
  server.listen(0, "localhost");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  // host: "localhost" defaults servername to "localhost" - the bind hostname.
  const client = connect({ port, host: "localhost", rejectUnauthorized: false });
  await once(client, "secureConnect");
  expect(sniCalls).toBe(1);
  // The peer certificate must be the SNICallback's RSA cert, not COMMON_CERT.
  const peerCert = client.getPeerCertificate();
  const expectedCert = new crypto.X509Certificate(cert);
  expect(peerCert.fingerprint256).toBe(expectedCert.fingerprint256);
  client.end();
  await once(client, "close");
  server.close();
  await once(server, "close");
});

it("setSecureContext() clears omitted options instead of keeping stale values", async () => {
  const server: Server = createServer({
    ...COMMON_CERT,
    ca: [COMMON_CERT.cert],
    ciphers: "TLS_AES_256_GCM_SHA384",
  });
  expect((server as any).ca).toEqual([COMMON_CERT.cert]);
  expect((server as any).ciphers).toBe("TLS_AES_256_GCM_SHA384");
  // Replacing the context without ca/ciphers must clear them (Node resets
  // omitted fields), not silently keep the previous call's values.
  server.setSecureContext({ ...COMMON_CERT });
  expect((server as any).ca).toBeUndefined();
  expect((server as any).ciphers).toBeUndefined();
  expect((server as any).cert).toBe(COMMON_CERT.cert);
  expect((server as any).key).toBe(COMMON_CERT.key);
});

it("SNICallback rejecting with a non-Error value drops the connection (no hang)", async () => {
  // cb(true) / cb("reason"): Node treats any truthy err as an abort. The
  // boolean form must not be confused with internal sentinels - the
  // connection is dropped, not suspended.
  for (const rejection of [true, "rejected", "throw"] as const) {
    const server: Server = createServer({
      ...COMMON_CERT,
      SNICallback: (_name, cb) => {
        // "throw" exercises the synchronous-throw path (throw true), which
        // must be normalized the same way as cb(non-Error).
        if (rejection === "throw") throw true;
        cb(rejection as any);
      },
    });
    const clientErrors: Error[] = [];
    server.on("tlsClientError", err => clientErrors.push(err));
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const client = connect({ port, host: "127.0.0.1", servername: "reject.example.com", rejectUnauthorized: false });
    const [err] = await once(client, "error");
    expect((err as Error).message).toMatch(/disconnected before secure|ECONNRESET/);
    expect(clientErrors.length).toBe(1);
    server.close();
    await once(server, "close");
  }
});

it("an asynchronous SNICallback resolving cb(null, null) falls back like the synchronous form", async () => {
  // Async null selection must take the same fallback path as sync null - the
  // handshake completes with the server's own certificate.
  const server: Server = createServer({
    ...COMMON_CERT,
    SNICallback: (_name, cb) => {
      setTimeout(() => cb(null, null as any), 30);
    },
  });
  server.on("secureConnection", socket => socket.end());
  server.on("tlsClientError", err => {
    throw err;
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({ port, host: "127.0.0.1", servername: "fallback.example.com", rejectUnauthorized: false });
  await once(client, "secureConnect");
  const expectedCert = new crypto.X509Certificate(COMMON_CERT.cert);
  expect(client.getPeerCertificate().fingerprint256).toBe(expectedCert.fingerprint256);
  client.end();
  await once(client, "close");
  server.close();
  await once(server, "close");
});

it("an asynchronous SNICallback resolving cb(null, null) still honors addContext entries", async () => {
  // The async-null fallback must consult the static SNI tree with the
  // servername, not just fall to the default context: addContext's cert is
  // the one the client must receive.
  const altCert = { key: rawKey, cert: cert };
  const server: Server = createServer({
    ...COMMON_CERT,
    SNICallback: (_name, cb) => {
      setTimeout(() => cb(null, null as any), 30);
    },
  });
  server.addContext("alt.example.com", altCert);
  server.on("secureConnection", socket => socket.end());
  server.on("tlsClientError", err => {
    throw err;
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = connect({ port, host: "127.0.0.1", servername: "alt.example.com", rejectUnauthorized: false });
  await once(client, "secureConnect");
  const expectedCert = new crypto.X509Certificate(cert);
  expect(client.getPeerCertificate().fingerprint256).toBe(expectedCert.fingerprint256);
  client.end();
  await once(client, "close");
  server.close();
  await once(server, "close");
});

describe("tls.Server socket destroySoon", () => {
  // destroySoon() after end(big) must deliver every byte even when the TLS write
  // batcher's final flush spills (#31584). The spill/kernel-buffer race hits ~4% of
  // connections at this payload, so loop (mirrors test-tls-client-destroy-soon.js).
  it("delivers the whole stream when destroySoon follows end", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, "Y");
    for (let i = 0; i < 64; i++) {
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      const server = createServer(COMMON_CERT, socket => {
        socket.on("error", reject);
        socket.end(big);
        socket.destroySoon();
      });
      server.on("error", reject);
      let client: TLSSocket | undefined;
      server.listen(0, () => {
        const c = connect({ port: (server.address() as AddressInfo).port, rejectUnauthorized: false }, () => {
          let bytesRead = 0;
          c.on("readable", () => {
            let d;
            while ((d = c.read()) !== null) bytesRead += d.length;
          });
          c.on("end", () => resolve(bytesRead));
        });
        c.on("error", reject);
        client = c;
      });
      try {
        expect({ iteration: i, bytesRead: await promise }).toEqual({ iteration: i, bytesRead: big.length });
      } finally {
        client?.destroy();
        server.close();
      }
    }
  });
});

it("tls.createServer honors secureOptions when negotiating the protocol version", async () => {
  const server: Server = createServer({ ...COMMON_CERT, secureOptions: crypto.constants.SSL_OP_NO_TLSv1_3 });
  const accepted = Promise.withResolvers<void>();
  server.on("secureConnection", socket => {
    accepted.resolve();
    socket.end();
  });
  server.on("tlsClientError", accepted.reject);
  server.listen(0);
  await once(server, "listening");
  let client: TLSSocket | undefined;
  try {
    const port = (server.address() as AddressInfo).port;
    client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    await once(client, "secureConnect");
    await accepted.promise;
    expect(client.getProtocol()).toBe("TLSv1.2");
  } finally {
    client?.destroy();
    server.close();
  }
  await once(server, "close");
});

it("tls.connect honors secureOptions when negotiating the protocol version", async () => {
  const server: Server = createServer(COMMON_CERT);
  server.on("secureConnection", socket => socket.end());
  server.listen(0);
  await once(server, "listening");
  let baseline: TLSSocket | undefined;
  let client: TLSSocket | undefined;
  try {
    const port = (server.address() as AddressInfo).port;
    baseline = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    await once(baseline, "secureConnect");
    expect(baseline.getProtocol()).toBe("TLSv1.3");

    client = connect({
      port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
      secureOptions: crypto.constants.SSL_OP_NO_TLSv1_3,
    });
    await once(client, "secureConnect");
    expect(client.getProtocol()).toBe("TLSv1.2");
  } finally {
    baseline?.destroy();
    client?.destroy();
    server.close();
  }
  await once(server, "close");
});

describe("tls.createServer pauseOnConnect", () => {
  it("completes the TLS handshake and delivers the socket paused", async () => {
    const server: Server = createServer({ ...COMMON_CERT, pauseOnConnect: true });
    const accepted = Promise.withResolvers<{ paused: boolean; flowing: boolean | null; socket: TLSSocket }>();
    server.on("secureConnection", s => {
      accepted.resolve({ paused: s.isPaused(), flowing: s.readableFlowing, socket: s });
    });
    server.on("tlsClientError", accepted.reject);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let cli: TLSSocket | undefined;
    let srv: TLSSocket | undefined;
    try {
      const port = (server.address() as AddressInfo).port;
      cli = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      // Before the fix this hung: onconnection paused the native handle, so the
      // TLS engine never saw the ClientHello.
      await once(cli, "secureConnect");
      const { paused, flowing, socket } = await accepted.promise;
      srv = socket;
      expect({ paused, flowing }).toEqual({ paused: true, flowing: false });

      let got = "";
      let stopped = true;
      srv.on("data", d => {
        if (stopped) throw new Error("data event fired while paused");
        got += d;
      });
      cli.write("hello");
      // Barrier: a round-trip the other way proves the client's write has
      // traversed the event loop on the server side while still paused.
      srv.write("ack");
      await once(cli, "data");
      expect({ got, flowing: srv.readableFlowing, readableLength: srv.readableLength }).toEqual({
        got: "",
        flowing: false,
        readableLength: 5,
      });
      stopped = false;
      const dataP = once(srv, "data");
      srv.resume();
      await dataP;
      expect(got).toBe("hello");
    } finally {
      cli?.destroy();
      srv?.destroy();
      server.close();
    }
    await once(server, "close");
  });

  it("honors resume() made inside the secureConnection handler", async () => {
    const server: Server = createServer({ ...COMMON_CERT, pauseOnConnect: true });
    const accepted = Promise.withResolvers<TLSSocket>();
    server.on("secureConnection", s => {
      s.resume();
      accepted.resolve(s);
    });
    server.on("tlsClientError", accepted.reject);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let cli: TLSSocket | undefined;
    let srv: TLSSocket | undefined;
    try {
      const port = (server.address() as AddressInfo).port;
      cli = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      await once(cli, "secureConnect");
      srv = await accepted.promise;
      expect({ paused: srv.isPaused(), flowing: srv.readableFlowing }).toEqual({ paused: false, flowing: true });

      let got = "";
      srv.on("data", d => (got += d));
      cli.write("hello");
      await once(srv, "data");
      expect(got).toBe("hello");
    } finally {
      cli?.destroy();
      srv?.destroy();
      server.close();
    }
    await once(server, "close");
  });
});
