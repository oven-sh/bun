import { expect, test } from "bun:test";
import net from "node:net";

// Regression test for https://github.com/oven-sh/bun/issues/28019
// Bun.serve was injecting "Content-Length: <n>" into the response body
// for large streaming responses over HTTP/1.0.
test("HTTP/1.0 streaming response should not inject Content-Length into body", async () => {
  const totalChunks = 10_000;
  const chunkData = "Hello Bun!\n";

  using server = Bun.serve({
    port: 0,
    async fetch() {
      let sent = 0;
      return new Response(
        new ReadableStream({
          type: "bytes",
          pull(ctrl) {
            if (sent < totalChunks) {
              ctrl.enqueue(Buffer.from(chunkData));
              sent++;
            } else {
              ctrl.close();
            }
          },
        }),
      );
    },
  });

  const body = await new Promise<string>((resolve, reject) => {
    let data = "";
    const socket = net.connect(server.port, "localhost", () => {
      socket.write(`GET / HTTP/1.0\r\nHost: localhost\r\n\r\n`);
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      data += chunk;
    });
    socket.on("end", () => {
      // Strip HTTP headers from response
      const headerEnd = data.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        reject(new Error("No header terminator found in response"));
        return;
      }
      resolve(data.slice(headerEnd + 4));
    });
    socket.on("error", reject);
  });

  // The body should be exactly totalChunks repetitions of chunkData
  const expectedLength = totalChunks * chunkData.length;
  expect(body.length).toBe(expectedLength);

  // Verify no "Content-Length" text appears anywhere in the body
  expect(body).not.toContain("Content-Length");

  // Verify content is correct (spot-check first and last lines)
  expect(body.startsWith("Hello Bun!\n")).toBe(true);
  expect(body.endsWith("Hello Bun!\n")).toBe(true);
});
