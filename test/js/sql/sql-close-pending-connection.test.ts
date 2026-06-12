// https://github.com/oven-sh/bun/issues/32095
//
// A forced pool close (`close({ timeout: "0" })`) must resolve even when a
// pool connection has been accepted at the TCP level but the database
// handshake has not completed yet (a database that is still starting up).
// Previously the pending queries were rejected but the promise returned by
// close() stayed pending forever: the native close path emitted no socket
// event for in-flight connects, so the JS onclose callback never fired.
//
// connectionTimeout: 0 disables the connect timer, so close() is the only
// thing that can tear the connection down — without the fix these tests hang.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "node:net";

const drivers = [
  ["postgres", "postgres://postgres@", "ERR_POSTGRES_CONNECTION_CLOSED"],
  ["mysql", "mysql://root@", "ERR_MYSQL_CONNECTION_CLOSED"],
] as const;

async function neverAnsweringServer(): Promise<{
  port: number;
  server: net.Server;
  sockets: net.Socket[];
  accepted: Promise<void>;
}> {
  const first = Promise.withResolvers<void>();
  const sockets: net.Socket[] = [];
  const server = net.createServer(socket => {
    sockets.push(socket);
    first.resolve();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as net.AddressInfo).port, server, sockets, accepted: first.promise };
}

for (const [name, scheme, closedCode] of drivers) {
  test(`${name}: forced close() resolves while a connection is mid-handshake`, async () => {
    const { port, server, sockets, accepted } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const queryError = sql`SELECT 1`.catch(e => e);
      // the server holds the connection open without ever completing the
      // handshake, so the pool connection stays mid-handshake from here on
      await accepted;
      await sql.close({ timeout: "0" });
      expect((await queryError).code).toBe(closedCode);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  test(`${name}: forced close() resolves when called before the native handle is stored`, async () => {
    const { port, server, sockets } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const connectError = sql.connect().catch(e => e);
      // close in the same tick: the pool slot exists but its native handle
      // has not been assigned yet
      await sql.close({ timeout: "0" });
      expect((await connectError).code).toBe(closedCode);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });
}
