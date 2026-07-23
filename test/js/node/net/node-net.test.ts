import { Socket as _BunSocket, TCPSocketListener } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount, isASAN, isDebug, isWindows, tmpdirSync } from "harness";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import {
  BlockList,
  connect,
  createConnection,
  createServer,
  isIP,
  isIPv4,
  isIPv6,
  Server,
  Socket,
  Stream,
} from "node:net";
import { join } from "node:path";

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
                hostname: "localhost",
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
              callback: (size, buf) => {
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
    const port = await new Promise(resolve => {
      server.once("listening", () => resolve(server.address().port));
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
            socket.end(() => setTimeout(resolve, 3));
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
  it.skipIf(!isDebug && !isASAN)(
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

  it.skipIf(!isDebug && !isASAN)(
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

  it.skipIf(!isDebug && !isASAN)(
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

it("should handle connection error", done => {
  let errored = false;

  // @ts-ignore
  const socket = connect(55555, "127.0.0.1", () => {
    done(new Error("Should not have connected"));
  });

  socket.on("error", error => {
    if (errored) {
      return done(new Error("Should not have errored twice"));
    }
    errored = true;
    expect(error).toBeDefined();
    expect(error.message).toBe("connect ECONNREFUSED 127.0.0.1:55555");
    expect((error as any).code).toBe("ECONNREFUSED");
    expect((error as any).syscall).toBe("connect");
    expect((error as any).address).toBe("127.0.0.1");
    expect((error as any).port).toBe(55555);
  });

  socket.on("connect", () => {
    done(new Error("Should not have connected"));
  });

  socket.on("close", () => {
    expect(errored).toBe(true);
    done();
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
});

it("unref should exit when no more work pending", async () => {
  const process = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-unref-fixture.js")],
    env: bunEnv,
  });
  expect(await process.exited).toBe(0);
});

it("socket should keep process alive if unref is not called", async () => {
  const process = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-ref-default-fixture.js")],
    env: bunEnv,
  });
  expect(await process.exited).toBe(1);
});

// Node never resumes a socket on the user's behalf: afterConnect only calls
// read(0) (lib/net.js), so bytes that arrive before a 'data' listener is
// attached stay buffered instead of being emitted to nobody and lost.
it("a connected socket is not flowing until the user reads from it", async () => {
  const { promise: received, resolve: onClose, reject } = Promise.withResolvers<string>();
  const server = createServer(c => {
    c.on("error", reject);
    c.end("early-data");
  });
  let client: Socket | undefined;
  try {
    // events.once rejects these awaits if 'error' is emitted instead.
    await once(server.listen(0, "127.0.0.1"), "listening");
    client = createConnection(server.address().port, "127.0.0.1");
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

it("should not hang after FIN", async () => {
  const net = require("node:net");
  const { promise: listening, resolve: resolveListening, reject } = Promise.withResolvers();
  const server = net.createServer(c => {
    c.write("Hello client");
    c.end();
  });
  try {
    server.on("error", reject);
    server.listen(0, () => {
      resolveListening(server.address().port);
    });
    const process = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "node-fin-fixture.js")],
      stderr: "inherit",
      stdin: "ignore",
      stdout: "inherit",
      env: {
        ...bunEnv,
        PORT: ((await listening) as number).toString(),
      },
    });
    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error("Timeout"));
    }, 60_000);
    expect(await process.exited).toBe(0);
    clearTimeout(timeout);
  } finally {
    server.close();
  }
}, 120_000);

it("should not hang after destroy", async () => {
  const net = require("node:net");
  const { promise: listening, resolve: resolveListening, reject } = Promise.withResolvers();
  const server = net.createServer(c => {
    // The client destroys without reading; the resulting RST surfaces as
    // ECONNRESET here (Node behaves identically) — handle it.
    c.on("error", () => {});
    c.write("Hello client");
  });
  try {
    server.on("error", reject);
    server.listen(0, () => {
      resolveListening(server.address().port);
    });
    const process = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "node-destroy-fixture.js")],
      stderr: "inherit",
      stdin: "ignore",
      stdout: "inherit",
      env: {
        ...bunEnv,
        PORT: ((await listening) as number).toString(),
      },
    });
    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error("Timeout"));
    }, 60_000);
    expect(await process.exited).toBe(0);
    clearTimeout(timeout);
  } finally {
    server.close();
  }
}, 120_000);

it("should trigger error when aborted even if connection failed #13126", async () => {
  const signal = AbortSignal.timeout(100);
  const socket = createConnection({
    host: "example.com",
    port: 999,
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

it("should trigger error when aborted even if connection failed, and the signal is already aborted #13126", async () => {
  const signal = AbortSignal.timeout(1);
  await Bun.sleep(10);
  const socket = createConnection({
    host: "example.com",
    port: 999,
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

    const batch = [];
    const before = heapStats().objectTypeCounts.TLSSocket || 0;
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
    expectMaxObjectTypeCount(expect, "TCPSocket", before);
  },
  20_000,
);

// On Windows, unix paths route through the named-pipe codepath which reports
// failure asynchronously; this test targets the synchronous-failure branch in
// Listener.connectInner.
it.skipIf(isWindows)(
  "should not leak when connect({path}) fails synchronously on a reused handle",
  async () => {
    // node:net creates a detached native socket (`_handle`) and passes it as
    // `prev` to connectInner. connectInner unconditionally `socket.ref()`s
    // before `doConnect`. A nonexistent unix path makes `doConnect` throw
    // synchronously while the socket is still `.detached`, so
    // `handleConnectError`'s own deref (gated on `!isDetached()`) does not
    // fire — the ref taken here must be released by the caller for reused
    // sockets too, not only freshly-allocated ones. Without that, every
    // failed reconnect leaks one native TCPSocket struct + its connection
    // string.
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
      // (release) / ~160 pages (debug+ASAN). Unlike RSS this is the
      // allocator's own bookkeeping, so it's independent of OS page
      // reclamation.
      function pageCount() {
        return heapStats().mimalloc.page_bins.reduce((a, b) => a + b.current, 0);
      }

      // Warm up with the SAME workload as the measured run: on builds where
      // JSC shares mimalloc, its heap keeps growing until the first full-size
      // batch, so equal batches make the delta isolate the per-run leak.
      await run(8000);
      const before = pageCount();
      await run(8000);
      const after = pageCount();
      console.log(JSON.stringify({ before, after, delta: after - before }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { before, after, delta } = JSON.parse(stdout.trim().split("\n").pop()!);
    // Without the balancing deref: +25 pages (release) / +163 (debug+ASAN).
    // With it the socket delta is 0, but since #34009 JSC shares mimalloc and
    // adds up to +14 of heap noise on aarch64/darwin release (build 75589).
    expect(delta, `mimalloc page count: ${before} -> ${after}`).toBeLessThan(20);
    expect(exitCode).toBe(0);
  },
  60_000,
);

describe("Socket fd adoption", () => {
  it("writes synchronously to an adopted fd and closes it (> 2) on destroy", async () => {
    const path = join(tmpdirSync(), "adopted-fd.txt");
    const fd = fs.openSync(path, "w");
    const socket = new Socket({ fd, readable: false, writable: true });
    await new Promise<void>((resolve, reject) => {
      socket.on("close", () => resolve());
      socket.on("error", reject);
      socket.end("hello");
    });
    expect(fs.readFileSync(path, "utf8")).toBe("hello");
    // Sync fd writes must feed the byte counters (no native handle to do it).
    expect(socket._bytesDispatched).toBe(5);
    // The adopted fd must be released on destroy (node closes the wrapping
    // libuv handle in the equivalent path).
    expect(() => fs.fstatSync(fd)).toThrow();
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

  it("a bare { fd } does not throw so connect({ fd }) can attach a native handle", () => {
    // No explicit writable: true -> no adoption, no fstat. child_process
    // extra stdio relies on this path (connect({ fd }) attaches natively).
    expect(() => new Socket({ fd: 0x7ffff })).not.toThrow();
  });
});

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
      await new Promise<void>((resolve, reject) => client!.end("hello", err => (err ? reject(err) : resolve())));
      const buf = await received.promise;
      expect({ flowingAtConnection, data: buf?.toString() }).toEqual({ flowingAtConnection: null, data: "hello" });
    } finally {
      client?.destroy();
      server.close();
    }
  });

  it("delivers bytes to a 'data' listener attached via setImmediate from the connection handler", async () => {
    // The abandoned-socket teardown at EOF is deferred so a nextTick /
    // microtask / setImmediate attach still counts as engaging the reader.
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
      await new Promise<void>((resolve, reject) => client!.end("hello", err => (err ? reject(err) : resolve())));
      const data = await received.promise;
      expect(data).toBe("hello");
    } finally {
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
          callback: () => reject(new Error("onread callback must not be invoked")),
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

it("onread: a callback that throws mid-chunk destroys the socket instead of leaving a byte gap", async () => {
  // Node has no catch here (the throw is an uncaughtException). bun fails the
  // socket closed: without that, the undelivered rest of the thrown-on chunk
  // ("efghijkl") is dropped and the NEXT write is delivered after a silent gap.
  const calls: string[] = [];
  const errored = Promise.withResolvers<Error>();
  // 12 bytes through a 4-byte buffer; the connection stays open, and the
  // server answers any client byte with a second write.
  const server = createServer(c => {
    c.on("data", () => c.write("XYZ"));
    c.write(Buffer.from("abcdefghijkl"));
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
          calls.push(buf.toString("latin1", 0, n));
          if (calls.length === 1) throw new Error("boom");
          return true;
        },
      },
    });
    client.on("error", e => {
      errored.resolve(e as Error);
      // A destroyed (fail-closed) socket cannot solicit the second write.
      if (!client!.destroyed) client!.write("ping");
    });
    const err = await errored.promise;
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    expect({ message: err.message, calls, destroyed: client.destroyed }).toEqual({
      message: "boom",
      calls: ["abcd"],
      destroyed: true,
    });
  } finally {
    client?.destroy();
    server.close();
  }
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
    expect(["EPIPE", "ECONNRESET", "ENOTCONN"]).toContain(err.code);
    expect(typeof err.errno).toBe("number");
  } finally {
    server.close();
  }
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
