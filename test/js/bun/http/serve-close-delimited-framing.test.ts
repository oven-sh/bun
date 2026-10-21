// A close-delimited streamed response (HTTP/1.0 request, no framing headers)
// must not have `Content-Length: N\r\n\r\n` written into the body when the
// stream closes after raw body bytes already went out (#38675, #28019).
import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import net from "node:net";

function rawHttp10Request(port: number): Promise<Buffer> {
  const socket = net.connect(port, "127.0.0.1");
  const chunks: Buffer[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  socket.on("error", reject);
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
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
    const raw = await rawHttp10Request(server.port!);
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
    const raw = await rawHttp10Request(server.port!);
    const headerEnd = raw.indexOf("\r\n\r\n");
    expect(headerEnd).toBeGreaterThan(0);
    const body = raw.subarray(headerEnd + 4);
    expect(body.includes("Content-Length")).toBe(false);
    expect(body.length).toBe(BIG + "final-tail".length);
    expect(body.subarray(BIG).toString()).toBe("final-tail");
  });
});

// Bun.serve stops the reads of a connection when 1 MiB of a request body waits unread, so what
// the client sends behind that stays in the kernel. The kernel turns a close over unread input
// into a reset, and a reset throws away the output that the kernel has not sent yet. usockets
// drops that input where it closes a socket behind its own FIN, so the response arrives whole.
describe("a response that closes the connection", () => {
  it("arrives whole when the handler did not read the upload", async () => {
    const parked = 1024 * 1024;
    const late = Buffer.alloc(8 * 1024, "l");
    const body = Buffer.alloc(4 * 1024 * 1024, "r");
    const respond = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch() {
        await respond.promise;
        return new Response(body, { headers: { Connection: "close" } });
      },
    });

    const client = net.connect(server.port!, "127.0.0.1");
    client.pause();
    const chunks: Buffer[] = [];
    let end = "none";
    const closed = Promise.withResolvers<void>();
    client.on("error", (err: NodeJS.ErrnoException) => (end = err.code!));
    client.on("end", () => (end = "end"));
    client.on("close", () => closed.resolve());
    client.on("data", (chunk: Buffer) => {
      // One chunk for each turn of the event loop, so that a reset cuts the response short.
      client.pause();
      setImmediate(() => client.resume());
      chunks.push(chunk);
    });
    await once(client, "connect");

    const write = (data: string | Buffer) => new Promise(resolve => client.write(data, resolve));
    await write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${parked + late.length}\r\n\r\n`);
    await write(Buffer.alloc(parked, "u"));
    // The server reads what its kernel holds once for each turn of the event loop, and stops the
    // reads when it has this part of the body. That takes fewer turns than these.
    for (let i = 0; i < 32; i++) await new Promise(resolve => setImmediate(resolve));
    // The reads are stopped: this stays in the kernel of the server.
    await write(late);
    // The loopback delivers in order: the kernel of the server has those bytes before it accepts this connection.
    const barrier = net.connect(server.port!, "127.0.0.1");
    await once(barrier, "connect");
    barrier.destroy();
    respond.resolve();
    client.resume();
    await closed.promise;

    const response = Buffer.concat(chunks);
    const headEnd = response.indexOf("\r\n\r\n");
    expect({ body: headEnd === -1 ? -1 : response.length - (headEnd + 4), end }).toEqual({
      body: body.length,
      end: "end",
    });
  });
});
