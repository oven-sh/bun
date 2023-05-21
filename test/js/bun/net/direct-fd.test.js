import { expect, it } from "bun:test";
import { dlopen, FFIType, suffix } from "bun:ffi";

const hostname = '127.0.0.1';
const fdTest = async (lib, name, test) => {
  if (lib) {
    it(name, async () => {
      let port = 2000 + Math.floor(Math.random() * 30000);
      let fd = lib.symbols.bind_listen(port);
      if (fd < 0) throw "Couldn't get socket";
      try {
        await test(fd, port);
      } catch (e) {
        throw e;
      } finally {
        lib.symbols.close(fd);
      }
    });
  } else {
    it.skip(name, () => {});
  }
}

let lib;
try {
  const path = '/tmp/libdirect-fd-test';
  lib = dlopen(path, {
    bind_listen: {
      args: [FFIType.u16],
      returns: FFIType.i32,
    },

    close: {
      args: [FFIType.i32]
    }
  });
} catch {
  console.log("To enable this test, run `make compile-direct-fd-test`.");
}

await fdTest(lib, "directly listen on fd", async (fd, port) => {
  let serverResolve, serverReject, clientResolve, clientReject;
  const serverPromise = new Promise((resolve, reject) => {
    serverResolve = resolve;
    serverReject = reject;
  });
  const clientPromise = new Promise((resolve, reject) => {
    clientResolve = resolve;
    clientReject = reject;
  });

  const hello = new Uint8Array([ 72, 101, 108, 108, 111 ]);
  const server = Bun.listen({
    fd,
    socket: {
      data(socket, data) {
        socket.write(hello);
        setTimeout(() => {
          socket.end();
          serverResolve();
        });
      },
      error(socket, error) {
        serverReject(error);
      }
    }
  });
  const client = Bun.connect({
    hostname,
    port,
    socket: {
      open(socket) {
        socket.write("Hi");
      },
      data(socket, data) {
        expect(data).toEqual(hello);
        setTimeout(() => {
          socket.end();
          clientResolve();
        });
      },
      error(socket, error) {
        clientReject(error);
      }
    }
  });

  await Promise.all([serverPromise, clientPromise]);
  server.stop(true);
  server.unref();
});

await fdTest(lib, "directly serve on fd", async (fd, port) => {
  const server = Bun.serve({
    fd,
    fetch() {
      return new Response("Hello");
    }
  });
  const response = await fetch(`http://${hostname}:${port}`);
  expect(await response.text()).toBe("Hello");
  server.stop(true);
});
