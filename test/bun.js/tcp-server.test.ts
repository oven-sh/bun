import { listen, connect, finalizationCounter } from "bun";
import { expect, describe, it } from "bun:test";
import * as JSC from "bun:jsc";

var decoder = new TextDecoder();

it("echo server 1 on 1", async () => {
  // wrap it in a separate closure so the GC knows to clean it up
  // the sockets & listener don't escape the closure
  await (async function () {
    var resolve, reject, serverResolve, serverReject;
    var prom = new Promise((resolve1, reject1) => {
      resolve = resolve1;
      reject = reject1;
    });
    var serverProm = new Promise((resolve1, reject1) => {
      serverResolve = resolve1;
      serverReject = reject1;
    });

    var serverData, clientData;
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
        const msg = `${
          socket.data.isServer ? "server:" : "client:"
        } Hello World! ${socket.data.counter++}`;
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
    };

    var server = listen({
      socket: handlers,
      hostname: "localhost",
      port: 8084,
      data: {
        isServer: true,
        counter: 0,
      },
    });
    const clientProm = connect({
      socket: handlers,
      hostname: "localhost",
      port: 8084,
      data: {
        counter: 0,
      },
    });
    await Promise.all([prom, clientProm, serverProm]);
    server.stop();
    server = serverData = clientData = undefined;
    Bun.gc(true);
  })();

  // Tell the garbage collector for sure that we're done with the sockets
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      Bun.gc(true);
      resolve();
    }, 1);
  });

  // assert we don't leak the sockets
  // we expect 1 because that's the prototype / structure
  expect(JSC.heapStats().objectTypeCounts.TCPSocket).toBe(1);
  expect(JSC.heapStats().objectTypeCounts.Listener).toBe(1);
});
