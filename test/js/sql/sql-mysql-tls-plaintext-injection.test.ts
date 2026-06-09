// Uses a minimal mock MySQL server so it can run without Docker.

import { SQL } from "bun";
import { expect, mock, test } from "bun:test";
import net from "net";

test("MySQL TLS handshake rejects plaintext packets buffered behind the server greeting", async () => {
  // A man-in-the-middle can append forged packets (e.g. an OK packet that marks
  // the connection as authenticated) to the same TCP segment as the server
  // greeting. Once the handshake negotiates TLS, everything after the greeting
  // must arrive over the encrypted channel; bytes already buffered in plaintext
  // must not be fed to the auth/command handlers.
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

  const CLIENT_PROTOCOL_41 = 1 << 9;
  const CLIENT_SSL = 1 << 11;
  const CLIENT_SECURE_CONNECTION = 1 << 15;
  const CLIENT_PLUGIN_AUTH = 1 << 19;
  const CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 1 << 21;
  const CLIENT_DEPRECATE_EOF = 1 << 24;
  const SERVER_CAPS =
    CLIENT_PROTOCOL_41 |
    CLIENT_SSL |
    CLIENT_SECURE_CONNECTION |
    CLIENT_PLUGIN_AUTH |
    CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA |
    CLIENT_DEPRECATE_EOF;

  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  const greeting = packet(
    0,
    Buffer.concat([
      Buffer.from([10]), // protocol version
      Buffer.from("mock-8.0.0\0"), // server version, NUL-terminated
      u32le(1), // connection id
      authData1, // auth-plugin-data-part-1 (8 bytes)
      Buffer.from([0]), // filler
      u16le(SERVER_CAPS & 0xffff), // capability flags (lower)
      Buffer.from([0x2d]), // character set
      u16le(0x0002), // status flags (SERVER_STATUS_AUTOCOMMIT)
      u16le((SERVER_CAPS >>> 16) & 0xffff), // capability flags (upper)
      Buffer.from([21]), // auth-plugin-data length
      Buffer.alloc(10, 0), // reserved
      authData2, // auth-plugin-data-part-2 (13 bytes)
      Buffer.from("caching_sha2_password\0"),
    ]),
  );
  // A forged OK packet. If the client keeps consuming the plaintext buffer
  // after deciding to upgrade to TLS, this marks the connection as
  // authenticated without any certificate ever being validated.
  const forgedOk = packet(2, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));

  const server = net.createServer(socket => {
    // Greeting and the injected packet arrive in a single segment, before the
    // client has sent a byte.
    socket.write(Buffer.concat([greeting, forgedOk]));
    // Whatever the client sends next (SSLRequest, TLS ClientHello, auth
    // response), close so a misbehaving client cannot hang waiting for more.
    socket.on("data", () => socket.end());
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as import("node:net").AddressInfo;

  const onconnect = mock();
  try {
    await using sql = new SQL({
      url: `mysql://root:pw@127.0.0.1:${port}/db`,
      max: 1,
      tls: { rejectUnauthorized: false },
      onconnect,
    });
    const err = await sql`select 1`.then(
      () => ({ code: "UNEXPECTED_SUCCESS" }),
      e => ({ code: e?.code ?? String(e) }),
    );
    // The connection must never be reported as established off the back of a
    // plaintext packet, and the buffered bytes must be rejected outright.
    expect(onconnect).not.toHaveBeenCalled();
    expect(err).toEqual({ code: "ERR_MYSQL_UNEXPECTED_PACKET" });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
