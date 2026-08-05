// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  MYSQL_CLIENT_CONNECT_WITH_DB,
  MYSQL_CLIENT_MULTI_RESULTS,
  MYSQL_CLIENT_MULTI_STATEMENTS,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
} from "./wire-frames";

// The mock server advertises CLIENT_MULTI_STATEMENTS so the client is free to
// request it. CLIENT_CONNECT_WITH_DB is also advertised so the client can send
// the database name inline rather than issuing a COM_INIT_DB afterwards.
const SERVER_CAPABILITIES =
  MYSQL_DEFAULT_CAPABILITIES |
  MYSQL_CLIENT_CONNECT_WITH_DB |
  MYSQL_CLIENT_MULTI_STATEMENTS |
  MYSQL_CLIENT_MULTI_RESULTS;

async function captureHandshakeCapabilities(options: Bun.SQL.Options): Promise<number> {
  const captured = Promise.withResolvers<number>();
  const greeting = mysqlHandshakeV10({ capabilities: SERVER_CAPABILITIES });

  const { port, server } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let seen = false;
    socket.write(greeting);
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (seen) return;
        seen = true;
        // HandshakeResponse41 starts with the client's Int<4> capability flags.
        captured.resolve(payload.readUInt32LE(0));
        socket.write(mysqlOkPacket(seq + 1));
      });
    });
    socket.on("error", () => {});
  });

  try {
    await using sql = new SQL({
      adapter: "mysql",
      hostname: "127.0.0.1",
      port,
      username: "root",
      password: "pw",
      database: "db",
      max: 1,
      ...options,
    });
    await sql.connect();
    return await captured.promise;
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}

test("MySQL: CLIENT_MULTI_STATEMENTS is not advertised by default", async () => {
  const caps = await captureHandshakeCapabilities({});
  // Stacked-query support must be opt-in: every mainstream MySQL client
  // (mysql2, go-sql-driver/mysql, mysqlclient) defaults it off so a
  // single-statement injection cannot escalate to arbitrary stacked
  // statements. CLIENT_MULTI_RESULTS stays on so stored procedures that
  // return multiple result sets keep working.
  expect({
    CLIENT_MULTI_STATEMENTS: !!(caps & MYSQL_CLIENT_MULTI_STATEMENTS),
    CLIENT_MULTI_RESULTS: !!(caps & MYSQL_CLIENT_MULTI_RESULTS),
  }).toEqual({
    CLIENT_MULTI_STATEMENTS: false,
    CLIENT_MULTI_RESULTS: true,
  });
});

test("MySQL: multipleStatements: true advertises CLIENT_MULTI_STATEMENTS", async () => {
  const caps = await captureHandshakeCapabilities({ multipleStatements: true } as Bun.SQL.Options);
  expect({
    CLIENT_MULTI_STATEMENTS: !!(caps & MYSQL_CLIENT_MULTI_STATEMENTS),
    CLIENT_MULTI_RESULTS: !!(caps & MYSQL_CLIENT_MULTI_RESULTS),
  }).toEqual({
    CLIENT_MULTI_STATEMENTS: true,
    CLIENT_MULTI_RESULTS: true,
  });
});

test("MySQL: multipleStatements: false does not advertise CLIENT_MULTI_STATEMENTS", async () => {
  const caps = await captureHandshakeCapabilities({ multipleStatements: false } as Bun.SQL.Options);
  expect(!!(caps & MYSQL_CLIENT_MULTI_STATEMENTS)).toBe(false);
});
