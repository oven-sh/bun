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
    // resume() so the ClientHello the peer still sends is discarded and `c`
    // can reach 'end' -> autoDestroy; Node buffers otherwise and server.close()
    // (from await using) would wait on it forever.
    c.resume();
    c.end();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { promise, resolve } = Promise.withResolvers();
  tls.connect((server.address() as AddressInfo).port).on("error", resolve);

  const error = await promise;

  expect(error).toBeDefined();
  expect((error as Error).code as string).toBe("ECONNRESET");
});
it("initializes authorizationError to null in the TLSSocket constructor", () => {
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L556
  // Node's onServerSocketSecure/onConnectSecure only assign on failure; a
  // clean handshake leaves the constructor's null untouched.
  const socket = new tls.TLSSocket();
  expect({ value: socket.authorizationError, hasOwn: "authorizationError" in socket }).toEqual({
    value: null,
    hasOwn: true,
  });
  socket.destroy();
});

it("setMaxSendFragment mirrors OpenSSL's [512, 16384] acceptance without throwing", async () => {
  // Node returns whatever SSL_set_max_send_fragment returns: OpenSSL rejects a
  // size outside [512, 16384] with 0 (-> false). BoringSSL clamps and always
  // returns 1, so bun enforces the same contract in the native binding.
  const server = tls.createServer(COMMON_CERT_, s => s.on("data", () => {}));
  await once(server.listen(0, "127.0.0.1"), "listening");
  const connected = Promise.withResolvers<void>();
  const client = tls.connect(
    { port: (server.address() as AddressInfo).port, host: "127.0.0.1", rejectUnauthorized: false },
    connected.resolve,
  );
  client.on("error", connected.reject);
  try {
    await connected.promise;
    const results = [0, -1, 511, 512, 16384, 16385].map(size => [size, client.setMaxSendFragment(size)]);
    expect(results).toEqual([
      [0, false],
      [-1, false],
      [511, false],
      [512, true],
      [16384, true],
      [16385, false],
    ]);
  } finally {
    client.destroy();
    server.close();
  }
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

describe("rejectUnauthorized only treats a literal `false` as opting out", () => {
  // Node applies `options.rejectUnauthorized !== false`, so other falsy
  // values must keep peer verification enabled.
  it.each([null, 0, ""])("rejects a self-signed peer when rejectUnauthorized is %p", async value => {
    const server = tls.createServer({ ...COMMON_CERT_ }, s => s.end());
    let client: TLSSocket | undefined;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { promise, resolve, reject } = Promise.withResolvers<Error & { code?: string }>();
      client = tlsConnect(
        { port: (server.address() as AddressInfo).port, host: "127.0.0.1", rejectUnauthorized: value as any },
        () => reject(new Error("secureConnect must not be reached")),
      );
      client.on("error", resolve);
      const error = await promise;
      expect(error.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    } finally {
      client?.destroy();
      server.close();
    }
  });

  it("still completes the handshake unauthorized for a literal `false`", async () => {
    const server = tls.createServer({ ...COMMON_CERT_ }, s => s.end());
    let client: TLSSocket | undefined;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      client = tlsConnect(
        { port: (server.address() as AddressInfo).port, host: "127.0.0.1", rejectUnauthorized: false },
        resolve,
      );
      client.on("error", reject);
      await promise;
      expect(client.authorized).toBe(false);
    } finally {
      client?.destroy();
      server.close();
    }
  });
});

it("a server using `crl` must not poison the process-wide default CA store", async () => {
  // An mTLS server with `crl` and no `ca` shares the process-wide default
  // root store; the CRL flags must land on a private copy or every later
  // default-CA verification in the process fails with UNABLE_TO_GET_CRL.
  const fixturesDir = join(import.meta.dir, "fixtures");
  const agent6KeyPath = join(fixturesDir, "agent6-key.pem");
  const agent6CertPath = join(fixturesDir, "agent6-cert.pem");
  const crlPath = join(import.meta.dir, "..", "test", "fixtures", "keys", "ca2-crl.pem");
  const script = `
    const tls = require("node:tls");
    const { readFileSync } = require("node:fs");
    const { once } = require("node:events");
    const key = readFileSync(${JSON.stringify(agent6KeyPath)}, "utf8");
    const cert = readFileSync(${JSON.stringify(agent6CertPath)}, "utf8");
    const crl = readFileSync(${JSON.stringify(crlPath)}, "utf8");
    async function main() {
      const poison = tls.createServer({ key, cert, requestCert: true, crl });
      poison.listen(0, "127.0.0.1");
      await once(poison, "listening");
      const server = tls.createServer({ key, cert }, s => s.end());
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      // No \`ca\`: relies on NODE_EXTRA_CA_CERTS reaching the default store.
      const socket = tls.connect({ port: server.address().port, host: "127.0.0.1", checkServerIdentity: () => undefined });
      await once(socket, "secureConnect");
      console.log("authorized=" + socket.authorized);
      socket.end();
      poison.close();
      server.close();
    }
    main().catch(error => {
      console.error(error?.code || error?.message || String(error));
      process.exit(1);
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(fixturesDir, "ca1-cert.pem") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // stderr is drained but only surfaced on failure: debug builds may emit
  // benign warnings, so it must never be asserted to be empty.
  expect({ stdout: stdout.trim(), exitCode, failureDetail: exitCode === 0 ? "" : stderr }).toEqual({
    stdout: "authorized=true",
    exitCode: 0,
    failureDetail: "",
  });
});

it("a no-`ca` tls.connect({ crl }) applies the CRL to its own copy of the default roots", async () => {
  // The context starts on SSL_CTX_new()'s empty store; it must be seeded with
  // a private copy of the default roots that the per-socket attach keeps, so
  // CRL checking fails closed exactly like Node (no CRL covers the ca1 chain).
  const fixturesDir = join(import.meta.dir, "fixtures");
  const crlPath = join(import.meta.dir, "..", "test", "fixtures", "keys", "ca2-crl.pem");
  const script = `
    const tls = require("node:tls");
    const { readFileSync } = require("node:fs");
    const { once } = require("node:events");
    const key = readFileSync(${JSON.stringify(join(fixturesDir, "agent6-key.pem"))}, "utf8");
    const cert = readFileSync(${JSON.stringify(join(fixturesDir, "agent6-cert.pem"))}, "utf8");
    const crl = readFileSync(${JSON.stringify(crlPath)}, "utf8");
    async function main() {
      const server = tls.createServer({ key, cert }, s => s.end());
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const socket = tls.connect({ port: server.address().port, host: "127.0.0.1", checkServerIdentity: () => undefined, crl });
      socket.on("error", error => {
        console.log("error=" + error.code);
        process.exit(0);
      });
      await once(socket, "secureConnect");
      console.log("authorized=" + socket.authorized);
      process.exit(0);
    }
    main().catch(error => {
      console.error(error?.code || error?.message || String(error));
      process.exit(1);
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(fixturesDir, "ca1-cert.pem") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // stderr is drained but only surfaced on failure (debug builds may warn).
  expect({ stdout: stdout.trim(), exitCode, failureDetail: exitCode === 0 ? "" : stderr }).toEqual({
    stdout: "error=UNABLE_TO_GET_CRL",
    exitCode: 0,
    failureDetail: "",
  });
});

it("TLSSocket._requestCert follows Node's _init rule", () => {
  // Clients always request the peer certificate; servers only when asked.
  // Must be decided in the constructor, before a server wrap starts its
  // upgrade: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L845-L848
  // Like the JSStreamSocket test above, the detached wrappers are not
  // destroyed: tearing down a never-connected duplex wrap is its own quirk.
  const cases = [
    new TLSSocket(new stream.PassThrough()), // client
    new TLSSocket(new stream.PassThrough(), { isServer: true }),
    new TLSSocket(new stream.PassThrough(), { isServer: true, requestCert: true }),
  ];
  expect(cases.map(s => (s as any)._requestCert)).toEqual([true, false, true]);
});

it("socket.ssl is assignable like Node's plain own property", async () => {
  // Node assigns `this.ssl` in _init and nulls it in _destroySSL, so it must
  // accept writes; a getter-only accessor would throw in strict mode.
  const server = tls.createServer({ ...COMMON_CERT_ }, s => s.end());
  let client: TLSSocket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const connected = Promise.withResolvers<void>();
    client = tlsConnect(
      { port: (server.address() as AddressInfo).port, host: "127.0.0.1", rejectUnauthorized: false },
      connected.resolve,
    );
    client.on("error", connected.reject);
    await connected.promise;
    expect(typeof (client as any).ssl?.verifyError).toBe("function");
    (client as any).ssl = null;
    expect((client as any).ssl).toBeNull();
  } finally {
    client?.destroy();
    server.close();
  }
});

it("rejects a `ca` option that contains no certificates at construction time", () => {
  // Deliberately stricter than Node here: Node tolerates an unusable `ca`
  // (zero certificates parse) and only fails later at verification with an
  // empty trust store; Bun rejects the option itself, so a misconfigured pin
  // can never silently fall back to any other roots.
  let err: any;
  try {
    tls.createSecureContext({ ca: "\n" });
  } catch (e) {
    err = e;
  }
  expect(err?.message).toBe("Invalid CA");
});

it("a `ca` that parses to zero certificates is an empty pin set, never the default roots", async () => {
  // A key PEM passed as `ca` is tolerated (like Node) and adds nothing; the
  // resulting empty own store must fail closed instead of falling back to the
  // default roots, which NODE_EXTRA_CA_CERTS makes able to verify this chain:
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1831
  const fixturesDir = join(import.meta.dir, "fixtures");
  const script = `
    const tls = require("node:tls");
    const { readFileSync } = require("node:fs");
    const { once } = require("node:events");
    const key = readFileSync(${JSON.stringify(join(fixturesDir, "agent6-key.pem"))}, "utf8");
    const cert = readFileSync(${JSON.stringify(join(fixturesDir, "agent6-cert.pem"))}, "utf8");
    async function main() {
      const server = tls.createServer({ key, cert }, s => s.end());
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const socket = tls.connect({
        port: server.address().port,
        host: "127.0.0.1",
        ca: key,
        allowPartialTrustChain: true,
        checkServerIdentity: () => undefined,
      });
      socket.on("error", error => {
        console.log("error=" + error.code);
        server.close();
      });
      socket.on("secureConnect", () => {
        console.log("secureConnect authorized=" + socket.authorized);
        socket.end();
        server.close();
      });
    }
    main();
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(fixturesDir, "ca1-cert.pem") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, failureDetail: exitCode === 0 ? "" : stderr }).toEqual({
    stdout: "error=UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    exitCode: 0,
    failureDetail: "",
  });
});

it("tls.connect({rejectUnauthorized: undefined}) with NODE_TLS_REJECT_UNAUTHORIZED=0 still rejects", async () => {
  // Node's spread `{rejectUnauthorized: !allowUnauthorized, ...options}`:
  // an explicit own-property `undefined` overrides the env-derived default and
  // then coerces to true via `!== false`; only an OMITTED key falls through to
  // the env var. https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1732-L1781
  const script = `
    const tls = require("node:tls");
    const { once } = require("node:events");
    const server = tls.createServer(${JSON.stringify(COMMON_CERT_)}, s => s.end());
    server.listen(0, "127.0.0.1");
    server.on("listening", () => {
      const socket = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: undefined });
      socket.on("error", error => {
        console.log("error=" + error.code);
        socket.destroy();
        server.close();
      });
      socket.on("secureConnect", () => {
        console.log("secureConnect authorized=" + socket.authorized);
        socket.end();
        server.close();
      });
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, failureDetail: exitCode === 0 ? "" : stderr }).toEqual({
    stdout: "error=DEPTH_ZERO_SELF_SIGNED_CERT",
    exitCode: 0,
    failureDetail: "",
  });
});

it("an inherited rejectUnauthorized cannot disable certificate verification", async () => {
  // Node merges the user options with an own-property spread, so a polluted
  // Object.prototype never reaches the socket and the peer is still verified.
  const script = `
    Object.prototype.rejectUnauthorized = false;
    const tls = require("node:tls");
    const server = tls.createServer(${JSON.stringify(COMMON_CERT_)}, s => s.end());
    server.listen(0, "127.0.0.1");
    server.on("listening", () => {
      const socket = tls.connect({ port: server.address().port, host: "127.0.0.1" });
      socket.on("error", error => {
        console.log("error=" + error.code);
        socket.destroy();
        server.close();
      });
      socket.on("secureConnect", () => {
        console.log("secureConnect authorized=" + socket.authorized);
        socket.end();
        server.close();
      });
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, failureDetail: exitCode === 0 ? "" : stderr }).toEqual({
    stdout: "error=DEPTH_ZERO_SELF_SIGNED_CERT",
    exitCode: 0,
    failureDetail: "",
  });
});

it("an inherited checkServerIdentity cannot become the hostname verifier", async () => {
  // Node installs its own default before spreading the user options, so a
  // polluted Object.prototype never reaches the socket. Trusting the cert makes
  // verification succeed, which is the only path that runs the identity check.
  const script = `
    let called = false;
    Object.prototype.checkServerIdentity = () => { called = true; };
    const tls = require("node:tls");
    const c = ${JSON.stringify(COMMON_CERT_)};
    const server = tls.createServer({ key: c.key, cert: c.cert }, s => s.end());
    server.listen(0, "127.0.0.1", () => {
      const socket = tls.connect({
        port: server.address().port,
        host: "127.0.0.1",
        ca: [c.cert],
        servername: "localhost",
      });
      socket.on("secureConnect", () => {
        console.log("polluted=" + called);
        socket.end();
        server.close();
      });
      socket.on("error", error => {
        console.log("error=" + error.code);
        socket.destroy();
        server.close();
      });
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, failureDetail: exitCode === 0 ? "" : stderr }).toEqual({
    stdout: "polluted=false",
    exitCode: 0,
    failureDetail: "",
  });
});
