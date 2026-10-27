import { afterAll } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { AddressInfo, createServer, Server, Socket } from "net";
import { createTest } from "node-harness";
import { once } from "node:events";
import { tmpdir } from "os";
import { join } from "path";

const { describe, expect, it, createCallCheckCtx } = createTest(import.meta.path);

const socket_domain = join(realpathSync(tmpdir()), "node-net-server.sock");

// Runs a command under a seccomp filter that fails socket(<family>, ...) with <errno>, as a kernel
// without that address family does. `skip` means this host cannot do that (no C compiler, no kernel
// headers, or a kernel or sandbox that refuses the filter). `error` is a bug in the helper itself.
const AF_UNIX = 1;
const AF_INET6 = 10;
const EMFILE = 24;
const EAFNOSUPPORT = 97;
const denySocket: { bin: string } | { skip: true } | { error: string } = (() => {
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  if (!isLinux || !cc) return { skip: true };
  const dir = tempDir("deny-socket", {
    "kernel-headers.c": "#include <linux/filter.h>\n#include <linux/seccomp.h>\n",
    "deny-socket.c": `
#include <errno.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

/* usage: deny-socket <family> <errno> <command> [args...]
          deny-socket <family> <errno> --probe    exit 0 when the filter works on this host, else 77 */
int main(int argc, char **argv) {
  if (argc < 4) return 2;
  int family = atoi(argv[1]), err = atoi(argv[2]);
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 3),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, family, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (err & SECCOMP_RET_DATA)),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = { sizeof(filter) / sizeof(filter[0]), filter };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return 77;
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) return 77;
  if (strcmp(argv[3], "--probe") == 0) return socket(family, SOCK_STREAM, 0) < 0 && errno == err ? 0 : 77;
  execvp(argv[3], argv + 3);
  return 127;
}
`,
  });
  const result = ((): typeof denySocket => {
    const bin = join(String(dir), "deny-socket");
    try {
      const compile = Bun.spawnSync({
        cmd: [cc, "-O0", "-o", bin, join(String(dir), "deny-socket.c")],
        stderr: "pipe",
      });
      if (compile.exitCode !== 0) {
        // A host without the kernel headers (a separate package on some distros) skips. Any other failure is a bug.
        const headers = Bun.spawnSync({
          cmd: [cc, "-E", join(String(dir), "kernel-headers.c")],
          stdout: "ignore",
          stderr: "ignore",
        });
        return headers.exitCode === 0 ? { error: compile.stderr.toString() } : { skip: true };
      }
      const probe = Bun.spawnSync({ cmd: [bin, String(AF_INET6), String(EAFNOSUPPORT), "--probe"] });
      return probe.exitCode === 0 ? { bin } : { skip: true };
    } catch {
      // spawnSync throws when the host cannot run the binary it built.
      return { skip: true };
    }
  })();
  // The tests need the binary until the file ends. Every other outcome is done with the directory now.
  if ("bin" in result) afterAll(() => dir[Symbol.dispose]());
  else dir[Symbol.dispose]();
  return result;
})();

// Runs `script` with bun -e while socket(family, ...) fails with errno.
async function runWithSocketDenied(family: number, errno: number, script: string) {
  if ("error" in denySocket) throw new Error("failed to compile deny-socket.c:\n" + denySocket.error);
  await using proc = Bun.spawn({
    cmd: [(denySocket as { bin: string }).bin, String(family), String(errno), bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("net.createServer listen", () => {
  it("should throw when no port or path when using options", done => {
    expect(() => createServer().listen({ exclusive: true })).toThrow(
      'The argument \'options\' must have the property "port" or "path". Received {"exclusive":true}',
    );
    done();
  });

  // No secondary setTimeout deadline: the test runner already bounds each test,
  // and a real listen failure reaches done() via the 'error' listener below.
  const failOnError = (server: Server, done: (err?: unknown) => void) => (err: unknown) => {
    server.close();
    done(err);
  };

  it("should listen on IPv6 by default", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on IPv4", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      "0.0.0.0",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("0.0.0.0");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv4");
        server.close();
        done();
      }),
    );
  });

  // Prints how a listen() call ends: the error fields, or the address it listens on.
  // once("listening") rejects with the "error" event, so this settles either way.
  const listenOutcome = `
    import { once } from "node:events";
    import { createServer } from "node:net";
    async function listenOutcome(...args) {
      const server = createServer().listen(...args);
      try {
        await once(server, "listening");
      } catch (err) {
        return { code: err.code, syscall: err.syscall, address: err.address, message: err.message };
      }
      const listening = server.address();
      server.close();
      return { listening };
    }
  `;

  // A kernel without IPv6 (ipv6.disable=1) fails socket(AF_INET6) with EAFNOSUPPORT. Node binds
  // "::" when listen() gets no host and falls back to "0.0.0.0" there.
  it.skipIf("skip" in denySocket)(
    "should fall back to 0.0.0.0 when no host is given and the kernel has no IPv6",
    async () => {
      const { stdout, stderr, exitCode } = await runWithSocketDenied(
        AF_INET6,
        EAFNOSUPPORT,
        `${listenOutcome}
         const result = {};
         const noHost = createServer().listen(0);
         await once(noHost, "listening");
         const { address, family, port } = noHost.address();
         result.noHost = { address, family };
         // The fallback's own failure names the address that failed.
         const busy = await listenOutcome(port);
         result.noHostPortBusy = { ...busy, message: busy.message?.replace(String(port), "PORT") };
         noHost.close();
         result.explicitIPv6 = await listenOutcome(0, "::");
         try {
           Bun.listen({ hostname: "::", port: 0, socket: { data() {} } }).stop();
           result.bunListen = "listening";
         } catch (e) {
           result.bunListen = { code: e.code, syscall: e.syscall, errno: typeof e.errno };
         }
         console.log(JSON.stringify(result));`,
      );
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        noHost: { address: "0.0.0.0", family: "IPv4" },
        noHostPortBusy: {
          code: "EADDRINUSE",
          syscall: "listen",
          address: "0.0.0.0",
          message: "listen EADDRINUSE: address already in use 0.0.0.0:PORT",
        },
        explicitIPv6: {
          code: "EAFNOSUPPORT",
          syscall: "listen",
          address: "::",
          message: "listen EAFNOSUPPORT: address family not supported ::",
        },
        bunListen: { code: "EAFNOSUPPORT", syscall: "listen", errno: "number" },
      });
      expect(exitCode).toBe(0);
    },
  );

  it.skipIf("skip" in denySocket)("should report the errno when socket() fails for a unix path", async () => {
    using dir = tempDir("net-listen-unix-no-socket", {});
    const { stdout, stderr, exitCode } = await runWithSocketDenied(
      AF_UNIX,
      EMFILE,
      `${listenOutcome}
       const { code, syscall } = await listenOutcome(${JSON.stringify(join(String(dir), "listen.sock"))});
       console.log(JSON.stringify({ code, syscall }));`,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ code: "EMFILE", syscall: "listen" });
    expect(exitCode).toBe(0);
  });

  it("should call listening", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();

    server.on("error", failOnError(server, done)).on(
      "listening",
      mustCall(() => {
        server.close();
        done();
      }),
    );

    server.listen(0, "0.0.0.0");
  });

  it("should provide listening property", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    expect(server.listening).toBeFalse();

    server.on("error", failOnError(server, done)).on(
      "listening",
      mustCall(() => {
        expect(server.listening).toBeTrue();
        server.close();
        expect(server.listening).toBeFalse();
        done();
      }),
    );

    server.listen(0, "0.0.0.0");
  });

  it("should listen on localhost", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::1");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on localhost", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::1");
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen without port or host", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on unix domain socket", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      socket_domain,
      mustCall(() => {
        const address = server.address();
        expect(address).toStrictEqual(socket_domain);
        server.close();
        done();
      }),
    );
  });

  it("should bind IPv4 0.0.0.0 when listen on 0.0.0.0, issue#7355", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      "0.0.0.0",
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("0.0.0.0");
        expect(address.family).toStrictEqual("IPv4");

        let err: Error | null = null;
        try {
          await Bun.connect({
            hostname: "0.0.0.0",
            port: address.port,
            socket: {
              data(socket) {},
            },
          });
        } catch (e) {
          err = e as Error;
        }
        expect(err).toBeNull();

        try {
          await Bun.connect({
            hostname: "::",
            port: address.port,
            socket: {
              data(socket) {},
            },
          });
        } catch (e) {
          err = e as Error;
        }

        expect(err).not.toBeNull();
        expect(err!.message).toBe("Failed to connect");
        expect(err!.name).toBe("Error");
        expect((err as { code?: string }).code).toBe("ECONNREFUSED");

        server.close();
        done();
      }),
    );
  });

  it("emits 'listening' on the next tick, before the event loop polls", async () => {
    const server: Server = createServer();
    const order: string[] = [];
    server.on("listening", () => order.push("listening"));
    server.listen(0);
    process.nextTick(() => order.push("nextTick"));
    await once(server, "listening");
    server.close();
    await once(server, "close");
    expect(order).toEqual(["listening", "nextTick"]);
  });

  // The error twin of the test above: a listen() that fails reports on the same tick as one that succeeds.
  // No host argument: with one, Node resolves it through dns.lookup first, which adds a tick.
  it("emits a listen() error on the next tick, before the event loop polls", async () => {
    const occupant: Server = createServer();
    occupant.listen(0);
    await once(occupant, "listening");
    const { port } = occupant.address() as AddressInfo;

    const server: Server = createServer();
    const order: string[] = [];
    server.on("error", (err: NodeJS.ErrnoException) => order.push("error:" + err.code));
    server.listen(port);
    process.nextTick(() => order.push("nextTick"));
    await once(server, "error");
    occupant.close();
    await once(occupant, "close");
    expect(order).toEqual(["error:EADDRINUSE", "nextTick"]);
  });

  // How vite, get-port and friends probe for a free port: listen, then close()
  // from the 'listening' handler. A peer that connects in between must be reset
  // by the kernel when the listening fd closes, not accepted into the closing
  // server, whose close() would then wait on a connection nobody is reading.
  it("close() from 'listening' does not accept a peer that connected in between", async () => {
    const server: Server = createServer();
    let accepted = 0;
    server.on("connection", () => accepted++);
    const { promise: closed, resolve: onClosed, reject } = Promise.withResolvers<void>();
    server.on("error", reject);
    server.listen(0, "127.0.0.1");

    // Bun.connect() issues connect(2) synchronously, so the peer is already
    // sitting in the listen backlog when the 'listening' handler runs.
    const { port } = server.address() as AddressInfo;
    const peer = Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
        error() {},
        connectError() {},
      },
    }).catch(() => null);

    server.once("listening", () => {
      server.close(() => onClosed());
      peer.then(socket => socket?.end());
    });

    await closed;
    expect(accepted).toBe(0);
  });

  // Node's server.close() completes the handle's uv_close() on the next loop
  // turn, so a server listened and closed from a 'beforeExit' handler brings
  // the loop back to life once more and 'beforeExit' fires again
  // (upstream test-process-beforeexit). 'listening' itself is only a nextTick
  // now, so close() has to hold the loop for that turn on its own.
  it("closing a server listened from 'beforeExit' re-emits 'beforeExit'", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          process.once("beforeExit", () => {
            net
              .createServer()
              .listen(0)
              .on("listening", function () {
                this.close();
                process.once("beforeExit", () => console.log("beforeExit again"));
              });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "beforeExit again\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

describe("net.createServer events", () => {
  it("should receive data", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let client: any = null;
    let is_done = false;
    const onData = mustCall(data => {
      is_done = true;
      clearTimeout(timeout);
      server.close();
      expect(data.byteLength).toBe(5);
      expect(data.toString("utf8")).toBe("Hello");
      done();
    });

    const server: Server = createServer((socket: Socket) => {
      socket.on("data", onData);
    });

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      client?.end();
      mustNotCall("no data received")();
    };

    server.on("error", closeAndFail);

    //should be faster than 500ms (this was previously 100 but the test was flaky on local machine -@alii)
    timeout = setTimeout(closeAndFail, 500);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        client = await Bun.connect({
          hostname: address.address,
          port: address.port,
          socket: {
            data(socket) {},
            open(socket) {
              if (socket.write("Hello")) {
                socket.end();
              }
            },
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });

  it("should call end", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let is_done = false;
    const onEnd = mustCall(() => {
      is_done = true;
      clearTimeout(timeout);
      server.close();
      done();
    });

    const server: Server = createServer((socket: Socket) => {
      socket.on("end", onEnd);
      socket.end();
    });

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      mustNotCall("end not called")();
    };
    server.on("error", closeAndFail);

    timeout = setTimeout(closeAndFail, 500);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        await Bun.connect({
          hostname: address.address,
          port: address.port,
          socket: {
            data(socket) {},
            open(socket) {},
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });

  it("should call close", async () => {
    const { promise, reject, resolve } = Promise.withResolvers();
    const server: Server = createServer();
    server.listen().on("close", resolve).on("error", reject);
    server.close();
    await promise;
  });

  it("should call connection and drop", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    let timeout: Timer;
    let is_done = false;
    const server = createServer();
    let maxClients = 2;
    server.maxConnections = maxClients - 1;

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      mustNotCall("drop not called")();
    };

    timeout = setTimeout(closeAndFail, 500);
    let connection_called = false;
    server
      .on(
        "connection",
        mustCall(() => {
          connection_called = true;
        }),
      )
      .on(
        "drop",
        mustCall(data => {
          is_done = true;
          server.close();
          clearTimeout(timeout);
          expect(data.localPort).toBeDefined();
          expect(data.remotePort).toBeDefined();
          expect(data.remoteFamily).toBeDefined();
          expect(data.localFamily).toBeDefined();
          expect(data.localAddress).toBeDefined();
          expect(connection_called).toBe(true);
          done();
        }),
      )
      .listen(async () => {
        const address = server.address() as AddressInfo;

        async function spawnClient() {
          await Bun.connect({
            port: address?.port,
            hostname: address?.address,
            socket: {
              data(socket) {},
              open(socket) {
                socket.end();
              },
            },
          });
        }

        const promises: Promise<void>[] = [];
        for (let i = 0; i < maxClients; i++) {
          promises.push(spawnClient());
        }
        await Promise.all(promises).catch(closeAndFail);
      });
  });

  it("should error on an invalid port", () => {
    const server = createServer();

    expect(() => server.listen(123456)).toThrow(
      expect.objectContaining({
        code: "ERR_SOCKET_BAD_PORT",
      }),
    );
  });

  it("should call abort with signal", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const controller = new AbortController();
    let timeout: Timer;
    const server = createServer();

    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall("close not called")();
    };

    timeout = setTimeout(closeAndFail, 500);

    server
      .on(
        "close",
        mustCall(() => {
          clearTimeout(timeout);
          done();
        }),
      )
      .listen({ port: 0, signal: controller.signal }, () => {
        controller.abort();
      });
  });

  it("should stop listening to the signal once the server has closed", async () => {
    const controller = new AbortController();
    const server = createServer();
    let closeEvents = 0;
    server.on("close", () => closeEvents++);

    await new Promise<void>(resolve => server.listen({ port: 0, signal: controller.signal }, resolve));
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(closeEvents).toBe(1);

    // Aborting now must not call close() again, which would emit a second 'close'.
    controller.abort();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closeEvents).toBe(1);
  });

  it("should echo data", done => {
    const { mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let client: any = null;
    const server: Server = createServer((socket: Socket) => {
      socket.pipe(socket);
    });
    let is_done = false;
    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      client?.end();
      mustNotCall("no data received")();
    };

    server.on("error", closeAndFail);

    timeout = setTimeout(closeAndFail, 500);

    server.listen(async () => {
      const address = server.address() as AddressInfo;
      client = await Bun.connect({
        hostname: address.address,
        port: address.port,
        socket: {
          drain(socket) {
            socket.write("Hello");
          },
          data(socket, data) {
            is_done = true;
            clearTimeout(timeout);
            server.close();
            socket.end();
            expect(data.byteLength).toBe(5);
            expect(data.toString("utf8")).toBe("Hello");
            done();
          },
          open(socket) {
            socket.write("Hello");
          },
          connectError: closeAndFail, // connection failed
        },
      }).catch(closeAndFail);
    });
  });

  it("#8374", async () => {
    const server = createServer();
    const socketPath = join(tmpdir(), "test-unix-socket");

    server.listen({ path: socketPath });
    await once(server, "listening");

    try {
      const address = server.address() as string;
      expect(address).toBe(socketPath);

      const client = await Bun.connect({
        unix: socketPath,
        socket: {
          data() {},
        },
      });
      client.end();
    } finally {
      server.close();
    }
  });
});

// Node gives each accepted handle its own uv_stream_t ref; Bun's Listener used
// to hold ONE KeepAlive for the listening socket and all its connections, so an
// accepted socket's unref() was a no-op and server.unref() dropped live
// connections. Both directions are covered below via Bun.listen to bypass
// node:net's onconnection (whose resume() on main would paper over case 1).
describe("accepted socket event-loop hold matches Node (per-connection KeepAlive)", () => {
  async function run(body: string) {
    // Spawned so "process exits naturally" is the observable.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", body],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is drained but only surfaced on failure: debug builds may emit
    // benign warnings, so it is not asserted empty.
    return { stdout, exitCode, failureDetail: exitCode === 0 ? "" : stderr };
  }

  it("server.stop() + accepted socket.unref() lets the process exit", async () => {
    // do_stop used to gate the listener's KeepAlive release on
    // active_connections == 0, and the accepted socket's own KeepAlive was
    // never activated, so neither unref reached the loop counter and the
    // process hung even though nothing wanted it alive.
    expect(
      await run(`
        const accepted = Promise.withResolvers();
        const server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: { open(s) { accepted.resolve(s); }, data() {}, close() {} },
        });
        const client = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: { open() {}, data() {}, close() {} },
        });
        const srvSock = await accepted.promise;
        server.stop();
        client.unref();
        srvSock.unref();
        setTimeout(() => { process.stdout.write("HUNG"); process.exit(1); }, 4000).unref();
      `),
    ).toEqual({ stdout: "", exitCode: 0, failureDetail: "" });
  });

  it("server.unref() alone does not drop a ref'd accepted connection's hold", async () => {
    // Before the fix the Listener's single KeepAlive covered the listening
    // socket AND every accepted socket; server.unref() released the lot and
    // the process exited immediately, dropping the live ref'd connection
    // before the 300ms timer could observe it. Node keeps the loop alive for
    // the accepted handle on its own (as does this fix) so "alive" prints.
    expect(
      await run(`
        const accepted = Promise.withResolvers();
        const server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: { open(s) { accepted.resolve(s); }, data() {}, close() {} },
        });
        const client = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: { open() {}, data() {}, close() {} },
        });
        const srvSock = await accepted.promise;
        server.unref();
        client.unref();
        // srvSock is NOT unref'd: it must keep the process alive on its own.
        setTimeout(() => {
          process.stdout.write(srvSock ? "alive" : "dead");
          srvSock.end();
          client.end();
          server.stop();
        }, 300).unref();
        setTimeout(() => { process.stdout.write("|HUNG"); process.exit(1); }, 4000).unref();
      `),
    ).toEqual({ stdout: "alive", exitCode: 0, failureDetail: "" });
  });

  it("half-open accepted sockets after peer FIN do not busy-poll the event loop (Windows AFD DISCONNECT)", async () => {
    // A write-only connection handler whose peer sends data+FIN leaves the
    // accepted socket half-open with bytes buffered (Node's flowing=null
    // accept state). On Windows, poll_cb mapped UV_DISCONNECT to READABLE
    // unconditionally, recv() re-found the same EOF, the half-open EOF path
    // re-armed WRITABLE+DISCONNECT, and AFD kept reporting DISCONNECT - so
    // on_end fired once per loop turn per half-open socket. 40 such sockets
    // made a 2000-setImmediate spin take seconds instead of tens of ms.
    expect(
      await run(`
        const net = require("net");
        (async () => {
          for (let i = 0; i < 40; i++) {
            const srv = net.createServer(conn => { conn.write("x"); });
            await new Promise(r => srv.listen(0, "127.0.0.1", r));
            await new Promise(r => {
              const c = net.connect(srv.address().port, "127.0.0.1", () => {
                c.write("y".repeat(50));
                c.end();
                r();
              });
              c.on("data", () => {});
            });
            srv.close();
          }
          // Half-open sockets are now sitting with end delivered and 50 bytes
          // buffered; the loop must not be paying per-iteration cost for them.
          await new Promise(r => setTimeout(r, 50));
          const t0 = Date.now();
          let n = 0;
          await new Promise(r => {
            function tick() { if (++n >= 2000) return r(); setImmediate(tick); }
            tick();
          });
          const ms = Date.now() - t0;
          // Well under 200ms when quiescent (release ~5ms, debug ~50ms); the
          // busy-poll made 40 sockets x 2000 turns cost multiple seconds.
          process.stdout.write(ms < 800 ? "fast" : "busy-poll " + ms + "ms");
          process.exit(0);
        })();
      `),
    ).toEqual({ stdout: "fast", exitCode: 0, failureDetail: "" });
  });
});

// The Windows named-pipe listener never stripped libuv's own loop ref from its
// uv_pipe_t (uv_listen marks the handle active+ref'd), so server.unref()
// dropped the Listener's KeepAlive but the uv handle still pinned
// uv_loop_alive and the process never exited. TCP and unix-socket listeners go
// through usockets, which unrefs its uv handles up front.
it("server.unref() on a pipe/unix-socket listener lets the process exit", async () => {
  // The child exits without close() (natural exit is the observable), so the
  // unix socket file must live in a tempDir the parent disposes.
  using dir = tempDir("server-unref", {});
  const listenPath =
    process.platform === "win32"
      ? "\\\\.\\pipe\\bun-server-unref-" + process.pid + "-" + Math.random().toString(36).slice(2)
      : join(String(dir), "server-unref.sock");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const server = require("net").createServer();
      server.listen(process.env.SERVER_UNREF_LISTEN_PATH, () => server.unref());
      setTimeout(() => { process.stdout.write("HUNG"); process.exit(1); }, 4000).unref();
      `,
    ],
    env: { ...bunEnv, SERVER_UNREF_LISTEN_PATH: listenPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode === 0 ? "" : stderr).toBe("");
  expect(exitCode).toBe(0);
});
