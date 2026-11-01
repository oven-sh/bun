import { connect, listen, SocketHandler, TCPSocketListener } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, ipv6LoopbackInterface, ipv6LoopbackZones, isLinux, isWindows, tempDir } from "harness";
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

const noIPv6Loopback = ipv6LoopbackInterface() === undefined;

// A hostname that Node's net.isIP() takes is bound as it is written, with no
// resolver. A zone is the index of the interface that it names, and a name that
// no interface has is no zone, as libuv reads it for node:net. glibc's getaddrinfo
// refuses both on ::1, and Bun.listen threw "Failed to listen at" with no code.
it.skipIf(noIPv6Loopback).each(ipv6LoopbackZones())("listens on ::1%%%s, which has a zone", async zone => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const hostname = `::1%${zone}`;
  using server = Bun.listen({
    hostname,
    port: 0,
    socket: {
      open(socket) {
        socket.end("hello");
      },
      data() {},
    },
  });
  expect({ hostname: server.hostname, port: server.port }).toEqual({ hostname, port: expect.any(Number) });
  const chunks: string[] = [];
  await Bun.connect({
    hostname: "::1",
    port: server.port,
    socket: {
      data(_socket, data) {
        chunks.push(decoder.decode(data));
      },
      close() {
        resolve(chunks.join(""));
      },
      error(_socket, error) {
        reject(error);
      },
      connectError(_socket, error) {
        reject(error);
      },
    },
  });
  expect(await promise).toBe("hello");
});

// A zone of digits is the index of the interface, which is how dns.lookup()
// prints a scoped address. Index 1 is "lo" on Linux, which does not have
// fe80::1. With no zone the kernel answers EINVAL.
it.skipIf(!isLinux || noIPv6Loopback)("reads the zone of fe80::1%1 as the index of an interface", () => {
  let error: any;
  try {
    Bun.listen({ hostname: "fe80::1%1", port: 0, socket: { data() {} } }).stop(true);
  } catch (e) {
    error = e;
  }
  expect({ code: error?.code, syscall: error?.syscall }).toEqual({ code: "EADDRNOTAVAIL", syscall: "listen" });
});

// A zone that net.isIP() refuses is not part of an address. The resolver gets
// such a host. glibc and musl refuse it, and the resolver of macOS takes it.
it.skipIf(!isLinux)("does not listen on ::1%x y, which has a zone that net.isIP() refuses", () => {
  const hostname = "::1%x y";
  expect(() => Bun.listen({ hostname, port: 0, socket: { data() {} } }).stop(true)).toThrow(hostname);
});

// At the descriptor limit socket() fails before there is an address to bind.
// For a hostname that is an address the error has the code of that failure.
it.skipIf(isWindows)("Bun.listen on an address at the file descriptor limit throws EMFILE", async () => {
  const hostnames = ["127.0.0.1", "0.0.0.0", ...(noIPv6Loopback ? [] : ["::1", "::"])];
  const fixture = /* js */ `
    const fs = require("fs");
    const held = [];
    for (;;) {
      try {
        held.push(fs.openSync("/dev/null", "r"));
      } catch {
        break;
      }
    }
    const errors = {};
    for (const hostname of ${JSON.stringify(hostnames)}) {
      try {
        Bun.listen({ hostname, port: 0, socket: { data() {} } }).stop(true);
        errors[hostname] = "listening";
      } catch (e) {
        errors[hostname] = { code: e.code, syscall: e.syscall };
      }
    }
    for (const fd of held) fs.closeSync(fd);
    console.log(JSON.stringify(errors));
  `;
  await using proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", 'ulimit -n 256 && exec "$@"', "sh", bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ errors: JSON.parse(stdout || "{}"), stderr }).toEqual({
    errors: Object.fromEntries(hostnames.map(hostname => [hostname, { code: "EMFILE", syscall: "listen" }])),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// Every getaddrinfo() call of the child fails. A hostname that net.isIP() takes
// still binds in each API, because it is an address and the resolver never gets
// it. "localhost" does not bind, which shows that the shim is in the child.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
it.skipIf(!isLinux || !cc)("binds and listens on an address without a getaddrinfo() call", async () => {
  const hostnames = ["127.0.0.1", "0.0.0.0", ...(noIPv6Loopback ? [] : ["::1", "::"])];
  using dir = tempDir("bind-without-getaddrinfo", {
    "shim.c": /* c */ `
      #include <netdb.h>
      int getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
          (void) node; (void) service; (void) hints; (void) res;
          return EAI_FAIL;
      }
    `,
    "fixture.mjs": /* js */ `
      import dgram from "node:dgram";
      import http from "node:http";
      import net from "node:net";

      const socket = { data() {} };
      // The address that an API bound, or the code of its error.
      const attempt = async bind => {
        try {
          return await bind();
        } catch (error) {
          return error.code ?? error.message;
        }
      };
      const listening = (handle, start) =>
        new Promise((resolve, reject) => {
          handle.once("error", reject);
          handle.once("listening", () => {
            const { address } = handle.address();
            handle.close(() => resolve(address));
          });
          start();
        });

      const bound = {};
      for (const hostname of ${JSON.stringify(hostnames)}) {
        bound[hostname] = {
          listen: await attempt(() => {
            const listener = Bun.listen({ hostname, port: 0, socket });
            listener.stop(true);
            return listener.hostname;
          }),
          serve: await attempt(() => {
            const server = Bun.serve({ hostname, port: 0, fetch: () => new Response("") });
            const { address } = server.address;
            server.stop(true);
            return address;
          }),
          udpSocket: await attempt(async () => {
            const udp = await Bun.udpSocket({ hostname });
            const { address } = udp.address;
            udp.close();
            return address;
          }),
          net: await attempt(() => {
            const server = net.createServer();
            return listening(server, () => server.listen(0, hostname));
          }),
          http: await attempt(() => {
            const server = http.createServer();
            return listening(server, () => server.listen(0, hostname));
          }),
          dgram: await attempt(() => {
            const udp = dgram.createSocket(hostname.includes(":") ? "udp6" : "udp4");
            return listening(udp, () => udp.bind(0, hostname));
          }),
        };
      }
      let resolverRefuses = false;
      try {
        Bun.listen({ hostname: "localhost", port: 0, socket }).stop(true);
      } catch {
        resolverRefuses = true;
      }
      console.log(JSON.stringify({ bound, resolverRefuses }));
    `,
  });
  const shim = join(String(dir), "shim.so");
  await using compile = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(String(dir), "shim.c")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ stderr: await compile.stderr.text(), exitCode: await compile.exited }).toEqual({ stderr: "", exitCode: 0 });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const everyApi = (address: string) => ({
    listen: address,
    serve: address,
    udpSocket: address,
    net: address,
    http: address,
    dgram: address,
  });
  expect({ result: JSON.parse(stdout || "{}"), stderr }).toEqual({
    result: {
      bound: Object.fromEntries(hostnames.map(hostname => [hostname, everyApi(hostname)])),
      resolverRefuses: true,
    },
    stderr: "",
  });
  expect(exitCode).toBe(0);
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
                // Bun.build() waits for an async setup() by ticking the loop. "timer" before "ticked" proves that it did.
                const setup = () =>
                  new Promise(resolve =>
                    setTimeout(() => {
                      events.push("timer");
                      resolve();
                    }),
                  );
                Bun.build({ entrypoints: ["missing.js"], plugins: [{ name: "waits for a timer", setup }] }).catch(() => {});
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
