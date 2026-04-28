// Regression test: MySQLConnection.handlePreparedStatement stored an ErrorPacket whose
// error_message was a Data{ .temporary = ... } slice pointing into the socket read buffer.
// The statement is cached in the connection's statements map with status = .failed, so
// re-running the same failing query would read the stale slice after subsequent packets
// overwrote the buffer.
//
// Uses a minimal mock MySQL server so it can run without Docker.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { once } from "events";
import net from "net";

function u16le(n: number) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}
function u24le(n: number) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}
function u32le(n: number) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}
function packet(seq: number, payload: Buffer) {
  return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]);
}

// Server capability flags (subset sufficient for the prepared-statement path).
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
  const authData2 = Buffer.alloc(13, 0x62); // includes trailing NUL as part of 13 bytes
  authData2[12] = 0;
  const payload = Buffer.concat([
    Buffer.from([10]), // protocol version
    Buffer.from("mock-5.7.0\0"), // server version NUL-terminated
    u32le(1), // connection id
    authData1, // auth-plugin-data-part-1 (8)
    Buffer.from([0]), // filler
    u16le(SERVER_CAPS & 0xffff), // capability flags lower
    Buffer.from([0x2d]), // character set (utf8mb4_general_ci)
    u16le(0x0002), // status flags (SERVER_STATUS_AUTOCOMMIT)
    u16le((SERVER_CAPS >>> 16) & 0xffff), // capability flags upper
    Buffer.from([21]), // length of auth-plugin-data
    Buffer.alloc(10, 0), // reserved
    authData2, // auth-plugin-data-part-2 (13 bytes)
    Buffer.from("mysql_native_password\0"),
  ]);
  return packet(0, payload);
}

function okPacket(seq: number) {
  // header, affected_rows (lenenc 0), last_insert_id (lenenc 0), status flags, warnings
  return packet(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

function errorPacket(seq: number, errno: number, message: string) {
  const payload = Buffer.concat([Buffer.from([0xff]), u16le(errno), Buffer.from("#42000"), Buffer.from(message)]);
  return packet(seq, payload);
}

const COM_STMT_PREPARE = 0x16;

// Long enough to exceed the 15-byte inline storage so the message is heap-backed.
const ORIGINAL_MSG = "ORIGINAL syntax error: this message must survive across later packets ".padEnd(200, "A");
const OVERWRITE_MSG = "".padEnd(ORIGINAL_MSG.length, "Z");

test("MySQL: cached failed prepared statement error_message is not a dangling slice", async () => {
  let prepareCount = 0;

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
          // HandshakeResponse41 from client → accept unconditionally.
          authed = true;
          socket.write(okPacket(seq + 1));
          continue;
        }

        const cmd = payload[0];
        if (cmd === COM_STMT_PREPARE) {
          // First prepare gets the real error; all others get a buffer-overwriting
          // error of the same length filled with a different byte.
          const msg = prepareCount === 0 ? ORIGINAL_MSG : OVERWRITE_MSG;
          prepareCount++;
          socket.write(errorPacket(seq + 1, 1064, msg));
        } else {
          // COM_QUIT or anything else → close.
          socket.end();
        }
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // First failing query → statement cached as .failed with error_message.
    const err1 = await sql`wat ${1}`.catch((x: any) => x);
    expect(err1.code).toBe("ERR_MYSQL_SYNTAX_ERROR");
    expect(err1.errno).toBe(1064);
    expect(err1.message).toBe(ORIGINAL_MSG);

    // Different failing query → server sends a different ERROR packet that overwrites
    // the connection read buffer where err1's message slice used to point.
    const errOverwrite = await sql`other ${1}`.catch((x: any) => x);
    expect(errOverwrite.message).toBe(OVERWRITE_MSG);

    // Same as the first failing query → hits the cached .failed statement and calls
    // stmt.error_response.toJS(). Before the fix this read the overwritten buffer and
    // returned OVERWRITE_MSG (ZZZ...); after the fix it returns the original message.
    const err2 = await sql`wat ${1}`.catch((x: any) => x);
    expect({
      code: err2.code,
      errno: err2.errno,
      sqlState: err2.sqlState,
      message: err2.message,
    }).toEqual({
      code: err1.code,
      errno: err1.errno,
      sqlState: err1.sqlState,
      message: ORIGINAL_MSG,
    });

    // Only the first two queries should have reached the server; the third hit the cache.
    expect(prepareCount).toBe(2);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
