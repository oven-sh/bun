// https://github.com/oven-sh/bun/issues/26809
//
// Verifies the RowDescription → `result.columns` / `result.statement` mapping
// byte-for-byte with a mock server so the test runs without a Postgres
// container. The real-server coverage lives in sql.test.ts under
// `describe("result.columns / result.statement")`; this file exercises the
// exact name/type/table/number wire values (including negative system-column
// attnums) that would otherwise require specific DDL in a container.
//
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
import { SQL } from "bun";
import { afterEach, expect, test } from "bun:test";
import type net from "net";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

let servers: net.Server[] = [];
afterEach(async () => {
  for (const s of servers) await new Promise<void>(r => s.close(() => r()));
  servers = [];
});

async function simpleQueryServer(onQuery: (socket: net.Socket) => void): Promise<number> {
  const { port, server } = await listeningServer(socket => {
    socket.on("error", () => {});
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      if (data[0] !== 0x51 /* 'Q' */) return;
      onQuery(socket);
    });
  });
  servers.push(server);
  return port;
}

function text(s: string): Buffer {
  return Buffer.from(s);
}

test("result.columns exposes RowDescription name/type/table/number", async () => {
  const port = await simpleQueryServer(socket => {
    socket.write(
      Buffer.concat([
        pgRowDescription([
          { name: "ctid", typeOid: 27, tableOid: 16388, columnAttr: -1 }, // tid, system column (negative attnum)
          { name: "id", typeOid: 23, tableOid: 16388, columnAttr: 1 }, // int4
          { name: "data", typeOid: 3802 }, // jsonb
          { name: "tags", typeOid: 1009 }, // text[]
        ]),
        pgDataRow([text("(0,1)"), text("1"), text('["a","b"]'), text("{a,b}")]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });

  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const result = await sql`select ctid, id, data, tags from posts`.simple();
    expect(result.columns).toEqual([
      { name: "ctid", type: 27, table: 16388, number: -1 },
      { name: "id", type: 23, table: 16388, number: 1 },
      { name: "data", type: 3802, table: 0, number: 0 },
      { name: "tags", type: 1009, table: 0, number: 0 },
    ]);
    expect(result.statement.string).toBe("select ctid, id, data, tags from posts");
    expect(result.statement.columns).toBe(result.columns);
  } finally {
    await sql.close();
  }
});

test("result.columns is populated even for zero-row result sets", async () => {
  const port = await simpleQueryServer(socket => {
    socket.write(
      Buffer.concat([
        pgRowDescription([
          { name: "id", typeOid: 23 },
          { name: "msg", typeOid: 25 },
        ]),
        pgCommandComplete("SELECT 0"),
        pgReadyForQuery(),
      ]),
    );
  });

  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const result = await sql`select id, msg from t where false`.simple();
    expect(result).toHaveLength(0);
    expect(result.columns).toEqual([
      { name: "id", type: 23, table: 0, number: 0 },
      { name: "msg", type: 25, table: 0, number: 0 },
    ]);
  } finally {
    await sql.close();
  }
});

test("result.columns preserves duplicate column names", async () => {
  const port = await simpleQueryServer(socket => {
    socket.write(
      Buffer.concat([
        pgRowDescription([
          { name: "x", typeOid: 23 },
          { name: "x", typeOid: 23 },
          { name: "y", typeOid: 25 },
        ]),
        pgDataRow([text("1"), text("2"), text("a")]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });

  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const result = await sql`select 1 as x, 2 as x, 'a' as y`.simple().values();
    expect(result[0]).toEqual([1, 2, "a"]);
    expect(result.columns.map(c => c.name)).toEqual(["x", "x", "y"]);
    expect(result.columns.map(c => c.type)).toEqual([23, 23, 25]);
  } finally {
    await sql.close();
  }
});

test("multi-statement simple() attaches per-result-set columns", async () => {
  const port = await simpleQueryServer(socket => {
    socket.write(
      Buffer.concat([
        pgRowDescription([{ name: "a", typeOid: 23 }]),
        pgDataRow([text("1")]),
        pgCommandComplete("SELECT 1"),
        pgRowDescription([
          { name: "b", typeOid: 25 },
          { name: "c", typeOid: 23 },
        ]),
        pgDataRow([text("x"), text("2")]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });

  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const results = await sql`select 1 as a; select 'x' as b, 2 as c`.simple();
    expect(results[0].columns).toEqual([{ name: "a", type: 23, table: 0, number: 0 }]);
    expect(results[1].columns).toEqual([
      { name: "b", type: 25, table: 0, number: 0 },
      { name: "c", type: 23, table: 0, number: 0 },
    ]);
    expect(results[0].statement.columns).toBe(results[0].columns);
    expect(results[1].statement.columns).toBe(results[1].columns);
  } finally {
    await sql.close();
  }
});

test("result.columns is an empty array for commands with no RowDescription", async () => {
  const port = await simpleQueryServer(socket => {
    socket.write(Buffer.concat([pgCommandComplete("CREATE TABLE"), pgReadyForQuery()]));
  });

  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const result = await sql`create table t (id int)`.simple();
    expect(result.columns).toEqual([]);
    expect(result.statement.string).toBe("create table t (id int)");
  } finally {
    await sql.close();
  }
});

test("multi-statement simple(): non-SELECT after SELECT does not inherit stale columns", async () => {
  // SELECT (RowDescription+DataRow) then INSERT (no RowDescription) then SELECT again.
  const port = await simpleQueryServer(socket => {
    socket.write(
      Buffer.concat([
        pgRowDescription([{ name: "x", typeOid: 23 }]),
        pgDataRow([text("1")]),
        pgCommandComplete("SELECT 1"),
        // INSERT: no RowDescription
        pgCommandComplete("INSERT 0 1"),
        pgRowDescription([{ name: "y", typeOid: 25 }]),
        pgDataRow([text("hi")]),
        pgCommandComplete("SELECT 1"),
        // DROP: no RowDescription
        pgCommandComplete("DROP TABLE"),
        pgReadyForQuery(),
      ]),
    );
  });

  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const results = await sql`select 1 as x; insert into t values (1); select 'hi' as y; drop table t`.simple();
    expect(results).toHaveLength(4);
    expect(results[0].columns).toEqual([{ name: "x", type: 23, table: 0, number: 0 }]);
    expect(results[1].columns).toEqual([]); // INSERT: must not inherit x
    expect(results[2].columns).toEqual([{ name: "y", type: 25, table: 0, number: 0 }]);
    expect(results[3].columns).toEqual([]); // DROP: must not inherit y
  } finally {
    await sql.close();
  }
});
