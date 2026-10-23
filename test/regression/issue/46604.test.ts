import { describe, expect, it } from "bun:test";
import { isIPv6 as hasIPv6, isWindows } from "harness";
import dgram from "node:dgram";
import { once } from "node:events";
import { connect, createServer, Socket } from "node:net";

// A socket's port is free as soon as destroy() returns, also from inside the
// 'connect' handler or a continuation of it. On Windows 1.4.4 the fd close
// waited for the end of the poll callback, so a listen on that port in the same
// tick got EADDRINUSE until the socket's 'close' event. The deferral lived in
// the libuv backend of usockets, which only Windows uses.
describe.skipIf(!isWindows).concurrent.each(hasIPv6() ? ["127.0.0.1", "::1"] : ["127.0.0.1"])(
  "a destroyed socket's port is free at once (%s)",
  host => {
    function listenOn(port: number): Promise<string> {
      const { promise, resolve } = Promise.withResolvers<string>();
      const probe = createServer();
      probe.once("error", (error: any) => resolve(error.code));
      probe.listen(port, host, () => probe.close(() => resolve("bound")));
      return promise;
    }

    async function withClient(run: (client: Socket) => Promise<string>): Promise<string> {
      await using server = createServer(socket => socket.on("error", () => {}));
      await once(server.listen(0, host), "listening");
      const client = connect({ host, port: (server.address() as any).port, localAddress: host, localPort: 0 });
      const failed = new Promise<never>((_, reject) => client.once("error", reject));
      try {
        return await Promise.race([run(client), failed]);
      } finally {
        client.destroy();
      }
    }

    it.each(["destroy", "resetAndDestroy"] as const)("%s() inside 'connect', then listen", async release => {
      const result = await withClient(client => {
        const { promise, resolve } = Promise.withResolvers<string>();
        client.once("connect", () => {
          const port = client.localPort!;
          client[release]();
          resolve(listenOn(port));
        });
        return promise;
      });
      expect(result).toBe("bound");
    });

    it.each(["destroy", "resetAndDestroy"] as const)("%s() after an await in 'connect', then listen", async release => {
      const result = await withClient(async client => {
        await once(client, "connect");
        const port = client.localPort!;
        client[release]();
        return listenOn(port);
      });
      expect(result).toBe("bound");
    });

    it("server.close() inside 'connection', then listen", async () => {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      await using server = createServer(socket => {
        socket.on("error", () => {});
        socket.destroy();
        const port = (server.address() as any).port;
        server.close();
        resolve(listenOn(port));
      });
      await once(server.listen(0, host), "listening");
      const client = connect({ host, port: (server.address() as any).port });
      client.once("error", reject);
      try {
        expect(await promise).toBe("bound");
      } finally {
        client.destroy();
      }
    });

    it("dgram close() inside 'message', then bind", async () => {
      const type = host.includes(":") ? "udp6" : "udp4";
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      await using socket = dgram.createSocket(type);
      socket.once("error", reject);
      socket.once("message", () => {
        const port = socket.address().port;
        socket.close();
        const probe = dgram.createSocket(type);
        probe.once("error", (error: any) => resolve(error.code));
        probe.bind(port, host, () => probe.close(() => resolve("bound")));
      });
      await once(socket.bind(0, host), "listening");
      await using sender = dgram.createSocket(type);
      sender.once("error", reject);
      sender.send("x", socket.address().port, host, error => error && reject(error));
      expect(await promise).toBe("bound");
    });
  },
);
