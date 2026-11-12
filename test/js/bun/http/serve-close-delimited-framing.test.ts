// A close-delimited streamed response (HTTP/1.0 request, no framing headers)
// must not have `Content-Length: N\r\n\r\n` written into the body when the
// stream closes after raw body bytes already went out (#38675, #28019).
import { sweepSocketTimers } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { tls } from "harness";
import { once } from "node:events";
import net from "node:net";
import nodeTls from "node:tls";
import { Worker } from "node:worker_threads";

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

// A FIN ends a close-delimited body, so it would make a body that was cut look whole.
describe("a close-delimited body that is cut", () => {
  async function request(port: number, version: string, until: string, secure = false) {
    const options = { port, host: "127.0.0.1", allowHalfOpen: true };
    const socket = secure ? nodeTls.connect({ ...options, ca: tls.cert }) : net.connect(options);
    const ending = Promise.withResolvers<string>();
    socket.on("end", () => ending.resolve("end"));
    socket.on("error", (error: NodeJS.ErrnoException) => ending.resolve(error.code!));
    let reply = "";
    socket.on("data", chunk => (reply += chunk));
    socket.write(`GET / HTTP/${version}\r\nHost: x\r\n\r\n`);
    while (!reply.endsWith(until)) await once(socket, "data");
    return { socket, ending: ending.promise, [Symbol.dispose]: () => void socket.destroy() };
  }

  type Cut = (server: Bun.Server<undefined>, socket: net.Socket) => void;
  describe.each<[string, Cut]>([
    ["the idle timeout", () => sweepSocketTimers(2)],
    ["stop(true)", server => void server.stop(true)],
    ["the end of the client's side", (_, socket) => void socket.end()],
  ])("by %s", (_, cut) => {
    it.each([
      ["1.0", "", false, "ECONNRESET"],
      ["1.0", "part", false, "ECONNRESET"],
      ["1.0", "part", true, "ECONNRESET"],
      ["1.1", "", false, "end"],
    ] as const)("HTTP/%s, body %j, tls: %p: %s", async (version, body, secure, expected) => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: secure ? tls : undefined,
        idleTimeout: 4,
        fetch: () => new Response(new ReadableStream({ start: c => void (body && c.enqueue(body)) })),
      });
      using client = await request(server.port!, version, "\r\n\r\n" + body, secure);
      cut(server, client.socket);
      expect(await client.ending).toBe(expected);
    });
  });

  it.each([
    [
      "Bun.serve",
      `parentPort.postMessage(Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(new ReadableStream({ start: c => c.enqueue("part") })) }).port)`,
      "ECONNRESET",
    ],
    [
      "node:http, like Node",
      `const server = require("http").createServer((_, res) => res.write("part")).listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port))`,
      "end",
    ],
  ])("by the end of the worker (%s)", async (_, source, expected) => {
    const worker = new Worker(`const { parentPort } = require("worker_threads"); ${source}`, { eval: true });
    try {
      const [port] = await once(worker, "message");
      using client = await request(port, "1.0", "\r\n\r\npart");
      await worker.terminate();
      expect(await client.ending).toBe(expected);
    } finally {
      await worker.terminate();
    }
  });
});
