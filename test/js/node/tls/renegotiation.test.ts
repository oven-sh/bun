import type { Subprocess } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isIPv6, tls } from "harness";
import type { IncomingMessage } from "http";
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
// refuses (the limit is 3 in 600 s). For the message "data first" the server writes "before N" ahead of request N.
// Two TCP proxies in front of the server shape what each side reads. The process prints three ports:
// 1. The server.
// 2. A proxy that gives the client "before 4" and request 4 in one write, so one read holds both.
// 3. A proxy that gives the server the client's first message only after the client's close_notify, and nothing
//    after that message. So the request reaches a client that already ended its write side.
const pingPongRenegotiationServer = /* js */ `
  const net = require("net");
  const tls = require("tls");
  // The server counts handshakes too. Only the limit of the client is under test.
  tls.CLIENT_RENEG_LIMIT = 100;
  const server = tls.createServer(
    { cert: process.env.SERVER_CERT, key: process.env.SERVER_KEY, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
    socket => {
      socket.on("error", () => {});
      let asked = 0;
      socket.on("data", chunk => {
        const n = ++asked;
        if (String(chunk) === "data first") socket.write("before " + n);
        socket.renegotiate({ rejectUnauthorized: false }, err => {
          if (!err) socket.write("done " + n);
        });
      });
    },
  );

  const APPLICATION_DATA = 23;
  const HANDSHAKE = 22;
  const ALERT = 21;
  // Takes the complete TLS records off the front of a buffer.
  function takeRecords(buffer) {
    const records = [];
    while (buffer.length >= 5 && buffer.length >= 5 + buffer.readUInt16BE(3)) {
      const length = 5 + buffer.readUInt16BE(3);
      records.push(buffer.subarray(0, length));
      buffer = buffer.subarray(length);
    }
    return { records, rest: buffer };
  }
  function proxy(allowHalfOpen, shape) {
    return net.createServer({ allowHalfOpen }, client => {
      const upstream = net.connect(server.address().port, "127.0.0.1");
      client.on("error", () => {});
      upstream.on("error", () => {});
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
      shape(client, upstream);
    });
  }

  const sameRead = proxy(false, (client, upstream) => {
    let fromClient = Buffer.alloc(0);
    let messages = 0;
    let held = Buffer.alloc(0);
    let released = false;
    client.on("data", chunk => {
      const { records, rest } = takeRecords(Buffer.concat([fromClient, chunk]));
      fromClient = rest;
      messages += records.filter(record => record[0] === APPLICATION_DATA).length;
      upstream.write(chunk);
    });
    upstream.on("data", chunk => {
      if (messages < 4 || released) return void client.write(chunk);
      held = Buffer.concat([held, chunk]);
      const { records, rest } = takeRecords(held);
      const types = records.map(record => record[0]);
      if (rest.length === 0 && types.length === 2 && types[0] === APPLICATION_DATA && types[1] === HANDSHAKE) {
        released = true;
        client.write(held);
      }
    });
  });

  // Half-open: the FIN of the client must not come back to it ahead of the request.
  const afterEnd = proxy(true, (client, upstream) => {
    let fromClient = Buffer.alloc(0);
    let firstMessage;
    client.on("data", chunk => {
      const { records, rest } = takeRecords(Buffer.concat([fromClient, chunk]));
      fromClient = rest;
      for (const record of records) {
        if (!firstMessage) {
          if (record[0] === APPLICATION_DATA) firstMessage = record;
          else upstream.write(record);
        } else if (record[0] === ALERT) {
          upstream.write(firstMessage);
        }
      }
    });
    upstream.on("data", chunk => client.write(chunk));
  });

  server.listen(0, "127.0.0.1", () =>
    sameRead.listen(0, "127.0.0.1", () =>
      afterEnd.listen(0, "127.0.0.1", () =>
        console.log(server.address().port, sameRead.address().port, afterEnd.address().port),
      ),
    ),
  );
`;

// Renegotiates 4 times in a row when the first request arrives, so the client refuses the last one while it waits
// for an answer. An HTTP request gets its response after the 4 renegotiations. A RESP command (Valkey) gets none.
// For "/response-first" a complete keep-alive response leaves ahead of request 4. The process prints two ports:
// 1. The server.
// 2. An HTTP CONNECT proxy to the server. It forwards whole records, and it gives the client that response and
//    request 4 in one write, so one read holds both.
const backToBackRenegotiationServer = /* js */ `
  const net = require("net");
  const tls = require("tls");
  tls.CLIENT_RENEG_LIMIT = 100;
  const server = tls.createServer(
    { cert: process.env.SERVER_CERT, key: process.env.SERVER_KEY, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
    socket => {
      socket.on("error", () => {});
      let head = "";
      socket.on("data", function onHead(chunk) {
        head += chunk.toString("latin1");
        const isHttp = !head.startsWith("*");
        if (isHttp && !head.includes("\\r\\n\\r\\n")) return;
        socket.off("data", onHead);
        socket.resume();
        const responseFirst = head.startsWith("GET /response-first ");
        let asked = 0;
        (function ask() {
          if (asked === 3 && responseFirst) socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nok");
          if (asked === 4) {
            if (isHttp) socket.end("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok");
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

  const APPLICATION_DATA = 23;
  const CHANGE_CIPHER_SPEC = 20;
  const proxy = net.createServer(client => {
    client.on("error", () => {});
    let request = Buffer.alloc(0);
    client.on("data", function onConnect(chunk) {
      request = Buffer.concat([request, chunk]);
      const end = request.indexOf("\\r\\n\\r\\n");
      if (end === -1) return;
      client.off("data", onConnect);
      const upstream = net.connect(server.address().port, "127.0.0.1");
      upstream.on("error", () => {});
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
      client.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
      upstream.write(request.subarray(end + 4));
      client.on("data", chunk => upstream.write(chunk));
      // The server finished 4 handshakes when its 4th ChangeCipherSpec passed. The application data record after
      // that is the response. It waits here for the record behind it.
      let fromServer = Buffer.alloc(0);
      let handshakes = 0;
      let held;
      upstream.on("data", chunk => {
        fromServer = Buffer.concat([fromServer, chunk]);
        while (fromServer.length >= 5 && fromServer.length >= 5 + fromServer.readUInt16BE(3)) {
          const record = fromServer.subarray(0, 5 + fromServer.readUInt16BE(3));
          fromServer = fromServer.subarray(record.length);
          if (record[0] === CHANGE_CIPHER_SPEC) handshakes++;
          if (held) {
            client.write(Buffer.concat([held, record]));
            held = undefined;
            handshakes = 0;
          } else if (handshakes === 4 && record[0] === APPLICATION_DATA) {
            held = record;
          } else {
            client.write(record);
          }
        }
      });
    });
  });

  server.listen(0, "127.0.0.1", () =>
    proxy.listen(0, "127.0.0.1", () => console.log(server.address().port, proxy.address().port)),
  );
`;

// A TCP relay in front of a TLS 1.2 server. The relay forwards whole records and stops reading a client for good
// after that client's 3rd application data record, so the rest of an upload stays with the client. When those 3
// records of an upload that starts with "B" arrived, the server asks that client for its first renegotiation.
const stalledUploadRenegotiationServer = /* js */ `
  const net = require("net");
  const tls = require("tls");
  const server = tls.createServer(
    { cert: process.env.SERVER_CERT, key: process.env.SERVER_KEY, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
    socket => {
      socket.on("error", () => {});
      let tag;
      let received = 0;
      socket.on("data", chunk => {
        tag ??= String.fromCharCode(chunk[0]);
        received += chunk.length;
        if (tag === "B" && received === 3 * 16384) socket.renegotiate({ rejectUnauthorized: false }, () => {});
      });
    },
  );
  const relay = net.createServer(client => {
    const upstream = net.connect(server.address().port, "127.0.0.1");
    client.on("error", () => {});
    upstream.on("error", () => {});
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    upstream.on("data", chunk => client.write(chunk));
    let fromClient = Buffer.alloc(0);
    let applicationRecords = 0;
    client.on("data", chunk => {
      fromClient = Buffer.concat([fromClient, chunk]);
      while (applicationRecords < 3 && fromClient.length >= 5 && fromClient.length >= 5 + fromClient.readUInt16BE(3)) {
        const record = fromClient.subarray(0, 5 + fromClient.readUInt16BE(3));
        fromClient = fromClient.subarray(record.length);
        upstream.write(record);
        if (record[0] === 23 && ++applicationRecords === 3) client.pause();
      }
    });
  });
  server.listen(0, "127.0.0.1", () => relay.listen(0, "127.0.0.1", () => console.log(relay.address().port)));
`;

// Each server keeps its state for each connection, so every test below uses the same three processes.
let pingPongPort: number;
let sameReadPort: number;
let afterEndPort: number;
let backToBackPort: number;
let responseFirstProxyPort: number;
let stalledUploadPort: number;
const refusalServers: Subprocess[] = [];
beforeAll(async () => {
  [[pingPongPort, sameReadPort, afterEndPort], [backToBackPort, responseFirstProxyPort], [stalledUploadPort]] =
    await Promise.all(
      [pingPongRenegotiationServer, backToBackRenegotiationServer, stalledUploadRenegotiationServer].map(
        async source => {
          const server = Bun.spawn({
            cmd: ["node", "-e", source],
            stdout: "pipe",
            stderr: "inherit",
            stdin: "ignore",
            env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key },
          });
          refusalServers.push(server);
          const { value, done } = await server.stdout.getReader().read();
          if (done) throw new Error("the server exited before it printed its ports");
          return new TextDecoder().decode(value).trim().split(" ").map(Number);
        },
      ),
    );
});
afterAll(() => {
  for (const server of refusalServers) server.kill();
});

// A node:tls client over TCP, or over a Duplex in front of a TCP socket.
function connectOver(transport: string, port: number, options: { rejectUnauthorized?: boolean; ca?: string }) {
  if (transport === "TCP") {
    return { socket: tlsConnect({ ...options, servername: "localhost", port, host: "127.0.0.1" }), raw: undefined };
  }
  const raw = netConnect(port, "127.0.0.1");
  raw.on("error", () => {});
  const duplex = new Duplex({
    read() {},
    write(chunk: Buffer, encoding: string, callback: () => void) {
      raw.write(chunk, callback);
    },
    final(callback: () => void) {
      raw.end();
      callback();
    },
  });
  raw.on("data", (chunk: Buffer) => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  raw.on("close", () => duplex.destroy());
  return { socket: tlsConnect({ ...options, servername: "localhost", socket: duplex }), raw };
}

// A refusal is not the result of a handshake: no 'secureConnect' reports it. With `sameRead`, one read of the client
// holds "before 4" and, behind it, the request that the client refuses. That data came first, so it arrives first,
// and its handler runs before the refusal: `call` is what the handler does to the socket. The request came before an
// end() from that handler, so it is still refused. After a destroy() there is no socket to report to.
it.concurrent.each([
  { transport: "TCP", trusted: false, sameRead: false, call: "nothing" },
  { transport: "TCP", trusted: true, sameRead: false, call: "nothing" },
  { transport: "a Duplex", trusted: false, sameRead: false, call: "nothing" },
  { transport: "a Duplex", trusted: true, sameRead: false, call: "nothing" },
  { transport: "TCP", trusted: false, sameRead: true, call: "nothing" },
  { transport: "a Duplex", trusted: false, sameRead: true, call: "nothing" },
  { transport: "TCP", trusted: false, sameRead: true, call: "end" },
  { transport: "a Duplex", trusted: false, sameRead: true, call: "end" },
  { transport: "TCP", trusted: false, sameRead: true, call: "destroy" },
  { transport: "a Duplex", trusted: false, sameRead: true, call: "destroy" },
] as const)(
  "a renegotiation that the client refuses is an 'error' and no 'secureConnect' over $transport (trusted chain: $trusted, data in the same read: $sameRead, its handler calls: $call)",
  async ({ transport, trusted, sameRead, call }) => {
    const { socket, raw } = connectOver(transport, sameRead ? sameReadPort : pingPongPort, {
      rejectUnauthorized: false,
      ...(trusted && { ca: tls.cert }),
    });
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    let sent = 0;
    const send = () => socket.write(sameRead && ++sent === 4 ? "data first" : "go");
    socket.on("secureConnect", () => {
      if (events.push(`secureConnect authorized=${socket.authorized}`) === 1) send();
    });
    socket.on("data", (chunk: Buffer) => {
      events.push(`data ${chunk}`);
      if (String(chunk).startsWith("done")) send();
      else if (call !== "nothing") socket[call]();
    });
    socket.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}: ${err.message}`));
    socket.on("close", (hadError: boolean) => {
      events.push(`close hadError=${hadError}`);
      closed.resolve();
    });
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
        ...(sameRead ? ["data before 4"] : []),
        ...(call === "destroy"
          ? ["close hadError=false"]
          : ["error EPROTO: TLS renegotiation limit exceeded", "close hadError=true"]),
      ]);
    } finally {
      socket.destroy();
      raw?.destroy();
    }
  },
);

// After its own close_notify the client cannot answer the request. That is the end of the client's own close, not an
// error, and no second 'secureConnect'.
it.concurrent.each(["TCP", "a Duplex"])(
  "a request for a renegotiation after the client's own end() is not an 'error' over %s",
  async transport => {
    const { socket, raw } = connectOver(transport, afterEndPort, { ca: tls.cert });
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    socket.on("secureConnect", () => {
      events.push(`secureConnect authorized=${socket.authorized}`);
      socket.end("go");
    });
    socket.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.code}: ${err.message}`));
    socket.on("close", (hadError: boolean) => {
      events.push(`close hadError=${hadError}`);
      closed.resolve();
    });
    socket.resume();
    try {
      await closed.promise;
      expect(events).toEqual(["secureConnect authorized=true", "close hadError=false"]);
    } finally {
      socket.destroy();
      raw?.destroy();
    }
  },
);

// BoringSSL refuses a renegotiation while a record of the client is only partly written. A record stays partly
// written when another socket of the loop holds the buffer for ciphertext that the kernel did not take. So upload
// "A" stalls first, and this test does not run beside other sockets.
it("a renegotiation that BoringSSL refuses while a write is pending is an 'error' and no 'secureConnect'", async () => {
  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  const open = (tag: string) => {
    const connected = Promise.withResolvers<ReturnType<typeof tlsConnect>>();
    const socket = tlsConnect({ port: stalledUploadPort, host: "127.0.0.1", servername: "localhost", ca: tls.cert });
    socket.on("secureConnect", () => {
      events.push(`${tag} secureConnect authorized=${socket.authorized}`);
      connected.resolve(socket);
    });
    socket.on("error", (err: NodeJS.ErrnoException) => events.push(`${tag} error ${err.code}: ${err.message}`));
    socket.on("close", (hadError: boolean) => {
      events.push(`${tag} close hadError=${hadError}`);
      connected.reject(new Error(`${tag} closed before its handshake`));
      if (tag === "B") closed.resolve();
    });
    return connected.promise;
  };
  const a = await open("A");
  const b = await open("B");
  try {
    // Far above what the socket buffers of both ends hold.
    a.write(Buffer.alloc(24 * 1024 * 1024, "A"));
    b.write(Buffer.alloc(24 * 1024 * 1024, "B"));
    await closed.promise;
    expect(events).toEqual([
      "A secureConnect authorized=true",
      "B secureConnect authorized=true",
      "B error ERR_SSL_NO_RENEGOTIATION: error:100000b6:SSL routines:OPENSSL_internal:NO_RENEGOTIATION",
      "B close hadError=true",
    ]);
  } finally {
    a.destroy();
    b.destroy();
  }
});

// The handshake handler gets the refusal as a protocol failure, not as the certificate verdict of the session.
it.concurrent.each([
  { withErrorHandler: true, sameRead: false, call: "nothing" },
  { withErrorHandler: false, sameRead: false, call: "nothing" },
  { withErrorHandler: true, sameRead: true, call: "nothing" },
  { withErrorHandler: true, sameRead: true, call: "end" },
  { withErrorHandler: true, sameRead: true, call: "terminate" },
] as const)(
  "Bun.connect reports a renegotiation that the client refuses to its handshake handler (error handler: $withErrorHandler, data in the same read: $sameRead, its handler calls: $call)",
  async ({ withErrorHandler, sameRead, call }) => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const describe = (error: Error | null | undefined) =>
      error ? `${(error as NodeJS.ErrnoException).code}: ${error.message}` : `${error}`;
    let sent = 0;
    const send = (socket: Bun.Socket) => socket.write(sameRead && ++sent === 4 ? "data first" : "go");
    await Bun.connect({
      hostname: "127.0.0.1",
      port: sameRead ? sameReadPort : pingPongPort,
      tls: { ca: tls.cert, serverName: "localhost" },
      socket: {
        data(socket, chunk) {
          events.push(`data ${chunk}`);
          if (String(chunk).startsWith("done")) send(socket);
          else if (call !== "nothing") socket[call]();
        },
        handshake(socket, success, error) {
          if (events.push(`handshake ${success} ${describe(error)}`) === 1) send(socket);
        },
        ...(withErrorHandler && {
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

    expect(events).toEqual([
      "handshake true null",
      "handshake true null",
      "data done 1",
      "handshake true null",
      "data done 2",
      "handshake true null",
      "data done 3",
      ...(sameRead ? ["data before 4"] : []),
      ...(call === "terminate"
        ? ["close undefined authorized=true"]
        : ["handshake false EPROTO: TLS renegotiation limit exceeded", "close undefined authorized=false"]),
    ]);
  },
);

it("https.request fails with the protocol error when the client refuses a renegotiation", async () => {
  const outcome = Promise.withResolvers<string>();
  const req = require("https").request(
    { host: "localhost", port: backToBackPort, path: "/", agent: false, ca: tls.cert },
    (res: IncomingMessage) => {
      res.resume();
      res.on("end", () => outcome.resolve(`status ${res.statusCode}`));
    },
  );
  req.on("error", (err: NodeJS.ErrnoException) => outcome.resolve(`${err.code}: ${err.message}`));
  req.end();
  expect(await outcome.promise).toBe("EPROTO: TLS renegotiation limit exceeded");
});

// The chain is not trusted and the client accepts that. The refusal must not come back as that certificate verdict.
it("fetch does not report a certificate error when the client refuses a renegotiation", async () => {
  const outcome = await fetch(`https://localhost:${backToBackPort}/`, {
    keepalive: false,
    tls: { rejectUnauthorized: false },
  }).then(
    res => `status ${res.status}`,
    (err: NodeJS.ErrnoException) => `${err.name} ${err.code}`,
  );
  expect(outcome).toBe("TypeError EPROTO");
});

// The response of "/response-first" and request 4 arrive in one read of the proxy tunnel. The response is complete,
// so each fetch succeeds. The refusal then closes the tunnel: it must not go back to the pool for the next fetch.
// In a child process: a report to a tunnel in the pool uses freed memory, which only a sanitizer build shows.
it("fetch through a proxy gets the response that arrives in the same read as a refused renegotiation", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        for (let i = 0; i < 2; i++) {
          const res = await fetch("https://localhost:" + process.env.SERVER_PORT + "/response-first", {
            proxy: "http://127.0.0.1:" + process.env.PROXY_PORT,
            tls: { ca: process.env.SERVER_CERT },
          });
          console.log(res.status, await res.text());
        }
      `,
    ],
    env: {
      ...bunEnv,
      SERVER_PORT: String(backToBackPort),
      PROXY_PORT: String(responseFirstProxyPort),
      SERVER_CERT: tls.cert,
      // An ambient NO_PROXY applies to an explicit `proxy` option too and would send the request direct.
      NO_PROXY: "",
      no_proxy: "",
      ASAN_OPTIONS: ((bunEnv.ASAN_OPTIONS ?? "") + ":symbolize=0").replace(/^:/, ""),
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode, signalCode: proc.signalCode, stderr }).toEqual({
    stdout: "200 ok\n200 ok\n",
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
});

// In a child process: with no error to report, an assert-enabled build aborts when it makes an Error with no message.
it("a Valkey client fails its command with the protocol error when the client refuses a renegotiation", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const client = new Bun.RedisClient("rediss://localhost:" + process.env.SERVER_PORT, {
          tls: { ca: process.env.SERVER_CERT },
          autoReconnect: false,
        });
        const outcome = await client.get("key").then(
          value => "value " + value,
          err => err.code + ": " + err.message,
        );
        console.log(outcome);
        client.close();
      `,
    ],
    env: {
      ...bunEnv,
      SERVER_PORT: String(backToBackPort),
      SERVER_CERT: tls.cert,
      // An abort of an ASAN build must not spend the test's time on symbols.
      ASAN_OPTIONS: ((bunEnv.ASAN_OPTIONS ?? "") + ":symbolize=0").replace(/^:/, ""),
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode, stderr }).toEqual({
    stdout: "EPROTO: TLS renegotiation limit exceeded",
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
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
