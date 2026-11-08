/**
 * The SNI name of a TLS handshake, as the JS of a server reads it, and the ALPN protocol, as both ends read it.
 *
 * Node makes a one-byte string from the bytes of each: one code unit for each byte, and no decoding.
 * https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1359-L1373 (servername)
 * https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L2100-L2124 (alpnProtocol)
 * A name of tls.Server#addContext() is tested against that servername, so it selects by the same code units.
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1576-L1580
 *
 * The expected values are what Node.js v26.3.0 gives. All tests in this file run in both Bun and Node.js:
 * `bun test` runs them here, and the last test runs this same file under Node.js.
 */
import assert from "node:assert";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";
import { promisify } from "node:util";

const fixtures = join(import.meta.dirname, "fixtures");
const key = readFileSync(join(fixtures, "agent1-key.pem"));
const cert = readFileSync(join(fixtures, "agent1-cert.pem"));

// tls.connect() sends its servername option as UTF-8, so "\u00e9.example" is these bytes on the wire.
const E_ACUTE_EXAMPLE = "c3 a9 2e 65 78 61 6d 70 6c 65";

// The code units of a string in hex. Any other value stays as it is.
const units = (value: unknown) =>
  typeof value === "string" ? Array.from(value, unit => unit.charCodeAt(0).toString(16)).join(" ") : value;
// @types/node does not declare the property.
const servername = (socket: unknown) => units((socket as { servername: unknown }).servername);

async function listen(server: net.Server) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return (server.address() as AddressInfo).port;
}

// Only s_client of the OpenSSL CLI sends a name that is not UTF-8: it sends the bytes of -servername as they are.
async function opensslVersion() {
  if (process.platform === "win32") return "";
  try {
    return (await promisify(execFile)("openssl", ["version"])).stdout;
  } catch {
    return "";
  }
}
const opensslTest = (await opensslVersion()).startsWith("OpenSSL ") ? test : test.skip;

describe("servername of an https.Server socket has one code unit for each byte of the SNI name", () => {
  // What 'secureConnection' and 'request' report for the one connection that `request` makes.
  async function servernames(request: (port: number) => Promise<string>) {
    const seen: { secureConnection?: unknown; request?: unknown } = {};
    const server = https.createServer({ key, cert }, (req, res) => {
      seen.request = servername(req.socket);
      res.end();
    });
    server.on("secureConnection", socket => (seen.secureConnection = servername(socket)));
    try {
      const response = await request(await listen(server));
      return { ...seen, status: response.split("\r\n", 1)[0] };
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  // Resolves with the response, or with the error code of the connection.
  function tlsRequest(port: number, name: string | undefined) {
    const { promise, resolve } = Promise.withResolvers<string>();
    let received = "";
    const socket = tls.connect({ port, host: "127.0.0.1", servername: name, rejectUnauthorized: false }, () => {
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    socket.setEncoding("latin1");
    socket.on("data", chunk => (received += chunk));
    socket.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
    socket.on("close", () => resolve(received));
    return promise;
  }

  // An argument from a JS string is UTF-8, so printf in the shell makes the byte ff from \377.
  function opensslRequest(port: number, name: string) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const client = spawn(
      "sh",
      ["-c", `openssl s_client -connect 127.0.0.1:${port} -servername "$(printf '${name}')" -quiet`],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    let received = "";
    client.stdout.setEncoding("latin1");
    client.stdout.on("data", chunk => (received += chunk));
    client.on("error", reject);
    client.on("close", () => resolve(received));
    client.stdin.end("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    return promise;
  }

  const fromTlsConnect: [string, string | undefined, string | false][] = [
    ["a name that is not ASCII", "\u00e9.example", E_ACUTE_EXAMPLE],
    ["an ASCII name", "localhost", "6c 6f 63 61 6c 68 6f 73 74"],
    ["no name", undefined, false],
  ];
  for (const [label, name, expected] of fromTlsConnect) {
    test(`${label} from tls.connect()`, async () => {
      const seen = await servernames(port => tlsRequest(port, name));
      assert.deepStrictEqual(seen, { secureConnection: expected, request: expected, status: "HTTP/1.1 200 OK" });
    });
  }

  const fromOpenssl = [
    ["\\377", "ff"],
    ["a\\377b.example", "61 ff 62 2e 65 78 61 6d 70 6c 65"],
  ];
  for (const [name, expected] of fromOpenssl) {
    opensslTest(`a name that is not UTF-8 (${name}) from openssl s_client`, async () => {
      const seen = await servernames(port => opensslRequest(port, name));
      assert.deepStrictEqual(seen, { secureConnection: expected, request: expected, status: "HTTP/1.1 200 OK" });
    });
  }
});

describe("servername of a tls.Server socket has one code unit for each byte of the SNI name", () => {
  test("SNICallback, ALPNCallback and socket.servername get the same string in one handshake", async () => {
    const seen: Record<string, unknown> = {};
    const secured = Promise.withResolvers<void>();
    const server = tls.createServer({
      key,
      cert,
      SNICallback: (name, cb) => {
        seen.SNICallback = units(name);
        cb(null);
      },
      ALPNCallback: ({ servername, protocols }) => {
        seen.ALPNCallback = units(servername);
        return protocols[0];
      },
    });
    server.on("secureConnection", socket => {
      seen.socket = servername(socket);
      secured.resolve();
    });
    server.on("tlsClientError", secured.reject);
    const client = tls.connect({
      port: await listen(server),
      host: "127.0.0.1",
      servername: "\u00e9.example",
      ALPNProtocols: ["h2"],
      rejectUnauthorized: false,
    });
    client.on("error", secured.reject);
    try {
      await secured.promise;
      assert.deepStrictEqual(seen, {
        SNICallback: E_ACUTE_EXAMPLE,
        ALPNCallback: E_ACUTE_EXAMPLE,
        socket: E_ACUTE_EXAMPLE,
      });
    } finally {
      client.destroy();
      server.close();
    }
  });

  // tls.connect() cannot send a name that is not UTF-8, so a relay overwrites one byte of the name in the ClientHello.
  // The handshake then fails, after the server has read the name.
  test("the socket of 'tlsClientError' has a name that is not UTF-8", async () => {
    const outcome = Promise.withResolvers<unknown>();
    const server = tls.createServer({ key, cert });
    server.on("secureConnection", socket => outcome.resolve(["secureConnection", servername(socket)]));
    server.on("tlsClientError", (_err, socket) => outcome.resolve(["tlsClientError", servername(socket)]));
    const serverPort = await listen(server);

    const name = "qzq.example";
    const relay = net.createServer(downstream => {
      const upstream = net.connect(serverPort, "127.0.0.1");
      let hello: Buffer | null = Buffer.alloc(0);
      downstream.on("data", (chunk: Buffer) => {
        if (!hello) return void upstream.write(chunk);
        hello = Buffer.concat([hello, chunk]);
        // A TLS record is a 5-byte header, which ends with the length of the body, and the body.
        if (hello.length < 5 || hello.length < 5 + hello.readUInt16BE(3)) return;
        const at = hello.indexOf(name);
        if (at !== -1) hello[at + 1] = 0xff;
        upstream.write(hello);
        hello = null;
      });
      upstream.on("data", chunk => downstream.write(chunk));
      downstream.on("error", () => {}).on("close", () => upstream.destroy());
      upstream.on("error", () => {}).on("close", () => downstream.destroy());
    });
    const client = tls.connect({
      port: await listen(relay),
      host: "127.0.0.1",
      servername: name,
      rejectUnauthorized: false,
    });
    client.on("error", () => {});
    try {
      assert.deepStrictEqual(await outcome.promise, ["tlsClientError", "71 ff 71 2e 65 78 61 6d 70 6c 65"]);
    } finally {
      client.destroy();
      relay.close();
      server.close();
    }
  });

  test("http2.createSecureServer() has the same string as session.socket.servername", async () => {
    const seen = Promise.withResolvers<unknown>();
    const server = http2.createSecureServer({ key, cert });
    server.on("session", session => seen.resolve(servername(session.socket)));
    const client = http2.connect(`https://127.0.0.1:${await listen(server)}`, {
      servername: "\u00e9.example",
      rejectUnauthorized: false,
    });
    client.on("error", seen.reject);
    try {
      assert.strictEqual(await seen.promise, E_ACUTE_EXAMPLE);
    } finally {
      client.destroy();
      server.close();
    }
  });
});

describe("tls.Server#addContext() selects by a name that has one code unit for each byte of the SNI name", () => {
  const context = (agent: string) => ({
    key: readFileSync(join(fixtures, `${agent}-key.pem`)),
    cert: readFileSync(join(fixtures, `${agent}-cert.pem`)),
  });

  // The same code units, in a string for which the engine keeps two bytes for each code unit.
  const inTwoByteStorage = (text: string) => Buffer.from(text, "utf16le").toString("utf16le");
  // tls.connect() sends `sent` as UTF-8. `sameUnits` is the servername that the server reads from those bytes.
  const clients = [
    { sent: "\u00e9.example", sameUnits: "\u00c3\u00a9.example" },
    { sent: "\u4e2d.example", sameUnits: inTwoByteStorage("\u00e4\u00b8\u00ad.example") },
  ];

  // The CN of the certificate that the server presents to a client that sends `sent`, and the servername that the server reads.
  async function handshake(server: tls.Server, port: number, sent: string) {
    const accepted = once(server, "secureConnection");
    const client = tls.connect({ port, host: "127.0.0.1", servername: sent, rejectUnauthorized: false });
    try {
      const [[socket]] = await Promise.all([accepted, once(client, "secureConnect")]);
      return { certificate: client.getPeerCertificate().subject.CN, servername: servername(socket) };
    } finally {
      client.destroy();
    }
  }

  // Each way for a server to have its names when a ClientHello arrives: the server, the port to connect to, and what to close.
  const orders: Record<string, (add: (server: tls.Server) => void) => Promise<[tls.Server, number, net.Server]>> = {
    "added before listen()": async add => {
      const server = tls.createServer(context("agent1"));
      add(server);
      return [server, await listen(server), server];
    },
    "added after listen()": async add => {
      const server = tls.createServer(context("agent1"));
      const port = await listen(server);
      add(server);
      return [server, port, server];
    },
    "of a server that does not listen and gets its sockets from emit('connection')": async add => {
      const server = tls.createServer(context("agent1"));
      add(server);
      const front = net.createServer(socket => server.emit("connection", socket));
      return [server, await listen(front), front];
    },
  };

  for (const [order, start] of Object.entries(orders)) {
    test(`a name ${order}`, async () => {
      const [server, port, listener] = await start(server => {
        for (const { sent, sameUnits } of clients) {
          server.addContext(sameUnits, context("agent2"));
          server.addContext(sent, context("agent3"));
        }
      });
      try {
        const seen: unknown[] = [];
        for (const { sent } of clients) seen.push(await handshake(server, port, sent));
        assert.deepStrictEqual(
          seen,
          clients.map(({ sameUnits }) => ({ certificate: "agent2", servername: units(sameUnits) })),
        );
      } finally {
        listener.close();
      }
    });

    // "-" is the low byte of U+4E2D, and "?" is what a conversion that loses a code unit writes for it.
    test(`a name with a code unit above 0xFF, ${order}, selects for no client`, async () => {
      const [server, port, listener] = await start(server => server.addContext("\u4e2d.example", context("agent2")));
      try {
        const certificates: unknown[] = [];
        for (const sent of ["\u4e2d.example", "-.example", "?.example"]) {
          certificates.push((await handshake(server, port, sent)).certificate);
        }
        assert.deepStrictEqual(certificates, ["agent1", "agent1", "agent1"]);
      } finally {
        listener.close();
      }
    });
  }
});

describe("alpnProtocol of a TLS socket has one code unit for each byte of the protocol", () => {
  const protocols: [string, number[], string][] = [
    ["not UTF-8", [0xff], "ff"],
    ["not ASCII", [0xc3, 0xa9], "c3 a9"],
    ["ASCII", [0x78, 0x2f, 0x31], "78 2f 31"],
  ];
  for (const [label, protocol, expected] of protocols) {
    test(`a protocol that is ${label}, on both ends`, async () => {
      // Each protocol of the list follows its length.
      const ALPNProtocols = Buffer.from([protocol.length, ...protocol]);
      const accepted = Promise.withResolvers<unknown>();
      const server = tls.createServer({ key, cert, ALPNProtocols }, socket => accepted.resolve(socket.alpnProtocol));
      server.on("tlsClientError", accepted.reject);
      const client = tls.connect({
        port: await listen(server),
        host: "127.0.0.1",
        ALPNProtocols,
        rejectUnauthorized: false,
      });
      try {
        const [serverSide] = await Promise.all([accepted.promise, once(client, "secureConnect")]);
        assert.deepStrictEqual(
          { server: units(serverSide), client: units(client.alpnProtocol) },
          { server: expected, client: expected },
        );
      } finally {
        client.destroy();
        server.close();
      }
    });
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // Node.js parses the `await using` below from v24.0.0.
  const node = nodeExeAtLeast("24.0.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      await using proc = Bun.spawn({
        cmd: [node!, import.meta.filename],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
