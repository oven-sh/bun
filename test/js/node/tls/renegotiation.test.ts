import type { Subprocess } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isIPv6, tls } from "harness";
import type { IncomingMessage } from "http";
import { once } from "node:events";
import { connect as netConnect, createServer as createNetServer, type AddressInfo, type Socket } from "net";
import { join } from "path";
import { Duplex } from "stream";
import { connect as tlsConnect } from "tls";
import { startRecordingProxy } from "../../web/websocket/proxy-test-utils";
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

// A renegotiation reports the certificate check of its own handshake. The client ends its write side while the first
// handshake still runs, which sends nothing but marks the TLS session as shut down. That state must not turn the
// failed check of the renegotiated handshake into a pass. Runs the client over a Duplex, the SSLWrapper path.
// Node cannot be the client here: its own end() mid-handshake fails the connection with ERR_STREAM_WRITE_AFTER_END.
it.concurrent.each([false, true])(
  "a renegotiation keeps the failed certificate check (end() mid-handshake: %p)",
  async end => {
    await using server = Bun.spawn({
      cmd: [
        "node",
        "-e",
        `
        const tls = require("tls");
        const server = tls.createServer(
          {
            cert: process.env.SERVER_CERT,
            key: process.env.SERVER_KEY,
            minVersion: "TLSv1.2",
            maxVersion: "TLSv1.2",
            allowHalfOpen: true,
          },
          socket => {
            socket.on("error", () => {});
            socket.renegotiate({ rejectUnauthorized: false }, err => {
              if (err) socket.destroy(err);
              else socket.write("after-reneg");
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

    const raw = netConnect(port, "127.0.0.1");
    raw.on("error", () => {});
    let firstWrite = true;
    const duplex = new Duplex({
      read() {},
      write(chunk: Buffer, encoding: string, callback: () => void) {
        raw.write(chunk, callback);
        if (end && firstWrite) {
          firstWrite = false;
          setImmediate(() => socket.end());
        }
      },
      // The TLS socket's write side ends locally. The transport stays open, so the renegotiation can still run.
      final(callback: () => void) {
        callback();
      },
    });
    raw.on("data", (chunk: Buffer) => duplex.push(chunk));
    raw.on("end", () => duplex.push(null));
    raw.on("close", () => duplex.destroy());

    const outcome = Promise.withResolvers<string[]>();
    const events: string[] = [];
    const check = (event: string) =>
      events.push(`${event} authorized=${socket.authorized} authError=${socket.authorizationError}`);
    const socket = tlsConnect({ socket: duplex, servername: "localhost", rejectUnauthorized: false });
    socket.on("secureConnect", () => check("secureConnect"));
    socket.on("data", (chunk: Buffer) => {
      check(`data ${chunk}`);
      outcome.resolve(events);
    });
    socket.on("error", (err: NodeJS.ErrnoException) => {
      events.push(`error ${err.code}`);
      outcome.resolve(events);
    });
    socket.on("close", () => outcome.resolve(events));
    try {
      // Two handshakes, then the data the server sends once the renegotiation completed. Every observation of the
      // client reports the self-signed certificate of the server.
      expect(await outcome.promise).toEqual([
        "secureConnect authorized=false authError=DEPTH_ZERO_SELF_SIGNED_CERT",
        "secureConnect authorized=false authError=DEPTH_ZERO_SELF_SIGNED_CERT",
        "data after-reneg authorized=false authError=DEPTH_ZERO_SELF_SIGNED_CERT",
      ]);
    } finally {
      socket.destroy();
      raw.destroy();
    }
  },
);

// The request for a renegotiation can arrive after the client called end(). The client cannot answer it, and the
// certificate check of its first handshake is not the report of a second one.
it("a client that called end() emits 'secureConnect' once when the server then asks for a renegotiation", async () => {
  await using server = Bun.spawn({
    cmd: [
      "node",
      "-e",
      `
      const tls = require("tls");
      let accepted;
      const server = tls.createServer(
        {
          cert: process.env.SERVER_CERT,
          key: process.env.SERVER_KEY,
          minVersion: "TLSv1.2",
          maxVersion: "TLSv1.2",
          allowHalfOpen: true,
        },
        socket => {
          accepted = socket;
          socket.on("error", () => {});
          socket.resume();
        },
      );
      // A line on stdin asks for the renegotiation.
      process.stdin.on("data", () => accepted.renegotiate({ rejectUnauthorized: false }, () => {}));
      server.listen(0, "127.0.0.1", () => console.log(server.address().port));
    `,
    ],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "pipe",
    env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key },
  });
  const { value } = await server.stdout.getReader().read();
  const port = Number(new TextDecoder().decode(value).trim());

  // Holds what the client sends after its handshake, so the server does not see the client's close_notify.
  let holding = false;
  const sawClientFin = Promise.withResolvers<void>();
  const proxied: Socket[] = [];
  const proxy = createNetServer({ allowHalfOpen: true }, downstream => {
    const upstream = netConnect({ port, host: "127.0.0.1", allowHalfOpen: true });
    proxied.push(downstream, upstream);
    downstream.on("data", chunk => {
      if (!holding) upstream.write(chunk);
    });
    downstream.on("end", () => sawClientFin.resolve());
    upstream.on("data", chunk => downstream.write(chunk));
    upstream.on("end", () => downstream.end());
    downstream.on("error", () => {});
    upstream.on("error", () => {});
  });
  await once(proxy.listen(0, "127.0.0.1"), "listening");

  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  const client = tlsConnect({
    port: (proxy.address() as AddressInfo).port,
    host: "127.0.0.1",
    servername: "localhost",
    rejectUnauthorized: false,
  });
  client.on("secureConnect", () => {
    events.push(`secureConnect authorized=${client.authorized} authError=${client.authorizationError}`);
    if (holding) return;
    holding = true;
    client.end();
  });
  client.on("finish", () => events.push("finish"));
  client.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}`));
  client.on("close", () => closed.resolve());
  client.resume();
  try {
    await sawClientFin.promise;
    server.stdin.write("renegotiate\n");
    await server.stdin.flush();
    await closed.promise;
    expect(events).toEqual(["secureConnect authorized=false authError=DEPTH_ZERO_SELF_SIGNED_CERT", "finish"]);
  } finally {
    client.destroy();
    for (const socket of proxied) socket.destroy();
    proxy.close();
  }
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

// A server can ask for the client certificate in a renegotiation only (IIS, Apache per-location SSLVerifyClient).
const nodeKeys = join(import.meta.dir, "..", "test", "fixtures", "keys");
const agent3 = {
  cert: readFileSync(join(nodeKeys, "agent3-cert.pem"), "utf8"),
  key: readFileSync(join(nodeKeys, "agent3-key.pem"), "utf8"),
};

it("fetch sends the client certificate a renegotiation asks for", async () => {
  const res = await fetch(url, { keepalive: false, tls: { ca: tls.cert, ...agent3 } });
  expect({ body: await res.text(), peerCN: res.headers.get("x-peer-cn") }).toEqual({
    body: "Hello World",
    peerCN: "agent3",
  });
});

it("fetch through a CONNECT proxy sends the client certificate a renegotiation asks for", async () => {
  // An ambient NO_PROXY applies to an explicit `proxy` option too and would send this request direct.
  const noProxyKeys = ["NO_PROXY", "no_proxy"];
  const saved = noProxyKeys.map(key => [key, Bun.env[key]] as const);
  for (const key of noProxyKeys) Bun.env[key] = "";
  try {
    using proxy = await startRecordingProxy();
    const res = await fetch(url, {
      keepalive: false,
      tls: { ca: tls.cert, ...agent3 },
      proxy: `http://127.0.0.1:${proxy.port}`,
    });
    expect({ body: await res.text(), peerCN: res.headers.get("x-peer-cn") }).toEqual({
      body: "Hello World",
      peerCN: "agent3",
    });
    expect(proxy.requests.map(r => r.requestLine)).toEqual([`CONNECT localhost:${url.port} HTTP/1.1`]);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
  }
});

it("Bun.connect sends the client certificate a renegotiation asks for", async () => {
  const response = Promise.withResolvers<string>();
  let received = "";
  const socket = await Bun.connect({
    hostname: url.hostname,
    port: Number(url.port),
    tls: { ca: tls.cert, ...agent3 },
    socket: {
      open: socket => void socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
      data(_socket, chunk) {
        received += chunk.toString();
        if (received.includes("0\r\n\r\n")) response.resolve(received);
      },
      error: (_socket, error) => response.reject(error),
      close: () => response.reject(new Error("closed before the response: " + received)),
    },
  });
  try {
    expect(await response.promise).toContain("X-Peer-CN: agent3\r\n");
  } finally {
    socket.end();
  }
});
