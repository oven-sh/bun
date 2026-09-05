import { Socket as _BunSocket, TCPSocketListener } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount, gc, isASAN, isDebug, isWindows, tmpdirSync } from "harness";
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
          const s = net.connect({ host: "localhost", port: ${server.address().port}, autoSelectFamily: true, lookup });
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
    const batch = [];
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
        }, 1000);
      });
    `);
    // A level-triggered hangup left registered would have burned the whole 1s of
    // wall time as CPU; 500ms leaves room over the debug+ASAN idle baseline.
    const cpuMicros = Number((result.lines.find(l => l.startsWith("cpu ")) ?? "cpu -1").slice(4));
    expect({ ...result, cpuIdle: cpuMicros >= 0 && cpuMicros < 500_000 }).toEqual({
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
      const c = connect({ port, host: "127.0.0.1", onread: { buffer: Buffer.alloc(16), callback: () => {} } });
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
    server.pauseOnConnect = true;
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
      await new Promise<void>((resolve, reject) => client!.end("hello", err => (err ? reject(err) : resolve())));
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
      while (!client._readableState?.ended && !client.destroyed) await new Promise<void>(r => setImmediate(r));
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
      await new Promise<void>((resolve, reject) => client!.end("hello", err => (err ? reject(err) : resolve())));
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
      while (!sock._readableState?.ended && !sock.destroyed) await new Promise<void>(r => setImmediate(r));
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

// node lets a throwing onread callback escape as an uncaught exception:
// onStreamRead calls the user callback bare, so the process dies rather than
// the socket being failed closed.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L179
it("onread: a callback that throws is an uncaught exception", async () => {
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
  expect(exitCode).not.toBe(0);
});

// Node bounds each kernel read to the onread buffer's size, so a throw that is
// swallowed by a process.on('uncaughtException') handler loses no bytes (the
// next slice is a separate onStreamRead call). Bun slices one larger native
// read in JS, so the catch is per-slice to preserve that.
it("onread: a swallowed throw does not drop the rest of the current native read", async () => {
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

describe("net.Socket write buffering behind a stalled peer", () => {
  // A writer that queues past backpressure fills the Writable buffer; when the
  // in-flight _write completes, clearBuffer hands the whole batch to _writev.
  // Node holds the caller's Buffers by reference in a uv_write_t, so queuing
  // N bytes costs ~N bytes of RSS. Concatenating the batch and copying the
  // unsent tail into a native Vec on top of the caller's live references costs
  // ~2x that at steady state (and ~3x at the transient peak).
  //
  // cork()/uncork() forces the whole batch through _writev synchronously so the
  // sample is deterministic; the `bufs` array keeps the caller's references
  // live so the steady-state difference (native copy vs. reference) is what is
  // measured, not the GC-raceable transient peak.
  //
  // Windows keeps the Buffer.concat path (Winsock only completes a first large
  // send synchronously when it is a single WSASend, and usockets has no
  // vectored send there), so the by-reference bound only applies on POSIX.
  it.skipIf(isWindows)(
    "holds queued _writev chunks by reference instead of copying into the native buffer",
    async () => {
      const CHUNK = 65536;
      const N = 1024; // 64 MiB queued
      const fixture = `
      const net = require("node:net");
      const CHUNK = ${CHUNK};
      const N = ${N};
      const server = net.createServer({ pauseOnConnect: true }, () => {});
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        const c = net.connect(port, "127.0.0.1", () => {
          Bun.gc(true);
          const rss0 = process.memoryUsage().rss;
          const bufs = [];
          c.cork();
          for (let n = 0; n < N; n++) {
            const b = Buffer.alloc(CHUNK, 0x62);
            bufs.push(b);
            c.write(b);
          }
          c.uncork();
          Bun.gc(true);
          const rss1 = process.memoryUsage().rss;
          process.stdout.write(JSON.stringify({
            writableLength: c.writableLength,
            rssDelta: rss1 - rss0,
            held: bufs.length,
          }) + "\\n");
          c.destroy();
          server.close();
        });
      });
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const { writableLength, rssDelta, held } = JSON.parse(stdout);
      const queued = CHUNK * N;
      expect(held).toBe(N);
      // Most of the 64 MiB is still queued (a few MiB went to the kernel send
      // buffer); writableLength reports the queued byte count either way.
      expect(writableLength).toBeGreaterThan(queued * 0.75);
      // Holding the queue by reference costs ~1.0x on top of the caller's live
      // `bufs` (same Buffers). Copying into the native Vec costs another ~1.0x
      // (plus growth headroom), i.e. >= 2.0x. The bound sits between the two,
      // with headroom for ASAN/debug per-allocation overhead on the reference
      // side.
      const bound = queued * (isASAN || isDebug ? 1.7 : 1.5);
      expect(rssDelta).toBeLessThan(bound);
      expect(exitCode).toBe(0);
    },
  );

  // The chunk-by-chunk path must still deliver every byte in order once the
  // peer starts reading: this exercises the drain-resume path where
  // _pendingData is an array.
  it("delivers every queued byte in order once the peer reads", async () => {
    const CHUNK = 65536;
    const N = 512; // 32 MiB
    const serverRecv = Promise.withResolvers<Buffer>();
    const server = createServer({ pauseOnConnect: true }, sock => {
      setImmediate(() => sock.resume());
      const chunks: Buffer[] = [];
      sock.on("data", d => chunks.push(d));
      sock.on("end", () => {
        sock.destroy();
        serverRecv.resolve(Buffer.concat(chunks));
      });
      sock.on("error", serverRecv.reject);
    });
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as import("node:net").AddressInfo).port;

    const expected = Buffer.allocUnsafe(CHUNK * N);
    const finished = Promise.withResolvers<void>();
    let sawFalse = false;
    let c: Socket | undefined;
    try {
      c = connect(port, "127.0.0.1", () => {
        for (let n = 0; n < N; n++) {
          const b = Buffer.alloc(CHUNK, n & 0xff);
          b.copy(expected, n * CHUNK);
          if (!c!.write(b)) sawFalse = true;
        }
        c!.end();
        c!.on("finish", finished.resolve);
      });
      c.on("error", err => {
        finished.reject(err);
        serverRecv.reject(err);
      });
      const got = await serverRecv.promise;
      await finished.promise;
      // The test only exercises the _writev queue path if backpressure was hit.
      expect(sawFalse).toBe(true);
      expect(got.length).toBe(CHUNK * N);
      expect(got.equals(expected)).toBe(true);
      expect(c.bytesWritten).toBe(CHUNK * N);
    } finally {
      c?.destroy();
      server.close();
    }
  });

  // Multi-chunk twin of "a write still waiting for drain does keep it alive":
  // the unread reply pauses the client (dropping its hold on the loop), the
  // first chunk's drain gives the hold up again via unrefAfterDrain, and the
  // batch _writev then parks behind it must re-take it the way _write does,
  // or the process exits with the queue unflushed.
  it.skipIf(isWindows)("a parked _writev batch keeps the process alive until it drains", async () => {
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
            for (let i = 0; i < 127; i++) c.write(Buffer.alloc(64 * 1024, 0x62));
            c.write(Buffer.alloc(64 * 1024, 0x62), () => { drained = true; c.destroy(); });
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
    expect(["ENOTSOCK", "ECONNREFUSED"]).toContain(regularErr.code);

    const missingErr = await errFor(missing);
    expect(missingErr.code).toBe("ENOENT");
  });
});

describe("net.Server.listen({ fd })", () => {
  // node's createServerHandle only accepts TCP / pipe descriptors and reports anything else as EINVAL;
  // the raw listen(2) failure for a datagram socket is EOPNOTSUPP.
  it.skipIf(isWindows)("reports a datagram descriptor as EINVAL, like node", async () => {
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
});
