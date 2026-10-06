import cluster from "cluster";
import crypto from "crypto";
import { readFileSync, realpathSync } from "fs";
import { bunEnv, bunExe, tls as cert1, isASAN, isDebug, isWindows, tempDir } from "harness";
import http from "http";
import http2 from "http2";
import https from "https";
import net, { AddressInfo } from "net";
import { createTest } from "node-harness";
import { once } from "node:events";
import { Duplex } from "node:stream";
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

  // Node decrypts the key while tls.createServer() builds the SecureContext, so
  // a wrong or missing passphrase throws synchronously from the constructor
  // instead of surfacing later on the 'error' event of listen().
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1383
  it("should throw from createServer with wrong password", () => {
    expect(() =>
      createServer({
        key: passKey,
        passphrase: "invalid",
        cert: cert,
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_OSSL_BAD_DECRYPT" }));
  });

  it("should reject passphrase longer than PEM_BUFSIZE without crashing", () => {
    // BoringSSL invokes the passphrase callback with a 1024-byte stack buffer.
    // A longer passphrase must fail key decryption rather than overflow that buffer.
    expect(() =>
      createServer({
        key: passKey,
        passphrase: Buffer.alloc(2000, "A").toString(),
        cert: cert,
      }),
    ).toThrow(expect.objectContaining({ code: expect.stringMatching(/^ERR_OSSL_/) }));
  });

  it("should throw from createServer with wrong password and no cert", () => {
    expect(() =>
      createServer({
        key: passKey,
        passphrase: "invalid",
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_OSSL_BAD_DECRYPT" }));
  });

  it("should throw from createServer without password", () => {
    expect(() =>
      createServer({
        key: passKey,
        cert: cert,
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_OSSL_BAD_DECRYPT" }));
  });
});

describe("tls.createServer", () => {
  it("should work with getCertificate", done => {
    let timeout: Timer;
    let client: TLSSocket | null = null;
    const server: Server = createServer(COMMON_CERT, socket => {
      // The handshake is complete by the time the connection listener runs;
      // accepted server sockets emit no 'secure' in node (its socket-level
      // 'secure' fires before the user can hold the socket).
      {
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
      }
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

// https://github.com/oven-sh/bun/issues/40917
it("createServer registers the callback as a regular 'secureConnection' listener", () => {
  const cb = () => {};
  const withOptions = createServer(COMMON_CERT, cb);
  expect(withOptions.listenerCount("secureConnection")).toBe(1);
  expect(withOptions.listeners("secureConnection")).toContain(cb);
  withOptions.close();

  const withoutOptions = createServer(cb);
  expect(withoutOptions.listenerCount("secureConnection")).toBe(1);
  expect(withoutOptions.listeners("secureConnection")).toContain(cb);
  withoutOptions.close();
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

describe.each(["TLSv1.3", "TLSv1.2"])("an ALPNCallback over a Duplex can drop its connection (%s)", maxVersion => {
  it.concurrent.each([
    ["emit", 'server.emit("connection", duplex)'],
    ["wrap", "new TLSSocket(duplex, { isServer: true })"],
    ["staged", "new TLSSocket(duplex, { isServer: true }) after the ClientHello"],
  ])("%s: %s", async door => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tls-alpn-callback-over-duplex-fixture.mjs"), door, maxVersion],
      env: { ...bunEnv, TLS_KEY: cert1.key, TLS_CERT: cert1.cert },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "destroy()": ["client error ECONNRESET"],
      "destroy() and refuse": ["client error ECONNRESET"],
      "destroy(err)": ["server error boom", "client error ECONNRESET"],
      "destroy() the client": [],
      "destroy() the transport": ["client error ECONNRESET"],
      // The refusal's alert goes out, as on a real socket. Node v26.3.0 sends none: its client gets ECONNRESET.
      "throw":
        door === "staged"
          ? ["client error ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL", "server error boom"]
          : ["server error boom", "client error ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL"],
      "select": ["client secureConnect h2"],
    });
    expect(exitCode).toBe(0);
  });
});

it("writing to the socket from inside SNICallback or ALPNCallback delivers the data after the handshake", async () => {
  // Same callbacks as above: they run from inside the native read that is
  // processing the ClientHello. A write issued there has to be held until that
  // call unwinds and the handshake completes; encrypting it on the spot
  // re-enters the TLS engine mid-handshake and the client gets
  // TLSV1_ALERT_INTERNAL_ERROR instead of a connection.
  const connections: TLSSocket[] = [];
  const cases: Array<[string, tls.TlsOptions, string | false]> = [
    [
      "ALPNCallback",
      {
        ALPNCallback({ protocols }) {
          connections.at(-1)!.write("from-callback;");
          return protocols[0];
        },
      },
      "x/1",
    ],
    [
      "SNICallback",
      {
        SNICallback(_name, cb) {
          connections.at(-1)!.write("from-callback;");
          cb(null, undefined);
        },
      },
      false,
    ],
  ];
  for (const [label, extra, expectedAlpn] of cases) {
    connections.length = 0;
    const tlsClientErrors: Error[] = [];
    const server = createServer({ ...COMMON_CERT, ...extra }, socket => socket.end("after-handshake;"));
    server.on("connection", socket => connections.push(socket as TLSSocket));
    server.on("tlsClientError", err => tlsClientErrors.push(err));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const { promise, resolve } = Promise.withResolvers<string>();
    let received = "";
    const client = connect({
      port,
      host: "127.0.0.1",
      ca: COMMON_CERT.cert,
      servername: "localhost",
      ALPNProtocols: ["x/1"],
    });
    client.setEncoding("utf8");
    client.on("data", chunk => (received += chunk));
    client.on("end", () => resolve(received));
    client.on("error", err => resolve(`client error: ${err.message}`));
    const data = await promise;
    client.end();
    server.close();
    await once(server, "close");

    expect({ label, data, alpn: client.alpnProtocol, tlsClientErrors: tlsClientErrors.map(e => e.message) }).toEqual({
      label,
      data: "from-callback;after-handshake;",
      alpn: expectedAlpn,
      tlsClientErrors: [],
    });
  }
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

it("keeps socket.authorized false when a client without a certificate resumes a TLSv1.3 session", async () => {
  type Verdict = { reused: boolean; authorized: boolean; authorizationError: unknown };
  const verdicts: Verdict[] = [];
  const twoConnections = Promise.withResolvers<void>();
  await using server = createServer(
    { ...COMMON_CERT, requestCert: true, rejectUnauthorized: false, minVersion: "TLSv1.3", maxVersion: "TLSv1.3" },
    socket => {
      verdicts.push({
        reused: socket.isSessionReused(),
        authorized: socket.authorized,
        authorizationError: socket.authorizationError,
      });
      if (verdicts.length === 2) twoConnections.resolve();
      socket.on("data", () => {});
      socket.write("x");
    },
  );
  server.on("error", twoConnections.reject);
  server.on("tlsClientError", twoConnections.reject);
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;
  const opts = {
    port,
    host: "127.0.0.1",
    servername: "localhost",
    ca: COMMON_CERT.cert,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
  } as const;

  const first = connect(opts);
  first.on("error", twoConnections.reject);
  first.on("data", () => {});
  const [session] = await once(first, "session");
  const firstProtocol = first.getProtocol();
  first.destroy();
  await once(first, "close");
  expect(firstProtocol).toBe("TLSv1.3");
  expect(Buffer.isBuffer(session)).toBe(true);

  const second = connect({ ...opts, session });
  second.on("error", twoConnections.reject);
  second.on("data", () => {});
  await once(second, "secureConnect");
  const clientReused = second.isSessionReused();
  await twoConnections.promise;
  second.destroy();
  await once(second, "close");

  expect(clientReused).toBe(true);
  expect(verdicts).toEqual([
    { reused: false, authorized: false, authorizationError: "UNABLE_TO_GET_ISSUER_CERT" },
    { reused: true, authorized: false, authorizationError: "UNABLE_TO_GET_ISSUER_CERT" },
  ]);
});

it("keeps socket.authorized false when a client without a certificate resumes a TLSv1.3 session against an https server", async () => {
  type Verdict = { authorized: boolean | undefined; authorizationError: unknown };
  const verdicts: Verdict[] = [];
  await using server = https.createServer(
    { ...COMMON_CERT, requestCert: true, rejectUnauthorized: false },
    (req, res) => {
      const socket = req.socket as TLSSocket;
      verdicts.push({ authorized: socket.authorized, authorizationError: socket.authorizationError });
      const body = String(socket.authorized);
      res.writeHead(200, { "Connection": "close", "Content-Length": String(body.length) });
      res.end(body);
    },
  );
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;
  const opts = {
    port,
    host: "127.0.0.1",
    servername: "localhost",
    ca: COMMON_CERT.cert,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
  } as const;

  async function request(session?: Buffer) {
    const socket = connect(session ? { ...opts, session } : opts);
    const gotSession = session ? Promise.resolve([session]) : once(socket, "session");
    const closed = once(socket, "close");
    const chunks: Buffer[] = [];
    socket.on("data", chunk => chunks.push(chunk));
    await once(socket, "secureConnect");
    const protocol = socket.getProtocol();
    const reused = socket.isSessionReused();
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    const [ticket] = await gotSession;
    await closed;
    const body = Buffer.concat(chunks).toString("latin1").split("\r\n\r\n")[1];
    return { protocol, reused, ticket: ticket as Buffer, body };
  }

  const first = await request();
  expect(first.protocol).toBe("TLSv1.3");
  expect(first.reused).toBe(false);
  expect(first.body).toBe("false");
  expect(Buffer.isBuffer(first.ticket)).toBe(true);

  const second = await request(first.ticket);
  expect(second.protocol).toBe("TLSv1.3");
  expect(second.reused).toBe(true);
  expect(second.body).toBe("false");

  expect(verdicts).toEqual([
    { authorized: false, authorizationError: "UNABLE_TO_GET_ISSUER_CERT" },
    { authorized: false, authorizationError: "UNABLE_TO_GET_ISSUER_CERT" },
  ]);
});

it("completes a write that fails inside the TLS layer after the handshake instead of leaving the socket open", async () => {
  // The server's first write carries its NewSessionTickets, each with the client's ~48 KiB chain:
  // BoringSSL fails that SSL_write until #38120 lands, Node sends it.
  const fixtures = join(import.meta.dir, "fixtures");
  const agent1Key = readFileSync(join(fixtures, "agent1-key.pem"), "utf8");
  const agent1Cert = readFileSync(join(fixtures, "agent1-cert.pem"), "utf8");
  const ca1 = readFileSync(join(fixtures, "ca1-cert.pem"), "utf8");
  // agent1 still verifies against ca1; the 52 extra copies of ca1 only pad
  // the chain the client sends.
  const paddedChain = agent1Cert + Buffer.alloc(ca1.length * 52, ca1).toString();

  const serverEvents: string[] = [];
  const serverSocketDone = Promise.withResolvers<{ writeError: NodeJS.ErrnoException | null | undefined }>();
  await using server = createServer(
    { key: agent1Key, cert: agent1Cert, ca: [ca1], requestCert: true, minVersion: "TLSv1.3", maxVersion: "TLSv1.3" },
    socket => {
      socket.on("error", err => serverEvents.push(`error:${(err as NodeJS.ErrnoException).code}`));
      socket.on("close", hadError => serverEvents.push(`close:${hadError}`));
      socket.on("data", () => {
        socket.write("pong", writeError => {
          if (writeError) {
            socket.once("close", () => serverSocketDone.resolve({ writeError }));
          } else {
            serverSocketDone.resolve({ writeError });
          }
        });
      });
    },
  );
  server.on("tlsClientError", serverSocketDone.reject);
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const client = connect({ port, host: "127.0.0.1", key: agent1Key, cert: paddedChain, rejectUnauthorized: false });
  client.on("error", () => {});
  const clientClosed = new Promise<void>(resolve => client.on("close", () => resolve()));
  const clientReply = new Promise<string>(resolve => client.once("data", chunk => resolve(String(chunk))));
  await once(client, "secureConnect");
  client.write("ping");

  const { writeError } = await serverSocketDone.promise;
  if (writeError) {
    expect({ code: writeError.code, syscall: writeError.syscall, serverEvents }).toEqual({
      code: "EPROTO",
      syscall: "write",
      serverEvents: ["error:EPROTO", "close:true"],
    });
  } else {
    expect(await clientReply).toBe("pong");
    client.end();
  }
  // In both outcomes the connection itself is gone afterwards.
  await clientClosed;
});

it("keeps req.socket.authorized false for an unverified client after the server socket shuts down", async () => {
  type Verdict = [boolean | undefined, string | null | undefined];
  const { promise, resolve, reject } = Promise.withResolvers<{ before: Verdict; after: Verdict }>();
  const server = https.createServer({ ...COMMON_CERT, requestCert: true, rejectUnauthorized: false }, req => {
    const socket = req.socket as TLSSocket;
    const before: Verdict = [socket.authorized, socket.authorizationError as string | null];
    socket.end(() => {
      resolve({ before, after: [socket.authorized, socket.authorizationError as string | null] });
    });
  });
  server.on("error", reject);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const clientRequest = https.get({ port, host: "127.0.0.1", rejectUnauthorized: false });
  clientRequest.on("error", () => {});
  try {
    const { before, after } = await promise;
    expect(before).toEqual([false, "UNABLE_TO_GET_ISSUER_CERT"]);
    expect(after).toEqual([false, "UNABLE_TO_GET_ISSUER_CERT"]);
  } finally {
    clientRequest.destroy();
    server.close();
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

it("a socket that end()s while an asynchronous SNICallback is pending reports tlsClientError, then 'close'", async () => {
  const events: string[] = [];
  const sniCalled = Promise.withResolvers<void>();
  const sawServerFin = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  let answerSni: (() => void) | undefined;
  let serverSocket: net.Socket | undefined;
  const server: Server = createServer({
    ...COMMON_CERT,
    requestCert: true,
    rejectUnauthorized: true,
    SNICallback: (_name, cb) => {
      answerSni = () => cb(null, tls.createSecureContext({ ...COMMON_CERT }));
      sniCalled.resolve();
    },
  });
  server.on("secureConnection", () => events.push("secureConnection"));
  server.on("tlsClientError", err => events.push(`tlsClientError ${(err as NodeJS.ErrnoException).code}`));
  server.on("connection", socket => {
    serverSocket = socket;
    socket.on("error", () => {});
    socket.on("close", hadError => {
      events.push(`close hadError=${hadError}`);
      closed.resolve();
    });
  });
  server.listen(0);
  await once(server, "listening");
  // The proxy does not pass the server's FIN on, so the client stays connected.
  const proxied: net.Socket[] = [];
  const proxy = net.createServer({ allowHalfOpen: true }, downstream => {
    const upstream = net.connect({
      port: (server.address() as AddressInfo).port,
      host: "127.0.0.1",
      allowHalfOpen: true,
    });
    proxied.push(downstream, upstream);
    downstream.on("data", chunk => upstream.write(chunk));
    upstream.on("data", chunk => downstream.write(chunk));
    upstream.on("end", () => sawServerFin.resolve());
    downstream.on("error", () => {});
    upstream.on("error", () => {});
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const client = connect({
    port: (proxy.address() as AddressInfo).port,
    host: "127.0.0.1",
    servername: "pending.example.com",
    rejectUnauthorized: false,
  });
  client.on("error", () => {});
  try {
    await sniCalled.promise;
    serverSocket!.end();
    await sawServerFin.promise;
    // The handshake fails inside this call: the socket is shut down.
    answerSni!();
    await closed.promise;
    expect(events).toEqual(["tlsClientError ECONNRESET", "close hadError=true"]);
  } finally {
    client.destroy();
    for (const socket of proxied) socket.destroy();
    proxy.close();
    server.close();
  }
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
  const { port, address } = server.address() as AddressInfo;
  // Dial the address listen() bound: "localhost" has both an A and an AAAA
  // record on a dual-stack host and connect() need not pick the same one.
  // servername stays "localhost" - the bind hostname.
  const client = connect({ port, host: address, servername: "localhost", rejectUnauthorized: false });
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

// Live rotation (ACME renew hooks, secret reloads): the listening socket's
// context is built in listen(), so setSecureContext() has to replace it for the
// handshakes that follow. Connections already accepted keep theirs.
describe("setSecureContext() on a listening server", () => {
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
  const agent1 = { key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem") }; // issued by ca1
  const agent3 = { key: fixture("agent3-key.pem"), cert: fixture("agent3-cert.pem") }; // issued by ca2
  const agent2 = { key: fixture("agent2-key.pem"), cert: fixture("agent2-cert.pem") };
  const ca1 = fixture("ca1-cert.pem");
  const ca2 = fixture("ca2-cert.pem");

  const listen = async (server: Server, host = "127.0.0.1") => {
    server.listen(0, host);
    await once(server, "listening");
    return server.address() as AddressInfo;
  };

  // What one fresh client sees: the certificate the server presented and the
  // ALPN protocol it picked, or how the server judged the client.
  async function handshake(options: Record<string, unknown>) {
    const client = connect({ rejectUnauthorized: false, ...options } as any);
    try {
      await once(client, "secureConnect");
      return { cn: (client.getPeerCertificate() as PeerCertificate).subject.CN, alpn: client.alpnProtocol };
    } finally {
      client.destroy();
    }
  }

  it("serves the replacement certificate, with and without the bind hostname as SNI", async () => {
    const server: Server = createServer({ ...agent1 });
    try {
      // A client that names the bind hostname gets the default context, like
      // one that sends no SNI: no SNI entry may pin that name to the old one.
      const { port, address } = await listen(server, "localhost");
      const viaSNI = { port, host: address, servername: "localhost" };
      expect(await handshake(viaSNI)).toMatchObject({ cn: "agent1" });

      server.setSecureContext({ ...agent3 });
      expect(await handshake(viaSNI)).toMatchObject({ cn: "agent3" });
      expect(await handshake({ port, host: address })).toMatchObject({ cn: "agent3" });
    } finally {
      server.close();
    }
  });

  // How the server judges each client, one verdict per connection: the peer
  // and socket.authorized from 'secureConnection', or the 'tlsClientError' code.
  function judge(server: Server) {
    const verdicts: string[] = [];
    server.on("secureConnection", socket => {
      const cn = (socket.getPeerCertificate() as PeerCertificate).subject?.CN ?? "none";
      verdicts.push(`${cn} authorized=${socket.authorized} reused=${socket.isSessionReused()}`);
      socket.end();
    });
    server.on("tlsClientError", err => verdicts.push(`refused ${(err as NodeJS.ErrnoException).code}`));
    return async (port: number, client: { key?: string; cert?: string }, session?: Buffer) => {
      const seen = verdicts.length;
      const socket = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...client, session });
      socket.on("error", () => {});
      let saved: Buffer | undefined;
      socket.on("session", s => (saved = s));
      socket.resume();
      // Not once(): it rejects on the 'error' of a client that a TLS 1.3 server refuses after the handshake.
      await new Promise(closed => socket.once("close", closed));
      expect(verdicts.length).toBe(seen + 1);
      return { verdict: verdicts[seen], session: saved };
    };
  }

  it("replaces the client-CA store: a removed CA stops authorizing clients", async () => {
    const server: Server = createServer({ ...agent1, ca: ca1, requestCert: true, rejectUnauthorized: true });
    const judged = judge(server);
    try {
      const { port } = await listen(server);
      const before = await judged(port, agent1);
      expect(before.verdict).toBe("agent1 authorized=true reused=false");
      expect(before.session).toBeDefined();

      // The operator drops ca1 and trusts ca2 from now on.
      server.setSecureContext({ ...agent1, ca: ca2 });
      expect({
        removedCA: (await judged(port, agent1)).verdict,
        addedCA: (await judged(port, agent3)).verdict,
        // A session saved under the retired context must not resume: a
        // resumed handshake skips client authentication.
        resumed: (await judged(port, agent1, before.session)).verdict,
      }).toEqual({
        removedCA: "refused UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        addedCA: "agent3 authorized=true reused=false",
        resumed: "refused UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      });
    } finally {
      server.close();
    }
  });

  it("a server that requests but does not reject reports authorized against the replaced CA store", async () => {
    const server: Server = createServer({ ...agent1, ca: ca1, requestCert: true, rejectUnauthorized: false });
    const judged = judge(server);
    try {
      const { port } = await listen(server);
      const before = await judged(port, agent1);
      expect(before.verdict).toBe("agent1 authorized=true reused=false");
      expect(before.session).toBeDefined();

      // The shape @grpc/grpc-js passes on every reload: the flags ride along.
      server.setSecureContext({ ...agent1, ca: ca2, requestCert: true, rejectUnauthorized: false });
      expect({
        removedCA: (await judged(port, agent1)).verdict,
        addedCA: (await judged(port, agent3)).verdict,
        resumed: (await judged(port, agent1, before.session)).verdict,
        // Still admitted: this server never rejected, and a swap must not start to.
        certless: (await judged(port, {})).verdict,
      }).toEqual({
        removedCA: "agent1 authorized=false reused=false",
        addedCA: "agent3 authorized=true reused=false",
        resumed: "agent1 authorized=false reused=false",
        certless: "none authorized=false reused=false",
      });
    } finally {
      server.close();
    }
  });

  // requestCert and rejectUnauthorized are constructor-only in node: the
  // options of a later setSecureContext() cannot flip them.
  it.each([
    {
      name: "a strict server asked to stop requesting certificates",
      ctor: { requestCert: true, rejectUnauthorized: true },
      rotation: { requestCert: false, rejectUnauthorized: false },
      certless: "refused ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE",
    },
    {
      name: "a server that never requested certificates asked to require them",
      ctor: {},
      rotation: { requestCert: true, rejectUnauthorized: true },
      certless: "none authorized=false reused=false",
    },
    {
      name: "a non-rejecting server asked to reject",
      ctor: { requestCert: true, rejectUnauthorized: false },
      rotation: { rejectUnauthorized: true },
      certless: "none authorized=false reused=false",
    },
  ])("$name judges a certificate-less client as before", async ({ ctor, rotation, certless }) => {
    const server: Server = createServer({ ...agent1, ca: ca1, ...ctor });
    const judged = judge(server);
    try {
      const { port } = await listen(server);
      expect((await judged(port, {})).verdict).toBe(certless);
      server.setSecureContext({ ...agent1, ca: ca1, ...rotation });
      expect((await judged(port, {})).verdict).toBe(certless);
    } finally {
      server.close();
    }
  });

  it("leaves addContext() entries, SNICallback and ALPN negotiation in place", async () => {
    let sniCalls = 0;
    const viaCallback = tls.createSecureContext({ ...agent2 });
    const server: Server = createServer({
      ...agent1,
      ALPNProtocols: ["h2", "http/1.1"],
      SNICallback: (name, cb) => {
        sniCalls++;
        cb(null, name === "callback.example" ? viaCallback : undefined);
      },
    });
    try {
      const { port, address } = await listen(server, "localhost");
      const base = { port, host: address, ALPNProtocols: ["h2"] };
      // An entry under the bind hostname is the caller's like any other: the
      // swap replaces the default context only.
      server.addContext("localhost", { ...agent2 });

      server.setSecureContext({ ...agent3 });
      expect(await handshake(base)).toEqual({ cn: "agent3", alpn: "h2" });
      expect(await handshake({ ...base, servername: "localhost" })).toMatchObject({ cn: "agent2" });
      expect(await handshake({ ...base, servername: "callback.example" })).toMatchObject({ cn: "agent2" });
      expect(sniCalls).toBe(2);
    } finally {
      server.close();
    }
  });

  it("keeps accepting certificate-less clients when the server never set requestCert", async () => {
    const server: Server = createServer({ ...agent1, ca: ca1 });
    const clientErrors: unknown[] = [];
    server.on("tlsClientError", err => clientErrors.push(err));
    server.on("secureConnection", socket => socket.end());
    try {
      const { port } = await listen(server);
      server.setSecureContext({ ...agent3, ca: ca1 });
      expect(await handshake({ port, host: "127.0.0.1" })).toMatchObject({ cn: "agent3" });
      expect(clientErrors).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("throws on an unusable certificate and stays on the previous credentials", async () => {
    const server: Server = createServer({ ...agent1 });
    try {
      const { port } = await listen(server);
      expect(() =>
        server.setSecureContext({
          key: agent3.key,
          cert: "-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----",
        }),
      ).toThrow(expect.objectContaining({ code: "ERR_OSSL_ASN1_DECODE_ERROR" }));
      expect(await handshake({ port, host: "127.0.0.1" })).toMatchObject({ cn: "agent1" });
      // A later listen() builds from these fields.
      expect({ key: (server as any).key, cert: (server as any).cert }).toEqual(agent1);

      server.close();
      await once(server, "close");
      const relistened = await listen(server);
      expect(await handshake({ port: relistened.port, host: "127.0.0.1" })).toMatchObject({ cn: "agent1" });
    } finally {
      server.close();
    }
  });

  it("does not disturb a connection accepted before the swap", async () => {
    const server: Server = createServer({ ...agent1 }, socket => socket.on("data", d => socket.write(d)));
    try {
      const { port } = await listen(server);
      const client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      await once(client, "secureConnect");
      server.setSecureContext({ ...agent3 });
      client.write("still here");
      const [echoed] = await once(client, "data");
      expect(String(echoed)).toBe("still here");
      expect((client.getPeerCertificate() as PeerCertificate).subject.CN).toBe("agent1");
      client.destroy();
    } finally {
      server.close();
    }
  });

  // The context is picked when the connection is accepted, like node's
  // tlsConnectionListener: a ClientHello that arrives after the swap still
  // handshakes against the previous one, ALPN included.
  it.each([
    ["tls.Server", () => createServer({ ...agent1, ALPNProtocols: ["h2"] })],
    ["Http2SecureServer", () => http2.createSecureServer({ ...agent1 })],
  ] as const)("%s: a connection accepted before the swap handshakes with the previous context", async (_, create) => {
    const server = create() as Server;
    let raw: net.Socket | undefined;
    try {
      const { port, address } = await listen(server, "localhost");
      const accepted = once(server, "connection");
      raw = net.connect({ port, host: address });
      await Promise.all([once(raw, "connect"), accepted]);

      server.setSecureContext({ ...agent3 });
      expect(await handshake({ socket: raw, servername: "localhost", ALPNProtocols: ["h2"] })).toEqual({
        cn: "agent1",
        alpn: "h2",
      });
    } finally {
      raw?.destroy();
      server.close();
    }
  });

  it("rotates an Http2SecureServer, which keeps speaking h2 after close() and listen()", async () => {
    const server = http2.createSecureServer({ ...agent1 }, (_req, res) => res.end("ok"));
    // One request over `session`: the certificate it was served over and the status.
    const request = async (session: http2.ClientHttp2Session) => {
      const stream = session.request({ ":path": "/" });
      const [headers] = await once(stream, "response");
      stream.resume();
      return {
        cn: ((session.socket as TLSSocket).getPeerCertificate() as PeerCertificate).subject.CN,
        status: headers[":status"],
      };
    };
    const fresh = async (port: number) => {
      const session = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
      try {
        return await request(session);
      } finally {
        session.destroy();
      }
    };
    let live: http2.ClientHttp2Session | undefined;
    try {
      const { port } = await listen(server as unknown as Server);
      live = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
      expect(await request(live)).toEqual({ cn: "agent1", status: 200 });

      // grpc-js reloads credentials this way, with the key and certificate only.
      server.setSecureContext({ ...agent3 });
      expect(await fresh(port)).toEqual({ cn: "agent3", status: 200 });
      expect(await request(live)).toEqual({ cn: "agent1", status: 200 });
      live.destroy();

      // listen() builds its ALPN list from the server's ALPNProtocols, which
      // setSecureContext() has to leave alone.
      server.close();
      await once(server, "close");
      const relistened = await listen(server as unknown as Server);
      expect(await fresh(relistened.port)).toEqual({ cn: "agent3", status: 200 });
    } finally {
      live?.destroy();
      server.close();
    }
  });

  // node reads ALPNProtocols in the Server constructor only.
  it("ignores an ALPNProtocols option: the constructor's list stays", async () => {
    const server: Server = createServer({ ...agent1, ALPNProtocols: ["h2"] });
    try {
      const { port } = await listen(server);
      const offer = { host: "127.0.0.1", ALPNProtocols: ["http/1.1", "h2"] };

      server.setSecureContext({ ...agent3, ALPNProtocols: ["http/1.1"] });
      expect(await handshake({ ...offer, port })).toEqual({ cn: "agent3", alpn: "h2" });

      server.close();
      await once(server, "close");
      const relistened = await listen(server);
      expect(await handshake({ ...offer, port: relistened.port })).toEqual({ cn: "agent3", alpn: "h2" });
    } finally {
      server.close();
    }
  });

  // In a process of its own: a count taken here would include what earlier tests left for the GC.
  it("frees the context it replaces", async () => {
    const script = `
      const { sslCtxLiveCount } = require("bun:internal-for-testing");
      const tls = require("node:tls"), { once } = require("node:events");
      const [agent1, agent3] = ${JSON.stringify([agent1, agent3])};
      const before = sslCtxLiveCount();

      // The wrapper of a replaced context dies on GC, so wait for the condition.
      async function settled(expected) {
        for (let i = 0; i < 10 && sslCtxLiveCount() - before !== expected; i++) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
        return sslCtxLiveCount() - before;
      }

      // Nothing here outlives the call.
      async function swap() {
        const server = tls.createServer(agent1);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const listening = sslCtxLiveCount() - before;

        for (let i = 0; i < 20; i++) server.setSecureContext(i % 2 ? agent1 : agent3);
        let threw = false;
        try {
          server.setSecureContext({ key: agent3.key, cert: "-----BEGIN CERTIFICATE-----\\nnope\\n-----END CERTIFICATE-----" });
        } catch {
          threw = true;
        }
        // A reference the listener kept outlives the wrapper: one more live SSL_CTX per call.
        const swapped = await settled(1);
        server.close();
        await once(server, "close");
        return { threw, listening, swapped };
      }

      const result = await swap();
      console.log(JSON.stringify({ ...result, left: await settled(0) }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, result: JSON.parse(stdout || "null") }).toEqual({
      stderr: "",
      // One context per server, whatever it went through: listen() builds none.
      result: { threw: true, listening: 1, swapped: 1, left: 0 },
    });
    expect(exitCode).toBe(0);
  });

  it("a rejected call changes neither the listener nor the context injected sockets get", async () => {
    const server: Server = createServer({ ...agent1 });
    const front = net.createServer(raw => server.emit("connection", raw));
    try {
      const { port } = await listen(server);
      front.listen(0, "127.0.0.1");
      await once(front, "listening");
      // agent3's key does not belong to agent2's certificate.
      expect(() => server.setSecureContext({ key: agent3.key, cert: agent2.cert })).toThrow(
        expect.objectContaining({ code: "ERR_OSSL_X509_KEY_VALUES_MISMATCH" }),
      );
      expect({
        accepted: await handshake({ port, host: "127.0.0.1" }),
        injected: await handshake({ port: (front.address() as AddressInfo).port, host: "127.0.0.1" }),
      }).toMatchObject({ accepted: { cn: "agent1" }, injected: { cn: "agent1" } });
    } finally {
      front.close();
      server.close();
    }
  });

  // A cluster worker's listen() completes when the primary answers. A call
  // made before that has to reach the listener the worker then creates.
  it("counts in a cluster worker when called before 'listening'", async () => {
    // This process is the primary, so the test starts one process and not two.
    const settings = cluster.settings;
    cluster.setupPrimary({ exec: join(import.meta.dir, "tls-cluster-set-secure-context-fixture.mjs"), execArgv: [] });
    const worker = cluster.fork(bunEnv);
    cluster.settings = settings;
    const exited = once(worker, "exit");
    try {
      const served = await Promise.race([
        once(worker, "message").then(([message]) => message),
        exited.then(([code, signal]) => {
          throw new Error(`the worker exited before it reported: code ${code}, signal ${signal}`);
        }),
      ]);
      expect(served).toEqual({ handleAfterListen: "none", default: "agent3", viaAddContext: "agent2" });
    } finally {
      worker.kill();
      await exited;
    }
  });
});

it("an addContext() wildcard covers the hostname the server is bound to", async () => {
  // node matches every SNI name against the addContext() entries. Nothing is
  // registered for the bind hostname itself, which would shadow a wildcard.
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
  const server: Server = createServer({ key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem") });
  try {
    server.listen(0, "localhost");
    await once(server, "listening");
    const { port, address } = server.address() as AddressInfo;
    server.addContext("*", { key: fixture("agent2-key.pem"), cert: fixture("agent2-cert.pem") });

    const client = connect({ port, host: address, servername: "localhost", rejectUnauthorized: false });
    try {
      await once(client, "secureConnect");
      expect((client.getPeerCertificate() as PeerCertificate).subject.CN).toBe("agent2");
    } finally {
      client.destroy();
    }
  } finally {
    server.close();
  }
});

it("setSecureContext() with material the native loader rejects throws synchronously before listen()", async () => {
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1520-L1542
  const server: Server = createServer(COMMON_CERT);
  expect(() => server.setSecureContext({ key: "garbage", cert: "garbage" })).toThrow(
    expect.objectContaining({ code: "ERR_OSSL_PEM_NO_START_LINE" }),
  );
  // rsa_private.pem is not the key of the harness certificate.
  expect(() => server.setSecureContext({ key: rawKey, cert: COMMON_CERT.cert })).toThrow(
    expect.objectContaining({ code: "ERR_OSSL_X509_KEY_VALUES_MISMATCH" }),
  );

  const errors: Error[] = [];
  server.on("error", err => errors.push(err));
  server.on("secureConnection", socket => socket.end());
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  server.once("error", listening.reject);
  await listening.promise;
  let client: TLSSocket | undefined;
  try {
    const connected = Promise.withResolvers<void>();
    client = connect(
      {
        port: (server.address() as AddressInfo).port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      },
      () => connected.resolve(),
    );
    client.on("error", connected.reject);
    await connected.promise;
    const expectedCert = new crypto.X509Certificate(COMMON_CERT.cert);
    expect(client.getPeerCertificate().fingerprint256).toBe(expectedCert.fingerprint256);
    expect(errors).toEqual([]);
  } finally {
    client?.destroy();
    server.close();
  }
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

describe("addContext with a name of more than 10 labels", () => {
  // The native SNI tree used to cap lookups and removals at 10 labels while
  // accepting any number on insert, so such a name was registered but never
  // selected at the handshake and could not be replaced.
  const longName = "a.b.c.d.e.f.g.h.i.j.k.example";
  const altCert = { key: rawKey, cert: cert };
  const altFingerprint = new crypto.X509Certificate(cert).fingerprint256;

  // Connects with the long servername and returns the certificate the server
  // presented. A server-side handshake failure rejects instead of throwing
  // from the event callback.
  async function peerFingerprint(server: Server): Promise<string> {
    const port = (server.address() as AddressInfo).port;
    const serverError = new Promise<never>((_, reject) => server.once("tlsClientError", reject));
    const client = connect({ port, host: "127.0.0.1", servername: longName, rejectUnauthorized: false });
    await Promise.race([once(client, "secureConnect"), serverError]);
    const fingerprint = client.getPeerCertificate().fingerprint256;
    client.end();
    await once(client, "close");
    return fingerprint;
  }

  it.concurrent("selects the addContext certificate at the handshake", async () => {
    const server: Server = createServer(COMMON_CERT, socket => socket.end());
    server.addContext(longName, altCert);
    server.listen(0);
    await once(server, "listening");
    expect(await peerFingerprint(server)).toBe(altFingerprint);
    server.close();
    await once(server, "close");
  });

  it.concurrent("a second addContext for the same name replaces the first", async () => {
    // After listen() each addContext goes straight to the native tree, which
    // removes the old entry and adds the new one. The removal used to miss,
    // so the add saw a duplicate and addContext threw "Failed to register SNI".
    const server: Server = createServer(COMMON_CERT, socket => socket.end());
    server.listen(0);
    await once(server, "listening");
    server.addContext(longName, COMMON_CERT);
    server.addContext(longName, altCert);
    expect(await peerFingerprint(server)).toBe(altFingerprint);
    server.close();
    await once(server, "close");
  });
});

describe("addContext() entries apply to every listen()", () => {
  // tls.Server keeps every entry, like node's server._contexts, and loads them into each listener it creates.
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
  const agent1 = { key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem") };
  const agent2 = { key: fixture("agent2-key.pem"), cert: fixture("agent2-cert.pem") };
  const agent3 = { key: fixture("agent3-key.pem"), cert: fixture("agent3-cert.pem") };

  async function listen(server: Server) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server.address() as AddressInfo;
  }

  async function relisten(server: Server) {
    server.close();
    await once(server, "close");
    return listen(server);
  }

  // The CN of the certificate the server presents for `servername`.
  async function servedCN({ address, port }: AddressInfo, servername: string) {
    const client = connect({ host: address, port, servername, rejectUnauthorized: false });
    try {
      await once(client, "secureConnect");
      return client.getPeerCertificate().subject.CN;
    } finally {
      client.destroy();
    }
  }

  it("an entry added while listening is still there after close() and listen()", async () => {
    const server: Server = createServer(agent1, socket => socket.end());
    try {
      const first = await listen(server);
      server.addContext("added.example", agent2);
      const whileListening = await servedCN(first, "added.example");
      const second = await relisten(server);
      expect({
        whileListening,
        afterRelisten: await servedCN(second, "added.example"),
        otherName: await servedCN(second, "other.example"),
      }).toEqual({
        whileListening: "agent2",
        afterRelisten: "agent2",
        otherName: "agent1",
      });
    } finally {
      server.close();
    }
  });

  it("an entry replaced while listening stays replaced after close() and listen()", async () => {
    const server: Server = createServer(agent1, socket => socket.end());
    server.addContext("rotated.example", agent2);
    try {
      const first = await listen(server);
      const beforeReplace = await servedCN(first, "rotated.example");
      server.addContext("rotated.example", agent3);
      const afterReplace = await servedCN(first, "rotated.example");
      const second = await relisten(server);
      expect({
        beforeReplace,
        afterReplace,
        afterRelisten: await servedCN(second, "rotated.example"),
      }).toEqual({
        beforeReplace: "agent2",
        afterReplace: "agent3",
        afterRelisten: "agent3",
      });
    } finally {
      server.close();
    }
  });

  it("addContext() without a servername throws ERR_TLS_REQUIRED_SERVER_NAME and keeps no entry", async () => {
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1571-L1574
    const required = expect.objectContaining({
      name: "Error",
      code: "ERR_TLS_REQUIRED_SERVER_NAME",
      message: '"servername" is required parameter for Server.addContext',
    });
    const server: Server = createServer(agent1, socket => socket.end());
    try {
      // A kept empty name would make every listen() fail.
      for (const servername of ["", undefined, null]) {
        expect(() => server.addContext(servername as any, agent2)).toThrow(required);
      }
      await listen(server);
      expect(() => server.addContext("", agent2)).toThrow(required);
      expect(await servedCN(await relisten(server), "added.example")).toBe("agent1");
    } finally {
      server.close();
    }
  });

  it("listen() loads the entries in addContext() call order", async () => {
    // "ordered.example." and "ordered.example" land on the same native SNI
    // entry, so the order a listener receives them in decides what it serves.
    const server: Server = createServer(agent1, socket => socket.end());
    server.addContext("ordered.example", agent2);
    server.addContext("ordered.example.", agent2);
    server.addContext("ordered.example", agent3);
    try {
      expect(await servedCN(await listen(server), "ordered.example")).toBe("agent3");
    } finally {
      server.close();
    }
  });
});

describe("tls.Server socket destroySoon", () => {
  // destroySoon() after end(big) must deliver every byte even when the TLS write
  // batcher's final flush spills (#31584). The spill/kernel-buffer race hits ~4% of
  // connections at this payload, so loop (mirrors test-tls-client-destroy-soon.js).
  // Under debug/ASAN each connection costs ~50-150ms (connection setup and teardown,
  // not the payload), so 64 of them overran the 5s default timeout.
  const connections = isDebug || isASAN ? 8 : 64;
  it("delivers the whole stream when destroySoon follows end", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, "Y");
    for (let i = 0; i < connections; i++) {
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
    // The verify mode of a wrapped server socket comes from its own
    // requestCert, as in Node's TLSWrap::SetVerifyMode, and a server `ca`
    // never asks for a certificate by itself, so an ordinary client connects:
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

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1383
  it.each([
    ["tls.createServer", createServer],
    ["http2.createSecureServer", http2.createSecureServer],
  ])("%s() itself throws on a certificate the native loader rejects", (_, create) => {
    expect(() => create({ key: agent6Key, cert: "not a certificate" })).toThrow(
      expect.objectContaining({ code: "ERR_OSSL_PEM_NO_START_LINE" }),
    );
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

  it("https.Server treats a truthy-but-not-true requestCert like false as well", async () => {
    const server = https.createServer({ ...COMMON_CERT, requestCert: 1 as unknown as boolean }, (req, res) => {
      res.end("served");
    });
    let client: TLSSocket | undefined;
    try {
      const port = await listen(server as unknown as Server);
      const outcome = Promise.withResolvers<string>();
      client = connect({
        port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        key: COMMON_CERT.key,
        cert: COMMON_CERT.cert,
      });
      client.on("secureConnect", () => client!.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
      let response = "";
      client.on("data", chunk => (response += chunk));
      client.on("error", err => outcome.resolve((err as Error & { code?: string }).code ?? err.message));
      client.on("close", () => outcome.resolve(response.split("\r\n").at(-1) || "closed without a response"));
      // The server does not trust this self-signed certificate: it would refuse it if it had asked.
      expect(await outcome.promise).toBe("served");
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

describe("deferred spill-close", () => {
  // A close issued while sealed ciphertext is still spilled (peer applying
  // backpressure) is deferred until the spill drains; peer bytes arriving in
  // that window must be delivered normally and the close must still complete.
  it("delivers late peer data during the deferred window and completes the close", async () => {
    const payload = Buffer.alloc(8 * 1024 * 1024, "s");
    const serverGot: Buffer[] = [];
    const serverClosed = Promise.withResolvers<void>();
    const clientClosed = Promise.withResolvers<void>();
    const clientEnded = Promise.withResolvers<void>();
    const serverConn = Promise.withResolvers<import("node:tls").TLSSocket>();

    const server = tls.createServer(cert1, function onConn(sock) {
      sock.on("data", function onData(c: Buffer) {
        serverGot.push(c);
      });
      sock.on("close", function onClose() {
        serverClosed.resolve();
      });
      sock.on("error", function onErr(e) {
        serverClosed.reject(e);
      });
      serverConn.resolve(sock);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const received: Buffer[] = [];
      const client = tls.connect({
        port: (server.address() as AddressInfo).port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
      });
      await once(client, "secureConnect");
      // Stop reading before the server writes so the payload backs up and
      // (past the kernel buffers) spills on the server side.
      client.pause();
      client.on("data", function onData(c: Buffer) {
        received.push(c);
      });
      client.on("end", function onEnd() {
        clientEnded.resolve();
      });
      client.on("close", function onClose() {
        clientClosed.resolve();
      });
      client.on("error", function onErr(e) {
        clientClosed.reject(e);
      });

      const sock = await serverConn.promise;
      sock.write(payload);
      sock.end();
      // Late peer data while the server-side close is deferred on the spill.
      client.write("late-peer-data");
      client.resume();

      await clientEnded.promise;
      client.end();
      await Promise.all([serverClosed.promise, clientClosed.promise]);

      const got = Buffer.concat(received);
      expect(got.length).toBe(payload.length);
      expect(got.equals(payload)).toBe(true);
      expect(Buffer.concat(serverGot).toString()).toBe("late-peer-data");
    } finally {
      server.close();
    }
  });
});

describe.each(["tls", "net"])("%s server socket whose peer resets the connection behind unread data", transport => {
  // The peer sends data while the accepted socket is paused, then resets the
  // connection (RST) instead of ending it. Node reports that as a read
  // error and never emits 'end'. allowHalfOpen keeps the accepted socket open
  // after an 'end', so a reset misreported as an orderly end strands it.
  async function acceptPausedSocketAndFill() {
    const accepted = Promise.withResolvers<net.Socket>();
    const onConnection = (socket: net.Socket) => {
      socket.pause();
      accepted.resolve(socket);
    };
    const server =
      transport === "tls"
        ? createServer({ ...COMMON_CERT, allowHalfOpen: true }, onConnection)
        : net.createServer({ allowHalfOpen: true }, onConnection);
    await once(server.listen(0, "127.0.0.1"), "listening");

    const peerReady = Promise.withResolvers<void>();
    const peer = await Bun.connect({
      hostname: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      tls: transport === "tls" ? { ca: COMMON_CERT.cert } : undefined,
      socket: {
        open() {
          if (transport !== "tls") peerReady.resolve();
        },
        handshake(_peer, success, verifyError) {
          if (success) peerReady.resolve();
          else peerReady.reject(verifyError ?? new Error("handshake failed"));
        },
        data() {},
        close() {},
        error(_peer, error) {
          peerReady.reject(error);
        },
        connectError(_peer, error) {
          peerReady.reject(error);
        },
      },
    });
    const socket = await accepted.promise;
    await peerReady.promise;

    const events: string[] = [];
    let bytes = 0;
    // Settles on 'close', or on the 'end' that must not happen, so a failure does
    // not wait for the test timeout on a socket left half-open.
    const settled = Promise.withResolvers<void>();
    socket.on("data", chunk => (bytes += chunk.length));
    socket.on("end", () => {
      events.push("end");
      settled.resolve();
    });
    socket.on("error", error => events.push(`error ${(error as NodeJS.ErrnoException).code}`));
    socket.on("close", hadError => {
      events.push(`close hadError=${hadError}`);
      settled.resolve();
    });
    // Paused again: the 'data' listener above switched the stream to flowing.
    socket.pause();

    const t = {
      socket,
      peer,
      events,
      bytesRead: () => bytes,
      settled: settled.promise,
      [Symbol.dispose]() {
        socket.destroy();
        server.close();
      },
    };
    // One chunk that fits: it is queued ahead of the reset and the receive window
    // stays open. macOS drops an RST that arrives at a zero window, so filling
    // the buffers would strand the socket there.
    const chunk = Buffer.alloc(64 * 1024, "r");
    const written = peer.write(chunk);
    if (written !== chunk.length) {
      t[Symbol.dispose]();
      throw new Error(`short write: ${written} of ${chunk.length}`);
    }
    return t;
  }

  it("reports the reset that arrives while the socket is paused as ECONNRESET, not 'end'", async () => {
    using t = await acceptPausedSocketAndFill();
    t.peer.terminate();
    await t.settled;
    expect(t.events).toEqual(["error ECONNRESET", "close hadError=true"]);
    // The data queued ahead of the reset was read off the socket before it closed
    // (kept in the paused stream's buffer), not discarded with the fd. Windows
    // discards the receive queue on a reset.
    if (!isWindows) expect(t.socket.bytesRead).toBe(64 * 1024);
  });

  it("delivers the data queued ahead of the reset and then reports ECONNRESET, not 'end'", async () => {
    using t = await acceptPausedSocketAndFill();
    // Both happen before the event loop runs again, so the socket's next read
    // event carries the queued data and the reset together: the read loop drains
    // the data and then gets the error from recv().
    t.socket.resume();
    t.peer.terminate();
    await t.settled;
    expect(t.events).toEqual(["error ECONNRESET", "close hadError=true"]);
    // Windows discards the receive queue on a reset. Linux and macOS keep it, and
    // like node, the data is delivered before the error.
    if (!isWindows) expect(t.bytesRead()).toBeGreaterThan(0);
  });
});

describe.each(["tls", "net"])("%s server socket that unpipe() paused after it end()ed", transport => {
  // A front server pipes each accepted socket to an upstream connection and back.
  // The upstream replies and closes: inner.pipe(sock) end()s sock, and the cleanup
  // of sock.pipe(inner) unpipes sock, which pauses it with nothing left to resume
  // it. The peer then closes. Node delivers 'end' and 'close' to the paused
  // socket, so the connection count drops and server.close() calls back.
  it("still emits 'end' and 'close' when the peer closes, and server.close() completes", async () => {
    const upstream = net.createServer(s => s.on("data", () => s.end("reply")));
    await once(upstream.listen(0, "127.0.0.1"), "listening");
    const serverEvents: string[] = [];
    const serverSocketClosed = Promise.withResolvers<void>();
    const onConnection = (sock: net.Socket) => {
      const inner = net.connect((upstream.address() as AddressInfo).port, "127.0.0.1", () => {
        sock.pipe(inner);
        inner.pipe(sock);
      });
      inner.on("close", () => serverEvents.push(`upstream closed, paused=${sock.isPaused()}`));
      sock.on("end", () => serverEvents.push("end"));
      sock.on("close", hadError => {
        serverEvents.push(`close hadError=${hadError}`);
        serverSocketClosed.resolve();
      });
      sock.on("error", serverSocketClosed.reject);
    };
    const front = transport === "tls" ? createServer(COMMON_CERT, onConnection) : net.createServer(onConnection);
    await once(front.listen(0, "127.0.0.1"), "listening");
    const frontClosed = Promise.withResolvers<void>();
    const upstreamClosed = Promise.withResolvers<void>();
    try {
      const port = (front.address() as AddressInfo).port;
      const clientEvents: string[] = [];
      const clientClosed = Promise.withResolvers<void>();
      const onConnect = () => client.write("hi");
      const client: net.Socket =
        transport === "tls"
          ? connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, onConnect)
          : net.connect({ port, host: "127.0.0.1" }, onConnect);
      client.setEncoding("utf8");
      client.on("data", chunk => clientEvents.push(`data ${chunk}`));
      client.on("end", () => clientEvents.push("end"));
      client.on("close", () => {
        clientEvents.push("close");
        clientClosed.resolve();
      });
      client.on("error", clientClosed.reject);
      await Promise.all([clientClosed.promise, serverSocketClosed.promise]);
      expect({ clientEvents, serverEvents }).toEqual({
        clientEvents: ["data reply", "end", "close"],
        serverEvents: ["upstream closed, paused=true", "end", "close hadError=false"],
      });
    } finally {
      front.close(err => (err ? frontClosed.reject(err) : frontClosed.resolve()));
      upstream.close(err => (err ? upstreamClosed.reject(err) : upstreamClosed.resolve()));
    }
    // Both connections are gone, so both servers call back.
    await Promise.all([frontClosed.promise, upstreamClosed.promise]);
  });
});

describe("pauseOnConnect", () => {
  it("hands out the accepted socket paused after the handshake and reads nothing until resume()", async () => {
    const server = createServer({ ...COMMON_CERT, pauseOnConnect: true });
    const accepted = Promise.withResolvers<TLSSocket>();
    server.on("secureConnection", accepted.resolve);
    server.on("tlsClientError", accepted.reject);
    await once(server.listen(0, "127.0.0.1"), "listening");
    // A second connection is the barrier: its bytes reach this process after the
    // client's "hello" reached the paused socket's receive buffer.
    const probe = net.createServer();
    const probed = Promise.withResolvers<void>();
    probe.on("connection", socket => socket.once("data", () => probed.resolve()));
    await once(probe.listen(0, "127.0.0.1"), "listening");
    const client = connect({
      port: (server.address() as AddressInfo).port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
    });
    const clientSecure = once(client, "secureConnect");
    try {
      const socket = await accepted.promise;
      expect(socket.isPaused()).toBe(true);
      await clientSecure;
      await new Promise<void>((resolve, reject) => client.write("hello", err => (err ? reject(err) : resolve())));
      const probeClient = net.connect((probe.address() as AddressInfo).port, "127.0.0.1", () => probeClient.end("x"));
      await probed.promise;
      // Node's TLSWrap reads ahead here (bytesRead would be 5). Ours stops reading once the
      // handshake completed, so bytes sent after it stay in the kernel (app data that shares
      // a segment with the client's Finished is still decrypted and buffered).
      expect({ paused: socket.isPaused(), bytesRead: socket.bytesRead }).toEqual({ paused: true, bytesRead: 0 });
      const received = once(socket, "data");
      socket.resume();
      const [chunk] = await received;
      expect(String(chunk)).toBe("hello");
      const clientClosed = once(client, "close");
      socket.end();
      client.end();
      await clientClosed;
    } finally {
      server.close();
      probe.close();
    }
  });
});

it("an accepted socket emits 'close' when a write is the first to see the peer's reset", async () => {
  // A send() that fails with the reset consumes the socket error, so the loop then sees a
  // plain hangup and the native close carries no error. With the rest of the write still
  // waiting for a drain, the socket emitted 'end' and nothing else: no write callback, no
  // 'error', no 'close', and the server counted it forever.
  //
  // The server is a child process so that it can stop polling: it reports the accepted
  // socket, then blocks on stdin until this process has reset the connection.
  //
  // A socket that never closes gives no event to wait for, so a second connection asks.
  // Its handshake takes several turns of the server's loop, and the reset socket closes in
  // the first of them or not at all. The server reports when the second connection arrives.
  const serverScript = `
    const tls = require("node:tls");
    const fs = require("node:fs");
    const events = [];
    let accepted;
    const server = tls.createServer(${JSON.stringify(COMMON_CERT)}, socket => {
      if (accepted) {
        server.getConnections((err, connections) => {
          console.log(JSON.stringify({ events, connections }));
          // Also the first socket, so that this process exits when it never closed.
          accepted.destroy();
          socket.destroy();
          server.close();
        });
        return;
      }
      accepted = socket;
      socket.on("error", () => events.push("error"));
      socket.on("close", hadError => events.push("close:" + hadError));
      socket.resume();
      fs.writeSync(1, "accepted\\n");
      fs.readSync(0, Buffer.alloc(1));
      // More than the TLS layer takes once the wire rejects a record, so the rest is parked.
      socket.write(Buffer.alloc(1 << 20));
      fs.writeSync(1, "wrote\\n");
    });
    server.listen(0, "127.0.0.1", () => fs.writeSync(1, "port=" + server.address().port + "\\n"));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", serverScript],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drain stderr while stdout is scanned, so a child that logs a lot cannot block on it.
  const stderrText = proc.stderr.text();
  let stdout = "";
  let raw: net.Socket | undefined;
  let probe: net.Socket | undefined;
  let reset = false;
  for await (const chunk of proc.stdout) {
    stdout += Buffer.from(chunk).toString();
    const port = /port=(\d+)/.exec(stdout);
    if (port && !raw) {
      raw = net.connect(Number(port[1]), "127.0.0.1");
      raw.on("error", () => {});
      connect({ socket: raw, rejectUnauthorized: false }).on("error", () => {});
    }
    if (raw && !reset && stdout.includes("accepted\n")) {
      reset = true;
      raw.resetAndDestroy();
      proc.stdin.write("x");
      proc.stdin.flush();
    }
    if (port && !probe && stdout.includes("wrote\n")) {
      probe = connect({ port: Number(port[1]), host: "127.0.0.1", rejectUnauthorized: false });
      probe.on("error", () => {});
    }
  }
  const [stderr, exitCode] = await Promise.all([stderrText, proc.exited]);
  probe?.destroy();
  expect(stderr).toBe("");
  const lines = stdout.trim().split("\n");
  // The one connection left is the second one.
  expect(JSON.parse(lines[lines.length - 1])).toEqual({ events: ["error", "close:true"], connections: 1 });
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

describe("key/cert arrays", () => {
  const read = (name: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", name), "utf8");
  const encrypt = (pem: string, passphrase: string) =>
    crypto.createPrivateKey(pem).export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase }) as string;
  const rsa = { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") };
  const ec = { key: read("ec10-key.pem"), cert: read("ec10-cert.pem") };
  const otherRsa = { key: read("agent2-key.pem"), cert: read("agent2-cert.pem") };
  const thirdRsa = { key: read("agent3-key.pem"), cert: read("agent3-cert.pem") };
  const both = { key: [rsa.key, ec.key], cert: [rsa.cert, ec.cert] };

  /** "<CN of the leaf>/<certificates sent>", or the error code. */
  function served(port: number, options: tls.ConnectionOptions) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const socket = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...options }, () => {
      let sent = 0;
      const seen = new Set<string>();
      for (let c = socket.getPeerCertificate(true); c && !seen.has(c.fingerprint256); c = c.issuerCertificate) {
        seen.add(c.fingerprint256);
        sent++;
      }
      resolve(`${socket.getPeerCertificate().subject.CN}/${sent}`);
      socket.destroy();
    });
    socket.on("error", e => resolve((e as NodeJS.ErrnoException).code!.replace("SSL/TLS_ALERT", "SSLV3_ALERT")));
    socket.on("close", () => resolve("closed"));
    return promise;
  }

  async function servedToEachKindOfClient(port: number, options: tls.ConnectionOptions = {}) {
    return {
      "TLS 1.2, ECDSA only": await served(port, {
        ...options,
        maxVersion: "TLSv1.2",
        ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256",
      }),
      "TLS 1.2, RSA only": await served(port, {
        ...options,
        maxVersion: "TLSv1.2",
        ciphers: "ECDHE-RSA-AES128-GCM-SHA256",
      }),
      "TLS 1.3": await served(port, options),
      "TLS 1.3, RSA only": await served(port, { ...options, sigalgs: "rsa_pss_rsae_sha256" }),
    };
  }

  async function listen(server: net.Server) {
    server.on("tlsClientError", () => {});
    await once(server.listen(0, "127.0.0.1"), "listening");
    return { port: (server.address() as AddressInfo).port, [Symbol.dispose]: () => void server.close() };
  }

  const each = (ecdsa: string, rsa: string, tls13 = ecdsa) => ({
    "TLS 1.2, ECDSA only": ecdsa,
    "TLS 1.2, RSA only": rsa,
    "TLS 1.3": tls13,
    "TLS 1.3, RSA only": rsa,
  });
  const refused = "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE";

  it.each([
    ["RSA, then ECDSA", both, each("agent10.example.com/2", "agent1/1")],
    [
      "ECDSA, then RSA",
      { key: [ec.key, rsa.key], cert: [ec.cert, rsa.cert] },
      each("agent10.example.com/2", "agent1/1"),
    ],
    [
      "keys and certificates in opposite orders",
      { key: [ec.key, rsa.key], cert: both.cert },
      each("agent10.example.com/2", "agent1/1"),
    ],
    [
      "a chain in each entry",
      { key: both.key, cert: [rsa.cert + read("ca1-cert.pem"), ec.cert + read("ca5-cert.pem")] },
      each("agent10.example.com/3", "agent1/2"),
    ],
    [
      "encrypted keys",
      { key: [encrypt(rsa.key, "secret"), encrypt(ec.key, "secret")], cert: both.cert, passphrase: "secret" },
      each("agent10.example.com/2", "agent1/1"),
    ],
    ["a key with no certificate", { key: [ec.key, rsa.key], cert: [rsa.cert] }, each(refused, "agent1/1", "agent1/1")],
    ["a certificate with no key", { key: [rsa.key], cert: both.cert }, each(refused, "agent1/1", "agent1/1")],
    [
      "a pfx array",
      {
        pfx: [
          { buf: readFileSync(join(import.meta.dir, "../test/fixtures/keys/agent1.pfx")), passphrase: "sample" },
          readFileSync(join(import.meta.dir, "../test/fixtures/keys/ec.pfx")),
        ],
      },
      each("agent2/1", "agent1/2"),
    ],
  ] as const)("every identity is served to the clients that can use it: %s", async (_, options, expected) => {
    using server = await listen(createServer(options as tls.TlsOptions, socket => socket.on("error", () => {})));
    expect(await servedToEachKindOfClient(server.port)).toEqual(expected);
  });

  it.each([
    ["in the order of the certificates", [rsa.key, otherRsa.key]],
    ["in the opposite order", [otherRsa.key, rsa.key]],
  ])("of two certificates of one key type the last is served, with its own key: keys %s", async (_, key) => {
    const options = { key: [...key, ec.key], cert: [rsa.cert, otherRsa.cert, ec.cert] };
    // Node v26.3.0 refuses these: there every key of a type has to match the last certificate of that type.
    if (!process.versions.bun) {
      expect(() => createServer(options)).toThrow(
        expect.objectContaining({ code: "ERR_OSSL_X509_KEY_VALUES_MISMATCH" }),
      );
      return;
    }
    using server = await listen(createServer(options, socket => socket.on("error", () => {})));
    expect(await servedToEachKindOfClient(server.port)).toEqual(each("agent10.example.com/2", "agent2/1"));
  });

  it("two pairs of one key type serve the last pair", async () => {
    // Node v26.3.0 throws ERR_OSSL_X509_KEY_VALUES_MISMATCH for the first of these.
    if (process.versions.bun) {
      using pairs = await listen(createServer({ key: [rsa.key, otherRsa.key], cert: [rsa.cert, otherRsa.cert] }));
      expect(await served(pairs.port, {})).toBe("agent2/1");
    }
    using server = await listen(createServer({ key: [otherRsa.key], cert: [rsa.cert, otherRsa.cert] }));
    expect(await served(server.port, {})).toBe("agent2/1");
  });

  it("a certificate whose only same-type keys do not fit is refused", () => {
    for (const options of [
      { key: [otherRsa.key, ec.key], cert: both.cert },
      { key: [rsa.key], cert: [rsa.cert, otherRsa.cert] },
      { key: [rsa.key, read("ec-key.pem")], cert: both.cert },
    ]) {
      expect(() => tls.createSecureContext(options)).toThrow(
        expect.objectContaining({ code: "ERR_OSSL_X509_KEY_VALUES_MISMATCH" }),
      );
    }
    expect(() => tls.createSecureContext({ key: [rsa.key, "not a key"], cert: [rsa.cert] })).toThrow();
    expect(() => tls.createSecureContext({ key: [rsa.key], cert: [rsa.cert, "not a certificate"] })).toThrow();
    expect(() =>
      tls.createSecureContext({ ...both, key: [encrypt(rsa.key, "secret"), ec.key], passphrase: "no" }),
    ).toThrow();
  });

  // Node v26.3.0 copies one identity out of an SNI context, so its RSA-only clients get the default context's certificate.
  const sni = each("agent10.example.com/2", process.versions.bun ? "agent1/1" : "agent3/1");

  it("addContext() serves every identity of its context", async () => {
    const tlsServer = createServer(thirdRsa, socket => socket.on("error", () => {}));
    tlsServer.addContext("a.example", both);
    using server = await listen(tlsServer);
    expect(await servedToEachKindOfClient(server.port, { servername: "a.example" })).toEqual(sni);
    expect(await servedToEachKindOfClient(server.port, { servername: "b.example" })).toEqual(
      each(refused, "agent3/1", "agent3/1"),
    );
  });

  it("SNICallback serves every identity of the context it returns", async () => {
    const context = tls.createSecureContext(both);
    const SNICallback = (_: string, callback: (err: Error | null, ctx?: tls.SecureContext) => void) =>
      callback(null, context);
    using server = await listen(createServer({ ...thirdRsa, SNICallback }, socket => socket.on("error", () => {})));
    expect(await servedToEachKindOfClient(server.port, { servername: "a.example" })).toEqual(sni);
  });

  it("a server over a Duplex serves every identity", async () => {
    const secureContext = tls.createSecureContext(both);
    using server = await listen(
      net.createServer(raw => {
        const duplex = new Duplex({
          read() {},
          write(chunk, _, callback) {
            raw.write(chunk, callback);
          },
        });
        raw.on("data", chunk => duplex.push(chunk));
        raw.on("end", () => duplex.push(null));
        raw.on("error", () => {});
        new TLSSocket(duplex, { isServer: true, secureContext }).on("error", () => raw.destroy());
      }),
    );
    expect(await servedToEachKindOfClient(server.port)).toEqual(each("agent10.example.com/2", "agent1/1"));
  });

  it.each([
    ["TLSv1.3", "agent1"],
    // On TLS 1.2 Node v26.3.0 only considers the last identity, and sends no certificate here.
    ["TLSv1.2", process.versions.bun ? "agent1" : undefined],
  ] as const)("a %s client sends the identity the server can verify", async (version, expected) => {
    const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
    const tlsServer = createServer(
      {
        ...thirdRsa,
        requestCert: true,
        rejectUnauthorized: false,
        sigalgs: "rsa_pss_rsae_sha256",
        maxVersion: version,
      },
      socket => resolve(socket.getPeerCertificate().subject?.CN),
    );
    tlsServer.on("tlsClientError", reject);
    using server = await listen(tlsServer);
    const client = connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false, ...both });
    client.on("error", reject);
    try {
      expect(await promise).toBe(expected);
    } finally {
      client.destroy();
    }
  });

  describe("intermediates", () => {
    const certificates = (name: string) =>
      read(name).match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----\n/g)!;
    const [rsaLeaf, ca4] = certificates("agent10-cert.pem");
    const [ecLeaf, ca6] = certificates("ec10-cert.pem");
    const key = [read("agent10-key.pem"), ec.key];
    const roots = [read("ca2-cert.pem"), read("ca5-cert.pem")];
    const pfx = ["agent10.pfx", "ec10.pfx"].map(name => ({
      buf: readFileSync(join(import.meta.dir, "../test/fixtures/keys", name)),
      passphrase: "sample",
    }));

    /** The chain the server sent, then what a client that trusts only the roots makes of it. */
    async function chain(port: number, options: tls.ConnectionOptions) {
      const results: string[] = [];
      for (const ca of [undefined, roots]) {
        const { promise, resolve } = Promise.withResolvers<string>();
        const checkServerIdentity = () => undefined;
        const base = { port, host: "127.0.0.1", rejectUnauthorized: false, checkServerIdentity };
        const socket = connect({ ...base, ...options, ca }, () => {
          let c = socket.getPeerCertificate(true);
          const names = [c.subject.CN];
          // agent10.pfx also holds ca1, which issued nothing here: it is sent, and only Bun lists it as an issuer.
          for (
            ;
            c.issuerCertificate?.subject.CN === c.issuer.CN && c.issuerCertificate !== c;
            c = c.issuerCertificate
          ) {
            names.push(c.issuer.CN);
          }
          resolve(ca ? String(socket.authorizationError ?? "authorized") : names.join(" < "));
          socket.destroy();
        });
        socket.on("error", e => resolve((e as NodeJS.ErrnoException).code!));
        results.push(await promise);
      }
      return results.join(": ");
    }

    const leafOnly = "agent10.example.com: UNABLE_TO_VERIFY_LEAF_SIGNATURE";
    it.each([
      ["in `ca`", { key, cert: [rsaLeaf, ecLeaf], ca: [ca4, ca6] }, "ca6: authorized", "ca4: authorized"],
      [
        "in `ca`, up to the root",
        { key, cert: [rsaLeaf, ecLeaf], ca: [ca4, ca6, ...roots] },
        "ca6 < ca5: authorized",
        "ca4 < ca2: authorized",
      ],
      [
        "already in `cert`",
        { key, cert: [rsaLeaf + ca4, ecLeaf + ca6], ca: [ca4, ca6, ...roots] },
        "ca6: authorized",
        "ca4: authorized",
      ],
      ["in a pfx array", { pfx }, "ca6: authorized", "ca4: authorized"],
      [
        "in a pfx next to key and cert",
        { key: [ec.key], cert: [ecLeaf + ca6], pfx: pfx[0].buf, passphrase: "sample" },
        "ca6: authorized",
        "ca4: authorized",
      ],
      [
        "in the pfx array of a secureContext",
        { secureContext: tls.createSecureContext({ pfx }) },
        "ca6: authorized",
        "ca4: authorized",
      ],
      ["nowhere", { key, cert: [rsaLeaf, ecLeaf] }, undefined, undefined],
    ] as const)("%s", async (_, options, ecdsa, rsa) => {
      using server = await listen(
        "secureContext" in options
          ? net.createServer(
              raw => void new TLSSocket(raw, { isServer: true, ...options }).on("error", () => raw.destroy()),
            )
          : createServer(options as tls.TlsOptions, socket => socket.on("error", () => {})),
      );
      expect({
        "TLS 1.2, ECDSA only": await chain(server.port, {
          maxVersion: "TLSv1.2",
          ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256",
        }),
        "TLS 1.2, RSA only": await chain(server.port, {
          maxVersion: "TLSv1.2",
          ciphers: "ECDHE-RSA-AES128-GCM-SHA256",
        }),
        "TLS 1.3": await chain(server.port, {}),
        "TLS 1.3, RSA only": await chain(server.port, { sigalgs: "rsa_pss_rsae_sha256" }),
      }).toEqual(
        each(ecdsa ? `agent10.example.com < ${ecdsa}` : leafOnly, rsa ? `agent10.example.com < ${rsa}` : leafOnly),
      );
    });
  });
});

// close() keeps the connections it accepted, and each selects its context when its ClientHello arrives.
describe.each(["TLSv1.2", "TLSv1.3"] as const)("server names after close() (%s)", version => {
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
  const agent = (n: number) => ({ key: fixture(`agent${n}-key.pem`), cert: fixture(`agent${n}-cert.pem`) });

  // `count` connections the server has accepted and that have not sent a TLS byte yet.
  async function acceptRaw(server: Server, count: number) {
    server.on("secureConnection", socket => socket.on("error", () => {}).end());
    server.on("tlsClientError", () => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const accepted = Promise.withResolvers<void>();
    let connections = 0;
    server.on("connection", () => ++connections === count && accepted.resolve());
    const raws = Array.from({ length: count }, () => net.connect(port, "127.0.0.1").on("error", () => {}));
    await accepted.promise;
    return raws;
  }

  // The CN of the certificate the server presents, or "no handshake".
  function servedCN(socket: net.Socket, servername: string) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const options = { socket, servername, rejectUnauthorized: false, minVersion: version, maxVersion: version };
    const client = connect(options, () => {
      resolve((client.getPeerCertificate() as PeerCertificate).subject.CN);
      client.destroy();
    });
    client.on("error", () => {});
    client.on("close", () => resolve("no handshake"));
    return promise;
  }

  // Bun only: in Node a user SNICallback replaces the addContext() entries, so this is agent2 there.
  it("an SNICallback that is pending at close() and then selects nothing falls back to addContext()", async () => {
    const pending = Promise.withResolvers<Function>();
    const server: Server = createServer({ ...agent(2), SNICallback: (_, cb) => pending.resolve(cb) });
    server.addContext("a.example", agent(3));
    const [raw] = await acceptRaw(server, 1);
    const served = servedCN(raw, "a.example");
    const cb = await pending.promise;
    server.close();
    cb(null, null);
    expect(await served).toBe("agent3");
  });

  it("close() from inside the SNICallback does not end it for the other connections", async () => {
    let calls = 0;
    const server: Server = createServer({
      ...agent(2),
      SNICallback(_, cb) {
        calls++;
        if (server.listening) server.close();
        cb(null, tls.createSecureContext(agent(1)));
      },
    });
    const raws = await acceptRaw(server, 3);
    const served: string[] = [];
    for (const raw of raws) served.push(await servedCN(raw, "a.example"));
    expect({ served, calls }).toEqual({ served: ["agent1", "agent1", "agent1"], calls: 3 });
  });

  it("an accepted connection sees addContext() and keeps its default across setSecureContext()", async () => {
    const server: Server = createServer(agent(2));
    // Node looks names up only on connections accepted while the server had an entry.
    server.addContext("early.example", agent(1));
    const raws = await acceptRaw(server, 2);
    server.addContext("late.example", agent(3));
    server.setSecureContext(agent(1));
    server.close();
    expect(await Promise.all([servedCN(raws[0], "late.example"), servedCN(raws[1], "other.example")])).toEqual([
      "agent3",
      "agent2",
    ]);
  });

  // In a process of its own: a count taken here would include what earlier tests left for the GC.
  it("the names last as long as the connections, and no longer", async () => {
    const script = `
      const { sslCtxLiveCount } = require("bun:internal-for-testing");
      const net = require("node:net"), tls = require("node:tls"), { once } = require("node:events");
      const agent = ${JSON.stringify([, agent(1), agent(2)])};
      const before = sslCtxLiveCount();
      const result = {};

      // Nothing here outlives the call but the raw client sockets and the 'close' promise.
      async function serve() {
        const server = tls.createServer({ ...agent[2], sessionTimeout: 4001 }, s => s.on("error", () => {}).end());
        for (let i = 0; i < 4; i++) {
          server.addContext(i + ".example", tls.createSecureContext({ ...agent[1], sessionTimeout: 4002 + i }));
        }
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const accepted = Promise.withResolvers();
        let connections = 0;
        server.on("connection", () => ++connections === 4 && accepted.resolve());
        const raws = [0, 1, 2, 3].map(() => net.connect(server.address().port, "127.0.0.1"));
        await accepted.promise;
        const closed = once(server, "close");
        server.close();
        return { raws, closed };
      }

      const { raws, closed } = await serve();
      Bun.gc(true);
      result.open = sslCtxLiveCount() - before;
      result.served = await Promise.all(
        raws.map(async (socket, i) => {
          const client = tls.connect({
            socket,
            servername: i + ".example",
            rejectUnauthorized: false,
            minVersion: "${version}",
            maxVersion: "${version}",
          });
          await once(client, "secureConnect");
          const { CN } = client.getPeerCertificate().subject;
          client.destroy();
          return CN;
        }),
      );
      await closed;
      // Finalizers run on GC, so wait for the condition.
      for (let i = 0; i < 10 && sslCtxLiveCount() !== before; i++) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      result.left = sslCtxLiveCount() - before;
      console.log(JSON.stringify(result));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, result: JSON.parse(stdout || "null") }).toEqual({
      stderr: "",
      result: {
        // The 4 entries, the server's own (_sharedCreds, which the listener served and each accepted
        // SSL holds), and the one the accepted TLSSockets share.
        open: 6,
        served: ["agent1", "agent1", "agent1", "agent1"],
        left: 0,
      },
    });
    expect(exitCode).toBe(0);
  });
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L924-L931
describe.each(["TLSv1.2", "TLSv1.3"] as const)("addContext() on connections the server wraps itself (%s)", version => {
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
  const agent = (n: number) => ({ key: fixture(`agent${n}-key.pem`), cert: fixture(`agent${n}-cert.pem`) });

  // Serves `tlsServer` through server.emit("connection"), which no listener's names apply to.
  async function inject(tlsServer: Server) {
    tlsServer.on("secureConnection", socket => socket.on("error", () => {}).end());
    const front = net.createServer(raw => tlsServer.emit("connection", raw));
    front.listen(0, "127.0.0.1");
    await once(front, "listening");
    const { port } = front.address() as AddressInfo;
    return {
      async servedCN(servername: string) {
        const client = connect({
          port,
          host: "127.0.0.1",
          servername,
          rejectUnauthorized: false,
          minVersion: version,
          maxVersion: version,
        });
        try {
          await once(client, "secureConnect");
          return (client.getPeerCertificate() as PeerCertificate).subject.CN;
        } finally {
          client.destroy();
        }
      },
      [Symbol.dispose]: () => void front.close(),
    };
  }

  it("selects the entry that matches the servername", async () => {
    const tlsServer = createServer(agent(1));
    tlsServer.addContext("exact.example", agent(2));
    tlsServer.addContext("*.wild.example", agent(3));
    tlsServer.addContext("twice.example", agent(3));
    tlsServer.addContext("twice.example", agent(2));
    using injected = await inject(tlsServer);
    expect({
      exact: await injected.servedCN("exact.example"),
      wildcard: await injected.servedCN("a.wild.example"),
      twice: await injected.servedCN("twice.example"),
      twoLabels: await injected.servedCN("a.b.wild.example"),
      unknown: await injected.servedCN("other.example"),
    }).toEqual({ exact: "agent2", wildcard: "agent3", twice: "agent2", twoLabels: "agent1", unknown: "agent1" });
  });

  it("a user SNICallback replaces the entries", async () => {
    const tlsServer = createServer({ ...agent(1), SNICallback: (_, cb) => cb(null, null) });
    tlsServer.addContext("exact.example", agent(2));
    using injected = await inject(tlsServer);
    expect(await injected.servedCN("exact.example")).toBe("agent1");
  });

  // Bun's listener and this path share one matcher. Node >= 26.4.0 folds case too, and takes no root dot.
  it("matches a name like the server's own listener does", async () => {
    const tlsServer = createServer(agent(1), socket => socket.on("error", () => {}).end());
    tlsServer.addContext("Exact.Example", agent(2));
    tlsServer.addContext("*.example", agent(3));
    using injected = await inject(tlsServer);
    tlsServer.listen(0, "127.0.0.1");
    await once(tlsServer, "listening");
    try {
      const { port } = tlsServer.address() as AddressInfo;
      for (const servername of ["exact.example", "EXACT.EXAMPLE", "exact.example.", "other.example", "a.b.example"]) {
        const client = connect({ port, host: "127.0.0.1", servername, rejectUnauthorized: false });
        await once(client, "secureConnect");
        const accepted = (client.getPeerCertificate() as PeerCertificate).subject.CN;
        client.destroy();
        expect([servername, await injected.servedCN(servername)]).toEqual([servername, accepted]);
      }
      expect(await injected.servedCN("EXACT.EXAMPLE.")).toBe("agent2");
    } finally {
      tlsServer.close();
    }
  });
});

it("addContext() with a NUL in the name registers nothing under the part before it", async () => {
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
  const agent = (n: number) => ({ key: fixture(`agent${n}-key.pem`), cert: fixture(`agent${n}-cert.pem`) });
  const server: Server = createServer(agent(1), socket => socket.on("error", () => {}).end());
  const front = net.createServer(raw => server.emit("connection", raw));
  try {
    server.addContext("before.example\0evil", agent(2));
    server.listen(0, "127.0.0.1");
    front.listen(0, "127.0.0.1");
    await Promise.all([once(server, "listening"), once(front, "listening")]);
    server.addContext("after.example\0evil", agent(2));
    const served: Record<string, string> = {};
    for (const [path, { port }] of Object.entries({ accepted: server.address(), injected: front.address() })) {
      for (const servername of ["before.example", "after.example"]) {
        const client = connect({ port, host: "127.0.0.1", servername, rejectUnauthorized: false });
        await once(client, "secureConnect");
        served[`${path} ${servername}`] = (client.getPeerCertificate() as PeerCertificate).subject.CN;
        client.destroy();
      }
    }
    expect(served).toEqual({
      "accepted before.example": "agent1",
      "accepted after.example": "agent1",
      "injected before.example": "agent1",
      "injected after.example": "agent1",
    });
  } finally {
    front.close();
    server.close();
  }
});

it("tls.DEFAULT_CIPHERS applies to every context built without a ciphers option", async () => {
  // Without the Bun rows this script prints the same on Node.js v26.3.0.
  const script = `
    import tls from "node:tls";
    import https from "node:https";
    import net from "node:net";
    import { once } from "node:events";
    const cert = ${JSON.stringify({ key: cert1.key, cert: cert1.cert })};
    const AES128 = "ECDHE-RSA-AES128-GCM-SHA256", AES256 = "ECDHE-RSA-AES256-GCM-SHA384";

    function probe(port, ciphers) {
      return new Promise(resolve => {
        const c = tls.connect({ port, host: "127.0.0.1", ciphers, maxVersion: "TLSv1.2", rejectUnauthorized: false });
        c.on("secureConnect", () => (resolve(c.getCipher().name), c.destroy()));
        c.on("error", e => resolve(e.code.replace(/^ERR_SSL_(SSLV3|SSL\\/TLS)_/, "")));
      });
    }
    const listen = async server => (await once(server.listen(0, "127.0.0.1"), "listening"), server.address().port);
    const end = socket => socket.end("x");

    const ports = { before: await listen(tls.createServer(cert, end)) };
    tls.DEFAULT_CIPHERS = AES128;
    ports.tls = await listen(tls.createServer(cert, end));
    ports.https = await listen(https.createServer(cert, (req, res) => res.end("x")));
    const injected = tls.createServer(cert, end);
    ports.injected = await listen(net.createServer(raw => injected.emit("connection", raw)));
    ports.explicit = await listen(tls.createServer({ ...cert, ciphers: AES256 }, end));
    const results = {};
    if (typeof Bun !== "undefined") {
      ports.serve = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: cert, fetch: () => new Response("x") }).port;
      ports.listen = Bun.listen({ port: 0, hostname: "127.0.0.1", tls: cert, socket: { data() {} } }).port;
      results.connect = await new Promise(resolve =>
        Bun.connect({
          hostname: "127.0.0.1",
          port: ports.explicit,
          tls: { rejectUnauthorized: false, maxVersion: 0x0303 },
          socket: {
            handshake: (socket, success, error) => resolve(socket.getCipher().name ?? error.code),
            close: () => resolve("closed"),
            data() {},
            error() {},
          },
        }),
      );
      // The TLS 1.2 suites in the ClientHello of \`tls: true\`.
      results.tlsTrue = await new Promise(resolve => {
        const raw = net.createServer(socket => {
          let hello = Buffer.alloc(0);
          socket.on("data", chunk => {
            hello = Buffer.concat([hello, chunk]);
            if (hello.length < 5 || hello.length < 5 + hello.readUInt16BE(3)) return;
            const at = 5 + 4 + 2 + 32 + 1 + hello[5 + 4 + 2 + 32];
            const suites = [];
            for (let i = at + 2; i < at + 2 + hello.readUInt16BE(at); i += 2) suites.push(hello.readUInt16BE(i));
            socket.destroy();
            resolve(suites.filter(suite => suite >> 8 !== 0x13));
          });
        });
        raw.listen(0, "127.0.0.1", () =>
          Bun.connect({ hostname: "127.0.0.1", port: raw.address().port, tls: true, socket: { data() {}, error() {} } }),
        );
      });
    }
    for (const [name, port] of Object.entries(ports)) results[name] = [await probe(port, AES256), await probe(port, AES128)];

    tls.DEFAULT_CIPHERS = "TLS_AES_128_GCM_SHA256";
    const tls13Only = await listen(tls.createServer(cert, end));
    results.tls13Only = [await probe(tls13Only, AES256), await probe(tls13Only, AES128)];
    console.log(JSON.stringify(results));
    process.exit(0);
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const AES128 = "ECDHE-RSA-AES128-GCM-SHA256";
  const AES256 = "ECDHE-RSA-AES256-GCM-SHA384";
  expect(JSON.parse(stdout)).toEqual({
    before: [AES256, AES128],
    tls: ["ALERT_HANDSHAKE_FAILURE", AES128],
    https: ["ALERT_HANDSHAKE_FAILURE", AES128],
    injected: ["ALERT_HANDSHAKE_FAILURE", AES128],
    explicit: [AES256, "ALERT_HANDSHAKE_FAILURE"],
    serve: ["ALERT_HANDSHAKE_FAILURE", AES128],
    listen: ["ALERT_HANDSHAKE_FAILURE", AES128],
    connect: "EPROTO",
    tlsTrue: [0xc02f],
    tls13Only: ["ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION", "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION"],
  });
  expect(exitCode).toBe(0);
});

it("tls.DEFAULT_CIPHERS reaches a client whatever its other TLS options are", async () => {
  using dir = tempDir("tls-default-ciphers", { "ca.pem": cert1.cert });
  const script = `
    import tls from "node:tls";
    import { once } from "node:events";
    import { Worker } from "node:worker_threads";
    const cert = ${JSON.stringify({ key: cert1.key, cert: cert1.cert })};
    const AES128 = "ECDHE-RSA-AES128-GCM-SHA256", AES256 = "ECDHE-RSA-AES256-GCM-SHA384";

    // Prefers AES128, as every client does until it is told otherwise.
    let seen;
    const server = tls.createServer({ ...cert, maxVersion: "TLSv1.2", ciphers: AES128 + ":" + AES256 }, socket => {
      seen.resolve(socket.getCipher().name);
      socket.on("error", () => {});
      socket.once("data", () => socket.end("HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n"));
    });
    server.on("tlsClientError", error => seen.resolve(error.code));
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address();
    const url = "https://localhost:" + port + "/";

    const clients = {
      "fetch": () => fetch(url, { keepalive: false }),
      "fetch, tls: {}": () => fetch(url, { keepalive: false, tls: {} }),
      "fetch, rejectUnauthorized": () => fetch(url, { keepalive: false, tls: { rejectUnauthorized: false } }),
      "fetch, ca": () => fetch(url, { keepalive: false, tls: { ca: cert.cert } }),
      "WebSocket": () => void new WebSocket(url.replace("https", "wss")),
      "WebSocket, rejectUnauthorized": () => void new WebSocket(url.replace("https", "wss"), { tls: { rejectUnauthorized: false } }),
      "RedisClient, tls: true": () => new Bun.RedisClient("rediss://localhost:" + port, { tls: true, autoReconnect: false }).connect(),
      "Bun.connect, tls: true": () => Bun.connect({ hostname: "localhost", port, tls: true, socket: { data() {}, error() {} } }),
    };
    const results = {};
    for (const list of [undefined, AES256, AES128, "TLS_AES_128_GCM_SHA256"]) {
      if (list) tls.DEFAULT_CIPHERS = list;
      for (const [name, connect] of Object.entries(clients)) {
        seen = Promise.withResolvers();
        Promise.resolve(connect()).catch(() => {});
        (results[name] ??= []).push(await seen.promise);
      }
    }
    // The list is the thread's, as in Node.js.
    seen = Promise.withResolvers();
    new Worker("new WebSocket(" + JSON.stringify(url.replace("https", "wss")) + ")", { eval: true });
    results.worker = await seen.promise;
    console.log(JSON.stringify(results));
    process.exit(0);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "ca.pem") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const AES128 = "ECDHE-RSA-AES128-GCM-SHA256";
  // Nothing assigned, a TLS 1.2 suite, another, TLS 1.3 suites only (which this TLS 1.2 server cannot serve).
  const row = [AES128, "ECDHE-RSA-AES256-GCM-SHA384", AES128, "ERR_SSL_UNSUPPORTED_PROTOCOL"];
  expect(JSON.parse(stdout)).toEqual({
    "fetch": row,
    "fetch, tls: {}": row,
    "fetch, rejectUnauthorized": row,
    "fetch, ca": row,
    "WebSocket": row,
    "WebSocket, rejectUnauthorized": row,
    "RedisClient, tls: true": row,
    "Bun.connect, tls: true": row,
    worker: AES128,
  });
  expect(exitCode).toBe(0);
});

// Node.js v26.3.0 throws the same from the first context built after the assignment.
it("tls.DEFAULT_CIPHERS refuses a list that selects no cipher", () => {
  const before = tls.DEFAULT_CIPHERS;
  for (const list of ["!aNULL", "ALL:!ALL", "@STRENGTH"]) {
    expect(() => {
      tls.DEFAULT_CIPHERS = list;
    }).toThrow(expect.objectContaining({ code: "ERR_SSL_NO_CIPHER_MATCH" }));
  }
  expect(tls.DEFAULT_CIPHERS).toBe(before);
});

// https://github.com/oven-sh/bun/issues/33954
it.each([
  [{ requestCert: true }, "agent1"],
  [{}, undefined],
])(
  "new TLSSocket(socket, { isServer: true, ...%j }) asks for a client certificate with requestCert only",
  async (options, peer) => {
    const fixtures = join(import.meta.dir, "fixtures");
    const identity = {
      key: readFileSync(join(fixtures, "agent1-key.pem"), "utf8"),
      cert: readFileSync(join(fixtures, "agent1-cert.pem"), "utf8"),
    };
    const secure = Promise.withResolvers<string | undefined>();
    const rawServer = net.createServer(raw => {
      const socket = new TLSSocket(raw, { isServer: true, ...identity, ...options });
      socket.on("secure", () => secure.resolve(socket.getPeerCertificate()?.subject?.CN));
      socket.on("data", data => socket.write(data));
      socket.on("error", secure.reject);
    });
    await once(rawServer.listen(0, "127.0.0.1"), "listening");
    const client = connect({
      host: "127.0.0.1",
      port: (rawServer.address() as AddressInfo).port,
      ...identity,
      rejectUnauthorized: false,
    });
    try {
      client.on("error", secure.reject);
      expect(await secure.promise).toBe(peer);
      // The wrap trusts no CA, and without rejectUnauthorized it keeps the connection.
      client.write("ping");
      expect(String((await once(client, "data"))[0])).toBe("ping");
    } finally {
      client.destroy();
      rawServer.close();
    }
  },
);

describe("a tls.Server nothing refers to any more is collected", () => {
  it.each([
    ["never listened", async (_: Server) => {}],
    [
      "listened and closed",
      async (server: Server) => {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        server.close();
        await once(server, "close");
      },
    ],
  ])("%s", async (_, use) => {
    const ref = await (async () => {
      const server: Server = createServer(COMMON_CERT);
      server.addContext("a.example", COMMON_CERT);
      await use(server);
      return new WeakRef(server);
    })();
    // A WeakRef keeps its target until the job that created it ends.
    await new Promise<void>(resolve => setImmediate(resolve));
    Bun.gc(true);
    expect(ref.deref()).toBeUndefined();
  });
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L480-L488
describe("a server-side handshake failure reported under a JS call emits 'close'", () => {
  // `wrap` writes a plain banner, so `peer` runs once the wrap is in place.
  async function failHandshake(
    wrap: (conn: net.Socket) => TLSSocket,
    peer: (client: net.Socket) => void,
  ): Promise<string[]> {
    const events: string[] = [];
    const closed = Promise.withResolvers<string[]>();
    let conn: net.Socket | undefined;
    const rawServer = net.createServer(socket => {
      conn = socket;
      conn.on("error", () => {});
      const wrapped = wrap(conn);
      wrapped.on("error", () => events.push("error"));
      wrapped.on("close", hadError => {
        events.push(`close:${hadError}`);
        closed.resolve(events);
      });
    });
    let client: net.Socket | undefined;
    try {
      await once(rawServer.listen(0, "127.0.0.1"), "listening");
      client = net.connect((rawServer.address() as AddressInfo).port, "127.0.0.1");
      client.on("error", () => {});
      client.once("data", () => peer(client!));
      return await closed.promise;
    } finally {
      client?.destroy();
      conn?.destroy();
      rawServer.close();
    }
  }

  const serverOptions = (extra: tls.TlsOptions = {}) => ({ isServer: true, ...COMMON_CERT, ...extra });

  const sendPlaintext = (client: net.Socket) => {
    client.write("this is not a ClientHello\r\n");
  };

  const rejectingSNI: tls.TlsOptions = {
    SNICallback: (_servername, cb) => {
      setImmediate(cb, new Error("unknown servername"));
    },
  };

  it("over a connection with unflushed writes", async () => {
    const events = await failHandshake(conn => {
      conn.cork();
      conn.write("220 banner\r\n");
      const wrapped = new TLSSocket(conn, serverOptions());
      conn.uncork();
      return wrapped;
    }, sendPlaintext);
    expect(events).toEqual(["error", "close:true"]);
  });

  it("over a generic Duplex", async () => {
    const events = await failHandshake(conn => {
      conn.write("220 banner\r\n");
      const transport = new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          conn.write(chunk, encoding, callback);
        },
        final(callback) {
          conn.end(callback);
        },
      });
      conn.on("data", chunk => transport.push(chunk));
      conn.on("end", () => transport.push(null));
      return new TLSSocket(transport, serverOptions());
    }, sendPlaintext);
    expect(events).toEqual(["error", "close:true"]);
  });

  it("when an asynchronous SNICallback rejects a wrap that adopted the fd", async () => {
    const events = await failHandshake(
      conn => {
        conn.write("220 banner\r\n");
        return new TLSSocket(conn, serverOptions(rejectingSNI));
      },
      client => {
        connect({ socket: client, servername: "rejected.example.com", rejectUnauthorized: false }).on(
          "error",
          () => {},
        );
      },
    );
    expect(events).toEqual(["error", "close:true"]);
  });

  it("when an asynchronous SNICallback of a tls.Server rejects", async () => {
    const server = createServer({ ...COMMON_CERT, ...rejectingSNI });
    const closed = Promise.withResolvers<{ message: string; hadError: boolean }>();
    server.on("tlsClientError", (err, socket) => {
      socket.on("close", hadError => closed.resolve({ message: err.message, hadError }));
    });
    server.on("secureConnection", () => closed.reject(new Error("secureConnection must not fire")));
    let client: TLSSocket | undefined;
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      client = connect({
        port: (server.address() as AddressInfo).port,
        host: "127.0.0.1",
        servername: "rejected.example.com",
        rejectUnauthorized: false,
      });
      client.on("error", () => {});
      expect(await closed.promise).toEqual({ message: "unknown servername", hadError: true });
    } finally {
      client?.destroy();
      server.close();
    }
  });
});

// Bun only: node reports the reset on the wrapped socket, which has no 'error' listener here.
it("closes a server wrap of a connection whose native socket is already gone", async () => {
  const accepted = Promise.withResolvers<net.Socket>();
  const rawServer = net.createServer(socket => {
    socket.write("x");
    accepted.resolve(socket);
  });
  let outgoing: net.Socket | undefined;
  let wrapped: TLSSocket | undefined;
  try {
    await once(rawServer.listen(0, "127.0.0.1"), "listening");
    outgoing = net.connect((rawServer.address() as AddressInfo).port, "127.0.0.1");
    // The byte stays unread, so the reset closes the native socket and the EOF queues behind the byte.
    const byteBuffered = Promise.withResolvers<void>();
    const eofBuffered = Promise.withResolvers<void>();
    let readableEvents = 0;
    outgoing.on("readable", () => (++readableEvents === 1 ? byteBuffered : eofBuffered).resolve());
    await byteBuffered.promise;
    (await accepted.promise).resetAndDestroy();
    await eofBuffered.promise;
    expect({ destroyed: outgoing.destroyed, pending: outgoing.pending }).toEqual({ destroyed: false, pending: false });

    wrapped = new TLSSocket(outgoing, { isServer: true, ...COMMON_CERT });
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    outgoing.on("close", () => events.push("raw close"));
    wrapped.on("error", err => events.push(`error: ${err.message}`));
    wrapped.on("close", () => {
      events.push("close");
      closed.resolve();
    });
    await closed.promise;
    expect(events).toEqual(["raw close", "close"]);
  } finally {
    wrapped?.destroy();
    outgoing?.destroy();
    rawServer.close();
  }
});

// Bun only: node throws ERR_INVALID_HANDLE_TYPE.
it("resetAndDestroy() of a server wrap on the stream-level engine destroys the wrapped socket", async () => {
  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  const rawServer = net.createServer(raw => {
    raw.cork();
    raw.write("220 banner\r\n");
    const wrapped = new TLSSocket(raw, { isServer: true, ...COMMON_CERT });
    raw.uncork();
    raw.on("close", () => events.push("raw close"));
    wrapped.on("close", () => {
      events.push("close");
      closed.resolve();
    });
    wrapped.resetAndDestroy();
  });
  await once(rawServer.listen(0, "127.0.0.1"), "listening");
  const peer = net.connect({ port: (rawServer.address() as AddressInfo).port, host: "127.0.0.1", allowHalfOpen: true });
  peer.on("error", () => {});
  try {
    await Promise.all([closed.promise, once(peer.resume(), "end")]);
    expect(events).toEqual(["raw close", "close"]);
  } finally {
    peer.destroy();
    rawServer.close();
  }
});

// http.Server's 'connection' hook sets socket.server to a server that has no ALPNCallback.
describe("a server-side TLSSocket wrap that an http.Server adopts through emit('connection')", () => {
  async function handshake(select: (protocols: string[]) => string | undefined) {
    const calls: string[] = [];
    const httpServer = http.createServer((req, res) => {
      const body = `alpn=${(req.socket as TLSSocket).alpnProtocol}`;
      res.writeHead(200, { "Connection": "close", "Content-Length": body.length });
      res.end(body);
    });
    const front = net.createServer(raw => {
      const wrapped = new TLSSocket(raw, {
        isServer: true,
        ...COMMON_CERT,
        ALPNCallback: ({ protocols }) => {
          calls.push(protocols.join(","));
          return select(protocols);
        },
      });
      wrapped.on("error", () => {});
      httpServer.emit("connection", wrapped);
    });
    await once(front.listen(0, "127.0.0.1"), "listening");
    const client = connect({
      port: (front.address() as AddressInfo).port,
      host: "127.0.0.1",
      ALPNProtocols: ["h2", "http/1.1"],
      rejectUnauthorized: false,
    });
    try {
      const outcome = await new Promise<string>(resolve => {
        client.once("secureConnect", () => resolve(`secureConnect ${client.alpnProtocol}`));
        client.once("error", () => resolve("error"));
      });
      let response: string | undefined;
      if (outcome !== "error") {
        client.setEncoding("latin1");
        let received = "";
        client.on("data", chunk => (received += chunk));
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await once(client, "close");
        response = received.slice(received.indexOf("\r\n\r\n") + 4);
      }
      return { outcome, calls, response };
    } finally {
      client.destroy();
      front.close();
    }
  }

  it("negotiates the protocol the wrap's ALPNCallback selects", async () => {
    expect(await handshake(() => "http/1.1")).toEqual({
      outcome: "secureConnect http/1.1",
      calls: ["h2,http/1.1"],
      response: "alpn=http/1.1",
    });
  });

  it("refuses the connection when the wrap's ALPNCallback returns undefined", async () => {
    expect(await handshake(() => undefined)).toEqual({
      outcome: "error",
      calls: ["h2,http/1.1"],
      response: undefined,
    });
  });
});

// https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1359-L1373
describe("a ClientHello with no SNI is reported as servername false", () => {
  // @types/node does not declare the property.
  const servernameOf = (socket: TLSSocket) => (socket as unknown as { servername: unknown }).servername;

  it("by socket.servername and the ALPNCallback of a tls.Server", async () => {
    let alpn: unknown = "ALPNCallback did not run";
    const server = createServer({
      ...COMMON_CERT,
      ALPNCallback: ({ servername, protocols }) => {
        alpn = servername;
        return protocols[0];
      },
    });
    const observed = Promise.withResolvers<{ socket: unknown; alpn: unknown }>();
    server.on("secureConnection", socket => {
      observed.resolve({ socket: servernameOf(socket), alpn });
      socket.end();
    });
    server.on("tlsClientError", observed.reject);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const client = connect({ port, host: "127.0.0.1", ALPNProtocols: ["a"], rejectUnauthorized: false });
    try {
      client.on("error", observed.reject);
      expect(await observed.promise).toEqual({ socket: false, alpn: false });
    } finally {
      client.destroy();
      server.close();
    }
  });

  it("by a server-side TLSSocket wrap after 'secure'", async () => {
    const observed = Promise.withResolvers<unknown>();
    const raw = net.createServer(socket => {
      const secured = new TLSSocket(socket, { isServer: true, ...COMMON_CERT });
      secured.on("error", observed.reject);
      secured.on("secure", () => {
        observed.resolve(servernameOf(secured));
        secured.end();
      });
    });
    await once(raw.listen(0, "127.0.0.1"), "listening");
    const { port } = raw.address() as AddressInfo;
    const client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    try {
      client.on("error", observed.reject);
      expect(await observed.promise).toBe(false);
    } finally {
      client.destroy();
      raw.close();
    }
  });
});

describe("an accepted socket whose stream state changes before or during its handshake", () => {
  // A pause() may only hold the decrypted bytes back: the handle has to read to complete the handshake.
  async function accept(options: {
    pauseOnConnect?: boolean;
    on?: Partial<Record<"connection" | "secureConnection", (socket: TLSSocket) => void>>;
  }) {
    const server = createServer({ ...COMMON_CERT, pauseOnConnect: options.pauseOnConnect });
    const accepted = Promise.withResolvers<TLSSocket>();
    for (const [event, listener] of Object.entries(options.on ?? {})) server.on(event, listener);
    server.on("secureConnection", accepted.resolve);
    server.on("tlsClientError", accepted.reject);
    let client: TLSSocket | undefined;
    const dispose = () => {
      client?.destroy();
      server.close();
    };
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      client = connect({
        port: (server.address() as AddressInfo).port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
      });
      const [socket] = await Promise.all([accepted.promise, once(client, "secureConnect")]);
      return { client, socket, [Symbol.dispose]: dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }

  async function untilBuffered(socket: TLSSocket, length: number) {
    const deadline = performance.now() + 10_000;
    while (socket.readableLength < length) {
      if (performance.now() > deadline) throw new Error(`readableLength stayed at ${socket.readableLength}`);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  async function endBothSides(client: TLSSocket, socket: TLSSocket) {
    const clientClosed = once(client, "close");
    socket.end();
    client.end();
    await clientClosed;
  }

  // The 'connection' row is Bun only: node hands that event the raw socket, so the TLSSocket is not paused.
  it.each(["connection", "secureConnection"] as const)(
    "s.pause() in a '%s' listener completes the handshake and buffers the bytes until resume()",
    async event => {
      using t = await accept({ on: { [event]: socket => socket.pause() } });
      const { client, socket } = t;
      expect({ paused: socket.isPaused(), flowing: socket.readableFlowing }).toEqual({ paused: true, flowing: false });
      const chunks: string[] = [];
      // A 'data' listener leaves a paused stream paused.
      socket.on("data", chunk => chunks.push(String(chunk)));
      await new Promise<void>((resolve, reject) => client.write("hello", err => (err ? reject(err) : resolve())));
      // The stream's buffer fills because the handle still reads. Like Node, 'data' waits for resume().
      await untilBuffered(socket, 5);
      expect({ chunks, flowing: socket.readableFlowing, readableLength: socket.readableLength }).toEqual({
        chunks: [],
        flowing: false,
        readableLength: 5,
      });
      const received = once(socket, "data");
      socket.resume();
      await received;
      expect(chunks).toEqual(["hello"]);
      await endBothSides(client, socket);
    },
  );

  it("pauseOnConnect: a resume() in the 'secureConnection' listener is not undone afterwards", async () => {
    using t = await accept({ pauseOnConnect: true, on: { secureConnection: socket => socket.resume() } });
    const { client, socket } = t;
    expect({ paused: socket.isPaused(), flowing: socket.readableFlowing }).toEqual({ paused: false, flowing: true });
    const received = once(socket, "data");
    client.write("hello");
    expect(String((await received)[0])).toBe("hello");
    await endBothSides(client, socket);
  });

  // Node's TLSWrap reads ahead. Ours stops reading once the handshake completed (#39830).
  it.todo("pauseOnConnect: a socket still paused emits 'end' when the peer ends", async () => {
    using t = await accept({ pauseOnConnect: true });
    const { client, socket } = t;
    const ended = once(socket, "end");
    client.end();
    await ended;
    expect(socket.isPaused()).toBe(true);
    socket.end();
    await once(client, "close");
  });
});

describe("fatal TLS error after the handshake", () => {
  // A TLS 1.3 application_data record whose payload does not authenticate.
  function badRecord() {
    const payload = Buffer.alloc(32, 0xab);
    return Buffer.concat([Buffer.from([0x17, 0x03, 0x03, 0x00, payload.length]), payload]);
  }

  // Each client below sends its bad record and the FIN together, the way a peer
  // that gives up does. Node keeps an errored socket open until that FIN, so
  // both runtimes reach 'end' and close(false) after the error.
  function recordEvents(socket: TLSSocket, events: string[], closed: PromiseWithResolvers<void>) {
    socket.on("data", chunk => events.push(`data ${chunk}`));
    socket.on("error", (err: Error & { code?: string }) => events.push(`error ${err.code}`));
    socket.on("end", () => events.push("end"));
    socket.on("close", hadError => {
      events.push(`close ${hadError}`);
      closed.resolve();
    });
  }

  // A TCP relay from the client to the server. `tamper` gets each chunk that
  // the client sends, with its index, and returns the bytes to forward and
  // whether to send the FIN with them.
  async function startRelay(serverPort: number, tamper: (chunk: Buffer, index: number) => [Buffer, boolean]) {
    const relay = net.createServer(downstream => {
      const upstream = net.connect(serverPort, "127.0.0.1");
      upstream.pipe(downstream);
      let index = 0;
      downstream.on("data", chunk => {
        const [bytes, fin] = tamper(chunk, index++);
        if (fin) upstream.end(bytes);
        else upstream.write(bytes);
      });
      downstream.on("close", () => upstream.destroy());
      downstream.on("error", () => {});
      upstream.on("error", () => {});
    });
    await once(relay.listen(0, "127.0.0.1"), "listening");
    return relay;
  }

  it("reports a record that does not decrypt as an 'error' on the accepted socket", async () => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    let error: (Error & { library?: string; reason?: string }) | undefined;
    const server = createServer(COMMON_CERT, socket => {
      recordEvents(socket, events, closed);
      socket.once("error", err => (error = err));
      // The client sends the bad record when this arrives, so the server's
      // handshake is complete by then.
      socket.write("hello");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const raw = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    raw.on("error", () => {});
    const client = connect({ socket: raw, rejectUnauthorized: false });
    client.on("error", () => {});
    client.once("data", () => raw.end(badRecord()));
    try {
      await closed.promise;
      expect(events).toEqual(["error ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC", "end", "close false"]);
      // BoringSSL names the reason DECRYPTION_FAILED_OR_BAD_RECORD_MAC, OpenSSL
      // spells the same reason in words.
      expect({ library: error?.library, reason: error?.reason?.toUpperCase().replaceAll(" ", "_") }).toEqual({
        library: "SSL routines",
        reason: "DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
      });
    } finally {
      client.destroy();
      raw.destroy();
      server.close();
    }
  });

  it("delivers the data that arrives with the bad record before the 'error'", async () => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const server = createServer(COMMON_CERT, socket => {
      recordEvents(socket, events, closed);
      socket.write("hello");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    // The relay appends the bad record to the client's next write, so the
    // server reads both in one read.
    let appendBadRecord = false;
    const relay = await startRelay((server.address() as AddressInfo).port, chunk => {
      if (!appendBadRecord) return [chunk, false];
      appendBadRecord = false;
      return [Buffer.concat([chunk, badRecord()]), true];
    });
    const client = connect({
      port: (relay.address() as AddressInfo).port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
    });
    client.on("error", () => {});
    try {
      await once(client, "data");
      appendBadRecord = true;
      client.write("ping");
      await closed.promise;
      expect(events).toEqual(["data ping", "error ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC", "end", "close false"]);
    } finally {
      client.destroy();
      relay.close();
      server.close();
    }
  });

  it("reports the handshake and then the 'error' when one read holds the Finished and the bad record", async () => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const server = createServer({ ...COMMON_CERT, minVersion: "TLSv1.3" }, socket => {
      events.push("secureConnection");
      recordEvents(socket, events, closed);
    });
    server.on("tlsClientError", (err: Error & { code?: string }) => {
      events.push(`tlsClientError ${err.code}`);
      closed.resolve();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    // The client's second write is the flight that ends with its Finished. The
    // relay appends the bad record to it, so the server's handshake completes
    // in the same read that fails.
    const relay = await startRelay((server.address() as AddressInfo).port, (chunk, index) =>
      index === 1 ? [Buffer.concat([chunk, badRecord()]), true] : [chunk, false],
    );
    const client = connect({
      port: (relay.address() as AddressInfo).port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
      minVersion: "TLSv1.3",
    });
    client.on("error", () => {});
    try {
      await closed.promise;
      expect(events).toEqual([
        "secureConnection",
        "error ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
        "end",
        "close false",
      ]);
    } finally {
      client.destroy();
      relay.close();
      server.close();
    }
  });
});

// Node serves both from server._sharedCreds, so they share one session cache and one set of ticket keys.
describe.each(["TLSv1.2", "TLSv1.3"] as const)("accepted and injected connections share a context (%s)", version => {
  it("a session issued on one resumes on the other", async () => {
    const server: Server = createServer(COMMON_CERT, socket => socket.on("error", () => {}).end("x"));
    const front = net.createServer(raw => server.emit("connection", raw));
    async function dial({ port }: AddressInfo, session?: Buffer) {
      const options = { port, host: "127.0.0.1", rejectUnauthorized: false, minVersion: version, maxVersion: version };
      const client = connect({ ...options, session });
      let issued: Buffer | undefined;
      client.on("session", s => (issued = s));
      client.resume();
      await once(client, "secureConnect");
      const reused = client.isSessionReused();
      await once(client, "close");
      return { reused, issued };
    }
    try {
      server.listen(0, "127.0.0.1");
      front.listen(0, "127.0.0.1");
      await Promise.all([once(server, "listening"), once(front, "listening")]);
      const accepted = server.address() as AddressInfo;
      const injected = front.address() as AddressInfo;
      const [onAccepted, onInjected] = [await dial(accepted), await dial(injected)];
      expect({
        acceptedThenInjected: (await dial(injected, onAccepted.issued)).reused,
        injectedThenAccepted: (await dial(accepted, onInjected.issued)).reused,
      }).toEqual({ acceptedThenInjected: true, injectedThenAccepted: true });

      // A replaced context takes its sessions with it, on both paths.
      server.setSecureContext({ key: rawKey, cert });
      expect({
        accepted: (await dial(accepted, onAccepted.issued)).reused,
        injected: (await dial(injected, onAccepted.issued)).reused,
      }).toEqual({ accepted: false, injected: false });
    } finally {
      front.close();
      server.close();
    }
  });

  it("a session issued by one server does not resume on another with the same options", async () => {
    const serve = () =>
      createServer(COMMON_CERT, socket => socket.on("error", () => {}).end("x")).listen(0, "127.0.0.1");
    const [one, other] = [serve(), serve()];
    const inject = (server: Server) => net.createServer(raw => server.emit("connection", raw)).listen(0, "127.0.0.1");
    const [frontOne, front] = [inject(one), inject(other)];
    async function dial(server: net.Server, session?: Buffer) {
      const { port } = server.address() as AddressInfo;
      const options = { port, host: "127.0.0.1", rejectUnauthorized: false, minVersion: version, maxVersion: version };
      const client = connect({ ...options, session });
      let issued: Buffer | undefined;
      client.on("session", s => (issued = s));
      client.resume();
      await once(client, "secureConnect");
      const reused = client.isSessionReused();
      await once(client, "close");
      return { reused, issued };
    }
    try {
      await Promise.all([one, other, frontOne, front].map(server => once(server, "listening")));
      const { issued } = await dial(one);
      const { issued: issuedInjected } = await dial(frontOne);
      expect({
        same: (await dial(one, issued)).reused,
        otherAccepted: (await dial(other, issued)).reused,
        otherInjected: (await dial(front, issued)).reused,
        injectedToOtherAccepted: (await dial(other, issuedInjected)).reused,
        injectedToOtherInjected: (await dial(front, issuedInjected)).reused,
      }).toEqual({
        same: true,
        otherAccepted: false,
        otherInjected: false,
        injectedToOtherAccepted: false,
        injectedToOtherInjected: false,
      });
    } finally {
      for (const server of [one, other, frontOne, front]) server.close();
    }
  });

  // Bun only: Node's setSecureContext() takes options. Accepted sockets take their verify mode from the context.
  it("the listener keeps asking for a client certificate after setSecureContext(aSecureContext)", async () => {
    const material = { ...COMMON_CERT, ca: COMMON_CERT.cert };
    const server: Server = createServer({ ...material, requestCert: true, rejectUnauthorized: false });
    try {
      server.setSecureContext(tls.createSecureContext(COMMON_CERT) as any);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const secure = once(server, "secureConnection");
      const client = connect({
        ...COMMON_CERT,
        port: (server.address() as AddressInfo).port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        minVersion: version,
        maxVersion: version,
      });
      client.on("error", () => {});
      const [socket] = await secure;
      expect(socket.getPeerCertificate().fingerprint256).toBe(
        new crypto.X509Certificate(COMMON_CERT.cert).fingerprint256,
      );
      client.destroy();
    } finally {
      server.close();
    }
  });

  // A resumed handshake skips client authentication.
  it("a server that requires a client certificate shares none with one that does not", async () => {
    const material = { ...COMMON_CERT, ca: COMMON_CERT.cert };
    const open: Server = createServer(material, socket => socket.on("error", () => {}).end("x"));
    const strict: Server = createServer({ ...material, requestCert: true, rejectUnauthorized: true });
    try {
      // requestCert is constructor-only, so rotating the certificate does not name it.
      strict.setSecureContext(material);
      open.listen(0, "127.0.0.1");
      strict.listen(0, "127.0.0.1");
      await Promise.all([once(open, "listening"), once(strict, "listening")]);
      const options = { host: "127.0.0.1", rejectUnauthorized: false, minVersion: version, maxVersion: version };
      const first = connect({ ...options, port: (open.address() as AddressInfo).port });
      const [session] = await once(first.resume(), "session");
      first.destroy();

      const verdict = Promise.race([
        once(strict, "secureConnection").then(() => "accepted"),
        once(strict, "tlsClientError").then(([err]) => err.code),
      ]);
      const second = connect({ ...options, port: (strict.address() as AddressInfo).port, session });
      second.on("error", () => {});
      expect(await verdict).toBe("ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE");
      second.destroy();
    } finally {
      open.close();
      strict.close();
    }
  });
});
