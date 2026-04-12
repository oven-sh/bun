// https://github.com/oven-sh/bun/issues/29219
import { expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

test("ServerResponse emits 'close' when the client aborts mid-response", async () => {
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<{
    writableEnded: boolean;
  }>();

  const server = http.createServer((req, res) => {
    res.on("close", () => {
      resolveClosed({ writableEnded: res.writableEnded });
    });

    // Write some data so the response is mid-stream when the client aborts.
    res.write("hello\n");
  });

  try {
    await new Promise<void>(done => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as net.AddressInfo;
        const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
          client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        });
        client.on("data", () => {
          // Abrupt close once the server has written its first chunk.
          client.destroy();
        });
        client.on("error", () => {});
        done();
      });
    });

    const result = await closed;
    // Pre-fix, this promise never resolved. Post-fix, it resolves and
    // writableEnded is false because the client yanked the socket before
    // res.end() could run.
    expect(result).toEqual({ writableEnded: false });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// Also covers https://github.com/oven-sh/bun/issues/14697 — same root
// cause, but the handler never writes a response before the client
// disconnects. Pre-fix, only `req.on("close")` fired.
test("ServerResponse emits 'close' when the client aborts before any write", async () => {
  const { promise: resClose, resolve: resolveResClose } = Promise.withResolvers<{
    writableEnded: boolean;
  }>();
  const { promise: reqClose, resolve: resolveReqClose } = Promise.withResolvers<void>();
  const { promise: requestSeen, resolve: markRequestSeen } = Promise.withResolvers<void>();

  const server = http.createServer((req, res) => {
    res.once("close", () => resolveResClose({ writableEnded: res.writableEnded }));
    req.once("close", () => resolveReqClose());
    markRequestSeen();
    // Deliberately don't write or end — wait for the client to go away.
  });

  try {
    await new Promise<void>(done => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as net.AddressInfo;
        const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
          client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
          // Destroy the client only after the server has entered the handler.
          requestSeen.then(() => client.destroy());
        });
        client.on("error", () => {});
        done();
      });
    });

    // Pre-fix, `res.on("close")` never fired, so awaiting resClose would
    // hang and the test would timeout. Post-fix, both events fire and
    // writableEnded is false because the handler never called res.end().
    const [resResult] = await Promise.all([resClose, reqClose]);
    expect(resResult).toEqual({ writableEnded: false });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
