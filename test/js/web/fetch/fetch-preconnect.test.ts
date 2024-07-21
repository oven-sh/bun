import { describe, it, expect } from "bun:test";
import "harness";
it("fetch.preconnect works", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const listener = Bun.listen({
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
  listener.stop(true);
});

it("--fetch-preconnect works", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const listener = Bun.listen({
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
  listener.stop(true);
});

it("fetch.preconnect validates the URL", async () => {
  expect(() => fetch.preconnect("http://localhost:0")).toThrow();
  expect(() => fetch.preconnect("")).toThrow();
  expect(() => fetch.preconnect(" ")).toThrow();
  expect(() => fetch.preconnect("unix:///tmp/foo")).toThrow();
  expect(() => fetch.preconnect("http://:0")).toThrow();
});
