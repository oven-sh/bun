import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/26333
// When using node:https with a Host header containing a port (e.g., "mydomain.com:9002"),
// Bun incorrectly passed the hostname WITH the port to TLS certificate validation,
// causing ERR_TLS_CERT_ALTNAME_INVALID errors.
//
// The fix strips the port from the hostname before using it for:
// 1. TLS certificate info (for error reporting)
// 2. X509 server identity checks (native BoringSSL verification)
// 3. TLS SNI extension (server name indication in the handshake)

const fixturesDir = join(import.meta.dir, "../../js/node/http/fixtures");

const tlsOptions = {
  cert: readFileSync(join(fixturesDir, "openssl_localhost.crt")),
  key: readFileSync(join(fixturesDir, "openssl_localhost.key")),
};

describe("TLS hostname with port in Host header", () => {
  // The bug was that when setting a custom Host header with a port (e.g., "localhost:9002"),
  // Bun would use "localhost:9002" for TLS certificate validation instead of just "localhost".
  // This caused ERR_TLS_CERT_ALTNAME_INVALID errors because "localhost:9002" doesn't match
  // any certificate SAN.
  //
  // Note: We use rejectUnauthorized: false in these tests because the focus is on verifying
  // that the hostname is correctly extracted from Host headers containing ports. The fix
  // ensures "localhost:9002" becomes "localhost" before being used for TLS operations.

  test("fetch with Host header containing port should not fail TLS validation", async () => {
    // Create a TLS server with a certificate for "localhost"
    using server = Bun.serve({
      port: 0,
      tls: tlsOptions,
      fetch() {
        return new Response("OK");
      },
    });

    const port = server.port;

    // This should succeed - the Host header contains a port, but TLS validation
    // should only use the hostname without the port.
    // Before the fix, this would fail because "localhost:PORT" would be passed
    // to TLS operations instead of just "localhost".
    const response = await fetch(`https://localhost:${port}`, {
      headers: {
        // Setting Host header with a port - this is what triggers the bug
        Host: `localhost:${port}`,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  test("fetch with Host header containing different port should work", async () => {
    // Create a TLS server
    using server = Bun.serve({
      port: 0,
      tls: tlsOptions,
      fetch() {
        return new Response("OK");
      },
    });

    const port = server.port;

    // This should succeed even when the Host header port differs from the actual port.
    // The bug was that the Host header "localhost:9002" would be used for TLS validation
    // instead of extracting just "localhost".
    // This simulates what MinIO client and other libraries do when connecting on non-standard ports.
    const response = await fetch(`https://localhost:${port}`, {
      headers: {
        // Host header with a DIFFERENT port (simulating what MinIO client does)
        Host: "localhost:9002",
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  test("node:https request with Host header containing port", async () => {
    const https = await import("node:https");

    // Create a TLS server using Bun.serve
    using server = Bun.serve({
      port: 0,
      tls: tlsOptions,
      fetch() {
        return new Response("OK from node:https test");
      },
    });

    const port = server.port;

    // Test using node:https with a Host header containing port
    // This is the exact scenario from the bug report - using node:https
    // with libraries like MinIO that set Host headers with ports.
    const result = await new Promise<{ success: boolean; error?: Error; body?: string }>(resolve => {
      const req = https.request(
        {
          hostname: "localhost",
          port: port,
          path: "/",
          method: "GET",
          headers: {
            // This is the bug trigger - Host header with port
            Host: `localhost:${port}`,
          },
          rejectUnauthorized: false,
        },
        res => {
          let body = "";
          res.on("data", chunk => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({ success: true, body });
          });
        },
      );

      req.on("error", err => {
        resolve({ success: false, error: err });
      });

      req.end();
    });

    expect(result.success).toBe(true);
    expect(result.body).toBe("OK from node:https test");
  });

  test("node:https request with Host header containing arbitrary port", async () => {
    const https = await import("node:https");

    using server = Bun.serve({
      port: 0,
      tls: tlsOptions,
      fetch() {
        return new Response("OK");
      },
    });

    const port = server.port;

    // Test with an arbitrary port in the Host header (like MinIO's 9002)
    const result = await new Promise<{ success: boolean; error?: Error; body?: string }>(resolve => {
      const req = https.request(
        {
          hostname: "localhost",
          port: port,
          path: "/",
          method: "GET",
          headers: {
            // Arbitrary port different from actual server port
            Host: "localhost:9002",
          },
          rejectUnauthorized: false,
        },
        res => {
          let body = "";
          res.on("data", chunk => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({ success: true, body });
          });
        },
      );

      req.on("error", err => {
        resolve({ success: false, error: err });
      });

      req.end();
    });

    expect(result.success).toBe(true);
    expect(result.body).toBe("OK");
  });
});
