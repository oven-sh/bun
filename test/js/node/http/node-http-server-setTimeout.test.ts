import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

// https://nodejs.org/api/http.html#serversettimeoutmsecs-callback
// Once a 'timeout' listener is installed on the server (or on req/res), the
// runtime must NOT destroy the socket on timeout; the listener decides.

async function connectAndWrite(port: number, wire: string) {
  const s = net.connect(port, "127.0.0.1");
  s.setNoDelay(true);
  s.on("error", () => {});
  s.resume();
  await once(s, "connect");
  s.write(wire);
  return s;
}

async function listen(handler: http.RequestListener) {
  const srv = http.createServer(handler);
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  return srv;
}

function cleanup(srv: http.Server, client: net.Socket) {
  try {
    client.destroy();
  } catch {}
  try {
    srv.close();
    srv.closeAllConnections?.();
  } catch {}
}

describe("http.Server.prototype.setTimeout", () => {
  test("sets server.timeout and returns this", () => {
    const srv = http.createServer();
    expect(srv.timeout).toBe(0);
    const ret = srv.setTimeout(1234);
    expect(ret).toBe(srv);
    expect(srv.timeout).toBe(1234);
  });

  test("callback is registered as a 'timeout' listener", () => {
    const srv = http.createServer();
    const cb = () => {};
    srv.setTimeout(1234, cb);
    expect(srv.listeners("timeout")).toContain(cb);
  });

  test.concurrent("a server 'timeout' listener vetoes the default destroy (stalled body)", async () => {
    const srv = await listen((req, _res) => void req.resume());
    srv.setTimeout(200);

    const { promise, resolve } = Promise.withResolvers<{ event: string; socket?: any }>();
    srv.on("timeout", socket => resolve({ event: "timeout", socket }));

    const client = await connectAndWrite(
      (srv.address() as net.AddressInfo).port,
      "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 900\r\n\r\nab",
    );
    client.on("close", () => resolve({ event: "close" }));

    try {
      const { event, socket } = await promise;
      // The 'timeout' event must fire before the connection is torn down.
      expect(event).toBe("timeout");
      expect(socket.destroyed).toBe(false);
      // And the connection must still be open afterwards: the listener did
      // not destroy, so the runtime must not either. Race a fresh 'timeout'
      // (listener returning without destroying leaves the socket alive; the
      // timer is one-shot until refreshed, but the old native path closed
      // within a few ms of the event) against 'close'.
      const winner = await Promise.race([
        once(client, "close").then(() => "close"),
        Bun.sleep(250).then(() => "alive"),
      ]);
      expect(winner).toBe("alive");
      expect(socket.destroyed).toBe(false);
    } finally {
      cleanup(srv, client);
    }
  });

  test.concurrent("a server 'timeout' listener vetoes the default destroy (idle keep-alive)", async () => {
    const srv = await listen((req, res) => {
      req.resume();
      req.on("end", () => res.end("ok"));
    });
    srv.setTimeout(200);

    const { promise, resolve } = Promise.withResolvers<{ event: string; socket?: any }>();
    srv.on("timeout", socket => resolve({ event: "timeout", socket }));

    const client = await connectAndWrite((srv.address() as net.AddressInfo).port, "GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    client.on("close", () => resolve({ event: "close" }));

    try {
      const { event, socket } = await promise;
      // An idle keep-alive connection reaped by the server timeout must
      // emit 'timeout' (not close silently).
      expect(event).toBe("timeout");
      expect(socket.destroyed).toBe(false);
      const winner = await Promise.race([
        once(client, "close").then(() => "close"),
        Bun.sleep(250).then(() => "alive"),
      ]);
      expect(winner).toBe("alive");
      expect(socket.destroyed).toBe(false);
    } finally {
      cleanup(srv, client);
    }
  });

  test.concurrent("with no listener, the socket is destroyed on timeout", async () => {
    const srv = await listen((req, _res) => void req.resume());
    srv.setTimeout(200);

    const client = await connectAndWrite(
      (srv.address() as net.AddressInfo).port,
      "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 900\r\n\r\nab",
    );
    try {
      await once(client, "close");
    } finally {
      cleanup(srv, client);
    }
  });

  test.concurrent("a request 'timeout' listener also vetoes the default destroy", async () => {
    const { promise, resolve } = Promise.withResolvers<{ event: string; socket?: any }>();
    const srv = await listen((req, _res) => {
      req.resume();
      req.on("timeout", () => resolve({ event: "timeout", socket: req.socket }));
    });
    srv.setTimeout(200);

    const client = await connectAndWrite(
      (srv.address() as net.AddressInfo).port,
      "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 900\r\n\r\nab",
    );
    client.on("close", () => resolve({ event: "close" }));

    try {
      const { event, socket } = await promise;
      expect(event).toBe("timeout");
      expect(socket.destroyed).toBe(false);
      const winner = await Promise.race([
        once(client, "close").then(() => "close"),
        Bun.sleep(250).then(() => "alive"),
      ]);
      expect(winner).toBe("alive");
    } finally {
      cleanup(srv, client);
    }
  });

  test.concurrent("an actively-writing response is not destroyed by server.setTimeout()", async () => {
    // Response body writes refresh the socket's inactivity timer, like
    // Node.js's net.Socket._writeGeneric -> _unrefTimer().
    const { promise, resolve } = Promise.withResolvers<string>();
    const srv = await listen((req, res) => {
      req.resume();
      res.writeHead(200, { "Transfer-Encoding": "chunked" });
      let n = 0;
      const i = setInterval(() => {
        if (!res.write(".")) res.once("drain", () => {});
        if (++n === 8) {
          clearInterval(i);
          res.end();
        }
      }, 100);
      req.socket.on("close", () => clearInterval(i));
    });
    // Shorter than the interval between writes: if writes did not refresh the
    // timer, the default-destroy would fire between the first two chunks.
    srv.setTimeout(250);
    srv.on("timeout", () => resolve("timeout"));

    const client = await connectAndWrite((srv.address() as net.AddressInfo).port, "GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    let body = "";
    client.on("data", d => {
      body += d.toString("latin1");
      if (body.includes("\r\n0\r\n\r\n")) resolve("finished");
    });
    client.on("close", () => resolve("close"));

    try {
      expect(await promise).toBe("finished");
      // Eight body bytes, one per chunk (after the header block).
      const chunks = body.slice(body.indexOf("\r\n\r\n") + 4);
      expect(chunks.match(/\./g)?.length).toBe(8);
    } finally {
      cleanup(srv, client);
    }
  });

  test.concurrent("req.setTimeout(0) clears the server-armed socket timer", async () => {
    // All four entry points (server/socket/req/res.setTimeout) share one timer.
    const { promise, resolve } = Promise.withResolvers<string>();
    const srv = await listen((req, _res) => {
      req.resume();
      req.setTimeout(0);
    });
    srv.setTimeout(200);
    srv.on("timeout", () => resolve("timeout"));

    const client = await connectAndWrite(
      (srv.address() as net.AddressInfo).port,
      "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 900\r\n\r\nab",
    );
    client.on("close", () => resolve("close"));

    try {
      const winner = await Promise.race([promise, Bun.sleep(600).then(() => "alive")]);
      expect(winner).toBe("alive");
    } finally {
      cleanup(srv, client);
    }
  });
});
