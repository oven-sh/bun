import { expect, test } from "bun:test";
import { createConnection, createServer } from "node:net";

test("client socket can write Uint8Array (issue #22481)", async () => {
  const server = createServer(socket => {
    socket.on("data", data => {
      // Echo back what we received
      socket.write(data);
      socket.end();
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as any).port;

  const testData = "Hello from Uint8Array!";
  const u8 = new Uint8Array(testData.split("").map(x => x.charCodeAt(0)));

  // Test with Uint8Array
  {
    const received = await new Promise<string>((resolve, reject) => {
      const client = createConnection(port, "127.0.0.1", () => {
        // Write Uint8Array directly
        client.write(u8, err => {
          if (err) reject(err);
        });
      });

      let data = "";
      client.on("data", chunk => {
        data += chunk.toString();
      });

      client.on("end", () => {
        resolve(data);
      });

      client.on("error", reject);
    });

    expect(received).toBe(testData);
  }

  // Test with Buffer.from(Uint8Array) for comparison
  {
    const received = await new Promise<string>((resolve, reject) => {
      const client = createConnection(port, "127.0.0.1", () => {
        // Write Buffer created from Uint8Array
        client.write(Buffer.from(u8), err => {
          if (err) reject(err);
        });
      });

      let data = "";
      client.on("data", chunk => {
        data += chunk.toString();
      });

      client.on("end", () => {
        resolve(data);
      });

      client.on("error", reject);
    });

    expect(received).toBe(testData);
  }

  // Test with other TypedArrays (Float32Array view)
  {
    const float32 = new Float32Array([1.5, 2.5]);
    const u8view = new Uint8Array(float32.buffer);

    const received = await new Promise<Buffer>((resolve, reject) => {
      const client = createConnection(port, "127.0.0.1", () => {
        client.write(u8view, err => {
          if (err) reject(err);
        });
      });

      const chunks: Buffer[] = [];
      client.on("data", chunk => {
        chunks.push(chunk);
      });

      client.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      client.on("error", reject);
    });

    // Check that we received the same bytes back
    expect(received).toEqual(Buffer.from(u8view));
  }

  server.close();
});
