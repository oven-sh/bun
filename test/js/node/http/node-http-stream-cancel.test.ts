import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

describe("node:http ReadableStream cancel on disconnect", () => {
  test("should call ReadableStream cancel() when client disconnects", async () => {
    let cancelCalled = false;
    let streamStarted = false;
    let closeEventFired = false;

    const { promise: cancelPromise, resolve: resolveCancel } = Promise.withResolvers<void>();

    await using server = http.createServer((_req, res) => {
      const stream = new ReadableStream({
        start() {
          streamStarted = true;
        },
        cancel() {
          cancelCalled = true;
          resolveCancel();
        },
      });

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
      });

      pipeStreamToResponse(stream, res, () => {
        closeEventFired = true;
      });
    });

    await once(server.listen(0), "listening");
    const { port } = server.address() as AddressInfo;

    const socket = net.connect({ host: "127.0.0.1", port });

    socket.on("connect", () => {
      socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
      setTimeout(() => socket.destroy(), 50);
    });

    await Promise.race([cancelPromise, Bun.sleep(1000)]);

    expect(streamStarted).toBe(true);
    expect(closeEventFired).toBe(true);
    expect(cancelCalled).toBe(true);
  });

  test("should call cancel() with fetch client abort", async () => {
    let cancelCalled = false;
    let streamStarted = false;

    await using server = http.createServer((_req, res) => {
      const stream = new ReadableStream({
        start() {
          streamStarted = true;
        },
        cancel() {
          cancelCalled = true;
        },
      });

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Connection": "keep-alive",
      });

      pipeStreamToResponse(stream, res);
    });

    await once(server.listen(0), "listening");
    const { port } = server.address() as AddressInfo;

    const controller = new AbortController();
    const fetchPromise = fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });

    await Bun.sleep(50);
    controller.abort();

    // Aborted fetch should throw
    await expect(fetchPromise).rejects.toThrow();

    await Bun.sleep(100);

    expect(streamStarted).toBe(true);
    expect(cancelCalled).toBe(true);
  });

  test("should handle stream cancel with chunked encoding", async () => {
    let cancelCalled = false;
    let chunksWritten = 0;

    await using server = http.createServer((_req, res) => {
      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < 5; i++) {
            controller.enqueue(new TextEncoder().encode(`data: chunk ${i}\n\n`));
            chunksWritten++;
            await Bun.sleep(10);
          }
        },
        cancel() {
          cancelCalled = true;
        },
      });

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Connection": "keep-alive",
      });

      pipeStreamToResponse(stream, res);
    });

    await once(server.listen(0), "listening");
    const { port } = server.address() as AddressInfo;

    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const socket = net.connect({ host: "127.0.0.1", port });

    socket.on("connect", () => {
      socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);

      socket.once("data", () => {
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 50);
      });
    });

    socket.on("error", reject);

    await promise;
    await Bun.sleep(100);

    expect(chunksWritten).toBeGreaterThan(0);
    expect(cancelCalled).toBe(true);
  });
});

type ServerResponse = http.ServerResponse<http.IncomingMessage>;

/** Pipes a ReadableStream body to a ServerResponse, cancelling on disconnect */
function pipeStreamToResponse(stream: ReadableStream<Uint8Array>, res: ServerResponse, onClose?: () => void): void {
  const reader = stream.getReader();

  const cancel = (error?: Error) => {
    onClose?.();
    res.off("close", cancel);
    res.off("error", cancel);
    reader.cancel(error).catch(() => {});
    if (error) res.destroy(error);
  };

  res.on("close", cancel);
  res.on("error", cancel);

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.destroyed && !res.write(value)) {
          res.once("drain", pump);
          return;
        }
      }
      if (!res.destroyed) res.end();
    } catch {
      if (!res.destroyed) res.end();
    }
  };

  pump();
}
