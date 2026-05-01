import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// This test verifies the fix for GitHub issue #21792:
// SNI TLS array handling was incorrectly rejecting arrays with exactly 1 TLS config
describe("SNI TLS array handling (issue #21792)", () => {
  // Use existing test certificates from jsonwebtoken tests
  const certDir = join(import.meta.dir, "../../js/third_party/jsonwebtoken");
  const crtA = readFileSync(join(certDir, "pub.pem"), "utf8");
  const keyA = readFileSync(join(certDir, "priv.pem"), "utf8");
  const crtB = crtA; // Reuse same cert for second test server
  const keyB = keyA;

  test("should accept empty TLS array (no TLS)", () => {
    // Empty array should be treated as no TLS
    using server = Bun.serve({
      port: 0,
      tls: [],
      fetch: () => new Response("Hello"),
      development: true,
    });
    expect(server.url.toString()).toStartWith("http://"); // HTTP, not HTTPS
  });

  test("should accept single TLS config in array", () => {
    // This was the bug: single TLS config in array was incorrectly rejected
    using server = Bun.serve({
      port: 0,
      tls: [{ cert: crtA, key: keyA, serverName: "serverA.com" }],
      fetch: () => new Response("Hello from serverA"),
      development: true,
    });
    expect(server.url.toString()).toStartWith("https://");
  });

  test("should accept multiple TLS configs for SNI", () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        { cert: crtA, key: keyA, serverName: "serverA.com" },
        { cert: crtB, key: keyB, serverName: "serverB.com" },
      ],
      fetch: request => {
        const host = request.headers.get("host") || "unknown";
        return new Response(`Hello from ${host}`);
      },
      development: true,
    });
    expect(server.url.toString()).toStartWith("https://");
  });

  test("should reject TLS array with missing serverName for SNI configs", () => {
    expect(() => {
      Bun.serve({
        port: 0,
        tls: [
          { cert: crtA, key: keyA, serverName: "serverA.com" },
          { cert: crtB, key: keyB }, // Missing serverName
        ],
        fetch: () => new Response("Hello"),
        development: true,
      });
    }).toThrow("SNI tls object must have a serverName");
  });

  test("should reject TLS array with empty serverName for SNI configs", () => {
    expect(() => {
      Bun.serve({
        port: 0,
        tls: [
          { cert: crtA, key: keyA, serverName: "serverA.com" },
          { cert: crtB, key: keyB, serverName: "" }, // Empty serverName
        ],
        fetch: () => new Response("Hello"),
        development: true,
      });
    }).toThrow("SNI tls object must have a serverName");
  });

  test("should accept single TLS config without serverName when alone", () => {
    // When there's only one TLS config in the array, serverName is optional
    using server = Bun.serve({
      port: 0,
      tls: [{ cert: crtA, key: keyA }], // No serverName - should work for single config
      fetch: () => new Response("Hello from default"),
      development: true,
    });
    expect(server.url.toString()).toStartWith("https://");
  });

  test("should support traditional non-array TLS config", () => {
    // Traditional single TLS config (not in array) should still work
    using server = Bun.serve({
      port: 0,
      tls: { cert: crtA, key: keyA },
      fetch: () => new Response("Hello traditional"),
      development: true,
    });
    expect(server.url.toString()).toStartWith("https://");
  });
});
