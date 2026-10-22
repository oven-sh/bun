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
        tls: value as any,
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
        tls: value as any,
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

it("write() and end() read byteOffset and byteLength by value", async () => {
  const received: Buffer[] = [];
  const { promise: closed, resolve, reject } = Promise.withResolvers<void>();
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(_socket, chunk) {
        received.push(chunk);
      },
      close() {
        resolve();
      },
      error(_socket, err) {
        reject(err);
      },
    },
  });
  const client = await Bun.connect({
    hostname: "127.0.0.1",
    port: listener.port,
    socket: { data() {} },
  });

  const buf = Buffer.from("0123456789");
  // -0 is an integer that ordinary arithmetic produces, and it equals 0.
  const negativeZero = Math.round(-0.2);
  // JSC stores this whole number as a double, not as an int32.
  const double = (n: number) => new Float64Array([n])[0];
  const notAnInteger = "TypeError [ERR_INVALID_ARG_TYPE]";
  const outOfRange = (name: string, max: number, received: string) =>
    `RangeError [ERR_OUT_OF_RANGE]: The value of "${name}" is out of range. It must be >= 0 and <= ${max}. Received ${received}`;
  const outcome = (offset: unknown, length: unknown) => {
    try {
      return client.write(buf, offset as number, length as number);
    } catch (e: any) {
      return e.code === "ERR_OUT_OF_RANGE" ? `${e.name} [${e.code}]: ${e.message}` : `${e.name} [${e.code}]`;
    }
  };

  // Each refused value for one argument, with the other argument valid. `end` is the
  // largest value the buffer allows: 10 for byteOffset, and 6 for byteLength after offset 4.
  const refused = (name: string, end: number): [value: unknown, expected: string][] => [
    [1.5, notAnInteger],
    [NaN, notAnInteger],
    [Infinity, notAnInteger],
    [-Infinity, notAnInteger],
    [true, notAnInteger],
    [5n, notAnInteger],
    [null, notAnInteger],
    [{}, notAnInteger],
    [-1, outOfRange(name, Number.MAX_SAFE_INTEGER, "-1")],
    [-(2 ** 53), outOfRange(name, Number.MAX_SAFE_INTEGER, "-9007199254740992")],
    [-1e300, outOfRange(name, Number.MAX_SAFE_INTEGER, "-1e+300")],
    [end + 1, outOfRange(name, end, String(end + 1))],
    [2 ** 32, outOfRange(name, end, "4294967296")],
    [2 ** 51, outOfRange(name, end, "2251799813685248")],
    [2 ** 53 - 1, outOfRange(name, end, "9007199254740991")],
    [2 ** 53, outOfRange(name, Number.MAX_SAFE_INTEGER, "9007199254740992")],
    [1e300, outOfRange(name, Number.MAX_SAFE_INTEGER, "1e+300")],
  ];
  const offsets = refused("byteOffset", 10);
  expect(offsets.map(([offset]) => [offset, outcome(offset, 0)])).toEqual(offsets);
  const lengths = refused("byteLength", 6);
  expect(lengths.map(([length]) => [length, outcome(4, length)])).toEqual(lengths);

  const wrote = {
    offset: client.write(buf, negativeZero, 3),
    length: client.write(buf, 3, negativeZero),
    both: client.write(buf, negativeZero, negativeZero),
    offsetAlone: client.write(buf, negativeZero),
    doubles: client.write(buf, double(1), double(2)),
    end: client.end(buf, negativeZero, 2),
  };
  await closed;

  expect({ wrote, received: Buffer.concat(received).toString() }).toEqual({
    wrote: { offset: 3, length: 0, both: 0, offsetAlone: 10, doubles: 2, end: 2 },
    received: "012" + "0123456789" + "12" + "01",
  });
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

it.skipIf(isWindows)("stop(true) between ticks closes every socket when a close handler ticks the loop", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { expect } from "bun:test";
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
                // "timer" before "ticked" proves that the wait ticked the loop.
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
        // An immediate runs between event loop ticks.
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

// stop(true) from alpnCallback or serverName closes the socket whose SSL call
// is on the stack, so that close waits until the callback returns. stop(true)
// once spun on that socket and never returned. The fixture runs in a child
// process, because such a spin also blocks the event loop that times a test
// out. The cases are not concurrent: the runner kills a child that a timed-out
// test leaves behind only when that test runs alone.
describe("TLS listener: stop(true) from inside a selection callback", () => {
  it.each(["alpnCallback", "serverName"])("%s: stop(true) returns and the connection closes", async hook => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tls-stop-from-selection-fixture.ts"), hook],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      events: ["returned", "handshake:false", "close"],
      clientConnected: false,
      serverClosedFirst: true,
    });
    expect(exitCode).toBe(0);
  });
});
