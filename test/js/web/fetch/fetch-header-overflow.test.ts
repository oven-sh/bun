import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:net";

describe("fetch with many headers", () => {
  test("should not crash or corrupt memory with more than 256 headers", async () => {
    // Use a raw TCP server to avoid uws header count limits on the server side.
    // We just need to verify that the client sends the request without crashing.
    await using server = createServer(socket => {
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        // Wait for the end of HTTP headers (double CRLF)
        if (data.includes("\r\n\r\n")) {
          // Count headers (lines between the request line and the blank line)
          const headerSection = data.split("\r\n\r\n")[0];
          const lines = headerSection.split("\r\n");
          // First line is the request line (GET / HTTP/1.1), rest are headers
          const headerCount = lines.length - 1;

          const body = String(headerCount);
          const response = ["HTTP/1.1 200 OK", `Content-Length: ${body.length}`, "Connection: close", "", body].join(
            "\r\n",
          );

          socket.write(response);
          socket.end();
        }
      });
    }).listen(0);
    await once(server, "listening");

    const port = (server.address() as any).port;

    // Build 300 unique custom headers (exceeds the 256-entry static buffer)
    const headers = new Headers();
    const headerCount = 300;
    for (let i = 0; i < headerCount; i++) {
      headers.set(`x-custom-${i}`, `value-${i}`);
    }

    const res = await fetch(`http://localhost:${port}/`, { headers });
    const receivedCount = parseInt(await res.text(), 10);

    expect(res.status).toBe(200);
    // The server should receive our custom headers plus default ones
    // (host, connection, user-agent, accept, accept-encoding = 5 extra)
    expect(receivedCount).toBeGreaterThanOrEqual(headerCount);
  });

  test("should handle exactly 256 user headers without issues", async () => {
    await using server = createServer(socket => {
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\r\n\r\n")) {
          const headerSection = data.split("\r\n\r\n")[0];
          const lines = headerSection.split("\r\n");
          const headerCount = lines.length - 1;

          const body = String(headerCount);
          const response = ["HTTP/1.1 200 OK", `Content-Length: ${body.length}`, "Connection: close", "", body].join(
            "\r\n",
          );

          socket.write(response);
          socket.end();
        }
      });
    }).listen(0);
    await once(server, "listening");

    const port = (server.address() as any).port;

    const headers = new Headers();
    const headerCount = 256;
    for (let i = 0; i < headerCount; i++) {
      headers.set(`x-custom-${i}`, `value-${i}`);
    }

    const res = await fetch(`http://localhost:${port}/`, { headers });
    const receivedCount = parseInt(await res.text(), 10);

    expect(res.status).toBe(200);
    expect(receivedCount).toBeGreaterThanOrEqual(headerCount);
  });
});
