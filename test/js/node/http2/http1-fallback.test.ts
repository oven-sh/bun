import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import http2 from "node:http2";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";

let tempDir: string;
let KEY: Buffer;
let CERT: Buffer;

beforeAll(() => {
  // Dynamically generate a valid RSA key and self-signed certificate
  // so BoringSSL doesn't reject the server creation.
  tempDir = mkdtempSync(join(tmpdir(), "bun-http2-test-"));
  const keyPath = join(tempDir, "key.pem");
  const certPath = join(tempDir, "cert.pem");

  const result = spawnSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ]);

  if (result.status !== 0) {
    throw new Error(`Failed to generate test certificates: ${result.stderr.toString()}`);
  }

  KEY = readFileSync(keyPath);
  CERT = readFileSync(certPath);
});

afterAll(() => {
  // Clean up the temporary certificates
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("http2.createSecureServer", () => {
  test("allowHTTP1: true falls back to HTTP/1.1 correctly", async () => {
    const server = http2.createSecureServer({
      allowHTTP1: true,
      key: KEY,
      cert: CERT,
    });

    await new Promise<void>((resolve, reject) => {
      // 1. Verify the server emits the standard 'request' event
      server.on("request", (req, res) => {
        try {
          expect(req.httpVersionMajor).toBe(1);
          expect(req.httpVersionMinor).toBe(1);
          expect(req.method).toBe("GET");
          expect(req.url).toBe("/fallback-test");

          res.writeHead(200, { "X-Custom-Header": "bun-test" });
          res.end("HTTP/1.1 fallback successful");
        } catch (e) {
          reject(e);
        }
      });

      // 2. Bind to an ephemeral port explicitly on IPv4
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as any).port;

        // 3. Make an HTTPS request forcing HTTP/1.1 via ALPN
        const req = https.request(
          {
            hostname: "127.0.0.1",
            port: port,
            path: "/fallback-test",
            method: "GET",
            rejectUnauthorized: false, // Bypass self-signed cert warning
            ALPNProtocols: ["http/1.1"], // Explicitly demand HTTP/1.1
          },
          res => {
            try {
              expect(res.statusCode).toBe(200);
              expect(res.headers["x-custom-header"]).toBe("bun-test");

              let data = "";
              res.on("data", chunk => {
                data += chunk;
              });

              res.on("end", () => {
                expect(data).toBe("HTTP/1.1 fallback successful");
                server.close(() => resolve());
              });
            } catch (e) {
              reject(e);
            }
          },
        );

        req.on("error", err => {
          server.close();
          reject(err);
        });

        req.end();
      });
    });
  });
});
