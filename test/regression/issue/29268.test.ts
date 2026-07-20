// Tests that Bun.SQL MySQL adapter handles multi-statement responses
// against servers whose advertised capability set exercises the
// newly-added legacy / deprecate-EOF branches (ManticoreSearch hits
// this after #28005). Regressed in 1.3.12.
// See: https://github.com/oven-sh/bun/issues/29268
import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

// --- MySQL wire protocol helpers ---

/** Wrap a payload in a MySQL packet with 3-byte length + 1-byte sequence ID. */
function makePacket(seqId: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header[3] = seqId & 0xff;
  return Buffer.concat([header, payload]);
}

/** Encode a length-encoded integer (values < 251 only). */
function lenEncInt(val: number): Buffer {
  if (val < 251) return Buffer.from([val]);
  if (val < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = 0xfc;
    b.writeUInt16LE(val, 1);
    return b;
  }
  throw new Error("lenEncInt: value too large for this helper");
}

/** Encode a length-encoded string. */
function lenEncStr(str: string): Buffer {
  const buf = Buffer.from(str);
  return Buffer.concat([lenEncInt(buf.length), buf]);
}

/**
 * Build a HandshakeV10 payload mimicking ManticoreSearch's advertised
 * capability set. Manticore advertises CONNECT_WITH_DB, PROTOCOL_41,
 * SECURE_CONNECTION, MULTI_RESULTS, PLUGIN_AUTH, CONNECT_ATTRS and
 * DEPRECATE_EOF — but NOT MULTI_STATEMENTS.
 */
function buildHandshake(opts: { deprecateEof: boolean }): Buffer {
  const parts: Buffer[] = [];

  // Protocol version
  parts.push(Buffer.from([0x0a]));
  // Server version (null-terminated)
  parts.push(Buffer.from("8.0.36-mock-manticore\0"));
  // Connection ID (4 bytes LE)
  const connId = Buffer.alloc(4);
  connId.writeUInt32LE(1);
  parts.push(connId);
  // Auth-plugin-data part 1 (8 bytes)
  parts.push(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  // Filler
  parts.push(Buffer.from([0x00]));

  // Capability flags - lower 16 bits
  //   CLIENT_CONNECT_WITH_DB(8) | CLIENT_PROTOCOL_41(512)
  //   | CLIENT_SECURE_CONNECTION(32768)
  //   NOTE: NO CLIENT_MULTI_STATEMENTS — Manticore doesn't advertise it
  const capsLower = 8 | 512 | 32768;
  const cl = Buffer.alloc(2);
  cl.writeUInt16LE(capsLower);
  parts.push(cl);

  // Character set (utf8mb4_general_ci = 45)
  parts.push(Buffer.from([45]));
  // Status flags (SERVER_STATUS_AUTOCOMMIT = 0x0002)
  const sf = Buffer.alloc(2);
  sf.writeUInt16LE(0x0002);
  parts.push(sf);

  // Capability flags - upper 16 bits
  //   CLIENT_MULTI_RESULTS(0x20000>>16=2) | CLIENT_PLUGIN_AUTH(0x80000>>16=8)
  //   | CLIENT_CONNECT_ATTRS(0x100000>>16=16)
  //   | optionally CLIENT_DEPRECATE_EOF(0x1000000>>16=256)
  const capsUpper = 2 | 8 | 16 | (opts.deprecateEof ? 256 : 0);
  const cu = Buffer.alloc(2);
  cu.writeUInt16LE(capsUpper);
  parts.push(cu);

  // Auth-plugin-data length
  parts.push(Buffer.from([21]));
  // Reserved (10 zero bytes)
  parts.push(Buffer.alloc(10));
  // Auth-plugin-data part 2 (13 bytes incl. trailing NUL)
  parts.push(Buffer.from([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 0]));
  // Auth plugin name (null-terminated)
  parts.push(Buffer.from("mysql_native_password\0"));

  return Buffer.concat(parts);
}

/** Build an OK packet with a configurable header byte (0x00 auth OK, 0xFE EOF-OK). */
function buildOK(seqId: number, statusFlags = 0x0002, header = 0x00, info = ""): Buffer {
  const sf = Buffer.alloc(2);
  sf.writeUInt16LE(statusFlags);
  const infoBuf = Buffer.from(info);
  return makePacket(
    seqId,
    Buffer.concat([
      Buffer.from([header]),
      Buffer.from([0x00]), // affected_rows = 0
      Buffer.from([0x00]), // last_insert_id = 0
      sf, // status_flags
      Buffer.from([0x00, 0x00]), // warnings = 0
      infoBuf, // trailing human-readable info string (like Manticore's szMeta)
    ]),
  );
}

/** Build a legacy EOF packet (0xFE header, 5-byte payload). */
function buildEOF(seqId: number, statusFlags = 0x0002): Buffer {
  const payload = Buffer.alloc(5);
  payload[0] = 0xfe;
  payload.writeUInt16LE(0, 1); // warnings
  payload.writeUInt16LE(statusFlags, 3);
  return makePacket(seqId, payload);
}

/**
 * Build a terminator packet appropriate for the server's EOF mode.
 *
 * - Legacy EOF mode: sends `0xFE + warnings + status` (5 bytes total).
 * - Modern mode: sends an "OK" packet with a 0xFE header carrying
 *   affected_rows/last_insert_id/status/warnings, optionally followed by
 *   a human-readable `info` string (e.g. Manticore's `szMeta`).
 */
function buildTerminator(seqId: number, deprecateEof: boolean, statusFlags = 0x0002, info = ""): Buffer {
  return deprecateEof ? buildOK(seqId, statusFlags, 0xfe, info) : buildEOF(seqId, statusFlags);
}

/** Build a ColumnDefinition41 packet. */
function buildColumnDef(seqId: number, name: string, colType = 0xfd /* VARCHAR */): Buffer {
  const parts: Buffer[] = [];
  parts.push(lenEncStr("def")); // catalog
  parts.push(lenEncStr("test")); // schema
  parts.push(lenEncStr("demo")); // table
  parts.push(lenEncStr("demo")); // org_table
  parts.push(lenEncStr(name)); // name
  parts.push(lenEncStr(name)); // org_name
  parts.push(Buffer.from([0x0c])); // length of fixed-length fields
  parts.push(Buffer.from([45, 0x00])); // character_set (utf8mb4)
  const colLen = Buffer.alloc(4);
  colLen.writeUInt32LE(256);
  parts.push(colLen); // column_length
  parts.push(Buffer.from([colType])); // column_type
  parts.push(Buffer.from([0x00, 0x00])); // flags
  parts.push(Buffer.from([0x00])); // decimals
  parts.push(Buffer.from([0x00, 0x00])); // filler
  return makePacket(seqId, Buffer.concat(parts));
}

/** Build a text-protocol row packet (each column is a length-encoded string). */
function buildRow(seqId: number, values: string[]): Buffer {
  return makePacket(seqId, Buffer.concat(values.map(lenEncStr)));
}

// --- Test ---

const SERVER_STATUS_AUTOCOMMIT = 0x0002;
const SERVER_MORE_RESULTS_EXISTS = 0x0008;

/**
 * Mock MySQL server that replies to COM_QUERY with two result sets:
 * `SELECT id FROM products` followed by `SHOW META`. The first result
 * set carries `SERVER_MORE_RESULTS_EXISTS` on its terminator; the second
 * does not. When `info` is non-empty, the terminator OK packet trails a
 * human-readable info string — what Manticore calls `szMeta` — which
 * pushes the payload length past the 9-byte disambiguation threshold.
 */
function createManticoreMock(opts: { deprecateEof: boolean; info?: string }) {
  const info = opts.info ?? "";
  return net.createServer(socket => {
    // Immediately send HandshakeV10
    socket.write(makePacket(0, buildHandshake(opts)));

    let state: "waiting_auth" | "ready" = "waiting_auth";
    let buf = Buffer.alloc(0);

    socket.on("data", data => {
      buf = Buffer.concat([buf, data]);

      // Process complete packets
      while (buf.length >= 4) {
        const pktLen = buf[0]! | (buf[1]! << 8) | (buf[2]! << 16);
        const totalLen = pktLen + 4;
        if (buf.length < totalLen) break;

        const pktSeqId = buf[3]!;
        const payload = buf.subarray(4, totalLen);
        buf = buf.subarray(totalLen);

        if (state === "waiting_auth") {
          // Received HandshakeResponse41 → send OK
          socket.write(buildOK(pktSeqId + 1));
          state = "ready";
        } else if (state === "ready") {
          const cmd = payload[0];
          if (cmd === 0x03) {
            // COM_QUERY → send TWO result sets.
            // First carries SERVER_MORE_RESULTS_EXISTS; second does not.
            let seq = pktSeqId + 1;

            // --- First result set: SELECT id FROM products ---
            // ResultSetHeader: 1 column
            socket.write(makePacket(seq++, Buffer.from([0x01])));
            socket.write(buildColumnDef(seq++, "id"));
            // Legacy-mode-only: intermediate EOF between column defs and rows.
            if (!opts.deprecateEof) {
              socket.write(buildEOF(seq++, SERVER_STATUS_AUTOCOMMIT));
            }
            // Row data
            socket.write(buildRow(seq++, ["1"]));
            socket.write(buildRow(seq++, ["2"]));
            // End-of-result terminator with MORE_RESULTS flag: tells the
            // client a second result set is coming on the same COM_QUERY.
            socket.write(
              buildTerminator(seq++, opts.deprecateEof, SERVER_STATUS_AUTOCOMMIT | SERVER_MORE_RESULTS_EXISTS, info),
            );

            // --- Second result set: SHOW META ---
            // ResultSetHeader: 2 columns
            socket.write(makePacket(seq++, Buffer.from([0x02])));
            socket.write(buildColumnDef(seq++, "Variable_name"));
            socket.write(buildColumnDef(seq++, "Value"));
            if (!opts.deprecateEof) {
              socket.write(buildEOF(seq++, SERVER_STATUS_AUTOCOMMIT));
            }
            // Row data
            socket.write(buildRow(seq++, ["total", "1"]));
            socket.write(buildRow(seq++, ["time", "0.001"]));
            // Final terminator: no MORE_RESULTS flag → end of command.
            socket.write(buildTerminator(seq++, opts.deprecateEof, SERVER_STATUS_AUTOCOMMIT, info));
          } else if (cmd === 0x01) {
            // COM_QUIT
            socket.end();
          }
        }
      }
    });
  });
}

async function runMultiStatement(port: number) {
  await using db = new SQL({
    adapter: "mysql",
    hostname: "127.0.0.1",
    port,
    username: "root",
    password: "",
    database: "test",
    max: 1,
    idleTimeout: 1,
  });

  // The key assertion: this must *resolve*. Before the fix, the adapter
  // hung forever on the second result set.
  const results: any = await db.unsafe("SELECT id FROM products; SHOW META");

  // Simple multi-statement queries come back as an array of result arrays.
  expect(Array.isArray(results)).toBe(true);
  expect(results.length).toBe(2);

  const [rows, meta] = results;
  expect(rows).toEqual([{ id: "1" }, { id: "2" }]);
  expect(meta).toEqual([
    { Variable_name: "total", Value: "1" },
    { Variable_name: "time", Value: "0.001" },
  ]);
}

test("MySQL modern (DEPRECATE_EOF) multi-statement result sets", async () => {
  const server = createManticoreMock({ deprecateEof: true });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await runMultiStatement(port);
  } finally {
    server.close();
  }
});

test("MySQL legacy-EOF multi-statement result sets", async () => {
  const server = createManticoreMock({ deprecateEof: false });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await runMultiStatement(port);
  } finally {
    server.close();
  }
});

test("MySQL DEPRECATE_EOF terminator with trailing info string (Manticore szMeta)", async () => {
  // When an OK terminator's payload is >= 9 bytes the legacy-EOF branch
  // added in #28005 skips its `header_length < 9` guard — this models
  // Manticore appending metadata to the terminator (`szMeta`) and was the
  // shape that regressed in 1.3.12.
  const server = createManticoreMock({ deprecateEof: true, info: "Rows_matched: 2; time: 0.001" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    await runMultiStatement(port);
  } finally {
    server.close();
  }
});
