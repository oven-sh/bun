import { spawn, type ChildProcess } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

describe("SOCKS proxy", () => {
  let mockSocksServer: ChildProcess;
  let socksPort: number;
  let httpPort: number;

  beforeAll(async () => {
    // Find available ports
    socksPort = 9050 + Math.floor(Math.random() * 1000);
    httpPort = 8080 + Math.floor(Math.random() * 1000);

    // Start a mock SOCKS5 server for testing
    mockSocksServer = spawn({
      cmd: [
        "node",
        "-e",
        `
        const net = require('net');
        const server = net.createServer((socket) => {
          console.log('SOCKS connection received');
          
          socket.on('data', (data) => {
            console.log('SOCKS data:', data.toString('hex'));
            
            // Handle SOCKS5 auth handshake
            if (data.length === 3 && data[0] === 0x05) {
              // Send "no auth required" response
              socket.write(Buffer.from([0x05, 0x00]));
              return;
            }
            
            // Handle SOCKS5 connect request
            if (data.length >= 4 && data[0] === 0x05 && data[1] === 0x01) {
              // Send success response with dummy bind address
              const response = Buffer.from([
                0x05, 0x00, 0x00, 0x01, // VER, REP, RSV, ATYP
                127, 0, 0, 1,            // Bind IP (127.0.0.1)
                0x1F, 0x90               // Bind port (8080)
              ]);
              socket.write(response);
              
              // Now proxy data to the target HTTP server
              const targetSocket = net.connect(${httpPort}, '127.0.0.1');
              socket.pipe(targetSocket);
              targetSocket.pipe(socket);
              return;
            }
          });
          
          socket.on('error', console.error);
        });
        
        server.listen(${socksPort}, () => {
          console.log('Mock SOCKS server listening on port ${socksPort}');
        });
      `,
      ],
      stdout: "inherit",
      stderr: "inherit",
    });

    // Start a simple HTTP server for testing
    using httpServer = Bun.serve({
      port: httpPort,
      fetch(req) {
        if (req.url.endsWith("/test")) {
          return new Response("Hello from HTTP server");
        }
        return new Response("Not found", { status: 404 });
      },
    });

    // Wait a bit for servers to start
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(() => {
    if (mockSocksServer) {
      mockSocksServer.kill();
    }
  });

  test("should connect through SOCKS5 proxy", async () => {
    const response = await fetch(`http://127.0.0.1:${httpPort}/test`, {
      // @ts-ignore - This might not be typed yet
      proxy: `socks5://127.0.0.1:${socksPort}`,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello from HTTP server");
  });

  test("should connect through SOCKS5h proxy", async () => {
    const response = await fetch(`http://localhost:${httpPort}/test`, {
      // @ts-ignore - This might not be typed yet
      proxy: `socks5h://127.0.0.1:${socksPort}`,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello from HTTP server");
  });

  test("should handle SOCKS proxy via environment variable", async () => {
    const originalProxy = process.env.http_proxy;

    try {
      process.env.http_proxy = `socks5://127.0.0.1:${socksPort}`;

      const response = await fetch(`http://127.0.0.1:${httpPort}/test`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Hello from HTTP server");
    } finally {
      if (originalProxy !== undefined) {
        process.env.http_proxy = originalProxy;
      } else {
        delete process.env.http_proxy;
      }
    }
  });

  test("should handle SOCKS proxy connection failure", async () => {
    const invalidPort = 65000;

    const promise = fetch(`http://127.0.0.1:${httpPort}/test`, {
      // @ts-ignore
      proxy: `socks5://127.0.0.1:${invalidPort}`,
    });

    await expect(promise).rejects.toThrow();
  });
});
