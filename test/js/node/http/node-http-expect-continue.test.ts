/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * A client that sends Expect: 100-continue holds the request body back until
 * it sees the 100 Continue. A final response in its place leaves that body
 * unsent, so Node's writeHead() clears shouldKeepAlive and the connection closes:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L490-L494
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createSecureServer as createHttp2SecureServer } from "node:http2";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo, Server as NetServer, Socket } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import path from "node:path";
import { describe, test } from "node:test";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";

type Listener = (req: http.IncomingMessage, res: http.ServerResponse) => void;
// Private members of Node's ServerResponse: the flag that the rule reads, and a first write that middleware calls.
type ServerResponseInternals = http.ServerResponse & {
  _expect_continue: boolean;
  _send(data: string): boolean;
};
const internals = (res: http.ServerResponse) => res as ServerResponseInternals;

const expectHead = "POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 36\r\n\r\n";
const get = (path: string) => `GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`;

const statusOf = (head: string) => head.slice(0, head.indexOf("\r\n"));
const connectionOf = (head: string) => /\r\nConnection: ([^\r]*)\r\n/.exec(head)?.[1];
const headOf = (head: string) => ({ status: statusOf(head), connection: connectionOf(head) });
// How the response delimits its body: the Content-Length or the Transfer-Encoding line.
const framingOf = (head: string) => /\r\n((?:Content-Length|Transfer-Encoding): [^\r]*)\r\n/.exec(head)?.[1];

// Raw bytes over one connection. until(needle) resolves with the bytes up to and
// including needle, fin when the server ends the connection. Every failure event
// rejects the pending read.
function reader(socket: Socket) {
  let buffer = "";
  let received = "";
  let waiter: { needle: string; resolve: (bytes: string) => void; reject: (err: Error) => void } | null = null;
  const fin = Promise.withResolvers<void>();
  // Only a test that awaits fin observes its rejection.
  fin.promise.catch(() => {});
  const check = () => {
    if (!waiter) return;
    const at = buffer.indexOf(waiter.needle);
    if (at === -1) return;
    const cut = at + waiter.needle.length;
    const { resolve } = waiter;
    waiter = null;
    const out = buffer.slice(0, cut);
    buffer = buffer.slice(cut);
    resolve(out);
  };
  const fail = (err: Error) => {
    fin.reject(err);
    const pending = waiter;
    waiter = null;
    pending?.reject(err);
  };
  socket.on("data", chunk => {
    buffer += chunk;
    received += chunk;
    check();
  });
  socket.on("end", () => {
    fin.resolve();
    fail(new Error(`the server ended the connection; buffered: ${JSON.stringify(buffer)}`));
  });
  socket.on("error", fail);
  socket.on("close", () => fail(new Error(`the socket closed; buffered: ${JSON.stringify(buffer)}`)));

  const until = (needle: string) => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    waiter = { needle, resolve, reject };
    check();
    return promise;
  };
  return { fin: fin.promise, received: () => received, until };
}

async function dial(server: http.Server, viaConnectionEvent: boolean) {
  const listener: NetServer = viaConnectionEvent
    ? createNetServer(socket => server.emit("connection", socket))
    : server;
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const socket = connect((listener.address() as AddressInfo).port, "127.0.0.1");
  return {
    socket,
    ...reader(socket),
    close() {
      socket.destroy();
      server.closeAllConnections();
      listener.close();
    },
  };
}

// A final response from a 'checkContinue' listener that sends no 100 Continue.
// keepAlive is res.shouldKeepAlive when the listener returns.
const rejections: [
  name: string,
  reject: Listener,
  expected: ReturnType<typeof headOf> & { framing: string; keepAlive: boolean },
][] = [
  [
    "statusCode, write() and end()",
    (req, res) => {
      res.statusCode = 417;
      res.write("no");
      res.end();
    },
    {
      status: "HTTP/1.1 417 Expectation Failed",
      connection: "close",
      framing: "Transfer-Encoding: chunked",
      keepAlive: false,
    },
  ],
  [
    "statusCode, flushHeaders() and end()",
    (req, res) => {
      res.statusCode = 417;
      res.flushHeaders();
      res.end();
    },
    {
      status: "HTTP/1.1 417 Expectation Failed",
      connection: "close",
      framing: "Transfer-Encoding: chunked",
      keepAlive: false,
    },
  ],
  [
    // Node does not look at the status code: the body stays unsent after any final response.
    "writeHead(200) and end()",
    (req, res) => {
      res.writeHead(200);
      res.end("nope");
    },
    { status: "HTTP/1.1 200 OK", connection: "close", framing: "Transfer-Encoding: chunked", keepAlive: false },
  ],
  [
    "removeHeader('Connection'), writeHead(417) and end()",
    (req, res) => {
      res.removeHeader("Connection");
      res.writeHead(417);
      res.end();
    },
    {
      status: "HTTP/1.1 417 Expectation Failed",
      connection: undefined,
      framing: "Transfer-Encoding: chunked",
      keepAlive: false,
    },
  ],
  [
    "writeHead(417, { Connection: 'close' }) and end()",
    (req, res) => {
      res.writeHead(417, { Connection: "close" });
      res.end();
    },
    {
      status: "HTTP/1.1 417 Expectation Failed",
      connection: "close",
      framing: "Transfer-Encoding: chunked",
      keepAlive: false,
    },
  ],
  [
    "setHeader('Connection', 'close'), statusCode and end()",
    (req, res) => {
      res.setHeader("Connection", "close");
      res.statusCode = 417;
      res.end();
    },
    { status: "HTTP/1.1 417 Expectation Failed", connection: "close", framing: "Content-Length: 0", keepAlive: false },
  ],
];

// The native listener, and the path a socket takes through server.emit("connection").
for (const [transport, viaConnectionEvent] of [
  ["server.listen()", false],
  ["server.emit('connection')", true],
] as const) {
  describe(`a final response to an unanswered Expect: 100-continue over ${transport}`, () => {
    test("writeHead(417) and end(): the connection closes and the next request is not read as the body", async () => {
      const seen: string[] = [];
      const clientErrors: string[] = [];
      const keepAlive: boolean[] = [];
      const serverSideClosed = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        seen.push("request " + req.url);
        res.end("SECOND");
      });
      server.on("clientError", (err: NodeJS.ErrnoException) => clientErrors.push(String(err.code)));
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        seen.push("checkContinue " + req.url);
        res.socket!.on("close", serverSideClosed.resolve);
        keepAlive.push(res.shouldKeepAlive);
        res.writeHead(417);
        keepAlive.push(res.shouldKeepAlive);
        res.end();
      });
      const { socket, until, fin, received, close } = await dial(server, viaConnectionEvent);
      try {
        // The request a client sends next on a reusable connection, already on the wire.
        socket.write(expectHead + get("/second"));

        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { ...headOf(head), keepAlive },
          { status: "HTTP/1.1 417 Expectation Failed", connection: "close", keepAlive: [true, false] },
        );

        // The server ends the connection itself: the client never half-closes.
        await fin;
        await serverSideClosed.promise;
        assert.deepStrictEqual(
          { responses: received().match(/HTTP\/1\.1 \d{3}/g), seen, clientErrors },
          { responses: ["HTTP/1.1 417"], seen: ["checkContinue /upload"], clientErrors: [] },
        );
      } finally {
        close();
      }
    });

    test("statusCode and end(): the connection closes", async () => {
      const keepAlive: boolean[] = [];
      const server = http.createServer();
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        keepAlive.push(res.shouldKeepAlive);
        res.statusCode = 417;
        res.end();
        keepAlive.push(res.shouldKeepAlive);
      });
      const { socket, until, fin, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write(expectHead);
        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { ...headOf(head), keepAlive },
          { status: "HTTP/1.1 417 Expectation Failed", connection: "close", keepAlive: [true, false] },
        );
        await fin;
      } finally {
        close();
      }
    });

    for (const [name, reject, expected] of rejections) {
      test(`${name}: the connection closes`, async () => {
        let keepAlive: boolean | undefined;
        const server = http.createServer();
        server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
          reject(req, res);
          keepAlive = res.shouldKeepAlive;
        });
        const { socket, until, fin, close } = await dial(server, viaConnectionEvent);
        try {
          socket.write(expectHead);
          const head = await until("\r\n\r\n");
          assert.deepStrictEqual({ ...headOf(head), framing: framingOf(head), keepAlive }, expected);
          await fin;
        } finally {
          close();
        }
      });
    }

    // The private first write. With no data Node sends nothing for it, so end() builds the head and chooses the framing.
    test("statusCode, _send('') and end(): the connection closes", async () => {
      let keepAlive: boolean | undefined;
      const server = http.createServer();
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.statusCode = 417;
        internals(res)._send("");
        res.end();
        keepAlive = res.shouldKeepAlive;
      });
      const { socket, until, fin, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write(expectHead);
        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { ...headOf(head), keepAlive },
          { status: "HTTP/1.1 417 Expectation Failed", connection: "close", keepAlive: false },
        );
        // Bun's path for server.emit("connection") chooses the framing at the first write, also before this change.
        if (!viaConnectionEvent) assert.strictEqual(framingOf(head), "Content-Length: 0");
        await fin;
      } finally {
        close();
      }
    });

    test("a rejection queued behind a pipelined response closes the connection at its turn", async () => {
      const firstMayEnd = Promise.withResolvers<void>();
      let keepAliveWhileQueued: boolean | undefined;
      const server = http.createServer((req, res) => void firstMayEnd.promise.then(() => res.end("first")));
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(417);
        res.end();
        keepAliveWhileQueued = res.shouldKeepAlive;
        firstMayEnd.resolve();
      });
      const { socket, until, fin, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write(get("/first") + expectHead);
        const first = headOf(await until("\r\n\r\n"));
        await until("first");
        const second = headOf(await until("\r\n\r\n"));
        assert.deepStrictEqual(
          { first, second, keepAliveWhileQueued },
          {
            first: { status: "HTTP/1.1 200 OK", connection: "keep-alive" },
            second: { status: "HTTP/1.1 417 Expectation Failed", connection: "close" },
            keepAliveWhileQueued: false,
          },
        );
        await fin;
      } finally {
        close();
      }
    });

    test("writeContinue() keeps the connection reusable", async () => {
      const server = http.createServer((req, res) => res.end("SECOND"));
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeContinue();
        req.resume();
        req.on("end", () => res.end("first"));
      });
      const { socket, until, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write("POST /one HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 5\r\n\r\n");
        assert.strictEqual(await until("\r\n\r\n"), "HTTP/1.1 100 Continue\r\n\r\n");

        socket.write("hello");
        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { ...headOf(head), body: await until("first") },
          { status: "HTTP/1.1 200 OK", connection: "keep-alive", body: "first" },
        );

        socket.write(get("/two"));
        assert.strictEqual(statusOf(await until("SECOND")), "HTTP/1.1 200 OK");
      } finally {
        close();
      }
    });

    test("writeContinue() on a response queued behind a pipelined one keeps the connection reusable", async () => {
      const firstMayEnd = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        if (req.url === "/first") void firstMayEnd.promise.then(() => res.end("first"));
        else res.end("THIRD");
      });
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeContinue();
        req.resume();
        req.on("end", () => res.end("second"));
        firstMayEnd.resolve();
      });
      const { socket, until, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write(
          get("/first") + "POST /two HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 5\r\n\r\n",
        );
        await until("first");
        assert.strictEqual(await until("\r\n\r\n"), "HTTP/1.1 100 Continue\r\n\r\n");

        socket.write("hello");
        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { ...headOf(head), body: await until("second") },
          { status: "HTTP/1.1 200 OK", connection: "keep-alive", body: "second" },
        );

        socket.write(get("/three"));
        assert.strictEqual(statusOf(await until("THIRD")), "HTTP/1.1 200 OK");
      } finally {
        close();
      }
    });

    for (const [name, withListener] of [
      ["the automatic 100 Continue", false],
      ["writeContinue()", true],
    ] as const) {
      test(`${name}, then writeHead(200): the connection stays reusable`, async () => {
        const seen: Record<string, unknown> = {};
        const answer: Listener = (req, res) => {
          req.resume();
          req.on("end", () => {
            res.writeHead(200, { "Content-Length": "5" });
            seen.upload = { expectContinue: internals(res)._expect_continue, keepAlive: res.shouldKeepAlive };
            res.end("first");
          });
        };
        const server = http.createServer((req, res) => {
          if (req.url !== "/two") return answer(req, res);
          seen.plain = { expectContinue: internals(res)._expect_continue, keepAlive: res.shouldKeepAlive };
          res.end("SECOND");
        });
        if (withListener) {
          server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
            res.writeContinue();
            answer(req, res);
          });
        }
        const { socket, until, close } = await dial(server, viaConnectionEvent);
        try {
          socket.write("POST /one HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 5\r\n\r\n");
          assert.strictEqual(await until("\r\n\r\n"), "HTTP/1.1 100 Continue\r\n\r\n");

          socket.write("hello");
          const head = await until("\r\n\r\n");
          assert.deepStrictEqual(
            { ...headOf(head), body: await until("first") },
            { status: "HTTP/1.1 200 OK", connection: "keep-alive", body: "first" },
          );

          socket.write(get("/two"));
          assert.strictEqual(statusOf(await until("SECOND")), "HTTP/1.1 200 OK");
          assert.deepStrictEqual(seen, {
            upload: { expectContinue: true, keepAlive: true },
            plain: { expectContinue: false, keepAlive: true },
          });
        } finally {
          close();
        }
      });
    }

    test("the 417 for an expectation other than 100-continue keeps the connection reusable", async () => {
      // No body is held back for any other expectation, so the connection stays framed.
      const server = http.createServer((req, res) => res.end("SECOND"));
      const { socket, until, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write("GET /one HTTP/1.1\r\nHost: x\r\nExpect: meoww\r\n\r\n");
        assert.deepStrictEqual(headOf(await until("\r\n\r\n")), {
          status: "HTTP/1.1 417 Expectation Failed",
          connection: "keep-alive",
        });

        socket.write(get("/two"));
        assert.match(await until("SECOND"), /HTTP\/1\.1 200 OK\r\n/);
      } finally {
        close();
      }
    });

    test("an explicit Connection: keep-alive on the rejection keeps the connection", async () => {
      let keepAliveAfterWriteHead: boolean | undefined;
      const server = http.createServer((req, res) => res.end("SECOND"));
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(417, { Connection: "keep-alive" });
        keepAliveAfterWriteHead = res.shouldKeepAlive;
        res.end();
      });
      const { socket, until, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write(expectHead);
        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { ...headOf(head), keepAliveAfterWriteHead },
          { status: "HTTP/1.1 417 Expectation Failed", connection: "keep-alive", keepAliveAfterWriteHead: true },
        );

        // The connection stays framed only when the client still sends the announced body.
        socket.write(Buffer.alloc(36, "x").toString() + get("/two"));
        assert.match(await until("SECOND"), /HTTP\/1\.1 200 OK\r\n/);
      } finally {
        close();
      }
    });
  });
}

// The same rule behind TLS. The HTTP/1.1 side of an http2 server takes the path of server.emit("connection").
const keysDir = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const tlsOptions = {
  key: readFileSync(path.join(keysDir, "agent1-key.pem")),
  cert: readFileSync(path.join(keysDir, "agent1-cert.pem")),
};
for (const [name, createServer] of [
  ["node:https", () => createHttpsServer(tlsOptions)],
  ["node:http2 with allowHTTP1", () => createHttp2SecureServer({ ...tlsOptions, allowHTTP1: true })],
] as [name: string, createServer: () => NetServer][]) {
  test(`a final response to an unanswered Expect: 100-continue closes a ${name} connection`, async () => {
    const server = createServer();
    server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(417);
      res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const socket = tlsConnect({
      port: (server.address() as AddressInfo).port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    const { until, fin } = reader(socket);
    try {
      socket.write(expectHead);
      assert.deepStrictEqual(headOf(await until("\r\n\r\n")), {
        status: "HTTP/1.1 417 Expectation Failed",
        connection: "close",
      });
      await fin;
    } finally {
      socket.destroy();
      server.close();
    }
  });
}

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
