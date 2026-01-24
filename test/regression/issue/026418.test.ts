import { describe, expect, it } from "bun:test";
import { connect, createServer, Socket } from "node:net";
import { Duplex, Writable } from "node:stream";

describe("issue/026418", () => {
  it("net.Socket data events fire when socket is piped to another stream", async () => {
    let dataReceived = false;

    const server = createServer((socket: Socket) => {
      socket.on("data", () => {
        dataReceived = true;
      });

      const writable = new Writable({
        write(_chunk, _enc, cb) {
          cb();
        },
      });
      socket.pipe(writable);
    });

    const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<number>();

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        listenResolve(addr.port);
      }
    });

    const port = await listenPromise;

    const client = connect({ host: "127.0.0.1", port });

    const { promise: connectPromise, resolve: connectResolve } = Promise.withResolvers<void>();
    client.on("connect", () => {
      connectResolve();
    });

    await connectPromise;

    // Send data
    client.write("HELLO");

    // Wait for data to be received
    await Bun.sleep(100);

    expect(dataReceived).toBe(true);

    client.destroy();
    server.close();
  });

  it("net.Socket bidirectional pipe works (SSH tunnel pattern)", async () => {
    let dataReceived = false;
    let responseReceived = false;

    // Create a fake "remote" stream that simulates what ssh2's forwardOut returns
    function createFakeForwardStream() {
      return new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          // Simulate async response like SSH tunnel would do
          setTimeout(() => {
            this.push("RESPONSE:" + chunk.toString());
          }, 10);
          callback();
        },
      });
    }

    const server = createServer((socket: Socket) => {
      socket.on("data", () => {
        dataReceived = true;
      });

      // Simulate ssh2's forwardOut callback pattern
      setTimeout(() => {
        const forwardStream = createFakeForwardStream();
        // This is the pattern from the issue: socket.pipe(stream).pipe(socket)
        socket.pipe(forwardStream).pipe(socket);
      }, 20);
    });

    const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<number>();

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        listenResolve(addr.port);
      }
    });

    const port = await listenPromise;

    const client = connect({ host: "127.0.0.1", port });

    const { promise: connectPromise, resolve: connectResolve } = Promise.withResolvers<void>();
    client.on("connect", () => {
      connectResolve();
    });

    await connectPromise;

    client.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("RESPONSE:")) {
        responseReceived = true;
      }
    });

    // Send data after forward stream is set up
    await Bun.sleep(100);
    client.write("REQUEST");

    // Wait for response
    await Bun.sleep(100);

    expect(dataReceived).toBe(true);
    expect(responseReceived).toBe(true);

    client.destroy();
    server.close();
  });
});
