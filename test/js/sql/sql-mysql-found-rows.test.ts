// Bun.SQL MySQL: `foundRows` connection option (CLIENT_FOUND_ROWS capability)
//
// mysql2 and mariadb both enable CLIENT_FOUND_ROWS by default, so an UPDATE
// that matches a row but does not change any value returns `affectedRows: 1`.
// This test asserts that:
//
//   1. The default (no `foundRows` option) sets CLIENT_FOUND_ROWS in the
//      HandshakeResponse41 — matching the mysql2/mariadb defaults so code
//      migrated from those drivers sees the same `affectedRows` values.
//   2. `foundRows: true` sets the bit.
//   3. `foundRows: false` (option form) clears the bit — opt-out for users
//      who want the server's changed-rows semantics.
//   4. `?foundRows=false` on the URL clears the bit (same opt-out via URL).
//   5. The options object wins over the URL query string.
//   6. `affectedRows` on the SQLResultArray reflects the OK_Packet
//      `affected_rows` field the server emits — which is the field
//      CLIENT_FOUND_ROWS changes the server-side semantics of.
//
// Implemented via a mock MySQL server so the test runs without Docker.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import net from "net";

// --- MySQL wire protocol helpers ---

function u16le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}

function u24le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}

function u32le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}

function packet(seq: number, payload: Buffer): Buffer {
  return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]);
}

// Capability flag constants (bit positions in MySQL protocol).
const CLIENT_LONG_PASSWORD = 1 << 0;
const CLIENT_FOUND_ROWS = 1 << 1;
const CLIENT_LONG_FLAG = 1 << 2;
const CLIENT_CONNECT_WITH_DB = 1 << 3;
const CLIENT_PROTOCOL_41 = 1 << 9;
const CLIENT_SECURE_CONNECTION = 1 << 15;
const CLIENT_MULTI_STATEMENTS = 1 << 16;
const CLIENT_MULTI_RESULTS = 1 << 17;
const CLIENT_PLUGIN_AUTH = 1 << 19;
const CLIENT_DEPRECATE_EOF = 1 << 24;

// Advertise everything the client may request, including CLIENT_FOUND_ROWS,
// so the intersect()-at-handshake step keeps whatever the client asked for.
const SERVER_CAPS =
  CLIENT_LONG_PASSWORD |
  CLIENT_FOUND_ROWS |
  CLIENT_LONG_FLAG |
  CLIENT_CONNECT_WITH_DB |
  CLIENT_PROTOCOL_41 |
  CLIENT_SECURE_CONNECTION |
  CLIENT_MULTI_STATEMENTS |
  CLIENT_MULTI_RESULTS |
  CLIENT_PLUGIN_AUTH |
  CLIENT_DEPRECATE_EOF;

function handshakeV10(): Buffer {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0; // trailing NUL
  const payload = Buffer.concat([
    Buffer.from([10]), // protocol version
    Buffer.from("mock-5.7.0\0"), // server version NUL-terminated
    u32le(1), // connection id
    authData1, // auth-plugin-data-part-1 (8)
    Buffer.from([0]), // filler
    u16le(SERVER_CAPS & 0xffff), // capability flags lower
    Buffer.from([0x2d]), // character set utf8mb4_general_ci
    u16le(0x0002), // status flags SERVER_STATUS_AUTOCOMMIT
    u16le((SERVER_CAPS >>> 16) & 0xffff), // capability flags upper
    Buffer.from([21]), // auth-plugin-data length
    Buffer.alloc(10, 0), // reserved
    authData2, // auth-plugin-data-part-2 (13)
    Buffer.from("mysql_native_password\0"),
  ]);
  return packet(0, payload);
}

function okPacket(seq: number, affectedRows: number): Buffer {
  // OK header 0x00, length-encoded affected_rows (fits in 1 byte when < 251),
  // length-encoded last_insert_id = 0, status_flags = AUTOCOMMIT, warnings = 0.
  return packet(
    seq,
    Buffer.from([
      0x00,
      affectedRows & 0xff,
      0x00, // last_insert_id
      0x02,
      0x00, // status_flags (AUTOCOMMIT)
      0x00,
      0x00, // warnings
    ]),
  );
}

interface CapturedHandshake {
  capabilityFlags: number;
}

// Minimal mock MySQL server that completes the handshake, captures the
// client's HandshakeResponse41 capability flags, and replies to a single
// COM_QUERY with an OK_Packet carrying the specified affected_rows value.
// Returns a Promise that resolves to the captured capability flags once the
// client finishes its first query.
function startMockMysql(affectedRows: number): Promise<{
  port: number;
  captured: Promise<CapturedHandshake>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const captured = Promise.withResolvers<CapturedHandshake>();

    const server = net.createServer(socket => {
      let buffered = Buffer.alloc(0);
      let sawHandshakeResponse = false;

      socket.write(handshakeV10());

      socket.on("data", chunk => {
        buffered = Buffer.concat([buffered, chunk]);
        while (buffered.length >= 4) {
          const len = buffered[0]! | (buffered[1]! << 8) | (buffered[2]! << 16);
          if (buffered.length < 4 + len) break;
          const seq = buffered[3]!;
          const payload = buffered.subarray(4, 4 + len);
          buffered = buffered.subarray(4 + len);

          if (!sawHandshakeResponse) {
            // First packet from client after our handshake is the
            // HandshakeResponse41. First 4 bytes of its payload are the
            // client's negotiated capability flags (u32 LE).
            sawHandshakeResponse = true;
            const caps = payload[0]! | (payload[1]! << 8) | (payload[2]! << 16) | (payload[3]! << 24);
            captured.resolve({ capabilityFlags: caps >>> 0 });
            // Complete auth with OK packet so the connection is usable.
            socket.write(okPacket(seq + 1, 0));
          } else {
            const cmd = payload[0];
            if (cmd === 0x03) {
              // COM_QUERY: reply with OK_Packet carrying affectedRows.
              socket.write(okPacket(seq + 1, affectedRows));
            } else if (cmd === 0x01) {
              // COM_QUIT
              socket.end();
            }
          }
        }
      });

      socket.on("error", () => {});
      // Make sure we don't leak the captured waiter if the client drops.
      socket.on("close", () => {
        captured.resolve({ capabilityFlags: 0 });
      });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        captured: captured.promise,
        close: () => server.close(),
      });
    });
  });
}

async function runHandshakeCase(options: Bun.SQL.Options): Promise<number> {
  const mock = await startMockMysql(1);
  try {
    await using db = new SQL({
      ...options,
      adapter: "mysql",
      hostname: "127.0.0.1",
      port: mock.port,
      username: "root",
      password: "",
      database: "test",
      max: 1,
      idleTimeout: 1,
    } as Bun.SQL.Options);

    // Triggering any query forces the handshake to complete.
    await db.unsafe("UPDATE t SET v = 1");
    const { capabilityFlags } = await mock.captured;
    return capabilityFlags;
  } finally {
    mock.close();
  }
}

describe("Bun.SQL MySQL foundRows (CLIENT_FOUND_ROWS)", () => {
  test("default: CLIENT_FOUND_ROWS is enabled (matches mysql2 / mariadb defaults)", async () => {
    const caps = await runHandshakeCase({});
    expect((caps & CLIENT_FOUND_ROWS) !== 0).toBe(true);
  });

  test("foundRows: true enables CLIENT_FOUND_ROWS", async () => {
    const caps = await runHandshakeCase({ foundRows: true } as Bun.SQL.Options);
    expect((caps & CLIENT_FOUND_ROWS) !== 0).toBe(true);
  });

  test("foundRows: false disables CLIENT_FOUND_ROWS", async () => {
    const caps = await runHandshakeCase({ foundRows: false } as Bun.SQL.Options);
    expect((caps & CLIENT_FOUND_ROWS) !== 0).toBe(false);
  });

  test("URL ?foundRows=false disables CLIENT_FOUND_ROWS", async () => {
    const mock = await startMockMysql(1);
    try {
      await using db = new SQL({
        url: `mysql://root:@127.0.0.1:${mock.port}/test?foundRows=false`,
        max: 1,
        idleTimeout: 1,
      });
      await db.unsafe("UPDATE t SET v = 1");
      const { capabilityFlags } = await mock.captured;
      expect((capabilityFlags & CLIENT_FOUND_ROWS) !== 0).toBe(false);
    } finally {
      mock.close();
    }
  });

  test("URL with duplicate foundRows keys doesn't throw", async () => {
    // `URLSearchParams.toJSON()` returns an Array when the same key appears
    // more than once. The option parser coerces through `String()` before
    // normalizing, so a malformed URL like `?foundRows=true&foundRows=false`
    // must not throw "toLowerCase is not a function". Using `false` as the
    // last value turns the coerced "true,false" into a string that is neither
    // "false" nor "0", so the default (enabled) wins.
    const mock = await startMockMysql(1);
    try {
      await using db = new SQL({
        url: `mysql://root:@127.0.0.1:${mock.port}/test?foundRows=true&foundRows=false`,
        max: 1,
        idleTimeout: 1,
      });
      await db.unsafe("UPDATE t SET v = 1");
      const { capabilityFlags } = await mock.captured;
      // "true,false" matches neither "false" nor "0" — stays at the default.
      expect((capabilityFlags & CLIENT_FOUND_ROWS) !== 0).toBe(true);
    } finally {
      mock.close();
    }
  });

  test("options object wins over URL query string", async () => {
    const mock = await startMockMysql(1);
    try {
      await using db = new SQL({
        url: `mysql://root:@127.0.0.1:${mock.port}/test?foundRows=false`,
        foundRows: true,
        max: 1,
        idleTimeout: 1,
      } as Bun.SQL.Options);
      await db.unsafe("UPDATE t SET v = 1");
      const { capabilityFlags } = await mock.captured;
      expect((capabilityFlags & CLIENT_FOUND_ROWS) !== 0).toBe(true);
    } finally {
      mock.close();
    }
  });

  test("affectedRows reflects the server's OK_Packet.affected_rows value", async () => {
    // CLIENT_FOUND_ROWS is what the server uses to pick matched-vs-changed.
    // Bun just forwards whatever count the server reports; to pin down that
    // we are not silently clamping or mis-decoding, the mock returns 1 and we
    // assert the JS-side result carries it.
    const mock = await startMockMysql(1);
    try {
      await using db = new SQL({
        adapter: "mysql",
        hostname: "127.0.0.1",
        port: mock.port,
        username: "root",
        password: "",
        database: "test",
        max: 1,
        idleTimeout: 1,
      });
      const result: any = await db.unsafe("UPDATE t SET v = v WHERE id = 1");
      expect(result.affectedRows).toBe(1);
    } finally {
      mock.close();
    }
  });
});
