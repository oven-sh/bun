import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

// Node's net.Server#close callback (and the 'close' event) only fires once
// every accepted connection has ended. A connection that was mid-request
// when close() ran stays open after the response is delivered, so the
// callback must be withheld until that connection closes.
test("server.close(cb) does not fire while a keep-alive connection is still open", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url as string);
    if (paths.length === 1) {
      inHandler.resolve();
      releaseResponse = () => res.end("resp:" + req.url);
    } else {
      res.end("resp:" + req.url);
    }
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});

    // First request: handler is entered but response held until after close().
    socket.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\n");
    await inHandler.promise;

    let closeEventFired = false;
    server.once("close", () => (closeEventFired = true));
    const closed = Promise.withResolvers<void>();
    let closeCbFired = false;
    server.close(() => {
      closeCbFired = true;
      closed.resolve();
    });

    // Handler finishes: response is delivered, connection stays open.
    // Yield a few event-loop turns after the bytes arrive so the server's
    // "all requests done" task chain has run before the callback is checked.
    releaseResponse();
    while (!body.includes("resp:/first")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);
    expect(closeEventFired).toBe(false);

    // A second request on the same connection is still served (matching Node),
    // and the close callback must still be withheld afterwards.
    socket.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
    while (!body.includes("resp:/second")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);
    expect(closeEventFired).toBe(false);
    expect(paths).toEqual(["/first", "/second"]);

    // Closing the connection drains the server and releases the callback.
    socket.destroy();
    await closed.promise;
    expect(closeCbFired).toBe(true);
    expect(closeEventFired).toBe(true);
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// Sanity: an idle keep-alive connection at close() time is reaped by
// closeIdleConnections(), so the callback fires promptly like before.
test("server.close(cb) fires once an idle keep-alive connection is reaped", async () => {
  const server = createServer((req, res) => res.end("ok"));
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    while (!body.includes("ok")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));

    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// The graceful-drain-with-deadline pattern: close(), then force via
// closeAllConnections() once the caller has waited long enough. The force
// step must work even though close() already dropped the native handle.
test("closeAllConnections() after close() force-drains the withheld callback", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  const server = createServer((req, res) => {
    inHandler.resolve();
    releaseResponse = () => res.end("ok");
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await inHandler.promise;

    const closed = Promise.withResolvers<void>();
    let closeCbFired = false;
    server.close(() => {
      closeCbFired = true;
      closed.resolve();
    });
    releaseResponse();
    while (!body.includes("ok")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);

    server.closeAllConnections();
    await closed.promise;
    expect(closeCbFired).toBe(true);
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// Re-listening after close() while a keep-alive connection from the previous
// cycle is still open must not fire 'close' on the new (listening) server
// when that old connection finally ends.
test("no 'close' is emitted on a re-listened server when an earlier connection ends", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  let requests = 0;
  const server = createServer((req, res) => {
    if (++requests === 1) {
      inHandler.resolve();
      releaseResponse = () => res.end("ok");
    } else {
      res.end("ok");
    }
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port1 = (server.address() as AddressInfo).port;

  const socket = connect(port1, "127.0.0.1");
  try {
    await once(socket, "connect");
    let body = "";
    socket.on("data", chunk => (body += chunk));
    socket.on("error", () => {});
    socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await inHandler.promise;

    let cb1Fired = false;
    server.close(() => (cb1Fired = true));
    releaseResponse();
    while (!body.includes("ok")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));

    // Re-listen while the old connection is still open.
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    let closeEmitted = 0;
    server.on("close", () => closeEmitted++);

    // Old connection ends. No 'close' must fire on the listening server.
    socket.destroy();
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeEmitted).toBe(0);
    expect(cb1Fired).toBe(false);
    expect(server.listening).toBe(true);

    // Closing the new server then emits 'close' exactly once. The first
    // cycle's callback was registered via once('close') and fires now too,
    // like Node (and passing a second callback does not throw).
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
    expect(closeEmitted).toBe(1);
    expect(cb1Fired).toBe(true);
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});
