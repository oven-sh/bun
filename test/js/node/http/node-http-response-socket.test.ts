/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * A response has a socket from assignSocket() to detachSocket(), and the
 * server detaches the response of a request when it emits 'finish':
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L296-L312
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L1209
 * Without a socket `res.socket` and `res.connection` are null:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L242-L264
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createSecureServer as createHttp2SecureServer } from "node:http2";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import { describe, test } from "node:test";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const isBun = typeof Bun !== "undefined";

const show = (value: unknown, socket?: unknown) =>
  value === null ? null : value === undefined ? "undefined" : value === socket ? "the socket" : "another object";
const both = (res: http.ServerResponse, socket?: unknown) => [show(res.socket, socket), show(res.connection, socket)];

function http11Req() {
  const req = new http.IncomingMessage(null as any);
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  return req;
}

function sink() {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return Object.assign(socket, { text: () => Buffer.concat(chunks).toString("latin1") });
}

describe("res.socket and res.connection of a response that no connection carries", () => {
  test("are null, and the read makes nothing", () => {
    const res = new http.ServerResponse(http11Req());
    const keys = Reflect.ownKeys(res).length;
    assert.deepStrictEqual(both(res), [null, null]);
    assert.strictEqual(Reflect.ownKeys(res).length, keys);
    assert.strictEqual(show(Object.freeze(new http.ServerResponse(http11Req())).socket), null);
  });

  test("are the accessors of OutgoingMessage.prototype", () => {
    assert.deepStrictEqual(
      ["socket", "connection"].filter(name => Object.hasOwn(http.ServerResponse.prototype, name)),
      [],
    );
    const plain = {};
    const getter = (name: string) => Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, name)!.get!;
    // A receiver that no constructor ran on has no socket, and the read stores none on it.
    assert.deepStrictEqual(
      [
        show(getter("socket").call(plain)),
        show(getter("connection").call(plain)),
        show(Object.create(http.ServerResponse.prototype).socket),
        show(http.ServerResponse.prototype.socket),
        Reflect.ownKeys(plain).length,
      ],
      ["undefined", "undefined", "undefined", "undefined", 0],
    );
  });

  test("stay null through write(), cork(), setTimeout() and end(), until assignSocket()", async () => {
    const res = new http.ServerResponse(http11Req());
    const steps: Record<string, unknown> = {};
    res.write("a");
    steps.write = show(res.socket);
    res.cork();
    res.cork();
    steps.cork = [res.writableCorked, show(res.socket)];
    res.uncork();
    res.uncork();
    steps.setTimeout = res.setTimeout(1234) === res;
    res.end("b");
    steps.end = [show(res.socket), res.writableEnded, res.writableFinished];

    const socket = sink();
    const timeouts: number[] = [];
    (socket as any).setTimeout = (ms: number) => timeouts.push(ms);
    const finished = once(res, "finish");
    res.assignSocket(socket as any);
    steps.assigned = [...both(res, socket), timeouts];
    await finished;
    steps.sent = socket.text().slice(socket.text().indexOf("\r\n\r\n"));
    res.detachSocket(socket as any);
    steps.detached = [...both(res, socket), (socket as any)._httpMessage];
    socket.destroy();

    assert.deepStrictEqual(steps, {
      write: null,
      cork: [2, null],
      setTimeout: true,
      end: [null, true, false],
      // setTimeout() waited for the socket.
      assigned: ["the socket", "the socket", [1234]],
      sent: "\r\n\r\n1\r\na\r\n1\r\nb\r\n0\r\n\r\n",
      detached: [null, null, null],
    });
  });

  test("stay null on a response that is destroyed", async () => {
    const res = new http.ServerResponse(http11Req());
    const closed = once(res, "close");
    res.destroy();
    assert.deepStrictEqual([res.destroyed, ...both(res)], [true, null, null]);
    await closed;
    assert.deepStrictEqual(both(res), [null, null]);
  });

  test("follow assignSocket() and detachSocket()", () => {
    const res = new http.ServerResponse(http11Req());
    const a = sink();
    const b = sink();
    const emitted: string[] = [];
    res.on("socket", socket => emitted.push(socket === a ? "a" : socket === b ? "b" : "another object"));
    const seen: unknown[] = [];
    res.assignSocket(a as any);
    seen.push(show(res.socket, a), (a as any)._httpMessage === res);
    res.detachSocket(a as any);
    seen.push(show(res.socket, a), (a as any)._httpMessage);
    res.assignSocket(b as any);
    seen.push(...both(res, b), (b as any)._httpMessage === res);
    res.detachSocket(b as any);
    seen.push(show(res.connection, b));
    a.destroy();
    b.destroy();
    assert.deepStrictEqual(
      { seen, emitted },
      { seen: ["the socket", true, null, null, "the socket", "the socket", true, null], emitted: ["a", "b"] },
    );
  });

  test("answer what was stored", () => {
    const res = new http.ServerResponse(http11Req());
    const socket = sink();
    const seen: unknown[] = [];
    res.socket = socket as any;
    seen.push(both(res, socket));
    (res as any).socket = undefined;
    seen.push(both(res, socket));
    res.connection = socket as any;
    seen.push(both(res, socket));
    res.connection = null;
    seen.push(both(res, socket));
    socket.destroy();
    assert.deepStrictEqual(seen, [
      ["the socket", "the socket"],
      ["undefined", "undefined"],
      ["the socket", "the socket"],
      [null, null],
    ]);
  });
});

const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const tlsOptions = {
  key: readFileSync(path.join(keys, "agent1-key.pem")),
  cert: readFileSync(path.join(keys, "agent1-cert.pem")),
};
type Listener = (req: http.IncomingMessage, res: http.ServerResponse) => void;
type Kind = "listen()" | "emit('connection')" | "https" | "http2 with allowHTTP1";

// A server of that kind and one connection to it. The requests are raw bytes, so that each is exactly what its test says.
async function start(kind: Kind, listener: Listener) {
  const secure = kind === "https" || kind === "http2 with allowHTTP1";
  const server =
    kind === "https"
      ? createHttpsServer(tlsOptions, listener)
      : kind === "http2 with allowHTTP1"
        ? createHttp2SecureServer({ ...tlsOptions, allowHTTP1: true }, listener as any)
        : http.createServer(listener);
  const listening =
    kind === "emit('connection')" ? createNetServer(socket => server.emit("connection", socket)) : server;
  await once(listening.listen(0, "127.0.0.1"), "listening");
  const { port } = listening.address() as AddressInfo;
  const client: Socket = secure
    ? tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] })
    : connect(port, "127.0.0.1");
  const failed = Promise.withResolvers<never>();
  failed.promise.catch(() => {});
  let received = "";
  let onData = () => {};
  client.on("error", failed.reject);
  client.on("close", () => failed.reject(new Error("the connection closed: " + JSON.stringify(received))));
  client.on("data", chunk => {
    received += chunk.toString("latin1");
    onData();
  });
  await Promise.race([once(client, secure ? "secureConnect" : "connect"), failed.promise]);
  return {
    server,
    client,
    get: (url = "/") => client.write(`GET ${url} HTTP/1.1\r\nHost: a\r\n\r\n`),
    received: () => received,
    // Waits for `text` among what the client has received. A connection that fails or closes first rejects.
    async receive(text: string) {
      while (!received.includes(text)) {
        await Promise.race([new Promise<void>(resolve => (onData = resolve)), failed.promise]);
      }
    },
    [Symbol.dispose]() {
      client.removeAllListeners("close");
      client.destroy();
      (server as http.Server).closeAllConnections?.();
      listening.close();
    },
  };
}

for (const kind of ["listen()", "emit('connection')", "https", "http2 with allowHTTP1"] as const) {
  const secure = kind === "https" || kind === "http2 with allowHTTP1";
  describe(`res.socket and res.connection of the response of a request, ${kind}`, () => {
    test("are the connection until 'finish' and null from then on, for a response that ends in its listener", async () => {
      const seen: Record<string, unknown> = {};
      const closed = Promise.withResolvers<void>();
      using connection = await start(kind, (req, res) => {
        const socket = req.socket;
        const at = (name: string) => () => void (seen[name] = both(res, socket));
        at("in the listener")();
        process.nextTick(at("in a tick queued before end()"));
        res.on("finish", at("at 'finish'"));
        res.on("close", () => {
          at("at 'close'")();
          closed.resolve();
        });
        res.write("a", at("in the callback of write()"));
        res.end("b", at("in the callback of end()"));
        at("after end()")();
        process.nextTick(at("in a tick queued behind end()"));
      });
      connection.get();
      await connection.receive("0\r\n\r\n");
      await closed.promise;
      assert.deepStrictEqual(seen, {
        "in the listener": ["the socket", "the socket"],
        "after end()": ["the socket", "the socket"],
        "in a tick queued before end()": ["the socket", "the socket"],
        "in the callback of write()": ["the socket", "the socket"],
        // Since v26.7.0 node runs the callback of end() ahead of 'finish'. Bun runs it behind, where the response has let go.
        "in the callback of end()": isBun ? [null, null] : ["the socket", "the socket"],
        // Over TLS node finishes the last write a task later, so 'finish' comes behind this tick. Bun emits 'finish' a tick
        // behind end() whatever carries the response.
        "in a tick queued behind end()": secure && !isBun ? ["the socket", "the socket"] : [null, null],
        "at 'finish'": [null, null],
        "at 'close'": [null, null],
      });
    });

    test("are the connection until 'finish' and null from then on, for a response that ends later", async () => {
      const seen: Record<string, unknown> = {};
      const closed = Promise.withResolvers<void>();
      using connection = await start(kind, (req, res) => {
        const socket = req.socket;
        const at = (name: string) => () => void (seen[name] = both(res, socket));
        res.on("finish", at("at 'finish'"));
        res.on("close", () => {
          at("at 'close'")();
          closed.resolve();
        });
        setImmediate(() => {
          at("before end()")();
          res.end("late");
          at("after end()")();
        });
      });
      connection.get();
      await connection.receive("late");
      await closed.promise;
      assert.deepStrictEqual(seen, {
        "before end()": ["the socket", "the socket"],
        "after end()": ["the socket", "the socket"],
        "at 'finish'": [null, null],
        "at 'close'": [null, null],
      });
    });

    test("stay the destroyed connection of a response that is destroyed in its listener", async () => {
      const seen: Record<string, unknown> = {};
      const closed = Promise.withResolvers<void>();
      using connection = await start(kind, (req, res) => {
        const socket = req.socket;
        res.on("close", () => {
          seen["at 'close'"] = [...both(res, socket), socket.destroyed];
          closed.resolve();
        });
        res.destroy();
        seen["after destroy()"] = [...both(res, socket), socket.destroyed];
      });
      connection.client.removeAllListeners("close");
      connection.get();
      await closed.promise;
      assert.deepStrictEqual(seen, {
        "after destroy()": ["the socket", "the socket", true],
        "at 'close'": ["the socket", "the socket", true],
      });
    });

    test("are null while a pipelined response waits for the connection", async () => {
      const seen: [string, unknown][] = [];
      const finished = Promise.withResolvers<void>();
      let first: http.ServerResponse;
      using connection = await start(kind, (req, res) => {
        if (req.url === "/1") {
          first = res;
          seen.push(["the first, in its listener", show(res.socket, req.socket)]);
          return;
        }
        seen.push(["the second, while the first is open", show(res.socket, req.socket)]);
        res.on("socket", () => seen.push(["the second, at 'socket'", show(res.socket, req.socket)]));
        res.on("finish", () => {
          seen.push(["the second, at 'finish'", show(res.socket, req.socket)]);
          finished.resolve();
        });
        res.end("two");
        first.end("one");
      });
      connection.client.write("GET /1 HTTP/1.1\r\nHost: a\r\n\r\nGET /2 HTTP/1.1\r\nHost: a\r\n\r\n");
      await finished.promise;
      await connection.receive("two");
      assert.deepStrictEqual(seen, [
        ["the first, in its listener", "the socket"],
        ["the second, while the first is open", null],
        ["the second, at 'socket'", "the socket"],
        ["the second, at 'finish'", null],
      ]);
      assert.ok(connection.received().indexOf("one") < connection.received().indexOf("two"));
    });
  });
}

describe("a response that has let go of its connection", () => {
  test("counts cork() and uncork()", async () => {
    const counted = Promise.withResolvers<unknown>();
    using connection = await start("listen()", (req, res) => {
      res.on("close", () => {
        const counts = [res.writableCorked];
        res.cork();
        res.cork();
        counts.push(res.writableCorked);
        res.uncork();
        counts.push(res.writableCorked);
        res.uncork();
        counts.push(res.writableCorked);
        counted.resolve({ counts, socket: show(res.socket, req.socket) });
      });
      res.end("ok");
    });
    connection.get();
    assert.deepStrictEqual(await counted.promise, { counts: [0, 2, 1, 0], socket: null });
  });

  test("hands a cork() behind end() back to the connection", async () => {
    const seen: Record<string, unknown> = {};
    const closed = Promise.withResolvers<void>();
    const upgraded = Promise.withResolvers<void>();
    using connection = await start("listen()", (req, res) => {
      res.end("ok");
      res.cork();
      seen["after cork()"] = [res.writableCorked, req.socket.writableCorked];
      res.on("close", () => {
        seen["at 'close'"] = [res.writableCorked, req.socket.writableCorked];
        closed.resolve();
      });
    });
    connection.server.on("upgrade", (_req, socket) => {
      seen["at 'upgrade'"] = socket.writableCorked;
      // A connection that was left corked holds this back.
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
      upgraded.resolve();
    });
    connection.get();
    await connection.receive("ok");
    await closed.promise;
    connection.client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
    await upgraded.promise;
    assert.deepStrictEqual(seen, { "after cork()": [1, 1], "at 'close'": [1, 0], "at 'upgrade'": 0 });
    await connection.receive("101 Switching Protocols");
  });

  test("finishes and closes though its request has lost its socket", async () => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    using connection = await start("listen()", (req, res) => {
      const socket = req.socket;
      res.on("finish", () => events.push("finish " + show(res.socket, socket)));
      res.on("close", () => {
        events.push("close " + show(res.socket, socket));
        closed.resolve();
      });
      (req as any).socket = null;
      res.detachSocket(socket);
      events.push("detached " + show(res.socket, socket));
      res.assignSocket(socket);
      res.end("ok");
    });
    connection.get();
    await connection.receive("ok");
    await closed.promise;
    assert.deepStrictEqual(events, ["detached null", "finish null", "close null"]);
  });
});

describe("a response whose connection a WebSocket takes in a 'request' listener", () => {
  // No 'finish' comes for such a response, so nothing takes its socket away.
  async function handOff(act: (res: http.ServerResponse, ws: import("ws").WebSocket) => void) {
    const seen: Record<string, unknown> = {};
    const webSocketClosed = Promise.withResolvers<number>();
    const responseClosed = Promise.withResolvers<unknown>();
    const wss = new WebSocketServer({ noServer: true });
    const server = http.createServer((req, res) => {
      const socket = req.socket;
      seen["before"] = both(res, socket);
      res.on("close", () => responseClosed.resolve({ closed: res.closed, socketDestroyed: socket.destroyed }));
      wss.handleUpgrade(req, socket, Buffer.alloc(0), ws => {
        seen["in the callback"] = both(res, socket);
        ws.on("message", data => {
          seen["at 'message'"] = both(res, socket);
          // The client has the echo when it asks for the act.
          if (String(data) === "echo") ws.send("echo");
          else act(res, ws);
        });
        ws.on("close", code => {
          seen["at the close of the WebSocket"] = both(res, socket);
          webSocketClosed.resolve(code);
        });
      });
      seen["after"] = both(res, socket);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
    const echo = Promise.withResolvers<string>();
    client.onmessage = event => {
      echo.resolve(String(event.data));
      client.send("act");
    };
    client.onerror = () => echo.reject(new Error("the WebSocket failed"));
    client.onopen = () => client.send("echo");
    return {
      seen,
      echo: echo.promise,
      webSocketClosed: webSocketClosed.promise,
      responseClosed: responseClosed.promise,
      [Symbol.dispose]() {
        client.close();
        server.closeAllConnections();
        server.close();
      },
    };
  }
  const theSocket = ["the socket", "the socket"];

  test("keeps its socket", async () => {
    using handedOff = await handOff((_res, ws) => ws.close(1000));
    assert.deepStrictEqual(
      { echo: await handedOff.echo, code: await handedOff.webSocketClosed, seen: handedOff.seen },
      {
        echo: "echo",
        code: 1000,
        seen: {
          "before": theSocket,
          "in the callback": theSocket,
          "after": theSocket,
          "at 'message'": theSocket,
          "at the close of the WebSocket": theSocket,
        },
      },
    );
  });

  test("closes the connection with destroy(), and emits 'close'", async () => {
    using handedOff = await handOff(res => res.destroy());
    assert.deepStrictEqual(await handedOff.responseClosed, { closed: true, socketDestroyed: true });
    assert.strictEqual(await handedOff.webSocketClosed, 1006);
    assert.deepStrictEqual(handedOff.seen["at the close of the WebSocket"], theSocket);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (isBun) {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // Before v26.7.0 node ran the callback of end() as a listener of 'finish', behind the one that detaches.
  const node = nodeExeAtLeast("26.7.0");

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
