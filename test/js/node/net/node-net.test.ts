import { Socket as _BunSocket, TCPSocketListener } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, it, jest } from "bun:test";
import {
  blackholePortSource,
  bunEnv,
  bunExe,
  bunRun,
  expectMaxObjectTypeCount,
  gc,
  isASAN,
  isDebug,
  isLinux,
  isMusl,
  isWindows,
  tempDir,
  tls as tlsCert,
  tmpdirSync,
} from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { request } from "node:http";
import {
  BlockList,
  connect,
  createConnection,
  createServer,
  isIP,
  isIPv4,
  isIPv6,
  Server,
  setDefaultAutoSelectFamily,
  setDefaultAutoSelectFamilyAttemptTimeout,
  Socket,
  SocketAddress,
  // @ts-expect-error legacy alias
  Stream,
} from "node:net";
import os from "node:os";
import { join } from "node:path";
import { Duplex, duplexPair } from "node:stream";
import { connect as tlsConnect, TLSSocket } from "node:tls";
import { getSystemErrorMap } from "node:util";

const socket_domain = tmpdirSync();

it("Stream should be aliased to Socket", () => {
  // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L2456
  expect(Socket).toBe(Stream);
});

it("should support net.isIP()", () => {
  expect(isIP("::1")).toBe(6);
  expect(isIP("foobar")).toBe(0);
  expect(isIP("127.0.0.1")).toBe(4);
  expect(isIP("127.0.0.1/24")).toBe(0);
  expect(isIP("127.000.000.001")).toBe(0);
});

it("should support net.isIPv4()", () => {
  expect(isIPv4("::1")).toBe(false);
  expect(isIPv4("foobar")).toBe(false);
  expect(isIPv4("127.0.0.1")).toBe(true);
  expect(isIPv4("127.0.0.1/24")).toBe(false);
  expect(isIPv4("127.000.000.001")).toBe(false);
});

it("should support net.isIPv6()", () => {
  expect(isIPv6("::1")).toBe(true);
  expect(isIPv6("foobar")).toBe(false);
  expect(isIPv6("127.0.0.1")).toBe(false);
  expect(isIPv6("127.0.0.1/24")).toBe(false);
  expect(isIPv6("127.000.000.001")).toBe(false);
});

describe("net.BlockList subnet rules", () => {
  // Expected values verified against Node.js v24.
  it("matches IPv4-mapped IPv6 subnet rules against IPv4 and mapped addresses", () => {
    const blockList = new BlockList();
    blockList.addSubnet("::ffff:1.1.1.0", 120, "ipv6");
    expect(blockList.check("1.1.1.1", "ipv4")).toBe(true);
    expect(blockList.check("1.1.2.1", "ipv4")).toBe(false);
    expect(blockList.check("::ffff:1.1.1.1", "ipv6")).toBe(true);
    expect(blockList.check("::ffff:1.1.2.1", "ipv6")).toBe(false);
  });

  it("matches IPv4 subnet rules against IPv4-mapped IPv6 addresses", () => {
    const blockList = new BlockList();
    blockList.addSubnet("1.1.1.0", 24, "ipv4");
    expect(blockList.check("::ffff:1.1.1.1", "ipv6")).toBe(true);
    expect(blockList.check("::ffff:1.1.2.1", "ipv6")).toBe(false);
    expect(blockList.check("::1", "ipv6")).toBe(false);
    expect(blockList.check("1.1.1.255", "ipv4")).toBe(true);
    expect(blockList.check("1.1.2.0", "ipv4")).toBe(false);
  });

  it("does not match IPv4 addresses against non-mapped IPv6 subnet rules", () => {
    const blockList = new BlockList();
    blockList.addSubnet("8592:757c:efae:4e45::", 64, "ipv6");
    expect(blockList.check("1.1.1.1", "ipv4")).toBe(false);
    expect(blockList.check("8592:757c:efae:4e45::f", "ipv6")).toBe(true);
    expect(blockList.check("8592:757c:efaf:4e45::f", "ipv6")).toBe(false);
  });

  it("matches exact-prefix subnet rules", () => {
    const v4 = new BlockList();
    v4.addSubnet("10.0.0.1", 32, "ipv4");
    expect(v4.check("10.0.0.1", "ipv4")).toBe(true);
    expect(v4.check("10.0.0.2", "ipv4")).toBe(false);
    expect(v4.check("::ffff:10.0.0.1", "ipv6")).toBe(true);

    const v6 = new BlockList();
    v6.addSubnet("::1", 128, "ipv6");
    expect(v6.check("::1", "ipv6")).toBe(true);
    expect(v6.check("::2", "ipv6")).toBe(false);

    const mapped = new BlockList();
    mapped.addSubnet("::ffff:10.0.0.1", 128, "ipv6");
    expect(mapped.check("10.0.0.1", "ipv4")).toBe(true);
    expect(mapped.check("10.0.0.2", "ipv4")).toBe(false);
  });

  it("matches zero-prefix subnet rules", () => {
    const v4 = new BlockList();
    v4.addSubnet("0.0.0.0", 0, "ipv4");
    expect(v4.check("255.255.255.255", "ipv4")).toBe(true);
    expect(v4.check("::1", "ipv6")).toBe(false);

    const v6 = new BlockList();
    v6.addSubnet("::", 0, "ipv6");
    expect(v6.check("8592:757c:efae:4e45::f", "ipv6")).toBe(true);
    expect(v6.check("1.2.3.4", "ipv4")).toBe(true);
  });
});

describe("net.BlockList and an IPv6 zone id", () => {
  it("check() matches on the address alone", () => {
    const blockList = new BlockList();
    blockList.addAddress("fe80::1", "ipv6");
    blockList.addAddress("1.2.3.4");
    expect(blockList.check("fe80::1%eth0", "ipv6")).toBe(true);
    expect(blockList.check("fe80::1%", "ipv6")).toBe(true);
    expect(blockList.check("::ffff:1.2.3.4%lo", "ipv6")).toBe(true);
    expect(blockList.check(new SocketAddress({ address: "fe80::1%eth0", family: "ipv6" }))).toBe(true);
    expect(blockList.check("fe80::2%eth0", "ipv6")).toBe(false);
    expect(blockList.check("1.2.3.4%lo")).toBe(false);
  });

  it("a rule drops it", () => {
    const blockList = new BlockList();
    blockList.addAddress("fe80::9%eth0", "ipv6");
    blockList.addRange("fe80::10%eth0", "fe80::20%eth1", "ipv6");
    blockList.addSubnet("fd00::%eth0", 64, "ipv6");
    expect(blockList.rules).toEqual([
      "Subnet: IPv6 fd00::/64",
      "Range: IPv6 fe80::10-fe80::20",
      "Address: IPv6 fe80::9",
    ]);
    expect(new SocketAddress({ address: "fe80::9%eth0", family: "ipv6" }).address).toBe("fe80::9");
  });

  it("connect() refuses a blocked address", async () => {
    const blockList = new BlockList();
    blockList.addAddress("::1", "ipv6");
    const socket = connect({ host: "::1%lo", port: 1, blockList });
    const [error] = await once(socket, "error");
    expect(error.code).toBe("ERR_IP_BLOCKED");
  });
});

describe("net.Socket read", () => {
  var unix_servers = 0;
  for (let [message, label] of [
    ["Hello World!".repeat(1024), "long message"],
    ["Hello!", "short message"],
  ]) {
    describe(label, () => {
      function runWithServer(cb: (..._: any[]) => void, unix_domain_path?: any) {
        return (done: (_: any) => void) => {
          function drain(socket: _BunSocket<{ message: string }>) {
            const message = socket.data.message;
            const written = socket.write(message);
            if (written < message.length) {
              socket.data.message = message.slice(written);
            } else {
              socket.end();
            }
          }

          var server = unix_domain_path
            ? Bun.listen({
                unix: join(unix_domain_path, `${unix_servers++}.sock`),
                socket: {
                  open(socket) {
                    socket.data.message = message;
                    drain(socket);
                  },
                  drain,
                  error(socket, err) {
                    done(err);
                  },
                },
                data: {
                  message: "",
                },
              })
            : Bun.listen({
                hostname: "127.0.0.1",
                port: 0,
                socket: {
                  open(socket) {
                    socket.data.message = message;
                    drain(socket);
                  },
                  drain,
                  error(socket, err) {
                    done(err);
                  },
                },
                data: {
                  message: "",
                },
              });

          function onDone(err: any) {
            server.stop();
            done(err);
          }

          try {
            cb(server, drain, onDone);
          } catch (e) {
            onDone(e);
          }
        };
      }

      it(
        "should work with .connect(port)",
        runWithServer((server, drain, done) => {
          var data = "";
          const socket = new Socket()
            .connect(server.port)
            .on("connect", () => {
              expect(socket).toBeDefined();
              expect(socket.connecting).toBe(false);
            })
            .setEncoding("utf8")
            .on("data", chunk => {
              data += chunk;
            })
            .on("end", () => {
              try {
                expect(data).toBe(message);
                done();
              } catch (e) {
                server.stop();
                done(e);
              }
            })
            .on("error", done);
        }),
      );

      it(
        "should work with .connect(port, listener)",
        runWithServer((server, drain, done) => {
          var data = "";
          const socket = new Socket()
            .connect(server.port, () => {
              expect(socket).toBeDefined();
              expect(socket.connecting).toBe(false);
            })
            .setEncoding("utf8")
            .on("data", chunk => {
              data += chunk;
            })
            .on("end", () => {
              try {
                expect(data).toBe(message);
                done();
              } catch (e) {
                server.stop();
                done(e);
              }
            })
            .on("error", done);
        }),
      );

      it(
        "should work with .connect(port, host, listener)",
        runWithServer((server, drain, done) => {
          var data = "";
          const socket = new Socket()
            .connect(server.port, "localhost", () => {
              expect(socket).toBeDefined();
              expect(socket.connecting).toBe(false);
            })
            .setEncoding("utf8")
            .on("data", chunk => {
              data += chunk;
            })
            .on("end", () => {
              try {
                expect(data).toBe(message);
                done();
              } catch (e) {
                done(e);
              }
            })
            .on("error", done);
        }),
      );

      it(
        "should work with .createConnection(path)",
        runWithServer((server, drain, done) => {
          var data = "";
          const socket = createConnection(server.unix)
            .on("connect", () => {
              expect(socket).toBeDefined();
              expect(socket.connecting).toBe(false);
            })
            .setEncoding("utf8")
            .on("data", chunk => {
              data += chunk;
            })
            .on("end", () => {
              try {
                expect(data).toBe(message);
                done();
              } catch (e) {
                server.stop();
                done(e);
              }
            })
            .on("error", done);
        }, socket_domain),
      );
      it(
        "should work with .connect(path)",
        runWithServer((server, drain, done) => {
          var data = "";
          const socket = new Socket()
            .connect(server.unix)
            .on("connect", () => {
              expect(socket).toBeDefined();
              expect(socket.connecting).toBe(false);
            })
            .setEncoding("utf8")
            .on("data", chunk => {
              data += chunk;
            })
            .on("end", () => {
              try {
                expect(data).toBe(message);
                done();
              } catch (e) {
                server.stop();
                done(e);
              }
            })
            .on("error", done);
        }, socket_domain),
      );

      it(
        "should work with .connect(path, listener)",
        runWithServer((server, drain, done) => {
          var data = "";
          const socket = new Socket()
            .connect(server.unix, () => {
              expect(socket).toBeDefined();
              expect(socket.connecting).toBe(false);
            })
            .setEncoding("utf8")
            .on("data", chunk => {
              data += chunk;
            })
            .on("end", () => {
              try {
                expect(data).toBe(message);
                done();
              } catch (e) {
                done(e);
              }
            })
            .on("error", done);
        }, socket_domain),
      );

      it(
        "should support onread callback",
        runWithServer((server, drain, done) => {
          var data = "";
          const options = {
            host: server.hostname,
            port: server.port,
            onread: {
              buffer: Buffer.alloc(4096),
              callback: (size, buf): any => {
                data += buf.slice(0, size).toString("utf8");
              },
            },
          };
          const socket = createConnection(options, () => {
            expect(socket).toBeDefined();
            expect(socket.connecting).toBe(false);
          })
            .on("end", () => {
              try {
                expect(data).toBe(message);
                done();
              } catch (e) {
                done(e);
              }
            })
            .on("error", done);
        }),
      );
    });
  }
});

describe("net.Socket write", () => {
  const message = "Hello World!".repeat(1024);

  function runWithServer(cb: (..._: any[]) => void) {
    return (done: (_?: any) => void) => {
      let server: TCPSocketListener<unknown>;

      function close(socket: _BunSocket<Buffer[]>) {
        expect(Buffer.concat(socket.data).toString("utf8")).toBe(message);
        server.stop();
        done();
      }

      var leaky;
      server = Bun.listen({
        hostname: "0.0.0.0",
        port: 0,
        socket: {
          close,
          data(socket, buffer) {
            leaky = socket;
            if (!Buffer.isBuffer(buffer)) {
              done(new Error("buffer is not a Buffer"));
            }

            socket.data.push(buffer);
          },
          end: close,
          error(socket, err) {
            leaky = socket;
            done(err);
          },
          open(socket) {
            leaky = socket;
            socket.data = [];
          },
        },
        data: [] as Buffer[],
      });

      function onDone(err: any) {
        server.stop();
        done(err);
      }

      try {
        cb(server, onDone);
      } catch (e) {
        onDone(e);
      }
    };
  }

  it(
    "should work with .end(data)",
    runWithServer((server, done) => {
      const socket = new Socket()
        .connect(server.port, server.hostname)
        .on("ready", () => {
          expect(socket).toBeDefined();
          expect(socket.connecting).toBe(false);
        })
        .on("error", done)
        .end(message);
    }),
  );

  it(
    "should work with .write(data).end()",
    runWithServer((server, done) => {
      const socket = new Socket()
        .connect(server.port, server.hostname, () => {
          expect(socket).toBeDefined();
          expect(socket.connecting).toBe(false);
        })
        .on("error", done);
      socket.write(message);
      socket.end();
    }),
  );

  it(
    "should work with multiple .write()s",
    runWithServer((server, done) => {
      const socket = new Socket()
        .connect(server.port, server.hostname, () => {
          expect(socket).toBeDefined();
          expect(socket.connecting).toBe(false);
        })
        .on("error", done);
      const size = 10;
      for (let i = 0; i < message.length; i += size) {
        socket.write(message.slice(i, i + size));
      }
      socket.end();
    }),
  );

  it("should allow reconnecting after end()", async () => {
    const server = new Server(socket => socket.end());
    const port = await new Promise<number>(resolve => {
      server.once("listening", () => resolve((server.address() as import("node:net").AddressInfo).port));
      server.listen();
    });

    const socket = new Socket();
    socket.on("data", data => console.log(data.toString()));
    socket.on("error", err => console.error(err));

    async function run() {
      return new Promise((resolve, reject) => {
        socket.once("connect", (...args) => {
          socket.write("script\n", err => {
            if (err) return reject(err);
            socket.once("close", resolve);
            socket.end();
          });
        });
        socket.connect(port, "127.0.0.1");
      });
    }

    for (let i = 0; i < 10; i++) {
      await run();
    }
    server.close();
  });

  // Client-mode `Handlers.markInactive()` frees the per-connection Handlers
  // allocation when the last reference drops, but the native socket's
  // `handlers` field was left pointing at the freed block. Reusing that
  // native socket as `prev` in `connectInner` (the net.Socket reconnect
  // path) then called `deinit()`/`destroy()` on freed memory, and
  // `getListener` read `handlers.mode` through the same dangling pointer.
  // These only fault under ASAN/debug-poison, so they are gated accordingly.
  it.concurrent.skipIf(!isDebug && !isASAN)(
    "native handle does not retain a dangling handlers pointer after connectError (scope.exit path)",
    async () => {
      const fixture = `
        const net = require("node:net");
        const s = new net.Socket();
        let handle;
        s.on("error", () => {});
        // Capture the native handle before _destroy nulls s._handle.
        s.once("connectionAttemptFailed", () => { handle = s._handle; });
        s.on("close", () => {
          // handleConnectError never reached markActive (is_active == false),
          // so the socket-level markInactive is a no-op. The Handlers were
          // freed by scope.exit() — which must also null the socket's field.
          for (let i = 0; i < 100; i++) {
            if (handle.listener !== undefined) {
              console.error("unexpected listener");
              process.exit(1);
            }
          }
          console.log("ok");
        });
        s.connect(1, "127.0.0.1");
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.skipIf(!isDebug && !isASAN)(
    "native handle does not retain a dangling handlers pointer after close (getListener)",
    async () => {
      const fixture = `
        const net = require("node:net");
        const server = net.createServer(c => c.end());
        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const s = new net.Socket();
          let handle;
          s.on("error", () => {});
          s.on("connect", () => { handle = s._handle; });
          s.on("close", () => {
            // markInactive has freed the Handlers; without the fix the
            // native socket's 'handlers' still points at it and
            // '.listener' reads 'handlers.mode'.
            for (let i = 0; i < 100; i++) {
              if (handle.listener !== undefined) {
                console.error("unexpected listener value");
                process.exit(1);
              }
            }
            server.close(() => console.log("ok"));
          });
          s.connect(port, "127.0.0.1");
        });
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.skipIf(!isDebug && !isASAN)(
    "reconnecting through a native handle whose handlers were freed does not double-free (connectInner)",
    async () => {
      const fixture = `
        const net = require("node:net");
        const server = net.createServer(c => c.end());
        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          let iterations = 0;
          function once(done) {
            const s = new net.Socket();
            let handle;
            s.on("error", () => {});
            s.on("connect", () => { handle = s._handle; });
            s.on("close", () => {
              // Route a second connect through the same native socket.
              // connectInner sees prev.handlers (stale) and — without the
              // fix — calls deinit()/destroy() on the freed allocation.
              const s2 = new net.Socket();
              s2._handle = handle;
              s2.on("error", () => {});
              s2.on("connect", () => s2.destroy());
              s2.on("close", () => done());
              s2.connect(port, "127.0.0.1");
            });
            s.connect(port, "127.0.0.1");
          }
          (function next() {
            if (iterations++ < 5) once(next);
            else server.close(() => console.log(JSON.stringify({ iterations })));
          })();
        });
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({ iterations: 6 });
      expect(exitCode).toBe(0);
    },
  );
});

it("should handle connection error", async () => {
  // Bind a port and release it so connecting to it is refused.
  const probe = createServer();
  await once(probe.listen(0, "127.0.0.1"), "listening");
  const { port } = probe.address() as import("node:net").AddressInfo;
  await new Promise(resolve => probe.close(resolve));

  const { promise: closed, resolve, reject } = Promise.withResolvers<void>();
  const events: unknown[] = [];
  const socket = connect(port, "127.0.0.1", () => reject(new Error("Should not have connected")));
  socket.on("error", (e: any) =>
    events.push({ message: e.message, code: e.code, syscall: e.syscall, address: e.address, port: e.port }),
  );
  socket.on("connect", () => reject(new Error("Should not have connected")));
  socket.on("close", hadError => {
    events.push(`close hadError=${hadError}`);
    resolve();
  });
  await closed;

  // Exactly one 'error', then 'close'.
  expect(events).toEqual([
    {
      message: `connect ECONNREFUSED 127.0.0.1:${port}`,
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "127.0.0.1",
      port,
    },
    "close hadError=true",
  ]);
});

// Linux fails a TCP connect() to a multicast address with ENETUNREACH, with or without a route.
it.skipIf(!isLinux)("reports ENETUNREACH, not ECONNREFUSED, when connect() finds no route", async () => {
  const socket = connect(1, "224.0.0.1");
  const [error] = await once(socket, "error");
  expect({ message: error.message, code: error.code, syscall: error.syscall }).toEqual({
    message: "connect ENETUNREACH 224.0.0.1:1",
    code: "ENETUNREACH",
    syscall: "connect",
  });
});

it("should handle connection error (unix)", done => {
  let errored = false;

  // @ts-ignore
  const socket = connect("loser", () => {
    done(new Error("Should not have connected"));
  });

  socket.on("error", error => {
    if (errored) {
      return done(new Error("Should not have errored twice"));
    }
    errored = true;
    expect(error).toBeDefined();
    expect(error.message).toBe("connect ENOENT loser");
    expect((error as any).code).toBe("ENOENT");
    expect((error as any).syscall).toBe("connect");
    expect((error as any).address).toBe("loser");
  });

  socket.on("connect", () => {
    done(new Error("Should not have connected"));
  });

  socket.on("close", () => {
    expect(errored).toBe(true);
    done();
  });
});

it("Socket has a prototype", () => {
  function Connection() {}
  function Connection2() {}
  require("util").inherits(Connection, Socket);
  require("util").inherits(Connection2, require("tls").TLSSocket);
  expect(Object.getPrototypeOf(Connection.prototype)).toBe(Socket.prototype);
  expect(Object.getPrototypeOf(Connection2.prototype)).toBe(TLSSocket.prototype);
});

// node-unref-fixture.js and node-ref-default-fixture.js send a request to this TLS server.
function replyingTLSServer() {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls: tlsCert,
    socket: {
      data(socket) {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
      },
      // The unref fixture exits mid-handshake.
      error() {},
    },
  });
}

it.concurrent("unref should exit when no more work pending", async () => {
  using server = replyingTLSServer();
  const { stdout, stderr, exitCode } = await bunRun(join(import.meta.dir, "node-unref-fixture.js"), {
    PORT: String(server.port),
  });
  // The fixture prints "Received data. FAIL" and exits 1 if the unref'd socket kept the loop alive until the reply.
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
});

// IPv4-only server + injected lookup listing ::1 first forces a refused attempt then a retry; the call runs mid-lookup
// and must carry over to the retry handle. The pending connect holds the loop by itself; once connected it lets go.
it.concurrent.each(["s.unref()", "s.pause()"])("%s survives an autoSelectFamily retry", async call => {
  const server = createServer(() => {});
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const lookup = (host, opts, cb) =>
            setTimeout(() => cb(null, [{ address: "::1", family: 6 }, { address: "127.0.0.1", family: 4 }]), 10);
          const s = net.connect({ host: "localhost", port: ${(server.address() as import("node:net").AddressInfo).port}, autoSelectFamily: true, lookup });
          s.on("error", e => process.stdout.write("error " + e.code + "\\n"));
          s.on("connect", () => process.stdout.write("connected " + s.remoteAddress + "\\n"));
          ${call};
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("connected 127.0.0.1\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  } finally {
    server.close();
  }
});

it.concurrent.each([false, true])(
  "destroy() in a 'connectionAttempt' listener cancels the connect (autoSelectFamily: %p)",
  async autoSelectFamily => {
    const accepted: string[] = [];
    const server = createServer(socket => {
      accepted.push(`${socket.remoteAddress}:${socket.remotePort}`);
      socket.on("error", () => {});
      socket.end();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const port = server.address().port;
      // Two addresses, so autoSelectFamily doesn't fall back to the single-address path.
      const addresses = [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ];
      const lookup = (_host, opts, cb) => process.nextTick(cb, null, opts.all ? addresses : "127.0.0.1", 4);
      const socket = connect({ host: "localhost", port, lookup, autoSelectFamily });
      let attempts = 0;
      socket.on("connectionAttempt", () => {
        attempts++;
        socket.destroy();
      });
      await once(socket, "close");

      // Loopback connects are accepted in order, so an earlier connect would show up before this one.
      const control = connect(port, "127.0.0.1");
      await once(control, "connect");
      const controlKey = `${control.localAddress}:${control.localPort}`;
      while (!accepted.includes(controlKey)) await once(server, "connection");
      control.destroy();

      expect({ attempts, accepted }).toEqual({ attempts: 1, accepted: [controlKey] });
    } finally {
      server.close();
    }
  },
);

// https://github.com/oven-sh/bun/issues/37086 — node's pending uv_connect_t keeps the loop alive even on an
// unref'd/non-reading handle, so unref()/pause() issued before or while connecting only take effect once connected.
describe.concurrent("unref()/pause() around connect()", () => {
  async function run(client: string, onConnection = "c => c.unref()") {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const server = net.createServer(${onConnection});
          server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            const s = new net.Socket();
            s.on("connect", () => process.stdout.write("connected\\n"));
            s.on("close", () => { process.stdout.write("closed\\n"); server.close(); });
            ${client}
          });
          server.unref();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // net.ts hands the connect to the native socket on the next tick, so two ticks in the
  // attempt is in flight (the handle exists but is not yet established).
  const inFlight = (code: string) => `process.nextTick(() => process.nextTick(() => { ${code} }));`;
  it.each([
    ["unref() before connect()", `s.unref(); s.connect(port, "127.0.0.1");`],
    ["unref() right after connect()", `s.connect(port, "127.0.0.1"); s.unref();`],
    ["unref() while the connect is in flight", `s.connect(port, "127.0.0.1"); ${inFlight("s.unref();")}`],
    ["pause() before connect()", `s.pause(); s.connect(port, "127.0.0.1");`],
    ["pause() right after connect()", `s.connect(port, "127.0.0.1"); s.pause();`],
    ["pause() while the connect is in flight", `s.connect(port, "127.0.0.1"); ${inFlight("s.pause();")}`],
  ])("%s waits for the connection, then lets the process exit", async (_, client) => {
    const { stdout, stderr, exitCode } = await run(client);
    expect(stdout).toBe("connected\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it.each([
    ["before connect()", `s.unref(); s.ref(); s.resume(); s.connect(port, "127.0.0.1");`],
    ["right after connect()", `s.connect(port, "127.0.0.1"); s.unref(); s.ref(); s.resume();`],
    ["while the connect is in flight", `s.connect(port, "127.0.0.1"); ${inFlight("s.unref(); s.ref(); s.resume();")}`],
  ])("ref() after unref() %s keeps holding the loop", async (_, client) => {
    const { stdout, stderr, exitCode } = await run(client, "c => { c.unref(); c.end(); }");
    expect(stdout).toBe("connected\nclosed\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // A pause() that reached the native socket mid-connect used to latch its paused bit while the
  // open re-armed reads, so backpressure could never pause it again and the buffer grew unbounded.
  it("pause() while the connect is in flight still lets backpressure stop reads", async () => {
    const chunk = Buffer.alloc(64 * 1024, "x");
    let serverBackedUp = false;
    await using server = createServer(c => {
      const pump = () => {
        while (!c.destroyed && c.write(chunk)) {}
        serverBackedUp = !c.destroyed;
      };
      c.on("drain", pump);
      c.on("error", () => {});
      pump();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const s = new Socket();
    try {
      s.connect((server.address() as any).port, "127.0.0.1");
      await new Promise<void>(resolve =>
        process.nextTick(() =>
          process.nextTick(() => {
            s.pause();
            resolve();
          }),
        ),
      );
      await once(s, "connect");
      // Once the client stops reading (buffer past the high-water mark, or never started) the
      // server backs up; from then on bytesRead must stay put. Unpatched, every loop turn
      // delivered another recv; allow a couple that were already in flight.
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline && !serverBackedUp && s.readableLength < s.readableHighWaterMark)
        await new Promise(r => setTimeout(r, 1));
      expect(serverBackedUp || s.readableLength >= s.readableHighWaterMark).toBeTrue();
      const settled = s.bytesRead;
      for (let i = 0; i < 100; i++) await new Promise(r => setTimeout(r, 0));
      const recvBuffer = 512 * 1024;
      expect(s.bytesRead - settled).toBeLessThanOrEqual(2 * recvBuffer);
    } finally {
      s.destroy();
    }
  });
});

it.concurrent("socket should keep process alive if unref is not called", async () => {
  using server = replyingTLSServer();
  const { stdout, stderr, exitCode } = await bunRun(join(import.meta.dir, "node-ref-default-fixture.js"), {
    PORT: String(server.port),
  });
  // The fixture exits 1 from its 'data' listener. It exits 0 if the socket didn't keep the loop alive until the reply.
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "Received data.", stderr: "", exitCode: 1 });
});

// Node never resumes a socket on the user's behalf: afterConnect only calls
// read(0) (lib/net.js), so bytes that arrive before a 'data' listener is
// attached stay buffered instead of being emitted to nobody and lost.
it.concurrent("a connected socket is not flowing until the user reads from it", async () => {
  const { promise: received, resolve: onClose, reject } = Promise.withResolvers<string>();
  const server = createServer(c => {
    c.on("error", reject);
    c.end("early-data");
  });
  let client: Socket | undefined;
  try {
    // events.once rejects these awaits if 'error' is emitted instead.
    await once(server.listen(0, "127.0.0.1"), "listening");
    client = createConnection((server.address() as import("node:net").AddressInfo).port, "127.0.0.1");
    await once(client, "connect");
    client.on("error", reject);
    expect(client.readableFlowing).toBeNull();
    client.setEncoding("utf8");
    let data = "";
    client.on("data", chunk => (data += chunk));
    client.on("close", () => onClose(data));
    expect(await received).toBe("early-data");
  } finally {
    client?.destroy();
    server.close();
  }
});

it.concurrent("should not hang after FIN", async () => {
  const server = createServer(c => {
    c.write("Hello client");
    c.end();
  });
  try {
    await once(server.listen(0), "listening");
    const { stdout, stderr, exitCode } = await bunRun(join(import.meta.dir, "node-fin-fixture.js"), {
      PORT: String((server.address() as import("node:net").AddressInfo).port),
    });
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  } finally {
    server.close();
  }
});

it.concurrent("should not hang after destroy", async () => {
  const server = createServer(c => {
    // The client destroys without reading; the resulting RST surfaces as
    // ECONNRESET here (Node behaves identically) — handle it.
    c.on("error", () => {});
    c.write("Hello client");
  });
  try {
    await once(server.listen(0), "listening");
    const { stdout, stderr, exitCode } = await bunRun(join(import.meta.dir, "node-destroy-fixture.js"), {
      PORT: String((server.address() as import("node:net").AddressInfo).port),
    });
    // The fixture prints any 'error' event to stderr.
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  } finally {
    server.close();
  }
});

// Never calls back, so the connection attempt stays pending and never dials.
const pendingLookup = () => {};

it("should trigger error when aborted even if connection failed #13126", async () => {
  const signal = AbortSignal.timeout(100);
  const socket = createConnection({
    host: "pending.test",
    port: 999,
    lookup: pendingLookup,
    signal: signal,
  });
  const { promise, resolve, reject } = Promise.withResolvers();

  socket.on("connect", reject);
  socket.on("error", resolve);

  // Node destroys the socket with an AbortError carrying the signal's reason as `cause`.
  const err = (await promise) as Error & { code?: string; cause?: Error };
  expect(err.name).toBe("AbortError");
  expect(err.code).toBe("ABORT_ERR");
  expect(err.cause?.name).toBe("TimeoutError");
});

// Aborts a TCP connect that's already in flight. blackholePortSource doesn't work on Windows or musl.
it.skipIf(isWindows || isMusl).each([
  ["an address", `{ host: "127.0.0.1" }`],
  [
    "several addresses",
    `{
      host: "blackhole.test",
      autoSelectFamily: true,
      lookup: (hostname, options, callback) =>
        process.nextTick(callback, null, [{ address: "127.0.0.1", family: 4 }, { address: "127.0.0.2", family: 4 }]),
    }`,
  ],
])("should trigger error when aborted while connecting to %s #13126", async (_, options) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      ${blackholePortSource}
      const events = [];
      const socket = net.createConnection({ ...${options}, port, signal: AbortSignal.timeout(100) });
      for (const name of ["connectionAttempt", "connect"]) socket.on(name, () => events.push(name));
      socket.on("error", error => events.push([error.name, error.code, error.cause?.name].join(" ")));
      socket.on("close", () => {
        console.log(events.join(","));
        filler.destroy();
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "connectionAttempt,AbortError ABORT_ERR TimeoutError\n",
    stderr: "",
    exitCode: 0,
  });
});

it("should trigger error when aborted even if connection failed, and the signal is already aborted #13126", async () => {
  const signal = AbortSignal.timeout(1);
  if (!signal.aborted) await once(signal, "abort");
  const socket = createConnection({
    host: "pending.test",
    port: 999,
    lookup: pendingLookup,
    signal: signal,
  });
  const { promise, resolve, reject } = Promise.withResolvers();

  socket.on("connect", reject);
  socket.on("error", resolve);

  // Node destroys the socket with an AbortError carrying the signal's reason as `cause`.
  const err = (await promise) as Error & { code?: string; cause?: Error };
  expect(err.name).toBe("AbortError");
  expect(err.code).toBe("ABORT_ERR");
  expect(err.cause?.name).toBe("TimeoutError");
});

it.each([false, true])(
  "doesn't connect when the lookup answers after the abort (autoSelectFamily: %p) #13126",
  async autoSelectFamily => {
    let accepted = 0;
    await using server = createServer(connection => {
      accepted++;
      connection.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");

    const controller = new AbortController();
    const reason = new Error("lookup aborted");
    const events: unknown[] = [];
    const socket = new Socket({ signal: controller.signal });
    for (const name of ["connectionAttempt", "connect", "close"]) socket.on(name, () => events.push(name));
    socket.on("error", (error: NodeJS.ErrnoException) =>
      events.push({ name: error.name, code: error.code, sameCause: error.cause === reason }),
    );

    const lookupStarted = Promise.withResolvers<() => void>();
    socket.connect({
      host: "held-lookup.test",
      port: (server.address() as import("node:net").AddressInfo).port,
      autoSelectFamily,
      lookup(_hostname, options, callback) {
        lookupStarted.resolve(() =>
          options.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4),
        );
      },
    });
    const answerLookup = await lookupStarted.promise;
    const closed = new Promise(resolve => socket.once("close", resolve));
    controller.abort(reason);
    await closed;

    answerLookup();
    await new Promise(resolve => setImmediate(resolve));
    expect({ events, accepted, destroyed: socket.destroyed }).toEqual({
      events: [{ name: "AbortError", code: "ABORT_ERR", sameCause: true }, "close"],
      accepted: 0,
      destroyed: true,
    });
  },
);

// Regression test for #30697: net.connect({ localPort, lookup }) on the
// happy-eyeballs path must not throw a ReferenceError before the socket
// is opened.
describe("net.connect({ localPort }) with multiple lookup addresses #30697", () => {
  describe.each([
    {
      label: "IPv4 first",
      addresses: [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ],
    },
    {
      label: "IPv6 first",
      addresses: [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ],
    },
  ])("$label", ({ addresses }) => {
    it("does not throw ReferenceError", async () => {
      const { promise: listening, resolve: onListen, reject: onListenError } = Promise.withResolvers<Server>();
      const server = createServer();
      server.once("error", onListenError);
      // Listen on 127.0.0.1 only; an IPv6-first attempt fails fast and
      // happy-eyeballs falls through to the IPv4 address.
      server.listen(0, "127.0.0.1", () => onListen(server));
      await using _server = await listening;
      const { port } = server.address() as { port: number };

      // Non-zero localPort is required to enter the branch that used to
      // crash, and the local bind is actually applied during connect, so it
      // must be a free unprivileged port: grab an ephemeral one and release it.
      const { promise: probing, resolve: onProbe, reject: onProbeError } = Promise.withResolvers<number>();
      const probe = createServer();
      probe.once("error", onProbeError);
      probe.listen(0, "127.0.0.1", () => onProbe((probe.address() as { port: number }).port));
      const localPort = await probing;
      await new Promise(resolve => probe.close(resolve));

      const { promise: connected, resolve: onConnect, reject: onError } = Promise.withResolvers<void>();
      const client = new Socket();
      client.on("error", onError);
      client.on("connect", () => onConnect());

      client.connect({
        port,
        host: "localhost",
        localPort,
        lookup: (_hostname, _opts, cb) => cb(null, addresses),
      } as any);

      try {
        await connected;
      } finally {
        client.destroy();
      }
    });
  });
});

it.if(isWindows)(
  "should work with named pipes",
  async () => {
    async function test(pipe_name: string) {
      const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers();
      const { promise: clientReceived, resolve: resolveClientReceived } = Promise.withResolvers();
      let client: ReturnType<typeof connect> | null = null;
      let server: ReturnType<typeof createServer> | null = null;
      try {
        server = createServer(socket => {
          socket.on("data", data => {
            const message = data.toString();
            socket.end("Goodbye World!");
            resolveMessageReceived(message);
          });
        });

        server.listen(pipe_name);
        client = connect(pipe_name).on("data", data => {
          const message = data.toString();
          resolveClientReceived(message);
        });

        client?.write("Hello World!");
        const message = await messageReceived;
        expect(message).toBe("Hello World!");
        const client_message = await clientReceived;
        expect(client_message).toBe("Goodbye World!");
      } finally {
        client?.destroy();
        server?.close();
      }
    }

    // The pipe transport keeps one wrapper reachable regardless of how many
    // connections were made (1 after one exchange, still 1 after hundreds), so
    // take the baseline after a warm-up exchange: the 700 below must not add to it.
    await test(`\\\\.\\pipe\\test\\${randomUUID()}`);
    gc(true);
    const before = heapStats().objectTypeCounts.TCPSocket || 0;
    const batch: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      batch.push(test(`\\\\.\\pipe\\test\\${randomUUID()}`));
      batch.push(test(`\\\\?\\pipe\\test\\${randomUUID()}`));
      batch.push(test(`//?/pipe/test/${randomUUID()}`));
      batch.push(test(`//./pipe/test/${randomUUID()}`));
      batch.push(test(`/\\./pipe/test/${randomUUID()}`));
      batch.push(test(`/\\./pipe\\test/${randomUUID()}`));
      batch.push(test(`\\/.\\pipe/test\\${randomUUID()}`));
      if (i % 50 === 0) {
        await Promise.all(batch);
        batch.length = 0;
      }
    }
    await Promise.all(batch);
    // Awaited: left dangling, the assertion landed inside whichever later test
    // was running and counted that test's live sockets.
    await expectMaxObjectTypeCount(expect, "TCPSocket", before);
  },
  20_000,
);

// The Windows counterpart of the synchronous-failure test below: a client
// that polls for a daemon's pipe gets one asynchronous ENOENT per attempt,
// and each failed attempt used to leave its native pipe context (and the
// context's ref on the native socket) behind. Runs in a child so the context
// count starts from zero: the test above leaves connections still closing.
it.if(isWindows)("should not leak when connect({path}) fails asynchronously while polling for a pipe", async () => {
  const script = /* js */ `
    const { createServer, Socket } = require("node:net");
    const { once } = require("node:events");
    const { namedPipeInternals } = require("bun:internal-for-testing");
    const path = "\\\\\\\\.\\\\pipe\\\\bun-test-polling-" + process.pid;
    const events = [];
    // Not events.once(): it rejects on the 'error' that precedes each 'close' here.
    function watch(socket) {
      socket.on("error", err => events.push("error:" + err.code));
      socket.on("connect", () => events.push("connect"));
      return new Promise(resolve => socket.on("close", hadError => (events.push("close:" + hadError), resolve())));
    }

    for (let i = 0; i < 4; i++) {
      const socket = new Socket();
      const closed = watch(socket);
      socket.connect({ path });
      await closed;
    }

    // The daemon shows up: the same path now connects, and that connection closes cleanly on both ends.
    const serverSideClosed = Promise.withResolvers();
    const server = createServer(socket => {
      socket.on("close", serverSideClosed.resolve);
      socket.end("ready");
    });
    server.listen(path);
    await once(server, "listening");
    const client = new Socket();
    const clientClosed = watch(client);
    client.setEncoding("utf8");
    let received = "";
    let contextsWhileConnected = -1;
    client.on("data", chunk => {
      received += chunk;
      // Both ends of the live connection own a context; the failed attempts' contexts must be gone.
      contextsWhileConnected = namedPipeInternals.liveCount();
    });
    client.connect({ path });
    await clientClosed;
    await serverSideClosed.promise;
    server.close();

    // Finalizing the handles must not touch a socket its context already released.
    Bun.gc(true);
    // A context frees itself from a task it queues once its pipe has closed.
    for (let i = 0; i < 100 && namedPipeInternals.liveCount() > 0; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    console.log(JSON.stringify({ events, received, contextsWhileConnected, contextsAtEnd: namedPipeInternals.liveCount() }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // If the child died before reporting, the diff shows its raw output.
  const result = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
  expect({ result, stderr, exitCode }).toEqual({
    result: {
      events: [...Array(4).fill(["error:ENOENT", "close:true"]).flat(), "connect", "close:false"],
      received: "ready",
      contextsWhileConnected: 2,
      contextsAtEnd: 0,
    },
    stderr: "",
    exitCode: 0,
  });
});

// node only reaches readStart() from _read(), and read(0) never calls _read once
// the readable side has ended, so a `readable: false` client leaves the peer's
// bytes unread. Bun's handle reads unless stopped, and pushing those bytes into
// the ended Readable raised ERR_STREAM_PUSH_AFTER_EOF.
it("a client dialed with readable: false never reads and keeps writing", async () => {
  const done = Promise.withResolvers<string>();
  const server = createServer(socket => {
    socket.on("error", done.reject);
    socket.setEncoding("utf8");
    let got = "";
    socket.on("data", chunk => {
      got += chunk;
      if (got.endsWith("second\n")) done.resolve(got);
    });
    socket.write("banner\n");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const client = connect({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      readable: false,
    });
    client.on("error", done.reject);
    const events: string[] = [];
    for (const name of ["data", "end", "close"]) client.on(name, () => events.push(name));
    await once(client, "connect");
    client.write("first\n");
    // The banner is in flight the whole time; give the loop several turns to
    // (wrongly) read it before the second write proves the socket still works.
    for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve));
    client.resume();
    client.write("second\n");
    expect(await done.promise).toBe("first\nsecond\n");
    expect({
      events,
      destroyed: client.destroyed,
      readable: client.readable,
      readableEnded: client.readableEnded,
    }).toEqual({
      events: [],
      destroyed: false,
      readable: false,
      readableEnded: true,
    });
    client.destroy();
    await once(client, "close");
  } finally {
    server.close();
  }
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L830-L845
it("an onread client dialed with readable: false still reads into its buffer", async () => {
  const server = createServer(socket => socket.end("banner"));
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const done = Promise.withResolvers<string>();
    let got = "";
    const client = connect({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      readable: false,
      onread: {
        buffer: Buffer.alloc(64),
        callback(n: number, buf: Buffer): any {
          got += buf.toString("latin1", 0, n);
          if (got === "banner") done.resolve(got);
        },
      },
    });
    const closed = once(client, "close");
    client.on("error", done.reject);
    client.on("close", () => done.reject(new Error(`closed after ${JSON.stringify(got)}`)));
    expect(await done.promise).toBe("banner");
    client.destroy();
    await closed;
  } finally {
    server.close();
  }
});

it("passes readable / writable through to the Duplex like node (a TLSSocket is always a full duplex)", () => {
  // Values observed under node v26.3.0.
  const a = new Socket({ readable: false });
  const b = new Socket({ writable: false });
  const c = new TLSSocket(undefined as any, { readable: false, writable: false } as any);
  expect({
    a: [a.readable, a.writable, a.readableEnded],
    b: [b.readable, b.writable, b.writableEnded, b.writableFinished],
    c: [c.readable, c.writable],
  }).toEqual({
    a: [false, true, true],
    b: [true, false, true, true],
    c: [true, true],
  });
});

describe("Socket fd adoption", () => {
  // A named pipe with both ends open in this process: the non-blocking read end
  // is opened first so opening the write end does not block. The other fd kind
  // node's `new Socket({ fd })` accepts besides TCP sockets is a pipe.
  function openFifo(name: string, writeFlags: string | number = "w") {
    const path = join(tmpdirSync(), name);
    execFileSync("mkfifo", [path]);
    const rfd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const wfd = fs.openSync(path, writeFlags);
    return { rfd, wfd };
  }
  // Everything the (non-blocking) read end has right now; "" at EOF or when empty.
  function drain(rfd: number) {
    const chunk = Buffer.alloc(256);
    let out = "";
    for (;;) {
      let n: number;
      try {
        n = fs.readSync(rfd, chunk);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EAGAIN") break;
        throw e;
      }
      if (n === 0) break;
      out += chunk.toString("utf8", 0, n);
    }
    return out;
  }
  function fstatCode(fd: number) {
    try {
      fs.fstatSync(fd);
      return "open";
    } catch (e) {
      return (e as NodeJS.ErrnoException).code;
    }
  }

  it.skipIf(isWindows)("writes synchronously to an adopted pipe fd and closes it (> 2) on destroy", async () => {
    const { rfd, wfd } = openFifo("adopted.fifo");
    try {
      const socket = new Socket({ fd: wfd, readable: false, writable: true });
      await new Promise<void>((resolve, reject) => {
        socket.on("close", () => resolve());
        socket.on("error", reject);
        socket.end("hello");
      });
      expect(drain(rfd)).toBe("hello");
      // The handle of an adopted pipe feeds the byte counters like any other.
      expect((socket as any)._bytesDispatched).toBe(5);
      // The adopted fd must be released on destroy (node closes the wrapping
      // libuv handle in the equivalent path).
      expect(fstatCode(wfd)).toBe("EBADF");
    } finally {
      fs.closeSync(rfd);
    }
  });

  // Other platforms still fail the write with EAGAIN.
  describe.skipIf(!isLinux)("over a non-blocking pipe", () => {
    const nonBlocking = fs.constants.O_WRONLY | fs.constants.O_NONBLOCK;

    it("delivers writes bigger than the pipe's buffer", async () => {
      const { rfd, wfd } = openFifo("full.fifo", nonBlocking);
      try {
        const received = new Response(Bun.file(rfd).stream()).bytes();
        const socket = new Socket({ fd: wfd, readable: false, writable: true });
        const chunks = [
          Buffer.alloc(300_000, "a"),
          Buffer.alloc(10, "b"),
          Buffer.alloc(200_000, "c"),
          Buffer.from("d"),
        ];
        socket.write(chunks[0]);
        socket.cork();
        for (const chunk of chunks.slice(1)) socket.write(chunk);
        socket.uncork();
        socket.end();
        await once(socket, "close");
        expect(Buffer.from(await received).equals(Buffer.concat(chunks))).toBe(true);
        expect(socket.bytesWritten).toBe(500_011);
      } finally {
        fs.closeSync(rfd);
      }
    });

    it("destroy() cancels a write the pipe had no room for", async () => {
      const { rfd, wfd } = openFifo("cancel.fifo", nonBlocking);
      try {
        const socket = new Socket({ fd: wfd, readable: false, writable: true });
        const events: string[] = [];
        socket.write(Buffer.alloc(300_000), (err: any) => events.push(`write ${err?.code}`));
        socket.destroy();
        await once(socket, "close");
        expect(events).toEqual(["write ECANCELED"]);
        // Like Node, the reader gets what the pipe had taken and nothing of what was still queued.
        expect(drain(rfd).length).toBe(65_536);
      } finally {
        fs.closeSync(rfd);
      }
    });

    it("fails a queued write with EPIPE when the reader goes away", async () => {
      const { rfd, wfd } = openFifo("reader-gone.fifo", nonBlocking);
      const socket = new Socket({ fd: wfd, readable: false, writable: true });
      const events: string[] = [];
      socket.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.message}`));
      socket.write(Buffer.alloc(300_000), (err: any) => events.push(`write ${err?.code} ${err?.syscall}`));
      fs.closeSync(rfd);
      await new Promise(resolve => socket.on("close", resolve));
      expect({ events, fd: fstatCode(wfd) }).toEqual({
        events: ["write EPIPE write", "error write EPIPE"],
        fd: "EBADF",
      });
    });
  });

  it.skipIf(isWindows)("fails a write to a pipe without a reader the way node does", async () => {
    const { rfd, wfd } = openFifo("no-reader.fifo");
    fs.closeSync(rfd);
    const socket = new Socket({ fd: wfd, readable: false, writable: true });
    const [error] = (await Promise.all([once(socket, "error"), socket.write("x")]))[0] as [NodeJS.ErrnoException];
    expect({ message: error.message, code: error.code, syscall: error.syscall, errno: error.errno }).toEqual({
      message: "write EPIPE",
      code: "EPIPE",
      syscall: "write",
      errno: -os.constants.errno.EPIPE,
    });
  });

  // Whoever adopts a descriptor closes it, so a descriptor has one owner.
  describe.skipIf(isWindows)("a descriptor that a socket of this process owns", () => {
    const refusal = (fd: number) => {
      try {
        new Socket({ fd, readable: false, writable: true });
      } catch (e) {
        const { message, code, syscall } = e as NodeJS.ErrnoException;
        return { message, code, syscall, fd: fstatCode(fd) };
      }
    };
    const refused = { message: "open EEXIST", code: "EEXIST", syscall: "open", fd: "open" };

    it("is refused for a connected socket, which keeps working", async () => {
      const server = createServer(socket => socket.pipe(socket));
      await once(server.listen(0, "127.0.0.1"), "listening");
      const client = connect((server.address() as import("node:net").AddressInfo).port, "127.0.0.1");
      try {
        await once(client, "connect");
        expect(refusal((client as any)._handle.fd)).toEqual(refused);
        client.write("ping");
        expect(String((await once(client, "data"))[0])).toBe("ping");
      } finally {
        client.destroy();
        server.close();
      }
    });

    it("is refused for a second socket over the same pipe", async () => {
      const { rfd, wfd } = openFifo("one-owner.fifo");
      const owner = new Socket({ fd: wfd, readable: false, writable: true });
      try {
        expect(refusal(wfd)).toEqual(refused);
        await new Promise<void>((resolve, reject) => owner.write("mine", err => (err ? reject(err) : resolve())));
        expect(drain(rfd)).toBe("mine");
        owner.destroy();
        await once(owner, "close");
        expect(fstatCode(wfd)).toBe("EBADF");
      } finally {
        owner.destroy();
        fs.closeSync(rfd);
      }
    });
  });

  // stdin, stdout and stderr are never closed, so they have no owner.
  it("two sockets can write to stdout", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("node:net");
          const sockets = [1, 2].map(() => new net.Socket({ fd: 1, readable: false, writable: true }));
          for (const socket of sockets) socket.on("error", err => console.error(err.code));
          sockets[0].write("a");
          sockets[1].write("b");
          sockets[0].destroy();
          sockets[1].write("c");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "abc", stderr: "", exitCode: 0 });
  });

  // A write to a blocking descriptor returns once the kernel has every byte, so nothing is left to lose.
  it("what was written before process.exit() reaches the reader", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("node:net");
          new net.Socket({ fd: 1, readable: false, writable: true }).write(Buffer.alloc(1_000_000, "x"));
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ bytes: stdout.length, exitCode }).toEqual({ bytes: 1_000_000, exitCode: 0 });
  });

  // Nothing is read from it, so only a pending write may keep the process alive.
  it("an open write-only socket doesn't keep the process alive", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("node:net");
          const socket = new net.Socket({ fd: 1, readable: false, writable: true });
          socket.write("done");
          process.on("exit", () => console.error(JSON.stringify({ destroyed: socket.destroyed })));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr: stderr.trim(), exitCode }).toEqual({
      stdout: "done",
      stderr: '{"destroyed":false}',
      exitCode: 0,
    });
  });

  // Node's createHandle() wraps PIPE and TCP fds only; a regular file is
  // ERR_INVALID_FD_TYPE there (process.stdout over a file is a SyncWriteStream,
  // not a net.Socket).
  it("rejects a regular-file fd with ERR_INVALID_FD_TYPE, like node", () => {
    const fd = fs.openSync(join(tmpdirSync(), "not-a-pipe.txt"), "w");
    try {
      let error: any;
      try {
        new Socket({ fd, readable: false, writable: true });
      } catch (e) {
        error = e;
      }
      expect({ code: error?.code, message: error?.message }).toEqual({
        code: "ERR_INVALID_FD_TYPE",
        message: "Unsupported fd type: FILE",
      });
      expect(fstatCode(fd)).toBe("open");
    } finally {
      fs.closeSync(fd);
    }
  });

  // node wraps a piped stdout/stderr exactly this way (new Socket({ fd, readable:
  // false, writable: true })). The readable side must start out finished without
  // an 'end' event; emitting one let allowHalfOpen=false end the writable side,
  // destroy the socket and close the fd one tick after construction.
  it.skipIf(isWindows)("readable: false leaves the writable side and the adopted fd open", async () => {
    const { rfd, wfd } = openFifo("write-only.fifo");
    try {
      const socket = new Socket({ fd: wfd, readable: false, writable: true });
      const events: string[] = [];
      for (const name of ["end", "finish", "close"]) socket.on(name, () => events.push(name));
      socket.on("error", err => events.push(`error:${(err as NodeJS.ErrnoException).code}`));

      // The teardown being guarded against ran purely on process.nextTick
      // (end -> finish -> destroy -> close), so two immediate turns are past it.
      await new Promise<void>(resolve => setImmediate(() => setImmediate(resolve)));
      expect({
        events,
        destroyed: socket.destroyed,
        fd: fstatCode(wfd),
        flags: [socket.readable, socket.readableEnded, socket.writable, socket.pending],
      }).toEqual({ events: [], destroyed: false, fd: "open", flags: [false, true, true, false] });

      await new Promise<void>((resolve, reject) => socket.write("late", err => (err ? reject(err) : resolve())));
      expect(drain(rfd)).toBe("late");
      const closed = once(socket, "close");
      socket.end();
      await closed;
      expect({ events, fd: fstatCode(wfd), eof: drain(rfd) }).toEqual({
        events: ["finish", "close"],
        fd: "EBADF",
        eof: "",
      });
    } finally {
      fs.closeSync(rfd);
    }
  });

  it("a write-only socket over the process's piped stdout keeps delivering later writes", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import net from "node:net";
          const s = new net.Socket({ fd: 1, readable: false, writable: true });
          const events = [];
          for (const n of ["end", "finish", "close"]) s.on(n, () => events.push(n));
          s.on("error", e => events.push("error:" + e.code));
          s.write("now\\n");
          setImmediate(() => setImmediate(() => {
            s.write("late\\n", err => {
              console.error(JSON.stringify({ events, destroyed: s.destroyed, cb: err ? err.code : null }));
            });
          }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, report: JSON.parse(stderr.trim().split("\n").pop()!), exitCode }).toEqual({
      stdout: "now\nlate\n",
      report: { events: [], destroyed: false, cb: null },
      exitCode: 0,
    });
  });

  it("throws ERR_INVALID_FD_TYPE for a writable fd that cannot be fstat'ed", () => {
    let error: any;
    try {
      new Socket({ fd: 0x7ffff, writable: true });
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe("ERR_INVALID_FD_TYPE");
    expect(error?.message).toBe("Unsupported fd type: UNKNOWN");
  });

  it.skipIf(isWindows)("checks the fd type before typeOfService and doesn't close the fd when it throws", async () => {
    const { rfd, wfd } = openFifo("invalid-tos.fifo");
    const file = fs.openSync(join(tmpdirSync(), "invalid-tos.txt"), "w");
    const codeFor = (fd: number) => {
      try {
        new Socket({ fd, writable: true, typeOfService: 999 } as import("node:net").SocketConstructorOpts);
      } catch (e) {
        return (e as NodeJS.ErrnoException).code;
      }
    };
    try {
      const codes = { file: codeFor(file), fifo: codeFor(wfd) };
      // A socket that adopted the fd would end and close it on the next tick.
      await new Promise<void>(resolve => setImmediate(resolve));
      expect({ ...codes, fifoFd: fstatCode(wfd) }).toEqual({
        file: "ERR_INVALID_FD_TYPE",
        fifo: "ERR_OUT_OF_RANGE",
        fifoFd: "open",
      });
    } finally {
      fs.closeSync(wfd);
      fs.closeSync(rfd);
      fs.closeSync(file);
    }
  });

  // spawn() makes "pipe" stdio slots out of socketpairs, so this is what a child sees on fd 3 and up.
  it.skipIf(isWindows)("reads from and writes to a socket fd as soon as it's constructed", async () => {
    const child = spawn(
      bunExe(),
      [
        "-e",
        `
          const net = require("node:net");
          const fs = require("node:fs");
          const options = {
            bare: { fd: 3 },
            duplex: { fd: 4, readable: true, writable: true },
            readOnly: { fd: 5, readable: true, writable: false },
          };
          const report = {};
          let open = 3;
          for (const name in options) {
            const fd = options[name].fd;
            const socket = new net.Socket(options[name]);
            const events = (report[name] = ["pending=" + socket.pending + " connecting=" + socket.connecting]);
            socket.setEncoding("utf8");
            socket.on("connect", () => events.push("connect"));
            socket.on("data", data => {
              events.push("data:" + data);
              if (socket.writable) socket.end("echo:" + data);
              else socket.destroy();
            });
            socket.on("end", () => events.push("end"));
            socket.on("error", err => events.push("error:" + err.code));
            socket.on("close", () => {
              try {
                fs.fstatSync(fd);
                events.push("close, fd still open");
              } catch (err) {
                events.push("close, fd " + err.code);
              }
              if (--open === 0) console.log(JSON.stringify(report));
            });
          }
        `,
      ],
      { env: bunEnv, stdio: ["ignore", "pipe", "inherit", "pipe", "pipe", "pipe"] },
    );
    const text = async (stream: NodeJS.ReadableStream) => Buffer.concat(await Array.fromAsync(stream)).toString();
    const [, stdout, , bare, duplex, readOnly] = child.stdio as Socket[];
    readOnly.on("error", () => {});
    for (const pipe of [bare, duplex, readOnly]) pipe.write("ping");
    const [report, fromBare, fromDuplex, [exitCode]] = await Promise.all([
      text(stdout),
      text(bare),
      text(duplex),
      once(child, "exit"),
    ]);
    const echoed = ["pending=false connecting=false", "data:ping", "end", "close, fd EBADF"];
    expect({ report: JSON.parse(report), fromBare, fromDuplex, exitCode }).toEqual({
      report: {
        bare: echoed,
        duplex: echoed,
        readOnly: ["pending=false connecting=false", "data:ping", "close, fd EBADF"],
      },
      fromBare: "echo:ping",
      fromDuplex: "echo:ping",
      exitCode: 0,
    });
  });

  it("a bare { fd } that can't be fstat'ed does not throw", () => {
    const socket = new Socket({ fd: 0x7ffff });
    expect({ destroyed: socket.destroyed, pending: socket.pending }).toEqual({ destroyed: false, pending: true });
  });

  // node's _writeGeneric restarts the idle timer before every write.
  it.concurrent.skipIf(isWindows)("writes to an adopted fd restart the setTimeout() idle timer", async () => {
    const { rfd, wfd } = openFifo("timeout.fifo");
    const socket = new Socket({ fd: wfd, readable: false, writable: true });
    try {
      const idle = 200;
      const writes: number[] = [];
      const timeouts: number[] = [];
      socket.on("timeout", () => timeouts.push(performance.now()));
      socket.setTimeout(idle);
      // Two full timeout periods of steady writes, then let it go idle.
      for (let i = 0; i < 20; i++) {
        writes.push(performance.now());
        socket.write("x");
        await Bun.sleep(idle / 10);
      }
      if (timeouts.length === 0) await once(socket, "timeout");
      // Whenever 'timeout' fired, a full idle period had passed since the last
      // write before it: each write restarted the timer. (A scheduler stall
      // longer than `idle` between two writes is then a legitimate timeout, not
      // a failure.) Without the restart the first one lands ~20ms after a write.
      const gaps = timeouts.map(at => at - Math.max(...writes.filter(w => w <= at)));
      expect(gaps.filter(gap => gap < idle * 0.9)).toEqual([]);
      expect(drain(rfd)).toBe(Buffer.alloc(20, "x").toString());
    } finally {
      socket.destroy();
      fs.closeSync(rfd);
    }
  });

  // node copies the options ({ ...options }) before reading fd / readable /
  // writable, so inherited properties never adopt anything (an own file fd
  // would throw ERR_INVALID_FD_TYPE); the Duplex flags and the adoption
  // decision must come from the same view.
  it.concurrent("ignores fd / readable / writable that are not own properties of the options", async () => {
    const path = join(tmpdirSync(), "inherited-fd.txt");
    const fd = fs.openSync(path, "w");
    try {
      const socket = new Socket(Object.create({ fd, readable: false, writable: true }));
      const readableAfterConstruct = socket.readable;
      socket.on("error", () => {});
      const writeError = await new Promise<string | undefined>(resolve =>
        socket.write("x", err => resolve((err as NodeJS.ErrnoException | null)?.code)),
      );
      // No handle and nothing adopted: the write fails the way node's does.
      expect({ writeError, readableAfterConstruct, file: fs.readFileSync(path, "utf8") }).toEqual({
        writeError: "ERR_SOCKET_CLOSED",
        readableAfterConstruct: true,
        file: "",
      });
      expect(fs.fstatSync(fd).isFile()).toBe(true);
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe.concurrent("socket that already sent FIN and is paused with unread data", () => {
  async function runFixture(source: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { lines: stdout.trim().split("\n").sort(), stderr: stderr.trim(), exitCode };
  }

  it("delivers every buffered byte before 'end' when the data handler pauses", async () => {
    const SIZE = 1024 * 1024;
    const result = await runFixture(`
      const net = require("net");
      const SIZE = ${SIZE};
      let received = 0;
      const server = net.createServer({ allowHalfOpen: true }, socket => {
        socket.resume();
        socket.on("end", () => socket.write(Buffer.alloc(SIZE, 0x61), () => socket.end()));
      }).listen(0, () => {
        const conn = net.connect({ port: server.address().port, allowHalfOpen: true });
        conn.on("connect", () => conn.end());
        conn.on("data", buf => {
          received += buf.length;
          conn.pause();
          // Let the loop poll again with the peer's FIN in place, so the EOF hint
          // is reported while bytes are still queued in the kernel.
          setTimeout(() => conn.resume(), 5);
        });
        conn.on("error", err => console.log("error", err.code || err.message));
        conn.on("end", () => console.log("end", received));
        conn.on("close", () => { server.close(); console.log("close", received); });
      });
    `);
    expect(result).toEqual({ lines: [`close ${SIZE}`, `end ${SIZE}`], stderr: "", exitCode: 0 });
  });

  it("stays parked without spinning the loop, then delivers the tail on resume", async () => {
    const result = await runFixture(`
      const net = require("net");
      const { once } = require("events");
      let resolveClosed;
      const serverClosed = new Promise(r => (resolveClosed = r));
      const server = net.createServer({ allowHalfOpen: true }, socket => {
        socket.resume();
        socket.on("end", () => socket.write(Buffer.alloc(64 * 1024, 0x61), () => socket.end()));
        socket.on("close", resolveClosed);
      }).listen(0, async () => {
        const conn = net.connect({ port: server.address().port, allowHalfOpen: true });
        await once(conn, "connect");
        conn.end();
        conn.pause();
        await serverClosed;
        // Both FINs have been exchanged and 64 KiB sits unread in the kernel.
        let received = 0;
        conn.on("data", b => { received += b.length; });
        conn.on("close", () => { server.close(); console.log("close", received); });
        const before = process.cpuUsage();
        setTimeout(() => {
          const d = process.cpuUsage(before);
          console.log("cpu", d.user + d.system);
          conn.resume();
        }, 500);
      });
    `);
    // A level-triggered hangup that stays registered spins for the whole 500ms.
    // An idle debug+ASAN build uses about 30ms.
    const cpuMicros = Number((result.lines.find(l => l.startsWith("cpu ")) ?? "cpu -1").slice(4));
    expect({ ...result, cpuIdle: cpuMicros >= 0 && cpuMicros < 250_000 }).toEqual({
      lines: ["close 65536", `cpu ${cpuMicros}`],
      stderr: "",
      exitCode: 0,
      cpuIdle: true,
    });
  });
});

// A reset that reaches a read-stopped handle ends the connection, and the bytes the kernel
// still holds ahead of it are read off the socket before it is closed rather than discarded
// with the fd (#39846: a streamed fetch() body was cut short under receive backpressure this
// way). They land in the paused stream's buffer, so bytesRead accounts for every byte the peer
// sent. Windows discards the receive queue on a reset itself.
describe.concurrent("read-stopped socket whose peer resets behind unread data", () => {
  it("reads the queued bytes off the socket before reporting ECONNRESET", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const net = require("net");
        const server = net.createServer({ allowHalfOpen: true, highWaterMark: 64 * 1024 }, s => {
          // 64 KiB reaches the highWaterMark so the handle is read-stopped; the next
          // 32 KiB and the reset stay in the kernel.
          s.pause();
          const events = [];
          s.on("end", () => events.push("end"));
          s.on("error", e => events.push("error " + e.code));
          s.on("close", () => {
            events.push("close");
            console.log(JSON.stringify({ events, bytesRead: s.bytesRead, buffered: s.readableLength }));
            process.exit(0);
          });
          (function waitReadStopped() {
            if (s.readableLength >= 64 * 1024) console.log("read-stopped");
            else setImmediate(waitReadStopped);
          })();
        });
        server.listen(0, "127.0.0.1", () => console.log("port " + server.address().port));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    let buffered = "";
    async function line() {
      while (!buffered.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += new TextDecoder().decode(value);
      }
      const i = buffered.indexOf("\n");
      const out = i === -1 ? buffered : buffered.slice(0, i);
      buffered = i === -1 ? "" : buffered.slice(i + 1);
      return out;
    }
    const port = Number((await line()).split(" ")[1]);
    const peer = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: { data() {}, drain() {}, close() {}, error() {} },
    });
    expect(peer.write(Buffer.alloc(64 * 1024, "a"))).toBe(64 * 1024);
    peer.flush();
    expect(await line()).toBe("read-stopped");
    // In the kernel ahead of the reset: same connection, so TCP orders them.
    expect(peer.write(Buffer.alloc(32 * 1024, "b"))).toBe(32 * 1024);
    peer.flush();
    peer.terminate();
    const result = JSON.parse(await line());
    expect(result).toEqual({
      events: ["error ECONNRESET", "close"],
      bytesRead: isWindows ? result.bytesRead : 96 * 1024,
      buffered: isWindows ? result.buffered : 96 * 1024,
    });
    expect(await proc.exited).toBe(0);
  });
});

// A socket whose reads are stopped for backpressure must not hold the process
// open: in node a handle that is not reading is inactive, so a program that
// never consumes a reply (or a request) still exits. Each fixture leaves such a
// socket behind with its tail unread and nothing else alive; the only way to
// print "exit 0" is for the loop to run down on its own.
describe.concurrent("backpressure-paused socket does not keep the process alive", () => {
  async function expectExits(source: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${source}\nprocess.on("exit", code => console.log("exit", code));`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
      stdout: "exit 0",
      stderr: "",
      exitCode: 0,
    });
  }

  it("client that end()s and never reads the reply", () =>
    expectExits(`
      const net = require("net");
      const server = net.createServer(s => {
        s.resume();
        s.end(Buffer.alloc(128 * 1024, 0x61));
        s.on("close", () => server.close());
      }).listen(0, () => {
        net.connect(server.address().port, function () { this.end(); });
      });
    `));

  it("client that never reads the reply and whose peer goes away", () =>
    expectExits(`
      const net = require("net");
      const server = net.createServer(s => {
        s.end(Buffer.alloc(128 * 1024, 0x61), () => { s.destroy(); server.close(); });
      }).listen(0, () => {
        net.connect(server.address().port);
      });
    `));

  it("server that end()s a connection without reading the request", () =>
    expectExits(`
      const net = require("net");
      const server = net.createServer(s => s.end("go away")).listen(0, () => {
        const c = net.connect(server.address().port, () => c.end(Buffer.alloc(128 * 1024, 0x61)));
        c.resume();
        c.on("close", () => server.close());
      });
    `));

  // onread mode stops reads from the callback's return value instead of push().
  it("onread client whose callback returns false after it end()ed", () =>
    expectExits(`
      const net = require("net");
      const server = net.createServer(s => {
        s.resume();
        s.end(Buffer.alloc(128 * 1024, 0x61));
        s.on("close", () => server.close());
      }).listen(0, () => {
        net.connect(
          { port: server.address().port, onread: { buffer: Buffer.alloc(4096), callback: () => false } },
          function () { this.end(); },
        );
      });
    `));

  it("onread client whose callback returns false and whose peer goes away", () =>
    expectExits(`
      const net = require("net");
      const server = net.createServer(s => {
        s.end(Buffer.alloc(128 * 1024, 0x61), () => { s.destroy(); server.close(); });
      }).listen(0, () => {
        net.connect({ port: server.address().port, onread: { buffer: Buffer.alloc(4096), callback: () => false } });
      });
    `));

  it("but a write still waiting for drain does keep it alive until it completes", async () => {
    // Everything on the server side is unref'd, so only the client's pending
    // write can hold the loop open long enough for the server's timer to drain
    // it; the stream-level pause for the unread reply must not drop that hold.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const net = require("net");
        let drained = false;
        const server = net.createServer(s => {
          s.unref();
          s.pause();
          s.write(Buffer.alloc(256 * 1024, 0x61));
          setTimeout(() => { s.on("data", () => {}); s.resume(); }, 100).unref();
        });
        server.unref();
        server.listen(0, () => {
          const c = net.connect(server.address().port, () => {
            c.write(Buffer.alloc(8 * 1024 * 1024, 0x62), () => { drained = true; c.destroy(); });
          });
        });
        process.on("exit", code => console.log("exit", code, "drained", drained));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
      stdout: "exit 0 drained true",
      stderr: "",
      exitCode: 0,
    });
  });

  it("a drain does not give up a hold the user re-took with ref() after the pause was over", async () => {
    // unref() -> the reply stops reads for backpressure -> resume() re-arms them
    // while still user-unref'd -> ref() -> a big write goes pending and drains.
    // The socket is reading and explicitly ref'd at that point, so the process
    // has to still be around to receive "final"; the listener and the server
    // side are unref'd before the write so nothing else can keep it alive.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const net = require("net");
        const { once } = require("events");
        const REPLY = 256 * 1024, REQ = 8 * 1024 * 1024;
        const server = net.createServer(s => {
          s.unref();
          let got = 0;
          s.on("data", d => {
            got += d.length;
            if (got === REQ) setTimeout(() => s.write("final"), 50).unref();
          });
          s.write(Buffer.alloc(REPLY, 0x61));
        });
        server.listen(0, async () => {
          const c = net.connect(server.address().port);
          await once(c, "connect");
          c.unref();
          await once(c, "readable");
          const { promise: replyDone, resolve } = Promise.withResolvers();
          let total = 0;
          c.on("data", d => {
            if (d.includes("final")) {
              console.log("got final");
              c.destroy();
              server.close();
              return;
            }
            total += d.length;
            if (total === REPLY) resolve();
          });
          c.resume();
          await replyDone;
          c.ref();
          server.unref();
          c.write(Buffer.alloc(REQ, 0x62), () => console.log("drained"));
        });
        process.on("exit", code => console.log("exit", code));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr: stderr.trim(), exitCode }).toEqual({
      stdout: ["drained", "got final", "exit 0"],
      stderr: "",
      exitCode: 0,
    });
  });
});

// On Windows, unix paths route through the named-pipe codepath which reports
// failure asynchronously; this test targets the synchronous-failure branch in
// Listener.connectInner.
it.concurrent.skipIf(isWindows)(
  "should not leak when connect({path}) fails synchronously on a reused handle",
  async () => {
    // node:net creates a detached native socket (`_handle`) and passes it as
    // `prev` to connectInner. connectInner unconditionally `socket.ref()`s
    // before `doConnect`. A nonexistent unix path makes `doConnect` throw
    // synchronously while the socket is still `.detached`, so
    // `handleConnectError`'s own deref (gated on `!isDetached()`) does not
    // fire. The ref taken here must be released by the caller for reused
    // sockets too, not only freshly-allocated ones. Without that, every
    // failed reconnect leaks one native TCPSocket struct + its connection
    // string.
    //
    // ASAN builds allocate that struct from the system allocator, so the mimalloc
    // page count below can't see the leak. LeakSanitizer reports it at exit instead.
    const iterations = isASAN ? 100 : 8000;
    const script = `
      const net = require("node:net");
      const { heapStats } = require("bun:jsc");
      const path = "/tmp/bun-test-nonexistent-" + process.pid + ".sock";

      function once() {
        return new Promise(resolve => {
          const s = new net.Socket();
          s.on("error", () => {});
          s.on("close", resolve);
          s.connect({ path });
        });
      }
      async function run(n) {
        for (let i = 0; i < n; i += 100) {
          const batch = [];
          for (let j = 0; j < 100; j++) batch.push(once());
          await Promise.all(batch);
        }
        Bun.gc(true);
        await Bun.sleep(20);
        Bun.gc(true);
      }

      // Count live mimalloc pages across all size bins. Each leaked
      // TCPSocket struct is ~300-400 bytes; 8k of them fill ~25 pages
      // (release). Unlike RSS this is the allocator's own bookkeeping, so
      // it's independent of OS page reclamation.
      function pageCount() {
        return heapStats().mimalloc.page_bins.reduce((a, b) => a + b.current, 0);
      }

      // Warm up with the SAME workload as the measured run: on builds where
      // JSC shares mimalloc, its heap keeps growing until the first full-size
      // batch, so equal batches make the delta isolate the per-run leak.
      await run(${iterations});
      const before = pageCount();
      await run(${iterations});
      const after = pageCount();
      console.log(JSON.stringify({ before, after, delta: after - before }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        ...(isASAN && {
          BUN_DESTRUCT_VM_ON_EXIT: "1",
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
          LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dir, "../../../leaksan.supp")}`,
        }),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // LeakSanitizer reports to stderr.
    expect(stderr).toBe("");
    const { before, after, delta } = JSON.parse(stdout.trim().split("\n").pop()!);
    // Without the balancing deref: +25 pages (release).
    // With it the socket delta is 0, but since #34009 JSC shares mimalloc and
    // adds up to +14 of heap noise on aarch64/darwin release (build 75589).
    expect(delta, `mimalloc page count: ${before} -> ${after}`).toBeLessThan(20);
    expect(exitCode).toBe(0);
  },
  60_000,
);

describe("paused socket whose peer sends RST", () => {
  // Regression: on Linux, epoll forwarded the raw EPOLLERR bit (8) as a libus
  // close code, which the JS error path read as errno 8 and surfaced as a
  // bogus `Error: read ENOEXEC` when the socket was not actively reading.
  // kqueue already normalized the flag to 0/1.
  it("does not surface a bogus errno error", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const errors: NodeJS.ErrnoException[] = [];
    const server = createServer(c => {
      c.on("error", () => {});
      // RST only once the client says it has paused.
      c.on("data", () => c.resetAndDestroy());
    });
    try {
      await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as import("node:net").AddressInfo).port;
      const c = connect(port, "127.0.0.1", () => {
        c.pause();
        c.write("x");
      });
      c.on("error", e => errors.push(e));
      c.on("close", () => resolve());
      await promise;
    } finally {
      server.close();
    }
    expect(errors.map(e => e.code)).not.toContain("ENOEXEC");
  });
  // Like node, an onread socket's pause() stops the handle itself, so the RST
  // arrives at a handle that is not registered for reads at all.
  it("does not surface a bogus errno error for an onread socket", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const errors: NodeJS.ErrnoException[] = [];
    const server = createServer(c => {
      c.on("error", () => {});
      c.on("data", () => c.resetAndDestroy());
    });
    try {
      await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as import("node:net").AddressInfo).port;
      const c = connect({ port, host: "127.0.0.1", onread: { buffer: Buffer.alloc(16), callback: (): any => {} } });
      c.on("error", e => errors.push(e));
      c.on("close", () => resolve());
      await once(c, "connect");
      // Every 'connect' listener has run by now, including the _read() that
      // connect() queued, so nothing starts the handle again after this pause.
      c.pause();
      c.write("x");
      await promise;
    } finally {
      server.close();
    }
    expect(errors.map(e => e.code)).not.toContain("ENOEXEC");
  });
});

// Node stops kernel reads when push() returns false, not on pause(): a paused
// socket keeps reading into its buffer, so it still sees the peer's FIN.
// https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L817-L827
// Stopping the handle on pause() left the FIN unread forever, so a socket that
// nothing resumes (unpipe() pauses it) never emitted 'end' or 'close' and its
// server's close() never called back.
describe.concurrent("paused socket whose peer ends", () => {
  // Pauses the accepted socket after the accept-time read(0), with nothing
  // pushed afterwards that could start the handle again, then the peer ends.
  async function pauseThenPeerEnds(endBeforePeer: boolean) {
    const server = createServer();
    const accepted = Promise.withResolvers<Socket>();
    server.on("connection", accepted.resolve);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverClosed = Promise.withResolvers<void>();
    try {
      const client = connect((server.address() as import("node:net").AddressInfo).port, "127.0.0.1");
      const clientClosed = once(client, "close");
      const [socket] = await Promise.all([accepted.promise, once(client, "connect")]);
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      socket.on("end", () => events.push("end"));
      socket.on("close", hadError => {
        events.push(`close hadError=${hadError}`);
        closed.resolve();
      });
      socket.on("error", closed.reject);
      socket.pause();
      if (endBeforePeer) socket.end();
      expect(socket.isPaused()).toBe(true);
      client.end();
      await Promise.all([closed.promise, clientClosed]);
      expect(events).toEqual(["end", "close hadError=false"]);
    } finally {
      server.close(err => (err ? serverClosed.reject(err) : serverClosed.resolve()));
    }
    // The connection is gone, so close() calls back.
    await serverClosed.promise;
  }

  it("still emits 'end' and 'close'", () => pauseThenPeerEnds(false));

  it("still emits 'end' and 'close' after it end()ed first", () => pauseThenPeerEnds(true));
});

// The peer's bytes are queued on `socket` once the write callback ran; the poll
// between the two immediates is when a handle that reads would consume them.
async function expectNothingRead(socket: Socket, peer: Socket, bytes: string) {
  await new Promise(resolve => peer.write(bytes, resolve));
  await new Promise(resolve => setImmediate(() => setImmediate(resolve)));
  expect({ paused: socket.isPaused(), bytesRead: socket.bytesRead }).toEqual({ paused: true, bytesRead: 0 });
  const data = once(socket, "data");
  socket.resume();
  expect(String((await data)[0])).toBe(bytes);
}

// Node starts a connection's reads with a read(0) after the 'connect' listeners ran,
// and skips it if one of them paused: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L1695-L1696
it("pause() in a 'connect' listener leaves the peer's bytes unread until resume()", async () => {
  const accepted = Promise.withResolvers<Socket>();
  const server = createServer(accepted.resolve);
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client: Socket = connect(port, "127.0.0.1", () => client.pause());
    const [socket] = await Promise.all([accepted.promise, once(client, "connect")]);
    await expectNothingRead(client, socket, "reply");
    socket.destroy();
    await once(client, "close");
  } finally {
    server.close();
  }
});

// A 'readable' listener sets flowing to false as well, but the read() has asked for data: Node's
// handle is reading then, so ours must keep reading (the https-over-proxy CONNECT does this).
it("read() and once('readable') in a 'connect' listener still receive the peer's bytes", async () => {
  const server = createServer(socket => socket.write("reply"));
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const port = (server.address() as import("node:net").AddressInfo).port;
    const readable = Promise.withResolvers<string>();
    const client: Socket = connect(port, "127.0.0.1", () => {
      client.read();
      client.once("readable", () => readable.resolve(String(client.read())));
    });
    client.on("error", readable.reject);
    expect(await readable.promise).toBe("reply");
    client.destroy();
  } finally {
    server.close();
  }
});

describe.concurrent("pauseOnConnect", () => {
  it("reads server.pauseOnConnect per connection, like node", async () => {
    const server = createServer();
    const accepted = Promise.withResolvers<Socket>();
    server.on("connection", accepted.resolve);
    await once(server.listen(0, "127.0.0.1"), "listening");
    // Set after listen(): the listener was created without it, so this connection is stopped from JS.
    (server as any).pauseOnConnect = true;
    try {
      const client = connect((server.address() as import("node:net").AddressInfo).port, "127.0.0.1");
      const [socket] = await Promise.all([accepted.promise, once(client, "connect")]);
      await expectNothingRead(socket, client, "early");
      client.destroy();
      await once(socket, "close");
    } finally {
      server.close();
    }
  });

  it("applies to a dialed socket", async () => {
    const accepted = Promise.withResolvers<Socket>();
    const server = createServer(accepted.resolve);
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const port = (server.address() as import("node:net").AddressInfo).port;
      const client = connect({ port, host: "127.0.0.1", pauseOnConnect: true } as import("node:net").NetConnectOpts);
      const [socket] = await Promise.all([accepted.promise, once(client, "connect")]);
      await expectNothingRead(client, socket, "reply");
      socket.destroy();
      await once(client, "close");
    } finally {
      server.close();
    }
  });

  // A socket that opened paused must notice its peer going away like a socket that
  // pause()d later does, on every backend (kqueue keeps a read knote for that).
  it("still reports a peer reset before resume()", async () => {
    const server = createServer({ pauseOnConnect: true });
    const accepted = Promise.withResolvers<Socket>();
    server.on("connection", accepted.resolve);
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const client = connect((server.address() as import("node:net").AddressInfo).port, "127.0.0.1");
      const [socket] = await Promise.all([accepted.promise, once(client, "connect")]);
      const errors: NodeJS.ErrnoException[] = [];
      socket.on("error", e => errors.push(e));
      const closed = new Promise(resolve => socket.on("close", resolve));
      client.resetAndDestroy();
      await closed;
      expect(errors.map(e => e.code).filter(code => code !== "ECONNRESET")).toEqual([]);
    } finally {
      server.close();
    }
  });
});

describe("net.Server accepted-socket buffering", () => {
  it("delivers bytes buffered before a 'readable' listener attaches, past peer FIN", async () => {
    // read(0) instead of resume(): bytes that arrive before the connection
    // handler engages the readable side accumulate in the buffer like Node.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L2352
    const received = Promise.withResolvers<Buffer>();
    let flowingAtConnection: boolean | null | undefined;
    const server = createServer(sock => {
      flowingAtConnection = sock.readableFlowing;
      sock.once("readable", () => received.resolve(sock.read()));
      sock.once("error", received.reject);
    });
    let client: Socket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, "127.0.0.1", () => listening.resolve());
      await listening.promise;
      client = createConnection({ port: (server.address() as import("node:net").AddressInfo).port, host: "127.0.0.1" });
      client.on("error", received.reject);
      await new Promise<void>((resolve, reject) =>
        client!.end("hello", (err?: Error) => (err ? reject(err) : resolve())),
      );
      const buf = await received.promise;
      expect({ flowingAtConnection, data: buf?.toString() }).toEqual({ flowingAtConnection: null, data: "hello" });
    } finally {
      client?.destroy();
      server.close();
    }
  });

  it("keeps a client socket's buffered response available for a late reader after peer FIN", async () => {
    // An outbound client with no reader yet must keep its buffered response
    // indefinitely, like node (a late .on('data') still delivers it).
    const received = Promise.withResolvers<string>();
    const server = createServer(sock => {
      sock.end("late response");
    });
    let client: Socket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, "127.0.0.1", () => listening.resolve());
      await listening.promise;
      client = createConnection({ port: (server.address() as import("node:net").AddressInfo).port, host: "127.0.0.1" });
      client.on("error", received.reject);
      while (!(client as any)._readableState?.ended && !client.destroyed) await new Promise<void>(r => setImmediate(r));
      await new Promise<void>(r => setImmediate(r));
      await new Promise<void>(r => setImmediate(r));
      expect(client.destroyed).toBe(false);
      let got = "";
      client.on("data", chunk => (got += chunk));
      client.on("end", () => received.resolve(got));
      expect(await received.promise).toBe("late response");
    } finally {
      client?.destroy();
      server.close();
    }
  });

  it("delivers bytes to a 'data' listener attached via setImmediate from the connection handler", async () => {
    const received = Promise.withResolvers<string>();
    const server = createServer(sock => {
      setImmediate(() => {
        sock.once("data", chunk => received.resolve(chunk.toString()));
        sock.once("error", received.reject);
      });
    });
    let client: Socket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, "127.0.0.1", () => listening.resolve());
      await listening.promise;
      client = createConnection({ port: (server.address() as import("node:net").AddressInfo).port, host: "127.0.0.1" });
      client.on("error", received.reject);
      await new Promise<void>((resolve, reject) =>
        client!.end("hello", (err?: Error) => (err ? reject(err) : resolve())),
      );
      const data = await received.promise;
      expect(data).toBe("hello");
    } finally {
      client?.destroy();
      server.close();
    }
  });

  it("keeps a server socket open while buffered data from a write-then-FIN client is unread", async () => {
    // A client that sends its request and immediately half-closes (curl-style
    // `shutdown(SHUT_WR)`) must not cause the server socket to be torn down
    // before the app's async pipeline attaches a reader: the buffered payload
    // stays deliverable and 'end' only follows once it is drained, like Node.
    const connected = Promise.withResolvers<Socket>();
    const server = createServer(s => connected.resolve(s));
    let client: Socket | undefined;
    let sock: Socket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, "127.0.0.1", () => listening.resolve());
      await listening.promise;
      client = createConnection({ port: (server.address() as import("node:net").AddressInfo).port, host: "127.0.0.1" });
      client.on("error", connected.reject);
      await new Promise<void>((resolve, reject) => {
        client!.once("connect", () => resolve());
        client!.once("error", reject);
      });
      client.end("PAYLOAD-1234567890");
      sock = await connected.promise;
      const events: string[] = [];
      sock.on("end", () => events.push("end"));
      sock.on("close", hadError => events.push("close:" + hadError));
      // Wait for the peer FIN to mark the readable side ended, then let any
      // FIN-time lifecycle work settle before asserting the socket stayed open.
      while (!(sock as any)._readableState?.ended && !sock.destroyed) await new Promise<void>(r => setImmediate(r));
      await new Promise<void>(r => setImmediate(r));
      await new Promise<void>(r => setImmediate(r));
      expect({
        destroyed: sock.destroyed,
        readableLength: sock.readableLength,
        events: [...events],
      }).toEqual({ destroyed: false, readableLength: 18, events: [] });
      const received = Promise.withResolvers<string>();
      let got = "";
      sock.on("data", chunk => (got += chunk));
      sock.once("end", () => received.resolve(got));
      sock.once("error", received.reject);
      expect(await received.promise).toBe("PAYLOAD-1234567890");
      expect(events).toEqual(["end"]);
    } finally {
      sock?.destroy();
      client?.destroy();
      server.close();
    }
  });
});

describe("net.Socket onread flow control", () => {
  it("redelivers the rest of a chunk after the callback returns false and the socket resumes", async () => {
    // Node never loses the bytes a pausing onread callback has not consumed
    // (its reads are bounded by the user buffer, so they wait in the kernel
    // until resume()): a 12-byte burst through a 4-byte buffer with a pause
    // after the first slice must still deliver all three slices in order.
    const server = createServer(c => c.end(Buffer.from("abcdefghijkl")));
    const received: string[] = [];
    const done = Promise.withResolvers<void>();
    let socket: Socket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", listening.reject);
        listening.resolve();
      });
      await listening.promise;
      socket = createConnection({
        port: (server.address() as import("node:net").AddressInfo).port,
        host: "127.0.0.1",
        onread: {
          buffer: Buffer.alloc(4),
          callback(n: number, buf: Buffer) {
            received.push(buf.toString("latin1", 0, n));
            if (received.length === 1) {
              queueMicrotask(() => socket!.resume());
              return false;
            }
            if (received.join("").length === 12) done.resolve();
            return true;
          },
        },
      });
      socket.on("error", done.reject);
      socket.on("close", () => done.reject(new Error(`closed before all data was delivered: ${received.join("|")}`)));
      await done.promise;
      expect(received).toEqual(["abcd", "efgh", "ijkl"]);
    } finally {
      socket?.destroy();
      server.close();
    }
  });
});

describe("net.Socket onread with a zero-length buffer", () => {
  // Node installs the zero-length buffer and libuv then reports ENOBUFS for
  // the read ("user can't handle the read"), destroying the socket: it is
  // neither a validation error nor an infinite delivery loop.
  it.each(["static buffer", "buffer factory"])("errors with ENOBUFS (%s)", async kind => {
    const { promise, resolve, reject } = Promise.withResolvers<Error & { code?: string; syscall?: string }>();
    const server = createServer(c => c.end("some data"));
    let socket: Socket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", listening.reject);
        listening.resolve();
      });
      await listening.promise;
      socket = createConnection({
        port: (server.address() as import("node:net").AddressInfo).port,
        host: "127.0.0.1",
        onread: {
          buffer: kind === "static buffer" ? Buffer.alloc(0) : () => Buffer.alloc(0),
          callback: (): any => reject(new Error("onread callback must not be invoked")),
        },
      });
      socket.on("error", resolve);
      socket.on("close", () => reject(new Error("closed without emitting an error")));
      const error = await promise;
      expect({ message: error.message, code: error.code, syscall: error.syscall, destroyed: socket.destroyed }).toEqual(
        { message: "read ENOBUFS", code: "ENOBUFS", syscall: "read", destroyed: true },
      );
    } finally {
      socket?.destroy();
      server.close();
    }
  });
});

it("onread: nothing is delivered between a false return and resume()", async () => {
  // Node's readStop contract: after the callback returns false the callback
  // does not fire again until resume(), even when more data arrives meanwhile.
  const serverSockets: Socket[] = [];
  const server = createServer(c => {
    serverSockets.push(c);
    c.write("aaaa");
  });
  const received: string[] = [];
  const done = Promise.withResolvers<void>();
  const firstDelivery = Promise.withResolvers<void>();
  let client: Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", () => listening.resolve());
    await listening.promise;
    client = createConnection({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      onread: {
        buffer: Buffer.alloc(64),
        callback(n: number, buf: Buffer) {
          received.push(buf.toString("latin1", 0, n));
          if (received.length === 1) {
            firstDelivery.resolve();
            return false;
          }
          if (received.join("").length === 12) done.resolve();
          return true;
        },
      },
    });
    client.on("error", done.reject);
    await firstDelivery.promise;
    // More data arrives while paused; flush it and give the client's loop
    // turns to (incorrectly) deliver it before checking nothing fired.
    await new Promise<void>(resolve => serverSockets[0].end("bbbbcccc", () => resolve()));
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    expect(received).toEqual(["aaaa"]);
    client.resume();
    await done.promise;
    expect(received.join("")).toBe("aaaabbbbcccc");
  } finally {
    client?.destroy();
    server.close();
  }
});

it("onread: resume() then pause() before the drain tick leaves the handle paused", async () => {
  // Node's level-triggered _handle.reading (lib/net.js:817-835): resume()→pause()
  // ends with the handle stopped; the drain tick must not undo the pause.
  const serverSockets: Socket[] = [];
  const server = createServer(c => {
    serverSockets.push(c);
    c.write("aaaa");
  });
  const received: string[] = [];
  const firstDelivery = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  let client: Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", () => listening.resolve());
    await listening.promise;
    client = createConnection({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      onread: {
        buffer: Buffer.alloc(64),
        callback(n: number, buf: Buffer) {
          received.push(buf.toString("latin1", 0, n));
          if (received.length === 1) firstDelivery.resolve();
          if (received.join("").length === 8) done.resolve();
          return received.length === 1 ? false : true;
        },
      },
    });
    client.on("error", done.reject);
    await firstDelivery.promise;
    // resume() schedules the drain tick; pause() before it fires must win.
    client.resume();
    client.pause();
    await new Promise<void>(resolve => serverSockets[0].write("bbbb", () => resolve()));
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    expect(received).toEqual(["aaaa"]);
    client.resume();
    await done.promise;
    expect(received.join("")).toBe("aaaabbbb");
  } finally {
    client?.destroy();
    server.close();
  }
});

it("onread: a false return on the last slice of a redelivered tail stays paused until resume()", async () => {
  // Node's readStop contract holds for every false return
  // (stream_base_commons.js#L176-L198): draining the queued tail must not
  // auto-resume the handle when its final slice returns false.
  const serverSockets: Socket[] = [];
  const server = createServer(c => {
    serverSockets.push(c);
    c.write("abcdefgh"); // two slices for the client's 4-byte onread buffer
  });
  const received: string[] = [];
  const firstDelivery = Promise.withResolvers<void>();
  const secondDelivery = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  let client: Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", () => listening.resolve());
    await listening.promise;
    client = createConnection({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      onread: {
        buffer: Buffer.alloc(4),
        callback(n: number, buf: Buffer) {
          received.push(buf.toString("latin1", 0, n));
          if (received.length === 1) firstDelivery.resolve();
          if (received.length === 2) secondDelivery.resolve();
          if (received.length === 3) done.resolve();
          return false;
        },
      },
    });
    client.on("error", done.reject);
    await firstDelivery.promise;
    client.resume();
    await secondDelivery.promise;
    expect(received).toEqual(["abcd", "efgh"]);
    // Paused by the second false (an empty tail): later data must wait for
    // the next resume() even though the queued tail was fully consumed.
    await new Promise<void>(resolve => serverSockets[0].end("wxyz", () => resolve()));
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    expect(received).toEqual(["abcd", "efgh"]);
    client.resume();
    await done.promise;
    expect(received).toEqual(["abcd", "efgh", "wxyz"]);
  } finally {
    client?.destroy();
    server.close();
  }
});

describe("net.Socket onread buffer factory", () => {
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L177-L185
  it.each([
    ["null", () => null],
    ["a plain object", () => ({})],
  ])("keeps reusing the last valid buffer when the factory returns %s", async (_label, bad) => {
    const bufA = Buffer.alloc(16);
    let sawFirst = false;
    const seen: Array<[string, boolean]> = [];
    const done = Promise.withResolvers<void>();
    // The client acks the first delivery so the second write is a separate
    // read: one coalesced segment would never exercise the factory again.
    const server = createServer(c => {
      c.on("data", () => c.end("bbbb"));
      c.write("aaaa");
    });
    let client: Socket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", listening.reject);
        listening.resolve();
      });
      await listening.promise;
      client = createConnection({
        port: (server.address() as import("node:net").AddressInfo).port,
        host: "127.0.0.1",
        onread: {
          buffer: () => (sawFirst ? (bad() as any) : bufA),
          callback(n: number, buf: Buffer) {
            const wasFirst = !sawFirst;
            sawFirst = true;
            seen.push([buf.toString("latin1", 0, n), buf === bufA]);
            if (wasFirst) client!.write("ok");
            if (seen.map(s => s[0]).join("") === "aaaabbbb") done.resolve();
            return true;
          },
        },
      });
      client.on("error", done.reject);
      await done.promise;
      // Two separate reads, both delivered into the one valid buffer.
      expect(seen).toEqual([
        ["aaaa", true],
        ["bbbb", true],
      ]);
    } finally {
      client?.destroy();
      server.close();
    }
  });
});

it("onread: read() after a redundant pause() still redelivers the declined tail", async () => {
  // Node's read() calls tryReadStart on the handle regardless of the stream's
  // flowing state (lib/net.js:779-789), so an explicit pause() before it does
  // not starve the queued tail; only resume() defers to a later pause().
  const received: string[] = [];
  const done = Promise.withResolvers<void>();
  const server = createServer(c => {
    c.on("data", () => {});
    c.end(Buffer.from("abcdefgh"));
  });
  let client: Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", listening.reject);
      listening.resolve();
    });
    await listening.promise;
    client = createConnection({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      onread: {
        buffer: Buffer.alloc(4),
        callback(n: number, buf: Buffer) {
          received.push(buf.toString("latin1", 0, n));
          if (received.length === 1) {
            setImmediate(() => {
              client!.pause();
              client!.read();
            });
            return false;
          }
          if (received.length === 2) done.resolve();
          return true;
        },
      },
    });
    client.on("error", done.reject);
    await done.promise;
    expect(received).toEqual(["abcd", "efgh"]);
  } finally {
    client?.destroy();
    server.close();
  }
});

it("onread: a peer FIN does not redeliver the declined tail before resume()", async () => {
  // The EOF path's read(0) must not restart a flow the callback paused: Node's
  // readStop leaves both the tail and the FIN unread until resume().
  const received: string[] = [];
  const paused = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  // One 8-byte write plus FIN: data and EOF land together.
  const server = createServer(c => c.end(Buffer.from("abcdefgh")));
  let client: Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", listening.reject);
      listening.resolve();
    });
    await listening.promise;
    client = createConnection({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      onread: {
        buffer: Buffer.alloc(4),
        callback(n: number, buf: Buffer) {
          received.push(buf.toString("latin1", 0, n));
          if (received.length === 1) {
            paused.resolve();
            return false;
          }
          if (received.length === 2) done.resolve();
          return true;
        },
      },
    });
    client.on("error", done.reject);
    await paused.promise;

    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    expect({ received: [...received], destroyed: client.destroyed }).toEqual({
      received: ["abcd"],
      destroyed: false,
    });

    client.resume();
    await done.promise;
    expect(received).toEqual(["abcd", "efgh"]);
  } finally {
    client?.destroy();
    server.close();
  }
});

it("onread: read() redelivers the declined tail without resume()", async () => {
  // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L779-L789 - Node's
  // read() calls tryReadStart in onread mode, so it restarts the paused flow.
  const received: string[] = [];
  const done = Promise.withResolvers<void>();
  const server = createServer(c => c.end(Buffer.from("abcdefgh")));
  let client: Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", listening.reject);
      listening.resolve();
    });
    await listening.promise;
    client = createConnection({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      onread: {
        buffer: Buffer.alloc(4),
        callback(n: number, buf: Buffer) {
          received.push(buf.toString("latin1", 0, n));
          if (received.length === 1) {
            // Never resume(); only read().
            setImmediate(() => client!.read(0));
            return false;
          }
          if (received.length === 2) done.resolve();
          return true;
        },
      },
    });
    client.on("error", done.reject);
    await done.promise;
    expect(received).toEqual(["abcd", "efgh"]);
  } finally {
    client?.destroy();
    server.close();
  }
});

it("onread: a buffer factory that never yields a Uint8Array hands the callback `true`", async () => {
  // Node leaves kBuffer as the literal `true` and passes it through:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L332-L342
  const seen: unknown[] = [];
  const done = Promise.withResolvers<void>();
  const server = createServer(c => c.end("hello"));
  let client: Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", listening.reject);
      listening.resolve();
    });
    await listening.promise;
    client = createConnection({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      onread: {
        buffer: () => null as any,
        callback(_n: number, buf: unknown) {
          seen.push(buf);
          done.resolve();
          return true;
        },
      },
    });
    client.on("error", done.reject);
    await done.promise;
    expect(seen).toEqual([true]);
  } finally {
    client?.destroy();
    server.close();
  }
});

it("onread: `false` from a callback holding the `true` sentinel still pauses until resume()", async () => {
  // Node runs the readStop-on-false logic even when the factory has not yet
  // produced a Uint8Array and the callback is handed the literal `true`:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L177-L198
  const seen: unknown[] = [];
  const paused = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  let sock: Socket | undefined;
  const server = createServer(c => {
    sock = c;
    c.on("data", () => {});
    c.write("aaaa");
  });
  let client: Socket | undefined;
  try {
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", listening.reject);
      listening.resolve();
    });
    await listening.promise;
    client = createConnection({
      port: (server.address() as import("node:net").AddressInfo).port,
      host: "127.0.0.1",
      onread: {
        buffer: () => 42 as any,
        callback(n: number, buf: unknown) {
          seen.push(buf);
          if (seen.length === 1) {
            paused.resolve();
            return false;
          }
          done.resolve();
          return true;
        },
      },
    });
    client.on("error", done.reject);
    await paused.promise;
    // A second write while paused must not reach the callback...
    sock!.write("bbbb");
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    expect(seen).toEqual([true]);
    // ...until resume().
    client.resume();
    await done.promise;
    expect(seen).toEqual([true, true]);
  } finally {
    client?.destroy();
    server.close();
  }
});

// node lets a throwing onread callback escape as an uncaught exception:
// onStreamRead calls the user callback bare, so the process dies rather than
// the socket being failed closed.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L179
it.concurrent("onread: a callback that throws is an uncaught exception", async () => {
  // 12 bytes through a 4-byte buffer; the callback throws on the first slice.
  const fixture = /* js */ `
    const net = require("net");
    const server = net.createServer(c => c.write(Buffer.from("abcdefghijkl")));
    server.listen(0, "127.0.0.1", () => {
      const calls = [];
      const client = net.connect({
        port: server.address().port,
        host: "127.0.0.1",
        onread: {
          buffer: Buffer.alloc(4),
          callback(n, buf) {
            calls.push(buf.toString("latin1", 0, n));
            console.log("calls:" + calls.join(","));
            throw new Error("onread-boom");
          },
        },
      });
      client.on("error", () => console.log("socket-error"));
      // The listening server keeps the process alive if the throw doesn't end it.
      setTimeout(() => process.exit(2), 10_000).unref();
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("onread-boom");
  const lines = stdout.split("\n").filter(Boolean);
  // The throw reaches the uncaught-exception path, not the socket 'error'
  // handler. Node exits after the first slice; bun reports each throw and
  // delivers the remaining slices (it does not exit mid-tick on an unhandled
  // uncaughtException), so whichever slices appear must be the contiguous
  // prefix of the stream with no gap and no 'socket-error'.
  expect(lines[0]).toBe("calls:abcd");
  expect(lines).not.toContain("socket-error");
  expect(["calls:abcd", "calls:abcd,efgh", "calls:abcd,efgh,ijkl"]).toEqual(expect.arrayContaining(lines));
  expect(exitCode).toBe(1);
});

// Node bounds each kernel read to the onread buffer's size, so a throw that is
// swallowed by a process.on('uncaughtException') handler loses no bytes (the
// next slice is a separate onStreamRead call). Bun slices one larger native
// read in JS, so the catch is per-slice to preserve that.
it.concurrent("onread: a swallowed throw does not drop the rest of the current native read", async () => {
  const fixture = /* js */ `
    process.on("uncaughtException", e => console.log("uncaught:" + e.message));
    const net = require("net");
    const server = net.createServer(c => c.write(Buffer.from("abcdefghijkl")));
    server.listen(0, "127.0.0.1", () => {
      const calls = [];
      let first = true;
      const client = net.connect({
        port: server.address().port,
        host: "127.0.0.1",
        onread: {
          buffer: Buffer.alloc(4),
          callback(n, buf) {
            calls.push(buf.toString("latin1", 0, n));
            if (first) { first = false; throw new Error("onread-boom"); }
            if (calls.length === 3) {
              console.log("calls:" + calls.join(","));
              client.destroy(); server.close();
            }
            return true;
          },
        },
      });
      client.on("error", () => console.log("socket-error"));
      setTimeout(() => { console.log("calls:" + calls.join(",")); process.exit(2); }, 2000).unref();
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // The throw was reported, then the remaining slices of the same native
  // read were delivered with no gap and no socket 'error'.
  expect(stdout.split("\n").filter(Boolean)).toEqual(["uncaught:onread-boom", "calls:abcd,efgh,ijkl"]);
  expect(exitCode).toBe(0);
});

// On Windows the native layer does not report fatal send errors yet (the WSA
// error translation is a follow-up), so the write error never surfaces there.
it.skipIf(isWindows)("a write after the peer reset the connection fails with a write error", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
  // resetAndDestroy() sends an RST (not a FIN); allowHalfOpen keeps the client's
  // writable side open like Node, so the failure must surface from the write
  // path (Node: errnoException(status, "write") via onWriteComplete).
  const server = createServer(c => {
    c.on("error", () => {});
    c.resetAndDestroy();
  });
  try {
    await new Promise<void>(r => server.listen(0, r));
    const conn = connect({ port: (server.address() as { port: number }).port, host: "127.0.0.1", allowHalfOpen: true });
    conn.on("error", resolve);
    conn.on("close", () => reject(new Error("socket closed without emitting 'error'")));
    const chunk = Buffer.alloc(16384, 97);
    const pump = () => {
      if (!conn.destroyed) {
        conn.write(chunk);
        setImmediate(pump);
      }
    };
    conn.on("connect", pump);
    const err = await promise;
    expect(["EPIPE", "ECONNRESET", "ENOTCONN"]).toContain(err.code!);
    expect(typeof err.errno).toBe("number");
  } finally {
    server.close();
  }
});

it("a plain socket has none of TLSSocket's property names", async () => {
  const tlsOnly = [
    "encrypted",
    "authorized",
    "authorizationError",
    "servername",
    "_requestCert",
    "_rejectUnauthorized",
  ];
  const accepted = Promise.withResolvers<string[]>();
  const server = createServer(socket => {
    accepted.resolve(tlsOnly.filter(name => name in socket));
    socket.end();
  });
  try {
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    const client = connect({ port, host: "127.0.0.1", servername: "example.com" });
    const closed = once(client.resume(), "close");
    await once(client, "connect");
    const connected = tlsOnly.filter(name => name in client);
    expect({ connected, accepted: await accepted.promise }).toEqual({ connected: [], accepted: [] });
    await closed;
  } finally {
    server.close();
  }
});

// Node hands a write that fails at once to the stream inside write() itself,
// so write() returns false and the socket is errored in the same call. The
// stream runs the write callbacks and destroys the socket on the next tick.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L158-L159
describe("a write that fails at once", () => {
  type ErrnoException = NodeJS.ErrnoException;

  async function connectedPair(listenOptions: import("node:net").ListenOptions) {
    const server = createServer();
    await once(server.listen(listenOptions), "listening");
    const address = server.address() as string | import("node:net").AddressInfo;
    const accepted = once(server, "connection") as Promise<[Socket]>;
    const client = typeof address === "string" ? connect(address) : connect(address.port, address.address);
    const [[peer]] = await Promise.all([accepted, once(client, "connect")]);
    peer.on("error", () => {});
    return {
      client,
      peer,
      [Symbol.dispose]() {
        client.destroy();
        peer.destroy();
        server.close();
      },
    };
  }

  const stateOf = (conn: Socket) => ({
    destroyed: conn.destroyed,
    errored: (conn.errored as ErrnoException | null)?.code,
    writable: conn.writable,
    writableLength: conn.writableLength,
  });

  // Records the write callbacks, 'error' and 'close' of `conn` in order.
  function eventLog(conn: Socket, until: "error" | "close") {
    const events: string[] = [];
    const settled = new Promise<void>(resolve => {
      conn.on("error", (e: ErrnoException) => {
        events.push(`error ${e.code} ${e.syscall}`);
        if (until === "error") resolve();
      });
      conn.on("close", hadError => {
        events.push(`close ${hadError}`);
        resolve();
      });
    });
    const written = (n: number) => (e?: ErrnoException | null) =>
      void events.push(`write#${n} ${e?.code} ${e?.syscall}`);
    return { events, settled, written };
  }

  // Writes twice in the current tick and records what the first write() left
  // behind before it returned.
  async function writeTwice(conn: Socket, until: "error" | "close") {
    const { events, settled, written } = eventLog(conn, until);
    const first = conn.write("x", written(1));
    const afterFirst = stateOf(conn);
    const second = conn.write("y", written(2));
    await settled;
    return { first, afterFirst, second, events };
  }

  function expectFailedInsideWrite(result: Awaited<ReturnType<typeof writeTwice>>, code: string, lastEvents: string[]) {
    expect(result).toEqual({
      first: false,
      afterFirst: { destroyed: false, errored: code, writable: false, writableLength: 0 },
      second: false,
      events: [`write#1 ${code} write`, `write#2 ${code} write`, ...lastEvents],
    });
  }

  // The peer dies and the client writes in the same tick, so the event loop
  // gets no chance to report the dead peer as a read error first.
  // Windows: a path listens on a named pipe, which has its own write path.
  it.skipIf(isWindows)("returns false from write() on a unix socket whose peer closed", async () => {
    using pair = await connectedPair({ path: join(socket_domain, "write-epipe.sock") });
    // A unix socket learns that its peer is gone inside the peer's close(2).
    pair.peer.destroy();
    expectFailedInsideWrite(await writeTwice(pair.client, "close"), "EPIPE", ["error EPIPE write", "close true"]);
  });

  it("returns false from write() on a TCP socket whose peer reset the connection", async () => {
    // Loopback does not promise that the RST is processed before the next
    // send(2). A send that beats it succeeds and the reset surfaces as a read
    // error, so take a fresh connection until the kernel rejects the send.
    let result: Awaited<ReturnType<typeof writeTwice>>;
    let attempts = 0;
    do {
      using pair = await connectedPair({ port: 0, host: "127.0.0.1" });
      pair.peer.resetAndDestroy();
      result = await writeTwice(pair.client, "close");
    } while (!result.events[0].endsWith(" write") && ++attempts < 100);
    // BSD kernels report a send after a received RST as EPIPE.
    const code = result.events[0] === "write#1 EPIPE write" ? "EPIPE" : "ECONNRESET";
    expectFailedInsideWrite(result, code, [`error ${code} write`, "close true"]);
  });

  // test-net-socket-write-after-close.js covers the error, not the return value.
  it("returns false from write() on a socket whose handle was closed directly", async () => {
    using pair = await connectedPair({ port: 0, host: "127.0.0.1" });
    (pair.client as any)._handle.close();
    const code = isWindows ? "EPIPE" : "EBADF";
    expectFailedInsideWrite(await writeTwice(pair.client, "error"), code, [`error ${code} write`]);
  });

  // uncork() sends the corked writes through _writev, which ends in the same _write.
  it("errors the socket inside uncork() when the corked writes fail at once", async () => {
    using pair = await connectedPair({ port: 0, host: "127.0.0.1" });
    const conn = pair.client;
    (conn as any)._handle.close();
    const code = isWindows ? "EPIPE" : "EBADF";
    const { events, settled, written } = eventLog(conn, "error");
    conn.cork();
    const corked = [conn.write("x", written(1)), conn.write("y", written(2))];
    conn.uncork();
    const afterUncork = stateOf(conn);
    await settled;
    expect({ corked, afterUncork, events }).toEqual({
      corked: [true, true],
      afterUncork: { destroyed: false, errored: code, writable: false, writableLength: 0 },
      events: [`write#1 ${code} write`, `write#2 ${code} write`, `error ${code} write`],
    });
  });
});

// libuv's uv__tcp_bind always sets SO_REUSEADDR on Unix, so Node can bind a
// client localPort that still has earlier connections in TIME_WAIT. Bun used
// to call bind() bare here and fail with EADDRINUSE, which made
// sequential/test-net-localport.js order-dependent in CI. Windows is skipped
// because libuv intentionally does not set SO_REUSEADDR there.
it.skipIf(isWindows)("connect({ localPort }) succeeds when the local port has TIME_WAIT sockets", async () => {
  // Reserve a port and release it so nothing else is listening on it.
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const localPort = (probe.address() as import("node:net").AddressInfo).port;
  await new Promise<void>(r => probe.close(() => r()));

  // Leave a few server-side TIME_WAIT sockets on localPort: the server sends
  // and then active-closes each connection, which is what puts its local end
  // (localPort) into TIME_WAIT.
  {
    const { promise: drained, resolve: onDrained } = Promise.withResolvers<void>();
    let accepted = 0;
    let closed = 0;
    const waitServer = createServer(c => {
      if (++accepted === 4) waitServer.close();
      c.end("x");
      c.on("close", () => {
        if (++closed === 4) onDrained();
      });
    });
    await new Promise<void>((resolve, reject) => {
      waitServer.on("error", reject);
      waitServer.listen(localPort, "127.0.0.1", resolve);
    });
    for (let i = 0; i < 4; i++) {
      const c = connect(localPort, "127.0.0.1");
      c.on("error", () => {});
      c.resume();
    }
    await drained;
  }

  // Now bind an outgoing connection's local port to localPort. Without
  // SO_REUSEADDR the kernel rejects this with EADDRINUSE while the TIME_WAIT
  // entries exist.
  const target = createServer(c => c.end());
  try {
    await new Promise<void>((resolve, reject) => {
      target.on("error", reject);
      target.listen(0, "127.0.0.1", resolve);
    });
    const targetPort = (target.address() as import("node:net").AddressInfo).port;
    const { promise, resolve, reject } = Promise.withResolvers<Socket>();
    const c = connect({ host: "127.0.0.1", port: targetPort, localPort });
    c.on("connect", () => resolve(c));
    c.on("error", reject);
    const sock = await promise;
    expect(sock.localPort).toBe(localPort);
    sock.destroy();
  } finally {
    target.close();
  }
});

// https://github.com/oven-sh/bun/issues/32087
// The writev fast path is `#[cfg(unix)]`, and on Windows the amount a send
// accepts is machine dependent, so the buffered precondition cannot be built there.
describe.skipIf(isWindows)("socket write while data is buffered natively", () => {
  // Counts received bytes per fill value. pauseOnConnect keeps the kernel buffers
  // full until the client writes a byte count to the file "submitted". The server
  // creates the file "drained" once it has received that many bytes.
  const serverFixture = /* js */ `
    import fs from "node:fs";
    import net from "node:net";
    const KNOWN = [0x61, 0x69, 0x73]; // 'a', 'i', 's'
    const counts = { a: 0, i: 0, s: 0, other: 0 };
    const runs = [];
    let total = 0;
    let drainTo = Infinity;
    function reportDrained() {
      if (total < drainTo) return;
      drainTo = Infinity;
      fs.writeFileSync("drained", "");
    }
    function scan(d) {
      total += d.length;
      let pos = 0;
      while (pos < d.length) {
        const byte = d[pos];
        if (!KNOWN.includes(byte)) {
          counts.other++;
          pos++;
          continue;
        }
        const ch = String.fromCharCode(byte);
        let end = d.length;
        for (const other of KNOWN) {
          if (other === byte) continue;
          const idx = d.indexOf(other, pos);
          if (idx !== -1 && idx < end) end = idx;
        }
        counts[ch] += end - pos;
        if (runs.length === 0 || runs[runs.length - 1] !== ch) runs.push(ch);
        pos = end;
      }
    }
    const server = net.createServer({ pauseOnConnect: true }, c => {
      c.on("data", d => {
        scan(d);
        reportDrained();
      });
      let printed = false;
      const done = () => {
        if (printed) return;
        printed = true;
        clearInterval(poll);
        console.log(JSON.stringify({ total, counts, runs }));
        c.destroy();
        server.close();
      };
      c.on("end", done);
      c.on("close", done);
      c.on("error", done);
      const poll = setInterval(() => {
        if (!fs.existsSync("submitted")) return;
        clearInterval(poll);
        drainTo = Number(fs.readFileSync("submitted", "utf8"));
        c.resume();
        reportDrained();
      }, 1);
    });
    server.listen(0, "127.0.0.1", () => {
      console.log(JSON.stringify({ port: server.address().port }));
    });
  `;

  // Calls Socket.prototype._write directly so a second write reaches the native
  // layer while data is still buffered. A _write callback that does not fire
  // synchronously means the chunk is now buffered natively.
  const clientFixture = /* js */ `
    import fs from "node:fs";
    import net from "node:net";
    const phase = process.argv[2]; // "loss" | "dup"
    const port = Number(process.argv[3]);
    // Tells the peer to start reading and to create "drained" after drainTo bytes.
    function submitted(drainTo) {
      fs.writeFileSync("submitted.tmp", String(drainTo));
      fs.renameSync("submitted.tmp", "submitted");
    }
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.setNoDelay(true);
      const writeDirect = chunk => {
        let fired = false;
        sock._write(chunk, "buffer", () => {
          fired = true;
        });
        return fired;
      };
      const sent = { a: 0, i: 0, s: 0, other: 0 };
      let sawPartial = false;
      let finalChunk;
      if (phase === "loss") {
        // A remainder far larger than one writev can take, so the next writev
        // stops inside the old buffered data (written < buffered.len).
        for (let attempt = 0; attempt < 8 && !sawPartial; attempt++) {
          const A = Buffer.alloc(16 * 1024 * 1024, 0x61);
          sawPartial = !writeDirect(A);
          sent.a += A.length;
        }
        finalChunk = Buffer.alloc(64 * 1024, 0x73);
        sent.s = finalChunk.length;
      } else {
        // Leave a small (< 64KB) native remainder...
        const size = 64 * 1024;
        for (let attempt = 0; attempt < 1024 && !sawPartial; attempt++) {
          const C = Buffer.alloc(size, 0x61);
          sawPartial = !writeDirect(C);
          sent.a += C.length;
        }
        // ...then block the loop so no writable event flushes the remainder while the
        // peer reads all but the last chunk. The kernel buffers are nearly empty by then,
        // so the next writev sends the whole remainder plus a prefix of the new chunk
        // (written > buffered.len).
        if (sawPartial) {
          // sent.a includes the partial chunk, so this means the very first write was partial.
          if (sent.a === size) {
            console.error("precondition failed: the first write was partial, so the peer has nothing to drain first");
            sock.destroy();
            process.exit(3);
          }
          submitted(sent.a - size);
          const deadline = Date.now() + 60_000;
          while (!fs.existsSync("drained")) {
            if (Date.now() > deadline) {
              console.error("the peer did not drain the connection");
              process.exit(4);
            }
            Bun.sleepSync(1);
          }
        }
        finalChunk = Buffer.alloc(32 * 1024 * 1024, 0x69);
        sent.i = finalChunk.length;
      }
      if (!sawPartial) {
        console.error("precondition failed: no direct write left data in the native buffer");
        sock.destroy();
        process.exit(3);
      }
      // The bug site. The callback fires once the native buffer has drained,
      // and end() must wait for that: _final calls shutdown(), which discards buffered bytes.
      const { promise: flushed, resolve } = Promise.withResolvers();
      sock._write(finalChunk, "buffer", () => resolve());
      // bytesWritten counts flushed plus still-buffered bytes.
      sent.bw = sock.bytesWritten;
      if (phase === "loss") submitted(sent.a + sent.s);
      // The test runner doesn't kill a concurrent test's children when it times out.
      setTimeout(() => {
        console.error("the final write did not drain");
        process.exit(5);
      }, 60_000).unref();
      flushed.then(() => {
        console.log(JSON.stringify(sent));
        sock.end();
      });
    });
    sock.on("error", err => {
      console.error("client socket error:", err);
      process.exit(2);
    });
  `;

  async function* lines(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        yield buf.slice(0, i);
        buf = buf.slice(i + 1);
      }
    }
    if (buf.length) yield buf;
  }

  // "loss": the writev stops inside the old buffered data, the new chunk must be kept.
  // "dup": the writev consumes the old data plus a prefix of the new chunk,
  // that prefix must not be resent.
  describe.concurrent.each(["loss", "dup"] as const)("%s", phase => {
    it("a partial writev keeps exactly the unsent suffix", async () => {
      using dir = tempDir("writev-remainder", {
        "server-fixture.mjs": serverFixture,
        "client-fixture.mjs": clientFixture,
      });

      await using server = Bun.spawn({
        cmd: [bunExe(), "server-fixture.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const serverStderr = server.stderr.text();
      const serverLines = lines(server.stdout);
      const portLine = await serverLines.next();
      if (portLine.done) throw new Error(`server exited before printing its port: ${await serverStderr}`);
      const { port } = JSON.parse(portLine.value);

      await using client = Bun.spawn({
        cmd: [bunExe(), "client-fixture.mjs", phase, String(port)],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [clientOut, clientErr, clientExit] = await Promise.all([
        client.stdout.text(),
        client.stderr.text(),
        client.exited,
      ]);
      if (clientExit !== 0) throw new Error(`client failed (exit ${clientExit}): ${clientErr}`);
      const sent = JSON.parse(clientOut.trim().split("\n").pop()!);

      const resultLine = await serverLines.next();
      if (resultLine.done) throw new Error(`server exited before printing its result: ${await serverStderr}`);
      const result = JSON.parse(resultLine.value);

      const totalSent = sent.a + sent.i + sent.s;
      expect(result).toEqual({
        total: totalSent,
        counts: { a: sent.a, i: sent.i, s: sent.s, other: 0 },
        runs: phase === "loss" ? ["a", "s"] : ["a", "i"],
      });
      // handle.bytesWritten is flushed bytes + natively buffered bytes, so it
      // must equal the submitted total as soon as the writes return.
      expect(sent.bw).toBe(totalSent);
    }, 90_000);
  });
});

// On Windows the connect-error path receives raw WSA codes (WSAECONNRESET,
// WSAEADDRINUSE) from getsockopt(SO_ERROR) and the pre-connect bind(); these
// must be mapped before the errno whitelist, or every failure degrades to
// ECONNREFUSED. POSIX already reports these correctly.
describe.skipIf(!isWindows)("connect() error codes on Windows", () => {
  it("localPort in use reports EADDRINUSE", async () => {
    const server1 = createServer(() => {});
    const server2 = createServer(() => {});
    try {
      await new Promise<void>((resolve, reject) => {
        server1.on("error", reject);
        server1.listen(0, "127.0.0.1", resolve);
      });
      await new Promise<void>((resolve, reject) => {
        server2.on("error", reject);
        server2.listen(0, "127.0.0.1", resolve);
      });
      const port = (server1.address() as import("node:net").AddressInfo).port;
      const localPort = (server2.address() as import("node:net").AddressInfo).port;
      const err = await new Promise<NodeJS.ErrnoException>(resolve => {
        const c = connect({ host: "127.0.0.1", port, localAddress: "127.0.0.1", localPort });
        c.on("error", resolve);
        c.on("connect", () => {
          c.destroy();
          resolve(Object.assign(new Error("connected"), { code: "CONNECTED" }));
        });
      });
      expect(err.code).toBe("EADDRINUSE");
    } finally {
      server1.close();
      server2.close();
    }
  });

  it("server resetAndDestroy() surfaces ECONNRESET on the client", async () => {
    const server = createServer(c => {
      c.resetAndDestroy();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = (server.address() as import("node:net").AddressInfo).port;
      const err = await new Promise<NodeJS.ErrnoException>(resolve => {
        const c = connect(port, "127.0.0.1");
        c.on("error", resolve);
        c.on("close", hadError => {
          if (!hadError) resolve(Object.assign(new Error("clean close"), { code: "NOERR" }));
        });
      });
      expect(err.code).toBe("ECONNRESET");
    } finally {
      server.close();
    }
  });

  it("connect to a path that is not a socket reports ECONNREFUSED/ENOTSOCK, missing path reports ENOENT", async () => {
    const dir = tmpdirSync();
    const regular = join(dir, "not-a-socket.txt");
    fs.writeFileSync(regular, "");
    const missing = join(dir, "does-not-exist");

    const errFor = (path: string) =>
      new Promise<NodeJS.ErrnoException>(resolve => {
        const c = createConnection(path);
        c.on("error", resolve);
        c.on("connect", () => {
          c.destroy();
          resolve(Object.assign(new Error("connected"), { code: "CONNECTED" }));
        });
      });

    const regularErr = await errFor(regular);
    expect(["ENOTSOCK", "ECONNREFUSED"]).toContain(regularErr.code!);

    const missingErr = await errFor(missing);
    expect(missingErr.code).toBe("ENOENT");
  });
});

describe("net.Server.listen({ fd })", () => {
  // node's createServerHandle only accepts TCP / pipe descriptors and reports anything else as EINVAL;
  // the raw listen(2) failure for a datagram socket is EOPNOTSUPP.
  it.concurrent.skipIf(isWindows)("reports a datagram descriptor as EINVAL, like node", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--no-deprecation", // Socket.prototype._handle (DEP0112) is the only way to get the descriptor
        "-e",
        `
        const dgram = require("dgram"), net = require("net");
        const u = dgram.createSocket("udp4");
        u.bind(0, "127.0.0.1", () => {
          const s = net.createServer();
          s.on("error", e => { console.log(e.code); u.close(); });
          s.on("listening", () => { console.log("listening"); s.close(); u.close(); });
          s.listen({ fd: u._handle.fd });
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "EINVAL", stderr: "" });
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)(
    "every way to adopt a descriptor reports one that's in use as EEXIST and leaves it alone",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--no-deprecation",
          "-e",
          `
        const dgram = require("dgram"), net = require("net"), { once } = require("events");
        const server = net.createServer(socket => socket.on("data", () => socket.write("owner"))).listen(0, "127.0.0.1");
        await once(server, "listening");
        const client = net.connect(server.address().port, "127.0.0.1");
        await once(client, "connect");
        const udp = dgram.createSocket("udp4").bind(0, "127.0.0.1");
        await once(udp, "listening");

        const ask = async socket => (socket.write("x"), String((await once(socket, "data"))[0]));
        const codeOf = async adopt => {
          try {
            const adopted = await adopt();
            return adopted instanceof net.Socket ? (await once(adopted, "error"))[0].code : "adopted";
          } catch (err) {
            return err.code;
          }
        };
        const socket = { data() {} };
        for (const [owner, fd] of [["listener", server._handle.fd], ["connection", client._handle.fd]]) {
          const second = net.createServer().listen({ fd });
          console.log(owner, "net.Server:", (await once(second, "error"))[0].code);
          console.log(owner, "Bun.listen:", await codeOf(() => Bun.listen({ fd, socket })));
          console.log(owner, "Bun.connect:", await codeOf(() => Bun.connect({ fd, socket })));
          console.log(owner, "net.Socket:", await codeOf(() => new net.Socket({ fd })));
        }
        console.log("datagram socket dgram.Socket:", await codeOf(() => dgram.createSocket("udp4").bind({ fd: udp._handle.fd })));
        console.log("datagram socket Bun.udpSocket:", await codeOf(() => Bun.udpSocket({ fd: udp._handle.fd })));

        console.log("the connection answers:", await ask(client));
        const later = net.connect(server.address().port, "127.0.0.1");
        await once(later, "connect");
        console.log("the listener accepts:", await ask(later));
        dgram.createSocket("udp4").send("owner", udp.address().port, "127.0.0.1");
        console.log("the datagram socket receives:", String((await once(udp, "message"))[0]));
        process.exit(0);
        `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim().split("\n"), stderr }).toEqual({
        stdout: [
          "listener net.Server: EEXIST",
          "listener Bun.listen: EEXIST",
          "listener Bun.connect: EEXIST",
          "listener net.Socket: EEXIST",
          "connection net.Server: EEXIST",
          "connection Bun.listen: EEXIST",
          "connection Bun.connect: EEXIST",
          "connection net.Socket: EEXIST",
          "datagram socket dgram.Socket: EEXIST",
          "datagram socket Bun.udpSocket: EEXIST",
          "the connection answers: owner",
          "the listener accepts: owner",
          "the datagram socket receives: owner",
        ],
        stderr: "",
      });
      expect(exitCode).toBe(0);
    },
  );
});

// A throw from a user listener invoked synchronously from a native socket
// dispatch must reach process.on('uncaughtException') the way Node reports it,
// not be routed to the socket's 'error' event or silently dropped, and the
// connection must stay alive so subsequent bytes are still delivered. The
// listener-throw-*-fixture.js files run unchanged under node; the expected
// event logs below are what Node v26.3.0 prints for them.
describe.concurrent("uncaughtException from socket listeners", () => {
  async function runFixture(name: string, env?: Record<string, string>) {
    const { stdout, stderr, exitCode } = await bunRun(join(import.meta.dir, `listener-throw-${name}-fixture.js`), env);
    return { stdout, exitCode, ...(exitCode === 0 ? {} : { stderr }) };
  }
  const tlsEnv = { TLS_FIXTURE: JSON.stringify(tlsCert) };

  it("server-side 'data' listener throw reaches uncaughtException and the socket keeps reading", async () => {
    expect(await runFixture("server-data")).toEqual({
      stdout: JSON.stringify(["connection", "data:A", "uncaught:data-boom", "data:B", "close:false"]),
      exitCode: 0,
    });
  });

  it("client-side 'data' listener throw reaches uncaughtException and the socket keeps reading", async () => {
    expect(await runFixture("client-data")).toEqual({
      stdout: JSON.stringify(["data:A", "uncaught:data-boom", "data:B", "close:false"]),
      exitCode: 0,
    });
  });

  it("'connection' listener throw reaches uncaughtException and the accepted socket keeps reading", async () => {
    expect(await runFixture("connection")).toEqual({
      stdout: JSON.stringify(["connection", "uncaught:conn-boom", "data:A", "data:B", "close:false"]),
      exitCode: 0,
    });
  });

  it("client 'connect' listener throw reaches uncaughtException and the socket stays connected", async () => {
    expect(await runFixture("connect", { THROW_FROM: "connect" })).toEqual({
      stdout: JSON.stringify(["connect", "uncaught:connect-boom", "server-data:A", "close:false"]),
      exitCode: 0,
    });
  });

  it("client 'ready' listener throw reaches uncaughtException and the socket stays connected", async () => {
    expect(await runFixture("connect", { THROW_FROM: "ready" })).toEqual({
      stdout: JSON.stringify(["connect", "ready", "uncaught:ready-boom", "server-data:A", "close:false"]),
      exitCode: 0,
    });
  });

  // https://github.com/oven-sh/bun/issues/34064: the pg pool shape.
  it("an unhandled 'error' emitted on another emitter from a 'data' listener reaches uncaughtException", async () => {
    expect(await runFixture("foreign-emitter")).toEqual({
      stdout: JSON.stringify(["uncaught:pool error", "close:false"]),
      exitCode: 0,
    });
  });

  it("server-side TLS 'data' listener throw reaches uncaughtException and the socket keeps reading", async () => {
    expect(await runFixture("tls-server-data", tlsEnv)).toEqual({
      stdout: JSON.stringify(["secureConnection", "data:A", "uncaught:data-boom", "data:B", "close:false"]),
      exitCode: 0,
    });
  });

  it("client-side TLS 'data' listener throw reaches uncaughtException and the socket keeps reading", async () => {
    expect(await runFixture("tls-client-data", tlsEnv)).toEqual({
      stdout: JSON.stringify(["data:A", "uncaught:data-boom", "data:B", "close:false"]),
      exitCode: 0,
    });
  });

  it("without an uncaughtException handler a throwing 'data' listener crashes the process", async () => {
    const { stdout, stderr, exitCode } = await bunRun(join(import.meta.dir, "listener-throw-no-handler-fixture.js"));
    expect(stdout).not.toContain("socket-error:");
    expect(stderr).toContain("fatal-boom");
    expect(exitCode).toBe(1);
  });
});

// There is nothing to half-close yet. shutdown() used to mark the native socket as one that had
// opened, so closing it raised a connection's events ('end') and the attempt never failed.
it.skipIf(isWindows || isMusl)("closing a handle that was shut down while connecting fails its attempt", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      ${blackholePortSource}
      const events = [];
      const socket = net.connect({
        port,
        host: "blackhole.test",
        autoSelectFamily: true,
        lookup: (hostname, options, callback) =>
          process.nextTick(callback, null, [{ address: "127.0.0.1", family: 4 }, { address: "127.0.0.2", family: 4 }]),
      });
      for (const name of ["connect", "end", "error"]) socket.on(name, () => events.push(name));
      socket.on("connectionAttemptFailed", (ip, port, family, error) => events.push("connectionAttemptFailed " + error.code));
      socket.on("close", () => {
        console.log(events.join(","));
        filler.destroy();
      });
      socket.once("connectionAttempt", () =>
        setImmediate(() => {
          socket._handle.shutdown();
          socket.destroy();
        }),
      );
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "connectionAttemptFailed ECANCELED\n",
    stderr: "",
    exitCode: 0,
  });
});

// Closing the connecting handle completes its request with ECANCELED. That belongs to the connect
// that was given up, not to the one that follows.
it.skipIf(isWindows || isMusl).each([
  ["an address", `{ host: "127.0.0.1" }`, "connect,data"],
  [
    "several addresses",
    `{
      host: "blackhole.test",
      autoSelectFamily: true,
      lookup: (hostname, options, callback) =>
        callback(null, [{ address: "127.0.0.1", family: 4 }, { address: "127.0.0.2", family: 4 }]),
    }`,
    "connectionAttemptFailed ECANCELED,connect,data",
  ],
])("a socket destroyed while connecting to %s can connect again at once", async (_, options, expected) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      ${blackholePortSource}
      const events = [];
      const server = net.createServer(connection => connection.end("hi")).listen(0, "127.0.0.1", () => {
        const socket = new net.Socket();
        for (const name of ["connect", "error"]) socket.on(name, () => events.push(name));
        socket.on("connectionAttemptFailed", (ip, port, family, error) => events.push("connectionAttemptFailed " + error.code));
        socket.on("data", () => {
          events.push("data");
          console.log(events.join(","));
          socket.destroy();
          server.close();
          filler.destroy();
        });
        socket.once("connectionAttempt", () =>
          // From a timer, so that no I/O is polled between this and the next setImmediate.
          setTimeout(() => {
            socket.destroy();
            socket.connect({ ...${options}, port: server.address().port });
          }, 0),
        );
        socket.connect({ ...${options}, port });
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected + "\n", stderr: "", exitCode: 0 });
});

it.each(Object.entries({ setDefaultAutoSelectFamily, setDefaultAutoSelectFamilyAttemptTimeout }))(
  "net.%s() without an argument throws what it throws for undefined",
  (_, set) => {
    const thrownBy = (call: () => void) => {
      try {
        call();
      } catch (error: any) {
        return { name: error.name, code: error.code, message: error.message };
      }
    };
    // @ts-expect-error
    const thrown = thrownBy(() => set());
    expect(thrown).toMatchObject({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
    expect(thrown!.message).toMatch(/^The "value" argument must be of type (boolean|number)\. Received undefined$/);
    // @ts-expect-error
    expect(thrown).toEqual(thrownBy(() => set(undefined)));
  },
);

it("setTimeout() fires while connecting with a write queued", async () => {
  // A lookup that never answers keeps the socket connecting.
  const socket = connect({ host: "stalled.invalid", port: 80, lookup: () => {} });
  try {
    socket.setTimeout(1);
    socket.write("hello");
    await once(socket, "timeout");
    expect(socket.connecting).toBe(true);
  } finally {
    socket.destroy();
  }
});

// Returns a connected client and a server that never reads.
async function connectToPausedPeer() {
  const peers: Socket[] = [];
  const server = createServer({ pauseOnConnect: true }, peer => void peers.push(peer.on("error", () => {})));
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = (server.address() as any).port as number;
  const socket = connect(port, "127.0.0.1");
  await Promise.all([once(socket, "connect"), once(server, "connection")]);
  return {
    socket,
    peer: peers[0],
    port,
    [Symbol.dispose]() {
      socket.destroy();
      for (const peer of peers) peer.destroy();
      server.close();
    },
  };
}
// Writes until a write has to wait for the peer. One big write isn't enough: Winsock accepts a first send of any size.
function writeUntilQueued(stream: { write(chunk: Buffer, cb: (err?: any) => void): boolean }, events: string[] = []) {
  const chunk = Buffer.alloc(1 << 20);
  while (stream.write(chunk, err => err && events.push(`write ${err.code}`))) {}
}

it("resume() and pause() in one tick read nothing more into a full buffer", async () => {
  using pair = await connectToPausedPeer();
  const { peer } = pair;
  writeUntilQueued(pair.socket);
  const turn = () => new Promise(resolve => setImmediate(resolve));
  // The first pair starts the reads, which stop at the high water mark.
  peer.resume();
  peer.pause();
  while (peer.readableLength < peer.readableHighWaterMark) await turn();
  const full = peer.readableLength;
  peer.resume();
  peer.pause();
  // The kernel holds more, so a read that started would deliver it in the next turn.
  for (let i = 0; i < 5; i++) await turn();
  expect(peer.readableLength).toBe(full);
});

describe("setTimeout() with a queued write", () => {
  it("fires when the peer stops reading", async () => {
    using pair = await connectToPausedPeer();
    writeUntilQueued(pair.socket);
    // More than the kernel's buffers grow by, on macOS and Windows, while the peer reads nothing.
    pair.socket.write(Buffer.alloc(64 << 20));
    pair.socket.setTimeout(10);
    await once(pair.socket, "timeout");
    expect(pair.socket.writableLength).toBeGreaterThan(0);
  });

  it("restarts the timer when the write completes", async () => {
    using pair = await connectToPausedPeer();
    const { socket, peer } = pair;
    writeUntilQueued(socket);
    let restarts = 0;
    // @ts-expect-error
    socket._unrefTimer = () => void restarts++;
    peer.resume();
    await once(socket, "drain");
    expect(restarts).toBe(1);
  });
});

it("emits 'close' after the program replaced setImmediate", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      globalThis.setImmediate = require("node:timers").setImmediate = () => {};
      const net = require("node:net");
      const server = net.createServer(socket => socket.end()).listen(0, "127.0.0.1", () => {
        const client = net.connect(server.address().port, "127.0.0.1").resume();
        client.on("close", () => console.log("close"));
      });
      server.unref();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "close\n", stderr: "", exitCode: 0 });
});

// https://github.com/oven-sh/bun/issues/44551
describe("connect() replaced on the handle", () => {
  it.each([
    ["connect", { host: "127.0.0.1", port: 1 }, ["127.0.0.1", 1]],
    ["connect6", { host: "::1", port: 1 }, ["::1", 1]],
    ["connect", { path: join(socket_domain, "replaced.sock") }, [join(socket_domain, "replaced.sock")]],
  ])("%s %o takes over the connection", async (method, options, expected) => {
    const socket = new Socket();
    try {
      const { promise, resolve, reject } = Promise.withResolvers<{ thisValue: unknown; req: any; args: unknown[] }>();
      socket.on("error", reject);
      socket.once("connectionAttempt", () => {
        // @ts-expect-error
        socket._handle[method] = function (req, ...args) {
          resolve({ thisValue: this, req, args });
        };
      });
      socket.connect(options);
      const { thisValue, req, args } = await promise;
      // @ts-expect-error
      expect(thisValue).toBe(socket._handle);
      expect(args).toEqual(expected);
      expect(socket.connecting).toBe(true);

      const connected = once(socket, "connect");
      // @ts-expect-error
      req.oncomplete(0, socket._handle, req, true, true);
      await connected;
      expect(socket.connecting).toBe(false);
    } finally {
      socket.destroy();
    }
  });

  it("destroys the socket with the errno it returns", async () => {
    // libuv's UV_EACCES is -13 on POSIX and -4092 on Windows.
    const [errno] = [...getSystemErrorMap()].find(([, [name]]) => name === "EACCES")!;
    const socket = new Socket();
    try {
      socket.once("connectionAttempt", () => {
        // @ts-expect-error
        socket._handle.connect = () => errno;
      });
      socket.connect({ host: "127.0.0.1", port: 1 });
      const [error] = await once(socket, "error");
      expect(error).toMatchObject({ code: "EACCES", errno, syscall: "connect", address: "127.0.0.1", port: 1 });
    } finally {
      socket.destroy();
    }
  });
});

describe("bytesWritten", () => {
  it("counts bytes an http2 session writes through the socket", async () => {
    const http2 = require("node:http2");
    const server = http2.createServer((req, res) => res.end("ok")).listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    const socket = connect(port, "127.0.0.1");
    const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
    try {
      await once(client.request({ ":path": "/" }).resume(), "close");
      const written = client.socket.bytesWritten;
      expect(written).toBeGreaterThan(0);
      // @ts-expect-error
      expect([socket.bytesWritten, socket._bytesDispatched]).toEqual([written, written]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  it("counts a write during which the transport destroys the socket", async () => {
    let onClientWrite: (() => void) | undefined;
    const side = (peer: () => any, onWrite?: () => void) =>
      new Duplex({
        read() {},
        write(chunk: Buffer, encoding: string, callback: () => void) {
          onWrite?.();
          peer().push(chunk);
          callback();
        },
      });
    const clientSide = side(
      () => serverSide,
      () => onClientWrite?.(),
    );
    const serverSide = side(() => clientSide);
    const server = new TLSSocket(serverSide, { isServer: true, ...tlsCert }).on("error", () => {});
    const client = tlsConnect({ socket: clientSide, ca: tlsCert.cert, servername: "localhost" });
    try {
      await once(client, "secureConnect");
      onClientWrite = () => client.destroy();
      client.write("hello");
      await once(client, "close");
      expect(client.bytesWritten).toBe(5);
    } finally {
      client.destroy();
      server.destroy();
    }
  });

  // A unix socket, because there the first send after the peer closed already fails.
  it.skipIf(isWindows)("counts a write the kernel refused", async () => {
    const closed = Promise.withResolvers<[string | undefined, number]>();
    const server = createServer({ allowHalfOpen: true }, socket => {
      let code: string | undefined;
      socket.on("error", () => {});
      socket.on("close", () => closed.resolve([code, socket.bytesWritten]));
      socket.on("end", () => socket.write(Buffer.alloc(82), (err: any) => (code = err?.code)));
      socket.resume();
    });
    const path = join(socket_domain, "refused.sock");
    await once(server.listen(path), "listening");
    try {
      connect(path).on("connect", function (this: Socket) {
        this.destroy();
      });
      expect(await closed.promise).toEqual(["EPIPE", 82]);
    } finally {
      server.close();
    }
  });

  it.each([
    ["client", "destroy"],
    ["client", "resetAndDestroy"],
    ["accepted", "destroy"],
    ["accepted", "resetAndDestroy"],
  ] as const)("counts bytes still queued when the %s socket calls %s()", async (side, method) => {
    using pair = await connectToPausedPeer();
    const socket = side === "client" ? pair.socket : pair.peer;
    writeUntilQueued(socket);
    const written = socket.bytesWritten;
    socket[method]();
    await once(socket, "close");
    expect(socket.bytesWritten).toBe(written);
  });

  it("still reports the count after the peer resets the connection", async () => {
    const closed = Promise.withResolvers<Socket>();
    const server = createServer(socket => {
      socket.on("error", () => {});
      socket.on("close", () => closed.resolve(socket));
      socket.write("hello");
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const client = connect((server.address() as any).port, "127.0.0.1");
      client.on("data", () => client.resetAndDestroy());
      expect((await closed.promise).bytesWritten).toBe(5);
    } finally {
      server.close();
    }
  });
});

describe("bytesRead", () => {
  async function listen(server: Server) {
    await once(server.listen(0, "127.0.0.1"), "listening");
    return (server.address() as any).port as number;
  }

  it("restarts at 0 when the socket connects again", async () => {
    const server = createServer(socket => socket.end("hello!"));
    const port = await listen(server);
    try {
      const socket = new Socket();
      const counts: number[] = [];
      for (let i = 0; i < 3; i++) {
        socket.connect(port, "127.0.0.1").resume();
        await once(socket, "close");
        counts.push(socket.bytesRead);
      }
      expect(counts).toEqual([6, 6, 6]);
    } finally {
      server.close();
    }
  });

  it("counts the bytes an onread callback got, not the ones it declined", async () => {
    const server = createServer(socket => socket.end("hello!"));
    const port = await listen(server);
    try {
      const declined = Promise.withResolvers<void>();
      let calls = 0;
      const socket = connect({
        port,
        host: "127.0.0.1",
        // Returning false stops the reads, with "o!" left over.
        onread: { buffer: Buffer.alloc(4), callback: () => (declined.resolve(), ++calls > 1) },
      });
      await declined.promise;
      expect(socket.bytesRead).toBe(4);
      socket.resume();
      await once(socket, "close");
      expect(socket.bytesRead).toBe(6);
    } finally {
      server.close();
    }
  });

  it("counts bytes an http2 session reads from the socket", async () => {
    const http2 = require("node:http2");
    const server = http2.createServer((req, res) => res.end("ok"));
    const accepted = once(server, "connection");
    const port = await listen(server);
    const socket = connect(port, "127.0.0.1");
    const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
    try {
      await once(client.request({ ":path": "/" }).resume(), "close");
      expect(socket.bytesRead).toBeGreaterThan(0);
      expect(client.socket.bytesRead).toBe(socket.bytesRead);
      expect((await accepted)[0].bytesRead).toBeGreaterThan(0);
    } finally {
      client.destroy();
      server.close();
    }
  });
});

describe.skipIf(isWindows)("connect() to a unix socket path with no listener", () => {
  const path = join(socket_domain, "no-listener.sock");

  it("stays connecting until the event loop reports the failure", async () => {
    const socket = connect(path);
    try {
      expect({ connecting: socket.connecting, destroyed: socket.destroyed }).toEqual({
        connecting: true,
        destroyed: false,
      });
      const events: string[] = [];
      socket.on("connectionAttemptFailed", () => events.push("connectionAttemptFailed"));
      socket.on("error", (error: NodeJS.ErrnoException) => events.push(`error ${error.code}`));
      await new Promise(resolve => socket.on("close", resolve));
      expect(events).toEqual(["connectionAttemptFailed", "error ENOENT"]);
    } finally {
      socket.destroy();
    }
  });

  it("only emits 'close' when the socket is destroyed first", async () => {
    const socket = connect(path);
    const events: string[] = [];
    socket.on("error", (error: NodeJS.ErrnoException) => events.push(`error ${error.code}`));
    socket.destroy();
    await once(socket, "close");
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toEqual([]);
  });

  it("reports the latest connect() when the socket connects again before the failure", async () => {
    await using server = createServer(peer => peer.end()).listen(join(socket_domain, "second-connect.sock"));
    await once(server, "listening");
    const socket = connect(path);
    try {
      socket.connect(server.address() as string);
      await once(socket, "connect");
      await once(socket, "close");
    } finally {
      socket.destroy();
    }
  });

  it("fails an http request's write callback", async () => {
    const req = request({ socketPath: path, method: "POST" });
    const failed = once(req, "error");
    const { promise, resolve } = Promise.withResolvers<Error | null | undefined>();
    req.write("hello", resolve);
    expect(await promise).toMatchObject({ code: "ERR_SOCKET_CLOSED_BEFORE_CONNECTION" });
    expect((await failed)[0]).toMatchObject({ code: "ENOENT" });
  });

  it("fails every request queued on an http.Agent once", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");
        const agent = new http.Agent({ maxSockets: 1 });
        for (let i = 0; i < 3; i++) {
          http
            .request({ socketPath: process.argv[1], agent, path: "/" + i })
            .on("error", error => console.log(i, error.code))
            .end();
        }
        `,
        path,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("0 ENOENT\n1 ENOENT\n2 ENOENT\n");
    expect(exitCode).toBe(0);
  });
});

it("onread doesn't replay bytes it declined on the previous connection after reconnecting", async () => {
  let connections = 0;
  await using server = createServer(peer => {
    peer.on("error", () => {});
    peer.end(++connections === 1 ? "AAAABBBBCCCC" : "xxxxyyyy");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;

  const received = ["", ""];
  const declined = Promise.withResolvers<void>();
  const socket = connect({
    port,
    host: "127.0.0.1",
    onread: {
      buffer: Buffer.alloc(4),
      callback(size, buffer) {
        received[connections - 1] += buffer.toString("latin1", 0, size);
        if (connections === 1) declined.resolve();
        return connections !== 1;
      },
    },
  });
  try {
    await declined.promise;
    socket.destroy();
    await once(socket, "close");

    socket.connect({ port, host: "127.0.0.1" });
    socket.resume();
    await once(socket, "close");
    expect(received).toEqual(["AAAA", "xxxxyyyy"]);
  } finally {
    socket.destroy();
  }
});

// Linux only: a loopback RST lands before the close() that sends it returns. Elsewhere the kernel can take the rest of the write first.
it.concurrent.skipIf(!isLinux).each(["client", "accepted"])(
  "a peer reset with a write in flight and no 'error' listener throws the read error (%s socket)",
  async side => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const net = require("node:net");
        const events = [];
        process.on("uncaughtException", err => events.push("uncaught " + err.message));
        function writer(socket) {
          socket.on("end", () => events.push("end"));
          socket.on("close", () => {
            console.log(events.join(", "));
            process.exit(0);
          });
          const chunk = Buffer.alloc(1 << 20);
          while (socket.write(chunk, err => err && events.push("write " + err.code))) {}
        }
        function resetter(socket) {
          socket.on("error", () => {});
          socket.once("data", () => socket.resetAndDestroy());
        }
        const server = net.createServer(${side === "accepted" ? "writer" : "resetter"}).listen(0, "127.0.0.1", () => {
          const client = net.connect(server.address().port, "127.0.0.1");
          client.on("connect", () => ${side === "accepted" ? "resetter" : "writer"}(client));
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "uncaught read ECONNRESET, write ECANCELED\n",
      stderr: "",
      exitCode: 0,
    });
  },
);

// Linux only: elsewhere the peer's reset can reach the client as a read error before a send fails.
describe.skipIf(!isLinux)("a peer that replied and closed mid-upload", () => {
  const reply = Buffer.alloc(59642, "r");
  async function listen() {
    const server = createServer(socket => {
      socket.on("error", () => {});
      socket.end(reply, () => socket.destroy());
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    return { port: (server.address() as any).port as number, [Symbol.dispose]: () => void server.close() };
  }

  it("gets its reply delivered before the write fails", async () => {
    using server = await listen();
    const client = connect(server.port, "127.0.0.1");
    const events: string[] = [];
    let received = 0;
    client.on("data", chunk => {
      if (received === 0) events.push("data");
      received += chunk.length;
    });
    client.on("error", (err: any) => events.push(`error ${err.code} ${err.syscall}`));
    client.write(Buffer.alloc(8 << 20), (err: any) => events.push(`write ${err?.code}`));
    const hadError = await new Promise(resolve => client.once("close", resolve));
    expect({ received, events, hadError }).toEqual({
      received: reply.length,
      events: ["data", "write EPIPE", "error EPIPE write"],
      hadError: true,
    });
  });

  it.each(["nothing", "terminate", "end"] as const)(
    "Bun.connect: close() reports the failed send when data() calls %s",
    async method => {
      using server = await listen();
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open: socket => void socket.end(Buffer.alloc(8 << 20)),
          data(socket) {
            if (!events.includes("data")) events.push("data");
            if (method !== "nothing") socket[method]();
          },
          error: (socket, err: any) => void events.push(`error ${err.code}`),
          close(socket, err: any) {
            events.push(err ? `close ${err.code} ${err.syscall}` : "close");
            closed.resolve();
          },
        },
      });
      await closed.promise;
      expect(events).toEqual(["data", "close EPIPE write"]);
    },
  );
});

it("runs a queued write's callback and the 'drain' after it in the async context of write()", async () => {
  using pair = await connectToPausedPeer();
  const store = new AsyncLocalStorage<string>();
  const seen: string[] = [];
  const written = Promise.withResolvers<void>();
  store.run("write", () => {
    pair.socket.on("drain", () => seen.push(`drain ${store.getStore()}`));
    while (pair.socket.write(Buffer.alloc(1 << 20))) {}
    pair.socket.write("tail", () => {
      seen.push(`callback ${store.getStore()}`);
      written.resolve();
    });
  });
  pair.peer.resume();
  await written.promise;
  expect(seen).toEqual(["drain write", "callback write"]);
});

it.each(["accepted", "client"] as const)(
  "closes a half-open %s socket with no 'error' listener when the peer resets",
  async side => {
    const accepted = Promise.withResolvers<Socket>();
    const server = createServer({ allowHalfOpen: true }, accepted.resolve);
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const client = connect({ port: (server.address() as any).port, host: "127.0.0.1", allowHalfOpen: true });
      const [theAccepted] = await Promise.all([accepted.promise, once(client, "connect")]);
      const [socket, peer] = side === "accepted" ? [theAccepted, client] : [client, theAccepted];
      peer.on("error", () => {});
      const events: string[] = [];
      for (const event of ["end", "finish", "close"]) socket.on(event, () => events.push(event));
      socket.resume();
      peer.resetAndDestroy();
      // Not events.once(), which adds an 'error' listener.
      await new Promise(resolve => socket.once("close", resolve));
      expect(events).toEqual(["end", "finish", "close"]);
    } finally {
      server.close();
    }
  },
);

describe.each(["tcp", "unix"] as const)("a half-open socket over %s whose peer closed both directions", transport => {
  it.skipIf(isWindows && transport === "unix").each(["accepted", "client"] as const)(
    "stays open until the program ends it (%s)",
    async side => {
      const accepted = Promise.withResolvers<Socket>();
      const server = createServer({ allowHalfOpen: true }, accepted.resolve);
      try {
        if (transport === "unix") server.listen(join(tmpdirSync(), "half-open.sock"));
        else server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address() as any;
        const client = connect({
          ...(transport === "unix" ? { path: address } : { port: address.port, host: "127.0.0.1" }),
          allowHalfOpen: true,
        });
        const [theAccepted] = await Promise.all([accepted.promise, once(client, "connect")]);
        const [socket, peer] = side === "accepted" ? [theAccepted, client] : [client, theAccepted];
        const events: string[] = [];
        for (const event of ["end", "finish", "close"]) socket.on(event, () => events.push(event));
        socket.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.syscall} ${err.code}`));
        socket.resume();
        peer.destroy();
        await once(socket, "end");
        // A close that followed 'end' by itself would come within a turn or two.
        for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
        expect(events).toEqual(["end"]);
        socket.end();
        await once(socket, "close");
        expect(events).toEqual(["end", "finish", "close"]);
      } finally {
        server.close();
      }
    },
  );
});

describe("destroy()", () => {
  const code = (name: string, events: string[]) => (err?: any) => void events.push(`${name} ${err?.code}`);

  it("emits 'close' without 'end'", async () => {
    using pair = await connectToPausedPeer();
    const events: string[] = [];
    pair.socket.on("end", () => events.push("end"));
    const finished = (async () => {
      for await (const _ of pair.socket);
    })();
    const closed = once(pair.socket, "close");
    pair.socket.destroy();
    await expect(finished).rejects.toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
    await closed;
    expect(events).toEqual([]);
  });

  it("makes a later resume() a no-op", async () => {
    using pair = await connectToPausedPeer();
    const resumed = jest.fn();
    pair.socket.pause();
    pair.socket.destroy();
    await once(pair.socket, "close");
    pair.socket.on("resume", resumed).resume();
    // 'resume' would come on the next tick.
    await new Promise(resolve => setImmediate(resolve));
    expect([resumed.mock.calls.length, pair.socket.readableFlowing]).toEqual([0, false]);
  });

  it("cancels the write in flight after 'error'", async () => {
    using pair = await connectToPausedPeer();
    const events: string[] = [];
    pair.socket.on("error", code("error", events));
    writeUntilQueued(pair.socket, events);
    pair.socket.write("queued", code("queued", events));
    pair.socket.destroy(Object.assign(new Error("boom"), { code: "EBOOM" }));
    // Not events.once(), which rejects on 'error'.
    await new Promise(resolve => pair.socket.once("close", resolve));
    expect(events).toEqual(["error EBOOM", "write ECANCELED", "queued EBOOM"]);
  });

  it("doesn't fail a connect() made right after it with the canceled write", async () => {
    using pair = await connectToPausedPeer();
    const events: string[] = [];
    pair.socket.on("error", code("error", events));
    writeUntilQueued(pair.socket, events);
    pair.socket.destroy();
    pair.socket.connect(pair.port, "127.0.0.1");
    await once(pair.socket, "connect");
    expect(events).toEqual(["write ECANCELED"]);
  });
});

describe("typeOfService", () => {
  // [value before, value after setTypeOfService(value)], or what was thrown.
  const setAndGet = (socket: Socket, value: number) => {
    try {
      return [socket.getTypeOfService(), socket.setTypeOfService(value).getTypeOfService()];
    } catch (e) {
      const { code, syscall } = e as NodeJS.ErrnoException;
      return `${code} (${syscall})`;
    }
  };

  it("validates the option in the Socket constructor", () => {
    const codeFor = (typeOfService: unknown) => {
      try {
        return new Socket({ typeOfService } as import("node:net").SocketConstructorOpts).getTypeOfService();
      } catch (e) {
        return (e as NodeJS.ErrnoException).code;
      }
    };
    expect([0x10, undefined, 256, -1, 1.5, "16", null].map(codeFor)).toEqual([
      0x10,
      0,
      "ERR_OUT_OF_RANGE",
      "ERR_OUT_OF_RANGE",
      "ERR_OUT_OF_RANGE",
      "ERR_INVALID_ARG_TYPE",
      "ERR_INVALID_ARG_TYPE",
    ]);
  });

  it("TLSSocket ignores the option", () => {
    const socket = new TLSSocket(undefined, { typeOfService: 999 } as import("node:tls").TLSSocketOptions);
    expect(socket.getTypeOfService()).toBe(0);
  });

  // Windows often ignores IP_TOS.
  it.skipIf(isWindows)("applies the option to a TCP connection", async () => {
    const server = createServer(socket => socket.on("error", () => {}).resume());
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    const client = connect({ port, host: "127.0.0.1", typeOfService: 0x10 });
    try {
      await once(client, "connect");
      expect(client.getTypeOfService() & 0xfc).toBe(0x10);
    } finally {
      client.destroy();
      server.close();
    }
  });

  it.skipIf(isWindows)("caches the value on a unix socket", async () => {
    const accepted = Promise.withResolvers<unknown>();
    const server = createServer(socket =>
      accepted.resolve(
        setAndGet(
          socket.on("error", () => {}),
          0x30,
        ),
      ),
    );
    const path = join(socket_domain, "tos.sock");
    await once(server.listen(path), "listening");
    const client = connect(path);
    try {
      const connecting = setAndGet(client, 0x10);
      await once(client, "connect");
      expect({ connecting, connected: setAndGet(client, 0x20), accepted: await accepted.promise }).toEqual({
        connecting: [0, 0x10],
        connected: [0x10, 0x20],
        accepted: [0, 0x30],
      });
    } finally {
      client.destroy();
      server.close();
    }
  });

  // undici sets the value before each request, and through an https proxy the request socket is TLS inside TLS.
  it("caches the value on a TLS socket over a Duplex", async () => {
    const [clientSide, serverSide] = duplexPair();
    const server = new TLSSocket(serverSide, { isServer: true, ...tlsCert });
    const client = tlsConnect({ socket: clientSide, ca: tlsCert.cert, servername: "localhost" });
    try {
      const beforeHandshake = setAndGet(client, 1);
      await once(client, "secureConnect");
      expect({ beforeHandshake, connected: setAndGet(client, 2) }).toEqual({
        beforeHandshake: [0, 1],
        connected: [1, 2],
      });
    } finally {
      client.destroy();
      server.destroy();
    }
  });
});
