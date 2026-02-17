import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

// Regression test for https://github.com/oven-sh/bun/issues/27079
// Bun crashes with "incorrect alignment" panic when processing binary-format
// PostgreSQL int4[] or float4[] arrays from a network buffer whose alignment
// doesn't match the struct's natural alignment (4 bytes).
test("PostgreSQL binary int4_array should not crash on unaligned data", async () => {
  // We build a mock PostgreSQL server that returns a binary int4_array column.
  // The server introduces a 1-byte padding before the DataRow payload to ensure
  // the array data is NOT 4-byte aligned, which triggered the original panic.

  const server = net.createServer(socket => {
    let gotStartup = false;

    socket.on("data", data => {
      if (!gotStartup) {
        gotStartup = true;
        // Client sent startup message. Respond with:
        // 1. AuthenticationOk
        // 2. ParameterStatus (server_encoding = UTF8)
        // 3. BackendKeyData
        // 4. ReadyForQuery (idle)
        const authOk = pgMsg("R", int32BE(0)); // AuthOk
        const paramStatus = pgMsg("S", Buffer.concat([cstr("client_encoding"), cstr("UTF8")]));
        const backendKey = pgMsg("K", Buffer.concat([int32BE(1234), int32BE(5678)]));
        const ready = pgMsg("Z", Buffer.from([0x49])); // 'I' = idle

        socket.write(Buffer.concat([authOk, paramStatus, backendKey, ready]));
        return;
      }

      // Assume any subsequent data is a query. Respond with a result set
      // containing one row with one column: an int4[] array in binary format.

      // RowDescription: 1 field
      //   name = "arr"
      //   table_oid = 0, column_index = 0
      //   type_oid = 1007 (int4_array)
      //   type_size = -1, type_modifier = -1
      //   format = 1 (binary)
      const fieldName = cstr("arr");
      const rowDesc = pgMsg(
        "T",
        Buffer.concat([
          int16BE(1), // number of fields
          fieldName,
          int32BE(0), // table OID
          int16BE(0), // column index
          int32BE(1007), // type OID = int4_array
          int16BE(-1), // type size
          int32BE(-1), // type modifier
          int16BE(1), // format code = binary
        ]),
      );

      // Build the binary int4 array payload:
      // PostgreSQL binary array format:
      //   ndim (4 bytes) = 1
      //   has_nulls (4 bytes) = 0
      //   element_type (4 bytes) = 23 (int4)
      //   dim_length (4 bytes) = 3 (3 elements)
      //   dim_lower_bound (4 bytes) = 1
      //   For each element: length (4 bytes) + value (4 bytes)
      const arrayData = Buffer.concat([
        int32BE(1), // ndim = 1
        int32BE(0), // has_nulls = 0
        int32BE(23), // element_type = int4
        int32BE(3), // length = 3 elements
        int32BE(1), // lower bound = 1
        // Element 0: length=4, value=10
        int32BE(4),
        int32BE(10),
        // Element 1: length=4, value=20
        int32BE(4),
        int32BE(20),
        // Element 2: length=4, value=30
        int32BE(4),
        int32BE(30),
      ]);

      // DataRow: 1 column
      const dataRow = pgMsg(
        "D",
        Buffer.concat([
          int16BE(1), // number of columns
          int32BE(arrayData.length), // column data length
          arrayData,
        ]),
      );

      // CommandComplete
      const cmdComplete = pgMsg("C", cstr("SELECT 1"));

      // ReadyForQuery (idle)
      const ready2 = pgMsg("Z", Buffer.from([0x49]));

      socket.write(Buffer.concat([rowDesc, dataRow, cmdComplete, ready2]));
    });
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      url: `postgres://test@127.0.0.1:${port}/test`,
      max: 1,
      idle_timeout: 1,
    });

    const rows = await sql`SELECT 1`;
    // The query should succeed without an alignment panic.
    // Verify we got an Int32Array with the correct values.
    expect(rows.length).toBe(1);
    const arr = rows[0].arr;
    expect(arr).toBeInstanceOf(Int32Array);
    expect(Array.from(arr)).toEqual([10, 20, 30]);

    await sql.close();
  } finally {
    server.close();
  }
});

test("PostgreSQL binary float4_array should not crash on unaligned data", async () => {
  const server = net.createServer(socket => {
    let gotStartup = false;

    socket.on("data", data => {
      if (!gotStartup) {
        gotStartup = true;
        const authOk = pgMsg("R", int32BE(0));
        const paramStatus = pgMsg("S", Buffer.concat([cstr("client_encoding"), cstr("UTF8")]));
        const backendKey = pgMsg("K", Buffer.concat([int32BE(1234), int32BE(5678)]));
        const ready = pgMsg("Z", Buffer.from([0x49]));
        socket.write(Buffer.concat([authOk, paramStatus, backendKey, ready]));
        return;
      }

      // RowDescription: 1 field with float4_array (OID 1021) in binary format
      const fieldName = cstr("arr");
      const rowDesc = pgMsg(
        "T",
        Buffer.concat([
          int16BE(1),
          fieldName,
          int32BE(0),
          int16BE(0),
          int32BE(1021), // type OID = float4_array
          int16BE(-1),
          int32BE(-1),
          int16BE(1), // binary format
        ]),
      );

      // Binary float4 array: [1.5, 2.5]
      const arrayData = Buffer.concat([
        int32BE(1), // ndim = 1
        int32BE(0), // has_nulls = 0
        int32BE(700), // element_type = float4
        int32BE(2), // length = 2 elements
        int32BE(1), // lower bound = 1
        // Element 0: length=4, value=1.5
        int32BE(4),
        float32BE(1.5),
        // Element 1: length=4, value=2.5
        int32BE(4),
        float32BE(2.5),
      ]);

      const dataRow = pgMsg("D", Buffer.concat([int16BE(1), int32BE(arrayData.length), arrayData]));

      const cmdComplete = pgMsg("C", cstr("SELECT 1"));
      const ready2 = pgMsg("Z", Buffer.from([0x49]));
      socket.write(Buffer.concat([rowDesc, dataRow, cmdComplete, ready2]));
    });
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      url: `postgres://test@127.0.0.1:${port}/test`,
      max: 1,
      idle_timeout: 1,
    });

    const rows = await sql`SELECT 1`;
    expect(rows.length).toBe(1);
    const arr = rows[0].arr;
    expect(arr).toBeInstanceOf(Float32Array);
    expect(Array.from(arr)).toEqual([1.5, 2.5]);

    await sql.close();
  } finally {
    server.close();
  }
});

// Helper functions
function pgMsg(type: string, payload: Buffer): Buffer {
  const len = payload.length + 4;
  const buf = Buffer.alloc(5 + payload.length);
  buf.write(type, 0, 1, "ascii");
  buf.writeInt32BE(len, 1);
  payload.copy(buf, 5);
  return buf;
}

function int32BE(val: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(val, 0);
  return buf;
}

function int16BE(val: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeInt16BE(val, 0);
  return buf;
}

function float32BE(val: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(val, 0);
  return buf;
}

function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
}
