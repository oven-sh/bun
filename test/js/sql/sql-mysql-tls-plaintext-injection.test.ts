// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { SQL } from "bun";
import { expect, mock, test } from "bun:test";
import {
  listeningServer,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlHandshakeV10,
  mysqlOkPacket,
} from "./wire-frames";

test("MySQL TLS handshake rejects plaintext packets buffered behind the server greeting", async () => {
  // A man-in-the-middle can append forged packets (e.g. an OK packet that marks
  // the connection as authenticated) to the same TCP segment as the server
  // greeting. Once the handshake negotiates TLS, everything after the greeting
  // must arrive over the encrypted channel; bytes already buffered in plaintext
  // must not be fed to the auth/command handlers.
  const greeting = mysqlHandshakeV10({
    serverVersion: "mock-8.0.0",
    authPlugin: "caching_sha2_password",
    capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL,
  });
  // A forged OK packet. If the client keeps consuming the plaintext buffer
  // after deciding to upgrade to TLS, this marks the connection as
  // authenticated without any certificate ever being validated.
  const forgedOk = mysqlOkPacket(2);

  const { port, server } = await listeningServer(socket => {
    // Greeting and the injected packet arrive in a single segment, before the
    // client has sent a byte.
    socket.write(Buffer.concat([greeting, forgedOk]));
    // Whatever the client sends next (SSLRequest, TLS ClientHello, auth
    // response), close so a misbehaving client cannot hang waiting for more.
    socket.on("data", () => socket.end());
    socket.on("error", () => {});
  });

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
