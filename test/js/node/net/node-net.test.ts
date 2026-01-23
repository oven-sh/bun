import { Socket as _BunSocket, TCPSocketListener } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount, isWindows, tls as tlsCert, tmpdirSync } from "harness";
import { randomUUID } from "node:crypto";
import net, { connect, createConnection, createServer, isIP, isIPv4, isIPv6, Server, Socket, Stream } from "node:net";
import { join } from "node:path";
import tls from "node:tls";

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
    }, 2000);
    expect(await process.exited).toBe(0);
    clearTimeout(timeout);
  } finally {
    server.close();
  }
});

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
    }, 2000);
    expect(await process.exited).toBe(0);
    clearTimeout(timeout);
  } finally {
    server.close();
  }
});

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

// Regression test for #22481
it("client socket can write Uint8Array", async () => {
  const server = createServer(socket => {
    socket.on("data", data => {
      // Echo back what we received
      socket.write(data);
      socket.end();
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as any).port;

  const testData = "Hello from Uint8Array!";
  const u8 = new Uint8Array(testData.split("").map(x => x.charCodeAt(0)));

  // Test with Uint8Array
  {
    const received = await new Promise<string>((resolve, reject) => {
      const client = createConnection(port, "127.0.0.1", () => {
        // Write Uint8Array directly
        client.write(u8, err => {
          if (err) reject(err);
        });
      });

      let data = "";
      client.on("data", chunk => {
        data += chunk.toString();
      });

      client.on("end", () => {
        resolve(data);
      });

      client.on("error", reject);
    });

    expect(received).toBe(testData);
  }

  // Test with Buffer.from(Uint8Array) for comparison
  {
    const received = await new Promise<string>((resolve, reject) => {
      const client = createConnection(port, "127.0.0.1", () => {
        // Write Buffer created from Uint8Array
        client.write(Buffer.from(u8), err => {
          if (err) reject(err);
        });
      });

      let data = "";
      client.on("data", chunk => {
        data += chunk.toString();
      });

      client.on("end", () => {
        resolve(data);
      });

      client.on("error", reject);
    });

    expect(received).toBe(testData);
  }

  // Test with other TypedArrays (Float32Array view)
  {
    const float32 = new Float32Array([1.5, 2.5]);
    const u8view = new Uint8Array(float32.buffer);

    const received = await new Promise<Buffer>((resolve, reject) => {
      const client = createConnection(port, "127.0.0.1", () => {
        client.write(u8view, err => {
          if (err) reject(err);
        });
      });

      const chunks: Buffer[] = [];
      client.on("data", chunk => {
        chunks.push(chunk);
      });

      client.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      client.on("error", reject);
    });

    // Check that we received the same bytes back
    expect(received).toEqual(Buffer.from(u8view));
  }

  server.close();
});

// Regression test for #24575
it("socket._handle.fd should be accessible on TCP sockets", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  let serverFd: number | undefined;
  let clientFd: number | undefined;

  const server = net.createServer(socket => {
    // Server-side socket should have _handle.fd
    expect(socket._handle).toBeDefined();
    expect(socket._handle.fd).toBeTypeOf("number");
    expect(socket._handle.fd).toBeGreaterThan(0);
    serverFd = socket._handle.fd;

    socket.end(`server fd: ${socket._handle.fd}`);
  });

  server.listen(0, "127.0.0.1", () => {
    const client = net.connect({
      host: "127.0.0.1",
      port: (server.address() as any).port,
    });

    client.on("connect", () => {
      // Client-side socket should have _handle.fd
      expect(client._handle).toBeDefined();
      expect(client._handle.fd).toBeTypeOf("number");
      expect(client._handle.fd).toBeGreaterThan(0);
      clientFd = client._handle.fd;
    });

    client.on("data", data => {
      const response = data.toString();
      expect(response).toStartWith("server fd: ");

      // Verify we got valid fds
      expect(serverFd).toBeTypeOf("number");
      expect(clientFd).toBeTypeOf("number");
      expect(serverFd).toBeGreaterThan(0);
      expect(clientFd).toBeGreaterThan(0);

      // Server and client should have different fds
      expect(serverFd).not.toBe(clientFd);

      server.close();
      resolve();
    });

    client.on("error", reject);
  });

  server.on("error", reject);

  await promise;
});

// Regression test for #24575
it("socket._handle.fd should remain consistent during connection lifetime", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = net.createServer(socket => {
    const initialFd = socket._handle.fd;

    // Send multiple messages to ensure fd doesn't change
    socket.write("message1\n");
    expect(socket._handle.fd).toBe(initialFd);

    socket.write("message2\n");
    expect(socket._handle.fd).toBe(initialFd);

    socket.end("message3\n");
    expect(socket._handle.fd).toBe(initialFd);
  });

  server.listen(0, "127.0.0.1", () => {
    const client = net.connect({
      host: "127.0.0.1",
      port: (server.address() as any).port,
    });

    let initialClientFd: number;
    let buffer = "";

    client.on("connect", () => {
      initialClientFd = client._handle.fd;
      expect(initialClientFd).toBeGreaterThan(0);
    });

    client.on("data", data => {
      buffer += data.toString();
      // Fd should remain consistent across multiple data events
      expect(client._handle.fd).toBe(initialClientFd);
    });

    client.on("end", () => {
      // Verify we received all messages
      expect(buffer).toBe("message1\nmessage2\nmessage3\n");
      server.close();
      resolve();
    });

    client.on("error", reject);
  });

  server.on("error", reject);

  await promise;
});

// Regression test for #24575
it("socket._handle.fd should be accessible on TLS sockets", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  let serverFd: number | undefined;
  let clientFd: number | undefined;

  const server = tls.createServer(tlsCert, socket => {
    // Server-side TLS socket should have _handle.fd
    expect(socket._handle).toBeDefined();
    expect(socket._handle.fd).toBeTypeOf("number");
    // TLS sockets should have a valid fd (may be -1 on some platforms/states)
    expect(typeof socket._handle.fd).toBe("number");
    serverFd = socket._handle.fd;

    socket.end(`server fd: ${socket._handle.fd}`);
  });

  server.listen(0, "127.0.0.1", () => {
    const client = tls.connect({
      host: "127.0.0.1",
      port: (server.address() as any).port,
      rejectUnauthorized: false,
    });

    client.on("secureConnect", () => {
      // Client-side TLS socket should have _handle.fd
      expect(client._handle).toBeDefined();
      expect(client._handle.fd).toBeTypeOf("number");
      // TLS sockets should have a valid fd (may be -1 on some platforms/states)
      expect(typeof client._handle.fd).toBe("number");
      clientFd = client._handle.fd;
    });

    client.on("data", data => {
      const response = data.toString();
      expect(response).toMatch(/server fd: -?\d+/);

      // Verify we got valid fds (number type, even if -1)
      expect(serverFd).toBeTypeOf("number");
      expect(clientFd).toBeTypeOf("number");

      server.close();
      resolve();
    });

    client.on("error", reject);
  });

  server.on("error", reject);

  await promise;
});
