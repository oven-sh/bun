import { describe, expect, it } from "bun:test";
import { once } from "events";
import { tls as COMMON_CERT_ } from "harness";
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
        expect(cert.ca).toBe(true);
        expect(cert.bits).toBe(2048);
        expect(cert.modulus).toBe(
          "e5633a2c8118171cbeaf321d55d0444586cbe566bb51a234b0ead69faf7490069854efddffac68986652ff949f472252e4c7d24c6ee4e3366e54d9e4701e24d021e583e1a088112c0f96475a558b42f883a3e796c937cc4d6bb8791b227017b3e73deb40b0ac84f033019f580a3216888acec71ce52d938fcadd8e29794e38774e33d323ede89b58e526ef8b513ba465fa4ffd9cf6c1ec7480de0dcb569dec295d7b3cce40256b428d5907e90e7a52e77c3101f4ad4c0e254ab03d75ac42ee1668a5094bc4521b264fb404b6c4b17b6b279e13e6282e1e4fb6303540cb830ea8ff576ca57b7861e4ef797af824b0987c870718780a1c5141e4f904fd0c5139f5",
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
        expect(cert.serialNumber).toBe("71a46ae89fd817ef81a34d5973e1de42f09b9d63");
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
    // prettier-ignore
    it.skipIf(connect === duplexProxy)("should process options correctly when connect is called with only options", done => {
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
