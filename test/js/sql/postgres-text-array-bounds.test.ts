// Postgres array_out prints the dimension bounds in front of the body when a
// lower bound is not 1: `[0:2]={1,2,3}`. The system catalogs produce such
// arrays (int2vector and oidvector start at 0, so `pg_index.indkey::int2[]`
// arrives this way), and so does a slice assignment like `a[0:1] = '{1,2}'`.
// The text decoder must skip the `[lo:hi]...=` prefix and return the elements.
// Queries with no parameters use the text format.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const INT4_ARRAY_OID = 1007;

// A real server never sends a `[` prefix without `=`. A scripted backend pins
// the rejection for that input.
let reply: Buffer = Buffer.alloc(0);
const backend = await listeningServer(socket => {
  let startup = true;
  socket.on("data", data => {
    if (startup) {
      startup = false;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      return;
    }
    if (data[0] !== 0x51 /* 'Q' */) return;
    socket.write(
      Buffer.concat([
        pgRowDescription([{ name: "v", typeOid: INT4_ARRAY_OID, format: 0 }]),
        pgDataRow([reply]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => backend.server.close(() => r())));

// Serial on purpose: the tests share `reply`.
test.each(["[0:1]{1,2}", "[0:1", "[0:1]={1,2", "[0:1]=1"])(
  "text int4[] %p without a complete bounds prefix and body is rejected",
  async text => {
    reply = Buffer.from(text);
    const sql = new SQL({ url: `postgres://u@127.0.0.1:${backend.port}/db`, max: 1, connectionTimeout: 2 });
    try {
      const err = await sql`select 1`.simple().then(
        () => null,
        e => e,
      );
      expect(err).toMatchObject({ code: "ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT" });
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
    }
  },
);

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = async () => {
    await container.ready;
    return new SQL({ url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, max: 1 });
  };

  test("text[] with explicit bounds", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:2]={a,b,c}'::text[] as v`;
    expect(row.v).toEqual(["a", "b", "c"]);
  });

  test("int4[] with explicit bounds", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:2]={1,2,3}'::int4[] as v`;
    expect(row.v).toEqual([1, 2, 3]);
  });

  test("float8[] with explicit bounds", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:2]={1.5,2,3}'::float8[] as v`;
    expect(row.v).toEqual([1.5, 2, 3]);
  });

  test("multi-dimensional array with explicit bounds", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:1][0:1]={{1,2},{3,4}}'::int4[] as v`;
    expect(row.v).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("bounded and unbounded arrays in one row", async () => {
    await using sql = await connect();
    const [row] = await sql`SELECT '[0:0]={1}'::int4[] as v, '{4}'::int4[] as w, ARRAY[]::int4[] as e`;
    expect(row).toEqual({ v: [1], w: [4], e: [] });
  });

  test("catalog int2vector column cast to int2[]", async () => {
    await using sql = await connect();
    const [row] = await sql`
      SELECT indkey::int2[] as v
      FROM pg_index
      WHERE indexrelid = 'pg_class_oid_index'::regclass
    `;
    expect(row.v).toEqual([1]);
  });
});
