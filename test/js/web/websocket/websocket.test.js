import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
import { bunEnv, bunExe, expectMaxObjectTypeCount, gc, isASAN, tempDir, tls } from "harness";
import { createServer } from "net";
import { join } from "path";
import { closedPort, RawSocket } from "./raw-peer";
const COMMON_CERT = { ...tls };

// Records what `ws` fires until it closes. `onopen` runs when it opens.
function eventsUntilClose(ws, onopen) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  ws.onopen = () => {
    events.push("open");
    onopen?.();
  };
  ws.onmessage = ({ data }) => events.push({ message: data });
  ws.onerror = ({ message, error }) => {
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(message);
    events.push({ error: message, code: error.code });
  };
  ws.onclose = ({ code, reason, wasClean }) => {
    events.push({ close: code, reason, wasClean });
    resolve(events);
  };
  return promise;
}

const closed1006 = { close: 1006, reason: "", wasClean: false };

function secureServer(websocket, cert = COMMON_CERT) {
  return Bun.serve({
    port: 0,
    tls: cert,
    fetch(req, server) {
      // upgrade the request to a WebSocket
      if (server.upgrade(req)) {
        return; // do not return a Response
      }
      return new Response("Upgrade failed :(", { status: 500 });
    },
    websocket,
  });
}

const helloAndClose = {
  message(ws, message) {
    ws.send(message);
    ws.close();
  },
  open(ws) {
    ws.send("Hello from Bun!");
  },
};

describe.concurrent("WebSocket", () => {
  it("should connect", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          server.stop();
          return;
        }

        return new Response();
      },
      websocket: {
        open(ws) {},
        message(ws) {
          ws.close();
        },
      },
    });
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}`, {});
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = event => reject(event.error);
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    var closed = new Promise(resolve => {
      ws.onclose = resolve;
    });
    ws.close();
    expect(ws.readyState).toBe(WebSocket.CLOSING);
    const { code, reason, wasClean } = await closed;
    expect({ code, reason, wasClean }).toEqual({ code: 1005, reason: "", wasClean: true });
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    Bun.gc(true);
  });

  it("should connect over https", async () => {
    using server = secureServer({ message() {} });
    // The certificate names "localhost", and `ca` makes the client verify it.
    const ws = new WebSocket(`https://localhost:${server.port}/raw`, { tls: { ca: COMMON_CERT.cert } });
    expect(ws.url).toBe(`wss://localhost:${server.port}/raw`);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = event => reject(event.error);
    });
    var closed = new Promise((resolve, reject) => {
      ws.onclose = resolve;
    });

    ws.close();
    const { code, reason, wasClean } = await closed;
    expect({ code, reason, wasClean }).toEqual({ code: 1005, reason: "", wasClean: true });
    Bun.gc(true);
  });

  it("should connect many times over https", async () => {
    const total = 300;
    let opened = 0;
    let closedCleanly = 0;
    {
      using server = Bun.serve({
        port: 0,
        tls: COMMON_CERT,
        fetch(req, server) {
          if (server.upgrade(req)) {
            return;
          }
          return new Response("Upgrade failed :(", { status: 500 });
        },
        websocket: {
          message(ws, message) {
            // echo
            ws.send(message);
          },
          open(ws) {},
        },
      });
      {
        const batchSize = 20;
        const batch = new Array(batchSize);
        async function run() {
          const ws = new WebSocket(server.url.href, { tls: { rejectUnauthorized: false } });
          await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = event => reject(event.error);
          });
          opened++;
          var closed = new Promise((resolve, reject) => {
            ws.onclose = resolve;
          });

          ws.close();
          if ((await closed).wasClean) closedCleanly++;
        }
        for (let i = 0; i < total; i++) {
          batch[i % batchSize] = run();
          if (i % batchSize === batchSize - 1) {
            await Promise.all(batch);
          }
        }
        await Promise.all(batch);
        Bun.gc(true);
      }
      // The promise resolves once every connection is closed.
      await server.stop(true);
    }
    // test GC after all connections are closed
    Bun.gc(true);
    expect({ opened, closedCleanly }).toEqual({ opened: total, closedCleanly: total });
    // 300 TLS handshakes take 3 s alone on a debug build, longer alongside the rest of this concurrent group.
  }, 90_000);

  it("rejectUnauthorized should reject self-sign certs when true/default", async () => {
    using server = secureServer(helloAndClose);
    const url = server.url.href;
    const rejected = [
      {
        error: `WebSocket connection to '${url.replace("https:", "wss:")}' failed: TLS handshake failed: self signed certificate`,
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      },
      closed1006,
    ];

    // by default rejectUnauthorized is true
    const byDefault = new WebSocket(url);
    expect(await eventsUntilClose(byDefault, () => byDefault.send("Hello from client!"))).toEqual(rejected);

    // just in case we change the default to true and test
    const explicit = new WebSocket(url, { tls: { rejectUnauthorized: true } });
    expect(await eventsUntilClose(explicit, () => explicit.send("Hello from client!"))).toEqual(rejected);
  });

  it("rejectUnauthorized should NOT reject self-sign certs when false", async () => {
    using server = secureServer(helloAndClose);
    // should allow self-signed certs when rejectUnauthorized is false
    const client = new WebSocket(`wss://127.0.0.1:${server.address.port}`, { tls: { rejectUnauthorized: false } });
    expect(await eventsUntilClose(client, () => client.send("Hello from client!"))).toEqual([
      "open",
      { message: "Hello from Bun!" },
      { message: "Hello from client!" },
      { close: 1000, reason: "", wasClean: true },
    ]);
  });

  it("should not accept untrusted certificates", async () => {
    const UNTRUSTED_CERT = {
      key: readFileSync(join(import.meta.dir, "..", "..", "node", "http", "fixtures", "openssl.key")),
      cert: readFileSync(join(import.meta.dir, "..", "..", "node", "http", "fixtures", "openssl.crt")),
      passphrase: "123123123",
    };

    using server = secureServer(helloAndClose, UNTRUSTED_CERT);
    const url = `wss://localhost:${server.address.port}`;
    const client = new WebSocket(url);
    expect(await eventsUntilClose(client, () => client.send("Hello from client!"))).toEqual([
      {
        error: `WebSocket connection to '${url}/' failed: TLS handshake failed: unable to verify the first certificate`,
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      },
      closed1006,
    ]);
  });

  it("supports headers", async () => {
    const request = Promise.withResolvers();
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        request.resolve({ "X-Hello": req.headers.get("X-Hello"), "content-type": req.headers.get("content-type") });
        return new Response();
      },
      websocket: {
        open(ws) {
          ws.close();
        },
      },
    });
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}`, {
      headers: {
        "X-Hello": "World",
        "content-type": "lolwut",
      },
    });
    const events = eventsUntilClose(ws);
    expect(await request.promise).toEqual({ "X-Hello": "World", "content-type": "lolwut" });
    // The server answers 200 and not 101.
    expect(await events).toEqual([
      { error: `WebSocket connection to '${ws.url}' failed: Expected 101 status code: 200`, code: undefined },
      closed1006,
    ]);
  });

  it("should FAIL to connect over http when the status code is invalid", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.stop();
        return new Response();
      },
      websocket: {
        open(ws) {},
        message(ws) {
          ws.close();
        },
        close() {},
      },
    });
    var ws = new WebSocket(`http://${server.hostname}:${server.port}`, {});
    expect(await eventsUntilClose(ws, () => ws.send("Hello World!"))).toEqual([
      { error: `WebSocket connection to '${ws.url}' failed: Expected 101 status code: 200`, code: undefined },
      closed1006,
    ]);
  });

  it("should connect over http ", async () => {
    const received = [];
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req);
        server.stop();

        return new Response();
      },
      websocket: {
        open(ws) {},
        message(ws, message) {
          received.push(message);
          ws.close();
        },
        close() {},
      },
    });
    var ws = new WebSocket(`http://${server.hostname}:${server.port}`, {});
    expect(ws.url).toBe(`ws://${server.hostname}:${server.port}/`);
    expect(await eventsUntilClose(ws, () => ws.send("Hello World!"))).toEqual([
      "open",
      { close: 1000, reason: "", wasClean: true },
    ]);
    expect(received).toEqual(["Hello World!"]);
  });
  describe("nodebuffer", () => {
    it("should support 'nodebuffer' binaryType", async () => {
      using server = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) {
            return;
          }

          return new Response();
        },
        websocket: {
          open(ws) {
            ws.sendBinary(new Uint8Array([1, 2, 3]));
          },
        },
      });
      const ws = new WebSocket(`http://${server.hostname}:${server.port}`, {});
      ws.binaryType = "nodebuffer";
      expect(ws.binaryType).toBe("nodebuffer");
      Bun.gc(true);
      const message = Promise.withResolvers();
      const closed = Promise.withResolvers();
      ws.onclose = closed.resolve;
      ws.onmessage = ({ data }) => {
        ws.close();
        server.stop(true);
        Bun.gc(true);
        message.resolve(data);
      };
      const data = await message.promise;
      expect(Buffer.isBuffer(data)).toBe(true);
      expect(data).toEqual(Buffer.from([1, 2, 3]));
      await closed.promise;
    });

    it("should support 'nodebuffer' binaryType when the handler is not immediately provided", async () => {
      var client;
      const message = Promise.withResolvers();
      const closed = Promise.withResolvers();
      using server = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) {
            return;
          }

          return new Response();
        },
        websocket: {
          open(ws) {
            ws.sendBinary(new Uint8Array([1, 2, 3]));
            client.onmessage = ({ data }) => {
              client.close();
              server.stop(true);
              message.resolve(data);
            };
          },
        },
      });
      client = new WebSocket(`http://${server.hostname}:${server.port}`, {});
      client.binaryType = "nodebuffer";
      expect(client.binaryType).toBe("nodebuffer");
      client.onclose = closed.resolve;
      const data = await message.promise;
      expect(Buffer.isBuffer(data)).toBe(true);
      expect(data).toEqual(Buffer.from([1, 2, 3]));
      await closed.promise;
    });
  });

  it("should send and receive messages", async () => {
    using server = secureServer({
      message(ws, message) {
        // echo
        ws.send(message);
      },
    });
    const ws = new WebSocket(`wss://localhost:${server.port}/raw`, { tls: { ca: COMMON_CERT.cert } });
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = event => reject(event.error);
      ws.onclose = () => {
        reject("WebSocket closed");
      };
    });
    const count = 10;
    // The forced collections are the slow part of this test. Each place below collects on its first pass only:
    // after a send, inside a message handler, around a handler swap, and after close().

    // 10 messages in burst
    const burst = [];
    var promise = new Promise((resolve, reject) => {
      ws.onmessage = event => {
        if (burst.length === 0) gc(true);
        burst.push(event.data);

        if (burst.length >= count) {
          ws.onmessage = () => {};
          resolve();
        }
      };
      ws.onerror = event => reject(event.error);
    });

    for (let i = 0; i < count; i++) {
      ws.send("Hello World!");
      if (i === 0) gc(true);
    }

    await promise;
    expect(burst).toEqual(Array.from({ length: count }, () => "Hello World!"));
    var echo = 0;

    // 10 messages one at a time
    function waitForEcho() {
      return new Promise((resolve, reject) => {
        const collect = echo === 0;
        if (collect) gc(true);
        const msg = `Hello World! ${echo++}`;
        ws.onmessage = event => {
          resolve([msg, event.data]);
        };
        ws.onerror = event => reject(event.error);
        ws.onclose = reject;
        ws.send(msg);
        if (collect) gc(true);
      });
    }
    for (let i = 0; i < count; i++) {
      const [sent, received] = await waitForEcho();
      expect(received).toBe(sent);
    }
    const closed = Promise.withResolvers();
    ws.onclose = ({ code, reason, wasClean }) => closed.resolve({ code, reason, wasClean });
    ws.onerror = () => {};
    ws.close();
    gc(true);
    expect(await closed.promise).toEqual({ code: 1005, reason: "", wasClean: true });
    // Takes 0.6 s alone on a debug build, up to 4 s next to the 300 TLS handshakes of this concurrent group.
  }, 90_000);

  it("should report failing websocket connection in onerror and onclose for DNS resolution error", async () => {
    // getaddrinfo rejects a DNS label longer than 63 bytes without sending a query.
    const url = `ws://${Buffer.alloc(64, "a")}.com/`;
    expect(await eventsUntilClose(new WebSocket(url, {}))).toEqual([
      { error: `WebSocket connection to '${url}' failed: Failed to connect`, code: "ENOTFOUND" },
      closed1006,
    ]);
  });

  // We want to test that the `onConnectError` callback gets called.
  it("should report failing websocket connection in onerror and onclose for connection refused", async () => {
    const url = `ws://localhost:${await closedPort()}/`;
    expect(await eventsUntilClose(new WebSocket(url, {}))).toEqual([
      { error: `WebSocket connection to '${url}' failed: Failed to connect`, code: "ECONNREFUSED" },
      closed1006,
    ]);
  });

  it("should be able to send big messages", async () => {
    using serve = Bun.serve({
      port: 0,
      tls,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("failed to upgrade", { status: 403 });
      },
      websocket: {
        message(ws, message) {
          if (ws.send(message) == 0) {
            ws.data = ws.data || [];
            ws.data.push(message);
          }
        },
        drain(ws) {
          while (ws.data && ws.data.length) {
            if (ws.send(ws.data.shift()) == 0) break;
          }
        },
      },
    });
    const { promise, resolve, reject } = Promise.withResolvers();
    const ws = new WebSocket(serve.url, { tls: { rejectUnauthorized: false } });

    const payload = crypto.randomBytes(1024 * 16);
    const iterations = 10;

    const received = [];
    ws.addEventListener("close", ({ code, reason, wasClean }) => resolve({ code, reason, wasClean }));

    ws.addEventListener("message", e => {
      received.push(e.data);
      if (received.length === iterations) {
        ws.close();
      }
    });
    ws.addEventListener("error", event => reject(event.error));
    ws.addEventListener("open", () => {
      for (let i = 0; i < iterations; i++) {
        ws.send(payload);
      }
    });

    expect(await promise).toEqual({ code: 1005, reason: "", wasClean: true });
    expect(received.map(data => Buffer.isBuffer(data) && data.equals(payload))).toEqual(
      Array.from({ length: iterations }, () => true),
    );
  });

  it("headers should keep the original case", async () => {
    const receivedHeaders = [];
    const { promise, resolve } = Promise.withResolvers();
    const server = createServer(socket => {
      socket.on("data", data => {
        const request = data.toString();
        const headers = request.split("\r\n").slice(1);

        for (const header of headers) {
          const [key, value] = header.split(": ");
          if (key) {
            receivedHeaders.push(key);
          }
        }

        const response = "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n";

        socket.write(response);
        socket.end();
      });

      // The client can reset the connection after it reads the 403.
      socket.on("error", () => {});
    });

    server.listen(0, () => {
      const address = server.address();
      const ws = new WebSocket(`ws://localhost:${address.port}`, {
        headers: {
          Origin: "https://bun.sh",
          MyCustomHeader: "Hello, World!",
          Custom_Header_2: "Hello, World!",
          "Custom-Header-3": "Hello, World!",
          mycustomheader4: "Hello, World!",
        },
      });

      resolve(eventsUntilClose(ws));
    });

    try {
      const events = await promise;

      expect(receivedHeaders).toContain("MyCustomHeader");
      expect(receivedHeaders).toContain("Custom_Header_2");
      expect(receivedHeaders).toContain("Custom-Header-3");
      expect(receivedHeaders).toContain("Origin");
      expect(receivedHeaders).toContain("Sec-WebSocket-Key");
      expect(receivedHeaders).toContain("Sec-WebSocket-Version");
      expect(receivedHeaders).toContain("Upgrade");
      expect(receivedHeaders).toContain("Connection");
      expect(receivedHeaders).toContain("Host");
      expect(receivedHeaders).toContain("mycustomheader4");

      for (const header of receivedHeaders) {
        if (header === "mycustomheader4") continue;
        expect(header).not.toBe(header.toLowerCase());
      }
      expect(events).toEqual([
        {
          error: `WebSocket connection to 'ws://localhost:${server.address().port}/' failed: Expected 101 status code: 403`,
          code: undefined,
        },
        closed1006,
      ]);
    } finally {
      server.close();
    }
  });
});

// ASAN builds may print a benign signal-handler warning to stderr at
// startup; ignore that line so only real subprocess errors fail the test.
function stderrLines(stderr) {
  return stderr.split("\n").filter(line => line && !line.startsWith("WARNING: ASAN interferes"));
}

// Runs websocket-subprocess.ts against `url`. It prints "Connected!" when its socket opens and "Closed!" when it closes.
function spawnClient(url) {
  return Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "websocket-subprocess.ts"), url],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function output(subprocess) {
  return Promise.all([subprocess.stdout.text(), subprocess.stderr.text(), subprocess.exited]);
}

describe.concurrent("websocket in subprocess", () => {
  it.concurrent("should exit", async () => {
    const received = [];
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          ws.send("hello websocket");
        },
        message(ws, message) {
          received.push(message);
          ws.close();
        },
        close(ws) {},
      },
    });
    await using subprocess = spawnClient(`http://${server.hostname}:${server.port}`);

    const [stdout, stderr, exitCode] = await output(subprocess);
    expect(stderrLines(stderr)).toEqual([]);
    expect(stdout).toBe("Connected!\nClosed!\n");
    expect(exitCode).toBe(0);
    expect(received).toEqual(["hello"]);
  });

  it.concurrent("should work with process.nextTick override", async () => {
    using dir = tempDir("websocket-nexttick", {
      "test.js": `{
  process.nextTick = function (arg) {
    console.log(arg)
  }
  using server = Bun.serve({
    port: 0,
    fetch() { return new Response(); },
    websocket: { message() {} },
  });
  const ws = new WebSocket(\`ws://\${server.hostname}:\${server.port}\`, {});
  ws.addEventListener("open", null);
}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await output(proc);
    expect(stderrLines(stderr)).toEqual([]);
    // The override prints its argument. Bun called it with a function.
    expect(stdout).toStartWith("[Function");
    expect(exitCode).toBe(0);
  });

  it("can be made inside a ShadowRealm", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(new ShadowRealm().evaluate("new WebSocket('ws://127.0.0.1:1/').readyState"));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await output(proc);
    expect(stderrLines(stderr)).toEqual([]);
    expect(stdout.trim()).toBe(String(WebSocket.CONNECTING));
    expect(exitCode).toBe(0);
  });

  it("should exit after killed", async () => {
    const opened = Promise.withResolvers();
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          opened.resolve();
        },
        message(ws, message) {},
      },
    });
    await using subprocess = spawnClient(server.url.href);

    // An open socket keeps the process alive, so only the signal ends it.
    await Promise.race([opened.promise, subprocess.exited]);
    subprocess.kill();

    const [stdout, , exitCode] = await output(subprocess);
    // The signal can arrive before the open handler prints. The close handler never runs.
    expect(["", "Connected!\n"]).toContain(stdout);
    expect(exitCode).toBe(143); // 128 + 15 (SIGTERM)
    expect(subprocess.exitCode).toBe(null);
    expect(subprocess.signalCode).toBe("SIGTERM");
  });

  it("should exit with invalid url", async () => {
    await using subprocess = spawnClient("invalid url");

    const [stdout, stderr, exitCode] = await output(subprocess);
    expect(stderr).toContain("SyntaxError: Invalid url for WebSocket invalid url");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  it("should exit after timeout", async () => {
    const received = [];
    let start = 0;
    let end = 0;
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          start = performance.now();
          ws.send("timeout");
        },
        message(ws, message) {
          received.push(message);
          end = performance.now();
          ws.close();
        },
        close(ws) {},
      },
    });
    await using subprocess = spawnClient(server.url.href);

    const [stdout, stderr, exitCode] = await output(subprocess);
    expect(stderrLines(stderr)).toEqual([]);
    expect(stdout).toBe("Connected!\nClosed!\n");
    expect(exitCode).toBe(0);
    expect(received).toEqual(["close"]);
    expect(Math.ceil(end - start)).toBeGreaterThanOrEqual(290);
  });

  it("should exit after server stop and 0 messages", async () => {
    const { promise, resolve } = Promise.withResolvers();
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }

        return new Response("http response");
      },
      websocket: {
        open(ws) {
          resolve();
        },
        message(ws, message) {},
        close(ws) {},
      },
    });

    await using subprocess = spawnClient(`http://${server.hostname}:${server.port}`);
    await Promise.race([promise, subprocess.exited]);
    server.stop(true);

    const [stdout, stderr, exitCode] = await output(subprocess);
    expect(stderrLines(stderr)).toEqual([]);
    expect(stdout).toBe("Connected!\nClosed!\n");
    expect(exitCode).toBe(0);
  });
});

// Runs alone: it counts every WebSocket in the heap.
// 1000 connections take 2.5 s alone on a debug build.
it.serial("instances should be finalized when GC'd", { timeout: 90_000 }, async () => {
  const batchSize = 20;
  let connecting_websocket_count = 0;
  let initial_websocket_count = 0;
  function getWebSocketCount() {
    return heapStats().objectTypeCounts.WebSocket || 0;
  }

  async function run() {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        return server.upgrade(req);
      },
      websocket: {
        open() {},
        data() {},
        message() {},
        drain() {},
      },
    });

    function onOpen(sock, resolve) {
      sock.addEventListener("close", resolve, { once: true });
      sock.close();
    }

    function openAndCloseWS() {
      const { promise, resolve } = Promise.withResolvers();
      const sock = new WebSocket(server.url.href.replace("http", "ws"));
      sock.addEventListener("open", onOpen.bind(undefined, sock, resolve), {
        once: true,
      });

      return promise;
    }

    Bun.gc(true);
    initial_websocket_count = getWebSocketCount();
    for (let i = 0; i < 1000; i += batchSize) {
      const batch = Array.from({ length: batchSize }, openAndCloseWS);
      // No socket of the first batch has opened yet, so the heap holds all of them.
      if (i === 0) connecting_websocket_count = getWebSocketCount();
      await Promise.all(batch);
    }
  }
  await run();

  expect(connecting_websocket_count).toBeGreaterThanOrEqual(batchSize);
  // expect that current and initial websocket be close to the same (normaly 1 or 2 difference)
  await expectMaxObjectTypeCount(expect, "WebSocket", initial_websocket_count + 50);
});

// https://github.com/oven-sh/bun/issues/16995
// Runs alone: the loop does not yield, and it takes 3.5 s on a debug build.
it.serial("#16995", { timeout: 90_000 }, async () => {
  const count = 4096;
  // The host is an IP address, so there is no lookup: the socket exists and its connect() has started when the
  // constructor returns. close() runs before the event loop can report the result of that connect().
  const listener = createServer(socket => socket.destroy());
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  try {
    const address = new URL(`https://127.0.0.1:${listener.address().port}`);
    let errors = 0;
    let closes = 0;
    const closeCodes = new Set();
    const { promise, resolve } = Promise.withResolvers();
    function onerror() {
      errors++;
    }
    function onclose(event) {
      closeCodes.add(event.code);
      if (++closes === count) resolve();
    }
    for (let i = 0; i < count; i++) {
      const socket = new WebSocket(address.toString());
      socket.onerror = onerror;
      socket.onclose = onclose;
      socket.close();
    }
    await promise;
    expect({ errors, closes, closeCodes: [...closeCodes] }).toEqual({
      errors: count,
      closes: count,
      closeCodes: [1006],
    });
  } finally {
    listener.close();
  }
});

// Every case throws from the constructor, before it connects.
describe("WebSocket constructor rejects", () => {
  const url = "ws://127.0.0.1:1/";
  const invalidCA = { class: "TypeError", message: expect.stringContaining("TLSOptions.ca") };
  const missingUnixPath = href => ({
    class: "SyntaxError",
    message: `Invalid url for WebSocket ${href} (missing unix socket path)`,
  });

  it.each([
    ["an invalid URL", ["not a url"], { class: "SyntaxError", message: "Invalid url for WebSocket not a url" }],
    [
      "an invalid URL with options",
      ["not a url", {}],
      { class: "SyntaxError", message: "Invalid url for WebSocket not a url" },
    ],
    [
      "an unsupported URL scheme",
      ["ftp://127.0.0.1:1/"],
      { class: "SyntaxError", message: "Wrong url scheme for WebSocket ftp://127.0.0.1:1/" },
    ],
    [
      "a URL with a fragment",
      [url + "path#frag"],
      { class: "SyntaxError", message: "URL has fragment component ws://127.0.0.1:1/path#frag" },
    ],
    [
      "a subprotocol with a space",
      [url, ["a b"]],
      { class: "SyntaxError", message: "Wrong protocol for WebSocket 'a b'" },
    ],
    ["an empty subprotocol", [url, [""]], { class: "SyntaxError", message: "Wrong protocol for WebSocket ''" }],
    [
      "a subprotocol with a space in options.protocols",
      [url, { protocols: ["a b"] }],
      { class: "SyntaxError", message: "Wrong protocol for WebSocket 'a b'" },
    ],
    [
      "a duplicate subprotocol",
      [url, ["a", "a"]],
      { class: "SyntaxError", message: "WebSocket protocols contain duplicates: 'a'" },
    ],
    [
      "a duplicate subprotocol in options.protocols",
      [url, { protocols: ["a", "a"] }],
      { class: "SyntaxError", message: "WebSocket protocols contain duplicates: 'a'" },
    ],
    ["a ws+unix: URL with no path", ["ws+unix:"], missingUnixPath("ws+unix:")],
    ["a ws+unix: URL with an empty authority and no path", ["ws+unix://"], missingUnixPath("ws+unix://")],
    ["a ws+unix: URL whose path starts with a colon", ["ws+unix::/request"], missingUnixPath("ws+unix::/request")],
    ["a wss+unix: URL whose path starts with a colon", ["wss+unix::/request"], missingUnixPath("wss+unix::/request")],
    [
      "an invalid proxy URL",
      [url, { proxy: "not a url" }],
      { class: "SyntaxError", message: "Invalid proxy URL: not a url" },
    ],
    [
      "an unsupported proxy protocol",
      [url, { proxy: "socks5://127.0.0.1:1" }],
      { class: "SyntaxError", message: 'Unsupported proxy protocol "socks5" (expected "http" or "https")' },
    ],
    [
      "an invalid header name",
      [url, { headers: { "bad name": "x" } }],
      { class: "TypeError", message: "Invalid header name: 'bad name'" },
    ],
    [
      "an invalid header value",
      [url, { headers: { "x-a": "a\r\nb: c" } }],
      { class: "TypeError", message: "Header 'x-a' has invalid value" },
    ],
    [
      "a header value outside latin1",
      [url, { headers: { "x-a": "\u{1F600}" } }],
      { class: "TypeError", message: "Type error" },
    ],
    [
      "an invalid proxy header name",
      [
        url,
        { proxy: { url: "http://127.0.0.1:1", headers: { "Proxy-Authorization": "Basic QQ==", "bad name": "x" } } },
      ],
      { class: "TypeError", message: "Invalid header name: 'bad name'" },
    ],
    [
      "an invalid proxy header value",
      [url, { proxy: { url: "http://127.0.0.1:1", headers: { "x-a": "a\r\nb: c" } } }],
      { class: "TypeError", message: "Header 'x-a' has invalid value" },
    ],
    ["an invalid tls option", ["wss://127.0.0.1:1/", { tls: { ca: 123 } }], invalidCA],

    // When two inputs are invalid, the error is for the one validated first.
    [
      "the URL before the subprotocols",
      [url + "#frag", ["a", "a"]],
      { class: "SyntaxError", message: "URL has fragment component ws://127.0.0.1:1/#frag" },
    ],
    [
      "an invalid subprotocol before a duplicate subprotocol",
      [url, ["a", "a", "b c"]],
      { class: "SyntaxError", message: "Wrong protocol for WebSocket 'b c'" },
    ],
    [
      "the subprotocols before the unix socket path",
      ["ws+unix:", ["a", "a"]],
      { class: "SyntaxError", message: "WebSocket protocols contain duplicates: 'a'" },
    ],
    [
      "the proxy URL before the URL",
      ["not a url", { proxy: "not a url" }],
      { class: "SyntaxError", message: "Invalid proxy URL: not a url" },
    ],
    ["the tls options before the URL", ["wss://127.0.0.1:1/#frag", { tls: { ca: 123 } }], invalidCA],
    [
      "the URL before the header names",
      [url + "#frag", { headers: { "bad name": "x" } }],
      { class: "SyntaxError", message: "URL has fragment component ws://127.0.0.1:1/#frag" },
    ],
    [
      "a URL with a fragment when rejectUnauthorized is set",
      [url + "#frag", { tls: { rejectUnauthorized: false } }],
      {
        class: "SyntaxError",
        message: "URL has fragment component ws://127.0.0.1:1/#frag",
      },
    ],
  ])("%s", (_label, args, expected) => {
    let thrown;
    try {
      new WebSocket(...args).terminate();
    } catch (error) {
      thrown = { class: error.constructor.name, message: error.message };
    }
    expect(thrown).toEqual(expected);
  });
});

// The Zig-heap-allocated SSLConfig (holding duped cert/key/ca strings) used
// to leak on every early-return path between parseSSLConfig and the point
// where the Zig upgrade client takes ownership: throwing option getters
// (JSWebSocket.cpp), invalid proxy, and any connect() validation failure
// (WebSocket.cpp). Exercise both families of paths with a large `ca` payload
// and assert RSS stays bounded.
describe("WebSocket tls option does not leak SSLConfig on error paths", () => {
  const fixture = /* js */ `
    const iterations = 500;
    // 256 KiB duped per SSLConfig -> ~128 MiB per path if every iteration leaks.
    const bigCA = Buffer.alloc(256 * 1024, "A").toString();
    const tls = { ca: bigCA, rejectUnauthorized: false };
    const rss = process.memoryUsage.rss;

    function hit() {
      // Path 1: getter on a later option throws after the SSLConfig has
      // already been heap-allocated in constructJSWebSocket3.
      try {
        new WebSocket("wss://127.0.0.1:1", {
          tls,
          get proxy() { throw new Error("boom"); },
        });
        throw new Error("expected proxy getter to throw");
      } catch (e) {
        if (e?.message !== "boom") throw e;
      }

      // Path 2: WebSocket::create assigns m_sslConfig, then connect() rejects
      // the URL (fragment identifier) before handing the config to Zig.
      let threw = false;
      try {
        new WebSocket("wss://127.0.0.1:1/path#fragment", { tls });
      } catch {
        threw = true;
      }
      if (!threw) throw new Error("expected fragment URL to throw");
    }

    // Warm up so one-off allocations (ICU, resolver caches, JIT) settle.
    for (let i = 0; i < 100; i++) hit();
    Bun.gc(true);
    const baseline = rss();

    for (let i = 0; i < iterations; i++) hit();
    Bun.gc(true);
    const after = rss();

    const growthMiB = (after - baseline) / (1024 * 1024);
    console.log(JSON.stringify({ baseline, after, growthMiB }));
    // 500 iterations * 2 paths * 256 KiB would leak ~250 MiB. Allow generous
    // headroom for allocator noise while still catching the regression.
    // ASAN's quarantine retains freed allocations so widen the threshold there.
    if (growthMiB > ${isASAN ? 256 : 64}) {
      process.exitCode = 1;
    }
  `;

  it("bounded RSS growth across throwing-option and connect-failure paths", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await output(proc);
    expect(stderrLines(stderr)).toEqual([]);
    const { growthMiB } = JSON.parse(stdout.trim());
    expect(growthMiB).toBeLessThan(isASAN ? 256 : 64);
    expect(exitCode).toBe(0);
  });
});

// Raw TCP server: complete the WS handshake, then run `afterUpgrade(socket)`.
// Post-upgrade client->server bytes go to `onClientData(socket, chunk)` when
// provided; otherwise the socket is half-closed (the historical default the
// CloseEvent tests below rely on).
function rawWsServer(afterUpgrade, onClientData) {
  return new Promise(resolveServer => {
    const server = createServer(sock => {
      let buf = "";
      let upgraded = false;
      sock.on("data", chunk => {
        if (upgraded) {
          if (onClientData) {
            onClientData(sock, chunk);
          } else {
            sock.end();
          }
          return;
        }
        buf += chunk.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return;
        const key = /Sec-WebSocket-Key:\s*(.*)\r\n/i.exec(buf)[1].trim();
        const accept = crypto
          .createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        sock.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " +
            accept +
            "\r\n\r\n",
        );
        upgraded = true;
        afterUpgrade(sock);
      });
      sock.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

describe("WebSocket CloseEvent reports the received close code", () => {
  function closeFrame(code, reason = "") {
    const r = Buffer.from(reason);
    const f = Buffer.alloc(4 + r.length);
    f[0] = 0x88;
    f[1] = 2 + r.length;
    f[2] = (code >> 8) & 0xff;
    f[3] = code & 0xff;
    r.copy(f, 4);
    return f;
  }

  async function connectAndAwaitClose(server, errors = []) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    const { promise, resolve } = Promise.withResolvers();
    ws.addEventListener("close", e => resolve({ code: e.code, reason: e.reason, wasClean: e.wasClean }));
    ws.addEventListener("error", e => errors.push(e.error.code));
    const result = await promise;
    await new Promise(r => server.close(r));
    return result;
  }

  it("bodyless Close frame reports code 1005", async () => {
    const server = await rawWsServer(sock => sock.write(Buffer.from([0x88, 0x00])));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1005, reason: "", wasClean: true });
  });

  it("Close frame with code 1001 reports 1001", async () => {
    const server = await rawWsServer(sock => sock.write(closeFrame(1001)));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1001, reason: "", wasClean: true });
  });

  describe.each([1000, 1002, 1003, 1007, 1011, 3000, 4000, 4999])("Close frame with code %i", code => {
    it("passes through unchanged", async () => {
      const server = await rawWsServer(sock => sock.write(closeFrame(code)));
      expect(await connectAndAwaitClose(server)).toEqual({ code, reason: "", wasClean: true });
    });
  });

  // RFC6455 §7.4.1: codes < 1000, the reserved 1004-1006 range, and 1016-2999
  // are not legal on the wire, so receiving one is a protocol error.
  describe.each([999, 1004, 1005, 1006, 1016, 2999])("reserved/invalid code %i", code => {
    it("fails the connection", async () => {
      const server = await rawWsServer(sock => sock.write(closeFrame(code)));
      const errors = [];
      expect(await connectAndAwaitClose(server, errors)).toEqual({ code: 1006, reason: "", wasClean: false });
      expect(errors).toEqual(["WS_ERR_INVALID_CLOSE_CODE"]);
    });
  });

  it("Close frame with reason preserves reason", async () => {
    const server = await rawWsServer(sock => sock.write(closeFrame(1011, "boom")));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1011, reason: "boom", wasClean: true });
  });

  it("server-initiated clean close reports wasClean=true", async () => {
    const server = await rawWsServer(sock => sock.write(closeFrame(1000)));
    const { wasClean } = await connectAndAwaitClose(server);
    expect(wasClean).toBe(true);
  });

  it("abnormal close (socket destroyed without Close frame) reports wasClean=false and fires no error", async () => {
    const server = await rawWsServer(sock => sock.destroy());
    const errors = [];
    expect(await connectAndAwaitClose(server, errors)).toEqual({ code: 1006, reason: "", wasClean: false });
    expect(errors).toEqual([]);
  });
});

describe("WebSocket message handler re-entrancy during a multi-frame read", () => {
  // Unmasked server->client text frame: FIN=1, opcode=1, 7-bit length.
  function textFrame(str) {
    const payload = Buffer.from(str);
    expect(payload.length).toBeLessThan(126);
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }

  // Decode the first masked client->server text frame.
  function decodeClientTextFrame(buf) {
    expect(buf.length).toBeGreaterThanOrEqual(6);
    expect(buf[0] & 0x0f).toBe(0x1);
    expect(buf[1] & 0x80).toBe(0x80);
    const len = buf[1] & 0x7f;
    expect(len).toBeLessThan(126);
    expect(buf.length).toBeGreaterThanOrEqual(6 + len);
    const mask = buf.subarray(2, 6);
    const payload = Buffer.from(buf.subarray(6, 6 + len));
    for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
    return payload.toString();
  }

  // 2 header bytes + 4 mask bytes + "from-handler".length
  const CLIENT_TEXT_FRAME_LEN = 6 + "from-handler".length;

  // The server writes A, B and C as three text frames in ONE TCP segment so a
  // single native receive pass dispatches all of them; `onMessage` runs
  // synchronously inside that dispatch.
  async function run(onMessage, { awaitClientFrame = false } = {}) {
    const clientChunks = [];
    const gotClientFrame = Promise.withResolvers();
    let conn;
    const server = await rawWsServer(
      sock => {
        conn = new RawSocket(sock, false);
        conn.echoClose();
        sock.write(Buffer.concat([textFrame("A"), textFrame("B"), textFrame("C")]));
      },
      (_sock, chunk) => {
        clientChunks.push(chunk);
        if (Buffer.concat(clientChunks).length >= CLIENT_TEXT_FRAME_LEN) gotClientFrame.resolve();
        conn.push(chunk);
      },
    );
    try {
      const closed = Promise.withResolvers();
      const messages = [];
      const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
      ws.addEventListener("error", () => {});
      ws.addEventListener("close", e => closed.resolve({ code: e.code, wasClean: e.wasClean }));
      ws.addEventListener("message", e => {
        messages.push(e.data);
        onMessage(ws, messages);
      });
      const close = await closed.promise;
      if (awaitClientFrame) await gotClientFrame.promise;
      return { messages, close, clientFrames: Buffer.concat(clientChunks) };
    } finally {
      conn?.destroy();
      await new Promise(r => server.close(r));
    }
  }

  it("a synchronous send() from the message handler preserves the remaining frames", async () => {
    const { messages, close, clientFrames } = await run(
      (ws, messages) => {
        if (messages.length === 1) ws.send("from-handler");
        if (messages.length === 3) ws.close(1000);
      },
      { awaitClientFrame: true },
    );
    expect(messages).toEqual(["A", "B", "C"]);
    // The re-entrant write actually went out mid-loop.
    expect(decodeClientTextFrame(clientFrames)).toBe("from-handler");
    expect(close).toEqual({ code: 1000, wasClean: true });
  });

  it("a synchronous close() from the message handler suppresses the remaining frames", async () => {
    const { messages, close } = await run((ws, messages) => {
      if (messages.length === 1) {
        ws.send("from-handler");
        ws.close(1000, "bye");
      }
    });
    expect(messages).toEqual(["A"]);
    expect(close).toEqual({ code: 1000, wasClean: true });
  });

  it("a synchronous terminate() from the message handler suppresses the remaining frames", async () => {
    const { messages, close } = await run((ws, messages) => {
      if (messages.length === 1) {
        ws.send("from-handler");
        ws.terminate();
      }
    });
    expect(messages).toEqual(["A"]);
    expect(close).toEqual({ code: 1006, wasClean: false });
  });
});

// https://github.com/oven-sh/bun/issues/38188
it("terminate() on a wss:// socket whose peer never answers close_notify still fires close", async () => {
  const worker = new Worker(join(import.meta.dir, "websocket-frozen-server-fixture.ts"));
  try {
    const workerFailed = new Promise((_, reject) => (worker.onerror = e => reject(e.error ?? new Error(e.message))));
    const port = await Promise.race([workerFailed, new Promise(resolve => (worker.onmessage = e => resolve(e.data)))]);
    const frozen = new Promise(resolve => (worker.onmessage = e => resolve(e.data)));
    const ws = new WebSocket(`wss://127.0.0.1:${port}`, { tls: { rejectUnauthorized: false } });
    const errored = new Promise((_, reject) => (ws.onerror = e => reject(e.error ?? new Error(e.message))));
    const closed = new Promise(resolve => (ws.onclose = e => resolve(e.code)));
    await Promise.race([errored, new Promise(resolve => (ws.onopen = resolve))]);
    ws.send("freeze");
    expect(await Promise.race([workerFailed, frozen])).toBe("frozen");

    ws.terminate();
    expect(ws.readyState).toBe(WebSocket.CLOSING);
    expect(await closed).toBe(1006);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  } finally {
    worker.terminate();
  }
});

// WebSocketOptions declares `protocols?: string | string[]` and `protocol?: string`.
// Both are sent as Sec-WebSocket-Protocol, the same as the positional argument.
describe.concurrent("WebSocket subprotocol options", () => {
  async function requestedProtocol(options) {
    const { promise, resolve, reject } = Promise.withResolvers();
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        resolve(req.headers.get("sec-websocket-protocol"));
        server.upgrade(req);
      },
      websocket: {
        open(ws) {
          ws.close();
        },
        message() {},
      },
    });
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}`, options);
    const closed = Promise.withResolvers();
    ws.onerror = event => reject(event.error ?? new Error(event.message));
    ws.onclose = event => {
      reject(new Error(`closed before the upgrade request arrived: ${event.code}`));
      closed.resolve();
    };
    const header = await promise;
    await closed.promise;
    return header;
  }

  it.each([
    ["positional string", "chat", "chat"],
    ["positional array", ["chat", "v2"], "chat, v2"],
    ["protocols string", { protocols: "chat" }, "chat"],
    ["protocols array", { protocols: ["chat", "v2"] }, "chat, v2"],
    ["protocol string", { protocol: "chat" }, "chat"],
    ["protocols overrides protocol", { protocols: ["a"], protocol: "b" }, "a"],
    ["protocol when protocols is undefined", { protocols: undefined, protocol: "b" }, "b"],
    ["protocol when protocols is null", { protocols: null, protocol: "b" }, "b"],
    ["no protocol", {}, null],
    ["protocols null", { protocols: null }, null],
    // WebIDL (DOMString or sequence<DOMString>): non-objects are converted to strings.
    ["protocols number", { protocols: 5 }, "5"],
    ["positional number", 5, "5"],
    ["positional boolean", true, "true"],
    ["positional null", null, "null"],
    ["positional undefined", undefined, null],
  ])("%s", async (_, options, expected) => {
    expect(await requestedProtocol(options)).toBe(expected);
  });

  it("rejects an invalid protocol token in the options object", () => {
    expect(() => new WebSocket("ws://localhost:1", { protocols: "bad token" })).toThrow(SyntaxError);
    expect(() => new WebSocket("ws://localhost:1", { protocol: "bad token" })).toThrow(SyntaxError);
    expect(() => new WebSocket("ws://localhost:1", { protocols: ["a", "a"] })).toThrow(SyntaxError);
  });
});

describe("WebSocket url", () => {
  it.each([
    ["http://127.0.0.1:1", "ws://127.0.0.1:1/"],
    ["https://127.0.0.1:443/x?y=1", "wss://127.0.0.1/x?y=1"],
    ["http://127.0.0.1:443/", "ws://127.0.0.1:443/"],
    ["HTTPS://user:pass@LOCALHOST:1/a/../b", "wss://user:pass@localhost:1/b"],
    ["ws://127.0.0.1:80/", "ws://127.0.0.1/"],
    ["wss://127.0.0.1:1/", "wss://127.0.0.1:1/"],
  ])("%s is normalized to %s", (input, url) => {
    const ws = new WebSocket(input);
    ws.onerror = () => {};
    ws.terminate();
    expect(ws.url).toBe(url);
    expect(ws.URL).toBe(url);
  });
});
