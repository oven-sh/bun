import type { Subprocess } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isIPv6, tls } from "harness";
import type { IncomingMessage } from "http";
import { join } from "path";
let url: URL;
let process: Subprocess<"ignore", "pipe", "ignore"> | null = null;
beforeAll(async () => {
  process = Bun.spawn(["node", join(import.meta.dir, "renegotiation-feature.js")], {
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: {
      ...bunEnv,
      SERVER_CERT: tls.cert,
      SERVER_KEY: tls.key,
    },
  });
  const { value } = await process.stdout.getReader().read();
  url = new URL(new TextDecoder().decode(value));
});

afterAll(() => {
  process?.kill();
});

it("allow renegotiation in fetch", async () => {
  const body = await fetch(url, {
    verbose: true,
    keepalive: false,
    tls: { rejectUnauthorized: false },
  }).then(res => res.text());
  expect(body).toBe("Hello World");
});

it("should fail if renegotiation fails using fetch", async () => {
  try {
    await fetch(url, {
      verbose: true,
      keepalive: false,
      tls: { rejectUnauthorized: true },
    }).then(res => res.text());
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});

it("allow renegotiation in https module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const req = require("https").request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "GET",
      keepalive: false,
      rejectUnauthorized: false,
    },
    (res: IncomingMessage) => {
      res.setEncoding("utf8");
      let data = "";

      res.on("data", (chunk: string) => {
        data += chunk;
      });

      res.on("error", reject);
      res.on("end", () => resolve(data));
    },
  );
  req.on("error", reject);
  req.end();

  const body = await promise;
  expect(body).toBe("Hello World");
});

it("should fail if renegotiation fails using https", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const req = require("https").request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "GET",
      keepalive: false,
      rejectUnauthorized: true,
    },
    (res: IncomingMessage) => {
      res.setEncoding("utf8");
      let data = "";

      res.on("data", (chunk: string) => {
        data += chunk;
      });

      res.on("error", reject);
      res.on("end", () => resolve(data));
    },
  );
  req.on("error", reject);
  req.end();

  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});
it("allow renegotiation in tls module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();

  const socket = require("tls").connect({
    rejectUnauthorized: false,
    host: url.hostname,
    port: url.port,
  });
  let data = "";
  socket.on("data", (chunk: Buffer) => {
    data += chunk.toString();
    if (data.indexOf("0\r\n\r\n") !== -1) {
      const result = data.split("\r\n\r\n")[1].split("\r\n")[1];
      resolve(result);
    }
  });
  socket.on("error", reject);
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  const body = await promise;
  expect(body).toBe("Hello World");
});

it("pauseOnConnect acts on the first handshake only, not on a renegotiation", async () => {
  // The client reports a renegotiation through a second handshake callback when the
  // first application data after it arrives ("first", still delivered by that same
  // read). A client that pauseOnConnect paused again there would never read "second",
  // which the server only sends once the client acknowledged "first".
  await using server = Bun.spawn({
    cmd: [
      "node",
      "-e",
      `
        const tls = require("tls");
        const server = tls.createServer(
          { cert: process.env.SERVER_CERT, key: process.env.SERVER_KEY, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
          socket => {
            socket.on("error", () => {});
            socket.on("data", () => socket.end("second"));
            socket.renegotiate({ rejectUnauthorized: false }, err => {
              if (err) socket.destroy(err);
              else socket.write("first");
            });
          },
        );
        server.listen(0, "127.0.0.1", () => console.log(server.address().port));
      `,
    ],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key },
  });
  const { value } = await server.stdout.getReader().read();
  const port = Number(new TextDecoder().decode(value).trim());

  const outcome = Promise.withResolvers<{ handshakes: number; received: string }>();
  let handshakes = 0;
  let received = "";
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    tls: { rejectUnauthorized: false },
    pauseOnConnect: true,
    socket: {
      handshake(socket) {
        if (++handshakes === 1) socket.resume();
      },
      data(socket, chunk) {
        received += chunk.toString();
        if (received === "first") socket.write("ack");
        else if (received === "firstsecond") outcome.resolve({ handshakes, received });
      },
      error(_socket, error) {
        outcome.reject(error);
      },
      close() {
        outcome.reject(new Error(`closed after ${handshakes} handshake(s) with ${JSON.stringify(received)}`));
      },
    },
  });
  try {
    expect(await outcome.promise).toEqual({ handshakes: 2, received: "firstsecond" });
  } finally {
    socket.end();
  }
});

it("should not crash when socket is closed inside the renegotiation handshake callback", async () => {
  // When a TLS 1.2 server initiates renegotiation and then sends application data, the
  // client-side SSL_read loop fires the on_handshake callback once the renegotiated
  // handshake completes. If user code closes the socket inside that callback, the SSL*
  // is freed (s->ssl = NULL) and the loop must not continue into SSL_read(NULL, ...).
  // Run in a subprocess so a NULL-deref SIGSEGV shows up as a non-zero exit instead of
  // taking down the test runner.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", renegotiationCloseInHandshakeFixture],
    env: {
      ...bunEnv,
      SERVER_HOST: url.hostname,
      SERVER_PORT: url.port,
      // If the subprocess segfaults in an ASAN build, symbolizing a ~1 GB
      // binary can take longer than the test timeout. We only need the exit
      // code / signal to assert that it did not crash.
      ASAN_OPTIONS: ((bunEnv.ASAN_OPTIONS ?? "") + ":symbolize=0").replace(/^:/, ""),
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode, stderr }).toEqual({
    stdout: "ok",
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
});

const renegotiationCloseInHandshakeFixture = /* js */ `
const { promise: done, resolve } = Promise.withResolvers();
let handshakes = 0;
const socket = await Bun.connect({
  hostname: process.env.SERVER_HOST,
  port: Number(process.env.SERVER_PORT),
  tls: { rejectUnauthorized: false },
  socket: {
    open() {},
    data() {},
    error() {
      resolve();
    },
    close() {
      resolve();
    },
    handshake(socket) {
      handshakes++;
      if (handshakes === 1) {
        // Trigger the server's request handler so it initiates renegotiation
        // and writes application data once the renegotiated handshake completes.
        socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n");
      } else {
        // Second handshake = renegotiation completed. Closing here used to NULL
        // s->ssl while ssl_on_data's SSL_read loop was still running.
        socket.terminate();
        resolve();
      }
    },
  },
});
await done;
if (handshakes < 2) {
  throw new Error("expected renegotiation handshake callback to fire, got " + handshakes + " handshake(s)");
}
console.log("ok");
`;

it("should terminate the connection when the peer exceeds the renegotiation limit over a duplex socket", async () => {
  // tls.connect({ socket: <Duplex> }) is encrypted by the SSLWrapper path
  // (UpgradedDuplex) rather than the uSockets C path. It must apply the same
  // per-connection renegotiation cap: a malicious TLS 1.2 server that spams
  // HelloRequest messages otherwise forces a full handshake each time
  // (unbounded CPU per connection).
  await using attacker = Bun.spawn({
    cmd: [
      "node",
      "-e",
      `
        const tls = require("tls");
        let renegs = 0;
        const server = tls.createServer(
          {
            cert: process.env.SERVER_CERT,
            key: process.env.SERVER_KEY,
            minVersion: "TLSv1.2",
            maxVersion: "TLSv1.2",
          },
          socket => {
            socket.on("error", () => {});
            const again = () => {
              if (renegs >= 10) {
                socket.write("DONE");
                return;
              }
              socket.renegotiate({ rejectUnauthorized: false }, err => {
                if (err) return;
                renegs++;
                again();
              });
            };
            again();
          },
        );
        server.listen(0, () => console.log(server.address().port));
      `,
    ],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key },
  });
  const { value } = await attacker.stdout.getReader().read();
  const port = Number(new TextDecoder().decode(value).trim());

  const net = require("net");
  const { Duplex } = require("stream");
  const raw = net.connect(port, "127.0.0.1");
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end();
      callback();
    },
  });
  raw.on("data", (chunk: Buffer) => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  raw.on("close", () => duplex.destroy());

  const { promise: outcome, resolve } = Promise.withResolvers<string>();
  let received = "";
  const socket = require("tls").connect({ socket: duplex, rejectUnauthorized: false });
  socket.on("data", (chunk: Buffer) => {
    received += chunk.toString();
    if (received.includes("DONE")) resolve("got-response");
  });
  socket.on("error", () => {});
  socket.on("close", () => resolve("closed"));

  // The SSLWrapper must tear the connection down once the peer exceeds the
  // renegotiation limit, before the attacker finishes its 10 renegotiations
  // and delivers the response.
  expect(await outcome).toBe("closed");
});

it("should fail if renegotiation fails using tls module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();

  const socket = require("tls").connect({
    rejectUnauthorized: true,
    host: url.hostname,
    port: url.port,
  });
  let data = "";
  socket.on("data", (chunk: Buffer) => {
    data += chunk.toString();
    if (data.indexOf("0\r\n\r\n") !== -1) {
      const result = data.split("\r\n\r\n")[1].split("\r\n")[1];
      resolve(result);
    }
  });
  socket.on("error", reject);
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});

// Plays a WebSocket server by hand and renegotiates when the client's first frame arrives.
// By then the connected WebSocket client owns the socket, not the upgrade client that
// verified the certificate. After the renegotiation it sends a text frame and a Close frame
// with code 1000. It answers a CONNECT request first, so it can also play an HTTPS proxy in
// front of a ws:// target. With OTHER_CERT it presents that certificate in the renegotiation.
// Its second line of output says how the renegotiation ended, so that a broken fixture
// does not pass for a client that refused the renegotiation.
const renegotiatingWebSocketServer = /* js */ `
  const tls = require("tls");
  const crypto = require("crypto");
  const server = tls.createServer(
    { cert: process.env.SERVER_CERT, key: process.env.SERVER_KEY, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
    socket => {
      socket.on("error", err => {
        const alert = /SSL alert number (\\d+)/.exec(err.message);
        console.log(alert ? "client sent alert " + alert[1] : "error " + err.code);
      });
      let head = "";
      socket.on("data", function onHead(chunk) {
        head += chunk.toString("latin1");
        if (!head.includes("\\r\\n\\r\\n")) return;
        if (head.startsWith("CONNECT ")) {
          head = "";
          socket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
          return;
        }
        socket.off("data", onHead);
        const key = /sec-websocket-key:\\s*(\\S+)/i.exec(head)[1];
        const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n" +
            "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
        );
        socket.once("data", () => {
          if (process.env.OTHER_CERT) {
            socket.setKeyCert(tls.createSecureContext({ cert: process.env.OTHER_CERT, key: process.env.OTHER_KEY }));
          }
          socket.renegotiate({ rejectUnauthorized: false }, err => {
            if (err) return socket.destroy(err);
            console.log("renegotiated");
            const text = Buffer.from("after renegotiation");
            socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text, Buffer.from([0x88, 0x02, 0x03, 0xe8])]));
          });
        });
      });
    },
  );
  server.listen(0, () => console.log(server.address().port));
`;

// A second self-signed certificate for the same names as the harness certificate.
const otherCertificate = {
  cert: readFileSync(join(import.meta.dir, "..", "..", "bun", "http", "fixtures", "cert.pem"), "utf8"),
  key: readFileSync(join(import.meta.dir, "..", "..", "bun", "http", "fixtures", "cert.key"), "utf8"),
};

async function webSocketAcrossRenegotiation(
  url: (port: number) => string,
  options: { proxy?: (port: number) => string; changeCertificate?: boolean } = {},
): Promise<{ client: string[]; server: string | undefined }> {
  await using server = Bun.spawn({
    cmd: ["node", "-e", renegotiatingWebSocketServer],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: {
      ...bunEnv,
      SERVER_CERT: tls.cert,
      SERVER_KEY: tls.key,
      ...(options.changeCertificate && { OTHER_CERT: otherCertificate.cert, OTHER_KEY: otherCertificate.key }),
    },
  });
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  // Line `index` of the server's output, or undefined when the server exits before it prints that line.
  async function serverLine(index: number): Promise<string | undefined> {
    while (output.split("\n").length < index + 2) {
      const { value, done } = await reader.read();
      if (done) return undefined;
      output += decoder.decode(value, { stream: true });
    }
    return output.split("\n")[index].trim();
  }
  const port = Number(await serverLine(0));

  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  const ws = new WebSocket(url(port), {
    tls: { ca: [tls.cert, otherCertificate.cert] },
    ...(options.proxy && { proxy: options.proxy(port) }),
  });
  ws.onopen = () => {
    events.push("open");
    ws.send("renegotiate now");
  };
  ws.onmessage = event => events.push(`message: ${event.data}`);
  ws.onclose = event => {
    events.push(`close ${event.code}`);
    closed.resolve();
  };
  await closed.promise;
  return { client: events, server: await serverLine(1) };
}

// An IP address host sends no SNI, so the name for the certificate check of the
// renegotiation cannot come from the TLS session.
it.concurrent.each(["localhost", "127.0.0.1", ...(isIPv6() ? ["[::1]"] : [])])(
  "WebSocket to %s stays open when the server renegotiates",
  async host => {
    expect(await webSocketAcrossRenegotiation(port => `wss://${host}:${port}/`)).toEqual({
      client: ["open", "message: after renegotiation", "close 1000"],
      server: "renegotiated",
    });
  },
);

// The TLS peer is the proxy, so the certificate is checked against the name of the proxy,
// not against the host in the WebSocket URL.
it.concurrent.each(["localhost", "127.0.0.1"])(
  "WebSocket through an HTTPS proxy at %s stays open when the proxy renegotiates",
  async host => {
    const result = await webSocketAcrossRenegotiation(() => "ws://target.invalid/", {
      proxy: port => `https://${host}:${port}`,
    });
    expect(result).toEqual({
      client: ["open", "message: after renegotiation", "close 1000"],
      server: "renegotiated",
    });
  },
);

// The client trusts both certificates and both are valid for the host. The second one is
// refused only because a renegotiation must present the certificate of the first handshake.
// Alert 47 is illegal_parameter, which BoringSSL sends for a changed certificate.
it.concurrent.each(["localhost", "127.0.0.1"])(
  "WebSocket to %s closes when the server changes its certificate in a renegotiation",
  async host => {
    const result = await webSocketAcrossRenegotiation(port => `wss://${host}:${port}/`, {
      changeCertificate: true,
    });
    expect(result).toEqual({ client: ["open", "close 1006"], server: "client sent alert 47" });
  },
);
