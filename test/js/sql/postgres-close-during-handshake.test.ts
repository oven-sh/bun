// Regression test for https://github.com/oven-sh/bun/issues/30947
//
// Bun.SQL's pool would be permanently corrupted when all pool connections were
// closed server-side (e.g. by a connection pooler's idle reaper or
// `pg_terminate_backend`) while the event loop was blocked. The underlying
// PostgresSQLConnection queues its on_connect callback as a microtask when the
// server's ReadyForQuery arrives; if the socket is closed in the same I/O tick,
// `handleClose` runs synchronously first and transitions the pooled connection
// to `closed`. The pending `handleConnected` microtask then fires and, without
// the guard in `BasePooledConnection.handleConnected`
// (src/js/internal/sql/shared.ts), unconditionally overwrites state to
// `connected` and re-adds the dead connection (with `this.connection ===
// null`) to `readyConnections`. Subsequent queries dispatch `null` to Rust's
// PostgresSQLQuery.run, which throws "connection must be a
// PostgresSQLConnection" — and the pool never recovers because it thinks the
// ghost entry is still live.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A fake postgres server that sends the full trust-mode handshake response
// (AuthenticationOk + many ParameterStatus messages + BackendKeyData +
// ReadyForQuery + an admin-shutdown ErrorResponse) and immediately closes the
// socket. The ParameterStatus stack matches what a real server sends on
// startup so uSockets' recv delivers the whole handshake plus the FIN in one
// poll dispatch; that is what makes on_close land in the same I/O tick as
// ReadyForQuery and fire `handleClose` before the queued `handleConnected`
// microtask drains.
const FIXTURE = /* js */ `
const net = require("node:net");
const { SQL } = require("bun");

function pkt(type, body) {
  const h = Buffer.alloc(5);
  h.write(type, 0);
  h.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([h, body]);
}
function int32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}
function cstr(s) {
  return Buffer.concat([Buffer.from(s), Buffer.from([0])]);
}
function paramStatus(k, v) {
  return pkt("S", Buffer.concat([cstr(k), cstr(v)]));
}

const handshakeResponse = Buffer.concat([
  pkt("R", int32(0)), // AuthenticationOk
  paramStatus("application_name", ""),
  paramStatus("client_encoding", "UTF8"),
  paramStatus("server_encoding", "UTF8"),
  paramStatus("server_version", "17.0"),
  paramStatus("session_authorization", "test"),
  paramStatus("standard_conforming_strings", "on"),
  paramStatus("TimeZone", "UTC"),
  paramStatus("integer_datetimes", "on"),
  paramStatus("IntervalStyle", "postgres"),
  paramStatus("is_superuser", "off"),
  pkt("K", Buffer.concat([int32(12345), int32(67890)])), // BackendKeyData
  pkt("Z", Buffer.from("I")), // ReadyForQuery
]);
const adminShutdown = pkt("E", Buffer.concat([
  cstr("SERROR"),
  cstr("C57P01"),
  cstr("Mterminating connection due to administrator command"),
  Buffer.from([0]),
]));

const server = net.createServer(socket => {
  let handshook = false;
  socket.setNoDelay(true);
  socket.on("data", () => {
    if (handshook) return;
    handshook = true;
    // Full handshake + admin-shutdown error + FIN — the same close pattern
    // pg_terminate_backend produces.
    socket.write(handshakeResponse);
    socket.write(adminShutdown);
    socket.end();
  });
  socket.on("error", () => {});
});

await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const sql = new SQL({
  url: \`postgres://u@127.0.0.1:\${port}/db\`,
  max: 10,
  connectionTimeout: 2,
});

// A broken pool throws "connection must be a PostgresSQLConnection" on every
// subsequent query once a ghost entry has leaked into readyConnections. A
// healthy pool just keeps seeing "Connection closed" (or the admin-shutdown
// error) because our fake server kicks every connection. A handful of
// iterations is enough to trigger the race reliably; bail out on the first
// occurrence so we don't hang against a corrupted pool.
let corrupted = false;
let iterations = 0;
for (let i = 0; i < 20; i++) {
  iterations = i + 1;
  try {
    await sql\`SELECT 1\`;
  } catch (err) {
    if (/connection must be a PostgresSQLConnection/i.test(err && err.message)) {
      corrupted = true;
      break;
    }
  }
}

console.log(JSON.stringify({ corrupted, iterations }));
// A corrupted pool can refuse to close cleanly (sql.close() spins trying to
// flush ghost entries), so just exit immediately — the subprocess dying is
// the tear-down signal for the fake server.
process.exit(0);
`;

test("pool recovers after every connection is closed mid-handshake", async () => {
  using dir = tempDir("pg-close-mid-handshake", {
    "fixture.js": FIXTURE,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Fixture prints a single JSON line on stdout. `corrupted: true` means the
  // pool produced the internal "connection must be a PostgresSQLConnection"
  // error at least once — always a bug, never expected fallout from the test
  // scenario (the fake server just closes every connection).
  // Fold stderr into the assertion so a fixture crash surfaces in the diff
  // instead of leaving CI with an opaque `corrupted: undefined`.
  const line = stdout.trim().split("\n").at(-1) ?? "";
  const parsed = line ? JSON.parse(line) : {};
  expect({ stderr, corrupted: parsed.corrupted, exitCode }).toEqual({
    stderr: "",
    corrupted: false,
    exitCode: 0,
  });
});
