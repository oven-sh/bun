// When a simple-mode query contains multiple SQL statements separated by ';',
// Postgres sends one RowDescription per result set while the same request
// stays current until ReadyForQuery. Each RowDescription must free the
// previous statement.fields allocation and invalidate derived state
// (cached_structure / needs_duplicate_check / fields_flags) so later result
// sets use the correct column names and the previous []FieldDescription is
// not leaked.
import { SQL } from "bun";
import { expect, test } from "bun:test";
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

function rowDescription(names: string[]): Buffer {
  const fields = Buffer.concat(
    names.map(name =>
      Buffer.concat([
        cstr(name), // column name
        int32(0), // table oid
        int16(0), // column attr number
        int32(25), // type oid: text
        int16(-1), // type size
        int32(-1), // type modifier
        int16(0), // format: text
      ]),
    ),
  );
  return pkt("T", Buffer.concat([int16(names.length), fields]));
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

test("simple query with multiple statements uses each RowDescription's column names", async () => {
  const server = net.createServer(socket => {
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([authenticationOk, readyForQuery]));
        return;
      }
      if (data[0] !== 0x51 /* 'Q' */) return;
      // Respond to the simple query with two result sets that have different
      // column names and shapes, then a third with yet another shape.
      socket.write(
        Buffer.concat([
          rowDescription(["x"]),
          dataRow(["1"]),
          commandComplete("SELECT 1"),
          rowDescription(["y"]),
          dataRow(["2"]),
          commandComplete("SELECT 1"),
          rowDescription(["a", "b", "c"]),
          dataRow(["3", "4", "5"]),
          commandComplete("SELECT 1"),
          readyForQuery,
        ]),
      );
    });
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  const sql = new SQL({
    url: `postgres://u@127.0.0.1:${port}/db`,
    max: 1,
    idleTimeout: 5,
    connectionTimeout: 5,
  });

  try {
    const result = await sql`select 1 as x; select 2 as y; select 3 as a, 4 as b, 5 as c`.simple();
    expect(result).toEqual([[{ x: "1" }], [{ y: "2" }], [{ a: "3", b: "4", c: "5" }]]);
  } finally {
    await sql.close();
    server.close();
  }
});
