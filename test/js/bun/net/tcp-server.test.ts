import { connect, listen, SocketHandler, TCPSocketListener } from "bun";
import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { expectMaxObjectTypeCount, isWindows } from "harness";

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
      })();
    });
  }
});

// With allowHalfOpen, a server's end() handler that writes more than the kernel
// send buffer accepts (a partial write) triggered us_internal_rearm_writable,
// which re-added READABLE to the poll mask. The half-open eof branch had just
// set it to WRITABLE-only, so the next epoll tick re-derived recv()==0 -> eof
// and re-dispatched end(), forever. Drain fired at most once between re-entries.
it("allowHalfOpen: end() fires once when the handler's write is partially accepted", async () => {
  const PAYLOAD = Buffer.alloc(256 * 1024, 0x61);
  let endCount = 0;
  let drainCount = 0;
  const serverClosed = Promise.withResolvers<void>();
  const clientClosed = Promise.withResolvers<void>();

  using server = listen<{ sent: number }>({
    hostname: "127.0.0.1",
    port: 0,
    allowHalfOpen: true,
    socket: {
      open(s) {
        // Clamp SO_SNDBUF so the write from end() is a partial write on every
        // POSIX kernel. No-op on Windows; the drainCount assertion is gated.
        setSocketOptions(s, 1, 4096);
        s.data = { sent: 0 };
      },
      data() {},
      end(s) {
        if (++endCount > 1) {
          // The bug re-enters end() every tick; terminate so the test fails on
          // the assertion below instead of spinning.
          s.terminate();
          return;
        }
        s.data.sent = s.write(PAYLOAD);
        if (s.data.sent >= PAYLOAD.length) s.shutdown();
      },
      drain(s) {
        drainCount++;
        if (s.data.sent === 0) return;
        s.data.sent += s.write(PAYLOAD.subarray(s.data.sent));
        if (s.data.sent >= PAYLOAD.length) s.shutdown();
      },
      close() {
        serverClosed.resolve();
      },
    },
  });

  let received = 0;
  await connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      open(s) {
        s.write("hi");
        s.shutdown();
      },
      data(_s, chunk) {
        received += chunk.byteLength;
      },
      end() {},
      close() {
        clientClosed.resolve();
      },
    },
  });

  await Promise.all([serverClosed.promise, clientClosed.promise]);

  expect({ endCount, received }).toEqual({ endCount: 1, received: PAYLOAD.length });
  // setSocketOptions is a POSIX-only no-op on Windows, where loopback
  // auto-tuning can accept 256 KiB in one send(). The assertion above already
  // proves the fix there (endCount == 1 with the whole payload delivered).
  if (!isWindows) expect(drainCount).toBeGreaterThanOrEqual(1);
});

it("should not leak memory", async () => {
  // assert we don't leak the sockets
  // we expect 1 or 2 because that's the prototype / structure
  await expectMaxObjectTypeCount(expect, "Listener", 2);
  // JSC's native `using` implementation keeps the disposed value in a
  // bytecode register for the lifetime of the enclosing function frame
  // (emitUsingBodyScope does not clear `slot.value` after calling dispose),
  // whereas Bun's previous lowered `__callDispose` polyfill released the
  // reference via `stack.pop()` immediately. On Windows this can leave one
  // extra accepted socket reachable for one more GC cycle. Disposal still
  // happens correctly; this is purely a GC-observable register-lifetime
  // difference. The JSC-side fix (clearing the value register after dispose)
  // requires a WebKit rebuild and is tracked separately.
  await expectMaxObjectTypeCount(expect, "TCPSocket", isWindows ? 4 : 2);
});
