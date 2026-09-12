import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import { createServer } from "node:http";
import { Agent as HttpsAgent, createServer as createHttpsServer, get as httpsGet } from "node:https";
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

    // Yield a few event-loop turns after the bytes arrive so the server's
    // "all requests done" task chain has run before the callback is checked.
    releaseResponse();
    while (!body.includes("resp:/first")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);
    expect(closeEventFired).toBe(false);

    socket.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
    while (!body.includes("resp:/second")) await once(socket, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);
    expect(closeEventFired).toBe(false);
    expect(paths).toEqual(["/first", "/second"]);

    socket.destroy();
    await closed.promise;
    expect(closeCbFired).toBe(true);
    expect(closeEventFired).toBe(true);
  } finally {
    socket.destroy();
    server.closeAllConnections();
  }
});

// https.createServer goes through the same Server class, so the same gate must
// hold for a TLS keep-alive connection driven by a real client agent (the shape
// a browser produces: one connection, a slow response, then another request).
test("https server.close(cb) does not fire while a keep-alive TLS connection is still open", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  const paths: string[] = [];
  const clientPorts: (number | undefined)[] = [];
  const server = createHttpsServer({ key: tlsCert.key, cert: tlsCert.cert }, (req, res) => {
    paths.push(req.url as string);
    clientPorts.push(req.socket.remotePort);
    if (paths.length === 1) {
      inHandler.resolve();
      releaseResponse = () => res.end("first");
    } else {
      res.end("second");
    }
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const agent = new HttpsAgent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false });
  const get = (path: string) =>
    new Promise<number>((resolve, reject) => {
      const req = httpsGet({ port, host: "127.0.0.1", path, agent, rejectUnauthorized: false }, res => {
        res.resume();
        res.on("end", () => resolve(res.statusCode as number));
      });
      req.on("error", reject);
    });

  try {
    const first = get("/first");
    await inHandler.promise;

    let closeCbFired = false;
    const closed = Promise.withResolvers<void>();
    server.close(() => {
      closeCbFired = true;
      closed.resolve();
    });

    releaseResponse();
    expect(await first).toBe(200);
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);

    expect(await get("/second")).toBe(200);
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(paths).toEqual(["/first", "/second"]);
    expect(clientPorts[1]).toBe(clientPorts[0]);
    expect(closeCbFired).toBe(false);

    agent.destroy();
    await closed.promise;
    expect(closeCbFired).toBe(true);
  } finally {
    agent.destroy();
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

// Node frees the parser when it hands a socket to 'upgrade'/'connect', which
// takes it off the list closeIdleConnections()/closeAllConnections() walk. After
// close() those two must reap a plain keep-alive socket but leave an upgraded
// one alone, while 'close' itself still waits for the upgraded socket to end.
test("closeIdleConnections()/closeAllConnections() after close() leave an upgraded socket open", async () => {
  const inHandler = Promise.withResolvers<void>();
  let releaseResponse!: () => void;
  let upgradedServerSocket!: import("node:net").Socket;
  const server = createServer((req, res) => {
    inHandler.resolve();
    releaseResponse = () => res.end("ok");
  });
  server.on("upgrade", (req, socket) => {
    upgradedServerSocket = socket;
    socket.on("error", () => {});
    socket.on("data", chunk => socket.write(chunk));
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
  });
  server.keepAliveTimeout = 60000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const upgraded = connect(port, "127.0.0.1");
  const plain = connect(port, "127.0.0.1");
  try {
    await Promise.all([once(upgraded, "connect"), once(plain, "connect")]);
    upgraded.on("error", () => {});
    plain.on("error", () => {});
    let upgradedData = "";
    upgraded.on("data", chunk => (upgradedData += chunk));
    const upgradedClosed = Promise.withResolvers<void>();
    upgraded.on("close", () => upgradedClosed.resolve());
    let plainData = "";
    plain.on("data", chunk => (plainData += chunk));
    const plainClosed = Promise.withResolvers<void>();
    plain.on("close", () => plainClosed.resolve());
    // Round-trips a token through the upgraded connection; false if it closed instead.
    const echo = async (token: string) => {
      upgraded.write(token);
      while (!upgradedData.includes(token) && !upgraded.destroyed) {
        await Promise.race([once(upgraded, "data"), upgradedClosed.promise]);
      }
      return upgradedData.includes(token);
    };

    upgraded.write("GET /up HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
    while (!upgradedData.includes("101 Switching Protocols")) await once(upgraded, "data");
    plain.write("GET /slow HTTP/1.1\r\nHost: x\r\n\r\n");
    await inHandler.promise;

    let closeCbFired = false;
    const closed = Promise.withResolvers<void>();
    server.close(() => {
      closeCbFired = true;
      closed.resolve();
    });
    releaseResponse();
    while (!plainData.includes("ok")) await once(plain, "data");
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeCbFired).toBe(false);

    server.closeIdleConnections();
    expect(upgradedServerSocket.destroyed).toBe(false);
    await plainClosed.promise;
    expect(await echo("ping1")).toBe(true);
    expect(closeCbFired).toBe(false);

    server.closeAllConnections();
    expect(upgradedServerSocket.destroyed).toBe(false);
    expect(await echo("ping2")).toBe(true);
    expect(closeCbFired).toBe(false);

    upgradedServerSocket.destroy();
    await closed.promise;
    expect(closeCbFired).toBe(true);
  } finally {
    upgraded.destroy();
    plain.destroy();
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

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    let closeEmitted = 0;
    server.on("close", () => closeEmitted++);

    socket.destroy();
    for (let i = 0; i < 4; i++) await new Promise<void>(r => setImmediate(r));
    expect(closeEmitted).toBe(0);
    expect(cb1Fired).toBe(false);
    expect(server.listening).toBe(true);

    // Like Node, the first cycle's callback is a once('close') listener: it
    // fires here too, and passing a second callback does not throw.
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
