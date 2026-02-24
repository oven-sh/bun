/**
 * All tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 */

import { describe, test } from "node:test";
import assert from "node:assert";
import { Agent, createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

// Helper to make a request and get the response.
// Uses a shared agent so that all requests go through the same TCP connection,
// which is critical for actually testing the keep-alive / proxy-URL bug.
function makeRequest(
  port: number,
  path: string,
  agent: Agent,
): Promise<{ statusCode: number; body: string; url: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET", agent }, res => {
      let body = "";
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode!, body, url: path });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function listenOnRandomPort(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}

describe("HTTP server with proxy-style absolute URLs", () => {
  test("sequential GET requests with absolute URL paths don't hang", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(req.url);
    });

    const port = await listenOnRandomPort(server);

    try {
      // Make 3 sequential requests with proxy-style absolute URLs
      // Before the fix, request 2 would hang because the parser entered tunnel mode
      const r1 = await makeRequest(port, "http://example.com/test1", agent);
      assert.strictEqual(r1.statusCode, 200);
      assert.ok(r1.body.includes("example.com"), `Expected body to contain "example.com", got: ${r1.body}`);
      assert.ok(r1.body.includes("/test1"), `Expected body to contain "/test1", got: ${r1.body}`);

      const r2 = await makeRequest(port, "http://example.com/test2", agent);
      assert.strictEqual(r2.statusCode, 200);
      assert.ok(r2.body.includes("example.com"), `Expected body to contain "example.com", got: ${r2.body}`);
      assert.ok(r2.body.includes("/test2"), `Expected body to contain "/test2", got: ${r2.body}`);

      const r3 = await makeRequest(port, "http://other.com/test3", agent);
      assert.strictEqual(r3.statusCode, 200);
      assert.ok(r3.body.includes("other.com"), `Expected body to contain "other.com", got: ${r3.body}`);
      assert.ok(r3.body.includes("/test3"), `Expected body to contain "/test3", got: ${r3.body}`);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("sequential POST requests with absolute URL paths don't hang", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", chunk => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`${req.method} ${req.url} body=${body}`);
      });
    });

    const port = await listenOnRandomPort(server);

    try {
      for (let i = 1; i <= 3; i++) {
        const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
          const req = httpRequest(
            {
              host: "127.0.0.1",
              port,
              path: `http://example.com/post${i}`,
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              agent,
            },
            res => {
              let body = "";
              res.on("data", chunk => {
                body += chunk;
              });
              res.on("end", () => {
                resolve({ statusCode: res.statusCode!, body });
              });
            },
          );
          req.on("error", reject);
          req.write(`data${i}`);
          req.end();
        });
        assert.strictEqual(result.statusCode, 200);
        assert.ok(result.body.includes(`/post${i}`), `Expected body to contain "/post${i}", got: ${result.body}`);
        assert.ok(result.body.includes(`body=data${i}`), `Expected body to contain "body=data${i}", got: ${result.body}`);
      }
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("mixed normal and proxy-style URLs work sequentially", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(req.url);
    });

    const port = await listenOnRandomPort(server);

    try {
      // Mix of normal and proxy-style URLs
      const r1 = await makeRequest(port, "/normal1", agent);
      assert.strictEqual(r1.statusCode, 200);
      assert.ok(r1.body.includes("/normal1"), `Expected body to contain "/normal1", got: ${r1.body}`);

      const r2 = await makeRequest(port, "http://example.com/proxy1", agent);
      assert.strictEqual(r2.statusCode, 200);
      assert.ok(r2.body.includes("example.com"), `Expected body to contain "example.com", got: ${r2.body}`);
      assert.ok(r2.body.includes("/proxy1"), `Expected body to contain "/proxy1", got: ${r2.body}`);

      const r3 = await makeRequest(port, "/normal2", agent);
      assert.strictEqual(r3.statusCode, 200);
      assert.ok(r3.body.includes("/normal2"), `Expected body to contain "/normal2", got: ${r3.body}`);

      const r4 = await makeRequest(port, "http://other.com/proxy2", agent);
      assert.strictEqual(r4.statusCode, 200);
      assert.ok(r4.body.includes("other.com"), `Expected body to contain "other.com", got: ${r4.body}`);
      assert.ok(r4.body.includes("/proxy2"), `Expected body to contain "/proxy2", got: ${r4.body}`);
    } finally {
      agent.destroy();
      server.close();
    }
  });
});
