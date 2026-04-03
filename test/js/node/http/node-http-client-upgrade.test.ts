import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";

async function listen(server: net.Server | http.Server, arg?: any): Promise<AddressInfo | string> {
  const { promise, resolve, reject } = Promise.withResolvers<AddressInfo | string>();
  server.once("error", reject);
  if (arg !== undefined) {
    server.listen(arg, () => resolve(server.address() as AddressInfo | string));
  } else {
    server.listen(0, "127.0.0.1", () => resolve(server.address() as AddressInfo));
  }
  return promise;
}

describe("http.ClientRequest 'upgrade' event", () => {
  test("emits 'upgrade' with a usable Duplex socket", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
        conn.on("data", chunk => conn.write(chunk));
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.end();

      const [res, socket, head] = await once(req, "upgrade");
      expect(res.statusCode).toBe(101);
      expect(res.headers.upgrade).toBe("websocket");
      expect(res.headers.connection).toBe("Upgrade");
      expect(Buffer.isBuffer(head)).toBe(true);
      expect(head.length).toBe(0);

      const echoed = once(socket, "data");
      socket.write("hello upgrade");
      const [chunk] = await echoed;
      expect(chunk.toString()).toBe("hello upgrade");

      const ended = once(socket, "end");
      socket.end();
      server.close();
      await ended;
    } finally {
      server.close();
    }
  });

  test.skipIf(isWindows)("upgrade over unix socket", async () => {
    using dir = tempDir("http-upgrade-unix", {});
    const sockPath = path.join(String(dir), "upgrade.sock");

    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: tcp\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        conn.on("data", chunk => conn.write(chunk));
      });
    });
    await listen(server, sockPath);

    try {
      const req = http.request({
        socketPath: sockPath,
        headers: { Connection: "Upgrade", Upgrade: "tcp" },
      });
      req.end();

      const [res, socket] = await once(req, "upgrade");
      expect(res.statusCode).toBe(101);

      const echoed = once(socket, "data");
      socket.write("unix-hello");
      const [chunk] = await echoed;
      expect(chunk.toString()).toBe("unix-hello");

      socket.end();
    } finally {
      server.close();
    }
  });

  test("non-101 response to Upgrade request emits 'response'", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.end(
          "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\nnot upgrading",
        );
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "tcp" },
      });
      req.on("upgrade", () => {
        throw new Error("should not emit upgrade");
      });
      req.end();

      const [res] = await once(req, "response");
      expect(res.statusCode).toBe(200);
      let body = "";
      for await (const chunk of res) body += chunk.toString();
      expect(body).toBe("not upgrading");
    } finally {
      server.close();
    }
  });

  test("non-upgrade requests can reuse keep-alive connections", async () => {
    let connections = 0;
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    server.on("connection", () => {
      connections++;
    });
    const addr = (await listen(server)) as AddressInfo;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      for (let i = 0; i < 2; i++) {
        const req = http.request({ host: "127.0.0.1", port: addr.port, agent });
        req.end();
        const [res] = await once(req, "response");
        let body = "";
        for await (const chunk of res) body += chunk.toString();
        expect(body).toBe("ok");
      }
      expect(connections).toBe(1);
    } finally {
      agent.destroy();
      server.close();
    }
  });
});
