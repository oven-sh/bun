// A DNS server that answers over TCP with part of a frame and then closes the
// connection. c-ares 1.34.7+ defers the close of a connection whose read failed
// while data is buffered, and the deferred close was unreachable: the dead
// connection stayed the server's TCP connection until the query timed out
// (ETIMEOUT), its socket stayed readable (EOF), and the event loop spun on it.
import { expect, test } from "bun:test";
import dgram from "node:dgram";
import { Resolver } from "node:dns/promises";
import { once } from "node:events";
import net from "node:net";

// c-ares retries a truncated UDP answer over TCP on the same port, so both
// listeners need the same port number. The kernel only picked a port that is
// free for UDP. If TCP has it taken, drop both and pick another.
async function listenCutShort() {
  for (let attempt = 0; ; attempt++) {
    const udp = dgram.createSocket("udp4");
    udp.bind(0, "127.0.0.1");
    await once(udp, "listening");
    const { port } = udp.address();

    const tcp = net.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        tcp.once("error", reject);
        tcp.listen(port, "127.0.0.1", resolve);
      });
    } catch (e) {
      udp.close();
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE" && attempt < 32) continue;
      throw e;
    }

    // UDP: echo the header and the question with TC=1 ("truncated, retry over TCP").
    udp.on("message", (query, rinfo) => {
      let end = 12;
      while (query[end] !== 0) end += query[end] + 1;
      const reply = Buffer.from(query.subarray(0, end + 5));
      reply[2] = 0x83; // QR=1 TC=1 RD=1
      reply[3] = 0x80; // RA=1
      reply.fill(0, 6, 12); // no answer, authority or additional records
      udp.send(reply, rinfo.port, rinfo.address);
    });

    // TCP: read the whole query first, because a close with unread data is a
    // reset and not a FIN. Then send 20 bytes of a frame whose length prefix
    // claims 300, and end the connection.
    const sockets = new Set<net.Socket>();
    const server = {
      port,
      tcpConnections: 0,
      [Symbol.dispose]() {
        udp.close();
        tcp.close();
        for (const socket of sockets) socket.destroy();
      },
    };
    tcp.on("connection", socket => {
      server.tcpConnections++;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      let query = Buffer.alloc(0);
      socket.on("data", chunk => {
        if (socket.writableEnded) return;
        query = Buffer.concat([query, chunk]);
        if (query.length < 2 || query.length < 2 + query.readUInt16BE(0)) return;
        const partial = Buffer.alloc(22);
        partial.writeUInt16BE(300, 0);
        socket.end(partial);
      });
    });
    return server;
  }
}

// Every try opens its own TCP connection, like c-ares 1.34.6 and Node.
test.each([1, 2])("a TCP answer that is cut short fails the query with ECONNREFUSED (tries: %d)", async tries => {
  using server = await listenCutShort();
  const resolver = new Resolver({ timeout: 3000, tries });
  resolver.setServers([`127.0.0.1:${server.port}`]);
  try {
    const result = await resolver.resolve4("cut-short.test").then(
      addresses => ({ addresses }),
      err => ({ code: err.code, tcpConnections: server.tcpConnections }),
    );
    expect(result).toEqual({ code: "ECONNREFUSED", tcpConnections: tries });
  } finally {
    resolver.cancel();
  }
});
