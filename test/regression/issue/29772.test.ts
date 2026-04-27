// Regression test for https://github.com/oven-sh/bun/issues/29772
//
// Bun.SQL's postgres binary-numeric decoder had two correctness bugs:
//
// 1. Zero values in a numeric(p, s) column lost their scale formatting on the
//    prepared/binary protocol path. The decoder short-circuited when
//    ndigits == 0 and returned the static string "0" regardless of dscale,
//    so numeric(10, 4) zero came back as "0" instead of "0.0000".
//
// 2. Fractional values smaller than ~1e-8 (first base-10000 digit group at
//    weight <= -3) were under-padded with leading zeros. The fractional
//    loop used a single counter for both the digit-array index and the
//    dscale position, conflating postgres' two separate counters (digit
//    index +1, dscale position +4). Example: 0.000000001234 came back as
//    "0.000012340000".
//
// These tests stand up a minimal postgres wire-protocol mock that returns
// a single numeric column with hand-crafted binary encodings, exercising
// parseBinaryNumeric directly — no docker / no live postgres required.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

// --- postgres wire protocol helpers ---

/** Prepend a 1-byte type + 4-byte length (inclusive) to a payload. */
function pgPacket(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, 1, "ascii");
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

/** ReadyForQuery ('Z') with transaction status 'I' (idle). */
const READY_FOR_QUERY_IDLE = pgPacket("Z", Buffer.from([0x49]));

/** AuthenticationOk ('R', int32 = 0). */
const AUTH_OK = pgPacket("R", Buffer.from([0, 0, 0, 0]));

/** ParseComplete ('1'). */
const PARSE_COMPLETE = pgPacket("1", Buffer.alloc(0));

/** BindComplete ('2'). */
const BIND_COMPLETE = pgPacket("2", Buffer.alloc(0));

/** Build CommandComplete ('C') for "SELECT <rows>". */
function commandComplete(rows: number): Buffer {
  return pgPacket("C", Buffer.concat([Buffer.from(`SELECT ${rows}`, "ascii"), Buffer.from([0])]));
}

/** ParameterDescription ('t') listing the int4 oid (23) for each param. */
function parameterDescription(paramCount: number): Buffer {
  const buf = Buffer.alloc(2 + 4 * paramCount);
  buf.writeInt16BE(paramCount, 0);
  for (let i = 0; i < paramCount; i++) {
    buf.writeInt32BE(23, 2 + i * 4); // int4 oid
  }
  return pgPacket("t", buf);
}

/**
 * RowDescription ('T') with a single field named `name`, type oid 1700
 * (numeric), binary format code.
 */
function rowDescriptionNumeric(name: string): Buffer {
  const nameBuf = Buffer.from(name + "\0", "ascii");
  // fields: 2 bytes count
  // per field: name + table_oid(4) + column_index(2) + type_oid(4)
  //          + type_size(2) + type_modifier(4) + format_code(2)
  const body = Buffer.concat([
    Buffer.from([0x00, 0x01]), // field count = 1
    nameBuf,
    Buffer.from([0, 0, 0, 0]), // table_oid = 0
    Buffer.from([0, 0]), // column_index = 0
    Buffer.from([0, 0, 0x06, 0xa4]), // type_oid = 1700 (numeric)
    Buffer.from([0xff, 0xff]), // type_size = -1 (var-width)
    Buffer.from([0xff, 0xff, 0xff, 0xff]), // type_modifier = -1
    Buffer.from([0x00, 0x01]), // format_code = 1 (binary)
  ]);
  return pgPacket("T", body);
}

/**
 * Build a postgres binary-numeric byte sequence:
 *   i16 ndigits, i16 weight, u16 sign, i16 dscale, then i16 digits × ndigits.
 */
function numericBinary(ndigits: number, weight: number, sign: number, dscale: number, digits: number[]): Buffer {
  const buf = Buffer.alloc(8 + 2 * digits.length);
  buf.writeInt16BE(ndigits, 0);
  buf.writeInt16BE(weight, 2);
  buf.writeUInt16BE(sign, 4);
  buf.writeInt16BE(dscale, 6);
  for (let i = 0; i < digits.length; i++) {
    buf.writeUInt16BE(digits[i]!, 8 + i * 2);
  }
  return buf;
}

/** DataRow ('D') with one column carrying the supplied bytes. */
function dataRowOneColumn(value: Buffer): Buffer {
  const body = Buffer.alloc(2 + 4 + value.length);
  body.writeInt16BE(1, 0); // column count
  body.writeInt32BE(value.length, 2); // column length
  value.copy(body, 6);
  return pgPacket("D", body);
}

/**
 * Start a mock postgres server that returns `rows` (each a binary numeric
 * byte string) for every extended-protocol query. Speaks just enough of
 * the wire protocol to drive `sql.unsafe(query, [...])` to Bind/Execute
 * and decode the DataRow response via parseBinaryNumeric.
 */
function startMockPostgres(rows: Buffer[]): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      let phase: "startup" | "ready" = "startup";
      let buf = Buffer.alloc(0);

      socket.on("data", chunk => {
        buf = Buffer.concat([buf, chunk]);

        // Startup is special: first message has no type byte, just length.
        if (phase === "startup") {
          if (buf.length < 4) return;
          const startupLen = buf.readInt32BE(0);
          if (buf.length < startupLen) return;
          buf = buf.subarray(startupLen);
          phase = "ready";
          // AuthenticationOk → ReadyForQuery. Skip ParameterStatus /
          // BackendKeyData — the bun client doesn't require them to proceed.
          socket.write(Buffer.concat([AUTH_OK, READY_FOR_QUERY_IDLE]));
        }

        // Extended protocol: consume framed messages (type + 4B length).
        while (buf.length >= 5) {
          const msgLen = buf.readInt32BE(1);
          const total = 1 + msgLen;
          if (buf.length < total) break;
          const type = String.fromCharCode(buf[0]!);
          buf = buf.subarray(total);

          if (type === "P") {
            // Parse → ParseComplete
            socket.write(PARSE_COMPLETE);
          } else if (type === "D") {
            // Describe statement → ParameterDescription + RowDescription
            socket.write(Buffer.concat([parameterDescription(1), rowDescriptionNumeric("v")]));
          } else if (type === "B") {
            // Bind → BindComplete
            socket.write(BIND_COMPLETE);
          } else if (type === "E") {
            // Execute → DataRows + CommandComplete
            const packets: Buffer[] = [];
            for (const row of rows) packets.push(dataRowOneColumn(row));
            packets.push(commandComplete(rows.length));
            socket.write(Buffer.concat(packets));
          } else if (type === "S" || type === "H") {
            // Sync / Flush → ReadyForQuery (Sync only, but emitting on
            // Flush too is harmless and simplifies the mock).
            if (type === "S") socket.write(READY_FOR_QUERY_IDLE);
          } else if (type === "X") {
            // Terminate
            socket.end();
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => server.close() });
    });
  });
}

/** Run a single `SELECT ... $1` against the mock and return the decoded column. */
async function runQuery(rows: Buffer[]): Promise<string[]> {
  const mock = await startMockPostgres(rows);
  try {
    await using sql = new SQL({
      adapter: "postgres",
      hostname: "127.0.0.1",
      port: mock.port,
      username: "mock",
      database: "mock",
      ssl: false,
      max: 1,
      idleTimeout: 1,
    });
    const result = await sql.unsafe("SELECT v FROM t LIMIT $1", [rows.length]);
    return result.map((r: any) => r.v as string);
  } finally {
    mock.close();
  }
}

// --- tests ---

test("numeric zero with dscale > 0 preserves scale on binary path (#29772)", async () => {
  // numeric(10, 4) zero: ndigits=0, weight=0, sign=0, dscale=4
  const zeros4 = numericBinary(0, 0, 0x0000, 4, []);
  expect(await runQuery([zeros4])).toEqual(["0.0000"]);
});

test("numeric zero with dscale = 0 renders as bare '0' on binary path", async () => {
  // numeric (no typmod) zero: ndigits=0, weight=0, sign=0, dscale=0
  const zeros0 = numericBinary(0, 0, 0x0000, 0, []);
  expect(await runQuery([zeros0])).toEqual(["0"]);
});

test("numeric zero with dscale > 0 preserves scale alongside non-zero rows", async () => {
  // Mirrors the repro: numeric(10, 4) with values 0, 1, 1.5, 10.
  // Binary encodings worked out by hand (and cross-checked against the
  // bytes postgres actually emits):
  //   0       : ndigits=0, weight=0,  dscale=4, []
  //   1.0000  : ndigits=1, weight=0,  dscale=4, [1]
  //   1.5000  : ndigits=2, weight=0,  dscale=4, [1, 5000]
  //   10.0000 : ndigits=1, weight=0,  dscale=4, [10]
  const rows = [
    numericBinary(0, 0, 0x0000, 4, []),
    numericBinary(1, 0, 0x0000, 4, [1]),
    numericBinary(2, 0, 0x0000, 4, [1, 5000]),
    numericBinary(1, 0, 0x0000, 4, [10]),
  ];
  expect(await runQuery(rows)).toEqual(["0.0000", "1.0000", "1.5000", "10.0000"]);
});

test("numeric with dscale but ndigits = 0 handles dscale > 4", async () => {
  // numeric(30, 20) zero: ndigits=0, dscale=20 → "0." + 20 zeros.
  const zeros20 = numericBinary(0, 0, 0x0000, 20, []);
  expect(await runQuery([zeros20])).toEqual(["0.00000000000000000000"]);
});

test("numeric small fractional values render correctly (weight <= -3)", async () => {
  // 0.000000001234 : ndigits=1, weight=-3, dscale=12, digits=[1234]
  // The pre-existing bug conflated digit-index and dscale-position counters,
  // so this rendered as "0.000012340000" instead of "0.000000001234".
  const tiny = numericBinary(1, -3, 0x0000, 12, [1234]);
  expect(await runQuery([tiny])).toEqual(["0.000000001234"]);
});

test("numeric very small fractional values render correctly (weight = -5)", async () => {
  // 0.00000000000000001234 : ndigits=1, weight=-5, dscale=20, digits=[1234]
  const tinier = numericBinary(1, -5, 0x0000, 20, [1234]);
  expect(await runQuery([tinier])).toEqual(["0.00000000000000001234"]);
});

test("numeric weight = -2 (previously accidentally correct) still renders correctly", async () => {
  // 0.00005678 : ndigits=1, weight=-2, dscale=8, digits=[5678].
  const v = numericBinary(1, -2, 0x0000, 8, [5678]);
  expect(await runQuery([v])).toEqual(["0.00005678"]);
});

test("numeric weight = -1 with two digit groups renders correctly (e.g. 0.05678)", async () => {
  // 0.05678 : ndigits=2, weight=-1, dscale=5, digits=[567, 8000]
  const v = numericBinary(2, -1, 0x0000, 5, [567, 8000]);
  expect(await runQuery([v])).toEqual(["0.05678"]);
});

test("numeric negative value with small fractional magnitude renders correctly", async () => {
  // -0.00000001234 : ndigits=1, weight=-2, dscale=11, digits=[1234], sign=0x4000
  // weight=-2 is the "accidentally correct" range; this also guards against
  // sign handling regressions when combined with the split-counter fix.
  const v = numericBinary(1, -2, 0x4000, 11, [1234]);
  expect(await runQuery([v])).toEqual(["-0.00001234000"]);
});
