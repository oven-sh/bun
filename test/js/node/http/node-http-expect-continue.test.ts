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
import http from "node:http";
import type { AddressInfo, Server as NetServer } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const expectHead = "POST /upload HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Length: 36\r\n\r\n";

const statusOf = (head: string) => head.slice(0, head.indexOf("\r\n"));
const connectionOf = (head: string) => /\r\nConnection: ([^\r]*)\r\n/.exec(head)?.[1];

// Raw bytes over one connection. until(needle) resolves with the bytes up to and
// including needle, fin when the server ends the connection. Every failure event
// rejects the pending read.
async function dial(server: http.Server, viaConnectionEvent: boolean) {
  const listener: NetServer = viaConnectionEvent
    ? createNetServer(socket => server.emit("connection", socket))
    : server;
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const socket = connect((listener.address() as AddressInfo).port, "127.0.0.1");

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

  return {
    socket,
    fin: fin.promise,
    received: () => received,
    until(needle: string) {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      waiter = { needle, resolve, reject };
      check();
      return promise;
    },
    close() {
      socket.destroy();
      server.closeAllConnections();
      listener.close();
    },
  };
}

// The native listener, and the path a socket takes through server.emit("connection").
for (const [transport, viaConnectionEvent] of [
  ["server.listen()", false],
  ["server.emit('connection')", true],
] as const) {
  describe(`a final response to an unanswered Expect: 100-continue over ${transport}`, () => {
    test("a 417 from checkContinue closes the connection and the next request is not read as the body", async () => {
      const seen: string[] = [];
      let keepAliveAfterWriteHead: boolean | undefined;
      const server = http.createServer((req, res) => {
        seen.push("request " + req.url);
        res.end("SECOND");
      });
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        seen.push("checkContinue " + req.url);
        res.writeHead(417);
        keepAliveAfterWriteHead = res.shouldKeepAlive;
        res.end();
      });
      const { socket, until, fin, received, close } = await dial(server, viaConnectionEvent);
      try {
        // The request a client sends next on a reusable connection, already on the wire.
        socket.write(expectHead + "GET /second HTTP/1.1\r\nHost: x\r\n\r\n");

        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { status: statusOf(head), connection: connectionOf(head), keepAliveAfterWriteHead },
          { status: "HTTP/1.1 417 Expectation Failed", connection: "close", keepAliveAfterWriteHead: false },
        );

        // The server ends the connection itself: the client never half-closes.
        await fin;
        assert.deepStrictEqual(
          { responses: received().match(/HTTP\/1\.1 \d{3}/g), seen },
          { responses: ["HTTP/1.1 417"], seen: ["checkContinue /upload"] },
        );
      } finally {
        close();
      }
    });

    test("a status set without writeHead() closes the connection", async () => {
      const server = http.createServer();
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.statusCode = 417;
        res.end();
      });
      const { socket, until, fin, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write(expectHead);
        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { status: statusOf(head), connection: connectionOf(head) },
          { status: "HTTP/1.1 417 Expectation Failed", connection: "close" },
        );
        await fin;
      } finally {
        close();
      }
    });

    test("a 2xx without writeContinue() closes the connection", async () => {
      // Node does not look at the status code: the body stays unsent after any final response.
      const server = http.createServer();
      server.on("checkContinue", (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200);
        res.end("nope");
      });
      const { socket, until, fin, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write(expectHead);
        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { status: statusOf(head), connection: connectionOf(head) },
          { status: "HTTP/1.1 200 OK", connection: "close" },
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
          { status: statusOf(head), connection: connectionOf(head), body: await until("first") },
          { status: "HTTP/1.1 200 OK", connection: "keep-alive", body: "first" },
        );

        socket.write("GET /two HTTP/1.1\r\nHost: x\r\n\r\n");
        assert.strictEqual(statusOf(await until("SECOND")), "HTTP/1.1 200 OK");
      } finally {
        close();
      }
    });

    test("the 417 for an expectation other than 100-continue keeps the connection reusable", async () => {
      // No body is held back for any other expectation, so the connection stays framed.
      const server = http.createServer((req, res) => res.end("SECOND"));
      const { socket, until, close } = await dial(server, viaConnectionEvent);
      try {
        socket.write("GET /one HTTP/1.1\r\nHost: x\r\nExpect: meoww\r\n\r\n");
        const head = await until("\r\n\r\n");
        assert.deepStrictEqual(
          { status: statusOf(head), connection: connectionOf(head) },
          { status: "HTTP/1.1 417 Expectation Failed", connection: "keep-alive" },
        );

        socket.write("GET /two HTTP/1.1\r\nHost: x\r\n\r\n");
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
          { status: statusOf(head), connection: connectionOf(head), keepAliveAfterWriteHead },
          { status: "HTTP/1.1 417 Expectation Failed", connection: "keep-alive", keepAliveAfterWriteHead: true },
        );

        // The connection stays framed only when the client still sends the announced body.
        socket.write(Buffer.alloc(36, "x").toString() + "GET /two HTTP/1.1\r\nHost: x\r\n\r\n");
        assert.match(await until("SECOND"), /HTTP\/1\.1 200 OK\r\n/);
      } finally {
        close();
      }
    });
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
