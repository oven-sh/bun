// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Every plugin works on a nonce of 20 bytes.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlAuthSwitchRequest,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlRawPacket,
  mysqlReadPackets,
} from "./wire-frames";

test.each(
  ["mysql_native_password", "caching_sha2_password", "sha256_password"].flatMap(plugin =>
    [0, 4, 19].map(length => [plugin, length] as const),
  ),
)("MySQL: AuthSwitchRequest to %s with a nonce of %d bytes is rejected", async (plugin, length) => {
  let sawAuthSwitchResponse = false;

  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let sentAuthSwitch = false;
    socket.write(mysqlHandshakeV10({ authPlugin: "caching_sha2_password" }));
    socket.on("data", (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), seq => {
        if (!sentAuthSwitch) {
          sentAuthSwitch = true;
          socket.write(mysqlAuthSwitchRequest(seq + 1, plugin, Buffer.alloc(length, 0x63)));
        } else {
          // Refuse it so the client does not hang.
          sawAuthSwitchResponse = true;
          socket.end(mysqlErrPacket(seq + 1, 1045, "28000", "Access denied"));
        }
      });
    });
    socket.on("error", () => {});
  });

  try {
    await using sql = new SQL({
      url: `mysql://root:pw@127.0.0.1:${port}/db`,
      max: 1,
      allowPublicKeyRetrieval: true,
    });
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

test("MySQL: an AuthSwitchRequest frame declaring a zero-length payload is rejected", async () => {
  const greeting = mysqlHandshakeV10();

  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let replied = false;
    socket.write(greeting);
    socket.on("data", (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), seq => {
        if (!replied) {
          replied = true;
          socket.end(mysqlRawPacket(seq + 1, Buffer.from([0xfe]), 0));
        }
      });
    });
    socket.on("error", () => {});
  });

  try {
    await using sql = new SQL({ url: `mysql://root:pw@127.0.0.1:${port}/db`, max: 1 });
    const err = await sql`select 1`.then(
      () => ({ code: "UNEXPECTED_SUCCESS" }),
      e => ({ code: e?.code ?? String(e) }),
    );

    expect(err).toEqual({ code: "ERR_MYSQL_MALFORMED_PACKET" });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
