import { test, expect, describe } from "bun:test";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

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
});
