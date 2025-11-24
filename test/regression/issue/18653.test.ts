import { describe, expect, test } from "bun:test";
import { createServer, request } from "http";
import { isWindows, tmpdirSync } from "harness";
import { join } from "path";
import { rmSync } from "fs";

/**
 * Regression test for issue #18653: http.request with socketPath connects to localhost on Windows
 *
 * Issue: When using http.request with a socketPath option (for Unix domain sockets / named pipes),
 * Bun incorrectly connects to localhost instead of the socket path because the DNS lookup
 * path was taken even when socketPath was provided.
 *
 * The fix ensures that when socketPath is specified, DNS lookup is bypassed and the connection
 * goes directly to the Unix domain socket.
 *
 * Note: Windows named pipes (\\.\pipe\name) are not yet supported by Bun's HTTP client.
 * This test only covers Unix domain sockets which work on non-Windows platforms.
 */
describe("http.request with socketPath (#18653)", () => {
  // Unix socket tests (non-Windows)
  test.skipIf(isWindows)("should connect via Unix socket with socketPath option", async () => {
    const tmpDir = tmpdirSync();
    const socketPath = join(tmpDir, `bun-test-${Math.random().toString(36).slice(2)}.sock`);

    // Create a server listening on the Unix socket
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`path:${req.url}`);
    });

    const { promise: serverReady, resolve: serverReadyResolve } = Promise.withResolvers<void>();
    server.listen(socketPath, () => {
      serverReadyResolve();
    });

    await serverReady;

    try {
      // Make a request using socketPath
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = request(
        {
          socketPath,
          path: "/test-path",
          method: "GET",
        },
        res => {
          let data = "";
          res.on("data", chunk => {
            data += chunk;
          });
          res.on("end", () => {
            resolve(data);
          });
          res.on("error", reject);
        }
      );

      req.on("error", reject);
      req.end();

      const response = await promise;
      expect(response).toBe("path:/test-path");
    } finally {
      server.close();
      try {
        rmSync(socketPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test.skipIf(isWindows)("should correctly pass socketPath to fetch via unix option", async () => {
    const tmpDir = tmpdirSync();
    const socketPath = join(tmpDir, `bun-test-${Math.random().toString(36).slice(2)}.sock`);

    // Create a Bun server listening on the Unix socket
    const server = Bun.serve({
      unix: socketPath,
      fetch(req) {
        return new Response(`path:${new URL(req.url).pathname}`);
      },
    });

    try {
      // Make a request using node:http with socketPath
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = request(
        {
          socketPath,
          path: "/another-path",
          method: "GET",
        },
        res => {
          let data = "";
          res.on("data", chunk => {
            data += chunk;
          });
          res.on("end", () => {
            resolve(data);
          });
          res.on("error", reject);
        }
      );

      req.on("error", reject);
      req.end();

      const response = await promise;
      expect(response).toBe("path:/another-path");
    } finally {
      server.stop(true);
      try {
        rmSync(socketPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test.skipIf(isWindows)("should work with POST requests via socketPath", async () => {
    const tmpDir = tmpdirSync();
    const socketPath = join(tmpDir, `bun-test-${Math.random().toString(36).slice(2)}.sock`);

    // Create a Bun server listening on the Unix socket
    const server = Bun.serve({
      unix: socketPath,
      async fetch(req) {
        const body = await req.text();
        return new Response(`received:${body}`);
      },
    });

    try {
      // Make a POST request using node:http with socketPath
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const req = request(
        {
          socketPath,
          path: "/post-test",
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
          },
        },
        res => {
          let data = "";
          res.on("data", chunk => {
            data += chunk;
          });
          res.on("end", () => {
            resolve(data);
          });
          res.on("error", reject);
        }
      );

      req.on("error", reject);
      req.write("hello world");
      req.end();

      const response = await promise;
      expect(response).toBe("received:hello world");
    } finally {
      server.stop(true);
      try {
        rmSync(socketPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
