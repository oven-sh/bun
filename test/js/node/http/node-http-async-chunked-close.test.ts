import { test, expect } from "bun:test";
import * as http from "node:http";
import * as net from "node:net";

test("http.Server closes connection after async chunked response with Connection: close", async () => {
  // Server that responds asynchronously with chunked encoding
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("chunk1");
      res.write("chunk2");
      res.write("chunk3");
      res.end();
    }, 10);
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const result = await new Promise<{ pass: boolean; body: string }>(resolve => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        socket.write("GET / HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n");
      });

      const chunks: Buffer[] = [];
      socket.on("data", c => chunks.push(c));
      socket.on("error", err => {
        resolve({ pass: false, body: `Connection error: ${err.message}` });
        socket.destroy();
      });
      socket.on("end", () => {
        resolve({ pass: true, body: Buffer.concat(chunks).toString() });
      });
      socket.setTimeout(3000, () => {
        resolve({ pass: false, body: Buffer.concat(chunks).toString() });
        socket.destroy();
      });
    });

    expect(result.body).toContain("chunk1");
    expect(result.body).toContain("chunk2");
    expect(result.body).toContain("chunk3");
    expect(result.pass).toBe(true);
  } finally {
    server.close();
  }
});
