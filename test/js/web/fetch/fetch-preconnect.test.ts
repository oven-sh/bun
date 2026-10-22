import { describe, expect, it } from "bun:test";
import "harness";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";

// TODO: on Windows, these tests fail.
// This feature is mostly meant for serverless JS environments, so we can no-op it on Windows.
describe.concurrent.todoIf(isWindows)("fetch.preconnect", () => {
  it("fetch.preconnect works", async () => {
    const { promise, resolve } = Promise.withResolvers<Bun.Socket>();
    using listener = Bun.listen({
      port: 0,
      hostname: "localhost",
      socket: {
        open(socket) {
          resolve(socket);
        },
        data() {},
        close() {},
      },
    });
    fetch.preconnect(`http://localhost:${listener.port}`);
    const socket = await promise;
    const fetchPromise = fetch(`http://localhost:${listener.port}`);
    await Bun.sleep(64);
    socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    socket.end();

    const response = await fetchPromise;
    expect(response.status).toBe(200);
  });

  describe.concurrent("doesn't break the request when", () => {
    for (let endOrTerminate of ["end", "terminate", "shutdown"]) {
      describe(endOrTerminate, () => {
        for (let at of ["before", "middle", "after"]) {
          it(at, async () => {
            let { promise, resolve } = Promise.withResolvers<Bun.Socket>();
            using listener = Bun.listen({
              port: 0,
              hostname: "localhost",
              socket: {
                open(socket) {
                  resolve(socket);
                },
                data() {},
                close() {},
              },
            });
            fetch.preconnect(`http://localhost:${listener.port}`);
            let socket = await promise;
            ({ promise, resolve } = Promise.withResolvers<Bun.Socket>());
            if (at === "before") {
              await Bun.sleep(16);
              socket[endOrTerminate]();
              if (endOrTerminate === "shutdown") {
                await Bun.sleep(0);
                socket.end();
              }
            }
            const fetchPromise = fetch(`http://localhost:${listener.port}`);
            if (at === "middle") {
              socket[endOrTerminate]();
              if (endOrTerminate === "shutdown") {
                socket.end();
              }
              await Bun.sleep(16);
            }

            if (at === "after") {
              await Bun.sleep(16);
              socket[endOrTerminate]();
              if (endOrTerminate === "shutdown") {
                socket.end();
              }
            }
            socket = await promise;
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            socket.end();

            const response = await fetchPromise;
            expect(response.status).toBe(200);
          });
        }
      });
    }
  });

  it("--fetch-preconnect works", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    using listener = Bun.listen({
      port: 0,
      hostname: "localhost",
      socket: {
        open(socket) {
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
          socket.end();
          resolve();
        },
        data() {},
        close() {},
      },
    });

    // Do --fetch-preconnect, but don't actually send a request.
    await using proc = Bun.spawn({
      cmd: [bunExe(), `--fetch-preconnect=http://localhost:${listener.port}`, "--eval", "Bun.sleep(64)"],
      stdio: ["inherit", "inherit", "inherit"],
      env: bunEnv,
    });

    expect(await proc.exited).toBe(0);

    await promise;
  });

  // A preconnect that finds a pooled keep-alive socket for its origin used to
  // complete (and free the HTTP-thread request clone) synchronously inside the
  // connect call, whose caller then kept using the freed memory. Only the
  // second and later preconnects to the same origin hit that path, and only
  // ASAN can observe the use-after-free, so this runs in a child process.
  it.skipIf(!isASAN)("repeated fetch.preconnect to the same origin doesn't use freed memory", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const sockets = [];
        const listener = Bun.listen({
          port: 0,
          hostname: "127.0.0.1",
          socket: {
            open(socket) {
              sockets.push(socket);
            },
            data() {},
            close() {},
          },
        });
        const url = \`http://127.0.0.1:\${listener.port}\`;
        // The first preconnect parks a socket in the keep-alive pool; wait for
        // the server to observe its connection before continuing (the park on
        // the client side follows it by microseconds and has no JS signal).
        fetch.preconnect(url);
        const deadline = Date.now() + 5000;
        while (sockets.length === 0 && Date.now() < deadline) await Bun.sleep(5);
        // Later iterations reuse the parked socket; short sleeps keep each
        // preconnect's HTTP-thread turn ahead of the next call.
        for (let i = 0; i < 20; i++) {
          fetch.preconnect(url);
          await Bun.sleep(25);
        }
        listener.stop(true);
        console.log("connections:", sockets.length);
        console.log("OK");`,
      ],
      env: {
        ...bunEnv,
        // symbolize=0 so a sanitizer report aborts the child immediately
        // instead of stalling for minutes in llvm-symbolizer; leak checking
        // is irrelevant here and needs symbolized suppressions, so keep it off.
        ASAN_OPTIONS: "symbolize=0:detect_leaks=0:halt_on_error=1:allow_user_segv_handler=1:disable_coredump=0",
      },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("AddressSanitizer");
    expect(stdout).toContain("OK");
    // Prove the pooled-reuse precondition was exercised: most iterations must
    // have reused the parked socket instead of opening a fresh connection,
    // otherwise this test passes without ever reaching the path it guards.
    const connections = Number(/connections: (\d+)/.exec(stdout)?.[1]);
    expect(connections).toBeGreaterThanOrEqual(1);
    expect(connections).toBeLessThan(10);
    expect(exitCode).toBe(0);
  });

  // Companion to the test above that runs on every build: each preconnect
  // holds one of BUN_CONFIG_MAX_HTTP_REQUESTS slots until its completion is
  // dispatched, so if the pooled-reuse path ever drops that dispatch, the
  // preconnect loop pins all 4 slots and the final fetch can never start.
  it("pooled preconnects release their request slots", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const sockets = [];
        const listener = Bun.listen({
          port: 0,
          hostname: "127.0.0.1",
          socket: {
            open(socket) {
              sockets.push(socket);
            },
            data(socket) {
              socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nok");
            },
            close() {},
          },
        });
        const url = \`http://127.0.0.1:\${listener.port}\`;
        fetch.preconnect(url);
        const deadline = Date.now() + 5000;
        while (sockets.length === 0 && Date.now() < deadline) await Bun.sleep(5);
        for (let i = 0; i < 20; i++) {
          fetch.preconnect(url);
          await Bun.sleep(25);
        }
        const preconnectConnections = sockets.length;
        const response = await fetch(url);
        console.log("connections:", preconnectConnections);
        console.log("status:", response.status);
        listener.stop(true);`,
      ],
      env: { ...bunEnv, BUN_CONFIG_MAX_HTTP_REQUESTS: "4" },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("AddressSanitizer");
    expect(stdout).toContain("status: 200");
    // Same precondition proof as the test above: the loop must have reused
    // the parked socket, or the deferred-dispatch path was never exercised.
    const connections = Number(/connections: (\d+)/.exec(stdout)?.[1]);
    expect(connections).toBeGreaterThanOrEqual(1);
    expect(connections).toBeLessThan(10);
    expect(exitCode).toBe(0);
  });

  it("fetch.preconnect validates the URL", async () => {
    expect(() => fetch.preconnect("http://localhost:0")).toThrow();
    expect(() => fetch.preconnect("")).toThrow();
    expect(() => fetch.preconnect(" ")).toThrow();
    expect(() => fetch.preconnect("unix:///tmp/foo")).toThrow();
    expect(() => fetch.preconnect("http://:0")).toThrow();
  });
});
