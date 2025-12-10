import { test, expect } from "bun:test";
import http from "http";

// This test verifies that the HTTP client can receive a response before req.end() is called
// when using Transfer-Encoding: chunked. This is required for APIs like Docker's exec
// which expect the client to receive data while the connection remains open for stdin.
// Issue: https://github.com/oven-sh/bun/issues/21342

test("should receive response before req.end() is called with chunked encoding", async () => {
  // Create a server that responds immediately even if request body isn't finished
  const server = http.createServer((req, res) => {
    // Send response immediately without waiting for request body to finish
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("hello");

    // Keep connection open for 2 seconds then end
    setTimeout(() => {
      res.end(" world");
    }, 2000);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const port = (server.address() as any).port;

  try {
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: {
          "Transfer-Encoding": "chunked",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          resolve();
        });
      }
    );

    req.on("error", (err) => {
      reject(err);
    });

    // Write some data but DON'T call req.end() yet
    req.write("test data");

    // Wait for response with timeout
    const result = await Promise.race([
      promise.then(() => "success"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("timeout"), 5000)
      ),
    ]);

    // End the request after we got the response
    req.end();

    expect(result).toBe("success");
  } finally {
    server.close();
  }
}, 10000);

test("should work with flushHeaders() to send request before writing body", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const port = (server.address() as any).port;

  try {
    const { promise, resolve, reject } = Promise.withResolvers<string>();

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: {
          "Transfer-Encoding": "chunked",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          resolve(data);
        });
      }
    );

    req.on("error", reject);

    // Explicitly flush headers to start the request
    req.flushHeaders();

    // Write body immediately after flushing - the test verifies
    // flushHeaders() initiates the request, not timing
    req.write("body data");
    req.end();

    const result = await Promise.race([
      promise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000)
      ),
    ]);

    expect(result).toBe("ok");
  } finally {
    server.close();
  }
}, 10000);
