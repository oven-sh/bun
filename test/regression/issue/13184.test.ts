import { describe, test } from "bun:test";
import * as net from "node:net";
import { Transform } from "node:stream";

// https://github.com/oven-sh/bun/issues/13184
// https://github.com/oven-sh/bun/issues/19563
// https://github.com/oven-sh/bun/issues/23648

async function testServerCloseCompletes(
  handler: (socket: net.Socket, ready: () => void) => void,
  teardown: "destroy" | "end" = "destroy",
): Promise<void> {
  const { promise: serverSocketClosed, resolve: onServerSocketClose } = Promise.withResolvers<void>();
  const { promise: serverReady, resolve: onServerReady } = Promise.withResolvers<void>();

  const server = net.createServer(socket => {
    socket.on("error", () => {});
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

  await serverReady;

  client[teardown]();
  await serverSocketClosed;

  // server.close() must complete, not hang — if the socket wasn't destroyed,
  // _connections wouldn't decrement and this would hang (timeout).
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

  test("paused socket with graceful client.end() gets destroyed", async () => {
    await testServerCloseCompletes((socket, ready) => {
      socket.on("data", () => {
        socket.pause();
        ready();
      });
    }, "end");
  });

});
