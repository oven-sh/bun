// Postgres sends the text tokens `Infinity` / `-Infinity` / `NaN` for
// float8/float4 values (src/backend/utils/adt/float.c float8out). The scalar
// text decoder parsed these with WTF::parseDouble (JS-number grammar, which
// rejects those tokens) and fell through to NaN, so ±Infinity was silently
// corrupted to NaN. The float8[] array text decoder already special-cased the
// same tokens, so `'infinity'::float8` decoded as NaN while
// `'{infinity}'::float8[]` decoded as [Infinity].
//
// Driven by a scripted simple-query backend so the exact text-format bytes
// each column carries are pinned.

import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
  type PgRowDescriptionColumn,
} from "./wire-frames";

const OID = { float4: 700, float8: 701, float4_array: 1021, float8_array: 1022 } as const;

let reply!: { cols: PgRowDescriptionColumn[]; row: (Buffer | null)[] };
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
        pgRowDescription(reply.cols),
        pgDataRow(reply.row),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => backend.server.close(() => r())));

async function runSimple(cols: PgRowDescriptionColumn[], row: (Buffer | null)[]): Promise<any> {
  reply = { cols, row };
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${backend.port}/db`, max: 1, connectionTimeout: 2 });
  try {
    const [r]: any = await sql`select 1`.simple();
    return r;
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
  }
}

test.each(["float8", "float4"] as const)("scalar %s text 'Infinity'/'-Infinity'/'NaN' decode correctly", async t => {
  const row = await runSimple(
    [
      { name: "pos", typeOid: OID[t] },
      { name: "neg", typeOid: OID[t] },
      { name: "nan", typeOid: OID[t] },
      { name: "fin", typeOid: OID[t] },
    ],
    [Buffer.from("Infinity"), Buffer.from("-Infinity"), Buffer.from("NaN"), Buffer.from("1.5")],
  );
  expect(row.pos).toBe(Infinity);
  expect(row.neg).toBe(-Infinity);
  expect(Number.isNaN(row.nan)).toBe(true);
  expect(row.fin).toBe(1.5);
});

// The array path already handled these tokens; pin it so scalar and array stay
// consistent.
test("float8[] text '{Infinity,-Infinity,NaN,1.5}' decodes to [Infinity, -Infinity, NaN, 1.5]", async () => {
  const row = await runSimple(
    [{ name: "a", typeOid: OID.float8_array }],
    [Buffer.from("{Infinity,-Infinity,NaN,1.5}")],
  );
  expect(row.a[0]).toBe(Infinity);
  expect(row.a[1]).toBe(-Infinity);
  expect(Number.isNaN(row.a[2])).toBe(true);
  expect(row.a[3]).toBe(1.5);
});
