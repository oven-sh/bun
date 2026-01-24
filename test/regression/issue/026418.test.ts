import { describe, it } from "bun:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { connect, createServer, Socket } from "node:net";
import { Duplex, Writable } from "node:stream";

describe("issue/026418", () => {
  it("net.Socket data events fire when socket is piped to another stream", async () => {
    const { promise: dataPromise, resolve: dataResolve } = Promise.withResolvers<void>();

    await using server = createServer((socket: Socket) => {
      socket.on("data", () => {
        dataResolve();
      });

      const writable = new Writable({
        write(_chunk, _enc, cb) {
          cb();
        },
      });
      socket.pipe(writable);
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect({ host: "127.0.0.1", port });

    await once(client, "connect");

    // Send data
    client.write("HELLO");

    // Wait for data to be received with AbortSignal timeout
    await Promise.race([dataPromise, abortAfterTimeout(1000, "data event not received")]);

    client.destroy();
  });

  it("net.Socket bidirectional pipe works (SSH tunnel pattern)", async () => {
    const { promise: dataPromise, resolve: dataResolve } = Promise.withResolvers<void>();
    const { promise: responsePromise, resolve: responseResolve } = Promise.withResolvers<void>();
    const { promise: pipeReadyPromise, resolve: pipeReadyResolve } = Promise.withResolvers<void>();

    // Create a fake "remote" stream that simulates what ssh2's forwardOut returns
    function createFakeForwardStream() {
      return new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          // Use queueMicrotask instead of setTimeout to avoid timing issues
          queueMicrotask(() => {
            this.push("RESPONSE:" + chunk.toString());
          });
          callback();
        },
      });
    }

    await using server = createServer((socket: Socket) => {
      socket.on("data", () => {
        dataResolve();
      });

      // Use queueMicrotask instead of setTimeout
      queueMicrotask(() => {
        const forwardStream = createFakeForwardStream();
        // This is the pattern from the issue: socket.pipe(stream).pipe(socket)
        socket.pipe(forwardStream).pipe(socket);
        pipeReadyResolve();
      });
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect({ host: "127.0.0.1", port });

    await once(client, "connect");

    client.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("RESPONSE:")) {
        responseResolve();
      }
    });

    // Wait for forward stream to be set up
    await Promise.race([pipeReadyPromise, abortAfterTimeout(1000, "pipe setup timeout")]);

    // Send data
    client.write("REQUEST");

    // Wait for data and response with timeout
    await Promise.race([
      Promise.all([dataPromise, responsePromise]),
      abortAfterTimeout(1000, "data/response not received"),
    ]);

    client.destroy();
  });
});

// Helper to create a promise that rejects after timeout using AbortSignal
function abortAfterTimeout(ms: number, message: string): Promise<never> {
  const signal = AbortSignal.timeout(ms);
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      reject(new Error(message));
    });
  });
}
