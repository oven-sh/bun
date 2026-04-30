// Regression test: MySQLConnection.handleResultSet frees statement.columns and then
// `try alloc()`s a new slice sized by the server-provided field_count. If that alloc
// fails, statement.columns was left pointing at the freed buffer, and the subsequent
// MySQLStatement.deinit() (reached via JSMySQLConnection.deinit -> MySQLConnection.cleanup
// when the connection is torn down) iterated and freed it again.
//
// We force the alloc to fail by driving a mock MySQL server that reports an absurd
// field_count (lenenc 0xFE + 0xFF*8 = 2^64-1). Under ASAN, builds without the fix abort
// with use-after-poison inside ColumnDefinition41.deinit; with the fix, the error path
// leaves columns = &.{} and the process exits cleanly after rejecting the query.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const fixture = /* js */ `
const net = require("net");
const { SQL } = require("bun");

function u16le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff]); }
function u24le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]); }
function u32le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]); }
function packet(seq, payload) { return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]); }
function lenencStr(s) {
  const b = Buffer.from(s);
  if (b.length >= 251) throw new Error("too long for 1-byte lenenc");
  return Buffer.concat([Buffer.from([b.length]), b]);
}

const CLIENT_PROTOCOL_41 = 1 << 9;
const CLIENT_SECURE_CONNECTION = 1 << 15;
const CLIENT_PLUGIN_AUTH = 1 << 19;
const CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 1 << 21;
const CLIENT_DEPRECATE_EOF = 1 << 24;
const SERVER_CAPS =
  CLIENT_PROTOCOL_41 |
  CLIENT_SECURE_CONNECTION |
  CLIENT_PLUGIN_AUTH |
  CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA |
  CLIENT_DEPRECATE_EOF;

function handshakeV10() {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  const payload = Buffer.concat([
    Buffer.from([10]),
    Buffer.from("mock-5.7.0\\0"),
    u32le(1),
    authData1,
    Buffer.from([0]),
    u16le(SERVER_CAPS & 0xffff),
    Buffer.from([0x2d]),
    u16le(0x0002),
    u16le((SERVER_CAPS >>> 16) & 0xffff),
    Buffer.from([21]),
    Buffer.alloc(10, 0),
    authData2,
    Buffer.from("mysql_native_password\\0"),
  ]);
  return packet(0, payload);
}

function okPacket(seq) {
  return packet(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

// Minimal ColumnDefinition41 packet (used for both params and columns during prepare).
function columnDef(seq, name) {
  const payload = Buffer.concat([
    lenencStr("def"),    // catalog
    lenencStr(""),       // schema
    lenencStr(""),       // table
    lenencStr(""),       // org_table
    lenencStr(name),     // name
    lenencStr(""),       // org_name
    Buffer.from([0x0c]), // length of fixed-length fields
    u16le(0x2d),         // character set
    u32le(0),            // column length
    Buffer.from([0xfd]), // column type (VAR_STRING)
    u16le(0),            // flags
    Buffer.from([0]),    // decimals
    Buffer.from([0, 0]), // filler
  ]);
  return packet(seq, payload);
}

// COM_STMT_PREPARE response: OK header with 1 param, 1 column.
function stmtPrepareOK(seq) {
  const payload = Buffer.concat([
    Buffer.from([0x00]), // status
    u32le(1),            // statement_id
    u16le(1),            // num_columns
    u16le(1),            // num_params
    Buffer.from([0]),    // reserved
    u16le(0),            // warning_count
  ]);
  return packet(seq, payload);
}

// Result-set header claiming 2^64-1 columns via a length-encoded integer with
// a 0xFE prefix. Bun reads this as field_count, sees it differs from the 1
// column cached at prepare time, frees the old slice, and attempts
// alloc(ColumnDefinition41, 2^64-1), which fails with OutOfMemory.
function hugeResultSetHeader(seq) {
  return packet(seq, Buffer.from([0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
}

const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;

const server = net.createServer(socket => {
  let buffered = Buffer.alloc(0);
  let authed = false;
  socket.write(handshakeV10());
  socket.on("data", chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
      if (buffered.length < 4 + len) break;
      const seq = buffered[3];
      const payload = buffered.subarray(4, 4 + len);
      buffered = buffered.subarray(4 + len);

      if (!authed) {
        authed = true;
        socket.write(okPacket(seq + 1));
        continue;
      }

      const cmd = payload[0];
      if (cmd === COM_STMT_PREPARE) {
        socket.write(Buffer.concat([
          stmtPrepareOK(1),
          columnDef(2, "p"), // param definition
          columnDef(3, "c"), // column definition
        ]));
      } else if (cmd === COM_STMT_EXECUTE) {
        socket.write(hugeResultSetHeader(1));
      } else {
        socket.end();
      }
    }
  });
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const sql = new SQL({ url: "mysql://root@127.0.0.1:" + port + "/db", max: 1 });

  const err = await sql\`SELECT \${1}\`.catch(e => e);
  // Force the connection object through full teardown so that
  // JSMySQLConnection.deinit -> MySQLConnection.cleanup runs and derefs the
  // cached prepared statement, triggering MySQLStatement.deinit.
  await sql.close().catch(() => {});
  Bun.gc(true);
  await Bun.sleep(0);
  Bun.gc(true);

  console.log(JSON.stringify({ code: err?.code ?? null, name: err?.name ?? null }));

  server.close(() => process.exit(0));
});
`;

test(
  "MySQL: OOM reallocating statement.columns does not leave a dangling slice",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On the unfixed build the subprocess aborts inside MySQLStatement.deinit
    // before it can print the JSON result line, so stdout is empty. With the
    // fix the query is rejected cleanly and the JSON result line is printed.
    expect({ stderr, stdout: stdout.trim() }).toEqual({
      stderr: expect.not.stringContaining("AddressSanitizer"),
      stdout: expect.stringMatching(/^\{.*\}$/),
    });
    const result = JSON.parse(stdout.trim());
    expect(typeof result.code === "string" || typeof result.name === "string").toBe(true);
    expect(exitCode).toBe(0);
  },
  30_000,
);
