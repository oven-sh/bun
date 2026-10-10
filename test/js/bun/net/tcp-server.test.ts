import { connect, listen, SocketHandler, TCPSocketListener } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { connect as tlsConnect, createServer as tlsCreateServer } from "node:tls";

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

it("Bun.listen and Bun.connect take tls.minVersion and tls.maxVersion by name and reject other values", async () => {
  const handlers = { data() {}, open() {}, close() {} };
  const code = (fn: () => unknown) => {
    try {
      fn();
      return "no throw";
    } catch (e: any) {
      return e.code;
    }
  };
  // A listener capped at TLS 1.2.
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls: { ...tls, maxVersion: "TLSv1.2" },
    socket: handlers,
  });

  expect({
    listen: code(() =>
      Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { ...tls, minVersion: "TLSv9" } as any,
        socket: handlers,
      }).stop(true),
    ),
    connect: code(() =>
      Bun.connect({ hostname: "127.0.0.1", port: listener.port, tls: { maxVersion: 13 } as any, socket: handlers }),
    ),
    // Not unset: a `tls` object with nothing set would connect without TLS.
    connectNull: code(() =>
      Bun.connect({ hostname: "127.0.0.1", port: listener.port, tls: { minVersion: null } as any, socket: handlers }),
    ),
  }).toEqual({
    listen: "ERR_TLS_INVALID_PROTOCOL_VERSION",
    connect: "ERR_TLS_INVALID_PROTOCOL_VERSION",
    connectNull: "ERR_TLS_INVALID_PROTOCOL_VERSION",
  });

  // The listener's cap, seen by a client without a cap.
  const viaListener = Promise.withResolvers<string | null>();
  const nodeClient = tlsConnect({ host: "127.0.0.1", port: listener.port, rejectUnauthorized: false }, () => {
    viaListener.resolve(nodeClient.getProtocol());
    nodeClient.end();
  });
  nodeClient.on("error", viaListener.reject);
  expect(await viaListener.promise).toBe("TLSv1.2");

  // A bound as the only key is a TLS config with that bound: against the capped listener the
  // handshake fails on the version. With `tls: true` the handshake reaches the certificate.
  const handshakeFailure = (tlsOption: true | Bun.TLSOptions) => {
    const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
    Bun.connect({
      hostname: "127.0.0.1",
      port: listener.port,
      tls: tlsOption,
      socket: {
        data() {},
        handshake(socket, _success, error: NodeJS.ErrnoException | null) {
          resolve(error?.code);
          socket.end();
        },
        connectError(_socket, error) {
          reject(error);
        },
      },
    }).catch(reject);
    return promise;
  };
  expect({
    boundOnly: await handshakeFailure({ minVersion: "TLSv1.3" }),
    control: await handshakeFailure(true),
  }).toEqual({ boundOnly: "EPROTO", control: "DEPTH_ZERO_SELF_SIGNED_CERT" });

  // A client capped at TLS 1.2, seen by a server without a cap.
  const server = tlsCreateServer({ key: tls.key, cert: tls.cert }, socket => {
    socket.on("error", () => {});
    socket.end(socket.getProtocol() ?? "");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const viaConnect = Promise.withResolvers<string>();
    let received = "";
    await Bun.connect({
      hostname: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      tls: { rejectUnauthorized: false, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
      socket: {
        data(_socket, chunk) {
          received += chunk.toString();
        },
        close() {
          viaConnect.resolve(received);
        },
        error(_socket, err) {
          viaConnect.reject(err);
        },
        connectError(_socket, err) {
          viaConnect.reject(err);
        },
      },
    });
    expect(await viaConnect.promise).toBe("TLSv1.2");
  } finally {
    server.close();
  }
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
