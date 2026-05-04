import { test, expect, describe } from "bun:test";
import * as net from "node:net";
import { Transform } from "node:stream";

// https://github.com/oven-sh/bun/issues/13184
// https://github.com/oven-sh/bun/issues/19563
// https://github.com/oven-sh/bun/issues/23648
//
// When the native socket closes, the net.Socket must transition to
// destroyed=true and fire the 'close' event, even if the readable stream
// is paused or the writable side was never ended. Without this,
// net.Server.close() hangs because _connections never decrements.

async function testServerCloseCompletes(
  handler: (socket: net.Socket, ready: () => void) => void,
  teardown: "destroy" | "end" = "destroy",
): Promise<void> {
  const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
  const { promise: serverReady, resolve: onServerReady } = Promise.withResolvers<void>();

  const server = net.createServer(socket => {
    socket.on("error", () => {}); // suppress errors
    socket.on("close", onServerSocketClose);
    handler(socket, onServerReady);
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address() as net.AddressInfo;

  const client = new net.Socket();
  const { promise: clientConnected, resolve: onClientConnect } = Promise.withResolvers<void>();
  client.on("error", () => {});
  client.connect(addr.port, "127.0.0.1", onClientConnect);

  await clientConnected;
  client.write(Buffer.alloc(1200, "hello world ").toString());

  // Wait for the server-side handler to set up its state before tearing down,
  // otherwise teardown can race ahead and close the socket before the handler runs.
  await serverReady;

  // Teardown the client and wait for the server-side socket to close
  client[teardown]();
  await serverSocketClosed;

  // server.close() must complete, not hang
  await new Promise<void>((resolve, reject) => {
    server.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe("net.Server.close() must not hang when native socket closes", () => {
  test("paused socket gets destroyed on native close", async () => {
    await testServerCloseCompletes((socket, ready) => {
      socket.on("data", () => {
        socket.pause();
        ready();
      });
    });
  });

  test("socket with end() called and paused readable gets destroyed", async () => {
    await testServerCloseCompletes((socket, ready) => {
      socket.on("data", () => {
        socket.pause();
        socket.end("goodbye");
        ready();
      });
    });
  });

  test("unpiped socket gets destroyed on native close", async () => {
    await testServerCloseCompletes((socket, ready) => {
      const transform = new Transform({
        transform(chunk, _encoding, callback) {
          callback(null, chunk);
        },
      });
      socket.pipe(transform);
      transform.pipe(socket);

      socket.on("data", () => {
        transform.destroy();
        socket.unpipe(transform);
        transform.unpipe(socket);
        ready();
      });
    });
  });

  test("pipe + pause + end sequence gets destroyed", async () => {
    await testServerCloseCompletes((socket, ready) => {
      const transform = new Transform({
        transform(chunk, _encoding, callback) {
          callback(null, chunk);
        },
      });
      socket.pipe(transform);

      socket.once("data", () => {
        socket.unpipe(transform);
        socket.pause();
        socket.end();
        ready();
      });
    });
  });

  test("socket that was never read gets destroyed on native close", async () => {
    await testServerCloseCompletes((_socket, ready) => {
      // Do nothing with the socket - socket stays paused with no data handler.
      // Signal ready immediately since there's no state to set up.
      ready();
    });
  });

  test("paused socket with graceful client.end() gets destroyed", async () => {
    await testServerCloseCompletes((socket, ready) => {
      socket.on("data", () => {
        socket.pause();
        ready();
      });
    }, "end");
  });

  test("socket that was never read with graceful client.end() gets destroyed", async () => {
    await testServerCloseCompletes((_socket, ready) => {
      // Do nothing with the socket - socket stays paused with no data handler.
      // Signal ready immediately since there's no state to set up.
      ready();
    }, "end");
  });

  test("destroyed flag is true after native close", async () => {
    const { promise: socketPromise, resolve: resolveSocket } = Promise.withResolvers<net.Socket>();
    const { promise: socketClosed, resolve: onSocketClose } = Promise.withResolvers<void>();
    const { promise: dataReceived, resolve: onDataReceived } = Promise.withResolvers<void>();

    const server = net.createServer(socket => {
      socket.on("error", () => {});
      socket.on("close", onSocketClose);
      socket.on("data", () => {
        socket.pause();
        onDataReceived();
      });
      resolveSocket(socket);
    });

    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as net.AddressInfo;

    const client = new net.Socket();
    const { promise: clientConnected, resolve: onClientConnect } = Promise.withResolvers<void>();
    client.on("error", () => {});
    client.connect(addr.port, "127.0.0.1", onClientConnect);

    await clientConnected;
    client.write("hello");
    await dataReceived;
    client.destroy();

    const serverSocket = await socketPromise;
    await socketClosed;

    expect(serverSocket.destroyed).toBe(true);

    await new Promise<void>((r, reject) => {
      server.close(err => (err ? reject(err) : r()));
    });
  });
});
