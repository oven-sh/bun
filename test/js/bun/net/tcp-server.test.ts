import { connect, listen, SocketHandler, TCPSocketListener } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { getSystemErrorName } from "node:util";

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

// `errno` of a failed Bun.listen is the negative libuv number, as in node.
function listenErrors(stdout: string) {
  return Object.fromEntries(
    Object.entries(JSON.parse(stdout || "{}")).map(([name, error]: [string, any]) => [
      name,
      typeof error === "string"
        ? error
        : { ...error, errno: error.errno < 0 ? getSystemErrorName(error.errno) : error.errno },
    ]),
  );
}

// At the descriptor limit socket() fails before there is anything to bind.
// The unix path is relative: an absolute temporary path can be longer than
// sun_path, and the long path code opens the directory first.
it.skipIf(isWindows)("Bun.listen at the file descriptor limit throws EMFILE", async () => {
  using dir = tempDir("listen-emfile", {});
  const fixture = /* js */ `
    const fs = require("fs");
    const addresses = { tcp: { hostname: "127.0.0.1", port: 0 }, unix: { unix: "emfile.sock" } };
    if (process.env.HAS_IPV6) addresses.tcp6 = { hostname: "::1", port: 0 };
    // glibc needs a descriptor to look a name up, and reports that through errno.
    if (process.platform === "linux") addresses.localhost = { hostname: "localhost", port: 0 };
    const held = [];
    for (;;) {
      try {
        held.push(fs.openSync("/dev/null", "r"));
      } catch {
        break;
      }
    }
    const errors = {};
    for (const [name, address] of Object.entries(addresses)) {
      try {
        Bun.listen({ ...address, socket: { data() {} } }).stop(true);
        errors[name] = "listening";
      } catch (e) {
        errors[name] = { code: e.code, syscall: e.syscall, errno: e.errno };
      }
    }
    for (const fd of held) fs.closeSync(fd);
    console.log(JSON.stringify(errors));
  `;
  const hasIPv6 = Object.values(networkInterfaces())
    .flat()
    .some(network => network?.family === "IPv6");
  await using proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", 'ulimit -n 256 && exec "$@"', "sh", bunExe(), "-e", fixture],
    env: { ...bunEnv, HAS_IPV6: hasIPv6 ? "1" : "" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const emfile = { code: "EMFILE", syscall: "listen", errno: "EMFILE" };
  expect({ errors: listenErrors(stdout), stderr }).toEqual({
    errors: {
      tcp: emfile,
      unix: emfile,
      ...(hasIPv6 ? { tcp6: emfile } : {}),
      ...(isLinux ? { localhost: emfile } : {}),
    },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// Relative paths, so the length of the temporary directory does not decide
// which error the path gets.
it("Bun.listen reports why a unix path cannot be bound", async () => {
  using dir = tempDir("listen-unix-errors", {});
  const fixture = /* js */ `
    const paths = { missingDirectory: "missing/listen.sock", tooLong: Buffer.alloc(300, "a").toString() };
    const errors = {};
    for (const [name, unix] of Object.entries(paths)) {
      try {
        Bun.listen({ unix, socket: { data() {} } }).stop(true);
        errors[name] = "listening";
      } catch (e) {
        errors[name] = { code: e.code, syscall: e.syscall, errno: e.errno };
      }
    }
    console.log(JSON.stringify(errors));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ errors: listenErrors(stdout), stderr }).toEqual({
    errors: {
      missingDirectory: { code: "ENOENT", syscall: "listen", errno: "ENOENT" },
      tooLong: { code: "EINVAL", syscall: "listen", errno: "EINVAL" },
    },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});
