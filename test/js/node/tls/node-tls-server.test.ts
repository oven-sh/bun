import crypto from "crypto";
import { readFileSync, realpathSync } from "fs";
import { bunEnv, bunExe, tls as cert1, isDebug } from "harness";
import net, { AddressInfo } from "net";
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

    //should be faster than 100ms (debug + asan needs more headroom for the cold listen)
    timeout = setTimeout(closeAndFail, isDebug ? 2000 : 100);
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

it("handshakeTimeout applies to sockets handed in via server.emit('connection')", async () => {
  // Node's connection listener arms the server handshakeTimeout on every wrap
  // it creates, including the STARTTLS pattern, and the tlsClientError
  // listener owns the socket (wrap.js#L961-L962, #L1052-L1058, #L1267).
  const tlsServer: Server = createServer({ ...COMMON_CERT, handshakeTimeout: 50 });
  const clientError = Promise.withResolvers<[Error & { code?: string }, TLSSocket]>();
  tlsServer.on("tlsClientError", (err, sock) => clientError.resolve([err, sock as TLSSocket]));
  const netServer = net.createServer(raw => tlsServer.emit("connection", raw));
  let stalled: net.Socket | undefined;
  try {
    netServer.listen(0, "127.0.0.1");
    await once(netServer, "listening");
    stalled = net.connect((netServer.address() as AddressInfo).port, "127.0.0.1");
    stalled.on("error", () => {});
    const [error, wrapped] = await clientError.promise;
    expect(error.code).toBe("ERR_TLS_HANDSHAKE_TIMEOUT");
    expect(wrapped.destroyed).toBe(false);
  } finally {
    stalled?.destroy();
    netServer.close();
    tlsServer.close();
  }
});

it("a timed-out connection that the peer then closes reports tlsClientError once", async () => {
  // Node latches the per-socket server report (kErrorEmitted,
  // wrap.js#L1234-L1257): the disconnect after a reported handshake timeout
  // must not surface a second tlsClientError.
  const server: Server = createServer({ ...COMMON_CERT, handshakeTimeout: 50 });
  const errors: string[] = [];
  const firstError = Promise.withResolvers<TLSSocket>();
  server.on("tlsClientError", (err: Error & { code?: string }, sock) => {
    errors.push(err.code ?? err.message);
    firstError.resolve(sock as TLSSocket);
  });
  let stalled: net.Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    stalled = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    stalled.on("error", () => {});
    const serverSide = await firstError.promise;
    const closed = once(serverSide, "close");
    stalled.destroy(); // the peer goes away after the timeout was reported
    await closed;
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    expect(errors).toEqual(["ERR_TLS_HANDSHAKE_TIMEOUT"]);
  } finally {
    stalled?.destroy();
    server.close();
  }
});

it("handshakeTimeout reports a stalled natively-accepted client through tlsClientError", async () => {
  const server: Server = createServer({ ...COMMON_CERT, handshakeTimeout: 50 });
  const clientError = Promise.withResolvers<[Error & { code?: string }, TLSSocket]>();
  server.on("tlsClientError", (err, sock) => clientError.resolve([err, sock as TLSSocket]));
  let stalled: net.Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    stalled = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    stalled.on("error", () => {});
    const [error, sock] = await clientError.promise;
    expect(error.code).toBe("ERR_TLS_HANDSHAKE_TIMEOUT");
    // Node leaves the timed-out socket to the tlsClientError listener.
    expect(sock.destroyed).toBe(false);
  } finally {
    stalled?.destroy();
    server.close();
  }
});

describe("tls.Server secure-context options", () => {
  // agent6-cert.pem is the agent6 leaf followed by the ca3 intermediate that
  // signed it (the chain continues to the ca1 root, which is NOT loaded here).
  const agent6Key = readFileSync(join(import.meta.dir, "fixtures", "agent6-key.pem"), "utf8");
  const agent6CertChain = readFileSync(join(import.meta.dir, "fixtures", "agent6-cert.pem"), "utf8");
  const [agent6Leaf, ca3Cert] = agent6CertChain.split(/(?=-----BEGIN CERTIFICATE-----)/);
  // ca3 is an intermediate signed by the self-signed root ca1: verifying the
  // agent6 client chain needs both unless allowPartialTrustChain is set.
  const ca1Cert = readFileSync(join(import.meta.dir, "fixtures", "ca1-cert.pem"), "utf8");

  // Completes one handshake and reports how the server judged the client.
  // Every failure path (server error, client error or early client close)
  // rejects so a handshake regression fails fast instead of timing out.
  // `tlsClientError` is intentionally not wired here: it also fires for a
  // failed verification that `rejectUnauthorized: false` then admits.
  async function handshake(serverOptions: tls.TlsOptions, clientOptions: tls.ConnectionOptions = {}) {
    const server = createServer(serverOptions);
    const peer = Promise.withResolvers<TLSSocket>();
    server.on("secureConnection", peer.resolve);
    server.on("error", peer.reject);
    let client: TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("listening", listening.resolve);
      server.listen(0, "127.0.0.1");
      await Promise.race([listening.promise, peer.promise]);
      const connected = Promise.withResolvers<void>();
      client = connect(
        {
          port: (server.address() as AddressInfo).port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
          ...clientOptions,
        },
        connected.resolve,
      );
      client.on("error", connected.reject);
      client.on("close", () => connected.reject(new Error("client closed before completing the handshake")));
      await connected.promise;
      const serverSide = await peer.promise;
      return { authorized: serverSide.authorized, authorizationError: serverSide.authorizationError };
    } finally {
      client?.destroy();
      server.close();
    }
  }

  it("forwards allowPartialTrustChain so an intermediate in `ca` is a valid trust anchor", async () => {
    // The client's chain stops at the ca3 intermediate. A server trusting
    // only ca3 (not the ca1 root) rejects it unless allowPartialTrustChain
    // turns certificates in the store into acceptable trust anchors.
    const serverOptions = {
      key: agent6Key,
      cert: agent6CertChain,
      ca: [ca3Cert],
      requestCert: true,
      rejectUnauthorized: false,
    };
    const clientIdentity = { key: agent6Key, cert: agent6Leaf };
    const without = await handshake(serverOptions, clientIdentity);
    expect(without).toEqual({ authorized: false, authorizationError: "UNABLE_TO_GET_ISSUER_CERT" as any });
    const withFlag = await handshake({ ...serverOptions, allowPartialTrustChain: true }, clientIdentity);
    expect(withFlag).toEqual({ authorized: true, authorizationError: null as any });
    // Node only does a truthy check on the option, so a non-boolean truthy
    // value must behave like `true` instead of tripping the strict native
    // converter: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L186
    const withTruthy = await handshake({ ...serverOptions, allowPartialTrustChain: 1 as any }, clientIdentity);
    expect(withTruthy).toEqual({ authorized: true, authorizationError: null as any });
    expect(() => tls.createSecureContext({ allowPartialTrustChain: 1 as any })).not.toThrow();
  });

  it("requests the client certificate on a STARTTLS-wrapped connection (server.emit('connection'))", async () => {
    // A wrapped (non-listener) server socket must apply requestCert per
    // socket, like Node's TLSWrap::SetVerifyMode, or an mTLS STARTTLS server
    // never sends a CertificateRequest on the initial handshake:
    // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1225-L1234
    const tlsServer = createServer({
      key: agent6Key,
      cert: agent6CertChain,
      ca: [ca3Cert, ca1Cert],
      requestCert: true,
      rejectUnauthorized: false,
    });
    const judged = Promise.withResolvers<{ authorized: boolean; hasPeerCert: boolean }>();
    tlsServer.on("secureConnection", s => {
      judged.resolve({ authorized: s.authorized, hasPeerCert: !!s.getPeerCertificate()?.subject });
      s.end();
    });
    tlsServer.on("tlsClientError", judged.reject);
    const rawServer = net.createServer(raw => tlsServer.emit("connection", raw));
    let client: TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      rawServer.once("listening", listening.resolve);
      rawServer.once("error", listening.reject);
      rawServer.listen(0, "127.0.0.1");
      await listening.promise;
      const connected = Promise.withResolvers<void>();
      client = connect(
        {
          port: (rawServer.address() as AddressInfo).port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
          key: agent6Key,
          cert: agent6Leaf,
        },
        connected.resolve,
      );
      client.on("error", connected.reject);
      await connected.promise;
      expect(await judged.promise).toEqual({ authorized: true, hasPeerCert: true });
    } finally {
      client?.destroy();
      rawServer.close();
      tlsServer.close();
    }
  });

  it("accepts a cert-less client on a STARTTLS-wrapped connection when the server has `ca` but no requestCert", async () => {
    // A shared SecureContext built with `ca` carries FAIL_IF_NO_PEER_CERT on
    // its SSL_CTX; Node's TLSWrap::SetVerifyMode overrides it per socket to
    // SSL_VERIFY_NONE for !requestCert, so an ordinary client still connects:
    // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1225-L1234
    const tlsServer = createServer({ key: agent6Key, cert: agent6CertChain, ca: [ca3Cert, ca1Cert] });
    const judged = Promise.withResolvers<{ secure: boolean }>();
    tlsServer.on("secureConnection", s => {
      judged.resolve({ secure: true });
      s.end();
    });
    tlsServer.on("tlsClientError", judged.reject);
    const rawServer = net.createServer(raw => tlsServer.emit("connection", raw));
    let client: TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      rawServer.once("listening", listening.resolve);
      rawServer.once("error", listening.reject);
      rawServer.listen(0, "127.0.0.1");
      await listening.promise;
      const connected = Promise.withResolvers<void>();
      // No client key/cert: the handshake must still complete.
      client = connect(
        { port: (rawServer.address() as AddressInfo).port, host: "127.0.0.1", rejectUnauthorized: false },
        connected.resolve,
      );
      client.on("error", connected.reject);
      await connected.promise;
      expect(await judged.promise).toEqual({ secure: true });
    } finally {
      client?.destroy();
      rawServer.close();
      tlsServer.close();
    }
  });

  it("a STARTTLS wrap does not decrement or spuriously close the never-listened tls.Server", async () => {
    // Node counts only natively accepted sockets: server.emit('connection')
    // never increments _connections, and _destroy decrements _server (which the
    // wrap does not set), so a STARTTLS-only tls.Server must never emit 'close'
    // on its own: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L912-L918
    const tlsServer = createServer({ key: agent6Key, cert: agent6CertChain }, s => s.end());
    const closes: number[] = [];
    tlsServer.on("close", () => closes.push(1));
    // The decrement under test runs in the server-side wrap's _destroy, so
    // await that exact socket's 'close' rather than a proxy for it.
    const wrapClosed = Promise.withResolvers<void>();
    tlsServer.once("secureConnection", s => {
      s.once("close", wrapClosed.resolve);
      s.once("error", wrapClosed.reject);
    });
    const rawServer = net.createServer(raw => tlsServer.emit("connection", raw));
    let client: TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      rawServer.once("listening", listening.resolve);
      rawServer.once("error", listening.reject);
      rawServer.listen(0, "127.0.0.1");
      await listening.promise;
      client = connect(
        { port: (rawServer.address() as AddressInfo).port, host: "127.0.0.1", rejectUnauthorized: false },
        () => client!.end(),
      );
      client.on("error", wrapClosed.reject);
      await wrapClosed.promise;
      // One tick so _emitCloseIfDrained's nextTick'd spurious 'close' (the bug)
      // would have fired before the assertion.
      await new Promise(resolve => setImmediate(resolve));
      expect({ closes, connections: tlsServer._connections }).toEqual({ closes: [], connections: 0 });
    } finally {
      client?.destroy();
      rawServer.close();
      tlsServer.close();
    }
  });

  it("requests the client certificate on a direct server wrap whose secure context lacks requestCert", async () => {
    // The shared SecureContext carries no requestCert, so only the per-socket
    // option on the wrap can make the CertificateRequest go out - Node applies
    // it per socket in TLSWrap::SetVerifyMode:
    // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1225-L1234
    // (`authorized` is not asserted: Node only computes it for sockets owned
    // by a tls.Server, so a standalone wrap keeps the _init default.)
    const secureContext = tls.createSecureContext({
      key: agent6Key,
      cert: agent6CertChain,
      ca: [ca3Cert, ca1Cert],
    });
    const judged = Promise.withResolvers<{ hasPeerCert: boolean; authorizationError: unknown }>();
    const rawServer = net.createServer(raw => {
      const wrapped = new TLSSocket(raw, {
        isServer: true,
        secureContext,
        requestCert: true,
        rejectUnauthorized: false,
      });
      wrapped.on("secure", () => {
        judged.resolve({
          hasPeerCert: !!wrapped.getPeerCertificate()?.subject,
          authorizationError: wrapped.authorizationError,
        });
        wrapped.end();
      });
      wrapped.on("error", judged.reject);
    });
    let client: TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      rawServer.once("listening", listening.resolve);
      rawServer.once("error", listening.reject);
      rawServer.listen(0, "127.0.0.1");
      await listening.promise;
      const connected = Promise.withResolvers<void>();
      client = connect(
        {
          port: (rawServer.address() as AddressInfo).port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
          key: agent6Key,
          cert: agent6Leaf,
        },
        connected.resolve,
      );
      client.on("error", connected.reject);
      await connected.promise;
      expect(await judged.promise).toEqual({ hasPeerCert: true, authorizationError: null });
    } finally {
      client?.destroy();
      rawServer.close();
    }
  });

  it("surfaces a natively-rejected key on the server 'error' event for a STARTTLS-only server", async () => {
    // Node throws this from tls.createServer() itself; bun builds the context
    // lazily and reports native load failures on the server 'error' event at
    // listen() time, so the STARTTLS wrap must use that same surface instead
    // of throwing synchronously out of the user's server.emit('connection').
    const tlsServer = createServer({ key: "not a private key", cert: agent6CertChain });
    const surfaced = Promise.withResolvers<Error & { code?: string }>();
    tlsServer.on("error", surfaced.resolve);
    const emitted: string[] = [];
    let raw: net.Socket | undefined;
    const rawServer = net.createServer(sock => {
      raw = sock;
      try {
        tlsServer.emit("connection", sock);
        emitted.push("returned");
      } catch (e) {
        emitted.push("threw");
        surfaced.resolve(e as Error);
      }
    });
    let client: net.Socket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      rawServer.once("error", listening.reject);
      rawServer.listen(0, "127.0.0.1", listening.resolve);
      await listening.promise;
      client = net.connect((rawServer.address() as AddressInfo).port, "127.0.0.1");
      client.on("error", () => {});
      const err = await surfaced.promise;
      expect({ emitted, code: err.code, rawDestroyed: raw!.destroyed }).toEqual({
        emitted: ["returned"],
        code: "ERR_OSSL_PEM_NO_START_LINE",
        rawDestroyed: true,
      });
    } finally {
      client?.destroy();
      rawServer.close();
      tlsServer.close();
    }
  });

  it("a failing setSecureContext() leaves the STARTTLS wrap credentials untouched", async () => {
    // `ciphers: "@SECLEVEL=3"` is only rejected by the LATE cipher-content
    // validator, after every option field would already have been assigned; a
    // torn call must not let the wrap serve the rejected certificate.
    const tlsServer = createServer({ key: agent6Key, cert: agent6CertChain });
    expect(() =>
      tlsServer.setSecureContext({ key: COMMON_CERT.key, cert: COMMON_CERT.cert, ciphers: "@SECLEVEL=3" }),
    ).toThrow(/INVALID_COMMAND/);
    const originalFingerprint = new crypto.X509Certificate(agent6CertChain).fingerprint256;
    const judged = Promise.withResolvers<void>();
    tlsServer.on("secureConnection", s => {
      judged.resolve();
      s.end();
    });
    tlsServer.on("tlsClientError", judged.reject);
    const rawServer = net.createServer(raw => tlsServer.emit("connection", raw));
    let client: TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      rawServer.once("error", listening.reject);
      rawServer.listen(0, "127.0.0.1", listening.resolve);
      await listening.promise;
      const connected = Promise.withResolvers<void>();
      client = connect(
        {
          port: (rawServer.address() as AddressInfo).port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        connected.resolve,
      );
      client.on("error", connected.reject);
      await connected.promise;
      await judged.promise;
      // The wrap must present the certificate from BEFORE the rejected call.
      expect(client.getPeerCertificate().fingerprint256).toBe(originalFingerprint);
    } finally {
      client?.destroy();
      rawServer.close();
      tlsServer.close();
    }
  });

  it("accepts a key given as [{ pem }] like tls.createSecureContext does", async () => {
    const { authorized } = await handshake({ key: [{ pem: agent6Key }], cert: agent6CertChain });
    expect(authorized).toBe(false);
  });

  it("accepts a key given as [{ pem, passphrase }]", async () => {
    const { authorized } = await handshake({ key: [{ pem: passKey, passphrase: "password" }] as any, cert });
    expect(authorized).toBe(false);
  });

  it("accepts sessionTimeout: null like Node", async () => {
    const { authorized } = await handshake({ key: agent6Key, cert: agent6CertChain, sessionTimeout: null } as any);
    expect(authorized).toBe(false);
  });

  it("still rejects an unverifiable client certificate when rejectUnauthorized is 0", async () => {
    // The server trusts no CA, so the client certificate cannot be verified;
    // Node's `rejectUnauthorized !== false` rule makes 0 behave like true and
    // the connection must be torn down before 'secureConnection'.
    const server = createServer(
      { key: agent6Key, cert: agent6CertChain, requestCert: true, rejectUnauthorized: 0 as any },
      s => s.end(),
    );
    let sawSecureConnection = false;
    server.on("secureConnection", () => (sawSecureConnection = true));
    let client: TLSSocket | undefined;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const closed = Promise.withResolvers<void>();
      client = connect({
        port: (server.address() as AddressInfo).port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
        key: agent6Key,
        cert: agent6Leaf,
      });
      client.on("error", () => {}); // the server resets the connection
      client.on("close", closed.resolve);
      await closed.promise;
      expect(sawSecureConnection).toBe(false);
    } finally {
      client?.destroy();
      server.close();
    }
    // Control: the same configuration with a CA that verifies the client
    // completes and authorizes, proving the rejection above is the
    // certificate-verification path and not some other handshake abort.
    const control = await handshake(
      {
        key: agent6Key,
        cert: agent6CertChain,
        ca: [ca3Cert, ca1Cert],
        requestCert: true,
        rejectUnauthorized: 0 as any,
      },
      { key: agent6Key, cert: agent6Leaf },
    );
    expect(control).toEqual({ authorized: true, authorizationError: null as any });
  });
});

it("destroys a server wrap whose socket was destroyed before the deferred upgrade ran", async () => {
  // Node adopts the socket synchronously, so a same-tick destroy of the
  // underlying connection still surfaces as 'close' on the wrap; the deferred
  // upgrade must not leave a TLSSocket that never emits it.
  const rawServer = net.createServer(() => {});
  let conn: import("node:net").Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    rawServer.once("listening", listening.resolve);
    rawServer.once("error", listening.reject);
    rawServer.listen(0, "127.0.0.1");
    await listening.promise;
    conn = net.connect((rawServer.address() as AddressInfo).port, "127.0.0.1");
    const connected = Promise.withResolvers<void>();
    conn.once("connect", connected.resolve);
    conn.once("error", connected.reject);
    await connected.promise;
    const wrapped = new TLSSocket(conn, {
      isServer: true,
      secureContext: tls.createSecureContext(COMMON_CERT),
    });
    const closed = Promise.withResolvers<void>();
    wrapped.on("close", closed.resolve);
    conn.destroy();
    await closed.promise;
    expect(wrapped.destroyed).toBe(true);
  } finally {
    conn?.destroy();
    rawServer.close();
  }
});

it("exposes the server-side peer verification result via socket.ssl.verifyError()", async () => {
  // Node's server path consults the same TLSWrap.verifyError() that clients
  // use, so the shim must be populated for server sockets too:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1216-L1218
  const fixtures = join(import.meta.dir, "fixtures");
  const agent6Key = readFileSync(join(fixtures, "agent6-key.pem"), "utf8");
  const agent6CertChain = readFileSync(join(fixtures, "agent6-cert.pem"), "utf8");
  const [agent6Leaf, ca3Cert] = agent6CertChain.split(/(?=-----BEGIN CERTIFICATE-----)/);
  const ca1Cert = readFileSync(join(fixtures, "ca1-cert.pem"), "utf8");
  const run = async (serverCa: string[], clientCert: object) => {
    const server = createServer({
      key: agent6Key,
      cert: agent6CertChain,
      ca: serverCa,
      requestCert: true,
      rejectUnauthorized: false,
    });
    const judged = Promise.withResolvers<{ verifyCode: unknown; authorizationError: unknown }>();
    server.on("secureConnection", s => {
      const error = (s as unknown as { ssl: { verifyError(): (Error & { code?: string }) | null } }).ssl.verifyError();
      judged.resolve({ verifyCode: error === null ? null : error.code, authorizationError: s.authorizationError });
      s.end();
    });
    server.on("tlsClientError", judged.reject);
    let socket: TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("listening", listening.resolve);
      server.once("error", listening.reject);
      server.listen(0, "127.0.0.1");
      await listening.promise;
      const connected = Promise.withResolvers<void>();
      socket = connect(
        {
          port: (server.address() as AddressInfo).port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
          ...clientCert,
        },
        connected.resolve,
      );
      socket.on("error", connected.reject);
      await connected.promise;
      return await judged.promise;
    } finally {
      socket?.destroy();
      server.close();
    }
  };
  // A verifiable client certificate reports an explicit null, like Node.
  expect(await run([ca3Cert, ca1Cert], { key: agent6Key, cert: agent6CertChain })).toEqual({
    verifyCode: null,
    authorizationError: null,
  });
  // An unverifiable one reports the same code authorizationError carries.
  // The server lacks the client chain's intermediate, so it cannot verify it.
  const failed = await run([ca1Cert], { key: agent6Key, cert: agent6Leaf });
  expect(failed.verifyCode).toBe(failed.authorizationError);
  expect(typeof failed.verifyCode).toBe("string");
});

// Follow-ups to the node v26.3.0 review of the tls test-suite sync: each case
// below is a divergence from node's own lib/internal/tls/wrap.js that the
// vendored suite does not cover, verified against a built v26.3.0 binary.
describe("node v26.3.0 tls.Server parity follow-ups", () => {
  const listen = async (server: Server) => {
    const listening = Promise.withResolvers<void>();
    server.once("listening", listening.resolve);
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1");
    await listening.promise;
    return (server.address() as AddressInfo).port;
  };

  // node's TLSSocket constructor wraps the handle synchronously (_wrapHandle),
  // so a banner written in the same tick as the wrap is buffered and flushed
  // after the handshake:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L590-L608
  it("delivers a write issued in the same tick as a server-side TLSSocket wrap", async () => {
    const raw = net.createServer();
    const port = await listen(raw as unknown as Server);
    const wrapped = Promise.withResolvers<void>();
    let secured: TLSSocket | undefined;
    raw.on("connection", socket => {
      secured = new TLSSocket(socket, { isServer: true, ...COMMON_CERT });
      // Same tick as the constructor - no await, no nextTick.
      secured.write("banner");
      secured.on("error", wrapped.reject);
      secured.on("secure", () => wrapped.resolve());
    });
    let client: TLSSocket | undefined;
    try {
      client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      const received = Promise.withResolvers<string>();
      client.on("error", received.reject);
      client.once("data", chunk => received.resolve(chunk.toString()));
      expect(await received.promise).toBe("banner");
      await wrapped.promise;
    } finally {
      client?.destroy();
      secured?.destroy();
      raw.close();
    }
  });

  // node's server TLSSocket is manualStart: initRead() only read(0)s the
  // handle, so readableFlowing stays null and bytes that arrive before a
  // 'data' listener attaches are buffered rather than dropped.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L502-L524
  it("buffers post-handshake bytes for a 'data' listener attached after an await", async () => {
    const server = createServer(COMMON_CERT);
    const observed = Promise.withResolvers<{ flowing: unknown; body: string }>();
    let accepted: TLSSocket | undefined;
    server.on("secureConnection", async socket => {
      accepted = socket;
      // A force-resumed socket emits its bytes before this handler can ask for
      // them; a manualStart one buffers them until the first read.
      const flowing = socket.readableFlowing;
      await once(socket, "readable");
      observed.resolve({ flowing, body: socket.read().toString() });
    });
    let client: TLSSocket | undefined;
    try {
      const port = await listen(server);
      client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
        client!.write("early-bytes");
      });
      client.on("error", observed.reject);
      // node reports null here, not false: the socket was never resumed.
      expect(await observed.promise).toEqual({ flowing: null, body: "early-bytes" });
    } finally {
      client?.destroy();
      accepted?.destroy();
      server.close();
    }
  });

  // A handshake that never completes is destroyed *with* the error, so 'close'
  // reports hadError === true, and the internal 'error' listener node installs
  // in _init keeps that from becoming an uncaught exception.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L480-L488
  it("reports hadError on 'close' for a failed handshake without an 'error' listener", async () => {
    const server = createServer(COMMON_CERT);
    const closed = Promise.withResolvers<{ hadError: boolean; clientError: string | undefined }>();
    // The server-side socket is only reachable through the server's events.
    server.on("tlsClientError", (err, socket) => {
      const clientError = (err as Error & { code?: string }).code ?? (err as Error).message;
      socket.on("close", hadError => closed.resolve({ hadError, clientError }));
    });
    server.on("secureConnection", socket => socket.destroy());
    let plain: net.Socket | undefined;
    try {
      const port = await listen(server);
      plain = net.connect(port, "127.0.0.1", () => {
        // Not a ClientHello: the handshake fails before it starts.
        plain!.write("this is not a TLS record at all\r\n\r\n");
      });
      plain.on("error", () => {});
      const result = await closed.promise;
      expect(result.hadError).toBe(true);
      expect(typeof result.clientError).toBe("string");
    } finally {
      plain?.destroy();
      server.close();
    }
  });

  // The deadline is the socket's own idle timer: 'timeout' is what fires, and
  // node's _handleTimeout runs as its first listener, routing the error to
  // 'tlsClientError' without emitting 'error' or destroying the connection.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L961-L962
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1056-L1058
  it("emits 'timeout' and 'tlsClientError' on the deadline and keeps the socket open", async () => {
    const server = createServer({ ...COMMON_CERT, handshakeTimeout: 200 });
    const timedOut = Promise.withResolvers<{ order: string[]; code: string; destroyed: boolean }>();
    const order: string[] = [];
    // The accepted socket is reachable before the deadline, so the 'timeout'
    // listener is in place when it fires. Node's own _handleTimeout is
    // registered first and emits 'tlsClientError' from inside that dispatch,
    // so a user listener always observes it second.
    let accepted: net.Socket | undefined;
    server.on("connection", socket => {
      accepted = socket;
      socket.once("timeout", () => {
        order.push("timeout");
        timedOut.resolve({ order, code, destroyed: socket.destroyed });
      });
    });
    let code = "";
    server.on("tlsClientError", err => {
      order.push("tlsClientError");
      code = (err as Error & { code?: string }).code!;
    });
    let plain: net.Socket | undefined;
    try {
      const port = await listen(server);
      // Connect at the TCP level and never send a ClientHello.
      plain = net.connect(port, "127.0.0.1");
      plain.on("error", () => {});
      const result = await timedOut.promise;
      expect(result.code).toBe("ERR_TLS_HANDSHAKE_TIMEOUT");
      expect(result.order).toEqual(["tlsClientError", "timeout"]);
      expect(result.destroyed).toBe(false);
    } finally {
      plain?.destroy();
      accepted?.destroy();
      server.close();
    }
  });

  // _finishInit retires the handshake handler once the handshake resolves, so
  // an ordinary idle timeout on an established connection is just 'timeout'.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1105-L1106
  it("does not report a handshake timeout for an idle timeout after the handshake", async () => {
    const server = createServer({ ...COMMON_CERT, handshakeTimeout: 30_000 });
    const idled = Promise.withResolvers<{ tlsClientError: string | null; errored: string | null }>();
    let tlsClientError: string | null = null;
    server.on("tlsClientError", err => {
      tlsClientError = (err as Error & { code?: string }).code ?? "err";
    });
    server.on("secureConnection", socket => {
      let errored: string | null = null;
      socket.on("error", err => {
        errored = (err as Error & { code?: string }).code ?? "err";
      });
      // The handshake is done; this is the socket's own idle timer.
      socket.setTimeout(50);
      socket.once("timeout", () => idled.resolve({ tlsClientError, errored }));
    });
    let client: TLSSocket | undefined;
    try {
      const port = await listen(server);
      client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      client.on("error", () => {});
      const result = await idled.promise;
      // A stale handshake handler would turn this into ERR_TLS_HANDSHAKE_TIMEOUT.
      expect(result).toEqual({ tlsClientError: null, errored: null });
    } finally {
      client?.destroy();
      server.close();
    }
  });

  // Server.prototype.setSecureContext only replaces credentials; requestCert
  // and rejectUnauthorized live on the Server and are re-read per connection,
  // so an mTLS server keeps asking for client certificates after a swap.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1259-L1272
  it("keeps requesting client certificates after setSecureContext()", async () => {
    const fixtures = join(import.meta.dir, "fixtures");
    const agent1Key = readFileSync(join(fixtures, "agent1-key.pem"), "utf8");
    const agent1Cert = readFileSync(join(fixtures, "agent1-cert.pem"), "utf8");
    const ca1Cert = readFileSync(join(fixtures, "ca1-cert.pem"), "utf8");
    const server = createServer({
      key: agent1Key,
      cert: agent1Cert,
      ca: [ca1Cert],
      requestCert: true,
      rejectUnauthorized: true,
    });
    // Whichever fires first decides the outcome: a server that stopped asking
    // for the certificate would accept this client instead of rejecting it.
    const outcome = Promise.withResolvers<string>();
    server.on("secureConnection", socket => {
      outcome.resolve("accepted");
      socket.end();
    });
    server.on("tlsClientError", err => outcome.resolve((err as Error & { code?: string }).code ?? "rejected"));
    let client: TLSSocket | undefined;
    try {
      const port = await listen(server);
      server.setSecureContext({ key: agent1Key, cert: agent1Cert });
      expect((server as unknown as { _requestCert: boolean })._requestCert).toBe(true);
      client = connect({
        port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      });
      client.on("error", () => {});
      // The same code node v26.3.0 reports for this scenario.
      expect(await outcome.promise).toBe("ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE");
    } finally {
      client?.destroy();
      server.close();
    }
  });

  // Node normalizes with `options.requestCert === true`, so a truthy non-true
  // value behaves like `false`: no CertificateRequest is sent and the
  // anonymous client is accepted. The per-socket flag must agree with that
  // normalization or the handshake handler rejects a connection the native
  // listener never asked for a certificate on.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1367
  it("treats a truthy-but-not-true requestCert like false and accepts the anonymous client", async () => {
    const server = createServer({ ...COMMON_CERT, requestCert: 1 as unknown as boolean });
    const outcome = Promise.withResolvers<string>();
    server.on("secureConnection", socket => {
      outcome.resolve("accepted");
      socket.end();
    });
    server.on("tlsClientError", err => outcome.resolve((err as Error & { code?: string }).code ?? "rejected"));
    let client: TLSSocket | undefined;
    try {
      const port = await listen(server);
      expect((server as unknown as { _requestCert: unknown })._requestCert).toBeUndefined();
      client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      client.on("error", () => {});
      expect(await outcome.promise).toBe("accepted");
    } finally {
      client?.destroy();
      server.close();
    }
  });
});

describe("throwing 'secureConnection' listener", () => {
  // Node has no try/catch around the handshake-done emits, so a throwing
  // listener becomes uncaughtException — never 'tlsClientError' or a socket
  // 'error'. Verified against node v26.3.0.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1107
  it("becomes uncaughtException, not tlsClientError or a socket 'error'", async () => {
    const script = `
      const tlsMod = require("node:tls");
      const state = { uncaught: null, tlsClientError: null, socketError: null };
      function finish() {
        console.log(JSON.stringify(state));
        process.exit(0);
      }
      process.on("uncaughtException", function onUncaught(err) {
        state.uncaught = err.message;
        setImmediate(finish);
      });
      const server = tlsMod.createServer(${JSON.stringify(cert1)}, function onConn(sock) {
        sock.on("error", function onSockErr(err) {
          state.socketError = err.message;
          setImmediate(finish);
        });
        throw new Error("boom-secureConnection");
      });
      server.on("tlsClientError", function onTlsClientError(err) {
        state.tlsClientError = err.message;
        setImmediate(finish);
      });
      server.listen(0, "127.0.0.1", function onListen() {
        const client = tlsMod.connect({
          port: server.address().port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
        });
        client.on("error", function onClientError() {});
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim())).toEqual({
      uncaught: "boom-secureConnection",
      tlsClientError: null,
      socketError: null,
    });
    expect(exitCode).toBe(0);
  });
});
