import { describe, expect, it } from "bun:test";
import "harness";
import { isWindows } from "harness";

// TODO: on Windows, these tests fail.
// This feature is mostly meant for serverless JS environments, so we can no-op it on Windows.
describe.todoIf(isWindows)("fetch.preconnect", () => {
  it("fetch.preconnect works", async () => {
    const { promise, resolve } = Promise.withResolvers();
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

  describe("doesn't break the request when", () => {
    for (let endOrTerminate of ["end", "terminate", "shutdown"]) {
      describe(endOrTerminate, () => {
        for (let at of ["before", "middle", "after"]) {
          it(at, async () => {
            let { promise, resolve } = Promise.withResolvers();
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
            ({ promise, resolve } = Promise.withResolvers());
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
    const { promise, resolve } = Promise.withResolvers();
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
    expect([`--fetch-preconnect=http://localhost:${listener.port}`, "--eval", "Bun.sleep(64)"]).toRun();

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
