import { Socket as _BunSocket, TCPSocketListener } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount, isASAN, isDebug, isWindows, tempDir, tmpdirSync } from "harness";
import { randomUUID } from "node:crypto";
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

  const err = (await promise) as Error;
  expect(err.name).toBe("TimeoutError");
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

  const err = (await promise) as Error;
  expect(err.name).toBe("TimeoutError");
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
      // reclamation and JSC heap oscillation — same result on every
      // platform, every run.
      function pageCount() {
        return heapStats().mimalloc.page_bins.reduce((a, b) => a + b.current, 0);
      }

      await run(2000);
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
    // Without the balancing deref: +25 pages (release) / +163 pages
    // (debug+ASAN). With it: 0 ± 2. The threshold sits well clear of both.
    expect(delta, `mimalloc page count: ${before} -> ${after}`).toBeLessThan(10);
    expect(exitCode).toBe(0);
  },
  60_000,
);

// https://github.com/oven-sh/bun/issues/32087
describe("socket write while data is buffered natively", () => {
  // Byte-counting sink. Counts received bytes per fill value by scanning runs
  // with indexOf so multi-MB streams stay cheap to verify in debug builds.
  // STALL_ON_ACCEPT=1 blocks the event loop on accept so nothing is read
  // while the client writes, keeping the kernel buffers full.
  const serverFixture = /* js */ `
    import net from "node:net";
    const KNOWN = [0x61, 0x69, 0x73]; // 'a', 'i', 's'
    const counts = { a: 0, i: 0, s: 0, other: 0 };
    const runs = [];
    let total = 0;
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
    const server = net.createServer(c => {
      c.on("data", scan);
      let printed = false;
      const done = () => {
        if (printed) return;
        printed = true;
        console.log(JSON.stringify({ total, counts, runs }));
        c.destroy();
        server.close();
      };
      c.on("end", done);
      c.on("close", done);
      c.on("error", done);
      if (process.env.STALL_ON_ACCEPT === "1") {
        Bun.sleepSync(1500);
      }
    });
    server.listen(0, "127.0.0.1", () => {
      console.log(JSON.stringify({ port: server.address().port }));
    });
  `;

  // Drives the native buffered-write path the same way net.ts's own stream
  // machinery does: Socket.prototype._write -> handle.$write. The _write
  // callback fires synchronously iff the kernel accepted the whole chunk, so
  // a false return from writeDirect means bytes are now buffered natively.
  const clientFixture = /* js */ `
    import net from "node:net";
    const phase = process.argv[2]; // "loss" | "dup"
    const port = Number(process.argv[3]);
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
      if (phase === "loss") {
        // Build a native remainder far larger than the kernel can accept in
        // one writev; the follow-up write's writev then always stops inside
        // the old buffered data (written < buffered.len).
        for (let attempt = 0; attempt < 8 && !sawPartial; attempt++) {
          const A = Buffer.alloc(16 * 1024 * 1024, 0x61);
          sawPartial = !writeDirect(A);
          sent.a += A.length;
        }
        if (sawPartial) {
          const S = Buffer.alloc(64 * 1024, 0x73);
          writeDirect(S);
          sent.s = S.length;
        }
      } else {
        // Leave a small (< 1MB) native remainder...
        for (let attempt = 0; attempt < 64 && !sawPartial; attempt++) {
          const C = Buffer.alloc(1024 * 1024, 0x61);
          sawPartial = !writeDirect(C);
          sent.a += C.length;
        }
        if (sawPartial) {
          // ...then block the event loop (so the native flush cannot run)
          // while the peer drains the kernel buffers, and write a chunk the
          // kernel will accept past the end of the buffered remainder
          // (written > buffered.len).
          Bun.sleepSync(1500);
          const I = Buffer.alloc(32 * 1024 * 1024, 0x69);
          writeDirect(I);
          sent.i = I.length;
        }
      }
      if (!sawPartial) {
        console.error("precondition failed: no direct write left data in the native buffer");
        sock.destroy();
        process.exit(3);
      }
      sent.bw = sock.bytesWritten;
      console.log(JSON.stringify(sent));
      sock.end();
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

  // "loss": after a partial writev that stops inside the previously buffered
  // data, the unsent new chunk must be kept (not dropped).
  // "dup": after a partial writev that consumes all previously buffered data
  // plus a prefix of the new chunk, the bytes that hit the wire must not be
  // buffered (and resent) again.
  it.each(["loss", "dup"] as const)(
    "a partial writev keeps exactly the unsent suffix (%s)",
    async phase => {
      using dir = tempDir("writev-remainder", {
        "server-fixture.mjs": serverFixture,
        "client-fixture.mjs": clientFixture,
      });

      await using server = Bun.spawn({
        cmd: [bunExe(), "server-fixture.mjs"],
        env: phase === "loss" ? { ...bunEnv, STALL_ON_ACCEPT: "1" } : bunEnv,
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
    },
    90_000,
  );
});
