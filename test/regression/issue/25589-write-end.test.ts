import { expect, test } from "bun:test";
import http2 from "node:http2";

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
