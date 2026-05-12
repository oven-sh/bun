// Tests that Bun.SQL MySQL adapter works with servers that don't support
// CLIENT_DEPRECATE_EOF (e.g., StarRocks, older MySQL-compatible databases).
// See: https://github.com/oven-sh/bun/issues/28004
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
 * Build a HandshakeV10 payload. The server capabilities deliberately
 * EXCLUDE CLIENT_DEPRECATE_EOF to simulate StarRocks / MySQL-compatible databases.
 */
function buildHandshake(): Buffer {
  const parts: Buffer[] = [];

  // Protocol version
  parts.push(Buffer.from([0x0a]));
  // Server version (null-terminated) - use 8.0.x to catch regressions
  // that might reintroduce version-based assumptions
  parts.push(Buffer.from("8.0.36-mock-no-deprecate-eof\0"));
  // Connection ID (4 bytes LE)
  const connId = Buffer.alloc(4);
  connId.writeUInt32LE(1);
  parts.push(connId);
  // Auth-plugin-data part 1 (8 bytes)
  parts.push(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  // Filler
  parts.push(Buffer.from([0x00]));

  // Capability flags - lower 16 bits
  //   CLIENT_LONG_PASSWORD(1) | CLIENT_FOUND_ROWS(2) | CLIENT_LONG_FLAG(4)
  //   | CLIENT_CONNECT_WITH_DB(8) | CLIENT_PROTOCOL_41(512)
  //   | CLIENT_TRANSACTIONS(8192) | CLIENT_SECURE_CONNECTION(32768)
  const capsLower = 1 | 2 | 4 | 8 | 512 | 8192 | 32768;
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
  //   CLIENT_MULTI_STATEMENTS(0x10000>>16=1) | CLIENT_MULTI_RESULTS(0x20000>>16=2)
  //   | CLIENT_PLUGIN_AUTH(0x80000>>16=8)
  //   NOTE: CLIENT_DEPRECATE_EOF (0x1000000>>16=256) is NOT set
  const capsUpper = 1 | 2 | 8;
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

/** Build an OK packet (0x00 header). */
function buildOK(seqId: number): Buffer {
  return makePacket(
    seqId,
    Buffer.from([
      0x00, // OK header
      0x00, // affected_rows = 0
      0x00, // last_insert_id = 0
      0x02,
      0x00, // status_flags = AUTOCOMMIT
      0x00,
      0x00, // warnings = 0
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

test("MySQL-compatible server without CLIENT_DEPRECATE_EOF returns rows correctly", async () => {
  // Mock MySQL server using legacy EOF protocol
  const server = net.createServer(socket => {
    // Immediately send HandshakeV10
    socket.write(makePacket(0, buildHandshake()));

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
            // COM_QUERY → send result set with legacy EOF protocol:
            //   ResultSetHeader → ColumnDefs → EOF → Rows → EOF
            let seq = pktSeqId + 1;

            // ResultSetHeader: 2 columns
            socket.write(makePacket(seq++, Buffer.from([0x02])));
            // Column definitions
            socket.write(buildColumnDef(seq++, "id"));
            socket.write(buildColumnDef(seq++, "name"));
            // Intermediate EOF (this is the packet that caused issue #28004)
            socket.write(buildEOF(seq++));
            // Row data
            socket.write(buildRow(seq++, ["1", "hello"]));
            socket.write(buildRow(seq++, ["2", "world"]));
            // Final EOF
            socket.write(buildEOF(seq++));
          } else if (cmd === 0x01) {
            // COM_QUIT
            socket.end();
          }
        }
      }
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  try {
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

    const rows = await db.unsafe("SELECT * FROM demo");

    // Before the fix, rows.length was 0 because the intermediate EOF
    // was misinterpreted as end-of-result-set.
    expect(rows.length).toBe(2);
    expect(rows[0].id).toBe("1");
    expect(rows[0].name).toBe("hello");
    expect(rows[1].id).toBe("2");
    expect(rows[1].name).toBe("world");
  } finally {
    server.close();
  }
});
