/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * llhttp completes a message without a body right after the callback that
 * runs the listener, so Node sets req.complete there while nothing reads req:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_common.js#L143-L163
 */
import assert from "node:assert";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

type Seen = Record<string, boolean>;

async function withServer(server: http.Server, run: (port: number) => Promise<void>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// Raw bytes, so that the request is exactly what the test says it is.
function send(port: number, payload: string, onError: (err: Error) => void) {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", onError);
  socket.write(payload);
  return socket;
}

describe("req.complete of a request without a body", () => {
  const head = "GET / HTTP/1.1\r\nHost: x\r\n";
  const cases: [name: string, event: string, payload: string, options: object][] = [
    ["'request' for a GET", "request", head + "\r\n", {}],
    ["'request' for a HEAD", "request", "HEAD / HTTP/1.1\r\nHost: x\r\n\r\n", {}],
    ["'request' for an empty POST", "request", "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n", {}],
    ["'request' with optimizeEmptyRequests", "request", head + "\r\n", { optimizeEmptyRequests: true }],
    ["'checkContinue'", "checkContinue", head + "Expect: 100-continue\r\n\r\n", {}],
    ["'checkExpectation'", "checkExpectation", head + "Expect: meow\r\n\r\n", {}],
  ];
  for (const [name, event, payload, options] of cases) {
    test(`is false inside ${name} and true once the listener returns`, async () => {
      const seen: Seen = {};
      const { promise: finished, resolve: onFinish, reject } = Promise.withResolvers<void>();
      const server = http.createServer(options);
      server.on(event, (req: http.IncomingMessage, res: http.ServerResponse) => {
        seen.listener = req.complete;
        process.nextTick(() => (seen.nextTick = req.complete));
        res.on("finish", () => {
          seen.finish = req.complete;
          onFinish();
        });
        // res.end() dumps req, so sample once more before it runs.
        setImmediate(() => {
          seen.immediate = req.complete;
          res.end();
        });
      });
      await withServer(server, async port => {
        send(port, payload, reject);
        await finished;
      });
      assert.deepStrictEqual(seen, { listener: false, nextTick: true, immediate: true, finish: true });
    });
  }

  test("is true for a request that is pipelined behind a pending response", async () => {
    const seen: Record<string, Seen> = {};
    const { promise: finished, resolve: onFinish, reject } = Promise.withResolvers<void>();
    let pending = 2;
    const server = http.createServer((req, res) => {
      const entry: Seen = (seen[req.url!] = { listener: req.complete });
      process.nextTick(() => (entry.nextTick = req.complete));
      res.on("finish", () => --pending === 0 && onFinish());
      setImmediate(() => res.end());
    });
    await withServer(server, async port => {
      send(port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\nGET /2 HTTP/1.1\r\nHost: x\r\n\r\n", reject);
      await finished;
    });
    assert.deepStrictEqual(seen, {
      "/1": { listener: false, nextTick: true },
      "/2": { listener: false, nextTick: true },
    });
  });

  test("is true in 'dropRequest' listeners once they return", async () => {
    const seen: Seen = {};
    const { promise: dropped, resolve: onDropped, reject } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => res.end());
    server.maxRequestsPerSocket = 1;
    server.on("dropRequest", (req: http.IncomingMessage) => {
      seen.listener = req.complete;
      process.nextTick(() => {
        seen.nextTick = req.complete;
        onDropped();
      });
    });
    await withServer(server, async port => {
      // The server destroys the connection after the 503. By then `dropped` has settled.
      send(port, "GET /1 HTTP/1.1\r\nHost: x\r\n\r\nGET /2 HTTP/1.1\r\nHost: x\r\n\r\n", reject);
      await dropped;
    });
    assert.deepStrictEqual(seen, { listener: false, nextTick: true });
  });

  test("stays true when the client goes away before the response ends", async () => {
    // What req.complete is for: telling a request that arrived in full from
    // one that was cut short. A long-lived response (SSE, long polling) to a
    // GET sees the first kind.
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<Seen>();
    const server = http.createServer((req, res) => {
      req.on("close", () => onClose({ complete: req.complete, aborted: req.aborted }));
      res.write("data: hi\n\n");
    });
    let seen: Seen | undefined;
    await withServer(server, async port => {
      const socket = send(port, head + "\r\n", reject);
      socket.once("data", () => socket.destroy());
      seen = await closed;
    });
    assert.deepStrictEqual(seen, { complete: true, aborted: true });
  });
});

test("req.complete stays false while a declared body is still arriving", async () => {
  const seen: Seen = {};
  const { promise: dispatched, resolve: onDispatched } = Promise.withResolvers<void>();
  const { promise: ended, resolve: onEnd, reject } = Promise.withResolvers<void>();
  const server = http.createServer((req, res) => {
    seen.listener = req.complete;
    process.nextTick(() => {
      seen.nextTick = req.complete;
      onDispatched();
    });
    req.on("end", () => {
      seen.end = req.complete;
      res.end();
      onEnd();
    });
    req.resume();
  });
  await withServer(server, async port => {
    const socket = send(port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhe", reject);
    await dispatched;
    socket.write("llo");
    await ended;
  });
  assert.deepStrictEqual(seen, { listener: false, nextTick: false, end: true });
});

// A write larger than the uWS cork buffer releases the cork, so the response that closes the connection is out before the body is parsed.
for (const respond of ["write() and end()", "end(chunk)"]) {
  test(`a Connection: close response by ${respond} does not drop the body that came with the head`, async () => {
    const events: string[] = [];
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => events.push(`end ${body}`));
      req.on("close", () => {
        events.push(`close ${req.complete}`);
        onClose();
      });
      const chunk = Buffer.alloc(20 * 1024, "x");
      if (respond === "end(chunk)") {
        res.end(chunk);
      } else {
        res.write(chunk);
        res.end();
      }
    });
    await withServer(server, async port => {
      send(port, "POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 5\r\n\r\nhello", reject).resume();
      await closed;
    });
    assert.deepStrictEqual(events, ["end hello", "close true"]);
  });
}

describe("a connection given to the server with emit('connection')", () => {
  async function withForwarder(server: http.Server, run: (port: number) => Promise<void>) {
    const forwarder = createNetServer(socket => server.emit("connection", socket));
    forwarder.listen(0, "127.0.0.1");
    await once(forwarder, "listening");
    try {
      await run((forwarder.address() as AddressInfo).port);
    } finally {
      forwarder.close();
    }
  }

  test("a request that nobody reads ends and closes after its response", async () => {
    const events: string[] = [];
    const { promise: closed, resolve: onClose, reject } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      req.on("end", () => events.push("end"));
      req.on("close", () => {
        events.push("close");
        onClose();
      });
      res.end("ok");
    });
    await withForwarder(server, async port => {
      send(port, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", reject).resume();
      await closed;
    });
    assert.deepStrictEqual(events, ["end", "close"]);
  });

  test("a body that nobody reads is dropped, not buffered", async () => {
    const length = 4 * 1024 * 1024;
    const { promise: ended, resolve: onEnd, reject } = Promise.withResolvers<number>();
    const server = http.createServer((req, res) => {
      req.on("end", () => onEnd(req.readableLength));
      res.end("ok");
    });
    await withForwarder(server, async port => {
      const socket = send(port, `POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${length}\r\n\r\n`, reject);
      socket.resume();
      socket.end(Buffer.alloc(length, "x"));
      assert.strictEqual(await ended, 0);
    });
  });
});

for (const expectation of ["100-continue", "something-else"]) {
  test(`an HTTP/1.0 request with Expect: ${expectation} is a plain request`, async () => {
    const events: string[] = [];
    const server = http.createServer((req, res) => {
      events.push("request");
      req.resume();
      res.end("ok");
    });
    server.on("checkContinue", () => events.push("checkContinue"));
    server.on("checkExpectation", () => events.push("checkExpectation"));
    await withServer(server, async port => {
      const { promise: failed, reject } = Promise.withResolvers<never>();
      const socket = send(port, `POST / HTTP/1.0\r\nExpect: ${expectation}\r\nContent-Length: 2\r\n\r\nhi`, reject);
      let received = "";
      socket.on("data", chunk => (received += chunk));
      await Promise.race([once(socket, "close"), failed]);
      assert.deepStrictEqual(
        { events, status: received.split("\r\n")[0] },
        { events: ["request"], status: "HTTP/1.1 200 OK" },
      );
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
