// A close-delimited streamed response (HTTP/1.0 request, no framing headers)
// must not have `Content-Length: N\r\n\r\n` written into the body when the
// stream closes after raw body bytes already went out (#38675, #28019).
import { describe, expect, it } from "bun:test";
import net from "node:net";

function rawHttp10Request(port: number): Promise<Buffer> {
  const socket = net.connect(port, "127.0.0.1");
  const chunks: Buffer[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  socket.on("error", reject);
  socket.on("data", chunk => chunks.push(chunk));
  socket.on("close", () => resolve(Buffer.concat(chunks)));
  socket.write("GET / HTTP/1.0\r\n\r\n");
  return promise;
}

const BIG = 256 * 1024;

describe("close-delimited response framing", () => {
  it("stream close after flush does not append Content-Length to the body", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        let pulls = 0;
        return new Response(
          new ReadableStream({
            type: "bytes",
            pull(ctrl) {
              if (pulls++ === 0) {
                // Large enough to flush to the socket before the next pull.
                ctrl.enqueue(Buffer.alloc(BIG, "a"));
              } else {
                ctrl.close();
              }
            },
          }),
        );
      },
    });
    const raw = await rawHttp10Request(server.port);
    const headerEnd = raw.indexOf("\r\n\r\n");
    expect(headerEnd).toBeGreaterThan(0);
    const body = raw.subarray(headerEnd + 4);
    expect(body.includes("Content-Length")).toBe(false);
    expect(body.length).toBe(BIG);
  });

  it("stream close with a final chunk pending does not inject Content-Length mid-body", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        let pulls = 0;
        return new Response(
          new ReadableStream({
            type: "bytes",
            pull(ctrl) {
              if (pulls++ === 0) {
                ctrl.enqueue(Buffer.alloc(BIG, "a"));
              } else {
                ctrl.enqueue(Buffer.from("final-tail"));
                ctrl.close();
              }
            },
          }),
        );
      },
    });
    const raw = await rawHttp10Request(server.port);
    const headerEnd = raw.indexOf("\r\n\r\n");
    expect(headerEnd).toBeGreaterThan(0);
    const body = raw.subarray(headerEnd + 4);
    expect(body.includes("Content-Length")).toBe(false);
    expect(body.length).toBe(BIG + "final-tail".length);
    expect(body.subarray(BIG).toString()).toBe("final-tail");
  });
});
