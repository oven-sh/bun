import { connect, listen, SocketHandler, TCPSocketListener } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { expectMaxObjectTypeCount, isWindows } from "harness";

// heapStats().objectTypeCounts is process-global. When the full suite runs in
// one process, other test files' Listener/TCPSocket wrappers are still on the
// heap when this file loads. Capture a baseline so the end-of-file leak check
// asserts *this file's* wrappers were collected, not an absolute count.
const baseline = heapStats().objectTypeCounts;
const listenerBaseline = baseline.Listener ?? 0;
const tcpSocketBaseline = baseline.TCPSocket ?? 0;

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

    // 127.0.0.1, not "localhost": on v6-preferring hosts listen() binds ::1
    // while connect()'s resolver picks 127.0.0.1 (or vice versa) → ECONNREFUSED.
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
      hostname: server.hostname,
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

        // 127.0.0.1, not "localhost": avoid v4/v6 resolver mismatch → ECONNREFUSED.
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
          hostname: server.hostname,
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

it("should not leak memory", async () => {
  // Assert this file's sockets were collected. The bound is the module-load
  // baseline (wrappers left by prior test files in the same process) plus 2
  // for the prototype/structure that first use may have materialized.
  await expectMaxObjectTypeCount(expect, "Listener", listenerBaseline + 2);
  // JSC's native `using` implementation keeps the disposed value in a
  // bytecode register for the lifetime of the enclosing function frame
  // (emitUsingBodyScope does not clear `slot.value` after calling dispose),
  // whereas Bun's previous lowered `__callDispose` polyfill released the
  // reference via `stack.pop()` immediately. On Windows this can leave one
  // extra accepted socket reachable for one more GC cycle. Disposal still
  // happens correctly; this is purely a GC-observable register-lifetime
  // difference. The JSC-side fix (clearing the value register after dispose)
  // requires a WebKit rebuild and is tracked separately.
  await expectMaxObjectTypeCount(expect, "TCPSocket", tcpSocketBaseline + (isWindows ? 4 : 2));
});
