// https://github.com/oven-sh/bun/issues/29219
import { expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

test("ServerResponse emits 'close' when the client aborts mid-response", async () => {
  const { promise, resolve } = Promise.withResolvers<{
    resClosed: boolean;
    reqErrored: boolean;
  }>();

  let resClosed = false;
  let reqErrored = false;

  const server = http.createServer((req, res) => {
    res.on("close", () => {
      resClosed = true;
    });

    // Write some data so the response is mid-stream when the client aborts.
    res.write("hello\n");

    req.on("error", () => {
      reqErrored = true;
      server.close(() => {
        resolve({ resClosed, reqErrored });
      });
    });
  });

  await new Promise<void>(done => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        client.on("data", () => {
          client.end(); // force abort mid-response
        });
      });
      done();
    });
  });

  const result = await promise;
  expect(result).toEqual({ resClosed: true, reqErrored: true });
});

// Also covers https://github.com/oven-sh/bun/issues/14697 — same root
// cause, but the handler never writes a response before the client
// disconnects. Pre-fix, only `req.on("close")` fired.
test("ServerResponse emits 'close' when the client aborts before any write", async () => {
  const { promise, resolve } = Promise.withResolvers<{
    resClosed: boolean;
    reqClosed: boolean;
  }>();

  let resClosed = false;
  let reqClosed = false;

  const server = http.createServer((req, res) => {
    res.once("close", () => {
      resClosed = true;
      if (reqClosed) server.close(() => resolve({ resClosed, reqClosed }));
    });
    req.once("close", () => {
      reqClosed = true;
      if (resClosed) server.close(() => resolve({ resClosed, reqClosed }));
    });
    // Deliberately don't write or end — wait for the client to go away.
  });

  await new Promise<void>(done => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        // Wait a tick so the server receives the request, then yank the socket.
        setTimeout(() => client.destroy(), 100);
      });
      done();
    });
  });

  const result = await promise;
  expect(result).toEqual({ resClosed: true, reqClosed: true });
});
