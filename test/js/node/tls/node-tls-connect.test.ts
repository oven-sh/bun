import { describe, expect, it } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tls as COMMON_CERT_, isASAN } from "harness";
import https from "https";
import net from "net";
import { join } from "path";
import stream from "stream";
import tls, { checkServerIdentity, connect as tlsConnect, TLSSocket } from "tls";

import type { AddressInfo } from "net";
import { Duplex } from "node:stream";

const symbolConnectOptions = Symbol.for("::buntlsconnectoptions::");

class SocketProxy extends Duplex {
  socket: net.Socket;
  constructor(socket: net.Socket) {
    super();
    this.socket = socket;

    // Handle incoming data from the socket
    this.socket.on("data", chunk => {
      // Push data to be read by the Duplex stream
      if (!this.push(chunk)) {
        this.socket.pause();
      }
    });

    // Handle when the socket ends
    this.socket.on("end", () => {
      this.push(null); // Signal that no more data will be provided
    });

    // Handle socket errors
    this.socket.on("error", err => {
      console.error("Socket error:", err);
      this.destroy(err); // Destroy the stream on error
    });

    // Handle socket close
    this.socket.on("close", () => {
      this.push(null); // Signal the end of data if the socket closes
    });

    this.socket.on("drain", () => {
      this.emit("drain");
    });
  }

  // Implement the _read method to receive data
  _read(size: number) {
    // Resume the socket if it was paused
    if (this.socket.isPaused()) {
      this.socket.resume();
    }
  }

  // Implement the _write method to send data
  _write(chunk, encoding, callback) {
    // Write data to the socket
    this.socket.write(chunk, encoding, callback);
  }

  // Implement the _final method to handle stream ending
  _final(callback) {
    // End the socket connection
    this.socket.end();
    callback();
  }
}
function duplexProxy(options: tls.ConnectionOptions, callback?: () => void): TLSSocket {
  if (typeof options === "number") {
    // handle port, host, options
    let options = arguments[2] || {};
    let callback = arguments[3];
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    //@ts-ignore

    const socket = net.connect(arguments[0], arguments[1], options);
    const duplex = new SocketProxy(socket);
    return tls.connect(
      {
        ...options,
        socket: duplex,
        host: arguments[1],
        servername: options.servername || arguments[1],
      },
      callback,
    );
  }

  //@ts-ignore
  const socket = net.connect(options);
  const duplex = new SocketProxy(socket);
  return tls.connect(
    {
      ...options,
      socket: duplex,
      host: options.host,
      servername: options.servername || options.host,
    },
    callback,
  );
}
const tests = [
  {
    name: "tls.connect",
    connect: tlsConnect,
  },
  {
    name: "tls.connect using duplex proxy",
    connect: duplexProxy,
  },
];

// Some tests connect to the live bun.sh host. Skip them when the network (or
// DNS) is unavailable so the suite still passes offline instead of failing
// with DNSException/getaddrinfo errors unrelated to what is under test. The
// probe is bounded by a hard timer so a stalled handshake or black-holed
// connection can't hang module load (per-test timeouts don't apply yet).
const canReachBunSh = await (async () => {
  const socket = tlsConnect({ host: "bun.sh", servername: "bun.sh", port: 443, rejectUnauthorized: false });
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const timer = setTimeout(() => resolve(false), 5000);
  socket.once("secureConnect", () => resolve(true));
  socket.once("error", () => resolve(false));
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
})();
const itNetwork = it.skipIf(!canReachBunSh);

it("should have checkServerIdentity", async () => {
  expect(checkServerIdentity).toBeFunction();
  expect(tls.checkServerIdentity).toBeFunction();
});

it("should thow ECONNRESET if FIN is received before handshake", async () => {
  await using server = net.createServer(c => {
    c.end();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { promise, resolve } = Promise.withResolvers();
  tls.connect((server.address() as AddressInfo).port).on("error", resolve);

  const error = await promise;

  expect(error).toBeDefined();
  expect((error as Error).code as string).toBe("ECONNRESET");
});
it("should be able to grab the JSStreamSocket constructor", () => {
  // this keep http2-wrapper compatibility with node.js
  const socket = new tls.TLSSocket(new stream.PassThrough());
  //@ts-ignore
  expect(socket._handle).not.toBeNull();
  //@ts-ignore
  expect(socket._handle._parentWrap).not.toBeNull();
  //@ts-ignore
  expect(socket._handle._parentWrap.constructor).toBeFunction();
});
for (const { name, connect } of tests) {
  describe(name, () => {
    itNetwork("should work with alpnProtocols", done => {
      try {
        let socket: TLSSocket | null = connect({
          ALPNProtocols: ["http/1.1"],
          host: "bun.sh",
          servername: "bun.sh",
          port: 443,
          rejectUnauthorized: false,
        });

        socket.on("error", err => {
          done(err);
        });

        socket.on("secureConnect", () => {
          done(socket?.alpnProtocol === "http/1.1" ? undefined : "alpnProtocol is not http/1.1");
          socket?.end();
          socket = null;
        });
      } catch (err) {
        done(err);
      }
    });
    const COMMON_CERT = { ...COMMON_CERT_ };

    it("Bun.serve() should work with tls and Bun.file()", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(Bun.file(join(import.meta.dir, "fixtures/index.html")));
        },
        tls: {
          cert: COMMON_CERT.cert,
          key: COMMON_CERT.key,
        },
      });
      const res = await fetch(`https://${server.hostname}:${server.port}/`, { tls: { rejectUnauthorized: false } });
      expect(await res.text()).toBe("<h1>HELLO</h1>");
    });

    it("should have peer certificate when using self asign certificate", async () => {
      using server = Bun.serve({
        tls: {
          cert: COMMON_CERT.cert,
          key: COMMON_CERT.key,
          passphrase: COMMON_CERT.passphrase,
        },
        port: 0,
        fetch() {
          return new Response("Hello World");
        },
      });

      const { promise: socketPromise, resolve: resolveSocket, reject: rejectSocket } = Promise.withResolvers();
      const socket = connect(
        {
          ALPNProtocols: ["http/1.1"],
          host: server.hostname,
          servername: "localhost",
          port: server.port,
          rejectUnauthorized: false,
          requestCert: true,
        },
        resolveSocket,
      ).on("error", rejectSocket);

      await socketPromise;

      try {
        expect(socket).toBeDefined();
        const cert = socket.getPeerCertificate();
        expect(cert).toBeDefined();
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
        expect(cert.subjectaltname).toBe("DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1");
        expect(cert.infoAccess).toBeUndefined();
        expect(cert.ca).toBe(true);
        expect(cert.bits).toBe(2048);
        expect(cert.modulus).toBe(
          "E5633A2C8118171CBEAF321D55D0444586CBE566BB51A234B0EAD69FAF7490069854EFDDFFAC68986652FF949F472252E4C7D24C6EE4E3366E54D9E4701E24D021E583E1A088112C0F96475A558B42F883A3E796C937CC4D6BB8791B227017B3E73DEB40B0AC84F033019F580A3216888ACEC71CE52D938FCADD8E29794E38774E33D323EDE89B58E526EF8B513BA465FA4FFD9CF6C1EC7480DE0DCB569DEC295D7B3CCE40256B428D5907E90E7A52E77C3101F4AD4C0E254AB03D75AC42EE1668A5094BC4521B264FB404B6C4B17B6B279E13E6282E1E4FB6303540CB830EA8FF576CA57B7861E4EF797AF824B0987C870718780A1C5141E4F904FD0C5139F5",
        );
        expect(cert.exponent).toBe("0x10001");
        expect(cert.pubkey).toBeInstanceOf(Buffer);
        expect(cert.valid_from).toBe("Sep  6 03:00:49 2025 GMT"); // yes this space is intentional
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
      } finally {
        // Tear the socket down immediately: the local server is disposed right
        // after this test, and a lingering half-closed connection would observe
        // its hard close as ECONNRESET (Node surfaces the same error).
        socket.destroy();
      }
    });

    itNetwork("should have peer certificate", async () => {
      const socket = (await new Promise((resolve, reject) => {
        const instance = connect(
          {
            ALPNProtocols: ["http/1.1"],
            host: "bun.sh",
            servername: "bun.sh",
            port: 443,
            rejectUnauthorized: false,
            requestCert: true,
          },
          function () {
            resolve(instance);
          },
        ).on("error", reject);
      })) as TLSSocket;

      try {
        expect(socket).toBeDefined();
        const cert = socket.getPeerCertificate();
        expect(cert).toBeDefined();
        expect(cert.subject).toBeDefined();
        // this should never change
        expect(cert.subject.CN).toBe("bun.sh");
        expect(cert.subjectaltname).toContain("DNS:bun.sh");
        expect(cert.infoAccess).toBeDefined();
        // The live cert's AIA contents change on reissue (public CAs stopped
        // including OCSP URIs in 2025), so only assert the stable CA Issuers
        // entry here; exact parsing is covered by the fixed-fixture x509 tests.
        const infoAccess = cert.infoAccess as NodeJS.Dict<string[]>;
        expect(infoAccess["CA Issuers - URI"]).toEqual(expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]));
        expect(cert.ca).toBeFalse();
        expect(cert.bits).toBeInteger();
        // These can change:
        // expect(typeof cert.modulus).toBe("string");
        // expect(typeof cert.exponent).toBe("string");
        expect(cert.pubkey).toBeInstanceOf(Buffer);
        expect(typeof cert.valid_from).toBe("string");
        expect(typeof cert.valid_to).toBe("string");
        expect(typeof cert.fingerprint).toBe("string");
        expect(typeof cert.fingerprint256).toBe("string");
        expect(typeof cert.fingerprint512).toBe("string");
        expect(typeof cert.serialNumber).toBe("string");
        expect(cert.raw).toBeInstanceOf(Buffer);
      } finally {
        socket.end();
      }
    });

    itNetwork(
      "getCipher, getProtocol, getEphemeralKeyInfo, getSharedSigalgs, getSession, exportKeyingMaterial and isSessionReused should work",
      async () => {
        const allowedCipherObjects = [
          {
            name: "TLS_AES_128_GCM_SHA256",
            standardName: "TLS_AES_128_GCM_SHA256",
            version: "TLSv1/SSLv3",
          },
          {
            name: "TLS_AES_256_GCM_SHA384",
            standardName: "TLS_AES_256_GCM_SHA384",
            version: "TLSv1/SSLv3",
          },
          {
            name: "TLS_CHACHA20_POLY1305_SHA256",
            standardName: "TLS_CHACHA20_POLY1305_SHA256",
            version: "TLSv1/SSLv3",
          },
        ];
        const socket = (await new Promise((resolve, reject) => {
          connect({
            ALPNProtocols: ["http/1.1"],
            host: "bun.sh",
            servername: "bun.sh",
            port: 443,
            rejectUnauthorized: false,
            requestCert: true,
          })
            .on("secure", resolve)
            .on("error", reject);
        })) as TLSSocket;

        try {
          const cipher = socket.getCipher();
          let hadMatch = false;
          for (const allowedCipher of allowedCipherObjects) {
            if (cipher.name === allowedCipher.name) {
              expect(cipher).toMatchObject(allowedCipher);
              hadMatch = true;
              break;
            }
          }
          if (!hadMatch) {
            throw new Error(`Unexpected cipher ${cipher.name}`);
          }
          expect(socket.getProtocol()).toBe("TLSv1.3");
          expect(typeof socket.getEphemeralKeyInfo()).toBe("object");
          expect(socket.getSharedSigalgs()).toBeInstanceOf(Array);
          expect(socket.getSession()).toBeInstanceOf(Buffer);
          expect(socket.exportKeyingMaterial(512, "client finished")).toBeInstanceOf(Buffer);
          expect(socket.isSessionReused()).toBe(false);

          // BoringSSL does not support these methods for >= TLSv1.3
          expect(socket.getFinished()).toBeUndefined();
          expect(socket.getPeerFinished()).toBeUndefined();
        } finally {
          socket.end();
        }
      },
    );

    // Test using only options
    // prettier-ignore
    it.skipIf(connect === duplexProxy || !canReachBunSh)("should process options correctly when connect is called with only options", done => {
      let socket = connect({
        port: 443,
        host: "bun.sh",
        rejectUnauthorized: false,
      });

      socket.on("secureConnect", () => {
        expect(socket.remotePort).toBe(443);
        expect(socket[symbolConnectOptions].servername).toBe("bun.sh");
        socket.end();
        done();
      });

      socket.on("error", err => {
        socket.end();
        done(err);
      });
    });

    // Test using port and host
    itNetwork("should process port and host correctly", done => {
      let socket = connect(443, "bun.sh", {
        rejectUnauthorized: false,
      });

      socket.on("secureConnect", () => {
        if (connect === tlsConnect) {
          expect(socket.remotePort).toBe(443);
        }
        expect(socket[symbolConnectOptions].servername).toBe("bun.sh");
        socket.end();
        done();
      });

      socket.on("error", err => {
        socket.end();
        done(err);
      });
    });

    // Test using port, host, and callback
    itNetwork("should process port, host, and callback correctly", done => {
      let socket = connect(
        443,
        "bun.sh",
        {
          rejectUnauthorized: false,
        },
        () => {
          if (connect === tlsConnect) {
            expect(socket.remotePort).toBe(443);
          }
          expect(socket[symbolConnectOptions].servername).toBe("bun.sh");
          socket.end();
          done();
        },
      ).on("error", err => {
        done(err);
      });
    });

    // Additional tests to ensure the callback is optional and handled correctly
    itNetwork("should handle the absence of a callback gracefully", done => {
      let socket = connect(443, "bun.sh", {
        rejectUnauthorized: false,
      });

      socket.on("secureConnect", () => {
        expect(socket[symbolConnectOptions].servername).toBe("bun.sh");
        if (connect === tlsConnect) {
          expect(socket.remotePort).toBe(443);
        }
        socket.end();
        done();
      });

      socket.on("error", err => {
        socket.end();
        done(err);
      });
    });

    itNetwork(
      "should timeout",
      done => {
        const socket = connect(
          {
            port: 443,
            host: "bun.sh",
          },
          () => {
            socket.setTimeout(1000, () => {
              done();
              socket.end();
            });
          },
        );

        socket.on("error", err => {
          socket.end();
          done(err);
        });
      },
      10_000,
    ); // 10 seconds because uWS sometimes is not that precise with timeouts

    itNetwork("should be able to transfer data", done => {
      const socket = connect(
        {
          port: 443,
          host: "bun.com",
          servername: "bun.com",
        },
        () => {
          let data = "";
          socket.on("data", chunk => {
            data += chunk.toString();
          });
          socket.on("end", () => {
            if (data.indexOf("HTTP/1.1 200 OK") !== -1) {
              done();
            } else {
              done(new Error(`missing expected HTTP response, got: ${data.slice(0, 200)}`));
            }
          });
          socket.write("GET / HTTP/1.1\r\n");
          socket.write("Host: bun.com\r\n");
          socket.write("User-Agent: Bun/1.0\r\n");
          socket.write("Accept: */*\r\n");
          socket.write("Accept-Encoding: identity\r\n");
          socket.write("Connection: close\r\n");
          socket.write("\r\n");
        },
      );
      socket.on("error", err => {
        socket.end();
        done(err);
      });
    });
  });
}

it("setSession() should not leak the SSL_SESSION returned by d2i_SSL_SESSION", async () => {
  // d2i_SSL_SESSION returns an owned SSL_SESSION; SSL_set_session takes its own
  // reference ("the caller retains ownership"), so the caller's reference must
  // be freed. The fixture calls setSession 20,000× on one socket in its `open`
  // handler (the only window before the handshake starts) and reports RSS growth.
  //
  // Without the SSL_SESSION_free: ~125–140 MB growth (~7 KB leaked per call).
  // With it: ~5–10 MB (allocator noise, no per-call growth).
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dirname, "node-tls-set-session-leak.fixture.ts"), "20000"],
    env: {
      ...bunEnv,
      // ASAN's default 256MB quarantine retains every freed allocation, so
      // RSS growth would measure the total allocation churn instead of leaks
      // on any ASAN-instrumented build (including a local `bun bd` debug
      // build, which is ASAN but not named `bun-asan`). Cap the quarantine
      // so the measurement reflects live memory.
      // Preserve the harness ASAN options (bunEnv sets allow_user_segv_handler /
      // disable_coredump) instead of rebuilding from process.env only.
      ASAN_OPTIONS: ["quarantine_size_mb=8", bunEnv.ASAN_OPTIONS ?? process.env.ASAN_OPTIONS].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { calls, growthBytes } = JSON.parse(stdout);
  expect(calls).toBe(20000);
  // Leave generous headroom above the fixed-build measurement so unrelated
  // allocator changes don't turn this into a flaky test, while still being
  // far below the ~125 MB leak signature.
  expect(growthBytes).toBeLessThan((isASAN ? 60 : 40) * 1024 * 1024);
  expect(exitCode).toBe(0);
}, 60_000);

it.each([["TLSv1.2"], ["TLSv1.3"]] as const)(
  "%s: data written after secureConnect is delivered both ways even when the server ends first",
  async version => {
    // Under TLS 1.2 the server finishes its handshake one flight before the
    // client, so a write()+end() server has already sent its FIN by the time
    // the client's reply arrives - the half-closed socket must keep reading.
    const serverReceived: string[] = [];
    const serverGotData = Promise.withResolvers<void>();
    const server = tls.createServer({ ...COMMON_CERT_, minVersion: version, maxVersion: version }, socket => {
      socket.on("data", d => {
        serverReceived.push(d.toString());
        serverGotData.resolve();
      });
      socket.write("hello");
      socket.end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const client = tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    let clientReceived = "";
    client.on("data", d => (clientReceived += d));
    await once(client, "secureConnect");
    expect(client.getProtocol()).toBe(version);
    client.write("hello");
    client.end();
    await once(client, "close");
    // The server's read of the client's last record happens on its own loop
    // turn - wait for it instead of sleeping.
    await serverGotData.promise;
    expect(clientReceived).toBe("hello");
    expect(serverReceived.join("")).toBe("hello");
    server.close();
    await once(server, "close");
  },
);

it("tls.DEFAULT_MAX_VERSION is honored by contexts built without explicit versions", async () => {
  const prev = tls.DEFAULT_MAX_VERSION;
  try {
    tls.DEFAULT_MAX_VERSION = "TLSv1.2";
    const server = tls.createServer({ ...COMMON_CERT_ }, socket => {
      socket.end();
    });
    server.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const client = tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    await once(client, "secureConnect");
    expect(client.getProtocol()).toBe("TLSv1.2");
    client.end();
    await once(client, "close");
    server.close();
    await once(server, "close");
  } finally {
    tls.DEFAULT_MAX_VERSION = prev;
  }
});

it("'session' and 'keylog' are emitted for a TLSSocket over a duplex stream (tls.connect({ socket }))", async () => {
  // The TLS-over-duplex wrapper has no us_socket_t, so its parked
  // new-session/keylog queues are drained by the Rust SSLWrapper instead of
  // us_dispatch_session/us_dispatch_keylog - this covers that path end to end.
  const server = tls.createServer({ ...COMMON_CERT_ }, socket => {
    socket.on("data", () => socket.end());
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  const raw = net.connect(port, "127.0.0.1");
  await once(raw, "connect");
  const duplex = new SocketProxy(raw);
  const client = tls.connect({ socket: duplex, rejectUnauthorized: false });
  const sessionPromise = once(client, "session");
  const keylogPromise = once(client, "keylog");
  await once(client, "secureConnect");
  client.write("x");
  const [session] = await sessionPromise;
  const [keylogLine] = await keylogPromise;
  expect(Buffer.isBuffer(session)).toBe(true);
  expect(session.length).toBeGreaterThan(0);
  expect(Buffer.isBuffer(keylogLine)).toBe(true);
  expect(keylogLine.length).toBeGreaterThan(0);
  client.end();
  await once(client, "close");
  server.close();
  await once(server, "close");
});

it("delivers 'session' even when the data handler destroys the socket immediately", async () => {
  // The TLS1.3 NewSessionTickets ride in the same read pass as the response
  // bytes. If the parked session were only flushed after the data dispatch,
  // a consumer that tears the socket down inside 'data' (an https.Agent with
  // keepAlive off destroys the tunneled socket as soon as the response
  // completes) would silently lose the 'session' event - Node delivers the
  // session before the data reaches JS.
  const server = tls.createServer({ ...COMMON_CERT_ }, socket => {
    socket.on("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"));
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  let session = false;
  const client = tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
    client.write("x");
  });
  client.on("session", () => (session = true));
  client.on("data", () => {
    // Mirrors the agent flow: socket destroyed during the data dispatch,
    // before any later flush could run.
    client.destroy();
  });
  await once(client, "close");
  expect(session).toBe(true);
  server.close();
  await once(server, "close");
});

it("a write before 'secureConnect' still reports the handshake's own failure", async () => {
  // An early write drives the handshake from inside SSL_write. The fatal
  // reason that write hit used to be dropped, so the handshake dispatch had
  // nothing to report and the dead session looked established: the only error
  // left was checkServerIdentity's verdict on an empty peer certificate.
  await using server = tls.createServer({ ...COMMON_CERT_ }, socket => socket.end());
  await once(server.listen(0, "127.0.0.1"), "listening");

  const client = tlsConnect({
    port: (server.address() as AddressInfo).port,
    host: "127.0.0.1",
    servername: "localhost",
    ca: COMMON_CERT_.cert,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.2",
  });
  let secureConnect = false;
  client.on("secureConnect", () => (secureConnect = true));
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");

  const [error] = await once(client, "error");
  expect(error.code).toBe("ERR_SSL_NO_SUPPORTED_VERSIONS_ENABLED");
  expect(secureConnect).toBe(false);
});

it("https.request reports an impossible version window as a TLS error, not a certificate error", async () => {
  // The http client flushes the request headers as soon as the socket
  // connects, so every https.request hits the early-write path above.
  await using server = https.createServer({ ...COMMON_CERT_ }, (_req, res) => res.end("ok"));
  await once(server.listen(0, "127.0.0.1"), "listening");
  const options = {
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    servername: "localhost",
    ca: COMMON_CERT_.cert,
    agent: false as const,
  };

  const failing = https.request({ ...options, minVersion: "TLSv1.3", maxVersion: "TLSv1.2" });
  failing.end();
  const [error] = await once(failing, "error");
  expect(error.code).toBe("ERR_SSL_NO_SUPPORTED_VERSIONS_ENABLED");

  // A satisfiable window over the same cert/CA/servername still succeeds: the
  // version range is the only thing that failed above.
  const ok = https.request({ ...options, minVersion: "TLSv1.2", maxVersion: "TLSv1.3" });
  ok.end();
  const [response] = await once(ok, "response");
  let body = "";
  response.on("data", (chunk: Buffer) => (body += chunk));
  await once(response, "end");
  expect(body).toBe("ok");
});

// Self-signed leaf certificates carrying subjectAltName=DNS:localhost,IP:127.0.0.1,
// one per public-key algorithm. Before the fix the TLS client never advertised
// Ed25519 or ECDSA P-521 in its signature_algorithms extension, so a handshake
// against an Ed25519 or P-521 leaf could not complete: the peer certificate came
// back empty and hostname verification failed with "Cert does not contain a DNS
// name". RSA and ECDSA P-256 were unaffected and are included so the fix is
// proven not to regress them. https://github.com/oven-sh/bun/issues/32234
const algorithmCerts: Record<string, { cert: string; key: string }> = {
  "ed25519": {
    cert: `-----BEGIN CERTIFICATE-----
MIIBazCCAR2gAwIBAgIUIRnW7d+/xEjATOwpaLufjVG3L50wBQYDK2VwMBwxGjAY
BgNVBAMMEWVkMjU1MTktbG9jYWxob3N0MCAXDTI2MDYxMzE2NDA0MVoYDzIxMjYw
NTIwMTY0MDQxWjAcMRowGAYDVQQDDBFlZDI1NTE5LWxvY2FsaG9zdDAqMAUGAytl
cAMhAJctkaOzUhRwNmww05zPThcS3kxYat1D1u23etBE5afto28wbTAdBgNVHQ4E
FgQUsKxmTSgWWCGVfig+r1ZpDskV/P0wHwYDVR0jBBgwFoAUsKxmTSgWWCGVfig+
r1ZpDskV/P0wDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwBQYDK2VwA0EAwTZ5YJdRLVaHhonefLnfj3JZRMCkLy7sJh9PzaMMLmzy
Ykda9Ma72YYRhxA17xJDrVHqbch3Xj0av7HdiBA1Dw==
-----END CERTIFICATE-----`,
    key: `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIPHkA+g5xFMMCoC3mdG4/P1fZklg3FWNUW79wAEkMQur
-----END PRIVATE KEY-----`,
  },
  "rsa": {
    cert: `-----BEGIN CERTIFICATE-----
MIIDLzCCAhegAwIBAgIUSHG57QcKYNvy3F7bN+bn4rxfCJAwDQYJKoZIhvcNAQEL
BQAwGDEWMBQGA1UEAwwNcnNhLWxvY2FsaG9zdDAgFw0yNjA2MTMxNjQwNDFaGA8y
MTI2MDUyMDE2NDA0MVowGDEWMBQGA1UEAwwNcnNhLWxvY2FsaG9zdDCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBALfCQhTCiyLUqmQdYnIIMdTSbzJanxQi
NhxxX8T5tZnFrc/M3NBNLkNKxwCRsi4dSNvlrjoP2lBtLxcaXi4oEVfO955rJMPK
ttw7YjVC3NTwoJXdIheXZtB1AXdv9NGcYwC9UC9aHW3rQuaK7T/ZilxKQZ9cDvYF
Fa/aQyXGoUAcLNyu0IxKYHsPG6MIZP3LUQwqKr7CmWuMGsEAvN4p42RCaXdY6vnJ
DZGHY9Dti+2EmbmRkAsAG+pMgGz3vpG7B1kLSRLXZAKXNFakDfXWsHTc1/htZCh4
rAy0NX4TTs3fxtCpCdos+vlSvr3BAx3NLfv++as/eawpGz8i7Hf10+MCAwEAAaNv
MG0wHQYDVR0OBBYEFP4rNEnchPJVC9xn751EgXU0kGnAMB8GA1UdIwQYMBaAFP4r
NEnchPJVC9xn751EgXU0kGnAMA8GA1UdEwEB/wQFMAMBAf8wGgYDVR0RBBMwEYIJ
bG9jYWxob3N0hwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQAHuaSNPGEQS9EqKgb2
G2ed6gfQ8H5JaFMFpKuAeL6L61PlF5keMu5ecXYDfWBQTvs9MfBmInz/S9hshbkQ
9eMu2LhJGd4I6tLQ0ylucmrg0yGZACP1f2WDOthw1SGZGaRHdoMulUg8yKxWTnCM
ypDC+NYBm/cqJphTCFKduB1jFQAOdIo4i3vUI/Gxd4IOZ+tlwFz9lS5GYQ6TugBA
acYBZIpIzwhDSe0kpEcH3m1mRs41rs0XsoJ5vMDZFMuLP6l3H/Omtj8qljNIvRlY
jb2eqycxFwhsWTt9mdBI2YIzwcmdNk+Kh71+B34wthbrNNdhxZ5DPIIJloSj3vD7
0b6r
-----END CERTIFICATE-----`,
    key: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC3wkIUwosi1Kpk
HWJyCDHU0m8yWp8UIjYccV/E+bWZxa3PzNzQTS5DSscAkbIuHUjb5a46D9pQbS8X
Gl4uKBFXzveeayTDyrbcO2I1QtzU8KCV3SIXl2bQdQF3b/TRnGMAvVAvWh1t60Lm
iu0/2YpcSkGfXA72BRWv2kMlxqFAHCzcrtCMSmB7DxujCGT9y1EMKiq+wplrjBrB
ALzeKeNkQml3WOr5yQ2Rh2PQ7YvthJm5kZALABvqTIBs976RuwdZC0kS12QClzRW
pA311rB03Nf4bWQoeKwMtDV+E07N38bQqQnaLPr5Ur69wQMdzS37/vmrP3msKRs/
Iux39dPjAgMBAAECggEAFtKgucqufzqh7bdHP9nMCUkYQyJwOY7vi47P5ztga7iF
QuwzIgfupAWd5nCHYc+EpL3HwDGx2rqvgOi8eR0Zh6oOpSAHkUMUfRE/EasRRGfy
efUyGR4BHgjk5WcD+s4NRHfphUgQTv5Lm9igvi+6+IVx1boYUu6vZ9ztlBEx0TAN
fB/Y1dj4uS6SU9jyobK/AZq6BEmZCnbVwibpH/R/Z6WMTaMpI99smRBpj8kFnOQj
6jWdL+Sy+AM8bLc+YsUbPaPYEjBSyMrMmnd1mT4z+I61RYJpxyuKfUvNN//SYBH5
zSB0WbchI7znDgXxvXidS1jmWdQ4Al86Fx/CDF+1gQKBgQD8wdeaetqUA8xWOIYN
I+L/yOao1u28X2L5DzADt8D81mcEQbceLWXhbEo6FtvTpWvkOwCrvC1HLTj/v66d
+mgB+GgsilOE8qo5kW+hKT5X0x8tlo3f57fXRQqjQmQpjKS35W40XehBPKh4jvPC
fUVZz9lQ6m0wL7q9QN9OlhyGwQKBgQC6HcwO0QVUcb9lJw8qUkd8mgDVOqdlZVFE
N7ZZInV1i+M3vHKRVYmfQu2iqO5bQ1WP5kjze5Twn6cT27UIP2dLyHmVmOjccArV
w+RxeUmw9BmXa8pB2ikqIeLLs0JgYB1s0U5kUdYove6tCkbcEL8t5zNZjs6aFi/u
2wiL5gzHowKBgQDcWGyKCqH0uV7wp3QNjoR9MnoLJNu6BXn14AyeoRnIEW1bY6Ks
1yzjGRGYlIbtel+VZu6NyI28aCsxobwrkroLRbAjbC+lThuh9izX1Wm5DJ84kfB7
CrnVHCZK7zz8j9SlUIkDc/5eqO/BsfXFToof4rfz93pasLFd/WjvTKPvwQKBgGXS
zYRBqOfVP4BIyUw/Lasm2lPOPi0ELFzlGhdT+e0wdkRVDl0i7iM6y6YVRCqcASC0
Pa8wKoEm55K+viFgBtR4PsSwnp2Tkun2vXGziLSOJ74nE8XJZIIPffQyA5uUmiSh
soDCISezGfSDzdayNtYXSomxzqiQgPLt1JQtbUp/AoGBAKaqOj6FUdRD3ds2+tXt
iCKq+qQLcFreAdaQ3OKJykKWX+xlgLhvnqrIfMHopGY5N3iEGp0irauYhDzbnpuY
x8S3ommsHLhi3aeId5r+EIkJ9ll5BWxOcRgs/atLaT40CDM5Vx3qzSEC8auOE4B5
EDnAN+SRORTO4epMgRiENIEZ
-----END PRIVATE KEY-----`,
  },
  "ecdsa": {
    cert: `-----BEGIN CERTIFICATE-----
MIIBpjCCAU2gAwIBAgIUPWShsQtCuc97Hdm9I+ipbsKrgZcwCgYIKoZIzj0EAwIw
GjEYMBYGA1UEAwwPZWNkc2EtbG9jYWxob3N0MCAXDTI2MDYxMzE2NDA0MVoYDzIx
MjYwNTIwMTY0MDQxWjAaMRgwFgYDVQQDDA9lY2RzYS1sb2NhbGhvc3QwWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAAQQ7WHhvk5Icy1UuwgzzFfvQMfH3FnGNBcxvINX
tRG6POticc4jqEDuZPXZo+FmvGDF7y9YvxDXjfZFLzIbL/smo28wbTAdBgNVHQ4E
FgQU60sgbRi+E0NGG31Zq8KDQ9aSlagwHwYDVR0jBBgwFoAU60sgbRi+E0NGG31Z
q8KDQ9aSlagwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwCgYIKoZIzj0EAwIDRwAwRAIgHKpxMdB/cR9DUiHG9MxYgcu5MN/0rPJV
T8mzSFQ5iyACIAnbr6sFD/rlTbh/ADrHGMOWv8uPcYly6JLr1OKGKgNt
-----END CERTIFICATE-----`,
    key: `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIMCrDw7RCsq66+trOkbw6yZLetWvA5QcSNzH4ecYr9aroAoGCCqGSM49
AwEHoUQDQgAEEO1h4b5OSHMtVLsIM8xX70DHx9xZxjQXMbyDV7URujzrYnHOI6hA
7mT12aPhZrxgxe8vWL8Q1432RS8yGy/7Jg==
-----END EC PRIVATE KEY-----`,
  },
  "p521": {
    cert: `-----BEGIN CERTIFICATE-----
MIICLDCCAY6gAwIBAgIULMKSgCPMb6GMkhK/ZpfRas9lTPkwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOcDUyMS1sb2NhbGhvc3QwIBcNMjYwNjEzMTcwNDQyWhgPMjEy
NjA1MjAxNzA0NDJaMBkxFzAVBgNVBAMMDnA1MjEtbG9jYWxob3N0MIGbMBAGByqG
SM49AgEGBSuBBAAjA4GGAAQA/PIq4LR4n0p8/94YQowNcGwk6GAs625n0ufFQ/ib
G7uEPD/KUhJTMg/SJRwrq6lOSebbdVjIindagm4mFJtOFpwBk46G1TDMOA8goAGZ
qTp15B5Cte0AnedrSjJ8L24CQeh3P8jrzSpkf/FTKlWbvtl5Mlj4+PVMh+Q0hZkC
UpJoPVWjbzBtMB0GA1UdDgQWBBT18yyESC3nxaPyz7oA8dyBGEHJ/TAfBgNVHSME
GDAWgBT18yyESC3nxaPyz7oA8dyBGEHJ/TAPBgNVHRMBAf8EBTADAQH/MBoGA1Ud
EQQTMBGCCWxvY2FsaG9zdIcEfwAAATAKBggqhkjOPQQDAgOBiwAwgYcCQSyY3lFD
f0N7631iLceyvBQ62U1+cQyDTUNEt9B/YW1TPiUONCfbdHB0IOzBwUBhVPYUcwYR
s+yBvABruLk1OzrQAkIB+twMGvX6ZD8llMA5Ac/lYrIvfL2RiAInaN8Oin194cKP
A148UijZM1s3nxvhjqQZtX/NnS4VrIkmY4PtCY89Rr0=
-----END CERTIFICATE-----`,
    key: `-----BEGIN PRIVATE KEY-----
MIHuAgEAMBAGByqGSM49AgEGBSuBBAAjBIHWMIHTAgEBBEIASR7GbUoVvpY4c+bL
oPGX1Cd+K49MA3BD+pl/eukQuImXGa9PLDrJXyrVrKfjdoKF0EupRxoLOGqFfWO3
A/lGId+hgYkDgYYABAD88irgtHifSnz/3hhCjA1wbCToYCzrbmfS58VD+Jsbu4Q8
P8pSElMyD9IlHCurqU5J5tt1WMiKd1qCbiYUm04WnAGTjobVMMw4DyCgAZmpOnXk
HkK17QCd52tKMnwvbgJB6Hc/yOvNKmR/8VMqVZu+2XkyWPj49UyH5DSFmQJSkmg9
VQ==
-----END PRIVATE KEY-----`,
  },
};

describe("tls.connect verifies server certificates of every key algorithm (#32234)", () => {
  for (const [algorithm, { cert, key }] of Object.entries(algorithmCerts)) {
    it(`authorizes an ${algorithm} server certificate and reads its subjectAltName`, async () => {
      const { promise, resolve, reject } = Promise.withResolvers<{
        authorized: boolean;
        san: string | undefined;
      }>();
      const server = tls.createServer({ cert, key }, socket => socket.end());
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        // rejectUnauthorized defaults to true: a cert the client cannot verify
        // makes the socket emit "error" and fail the test fast instead of ever
        // reaching secureConnect.
        const socket = tls.connect({ port, host: "127.0.0.1", servername: "localhost", ca: cert }, () => {
          const peer = socket.getPeerCertificate(true);
          resolve({ authorized: socket.authorized, san: peer?.subjectaltname });
          socket.end();
        });
        socket.on("error", reject);
      });

      try {
        const result = await promise;
        expect(result.san).toBe("DNS:localhost, IP Address:127.0.0.1");
        expect(result.authorized).toBe(true);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
});
