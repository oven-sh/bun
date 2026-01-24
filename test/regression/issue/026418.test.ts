import { describe, it } from "bun:test";
import { connect, createServer, Server, Socket } from "node:net";
import { Duplex, Writable } from "node:stream";

describe("issue/026418", () => {
  it("net.Socket data events fire when socket is piped to another stream", async () => {
    const { promise: dataPromise, resolve: dataResolve } = Promise.withResolvers<void>();

    const server = createServer((socket: Socket) => {
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

    try {
      const port = await listenOnRandomPort(server);
      const client = connect({ host: "127.0.0.1", port });

      try {
        await waitForConnect(client);

        // Send data
        client.write("HELLO");

        // Wait for data to be received with timeout
        await Promise.race([dataPromise, rejectAfterTimeout(1000, "data event not received")]);
      } finally {
        client.destroy();
      }
    } finally {
      await closeServer(server);
    }
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

    const server = createServer((socket: Socket) => {
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

    try {
      const port = await listenOnRandomPort(server);
      const client = connect({ host: "127.0.0.1", port });

      try {
        await waitForConnect(client);

        client.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("RESPONSE:")) {
            responseResolve();
          }
        });

        // Wait for forward stream to be set up
        await Promise.race([pipeReadyPromise, rejectAfterTimeout(1000, "pipe setup timeout")]);

        // Send data
        client.write("REQUEST");

        // Wait for data and response with timeout
        await Promise.race([
          Promise.all([dataPromise, responsePromise]),
          rejectAfterTimeout(1000, "data/response not received"),
        ]);
      } finally {
        client.destroy();
      }
    } finally {
      await closeServer(server);
    }
  });
});

// Helper functions

function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve(addr.port);
      } else {
        reject(new Error("Failed to get server port"));
      }
    });
  });
}

function waitForConnect(client: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.on("connect", resolve);
    client.on("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => resolve());
  });
}

function rejectAfterTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
