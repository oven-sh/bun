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

async function testServerCloseCompletes(handler: (socket: net.Socket) => void): Promise<void> {
  const server = net.createServer(socket => {
    socket.on("error", () => {}); // suppress errors
    handler(socket);
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address() as net.AddressInfo;

  const client = new net.Socket();
  await new Promise<void>(resolve => {
    client.on("error", () => {});
    client.connect(addr.port, "127.0.0.1", () => {
      client.write("hello world ".repeat(100));
      setTimeout(() => {
        client.destroy();
        resolve();
      }, 100);
    });
  });

  // Give time for the native close to propagate
  await new Promise<void>(r => setTimeout(r, 500));

  // server.close() must complete, not hang
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("server.close() hung — zombie socket detected"));
    }, 5000);

    server.close(err => {
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve();
    });
  });
}

describe("net.Server.close() must not hang when native socket closes", () => {
  test("paused socket gets destroyed on native close", async () => {
    await testServerCloseCompletes(socket => {
      socket.on("data", () => {
        socket.pause();
      });
    });
  });

  test("socket with end() called and paused readable gets destroyed", async () => {
    await testServerCloseCompletes(socket => {
      socket.on("data", () => {
        socket.pause();
        socket.end("goodbye");
      });
    });
  });

  test("unpiped socket gets destroyed on native close", async () => {
    await testServerCloseCompletes(socket => {
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
      });
    });
  });

  test("pipe + pause + end sequence gets destroyed", async () => {
    await testServerCloseCompletes(socket => {
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
      });
    });
  });

  test("socket that was never read gets destroyed on native close", async () => {
    await testServerCloseCompletes(socket => {
      // Do nothing with the socket - just accept and ignore
      socket.on("data", () => {});
    });
  });

  test("destroyed flag is true after native close", async () => {
    const { promise, resolve } = Promise.withResolvers<net.Socket>();

    const server = net.createServer(socket => {
      socket.on("error", () => {});
      socket.on("data", () => {
        socket.pause();
      });
      resolve(socket);
    });

    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as net.AddressInfo;

    const client = new net.Socket();
    client.on("error", () => {});
    client.connect(addr.port, "127.0.0.1", () => {
      client.write("hello");
      setTimeout(() => client.destroy(), 100);
    });

    const serverSocket = await promise;

    // Wait for native close to propagate
    await new Promise<void>(r => setTimeout(r, 500));

    expect(serverSocket.destroyed).toBe(true);

    await new Promise<void>((r, reject) => {
      server.close(err => (err ? reject(err) : r()));
    });
  });
});
