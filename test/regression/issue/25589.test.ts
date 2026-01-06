import { describe, expect, test } from "bun:test";
import http2 from "node:http2";

describe("HTTP/2 respects server's maxFrameSize setting", () => {
  test("client respects server's large maxFrameSize when sending data", async () => {
    // Create a server that advertises a large maxFrameSize (max allowed by HTTP/2)
    const maxFrameSize = 16777215; // 2^24 - 1, the maximum allowed by HTTP/2 spec

    const {
      promise: serverPromise,
      resolve: resolveServer,
      reject: rejectServer,
    } = Promise.withResolvers<{
      receivedData: string;
      receivedLength: number;
    }>();

    const server = http2.createServer({
      settings: {
        maxFrameSize,
      },
    });

    server.on("error", rejectServer);

    server.on("stream", (stream, headers) => {
      let receivedData = "";

      stream.on("data", (chunk: Buffer) => {
        receivedData += chunk.toString();
      });

      stream.on("end", () => {
        resolveServer({
          receivedData,
          receivedLength: receivedData.length,
        });
        stream.respond({ ":status": 200 });
        stream.end("OK");
      });

      stream.on("error", rejectServer);
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const address = server.address() as { port: number };
    const port = address.port;

    try {
      // Create a client and send data larger than the default 16KB frame size
      // but smaller than the server's advertised maxFrameSize
      const largePayloadSize = 64 * 1024; // 64KB - larger than default 16KB
      const largePayload = Buffer.alloc(largePayloadSize, "A").toString();

      const client = http2.connect(`http://127.0.0.1:${port}`);

      const {
        promise: clientPromise,
        resolve: resolveClient,
        reject: rejectClient,
      } = Promise.withResolvers<{
        status: number;
        responseData: string;
      }>();

      client.on("error", rejectClient);

      // Wait for the settings to be acknowledged
      client.on("remoteSettings", () => {
        const req = client.request({
          ":method": "POST",
          ":path": "/",
        });

        req.on("error", rejectClient);

        let responseData = "";
        req.on("data", (chunk: Buffer) => {
          responseData += chunk.toString();
        });

        req.on("response", headers => {
          const status = headers[":status"] as number;
          req.on("end", () => {
            resolveClient({ status, responseData });
            client.close();
          });
        });

        // Send the large payload - this should work with the server's larger maxFrameSize
        req.end(largePayload);
      });

      const [serverResult, clientResult] = await Promise.all([serverPromise, clientPromise]);

      // Verify the server received the full payload
      expect(serverResult.receivedLength).toBe(largePayloadSize);
      expect(serverResult.receivedData).toBe(largePayload);

      // Verify the client received a successful response
      expect(clientResult.status).toBe(200);
      expect(clientResult.responseData).toBe("OK");
    } finally {
      server.close();
    }
  });

  test("client uses default frame size when server settings are not yet received", async () => {
    // This test verifies that even before receiving server settings,
    // the client can still send data (using the default frame size)
    const server = http2.createServer();

    const {
      promise: serverPromise,
      resolve: resolveServer,
      reject: rejectServer,
    } = Promise.withResolvers<{
      receivedLength: number;
    }>();

    server.on("error", rejectServer);

    server.on("stream", (stream, headers) => {
      let receivedLength = 0;

      stream.on("data", (chunk: Buffer) => {
        receivedLength += chunk.length;
      });

      stream.on("end", () => {
        resolveServer({ receivedLength });
        stream.respond({ ":status": 200 });
        stream.end("OK");
      });

      stream.on("error", rejectServer);
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const address = server.address() as { port: number };
    const port = address.port;

    try {
      // Send data that fits within default frame size
      const payloadSize = 8 * 1024; // 8KB - within default 16KB
      const payload = Buffer.alloc(payloadSize, "B").toString();

      const client = http2.connect(`http://127.0.0.1:${port}`);

      const {
        promise: clientPromise,
        resolve: resolveClient,
        reject: rejectClient,
      } = Promise.withResolvers<{
        status: number;
      }>();

      client.on("error", rejectClient);

      const req = client.request({
        ":method": "POST",
        ":path": "/",
      });

      req.on("error", rejectClient);

      req.on("response", headers => {
        const status = headers[":status"] as number;
        req.on("end", () => {
          resolveClient({ status });
          client.close();
        });
      });

      req.end(payload);

      const [serverResult, clientResult] = await Promise.all([serverPromise, clientPromise]);

      expect(serverResult.receivedLength).toBe(payloadSize);
      expect(clientResult.status).toBe(200);
    } finally {
      server.close();
    }
  });
});
