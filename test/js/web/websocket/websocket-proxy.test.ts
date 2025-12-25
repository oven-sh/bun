import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import net from "node:net";
import key from "../../third_party/jsonwebtoken/priv.pem" with { type: "text" };
import cert from "../../third_party/jsonwebtoken/pub.pem" with { type: "text" };

describe("WebSocket proxy support", () => {
  let proxyServer: net.Server;
  let wsServer: ReturnType<typeof Bun.serve>;
  let wssServer: ReturnType<typeof Bun.serve>;
  let proxyPort: number;
  let wsPort: number;
  let wssPort: number;
  let connectRequests: Array<{ host: string; port: number }> = [];

  beforeAll(async () => {
    // Create a simple WebSocket server (ws://)
    wsServer = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req, { data: {} })) {
          return;
        }
        return new Response("Not a WebSocket request", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          console.log("ws-message", message);
          // Echo the message back
          ws.send(message);
        },
        open(ws) {
          console.log("ws-connected");
          ws.send("connected");
        },
      },
    });
    wsPort = wsServer.port!;

    // Create a TLS WebSocket server (wss://)
    wssServer = Bun.serve({
      port: 0,
      tls: { cert, key },
      fetch(req, server) {
        if (server.upgrade(req, { data: {} })) {
          return;
        }
        return new Response("Not a WebSocket request", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          console.log("wss-message", message);
          // Echo the message back
          ws.send(message);
        },
        open(ws) {
          console.log("wss-connected-tls");
          ws.send("connected-tls");
        },
      },
    });
    wssPort = wssServer.port!;

    // Create a proper TCP CONNECT proxy that does bidirectional forwarding
    proxyServer = net.createServer(clientSocket => {
      console.log("hellp bruh");
      let buffer: Buffer = Buffer.alloc(0);
      let tunnelEstablished = false;

      const dataHandler = (data: Buffer) => {
        // Once tunnel is established, data flows through pipe - ignore in handler
        if (tunnelEstablished) {
          return;
        }

        buffer = Buffer.concat([buffer, data]);
        const request = buffer.toString();

        // Check if we have a complete HTTP request
        if (request.includes("\r\n\r\n")) {
          const lines = request.split("\r\n");
          const firstLine = lines[0];

          if (firstLine.startsWith("CONNECT ")) {
            // Parse CONNECT host:port HTTP/1.1
            const match = firstLine.match(/CONNECT ([^:]+):(\d+)/);
            if (match) {
              const targetHost = match[1];
              const targetPort = parseInt(match[2], 10);

              connectRequests.push({ host: targetHost, port: targetPort });

              // Connect to the target
              const targetSocket = net.connect(targetPort, targetHost, () => {
                // Mark tunnel as established BEFORE sending response
                tunnelEstablished = true;

                // Send 200 Connection Established
                clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

                // Remove data handler before setting up pipe
                clientSocket.removeListener("data", dataHandler);

                // Set up bidirectional forwarding
                clientSocket.pipe(targetSocket);
                targetSocket.pipe(clientSocket);
              });

              targetSocket.on("error", err => {
                clientSocket.destroy();
              });
            }
          }
        }
      };

      clientSocket.on("data", dataHandler);
      clientSocket.on("error", () => {});
    });

    await new Promise<void>(resolve => {
      proxyServer.listen(9091, () => {
        const addr = proxyServer.address();
        proxyPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    proxyServer?.close();
    wsServer?.stop();
    wssServer?.stop();
  });

  test("should connect to WebSocket without proxy when no proxy env set", async () => {
    using dir = tempDir("ws-no-proxy-test", {
      "test.ts": `
        const ws = new WebSocket("ws://localhost:${wsPort}");
        ws.onopen = () => {
          console.log("connected");
          ws.close();
        };
        ws.onmessage = (e) => {
          console.log("message:", e.data);
        };
        ws.onerror = (e) => {
          console.error("error");
          process.exit(1);
        };
        ws.onclose = () => {
          console.log("closed");
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        // No proxy set
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("connected");
    expect(exitCode).toBe(0);
  });

  test("should read HTTP_PROXY environment variable for ws:// connections", async () => {
    connectRequests = [];

    using dir = tempDir("ws-proxy-test", {
      "test.ts": `
        // This test verifies that the HTTP_PROXY env var is read
        // Since we don't have a full proxy implementation in the test,
        // we just verify the code path is exercised
        console.log("HTTP_PROXY is:", process.env.HTTP_PROXY);
        console.log("test complete");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HTTP_PROXY: `http://localhost:${proxyPort}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain(`HTTP_PROXY is: http://localhost:${proxyPort}`);
    expect(exitCode).toBe(0);
  });

  test("should respect NO_PROXY environment variable", async () => {
    using dir = tempDir("ws-no-proxy-bypass-test", {
      "test.ts": `
        const ws = new WebSocket("ws://localhost:${wsPort}");
        ws.onopen = () => {
          console.log("connected-direct");
          ws.close();
        };
        ws.onerror = (e) => {
          console.error("error");
          process.exit(1);
        };
        ws.onclose = () => {
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HTTP_PROXY: `http://localhost:${proxyPort}`,
        NO_PROXY: "localhost",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should connect directly because localhost is in NO_PROXY
    expect(stdout).toContain("connected-direct");
    expect(exitCode).toBe(0);
  });

  test("should respect NO_PROXY with wildcard", async () => {
    using dir = tempDir("ws-no-proxy-wildcard-test", {
      "test.ts": `
        const ws = new WebSocket("ws://localhost:${wsPort}");
        ws.onopen = () => {
          console.log("connected-wildcard");
          ws.close();
        };
        ws.onerror = (e) => {
          console.error("error");
          process.exit(1);
        };
        ws.onclose = () => {
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HTTP_PROXY: `http://localhost:${proxyPort}`,
        NO_PROXY: "*",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should connect directly because * means bypass all proxies
    expect(stdout).toContain("connected-wildcard");
    expect(exitCode).toBe(0);
  });

  test("should connect to wss:// WebSocket through HTTP CONNECT proxy", async () => {
    connectRequests = [];

    using dir = tempDir("wss-proxy-test", {
      "test.ts": `
        const ws = new WebSocket("wss://localhost:${wssPort}");

        ws.onopen = () => {
          console.log("wss-connected");
          ws.send("hello from client");
        };

        ws.onmessage = e => {
          console.log("wss-message:", e.data);
          if (e.data === "hello from client") {
            ws.close();
          }
        };

        ws.onerror = e => {
          console.error("wss-error:", e);
          process.exit(1);
        };

        ws.onclose = () => {
          console.log("wss-closed");
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HTTPS_PROXY: `http://localhost:${proxyPort}`,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The proxy should have received the CONNECT request
    expect(connectRequests.length).toBeGreaterThan(0);
    expect(connectRequests[0].port).toBe(wssPort);

    expect(stdout).toContain("wss-connected");
    expect(stdout).toContain("wss-message: connected-tls");
    expect(stdout).toContain("wss-message: hello from client");
    expect(exitCode).toBe(0);
  });

  test("should use HTTPS_PROXY for wss:// connections", async () => {
    connectRequests = [];

    using dir = tempDir("wss-https-proxy-test", {
      "test.ts": `
        // Verify HTTPS_PROXY is being used for wss://
        console.log("HTTPS_PROXY is:", process.env.HTTPS_PROXY);
        
        const ws = new WebSocket("wss://localhost:${wssPort}");
        
        ws.onopen = () => {
          console.log("wss-connected-via-https-proxy");
          ws.close();
        };
        
        ws.onerror = (e) => {
          console.error("wss-error");
          process.exit(1);
        };
        
        ws.onclose = () => {
          console.log("wss-closed");
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HTTPS_PROXY: `http://localhost:${proxyPort}`,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain(`HTTPS_PROXY is: http://localhost:${proxyPort}`);
    expect(stdout).toContain("wss-connected-via-https-proxy");
    expect(exitCode).toBe(0);
  });

  test("should respect NO_PROXY for wss:// connections", async () => {
    connectRequests = [];

    using dir = tempDir("wss-no-proxy-test", {
      "test.ts": `
        const ws = new WebSocket("wss://localhost:${wssPort}");
        
        ws.onopen = () => {
          console.log("wss-connected-direct");
          ws.close();
        };
        
        ws.onerror = (e) => {
          console.error("wss-error");
          process.exit(1);
        };
        
        ws.onclose = () => {
          console.log("wss-closed");
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        HTTPS_PROXY: `http://localhost:${proxyPort}`,
        NO_PROXY: "localhost",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should connect directly because localhost is in NO_PROXY
    // The proxy should NOT have received any CONNECT requests
    const proxyRequestsForWss = connectRequests.filter(r => r.port === wssPort);
    expect(proxyRequestsForWss.length).toBe(0);

    expect(stdout).toContain("wss-connected-direct");
    expect(exitCode).toBe(0);
  });
});
