// Shared wire-protocol frame builders for the SQL fault-injection tests.
// Every Postgres / MySQL protocol message the mock servers emit is built
// here so there is exactly one byte-layout to keep in sync with the spec.
// Fault-injection tests import from this module instead of inlining
// Buffer.alloc / writeInt32BE sequences.

import net from "node:net";

// ---------------------------------------------------------------------------
// Server helpers shared by every fault-injection test.
// ---------------------------------------------------------------------------

/** Start a TCP server on 127.0.0.1 with an ephemeral port. */
export async function listeningServer(
  onSocket: (socket: net.Socket) => void,
): Promise<{ port: number; server: net.Server }> {
  const server = net.createServer(onSocket);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as net.AddressInfo).port, server };
}

/** Reserve and immediately release a port so connecting to it is refused. */
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

/**
 * A server that accepts the TCP connection and then never writes a byte, so the
 * client stays mid-handshake until it gives up or is forced closed. `accepted`
 * resolves once the first connection has been accepted.
 */
export async function neverAnsweringServer(): Promise<{ port: number; server: net.Server; accepted: Promise<void> }> {
  const first = Promise.withResolvers<void>();
  const { port, server } = await listeningServer(socket => {
    socket.unref();
    first.resolve();
  });
  server.unref();
  return { port, server, accepted: first.promise };
}

// ---------------------------------------------------------------------------
// PostgreSQL frontend/backend protocol — https://www.postgresql.org/docs/current/protocol-message-formats.html
// ---------------------------------------------------------------------------

// PostgreSQL FE/BE protocol §55.4: Int16 / Int32 are network-order (big-endian) signed integers; String is NUL-terminated.
export function pgInt32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}
export function pgCString(s: string): Buffer {
  return Buffer.concat([Buffer.from(s, "utf-8"), Buffer.from([0])]);
}

// PostgreSQL FE/BE protocol §55.2.1 SSLRequest: Int32(8) Int32(80877103)
export function pgSSLRequest(): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeInt32BE(8, 0);
  buf.writeInt32BE(80877103, 4); // 0x04d2162f
  return buf;
}

// PostgreSQL FE/BE protocol §55.2.1 SSLRequest response: Byte1('S' = willing, 'N' = unwilling)
export function pgSSLResponse(answer: "S" | "N"): Buffer {
  return Buffer.from(answer, "latin1");
}

// PostgreSQL FE/BE protocol §55.7 AuthenticationOk: Byte1('R') Int32(8) Int32(0)
export function pgAuthenticationOk(): Buffer {
  const buf = Buffer.alloc(9);
  buf.write("R", 0);
  buf.writeInt32BE(8, 1);
  buf.writeInt32BE(0, 5);
  return buf;
}

// PostgreSQL FE/BE protocol §55.7 AuthenticationCleartextPassword: Byte1('R') Int32(8) Int32(3)
export function pgAuthenticationCleartextPassword(): Buffer {
  const buf = Buffer.alloc(9);
  buf.write("R", 0);
  buf.writeInt32BE(8, 1);
  buf.writeInt32BE(3, 5);
  return buf;
}

// PostgreSQL FE/BE protocol §55.7 ReadyForQuery: Byte1('Z') Int32(5) Byte1(status)
export function pgReadyForQuery(status: "I" | "T" | "E" = "I"): Buffer {
  const buf = Buffer.alloc(6);
  buf.write("Z", 0);
  buf.writeInt32BE(5, 1);
  buf.write(status, 5);
  return buf;
}

// PostgreSQL FE/BE protocol §55.7 ErrorResponse: Byte1('E') Int32(len) (Byte1 field-code, String value)* Byte1(0)
export function pgErrorResponse(fields: { S: string; C: string; M: string; [k: string]: string }): Buffer {
  const entries = Object.entries(fields);
  let len = 4; // Int32 length itself
  for (const [, v] of entries) len += 1 + Buffer.byteLength(v) + 1; // code + value + NUL
  len += 1; // terminating NUL
  const buf = Buffer.alloc(1 + len);
  let o = 0;
  buf.write("E", o++);
  buf.writeInt32BE(len, o);
  o += 4;
  for (const [k, v] of entries) {
    buf.write(k, o++);
    o += buf.write(v, o);
    buf[o++] = 0;
  }
  buf[o] = 0;
  return buf;
}

// PostgreSQL FE/BE protocol §55.7 generic backend message: Byte1(type) Int32(len = 4 + body.length) body
// Low-level escape hatch for fault-injection tests that need a deliberately malformed body.
export function pgRaw(type: string, body: Buffer): Buffer {
  const buf = Buffer.alloc(5 + body.length);
  buf.write(type, 0);
  buf.writeInt32BE(body.length + 4, 1);
  body.copy(buf, 5);
  return buf;
}

// PostgreSQL FE/BE protocol §55.7 CommandComplete: Byte1('C') Int32(len) String(tag)
export function pgCommandComplete(tag: string): Buffer {
  return pgRaw("C", Buffer.concat([Buffer.from(tag), Buffer.from([0])]));
}

export type PgRowDescriptionColumn = {
  name: string;
  tableOid?: number;
  columnAttr?: number;
  typeOid: number;
  typeSize?: number;
  typeModifier?: number;
  /** 0 = text, 1 = binary */
  format?: 0 | 1;
};

// PostgreSQL FE/BE protocol §55.7 RowDescription: Byte1('T') Int32(len) Int16(nfields)
//   per field: String(name) Int32(tableOid) Int16(colAttr) Int32(typeOid) Int16(typeSize) Int32(typeMod) Int16(format)
export function pgRowDescription(cols: PgRowDescriptionColumn[]): Buffer {
  const parts: Buffer[] = [Buffer.alloc(2)];
  parts[0].writeInt16BE(cols.length, 0);
  for (const c of cols) {
    const name = Buffer.concat([Buffer.from(c.name), Buffer.from([0])]);
    const meta = Buffer.alloc(18);
    meta.writeInt32BE(c.tableOid ?? 0, 0);
    meta.writeInt16BE(c.columnAttr ?? 0, 4);
    meta.writeInt32BE(c.typeOid, 6);
    meta.writeInt16BE(c.typeSize ?? -1, 10);
    meta.writeInt32BE(c.typeModifier ?? -1, 12);
    meta.writeInt16BE(c.format ?? 0, 16);
    parts.push(name, meta);
  }
  return pgRaw("T", Buffer.concat(parts));
}

// PostgreSQL FE/BE protocol §55.7 DataRow: Byte1('D') Int32(len) Int16(ncols) per col: Int32(byteLen | -1) Byte[len]
export function pgDataRow(cols: (Buffer | null)[]): Buffer {
  const parts: Buffer[] = [Buffer.alloc(2)];
  parts[0].writeInt16BE(cols.length, 0);
  for (const c of cols) {
    const hdr = Buffer.alloc(4);
    if (c === null) {
      hdr.writeInt32BE(-1, 0);
      parts.push(hdr);
    } else {
      hdr.writeInt32BE(c.length, 0);
      parts.push(hdr, c);
    }
  }
  return pgRaw("D", Buffer.concat(parts));
}

/** Minimal Postgres mock: on the startup packet, reply AuthenticationOk + ReadyForQuery. */
export async function pgMinimalReadyServer(): Promise<{ port: number; server: net.Server }> {
  return listeningServer(socket => {
    socket.once("data", () => {
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    });
  });
}

// ---------------------------------------------------------------------------
// MySQL client/server protocol — https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_basic_packets.html
// ---------------------------------------------------------------------------

// Capability flags — page_protocol_basic_capability_flags.html (subset used by the mocks).
export const MYSQL_CLIENT_PROTOCOL_41 = 1 << 9;
export const MYSQL_CLIENT_SSL = 1 << 11;
export const MYSQL_CLIENT_SECURE_CONNECTION = 1 << 15;
export const MYSQL_CLIENT_PLUGIN_AUTH = 1 << 19;
export const MYSQL_CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 1 << 21;
export const MYSQL_CLIENT_DEPRECATE_EOF = 1 << 24;
export const MYSQL_DEFAULT_CAPABILITIES =
  MYSQL_CLIENT_PROTOCOL_41 |
  MYSQL_CLIENT_SECURE_CONNECTION |
  MYSQL_CLIENT_PLUGIN_AUTH |
  MYSQL_CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA |
  MYSQL_CLIENT_DEPRECATE_EOF;

// MySQL packet framing — page_protocol_basic_packets.html: Int<3>(payload_length) Int<1>(sequence_id) payload
export function mysqlRawPacket(seq: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = payload.length & 0xff;
  header[1] = (payload.length >> 8) & 0xff;
  header[2] = (payload.length >> 16) & 0xff;
  header[3] = seq & 0xff;
  return Buffer.concat([header, payload]);
}

// MySQL Protocol::HandshakeV10 — page_protocol_connection_phase_packets_protocol_handshake_v10.html
// Int<1>(10) NulString(server_version) Int<4>(thread_id) String<8>(auth1) Int<1>(0) Int<2>(cap_lo)
// Int<1>(charset) Int<2>(status) Int<2>(cap_hi) Int<1>(auth_len) String<10>(reserved) String<13>(auth2) NulString(plugin)
export function mysqlHandshakeV10(
  opts: { authPlugin?: string; capabilities?: number; serverVersion?: string } = {},
): Buffer {
  const caps = opts.capabilities ?? MYSQL_DEFAULT_CAPABILITIES;
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  const payload = Buffer.concat([
    Buffer.from([10]),
    Buffer.from(`${opts.serverVersion ?? "mock-5.7.0"}\0`),
    Buffer.from([1, 0, 0, 0]), // thread_id
    authData1,
    Buffer.from([0]), // filler
    Buffer.from([caps & 0xff, (caps >> 8) & 0xff]), // capability_flags_1
    Buffer.from([0x2d]), // character_set (utf8mb4_general_ci)
    Buffer.from([0x02, 0x00]), // status_flags (SERVER_STATUS_AUTOCOMMIT)
    Buffer.from([(caps >> 16) & 0xff, (caps >>> 24) & 0xff]), // capability_flags_2
    Buffer.from([21]), // auth_plugin_data_len
    Buffer.alloc(10, 0), // reserved
    authData2,
    Buffer.from(`${opts.authPlugin ?? "mysql_native_password"}\0`),
  ]);
  return mysqlRawPacket(0, payload);
}

// MySQL Protocol::OK_Packet — page_protocol_basic_ok_packet.html: Int<1>(0x00) lenenc(affected_rows) lenenc(last_insert_id) Int<2>(status) Int<2>(warnings)
export function mysqlOkPacket(seq: number): Buffer {
  return mysqlRawPacket(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

// MySQL Protocol::AuthSwitchRequest — page_protocol_connection_phase_packets_protocol_auth_switch_request.html:
//   Int<1>(0xfe) NulString(plugin_name) String<EOF>(plugin_provided_data)
export function mysqlAuthSwitchRequest(seq: number, pluginName: string, pluginData: Buffer): Buffer {
  return mysqlRawPacket(seq, Buffer.concat([Buffer.from([0xfe]), Buffer.from(pluginName + "\0"), pluginData]));
}

// MySQL length-encoded integer — page_protocol_basic_dt_integers.html#sect_protocol_basic_dt_int_le:
//   <0xfb 1B; 0xfc + Int<2>; 0xfd + Int<3>; 0xfe + Int<8>.
export function mysqlLenencInt(n: number | bigint): Buffer {
  const v = typeof n === "bigint" ? n : BigInt(n);
  if (v < 0xfbn) return Buffer.from([Number(v)]);
  if (v < 0x1_0000n) return Buffer.from([0xfc, Number(v) & 0xff, Number(v >> 8n) & 0xff]);
  if (v < 0x1_00_0000n) return Buffer.from([0xfd, Number(v) & 0xff, Number(v >> 8n) & 0xff, Number(v >> 16n) & 0xff]);
  const out = Buffer.alloc(9);
  out[0] = 0xfe;
  out.writeBigUInt64LE(v, 1);
  return out;
}

// MySQL string<lenenc> — page_protocol_basic_dt_strings.html: lenenc-int byte length followed by that many bytes.
export function mysqlLenencStr(s: string | Buffer): Buffer {
  const buf = typeof s === "string" ? Buffer.from(s, "utf-8") : s;
  return Buffer.concat([mysqlLenencInt(buf.length), buf]);
}

// MySQL Protocol::ColumnDefinition41 — page_protocol_com_query_response_text_resultset_column_definition.html:
//   lenenc("def") lenenc(schema) lenenc(table) lenenc(org_table) lenenc(name) lenenc(org_name)
//   lenenc(0x0c) Int<2>(charset) Int<4>(column_length) Int<1>(type) Int<2>(flags) Int<1>(decimals) Int<2>(0x0000)
export function mysqlColumnDefinition(
  seq: number,
  opts: {
    name: string;
    type: number;
    charset?: number;
    flags?: number;
    decimals?: number;
    columnLength?: number;
    schema?: string;
    table?: string;
    orgTable?: string;
    orgName?: string;
  },
): Buffer {
  const fixed = Buffer.alloc(12);
  fixed.writeUInt16LE(opts.charset ?? 33, 0);
  fixed.writeUInt32LE(opts.columnLength ?? 0, 2);
  fixed[6] = opts.type;
  fixed.writeUInt16LE(opts.flags ?? 0, 7);
  fixed[9] = opts.decimals ?? 0;
  // bytes 10-11 reserved zero
  return mysqlRawPacket(
    seq,
    Buffer.concat([
      mysqlLenencStr("def"),
      mysqlLenencStr(opts.schema ?? ""),
      mysqlLenencStr(opts.table ?? ""),
      mysqlLenencStr(opts.orgTable ?? ""),
      mysqlLenencStr(opts.name),
      mysqlLenencStr(opts.orgName ?? ""),
      Buffer.from([0x0c]),
      fixed,
    ]),
  );
}

// MySQL COM_STMT_PREPARE_OK — page_protocol_com_stmt_prepare.html#sect_protocol_com_stmt_prepare_response_ok:
//   Int<1>(0x00) Int<4>(statement_id) Int<2>(num_columns) Int<2>(num_params) Int<1>(0x00) Int<2>(warning_count)
export function mysqlStmtPrepareOk(seq: number, stmtId: number, numColumns: number, numParams: number): Buffer {
  const payload = Buffer.alloc(12);
  payload[0] = 0x00;
  payload.writeUInt32LE(stmtId, 1);
  payload.writeUInt16LE(numColumns, 5);
  payload.writeUInt16LE(numParams, 7);
  payload[9] = 0x00;
  payload.writeUInt16LE(0, 10);
  return mysqlRawPacket(seq, payload);
}

/** Drain complete MySQL packets from `buffered`, calling onPacket(seq, payload) for each; returns the leftover bytes. */
export function mysqlReadPackets(buffered: Buffer, onPacket: (seq: number, payload: Buffer) => void): Buffer {
  while (buffered.length >= 4) {
    const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
    if (buffered.length < 4 + len) break;
    onPacket(buffered[3], buffered.subarray(4, 4 + len));
    buffered = buffered.subarray(4 + len);
  }
  return buffered;
}
