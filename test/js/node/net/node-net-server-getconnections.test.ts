import { describe, expect, it } from "bun:test";
import { AddressInfo, connect, createServer, Server, Socket } from "net";
import { once } from "node:events";

describe("net.Server getConnections", () => {
  const getConnections = (server: Server) =>
    new Promise<number>((resolve, reject) =>
      server.getConnections((err, count) => (err ? reject(err) : resolve(count))),
    );

  it("reports the live connection count after close() until all sockets drain", async () => {
    const accepted: Socket[] = [];
    const server = createServer(sock => {
      sock.on("error", () => {});
      accepted.push(sock);
    });
    const clients: Socket[] = [];
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;

      for (let i = 0; i < 3; i++) {
        const c = connect({ port, host: "127.0.0.1" });
        c.on("error", () => {});
        clients.push(c);
        await once(c, "connect");
      }
      while (accepted.length < 3) await once(server, "connection");

      // Node defers the callback via process.nextTick; it must not fire
      // before getConnections() returns.
      let before: number | "unset" = "unset";
      const ret = server.getConnections((_err, n) => (before = n));
      expect(before).toBe("unset");
      expect(ret).toBe(server);

      expect(await getConnections(server)).toBe(3);

      let serverClosed = false;
      server.once("close", () => (serverClosed = true));
      server.close();

      // Listener is closed but all 3 connections are still open.
      expect(await getConnections(server)).toBe(3);
      expect(serverClosed).toBe(false);

      const firstClosed = once(accepted[0], "close");
      clients[0].destroy();
      await firstClosed;
      expect(await getConnections(server)).toBe(2);

      clients[1].destroy();
      clients[2].destroy();
      await once(server, "close");
      expect(await getConnections(server)).toBe(0);
      expect(serverClosed).toBe(true);
    } finally {
      for (const c of clients) c.destroy();
      for (const s of accepted) s.destroy();
      server.close();
    }
  });
});
