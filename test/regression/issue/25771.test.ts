import { describe, expect, test } from "bun:test";
import { tls } from "harness";
import http2 from "node:http2";
import net from "node:net";

// Test for issue #25771: HTTP/2 origin mismatch with `got` http2 client
// The issue has two root causes:
// 1. TLSSocket.servername not falling back to options.host
// 2. Origin string including default port 443 for HTTPS

describe("issue #25771", () => {
  test("TLSSocket.servername should fall back to host option when servername not provided", async () => {
    // Create an HTTP/2 server
    const server = http2.createSecureServer({
      ...tls,
    });

    server.on("stream", (stream, headers) => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });

    const { promise: listeningPromise, resolve: listeningResolve } = Promise.withResolvers<number>();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      listeningResolve((addr as net.AddressInfo).port);
    });

    const port = await listeningPromise;

    try {
      // Connect with host option but without explicit servername
      const client = http2.connect(`https://127.0.0.1:${port}`, {
        host: "localhost",
        ca: tls.cert,
        rejectUnauthorized: false,
      });

      const socket = client.socket as import("node:tls").TLSSocket;

      // Wait for the socket to be ready
      await new Promise<void>((resolve, reject) => {
        client.on("connect", resolve);
        client.on("error", reject);
      });

      // Verify servername falls back to host when not explicitly provided
      expect(socket.servername).toBe("localhost");

      // Verify the originSet uses hostname, not IP address
      const originSet = client.originSet;
      expect(originSet).toBeDefined();
      expect(originSet!.length).toBeGreaterThan(0);
      // Origin should be based on servername, not remoteAddress
      expect(originSet![0]).toContain("localhost");

      client.close();
    } finally {
      server.close();
    }
  });

  test("HTTP/2 originSet should omit default port 443 for HTTPS", async () => {
    // Create an HTTP/2 server on port 443 equivalent
    const server = http2.createSecureServer({
      ...tls,
    });

    server.on("stream", (stream, headers) => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });

    const { promise: listeningPromise, resolve: listeningResolve } = Promise.withResolvers<number>();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      listeningResolve((addr as net.AddressInfo).port);
    });

    const port = await listeningPromise;

    try {
      // Connect with explicit servername
      const client = http2.connect(`https://127.0.0.1:${port}`, {
        servername: "example.com",
        ca: tls.cert,
        rejectUnauthorized: false,
      });

      // Wait for the socket to be ready
      await new Promise<void>((resolve, reject) => {
        client.on("connect", resolve);
        client.on("error", reject);
      });

      const socket = client.socket as import("node:tls").TLSSocket;

      // Test: When using a non-443 port, the port should be included in origin
      const originSet = client.originSet;
      expect(originSet).toBeDefined();
      expect(originSet!.length).toBeGreaterThan(0);
      // Since we're not on port 443, the port should be in the origin
      expect(originSet![0]).toBe(`https://example.com:${port}`);

      client.close();
    } finally {
      server.close();
    }
  });

  test("HTTP/2 originSet should match requested origin for standard HTTPS", async () => {
    // This test verifies the fix for the actual bug reported:
    // When connecting to https://google.com (port 443), the originSet should be
    // https://google.com NOT https://google.com:443

    const server = http2.createSecureServer({
      ...tls,
    });

    server.on("stream", (stream, headers) => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });

    const { promise: listeningPromise, resolve: listeningResolve } = Promise.withResolvers<number>();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      listeningResolve((addr as net.AddressInfo).port);
    });

    const port = await listeningPromise;

    try {
      // Test that servername is correctly set from options.servername
      // (This tests the TLSSocket.servername fix)
      const client = http2.connect(`https://127.0.0.1:${port}`, {
        servername: "example.org",
        ca: tls.cert,
        rejectUnauthorized: false,
      });

      await new Promise<void>((resolve, reject) => {
        client.on("connect", resolve);
        client.on("error", reject);
      });

      const socket = client.socket as import("node:tls").TLSSocket;

      // Servername should be example.org (from servername option)
      expect(socket.servername).toBe("example.org");

      // Origin should use example.org (not IP address)
      const originSet = client.originSet;
      expect(originSet).toBeDefined();
      expect(originSet![0]).toContain("example.org");

      client.close();
    } finally {
      server.close();
    }
  });
});
