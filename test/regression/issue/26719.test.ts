import { expect, test } from "bun:test";
import { tls } from "harness";
import http2 from "node:http2";

// Test that HTTP/2 GOAWAY allows in-flight requests to complete per RFC 7540 Section 6.8
test("ClientHttp2Session GOAWAY allows in-flight requests to complete", async () => {
  const server = http2.createSecureServer({
    key: tls.key,
    cert: tls.cert,
  });

  const { resolve, reject, promise } = Promise.withResolvers<void>();

  // Promise that resolves when client receives GOAWAY
  const clientGotGoaway = Promise.withResolvers<void>();

  server.on("stream", async (stream, headers) => {
    // Send GOAWAY immediately when stream is received
    const session = stream.session;
    if (session && !session.destroyed) {
      // NO_ERROR (0), lastStreamId=1 (the client's first stream)
      session.goaway(0, 1);
    }

    // Wait for the client to receive GOAWAY before responding
    await clientGotGoaway.promise;
    stream.respond({ ":status": 200 });
    stream.end("OK");
  });

  server.listen(0, () => {
    const port = (server.address() as any).port;

    const client = http2.connect(`https://localhost:${port}`, {
      rejectUnauthorized: false,
    });

    let gotResponse = false;
    let gotError = false;
    let responseStatus: number | undefined;
    let responseData = "";

    client.on("goaway", (errorCode, lastStreamId) => {
      // Verify GOAWAY was received
      expect(errorCode).toBe(0);
      expect(lastStreamId).toBe(1);
      // Signal that GOAWAY was received so the server can respond
      clientGotGoaway.resolve();
    });

    const req = client.request({ ":path": "/" });

    req.on("response", headers => {
      gotResponse = true;
      responseStatus = headers[":status"] as number;
    });

    req.on("data", (chunk: Buffer) => {
      responseData += chunk.toString();
    });

    req.on("error", err => {
      gotError = true;
      reject(err);
    });

    req.on("close", () => {
      client.close();
      server.close();

      // The request should complete successfully despite GOAWAY
      if (gotResponse && responseStatus === 200) {
        expect(responseData).toBe("OK");
        resolve();
      } else if (gotError) {
        reject(new Error("Request failed with error"));
      } else {
        reject(new Error("BUG: Stream closed without response or error"));
      }
    });

    req.end();
  });

  await promise;
});

// Test that GOAWAY with error code emits errors to streams before closing
test("ClientHttp2Session GOAWAY with error code emits error to streams", async () => {
  const server = http2.createSecureServer({
    key: tls.key,
    cert: tls.cert,
  });

  const { resolve, reject, promise } = Promise.withResolvers<void>();

  server.on("stream", (stream, headers) => {
    // Send GOAWAY with error immediately without responding
    // This should trigger error on the client stream
    const session = stream.session;
    if (session && !session.destroyed) {
      session.goaway(http2.constants.NGHTTP2_INTERNAL_ERROR, 1);
    }
  });

  server.listen(0, () => {
    const port = (server.address() as any).port;

    const client = http2.connect(`https://localhost:${port}`, {
      rejectUnauthorized: false,
    });

    let gotError = false;

    client.on("goaway", (errorCode, lastStreamId) => {
      expect(errorCode).toBe(http2.constants.NGHTTP2_INTERNAL_ERROR);
    });

    const req = client.request({ ":path": "/" });

    req.on("error", err => {
      gotError = true;
    });

    req.on("close", () => {
      client.close();
      server.close();
      // With non-zero error code, stream should receive error
      if (gotError) {
        resolve();
      } else {
        reject(new Error("Expected error event for GOAWAY with non-zero error code"));
      }
    });

    req.end();
  });

  await promise;
});
