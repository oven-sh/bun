import { expect, test } from "bun:test";
import http2 from "node:http2";

// Regression test for https://github.com/oven-sh/bun/issues/26915
// setLocalWindowSize() must send a connection-level WINDOW_UPDATE frame.
// Without this, the peer's connection-level window stays at the default
// 65,535 bytes and streams stall when receiving larger payloads.

function startServer(payloadSize: number): Promise<{ port: number; server: http2.Http2Server }> {
  const payload = Buffer.alloc(payloadSize, "x");
  const { promise, resolve } = Promise.withResolvers<{ port: number; server: http2.Http2Server }>();
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end(payload);
  });
  server.listen(0, () => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      resolve({ port: addr.port, server });
    }
  });
  return promise;
}

function doRequest(client: http2.ClientHttp2Session): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const req = client.request({ ":path": "/" });
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
  req.end();
  return promise;
}

test("http2 client setLocalWindowSize sends connection-level WINDOW_UPDATE", async () => {
  const payloadSize = 256 * 1024; // 256 KB - well above the 65535 default
  const { port, server } = await startServer(payloadSize);

  try {
    const client = http2.connect(`http://localhost:${port}`, {
      settings: { initialWindowSize: 10 * 1024 * 1024 },
    });

    client.setLocalWindowSize(10 * 1024 * 1024);

    const result = await doRequest(client);
    expect(result.length).toBe(payloadSize);

    client.close();
  } finally {
    server.close();
  }
});

test("http2 client initialWindowSize setting allows large stream payloads", async () => {
  const payloadSize = 1024 * 1024; // 1 MB
  const { port, server } = await startServer(payloadSize);

  try {
    const client = http2.connect(`http://localhost:${port}`, {
      settings: { initialWindowSize: 10 * 1024 * 1024 },
    });

    const result = await doRequest(client);
    expect(result.length).toBe(payloadSize);

    client.close();
  } finally {
    server.close();
  }
});
