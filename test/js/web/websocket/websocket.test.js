import { describe, expect, it } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
import { bunEnv, bunExe, gc, tempDir, tls } from "harness";
import { createServer } from "net";
import { join } from "path";
import process from "process";
const TEST_WEBSOCKET_HOST = process.env.TEST_WEBSOCKET_HOST || "wss://ws.postman-echo.com/raw";
const COMMON_CERT = { ...tls };

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
    await new Promise(resolve => {
      ws.onopen = resolve;
    });
    var closed = new Promise(resolve => {
      ws.onclose = resolve;
    });
    ws.close();
    await closed;
    Bun.gc(true);
  });

  it("should connect over https", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST.replaceAll("wss:", "https:"));
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    var closed = new Promise((resolve, reject) => {
      ws.onclose = resolve;
    });

    ws.close();
    await closed;
    Bun.gc(true);
  });

  it("should connect many times over https", async () => {
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
          });
          var closed = new Promise((resolve, reject) => {
            ws.onclose = resolve;
          });

          ws.close();
          await closed;
        }
        for (let i = 0; i < 300; i++) {
          batch[i % batchSize] = run();
          if (i % batchSize === batchSize - 1) {
            await Promise.all(batch);
          }
        }
        await Promise.all(batch);
        Bun.gc(true);
      }
    }
    // test GC after all connections are closed
    Bun.gc(true);
    // wait to make sure all connections are closed/freed
    await Bun.sleep(10);
  });

  it("rejectUnauthorized should reject self-sign certs when true/default", async () => {
    using server = Bun.serve({
      port: 0,
      tls: COMMON_CERT,
      fetch(req, server) {
        // upgrade the request to a WebSocket
        if (server.upgrade(req)) {
          return; // do not return a Response
        }
        return new Response("Upgrade failed :(", { status: 500 });
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
          ws.close();
        }, // a message is received
        open(ws) {
          // a socket is opened
          ws.send("Hello from Bun!");
        },
      },
    });

    {
      function testClient(client) {
        const { promise, resolve, reject } = Promise.withResolvers();
        let messages = [];
        let errorFired = false;
        client.onopen = () => {
          client.send("Hello from client!");
        };
        client.onmessage = e => {
          messages.push(e.data);
        };
        client.onerror = e => {
          errorFired = true;
          // Don't reject, we expect both error and close events
        };
        client.onclose = e => {
          resolve({ result: e, messages, errorFired });
        };
        return promise;
      }
      const url = server.url.href;
      {
        // by default rejectUnauthorized is true
        const client = new WebSocket(url);
        const { result, messages, errorFired } = await testClient(client);
        expect(errorFired).toBe(true); // Error event should fire
        expect(["Hello from Bun!", "Hello from client!"]).not.toEqual(messages);
        expect(result.code).toBe(1015);
        expect(result.reason).toBe("TLS handshake failed");
      }

      {
        // just in case we change the default to true and test
        const client = new WebSocket(url, { tls: { rejectUnauthorized: true } });
        const { result, messages, errorFired } = await testClient(client);
        expect(errorFired).toBe(true); // Error event should fire
        expect(["Hello from Bun!", "Hello from client!"]).not.toEqual(messages);
        expect(result.code).toBe(1015);
        expect(result.reason).toBe("TLS handshake failed");
      }
    }
  });

  it("rejectUnauthorized should NOT reject self-sign certs when false", async () => {
    using server = Bun.serve({
      port: 0,
      tls: COMMON_CERT,
      fetch(req, server) {
        // upgrade the request to a WebSocket
        if (server.upgrade(req)) {
          return; // do not return a Response
        }
        return new Response("Upgrade failed :(", { status: 500 });
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
          ws.close();
        }, // a message is received
        open(ws) {
          // a socket is opened
          ws.send("Hello from Bun!");
        },
      },
    });

    {
      function testClient(client) {
        const { promise, resolve, reject } = Promise.withResolvers();
        let messages = [];
        client.onopen = () => {
          client.send("Hello from client!");
        };
        client.onmessage = e => {
          messages.push(e.data);
        };
        client.onerror = reject;
        client.onclose = e => {
          resolve({ result: e, messages });
        };
        return promise;
      }
      const url = `wss://127.0.0.1:${server.address.port}`;

      {
        // should allow self-signed certs when rejectUnauthorized is false
        const client = new WebSocket(url, { tls: { rejectUnauthorized: false } });
        const { result, messages } = await testClient(client);
        expect(["Hello from Bun!", "Hello from client!"]).toEqual(messages);
        expect(result.code).toBe(1000);
      }
    }
  });

  it("should not accept untrusted certificates", async () => {
    const UNTRUSTED_CERT = {
      key: readFileSync(join(import.meta.dir, "..", "..", "node", "http", "fixtures", "openssl.key")),
      cert: readFileSync(join(import.meta.dir, "..", "..", "node", "http", "fixtures", "openssl.crt")),
      passphrase: "123123123",
    };

    using server = Bun.serve({
      port: 0,
      tls: UNTRUSTED_CERT,
      fetch(req, server) {
        // upgrade the request to a WebSocket
        if (server.upgrade(req)) {
          return; // do not return a Response
        }
        return new Response("Upgrade failed :(", { status: 500 });
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
          ws.close();
        }, // a message is received
        open(ws) {
          // a socket is opened
          ws.send("Hello from Bun!");
        },
      },
    });

    {
      function testClient(client) {
        const { promise, resolve, reject } = Promise.withResolvers();
        let messages = [];
        let errorFired = false;
        client.onopen = () => {
          client.send("Hello from client!");
        };
        client.onmessage = e => {
          messages.push(e.data);
        };
        client.onerror = e => {
          errorFired = true;
          // Don't reject, we expect both error and close events
        };
        client.onclose = e => {
          resolve({ result: e, messages, errorFired });
        };
        return promise;
      }
      const url = `wss://localhost:${server.address.port}`;
      {
        const client = new WebSocket(url);
        const { result, messages, errorFired } = await testClient(client);
        expect(errorFired).toBe(true); // Error event should fire
        expect(["Hello from Bun!", "Hello from client!"]).not.toEqual(messages);
        expect(result.code).toBe(1015);
        expect(result.reason).toBe("TLS handshake failed");
      }
    }
  });

  it("supports headers", done => {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        expect(req.headers.get("X-Hello")).toBe("World");
        expect(req.headers.get("content-type")).toBe("lolwut");
        server.stop();
        done();
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
  });

  it("should FAIL to connect over http when the status code is invalid", done => {
    const server = Bun.serve({
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
    ws.onopen = () => {
      ws.send("Hello World!");
    };

    ws.onclose = e => {
      expect(e.code).toBe(1002);
      done();
    };
  });

  it("should connect over http ", done => {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req);
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
    ws.onopen = () => {
      ws.send("Hello World!");
    };

    ws.onclose = () => {
      done();
    };
  });
  describe("nodebuffer", () => {
    it("should support 'nodebuffer' binaryType", done => {
      const server = Bun.serve({
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
      ws.onmessage = ({ data }) => {
        ws.close();
        expect(Buffer.isBuffer(data)).toBe(true);
        expect(data).toEqual(new Uint8Array([1, 2, 3]));
        server.stop(true);
        Bun.gc(true);
        done();
      };
    });

    it("should support 'nodebuffer' binaryType when the handler is not immediately provided", done => {
      var client;
      const server = Bun.serve({
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
              expect(Buffer.isBuffer(data)).toBe(true);
              expect(data).toEqual(new Uint8Array([1, 2, 3]));
              server.stop(true);
              done();
            };
          },
        },
      });
      client = new WebSocket(`http://${server.hostname}:${server.port}`, {});
      client.binaryType = "nodebuffer";
      expect(client.binaryType).toBe("nodebuffer");
    });
  });

  it("should send and receive messages", async () => {
    const ws = new WebSocket(TEST_WEBSOCKET_HOST);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      ws.onclose = () => {
        reject("WebSocket closed");
      };
    });
    const count = 10;

    // 10 messages in burst
    var promise = new Promise((resolve, reject) => {
      var remain = count;
      ws.onmessage = event => {
        gc(true);
        expect(event.data).toBe("Hello World!");
        remain--;

        if (remain <= 0) {
          ws.onmessage = () => {};
          resolve();
        }
      };
      ws.onerror = reject;
    });

    for (let i = 0; i < count; i++) {
      ws.send("Hello World!");
      gc(true);
    }

    await promise;
    var echo = 0;

    // 10 messages one at a time
    function waitForEcho() {
      return new Promise((resolve, reject) => {
        gc(true);
        const msg = `Hello World! ${echo++}`;
        ws.onmessage = event => {
          expect(event.data).toBe(msg);
          resolve();
        };
        ws.onerror = reject;
        ws.onclose = reject;
        ws.send(msg);
        gc(true);
      });
    }
    gc(true);
    for (let i = 0; i < count; i++) await waitForEcho();
    ws.onclose = () => {};
    ws.onerror = () => {};
    ws.close();
    gc(true);
  });

  // If this test fails locally, check that ATT DNS error assist is disabled
  // or, make sure that your DNS server is pointed to a DNS server that does not mitm your requests
  it("should report failing websocket connection in onerror and onclose for DNS resolution error", async () => {
    const url = `ws://aposdkpaosdkpasodk.com`;
    const { promise, resolve, reject } = Promise.withResolvers();
    const { promise: promise2, resolve: resolve2, reject: reject2 } = Promise.withResolvers();

    const ws = new WebSocket(url, {});
    ws.onopen = () => reject(new Error("should not be called"));
    ws.onmessage = () => reject(new Error("should not be called"));
    ws.onerror = event => {
      expect(event.error).toBeInstanceOf(Error);
      resolve();
    };
    ws.onclose = () => resolve2();
    await Promise.all([promise, promise2]);
  });

  // We want to test that the `onConnectError` callback gets called.
  it("should report failing websocket connection in onerror and onclose for connection refused", async () => {
    const url = `ws://localhost:65412`;
    const { promise, resolve, reject } = Promise.withResolvers();
    const { promise: promise2, resolve: resolve2, reject: reject2 } = Promise.withResolvers();

    const ws = new WebSocket(url, {});
    ws.onopen = () => reject(new Error("should not be called"));
    ws.onmessage = () => reject(new Error("should not be called"));
    ws.onerror = event => {
      expect(event.error).toBeInstanceOf(Error);
      resolve();
    };
    ws.onclose = () => resolve2();
    await Promise.all([promise, promise2]);
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
    const expected = payload.byteLength * iterations;

    let total_received = 0;
    const timeout = setTimeout(() => {
      ws.close();
    }, 4000);
    ws.addEventListener("close", e => {
      clearTimeout(timeout);
      resolve(total_received);
    });

    ws.addEventListener("message", e => {
      if (typeof e.data === "string") {
        return;
      }
      const received = e.data.byteLength || e.data.size || 0;
      total_received += received;
      if (total_received >= expected) {
        ws.close();
      }
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("open", () => {
      for (let i = 0; i < 10; i++) {
        ws.send(payload);
      }
    });

    expect(await promise).toBe(expected);
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

      socket.on("error", err => {
        console.error("Socket error:", err);
      });
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

      ws.onclose = () => {
        resolve();
      };
    });

    try {
      await promise;

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
    } finally {
      server.close();
    }
  });
});

describe.concurrent("websocket in subprocess", () => {
  it.concurrent("should exit", async () => {
    let messageReceived = false;
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
        message(ws) {
          messageReceived = true;
          ws.close();
        },
        close(ws) {},
      },
    });
    await using subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", `http://${server.hostname}:${server.port}`],
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(0);
    expect(messageReceived).toBe(true);
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
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  it("should exit after killed", async () => {
    await using subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", TEST_WEBSOCKET_HOST],
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
      env: bunEnv,
    });

    subprocess.kill();

    expect(await subprocess.exited).toBe(143); // 128 + 15 (SIGTERM)
    expect(subprocess.exitCode).toBe(null);
    expect(subprocess.signalCode).toBe("SIGTERM");
  });

  it("should exit with invalid url", async () => {
    await using subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", "invalid url"],
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(1);
  });

  it("should exit after timeout", async () => {
    let messageReceived = false;
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
          messageReceived = true;
          end = performance.now();
          ws.close();
        },
        close(ws) {},
      },
    });
    await using subprocess = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "websocket-subprocess.ts"), server.url.href],
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
      env: bunEnv,
    });

    expect(await subprocess.exited).toBe(0);
    expect(messageReceived).toBe(true);
    expect(Math.ceil(end - start)).toBeGreaterThanOrEqual(290);
  });

  it("should exit after server stop and 0 messages", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const server = Bun.serve({
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

    await using subprocess = Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/websocket-subprocess.ts", `http://${server.hostname}:${server.port}`],
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
      env: bunEnv,
    });
    await promise;
    server.stop(true);
    expect(await subprocess.exited).toBe(0);
  });
});

it.concurrent("#16995", async () => {
  const publicAddress = new URL("https://1.1.1.1:3000");
  for (let i = 0; i < 4096; i++) {
    const socket = new WebSocket(publicAddress.toString());
    socket.close();
  }
});

it.serial("instances should be finalized when GC'd", async () => {
  let current_websocket_count = 0;
  let initial_websocket_count = 0;
  function getWebSocketCount() {
    Bun.gc(true);
    const objectTypeCounts = require("bun:jsc").heapStats().objectTypeCounts || {
      WebSocket: 0,
    };
    return objectTypeCounts.WebSocket || 0;
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

    for (let i = 0; i < 1000; i++) {
      await openAndCloseWS();
      if (i % 100 === 0) {
        if (initial_websocket_count === 0) {
          initial_websocket_count = getWebSocketCount();
        }
      }
    }
  }
  await run();

  // wait next tick to run the last time
  await Bun.sleep(100);
  current_websocket_count = getWebSocketCount();
  console.log({ current_websocket_count, initial_websocket_count });
  // expect that current and initial websocket be close to the same (normaly 1 or 2 difference)
  expect(Math.abs(current_websocket_count - initial_websocket_count)).toBeLessThanOrEqual(50);
});
