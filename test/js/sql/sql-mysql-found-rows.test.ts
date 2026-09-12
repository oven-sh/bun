// Bun.SQL MySQL `foundRows` option: toggles CLIENT_FOUND_ROWS in the
// HandshakeResponse41 (default on, matching mysql2 / mariadb), which makes
// the server report WHERE-matched rows instead of changed rows in affectedRows.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import {
  listeningServer,
  MYSQL_CLIENT_FOUND_ROWS,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlParseHandshakeResponse41ClientFlags,
  mysqlReadPackets,
} from "./wire-frames";

interface CapturedHandshake {
  capabilityFlags: number;
}

// Completes the handshake, captures the client's HandshakeResponse41 capability
// flags, and answers each COM_QUERY with an OK_Packet carrying `affectedRows`.
async function startMockMysql(affectedRows: number): Promise<{
  port: number;
  captured: Promise<CapturedHandshake>;
  close: () => void;
}> {
  const captured = Promise.withResolvers<CapturedHandshake>();
  const { port, server } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let sawHandshakeResponse = false;

    // Advertise CLIENT_FOUND_ROWS so the client's intersect keeps it when requested.
    socket.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_FOUND_ROWS }));

    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!sawHandshakeResponse) {
          sawHandshakeResponse = true;
          captured.resolve({ capabilityFlags: mysqlParseHandshakeResponse41ClientFlags(payload) });
          socket.write(mysqlOkPacket(seq + 1));
        } else if (payload[0] === 0x03) {
          // COM_QUERY
          socket.write(mysqlOkPacket(seq + 1, 0x00, affectedRows));
        } else if (payload[0] === 0x01) {
          // COM_QUIT
          socket.end();
        }
      });
    });

    socket.on("error", () => {});
    // Don't leak the captured waiter if the client drops early.
    socket.on("close", () => captured.resolve({ capabilityFlags: 0 }));
  });
  return { port, captured: captured.promise, close: () => server.close() };
}

async function runHandshakeCase(options: Bun.SQL.Options): Promise<number> {
  const mock = await startMockMysql(1);
  try {
    await using db = new SQL({
      ...options,
      adapter: "mysql",
      hostname: "127.0.0.1",
      port: mock.port,
      username: "root",
      password: "",
      database: "test",
      max: 1,
      idleTimeout: 1,
    } as Bun.SQL.Options);

    // Triggering any query forces the handshake to complete.
    await db.unsafe("UPDATE t SET v = 1");
    const { capabilityFlags } = await mock.captured;
    return capabilityFlags;
  } finally {
    mock.close();
  }
}

describe("Bun.SQL MySQL foundRows (CLIENT_FOUND_ROWS)", () => {
  test("default: CLIENT_FOUND_ROWS is enabled (matches mysql2 / mariadb defaults)", async () => {
    const caps = await runHandshakeCase({});
    expect((caps & MYSQL_CLIENT_FOUND_ROWS) !== 0).toBe(true);
  });

  test("foundRows: true enables CLIENT_FOUND_ROWS", async () => {
    const caps = await runHandshakeCase({ foundRows: true } as Bun.SQL.Options);
    expect((caps & MYSQL_CLIENT_FOUND_ROWS) !== 0).toBe(true);
  });

  test("foundRows: false disables CLIENT_FOUND_ROWS", async () => {
    const caps = await runHandshakeCase({ foundRows: false } as Bun.SQL.Options);
    expect((caps & MYSQL_CLIENT_FOUND_ROWS) !== 0).toBe(false);
  });

  test("URL ?foundRows=false disables CLIENT_FOUND_ROWS", async () => {
    const mock = await startMockMysql(1);
    try {
      await using db = new SQL({
        url: `mysql://root:@127.0.0.1:${mock.port}/test?foundRows=false`,
        max: 1,
        idleTimeout: 1,
      });
      await db.unsafe("UPDATE t SET v = 1");
      const { capabilityFlags } = await mock.captured;
      expect((capabilityFlags & MYSQL_CLIENT_FOUND_ROWS) !== 0).toBe(false);
    } finally {
      mock.close();
    }
  });

  test("URL with duplicate foundRows keys doesn't throw", async () => {
    // toJSON() returns an array for duplicate keys; the coerced "true,false"
    // is neither "false" nor "0", so the default (enabled) wins.
    const mock = await startMockMysql(1);
    try {
      await using db = new SQL({
        url: `mysql://root:@127.0.0.1:${mock.port}/test?foundRows=true&foundRows=false`,
        max: 1,
        idleTimeout: 1,
      });
      await db.unsafe("UPDATE t SET v = 1");
      const { capabilityFlags } = await mock.captured;
      expect((capabilityFlags & MYSQL_CLIENT_FOUND_ROWS) !== 0).toBe(true);
    } finally {
      mock.close();
    }
  });

  test("options object wins over URL query string", async () => {
    const mock = await startMockMysql(1);
    try {
      await using db = new SQL({
        url: `mysql://root:@127.0.0.1:${mock.port}/test?foundRows=false`,
        foundRows: true,
        max: 1,
        idleTimeout: 1,
      } as Bun.SQL.Options);
      await db.unsafe("UPDATE t SET v = 1");
      const { capabilityFlags } = await mock.captured;
      expect((capabilityFlags & MYSQL_CLIENT_FOUND_ROWS) !== 0).toBe(true);
    } finally {
      mock.close();
    }
  });

  test("affectedRows reflects the server's OK_Packet.affected_rows value", async () => {
    const mock = await startMockMysql(1);
    try {
      await using db = new SQL({
        adapter: "mysql",
        hostname: "127.0.0.1",
        port: mock.port,
        username: "root",
        password: "",
        database: "test",
        max: 1,
        idleTimeout: 1,
      });
      const result: any = await db.unsafe("UPDATE t SET v = v WHERE id = 1");
      expect(result.affectedRows).toBe(1);
    } finally {
      mock.close();
    }
  });
});
