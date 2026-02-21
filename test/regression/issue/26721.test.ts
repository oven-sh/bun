/**
 * Regression test for issue #26721
 *
 * HTTP/1.1 fallback is broken for `node:http2` secure server when
 * `allowHTTP1: true` is passed. The server only advertises `h2` in ALPN
 * negotiation, causing HTTP/1.1-only clients to fail.
 *
 * @see https://github.com/oven-sh/bun/issues/26721
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import { join } from "node:path";

// TLS certificates for testing
const fixturesDir = join(import.meta.dirname, "..", "fixtures");
const tlsOptions = {
  cert: readFileSync(join(fixturesDir, "cert.pem")),
  key: readFileSync(join(fixturesDir, "cert.key")),
};

interface TestContext {
  server: http2.Http2SecureServer;
  serverPort: number;
  serverUrl: string;
}

describe("HTTP/2 allowHTTP1 option", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    const server = http2.createSecureServer({
      ...tlsOptions,
      allowHTTP1: true,
    });

    // Handle HTTP/2 streams
    server.on("stream", (stream, headers) => {
      stream.respond({
        ":status": 200,
        "content-type": "text/plain",
        "x-protocol": "h2",
      });
      stream.end("ok h2\n");
    });

    // Handle HTTP/1.1 requests (via allowHTTP1 fallback)
    // Note: HTTP/2 compatibility also emits 'request' events, but those requests
    // will have already been handled by the 'stream' handler. We check if headers
    // have been sent to avoid double-responding.
    server.on("request", (req, res) => {
      // Skip if this is from HTTP/2 compat (headers already sent by stream handler)
      if (res.headersSent) return;
      res.writeHead(200, {
        "content-type": "text/plain",
        "x-protocol": "http1",
      });
      res.end("ok http1\n");
    });

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<number>();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        listenReject(new Error("Failed to get server address"));
        return;
      }
      listenResolve(address.port);
    });
    server.once("error", listenReject);
    const serverPort = await listenPromise;

    ctx = {
      server,
      serverPort,
      serverUrl: `https://127.0.0.1:${serverPort}`,
    };
  });

  afterAll(async () => {
    if (ctx?.server) {
      // Close all active connections first to ensure server.close() completes
      if (typeof ctx.server.closeAllConnections === "function") {
        ctx.server.closeAllConnections();
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      ctx.server.close(() => resolve());
      await promise;
    }
  });

  test("HTTP/2 client can connect and make request", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    const response = await new Promise<{ status: number; body: string; protocol: string }>((resolve, reject) => {
      const req = client.request({ ":path": "/" });

      let body = "";
      let protocol = "";

      req.on("response", headers => {
        protocol = headers["x-protocol"] as string;
      });

      req.on("data", chunk => {
        body += chunk;
      });

      req.on("end", () => {
        resolve({ status: 200, body, protocol });
      });

      req.on("error", reject);
      req.end();
    });

    expect(response.body).toBe("ok h2\n");
    expect(response.protocol).toBe("h2");

    const { promise: closePromise, resolve: closeResolve } = Promise.withResolvers<void>();
    client.close(closeResolve);
    await closePromise;
  });

  test("HTTP/1.1 client can connect when allowHTTP1 is true (issue #26721)", async () => {
    // This test verifies that HTTP/1.1 clients can connect to an HTTP/2 server
    // with allowHTTP1: true. Before the fix, this would fail with:
    // "tlsv1 alert no application protocol" because the server only
    // advertised "h2" in ALPN, not "http/1.1".

    const response = await new Promise<{ statusCode: number; body: string; protocol: string }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "127.0.0.1",
          port: ctx.serverPort,
          path: "/",
          method: "GET",
          rejectUnauthorized: false,
          headers: {
            Connection: "close", // Ensure connection is closed after request
          },
          // Force HTTP/1.1 by not specifying ALPNProtocols or by using https module
        },
        res => {
          let body = "";
          res.on("data", chunk => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode!,
              body,
              protocol: res.headers["x-protocol"] as string,
            });
          });
        },
      );

      req.on("error", reject);
      req.end();
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("ok http1\n");
    expect(response.protocol).toBe("http1");
  });

  test("HTTP/1.1 POST request works with allowHTTP1", async () => {
    const postData = JSON.stringify({ message: "hello" });

    // Use the shared server from ctx
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "127.0.0.1",
          port: ctx.serverPort,
          path: "/post",
          method: "POST",
          rejectUnauthorized: false,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
            Connection: "close", // Ensure connection is closed after request
          },
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
      req.write(postData);
      req.end();
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("ok http1\n");
  });
});

describe("HTTP/2 without allowHTTP1", () => {
  test("HTTP/1.1 client gets rejected when allowHTTP1 is false", async () => {
    const server = http2.createSecureServer({
      ...tlsOptions,
      allowHTTP1: false,
    });

    server.on("stream", (stream, _headers) => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });

    const { promise: listenPromise, resolve: listenResolve, reject: listenReject } = Promise.withResolvers<number>();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        listenReject(new Error("Failed to get server address"));
        return;
      }
      listenResolve(address.port);
    });
    server.once("error", listenReject);
    const port = await listenPromise;

    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/",
            method: "GET",
            rejectUnauthorized: false,
          },
          () => {
            reject(new Error("Expected connection to fail"));
          },
        );

        req.on("error", err => {
          // We expect an ALPN negotiation error or similar
          // Note: Bun's https client may report different error messages
          expect(err.message).toMatch(/no application protocol|ECONNRESET|ECONNREFUSED|socket hang up/i);
          resolve();
        });

        req.end();
      });
    } finally {
      // Force close all connections and the server
      // Use a short timeout to ensure this doesn't hang the test
      await Promise.race([
        new Promise<void>(resolve => server.close(() => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 500)),
      ]);
    }
  });
});
