import type { Subprocess } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isIPv6, tls } from "harness";
import type { IncomingMessage } from "http";
import { request as httpsRequest } from "https";
import { connect as netConnect } from "net";
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

// The server starts a renegotiation only when the client sends data, and writes "done N" when renegotiation N
// completed. So each handshake report sits between two pieces of data, and request 4 is the one that the client
// refuses (the limit is 3 in 600 s).
const pingPongRenegotiationServer = /* js */ `
  const tls = require("tls");
  // The server counts handshakes too. Only the limit of the client is under test.
  tls.CLIENT_RENEG_LIMIT = 100;
  const server = tls.createServer(
    { cert: process.env.SERVER_CERT, key: process.env.SERVER_KEY, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
    socket => {
      socket.on("error", () => {});
      let asked = 0;
      socket.on("data", () => {
        const n = ++asked;
        socket.renegotiate({ rejectUnauthorized: false }, err => {
          if (!err) socket.write("done " + n);
        });
      });
    },
  );
  server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`;

function spawnPingPongRenegotiationServer() {
  return Bun.spawn({
    cmd: ["node", "-e", pingPongRenegotiationServer],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key },
  });
}

async function portOf(server: ReturnType<typeof spawnPingPongRenegotiationServer>) {
  const { value, done } = await server.stdout.getReader().read();
  if (done) throw new Error("the server exited before it printed its port");
  return Number(new TextDecoder().decode(value).trim());
}

// A refusal is not the result of a handshake. The client reports it as an error, and what the server sent before
// it stays readable.
it.concurrent.each([
  { transport: "TCP", trusted: false },
  { transport: "TCP", trusted: true },
  { transport: "a Duplex", trusted: false },
  { transport: "a Duplex", trusted: true },
])(
  "a renegotiation that the client refuses is an 'error' and no 'secureConnect' over $transport (trusted chain: $trusted)",
  async ({ transport, trusted }) => {
    await using server = spawnPingPongRenegotiationServer();
    const port = await portOf(server);

    const options = { servername: "localhost", rejectUnauthorized: false, ...(trusted && { ca: tls.cert }) };
    let raw: ReturnType<typeof netConnect> | undefined;
    let socket: ReturnType<typeof tlsConnect>;
    if (transport === "TCP") {
      socket = tlsConnect({ ...options, port, host: "127.0.0.1" });
    } else {
      const transportSocket = (raw = netConnect(port, "127.0.0.1"));
      transportSocket.on("error", () => {});
      const duplex = new Duplex({
        read() {},
        write(chunk: Buffer, encoding: string, callback: () => void) {
          transportSocket.write(chunk, callback);
        },
        final(callback: () => void) {
          transportSocket.end();
          callback();
        },
      });
      transportSocket.on("data", (chunk: Buffer) => duplex.push(chunk));
      transportSocket.on("end", () => duplex.push(null));
      transportSocket.on("close", () => duplex.destroy());
      socket = tlsConnect({ ...options, socket: duplex });
    }

    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    socket.on("secureConnect", () => {
      if (events.push(`secureConnect authorized=${socket.authorized}`) === 1) socket.write("go");
    });
    socket.on("data", (chunk: Buffer) => {
      events.push(`data ${chunk}`);
      socket.write("go");
    });
    socket.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}: ${err.message}`));
    socket.on("end", () => events.push("end"));
    socket.on("close", () => closed.resolve());
    try {
      await closed.promise;
      expect(events).toEqual([
        `secureConnect authorized=${trusted}`,
        `secureConnect authorized=${trusted}`,
        "data done 1",
        `secureConnect authorized=${trusted}`,
        "data done 2",
        `secureConnect authorized=${trusted}`,
        "data done 3",
        "error ERR_TLS_SESSION_ATTACK: TLS session renegotiation attack detected",
        "end",
      ]);
    } finally {
      socket.destroy();
      raw?.destroy();
    }
  },
);

// Bun.connect reports the refusal to `error`, or to `close` when the socket has no `error` handler. Neither
// `handshake` nor `open` runs for it.
it.concurrent.each(["handshake, error", "handshake", "error"] as const)(
  "Bun.connect reports a renegotiation that the client refuses (handlers: open, data, %s, close)",
  async handlerSet => {
    await using server = spawnPingPongRenegotiationServer();
    const port = await portOf(server);

    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const describe = (error: unknown) => (error ? `${(error as NodeJS.ErrnoException).code}` : `${error}`);
    let askedFirst = false;
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: { rejectUnauthorized: false, ca: tls.cert, serverName: "localhost" },
      socket: {
        open(socket) {
          events.push("open");
          // With no handshake handler, `open` is the report of the first handshake.
          if (!handlerSet.includes("handshake")) socket.write("go");
        },
        data(socket, chunk) {
          events.push(`data ${chunk}`);
          socket.write("go");
        },
        ...(handlerSet.includes("handshake") && {
          handshake(socket: Bun.Socket, success: boolean, error: Error | null) {
            events.push(`handshake ${success} ${describe(error)}`);
            if (!askedFirst) {
              askedFirst = true;
              socket.write("go");
            }
          },
        }),
        ...(handlerSet.includes("error") && {
          error(_socket: Bun.Socket, error: Error) {
            events.push(`error ${describe(error)}`);
          },
        }),
        close(socket, error) {
          events.push(`close ${describe(error)} authorized=${socket.authorized}`);
          closed.resolve();
        },
      },
    });
    await closed.promise;

    const handshake = handlerSet.includes("handshake") ? ["handshake true null"] : [];
    expect(events).toEqual([
      "open",
      ...handshake,
      ...handshake,
      "data done 1",
      ...handshake,
      "data done 2",
      ...handshake,
      "data done 3",
      ...(handlerSet.includes("error")
        ? ["error ERR_TLS_SESSION_ATTACK", "close undefined authorized=false"]
        : ["close ERR_TLS_SESSION_ATTACK authorized=false"]),
    ]);
  },
);

// Plays an HTTP server and a WebSocket server by hand. For a plain request it renegotiates 4 times in a row before
// it answers, so the client refuses the last one while it waits for the response. For a WebSocket it renegotiates
// once for each frame of the client and answers with the text frame "done N". It answers a CONNECT request first,
// so it can also play an HTTPS proxy.
const refusedRenegotiationHttpServer = /* js */ `
  const tls = require("tls");
  const crypto = require("crypto");
  // The server counts handshakes too. Only the limit of the client is under test.
  tls.CLIENT_RENEG_LIMIT = 100;
  const server = tls.createServer(
    { cert: process.env.SERVER_CERT, key: process.env.SERVER_KEY, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
    socket => {
      socket.on("error", () => {});
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
        const key = /sec-websocket-key:\\s*(\\S+)/i.exec(head);
        if (key) {
          const accept = crypto.createHash("sha1").update(key[1] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
          socket.write(
            "HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n" +
              "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
          );
          let asked = 0;
          socket.on("data", () => {
            const n = ++asked;
            socket.renegotiate({ rejectUnauthorized: false }, err => {
              if (err) return;
              const text = Buffer.from("done " + n);
              socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
            });
          });
          return;
        }
        socket.resume();
        let asked = 0;
        (function ask() {
          if (asked === 4) {
            socket.end("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok");
            return;
          }
          asked++;
          socket.renegotiate({ rejectUnauthorized: false }, err => {
            if (!err) ask();
          });
        })();
      });
    },
  );
  server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`;

function spawnRefusedRenegotiationHttpServer() {
  return Bun.spawn({
    cmd: ["node", "-e", refusedRenegotiationHttpServer],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key },
  });
}

// An ambient NO_PROXY applies to an explicit `proxy` option too and would send the request direct.
async function withoutNoProxy<T>(run: () => Promise<T>): Promise<T> {
  const keys = ["NO_PROXY", "no_proxy"];
  const saved = keys.map(key => [key, Bun.env[key]] as const);
  for (const key of keys) Bun.env[key] = "";
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
  }
}

it("fetch fails with the TLS error when the client refuses a renegotiation", async () => {
  await using server = spawnRefusedRenegotiationHttpServer();
  const port = await portOf(server);
  const outcome = await fetch(`https://localhost:${port}/`, { keepalive: false, tls: { ca: tls.cert } }).then(
    res => `status ${res.status}`,
    (err: NodeJS.ErrnoException) => `${err.name} ${err.code}: ${err.message}`,
  );
  expect(outcome).toBe("TypeError ERR_TLS_SESSION_ATTACK: TLS session renegotiation attack detected");
});

it("fetch through a CONNECT proxy fails with the TLS error when the client refuses a renegotiation", async () => {
  await using server = spawnRefusedRenegotiationHttpServer();
  const port = await portOf(server);
  using proxy = await startRecordingProxy();
  const outcome = await withoutNoProxy(() =>
    fetch(`https://localhost:${port}/`, {
      keepalive: false,
      tls: { ca: tls.cert },
      proxy: `http://127.0.0.1:${proxy.port}`,
    }).then(
      res => `status ${res.status}`,
      (err: NodeJS.ErrnoException) => `${err.name} ${err.code}: ${err.message}`,
    ),
  );
  expect({ outcome, proxied: proxy.requests.map(r => r.requestLine) }).toEqual({
    outcome: "TypeError ERR_TLS_SESSION_ATTACK: TLS session renegotiation attack detected",
    proxied: [`CONNECT localhost:${port} HTTP/1.1`],
  });
});

it("https.request fails with the TLS error when the client refuses a renegotiation", async () => {
  await using server = spawnRefusedRenegotiationHttpServer();
  const port = await portOf(server);
  const outcome = Promise.withResolvers<string>();
  const req = httpsRequest(
    { host: "localhost", port, path: "/", agent: false, ca: tls.cert },
    (res: IncomingMessage) => {
      res.resume();
      res.on("end", () => outcome.resolve(`status ${res.statusCode}`));
    },
  );
  req.on("error", (err: NodeJS.ErrnoException) => outcome.resolve(`${err.code}: ${err.message}`));
  req.end();
  expect(await outcome.promise).toBe("ERR_TLS_SESSION_ATTACK: TLS session renegotiation attack detected");
});

// 1015 is the close code of a TLS failure. 1006 says only that the connection ended.
it.concurrent.each(["direct", "through an HTTPS proxy"])(
  "WebSocket (%s) closes with 1015 when the client refuses a renegotiation",
  async route => {
    await using server = spawnRefusedRenegotiationHttpServer();
    const port = await portOf(server);

    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const ws = new WebSocket(route === "direct" ? `wss://localhost:${port}/` : "ws://target.invalid/", {
      tls: { ca: tls.cert },
      ...(route !== "direct" && { proxy: `https://localhost:${port}` }),
    });
    ws.onopen = () => {
      events.push("open");
      ws.send("go");
    };
    ws.onmessage = event => {
      events.push(`message ${event.data}`);
      ws.send("go");
    };
    ws.onclose = event => {
      events.push(`close ${event.code}`);
      closed.resolve();
    };
    await closed.promise;
    expect(events).toEqual(["open", "message done 1", "message done 2", "message done 3", "close 1015"]);
  },
);

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
