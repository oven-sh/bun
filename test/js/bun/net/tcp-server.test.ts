import { listen, connect, TCPSocketListener, SocketHandler } from "bun";
import { describe, expect, it } from "bun:test";
import { expectMaxObjectTypeCount } from "harness";

type Resolve = (value?: unknown) => void;
type Reject = (reason?: any) => void;
const decoder = new TextDecoder();

it("remoteAddress works", async () => {
  var resolve: Resolve, reject: Reject;
  var remaining = 2;
  var prom = new Promise<void>((resolve1, reject1) => {
    resolve = () => {
      if (--remaining === 0) resolve1();
    };
    reject = reject1;
  });
  let server = Bun.listen({
    socket: {
      open(ws) {
        try {
          expect(ws.remoteAddress).toBe("127.0.0.1");
          resolve();
        } catch (e) {
          reject(e);

          return;
        } finally {
          setTimeout(() => server.stop(true), 0);
        }
      },
      close() {},
      data() {},
    },
    port: 0,
    hostname: "localhost",
  });

  await Bun.connect({
    socket: {
      open(ws) {
        try {
          expect(ws.remoteAddress).toBe("127.0.0.1");
          resolve();
        } catch (e) {
          reject(e);
          return;
        } finally {
          ws.end();
        }
      },
      data() {},
      close() {},
    },
    hostname: server.hostname,
    port: server.port,
  });
  await prom;
});

it("echo server 1 on 1", async () => {
  // wrap it in a separate closure so the GC knows to clean it up
  // the sockets & listener don't escape the closure
  await (async function () {
    let resolve: Resolve, reject: Reject, serverResolve: Resolve, serverReject: Reject;
    const prom = new Promise((resolve1, reject1) => {
      resolve = resolve1;
      reject = reject1;
    });
    const serverProm = new Promise((resolve1, reject1) => {
      serverResolve = resolve1;
      serverReject = reject1;
    });

    let serverData: any, clientData: any;
    const handlers = {
      open(socket) {
        socket.data.counter = 1;
        if (!socket.data?.isServer) {
          clientData = socket.data;
          clientData.sendQueue = ["client: Hello World! " + 0];
          if (!socket.write("client: Hello World! " + 0)) {
            socket.data = { pending: "server: Hello World! " + 0 };
          }
        } else {
          serverData = socket.data;
          serverData.sendQueue = ["server: Hello World! " + 0];
        }

        if (clientData) clientData.other = serverData;
        if (serverData) serverData.other = clientData;
        if (clientData) clientData.other = serverData;
        if (serverData) serverData.other = clientData;
      },
      data(socket, buffer) {
        const msg = `${socket.data.isServer ? "server:" : "client:"} Hello World! ${socket.data.counter++}`;
        socket.data.sendQueue.push(msg);

        expect(decoder.decode(buffer)).toBe(socket.data.other.sendQueue.pop());

        if (socket.data.counter > 10) {
          if (!socket.data.finished) {
            socket.data.finished = true;
            if (socket.data.isServer) {
              setTimeout(() => {
                serverResolve();
                socket.end();
              }, 1);
            } else {
              setTimeout(() => {
                resolve();
                socket.end();
              }, 1);
            }
          }
        }

        if (!socket.write(msg)) {
          socket.data.pending = msg;
          return;
        }
      },
      error(socket, error) {
        reject(error);
      },
      drain(socket) {
        reject(new Error("Unexpected backpressure"));
      },
    } as SocketHandler<any>;

    var server: TCPSocketListener<any> | undefined = listen({
      socket: handlers,
      hostname: "localhost",
      port: 0,

      data: {
        isServer: true,
        counter: 0,
      },
    });
    const clientProm = connect({
      socket: handlers,
      hostname: "localhost",
      port: server.port,
      data: {
        counter: 0,
      },
    });
    await Promise.all([prom, clientProm, serverProm]);
    server.stop(true);
    server = serverData = clientData = undefined;
  })();
});

describe("tcp socket binaryType", () => {
  const binaryType = ["arraybuffer", "uint8array", "buffer"] as const;
  for (const type of binaryType) {
    it(type, async () => {
      // wrap it in a separate closure so the GC knows to clean it up
      // the sockets & listener don't escape the closure
      await (async function () {
        let resolve: Resolve, reject: Reject, serverResolve: Resolve, serverReject: Reject;
        const prom = new Promise((resolve1, reject1) => {
          resolve = resolve1;
          reject = reject1;
        });
        const serverProm = new Promise((resolve1, reject1) => {
          serverResolve = resolve1;
          serverReject = reject1;
        });

        let serverData: any, clientData: any;
        const handlers = {
          open(socket) {
            socket.data.counter = 1;
            if (!socket.data?.isServer) {
              clientData = socket.data;
              clientData.sendQueue = ["client: Hello World! " + 0];
              if (!socket.write("client: Hello World! " + 0)) {
                socket.data = { pending: "server: Hello World! " + 0 };
              }
            } else {
              serverData = socket.data;
              serverData.sendQueue = ["server: Hello World! " + 0];
            }

            if (clientData) clientData.other = serverData;
            if (serverData) serverData.other = clientData;
            if (clientData) clientData.other = serverData;
            if (serverData) serverData.other = clientData;
          },
          data(socket, buffer) {
            expect(
              buffer instanceof
                (type === "arraybuffer"
                  ? ArrayBuffer
                  : type === "uint8array"
                  ? Uint8Array
                  : type === "buffer"
                  ? Buffer
                  : Error),
            ).toBe(true);
            const msg = `${socket.data.isServer ? "server:" : "client:"} Hello World! ${socket.data.counter++}`;
            socket.data.sendQueue.push(msg);

            expect(decoder.decode(buffer)).toBe(socket.data.other.sendQueue.pop());

            if (socket.data.counter > 10) {
              if (!socket.data.finished) {
                socket.data.finished = true;
                if (socket.data.isServer) {
                  setTimeout(() => {
                    serverResolve();
                    socket.end();
                  }, 1);
                } else {
                  setTimeout(() => {
                    resolve();
                    socket.end();
                  }, 1);
                }
              }
            }

            if (!socket.write(msg)) {
              socket.data.pending = msg;
              return;
            }
          },
          error(socket, error) {
            reject(error);
          },
          drain(socket) {
            reject(new Error("Unexpected backpressure"));
          },

          binaryType: type,
        } as SocketHandler<any>;

        var server: TCPSocketListener<any> | undefined = listen({
          socket: handlers,
          hostname: "localhost",
          port: 0,
          data: {
            isServer: true,
            counter: 0,
          },
        });

        const clientProm = connect({
          socket: handlers,
          hostname: "localhost",
          port: server.port,
          data: {
            counter: 0,
          },
        });

        await Promise.all([prom, clientProm, serverProm]);
        server.stop(true);
        server = serverData = clientData = undefined;
      })();
    });
  }
});

it("should not leak memory", async () => {
  // assert we don't leak the sockets
  // we expect 1 because that's the prototype / structure
  await expectMaxObjectTypeCount(expect, "Listener", 1);
  await expectMaxObjectTypeCount(expect, "TCPSocket", 1);
});
