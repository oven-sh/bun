// https://github.com/oven-sh/bun/issues/26809
// Verify that PostgreSQL query results expose .columns / .statement
// derived from the wire-protocol RowDescription message, using a mock
// server so no real Postgres is required.
import { SQL } from "bun";
import { afterEach, expect, test } from "bun:test";
import net from "net";

function pkt(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

function int16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s), Buffer.from([0])]);
}

type Field = { name: string; typeOid: number; tableOid?: number; column?: number };

function rowDescription(fields: Field[]): Buffer {
  const body = Buffer.concat(
    fields.map(f =>
      Buffer.concat([
        cstr(f.name),
        int32(f.tableOid ?? 0),
        int16(f.column ?? 0),
        int32(f.typeOid),
        int16(-1), // type size
        int32(-1), // type modifier
        int16(0), // format: text
      ]),
    ),
  );
  return pkt("T", Buffer.concat([int16(fields.length), body]));
}

function dataRow(values: string[]): Buffer {
  const cols = Buffer.concat(
    values.map(v => {
      const bytes = Buffer.from(v);
      return Buffer.concat([int32(bytes.length), bytes]);
    }),
  );
  return pkt("D", Buffer.concat([int16(values.length), cols]));
}

const authenticationOk = pkt("R", int32(0));
const readyForQuery = pkt("Z", Buffer.from("I"));
const commandComplete = (tag: string) => pkt("C", cstr(tag));

let servers: net.Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

async function mockServer(onQuery: (socket: net.Socket) => void): Promise<number> {
  const server = net.createServer(socket => {
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([authenticationOk, readyForQuery]));
        return;
      }
      if (data[0] !== 0x51 /* 'Q' */) return;
      onQuery(socket);
    });
  });
  servers.push(server);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as net.AddressInfo).port;
}

test("result.columns exposes RowDescription name/type/table/number", async () => {
  const port = await mockServer(socket => {
    socket.write(
      Buffer.concat([
        rowDescription([
          { name: "ctid", typeOid: 27, tableOid: 16388, column: -1 }, // tid, system column (negative attnum)
          { name: "id", typeOid: 23, tableOid: 16388, column: 1 }, // int4
          { name: "data", typeOid: 3802 }, // jsonb
          { name: "tags", typeOid: 1009 }, // text[]
        ]),
        dataRow(["(0,1)", "1", '["a","b"]', "{a,b}"]),
        commandComplete("SELECT 1"),
        readyForQuery,
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
  const port = await mockServer(socket => {
    socket.write(
      Buffer.concat([
        rowDescription([
          { name: "id", typeOid: 23 },
          { name: "msg", typeOid: 25 },
        ]),
        commandComplete("SELECT 0"),
        readyForQuery,
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
  const port = await mockServer(socket => {
    socket.write(
      Buffer.concat([
        rowDescription([
          { name: "x", typeOid: 23 },
          { name: "x", typeOid: 23 },
          { name: "y", typeOid: 25 },
        ]),
        dataRow(["1", "2", "a"]),
        commandComplete("SELECT 1"),
        readyForQuery,
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
  const port = await mockServer(socket => {
    socket.write(
      Buffer.concat([
        rowDescription([{ name: "a", typeOid: 23 }]),
        dataRow(["1"]),
        commandComplete("SELECT 1"),
        rowDescription([
          { name: "b", typeOid: 25 },
          { name: "c", typeOid: 23 },
        ]),
        dataRow(["x", "2"]),
        commandComplete("SELECT 1"),
        readyForQuery,
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
  const port = await mockServer(socket => {
    socket.write(Buffer.concat([commandComplete("CREATE TABLE"), readyForQuery]));
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
  const port = await mockServer(socket => {
    socket.write(
      Buffer.concat([
        rowDescription([{ name: "x", typeOid: 23 }]),
        dataRow(["1"]),
        commandComplete("SELECT 1"),
        // INSERT: no RowDescription
        commandComplete("INSERT 0 1"),
        rowDescription([{ name: "y", typeOid: 25 }]),
        dataRow(["hi"]),
        commandComplete("SELECT 1"),
        // DROP: no RowDescription
        commandComplete("DROP TABLE"),
        readyForQuery,
      ]),
    );
  });

  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const results = await sql`select 1 as x; insert into t values (1); select 'hi' as y; drop table t`.simple();
    expect(results).toHaveLength(4);
    expect(results[0].columns).toEqual([{ name: "x", type: 23, table: 0, number: 0 }]);
    expect(results[1].columns).toEqual([]); // INSERT — must not inherit x
    expect(results[2].columns).toEqual([{ name: "y", type: 25, table: 0, number: 0 }]);
    expect(results[3].columns).toEqual([]); // DROP — must not inherit y
  } finally {
    await sql.close();
  }
});
