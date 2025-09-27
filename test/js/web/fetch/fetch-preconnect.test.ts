import { describe, expect, it } from "bun:test";
import "harness";
import { bunEnv, bunExe, isWindows } from "harness";

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

  it("fetch.preconnect validates the URL", async () => {
    expect(() => fetch.preconnect("http://localhost:0")).toThrow();
    expect(() => fetch.preconnect("")).toThrow();
    expect(() => fetch.preconnect(" ")).toThrow();
    expect(() => fetch.preconnect("unix:///tmp/foo")).toThrow();
    expect(() => fetch.preconnect("http://:0")).toThrow();
  });
});
