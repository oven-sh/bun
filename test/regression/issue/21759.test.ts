import { describe, expect, test } from "bun:test";
import { tls } from "harness";
import http2 from "node:http2";

const TLS_OPTIONS = { ca: tls.cert };

// Issue #21759: HTTP/2 server sends multiple consecutive empty DATA frames
// This test verifies that when a server responds without trailers, it doesn't
// send multiple empty DATA frames, which can cause issues with proxies like Envoy.

describe("HTTP/2 empty DATA frames", () => {
  test("server should not send multiple empty DATA frames when ending stream", async () => {
    const {
      promise: serverReady,
      resolve: resolveServerReady,
      reject: rejectServerReady,
    } = Promise.withResolvers<{
      server: http2.Http2SecureServer;
      port: number;
    }>();
    const {
      promise: requestDone,
      resolve: resolveRequestDone,
      reject: rejectRequestDone,
    } = Promise.withResolvers<void>();

    // Track DATA frames received by the client
    const dataFrames: Buffer[] = [];

    const server = http2.createSecureServer({
      ...tls,
    });

    server.on("error", err => {
      rejectServerReady(err);
      rejectRequestDone(err);
    });

    server.on("stream", (stream, headers) => {
      // Respond without trailers - this should NOT result in multiple empty DATA frames
      stream.respond({
        ":status": 200,
        "content-type": "text/plain",
      });
      // Write some data and end the stream
      stream.end("Hello, World!");
    });

    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolveServerReady({ server, port: address.port });
      } else {
        rejectServerReady(new Error("Failed to get server address"));
      }
    });

    const { port } = await serverReady;

    const client = http2.connect(`https://localhost:${port}`, TLS_OPTIONS);
    client.on("error", rejectRequestDone);

    const req = client.request({ ":path": "/" });

    req.on("response", headers => {
      expect(headers[":status"]).toBe(200);
    });

    req.on("data", chunk => {
      dataFrames.push(chunk);
    });

    req.on("end", () => {
      client.close();
      resolveRequestDone();
    });

    req.on("error", rejectRequestDone);

    req.end();

    await requestDone;
    server.close();

    // Verify we received the expected data
    const receivedData = Buffer.concat(dataFrames).toString();
    expect(receivedData).toBe("Hello, World!");
  });

  test("server using Http2ServerResponse should not send multiple empty DATA frames", async () => {
    const {
      promise: serverReady,
      resolve: resolveServerReady,
      reject: rejectServerReady,
    } = Promise.withResolvers<{
      server: http2.Http2SecureServer;
      port: number;
    }>();
    const {
      promise: requestDone,
      resolve: resolveRequestDone,
      reject: rejectRequestDone,
    } = Promise.withResolvers<void>();

    const server = http2.createSecureServer({
      ...tls,
    });

    server.on("error", err => {
      rejectServerReady(err);
      rejectRequestDone(err);
    });

    // Use the request/response API (which has waitForTrailers: true by default)
    server.on("request", (req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Hello from response API!");
    });

    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolveServerReady({ server, port: address.port });
      } else {
        rejectServerReady(new Error("Failed to get server address"));
      }
    });

    const { port } = await serverReady;

    const client = http2.connect(`https://localhost:${port}`, TLS_OPTIONS);
    client.on("error", rejectRequestDone);

    const req = client.request({ ":path": "/" });

    const dataChunks: Buffer[] = [];

    req.on("response", headers => {
      expect(headers[":status"]).toBe(200);
    });

    req.on("data", chunk => {
      dataChunks.push(chunk);
    });

    req.on("end", () => {
      client.close();
      resolveRequestDone();
    });

    req.on("error", rejectRequestDone);

    req.end();

    await requestDone;
    server.close();

    const receivedData = Buffer.concat(dataChunks).toString();
    expect(receivedData).toBe("Hello from response API!");
  });

  test("server ending stream without data should send proper END_STREAM", async () => {
    const {
      promise: serverReady,
      resolve: resolveServerReady,
      reject: rejectServerReady,
    } = Promise.withResolvers<{
      server: http2.Http2SecureServer;
      port: number;
    }>();
    const {
      promise: requestDone,
      resolve: resolveRequestDone,
      reject: rejectRequestDone,
    } = Promise.withResolvers<void>();

    const server = http2.createSecureServer({
      ...tls,
    });

    server.on("error", err => {
      rejectServerReady(err);
      rejectRequestDone(err);
    });

    server.on("stream", stream => {
      // Respond and immediately end without any body
      stream.respond({
        ":status": 204,
      });
      stream.end();
    });

    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolveServerReady({ server, port: address.port });
      } else {
        rejectServerReady(new Error("Failed to get server address"));
      }
    });

    const { port } = await serverReady;

    const client = http2.connect(`https://localhost:${port}`, TLS_OPTIONS);
    client.on("error", rejectRequestDone);

    const req = client.request({ ":path": "/" });

    req.on("response", headers => {
      expect(headers[":status"]).toBe(204);
    });

    const dataChunks: Buffer[] = [];
    req.on("data", chunk => {
      dataChunks.push(chunk);
    });

    req.on("end", () => {
      client.close();
      resolveRequestDone();
    });

    req.on("error", rejectRequestDone);

    req.end();

    await requestDone;
    server.close();

    // No data should be received for 204 response
    expect(dataChunks.length).toBe(0);
  });
});
