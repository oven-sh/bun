// The MySQL helper normalizer appends " SET " after an update helper unless the
// query already ends with ON DUPLICATE KEY UPDATE. SQL keywords are
// case-insensitive and separated by arbitrary whitespace, so the suffix check
// must accept any spelling; a lowercase one used to produce
// "... on duplicate key update SET `age` = ?", which is invalid.
// https://github.com/oven-sh/bun/issues/32035
//
// Uses a minimal mock MySQL server that captures the text of every
// COM_STMT_PREPARE and replies with an error packet, so the test can assert
// the exact generated SQL without Docker.

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

const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;

test("upsert helper omits SET for every spelling of ON DUPLICATE KEY UPDATE", async () => {
  const prepared: string[] = [];

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
          // Capture the normalized query text, then fail the statement; the
          // assertion below is on the generated SQL, not on execution.
          prepared.push(payload.subarray(1).toString("utf-8"));
          socket.write(errorPacket(seq + 1, 1064, "mock: rejecting every prepare"));
        } else if (cmd === COM_QUERY) {
          socket.write(okPacket(seq + 1));
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

    const row = { id: 1, age: 30 };
    const update = { age: 31 };

    // Same upsert with four spellings of the clause (case and whitespace are
    // both flexible in SQL); each must reach the server (errno 1064 proves the
    // round-trip happened).
    const errUpper = await sql`INSERT INTO users ${sql(row)} ON DUPLICATE KEY UPDATE ${sql(update)}`.catch(
      (e: any) => e,
    );
    expect(errUpper?.errno).toBe(1064);

    const errLower = await sql`INSERT INTO users ${sql(row)} on duplicate key update ${sql(update)}`.catch(
      (e: any) => e,
    );
    expect(errLower?.errno).toBe(1064);

    const errMixed = await sql`INSERT INTO users ${sql(row)} On Duplicate Key Update ${sql(update)}`.catch(
      (e: any) => e,
    );
    expect(errMixed?.errno).toBe(1064);

    const errWhitespace = await sql`INSERT INTO users ${sql(row)} on\n  Duplicate\tKEY   update ${sql(update)}`.catch(
      (e: any) => e,
    );
    expect(errWhitespace?.errno).toBe(1064);

    // No "SET" after the keyword in any spelling; the update helper's columns
    // follow it directly.
    expect(prepared).toEqual([
      "INSERT INTO users (`id`, `age`) VALUES(?, ?)  ON DUPLICATE KEY UPDATE `age` = ? ",
      "INSERT INTO users (`id`, `age`) VALUES(?, ?)  on duplicate key update `age` = ? ",
      "INSERT INTO users (`id`, `age`) VALUES(?, ?)  On Duplicate Key Update `age` = ? ",
      "INSERT INTO users (`id`, `age`) VALUES(?, ?)  on\n  Duplicate\tKEY   update `age` = ? ",
    ]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
