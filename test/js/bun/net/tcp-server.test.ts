import { connect, listen, SocketHandler, TCPSocketListener } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

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
  using server = Bun.listen({
    socket: {
      open(ws) {
        try {
          expect(ws.remoteAddress).toBe("127.0.0.1");
          resolve();
        } catch (e) {
          reject(e);

          return;
        }
      },
      close() {},
      data() {},
    },
    port: 0,
    hostname: "127.0.0.1",
  });

  await Bun.connect({
    socket: {
      open(ws) {
        try {
          // windows returns the ipv6 address
          expect(ws.remoteAddress).toMatch(/127.0.0.1/);
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

it("should not allow invalid tls option", () => {
  [1, "string", Symbol("symbol")].forEach(value => {
    expect(() => {
      // @ts-ignore
      using server = Bun.listen({
        socket: {
          open(ws) {},
          close() {},
          data() {},
        },
        port: 0,
        hostname: "localhost",
        tls: value,
      });
    }).toThrow("TLSOptions must be an object");
  });
});

it("should allow using false, null or undefined tls option", () => {
  [false, null, undefined].forEach(value => {
    expect(() => {
      // @ts-ignore
      using server = Bun.listen({
        socket: {
          open(ws) {},
          close() {},
          data() {},
        },
        port: 0,
        hostname: "localhost",
        tls: value,
      });
    }).not.toThrow("TLSOptions must be an object");
  });
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

    using server: TCPSocketListener<any> | undefined = listen({
      socket: handlers,
      hostname: "127.0.0.1",
      port: 0,

      data: {
        isServer: true,
        counter: 0,
      },
    });
    const clientProm = connect({
      socket: handlers,
      hostname: "127.0.0.1",
      port: server.port,
      data: {
        counter: 0,
      },
    });
    await Promise.all([prom, clientProm, serverProm]);
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

        using server: TCPSocketListener<any> | undefined = listen({
          socket: handlers,
          hostname: "127.0.0.1",
          port: 0,
          data: {
            isServer: true,
            counter: 0,
          },
        });

        const clientProm = connect({
          socket: handlers,
          hostname: "127.0.0.1",
          port: server.port,
          data: {
            counter: 0,
          },
        });

        await Promise.all([prom, clientProm, serverProm]);
      })();
    });
  }
});

// The libuv backend (Windows) does not count tick depth, so there the nested
// tick still frees the closed sockets.
it.skipIf(isWindows)("stop(true) outside a tick, with a close handler that ticks the loop", async () => {
  // stop(true) closes the listen socket first, then each connection, and then
  // closes the listen socket again (a no-op on a closed socket). The loop frees
  // closed sockets at the end of its outermost tick. When stop() runs outside a
  // tick, a tick that a close handler starts is the outermost one, so it freed
  // the listen socket before stop() read it again (heap-use-after-free).
  // Run in a subprocess so that a crash is a non-zero exit code.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { expect } = require("bun:test");
        const events = [];
        const { promise: bothOpen, resolve: onBothOpen } = Promise.withResolvers();
        let opened = 0;
        const server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open() {
              if (++opened === 2) onBothOpen();
            },
            data() {},
            close() {
              events.push("close");
              if (events.length === 1) {
                // Blocks until the promise settles, and ticks the event loop
                // while it waits. A timer fires only after the loop polls for
                // I/O, so "timer" before "ticked" shows that a tick ran here.
                const timer = new Promise(resolve =>
                  setTimeout(() => {
                    events.push("timer");
                    resolve();
                  }),
                );
                expect(timer).resolves.toBeUndefined();
                events.push("ticked");
              }
            },
          },
        });
        for (let i = 0; i < 2; i++) {
          await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {} } });
        }
        await bothOpen;
        // An immediate runs between event loop ticks, not inside one.
        setImmediate(() => {
          server.stop(true);
          events.push("stopped");
          console.log(events.join(","));
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("close,timer,ticked,close,stopped\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

it.skipIf(!isWindows)("stop(true) on a named-pipe listener with an open connection", async () => {
  // A named-pipe listener never initializes its socket group, and stop(true)
  // still closes that group when a connection is open. Run in a subprocess so
  // that a crash is a non-zero exit code.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const pipe = "\\\\\\\\.\\\\pipe\\\\bun-test-stop-" + Math.random().toString(36).slice(2);
        const { promise: opened, resolve: onOpen } = Promise.withResolvers();
        const { promise: closed, resolve: onClose } = Promise.withResolvers();
        const server = Bun.listen({
          unix: pipe,
          socket: {
            open() { onOpen(); },
            data() {},
            close() { onClose(); },
          },
        });
        const client = await Bun.connect({ unix: pipe, socket: { data() {} } });
        await opened;
        server.stop(true);
        client.end();
        await closed;
        console.log("stopped");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("stopped\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

it("should not leak memory", async () => {
  // The fixture counts live Listener and TCPSocket objects after the sockets
  // close. The count is heap-wide, and under `bun test --parallel` this
  // process also holds the previous file's global (its own TCPSocket
  // prototype, and any sockets it left behind), so the fixture runs alone.
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "tcp-server-leak-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
