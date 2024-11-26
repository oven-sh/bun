import { describe, expect, it } from "bun:test";
import { tls as COMMON_CERT_ } from "harness";
import net from "net";
import { join } from "path";
import tls, { checkServerIdentity, connect as tlsConnect, TLSSocket } from "tls";
import stream from "stream";

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

it("should have checkServerIdentity", async () => {
  expect(checkServerIdentity).toBeFunction();
  expect(tls.checkServerIdentity).toBeFunction();
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
    it("should work with alpnProtocols", done => {
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
        expect(cert.ca).toBeFalse();
        expect(cert.bits).toBe(2048);
        expect(cert.modulus).toBe(
          "BEEE8773AF7C8861EC11351188B9B1798734FB0729B674369BE3285A29FE5DACBFAB700D09D7904CF1027D89298BD68BE0EF1DF94363012B0DEB97F632CB76894BCC216535337B9DB6125EF68996DD35B4BEA07E86C41DA071907A86651E84F8C72141F889CC0F770554791E9F07BBE47C375D2D77B44DBE2AB0ED442BC1F49ABE4F8904977E3DFD61CD501D8EFF819FF1792AEDFFACA7D281FD1DB8C5D972D22F68FA7103CA11AC9AAED1CDD12C33C0B8B47964B37338953D2415EDCE8B83D52E2076CA960385CC3A5CA75A75951AAFDB2AD3DB98A6FDD4BAA32F575FEA7B11F671A9EAA95D7D9FAF958AC609F3C48DEC5BDDCF1BC1542031ED9D4B281D7DD1",
        );
        expect(cert.exponent).toBe("0x10001");
        expect(cert.pubkey).toBeInstanceOf(Buffer);
        expect(cert.valid_from).toBe("Sep  6 23:27:34 2023 GMT"); // yes this space is intentional
        expect(cert.valid_to).toBe("Sep  5 23:27:34 2025 GMT");
        expect(cert.fingerprint).toBe("E3:90:9C:A8:AB:80:48:37:8D:CE:11:64:45:3A:EB:AD:C8:3C:B3:5C");
        expect(cert.fingerprint256).toBe(
          "53:DD:15:78:60:FD:66:8C:43:9E:19:7E:CF:2C:AF:49:3C:D1:11:EC:61:2D:F5:DC:1D:0A:FA:CD:12:F9:F8:E0",
        );
        expect(cert.fingerprint512).toBe(
          "2D:31:CB:D2:A0:CA:E5:D4:B5:59:11:48:4B:BC:65:11:4F:AB:02:24:59:D8:73:43:2F:9A:31:92:BC:AF:26:66:CD:DB:8B:03:74:0C:C1:84:AF:54:2D:7C:FD:EF:07:6E:85:66:98:6B:82:4F:A5:72:97:A2:19:8C:7B:57:D6:15",
        );
        expect(cert.serialNumber).toBe("1DA7A7B8D71402ED2D8C3646A5CEDF2B8117EFC8");
        expect(cert.raw).toBeInstanceOf(Buffer);
      } finally {
        socket.end();
      }
    });

    it("should have peer certificate", async () => {
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
        // we just check the types this can change over time
        const infoAccess = cert.infoAccess as NodeJS.Dict<string[]>;
        expect(infoAccess["OCSP - URI"]).toBeDefined();
        expect(infoAccess["CA Issuers - URI"]).toBeDefined();
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

    it("getCipher, getProtocol, getEphemeralKeyInfo, getSharedSigalgs, getSession, exportKeyingMaterial and isSessionReused should work", async () => {
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
    });

    // Test using only options
    it("should process options correctly when connect is called with only options", done => {
      let socket = connect({
        port: 443,
        host: "bun.sh",
        rejectUnauthorized: false,
      });

      socket.on("secureConnect", () => {
        expect(socket.remotePort).toBe(443);
        expect(socket[symbolConnectOptions].serverName).toBe("bun.sh");
        socket.end();
        done();
      });

      socket.on("error", err => {
        socket.end();
        done(err);
      });
    });

    // Test using port and host
    it("should process port and host correctly", done => {
      let socket = connect(443, "bun.sh", {
        rejectUnauthorized: false,
      });

      socket.on("secureConnect", () => {
        if (connect === tlsConnect) {
          expect(socket.remotePort).toBe(443);
        }
        expect(socket[symbolConnectOptions].serverName).toBe("bun.sh");
        socket.end();
        done();
      });

      socket.on("error", err => {
        socket.end();
        done(err);
      });
    });

    // Test using port, host, and callback
    it("should process port, host, and callback correctly", done => {
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
          expect(socket[symbolConnectOptions].serverName).toBe("bun.sh");
          socket.end();
          done();
        },
      ).on("error", err => {
        done(err);
      });
    });

    // Additional tests to ensure the callback is optional and handled correctly
    it("should handle the absence of a callback gracefully", done => {
      let socket = connect(443, "bun.sh", {
        rejectUnauthorized: false,
      });

      socket.on("secureConnect", () => {
        expect(socket[symbolConnectOptions].serverName).toBe("bun.sh");
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

    it("should timeout", done => {
      const socket = connect(
        {
          port: 443,
          host: "bun.sh",
        },
        () => {
          socket.setTimeout(1000, () => {
            clearTimeout(timer);
            done();
            socket.end();
          });
        },
      );

      const timer = setTimeout(() => {
        socket.end();
        done(new Error("timeout did not trigger"));
      }, 8000);

      socket.on("error", err => {
        clearTimeout(timer);

        socket.end();
        done(err);
      });
    }, 10_000); // 10 seconds because uWS sometimes is not that precise with timeouts

    it("should be able to transfer data", done => {
      const socket = connect(
        {
          port: 443,
          host: "bun.sh",
          servername: "bun.sh",
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
              done(new Error("missing data"));
            }
          });
          socket.write("GET / HTTP/1.1\r\n");
          socket.write("Host: bun.sh\r\n");
          socket.write("Connection: close\r\n");
          socket.write("Content-Length: 0\r\n");
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
