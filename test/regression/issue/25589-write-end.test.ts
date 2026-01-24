import { expect, test } from "bun:test";
import http2 from "node:http2";

/**
 * Regression test for https://github.com/oven-sh/bun/issues/25589
 *
 * The issue was that calling `req.write(data)` followed by `req.end()` on an HTTP/2
 * stream would send THREE DATA frames instead of TWO:
 * 1. DATA frame with the actual data (close=false)
 * 2. Empty DATA frame (close=false) - THIS WAS THE BUG
 * 3. Empty DATA frame (close=true)
 *
 * The extra empty DATA frame was caused by Http2Stream.end() creating an empty
 * buffer when called without data, which then got passed to _write() before _final().
 *
 * This caused AWS ALB and some other strict HTTP/2 servers to reject the stream
 * with NGHTTP2_FRAME_SIZE_ERROR (error code 6).
 */

// Test against AWS ALB which strictly validates HTTP/2 frames
// This test requires network access to the public test server
// Only runs when BUN_TEST_ALLOW_NET=1 is set
test.skipIf(process.env.BUN_TEST_ALLOW_NET !== "1")(
  "http2 write() + end() pattern should work with strict HTTP/2 servers (AWS ALB)",
  async () => {
    const url = "https://bun-grpc-test.jhobbs.dev:50051";

    const client = http2.connect(url, {
      rejectUnauthorized: false,
    });

    let goawayError: number | null = null;

    client.on("goaway", code => {
      goawayError = code;
    });

    try {
      const result = await new Promise<{ success: boolean; error?: string }>(resolve => {
        client.on("error", err => {
          resolve({ success: false, error: err.message });
        });

        client.on("connect", () => {
          const req = client.request({
            ":method": "POST",
            ":path": "/greeter.v1.GreeterService/SayHello",
            "content-type": "application/grpc+proto",
            "te": "trailers",
          });

          req.on("response", headers => {
            // We expect 200 from the ALB (even if gRPC service returns error, the HTTP status is 200)
            if (headers[":status"] === 200) {
              resolve({ success: true });
            }
          });

          req.on("error", err => {
            resolve({ success: false, error: err.message });
          });

          // This is the pattern that was causing FRAME_SIZE_ERROR with AWS ALB
          const message = Buffer.from([0x0a, 0x03, 0x42, 0x75, 0x6e]); // protobuf: name = "Bun"
          const frame = Buffer.alloc(5 + message.length);
          frame.writeUInt8(0, 0); // no compression
          frame.writeUInt32BE(message.length, 1);
          message.copy(frame, 5);

          req.write(frame, "binary", () => {
            req.end();
          });
        });
      });

      // Should not receive GOAWAY with FRAME_SIZE_ERROR (code 6)
      expect(goawayError).not.toBe(6);
      expect(result.success).toBe(true);
    } finally {
      client.close();
    }
  },
  { timeout: 15000 },
);

test("http2 write() + end() pattern should only send two DATA frames (local server)", async () => {
  // Create a test server that tracks received DATA frames
  const receivedDataFrames: Array<{ length: number; flags: number }> = [];

  const server = http2.createServer();

  server.on("stream", (stream, headers) => {
    stream.on("data", chunk => {
      // Track that we received data
      receivedDataFrames.push({
        length: chunk.length,
        flags: 0, // We can't easily get flags here, but we track frame count
      });
    });

    stream.on("end", () => {
      // Send response
      stream.respond({ ":status": 200 });
      stream.end("OK");
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, resolve);
  });

  const port = (server.address() as any).port;

  try {
    const client = http2.connect(`http://localhost:${port}`);

    const result = await new Promise<string>((resolve, reject) => {
      client.on("error", reject);

      const req = client.request({
        ":method": "POST",
        ":path": "/test",
      });

      req.on("response", headers => {
        expect(headers[":status"]).toBe(200);
      });

      let data = "";
      req.on("data", chunk => {
        data += chunk;
      });

      req.on("end", () => {
        resolve(data);
        client.close();
      });

      req.on("error", reject);

      // This is the pattern that was causing the bug:
      // write() followed by end() should only send 2 DATA frames
      const testData = Buffer.from("Hello, World!");
      req.write(testData, "binary", () => {
        req.end();
      });
    });

    expect(result).toBe("OK");

    // We should receive exactly one data chunk (the test data),
    // NOT two empty frames after it
    expect(receivedDataFrames.length).toBe(1);
    expect(receivedDataFrames[0].length).toBe(13); // "Hello, World!" is 13 bytes
  } finally {
    server.close();
  }
});

test("http2 end() without data should send END_STREAM with no DATA frames", async () => {
  const receivedDataFrames: Array<{ length: number }> = [];

  const server = http2.createServer();

  server.on("stream", (stream, headers) => {
    stream.on("data", chunk => {
      receivedDataFrames.push({ length: chunk.length });
    });

    stream.on("end", () => {
      stream.respond({ ":status": 200 });
      stream.end("OK");
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, resolve);
  });

  const port = (server.address() as any).port;

  try {
    const client = http2.connect(`http://localhost:${port}`);

    const result = await new Promise<string>((resolve, reject) => {
      client.on("error", reject);

      const req = client.request({
        ":method": "POST",
        ":path": "/test",
      });

      req.on("response", headers => {
        expect(headers[":status"]).toBe(200);
      });

      let data = "";
      req.on("data", chunk => {
        data += chunk;
      });

      req.on("end", () => {
        resolve(data);
        client.close();
      });

      req.on("error", reject);

      // Just call end() without any data
      req.end();
    });

    expect(result).toBe("OK");

    // Should receive no data frames (just empty END_STREAM handled by _final)
    expect(receivedDataFrames.length).toBe(0);
  } finally {
    server.close();
  }
});

test("http2 end(data) should send data with END_STREAM in one frame", async () => {
  const receivedDataFrames: Array<{ length: number }> = [];

  const server = http2.createServer();

  server.on("stream", (stream, headers) => {
    stream.on("data", chunk => {
      receivedDataFrames.push({ length: chunk.length });
    });

    stream.on("end", () => {
      stream.respond({ ":status": 200 });
      stream.end("OK");
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, resolve);
  });

  const port = (server.address() as any).port;

  try {
    const client = http2.connect(`http://localhost:${port}`);

    const result = await new Promise<string>((resolve, reject) => {
      client.on("error", reject);

      const req = client.request({
        ":method": "POST",
        ":path": "/test",
      });

      req.on("response", headers => {
        expect(headers[":status"]).toBe(200);
      });

      let data = "";
      req.on("data", chunk => {
        data += chunk;
      });

      req.on("end", () => {
        resolve(data);
        client.close();
      });

      req.on("error", reject);

      // end(data) should send data with END_STREAM
      req.end(Buffer.from("Hello!"));
    });

    expect(result).toBe("OK");

    // Should receive exactly one data frame
    expect(receivedDataFrames.length).toBe(1);
    expect(receivedDataFrames[0].length).toBe(6); // "Hello!" is 6 bytes
  } finally {
    server.close();
  }
});
