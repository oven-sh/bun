// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Regression: mysql_native_password.scramble() sliced nonce[0..8] and
// nonce[8..20] with no length check. A malicious server can send an
// AuthSwitchRequest whose plugin_data is shorter than 20 bytes, which flows
// straight into scramble() as the nonce — OOB read (panic under safety
// checks, silent heap over-read in release). With the fix the client rejects
// with ERR_MYSQL_MISSING_AUTH_DATA before touching the buffer.
// caching_sha2_password::scramble() takes the same nonce from the same packet
// and got the same length guard (#26195), so it rejects a short one too.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlAuthSwitchRequest,
  mysqlHandshakeV10,
  mysqlRawPacket,
  mysqlReadPackets,
} from "./wire-frames";

test.concurrent.each([
  { switchTo: "mysql_native_password", greeting: "caching_sha2_password" },
  { switchTo: "caching_sha2_password", greeting: "mysql_native_password" },
] as const)(
  "MySQL: AuthSwitchRequest with a short $switchTo nonce is rejected, not OOB-read",
  async ({ switchTo, greeting: greetingPlugin }) => {
    let sawAuthSwitchResponse = false;

    // Advertise the other plugin in the initial handshake so the client has to
    // follow the AuthSwitchRequest path to reach `switchTo`.scramble() with the
    // server-controlled plugin_data.
    const greeting = mysqlHandshakeV10({ authPlugin: greetingPlugin });

    const { server, port } = await listeningServer(socket => {
      let buffered = Buffer.alloc(0);
      let sentAuthSwitch = false;
      socket.write(greeting);
      socket.on("data", chunk => {
        buffered = Buffer.concat([buffered, chunk]);
        while (buffered.length >= 4) {
          const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
          if (buffered.length < 4 + len) break;
          const seq = buffered[3];
          buffered = buffered.subarray(4 + len);
          if (!sentAuthSwitch) {
            // Reply to HandshakeResponse41 with the short-nonce AuthSwitch: only 4
            // bytes of plugin_data — well under the 20 bytes scramble() slices.
            sentAuthSwitch = true;
            socket.write(mysqlAuthSwitchRequest(seq + 1, switchTo, Buffer.alloc(4, 0x63)));
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
  },
);

test("MySQL: an AuthSwitchRequest frame declaring a zero-length payload is rejected", async () => {
  const greeting = mysqlHandshakeV10();

  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let replied = false;
    socket.write(greeting);
    socket.on("data", chunk => {
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

    expect(err).toEqual({ code: "ERR_MYSQL_INVALID_AUTH_SWITCH_REQUEST" });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
