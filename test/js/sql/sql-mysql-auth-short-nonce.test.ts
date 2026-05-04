// Regression: mysql_native_password.scramble() sliced nonce[0..8] and
// nonce[8..20] with no length check. A malicious server can send an
// AuthSwitchRequest whose plugin_data is shorter than 20 bytes, which flows
// straight into scramble() as the nonce — OOB read (panic under safety
// checks, silent heap over-read in release). With the fix the client rejects
// with ERR_MYSQL_MISSING_AUTH_DATA before touching the buffer.
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

// Server capability flags (subset sufficient for the auth-switch path).
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

// Advertise caching_sha2_password in the initial handshake so the client
// has to follow the AuthSwitchRequest path to reach
// mysql_native_password.scramble() with the server-controlled plugin_data.
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
    Buffer.from("caching_sha2_password\0"),
  ]);
  return packet(0, payload);
}

// AuthSwitchRequest: 0xfe, plugin_name NUL-terminated, plugin_data (rest of
// packet). Send only 4 bytes of plugin_data — well under the 20 bytes
// scramble() slices.
function authSwitchShortNonce(seq: number) {
  return packet(
    seq,
    Buffer.concat([Buffer.from([0xfe]), Buffer.from("mysql_native_password\0"), Buffer.alloc(4, 0x63)]),
  );
}

test("MySQL: AuthSwitchRequest with a short mysql_native_password nonce is rejected, not OOB-read", async () => {
  let sawAuthSwitchResponse = false;

  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let sentAuthSwitch = false;
    socket.write(handshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
        if (buffered.length < 4 + len) break;
        const seq = buffered[3];
        buffered = buffered.subarray(4 + len);
        if (!sentAuthSwitch) {
          // Reply to HandshakeResponse41 with the short-nonce AuthSwitch.
          sentAuthSwitch = true;
          socket.write(authSwitchShortNonce(seq + 1));
        } else {
          // Pre-fix release builds OOB-read garbage into the scramble and
          // still send an AuthSwitchResponse; reaching here means the
          // length check did not fire. Close so the client does not hang.
          sawAuthSwitchResponse = true;
          socket.end();
        }
      }
    });
    socket.on("error", () => {});
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    // Non-empty password so scramble() proceeds past the empty-password early return.
    await using sql = new SQL({ url: `mysql://root:pw@127.0.0.1:${port}/db`, max: 1 });
    const err = await sql`select 1`.then(
      () => ({ code: "UNEXPECTED_SUCCESS" }),
      e => ({ code: e?.code ?? String(e) }),
    );

    expect({ err, sawAuthSwitchResponse }).toEqual({
      err: { code: "ERR_MYSQL_MISSING_AUTH_DATA" },
      sawAuthSwitchResponse: false,
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
