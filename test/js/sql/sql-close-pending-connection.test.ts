// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

// https://github.com/oven-sh/bun/issues/32095
//
// A forced pool close (`close({ timeout: "0" })`) must resolve even when a
// pool connection has been accepted at the TCP level but the database
// handshake has not completed yet (a database that is still starting up).
// Previously the pending queries were rejected but the promise returned by
// close() stayed pending forever: the native close path emitted no socket
// event for in-flight connects, so the JS onclose callback never fired.
//
// connectionTimeout: 0 disables the connect timer, so close() is the only
// thing that can tear the connection down — without the fix these tests hang.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import path from "node:path";
import { neverAnsweringServer } from "./wire-frames";

const drivers = [
  ["postgres", "postgres://postgres@", "ERR_POSTGRES_CONNECTION_CLOSED"],
  ["mysql", "mysql://root@", "ERR_MYSQL_CONNECTION_CLOSED"],
] as const;

for (const [name, scheme, closedCode] of drivers) {
  test(`${name}: forced close() resolves while a connection is mid-handshake`, async () => {
    const { port, server, accepted } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const queryError = sql`SELECT 1`.catch(e => e);
      // the server holds the connection open without ever completing the
      // handshake, so the pool connection stays mid-handshake from here on
      await accepted;
      await sql.close({ timeout: "0" });
      expect((await queryError).code).toBe(closedCode);
    } finally {
      server.close();
    }
  });

  test(`${name}: forced close() resolves when called before the native handle is stored`, async () => {
    const { port, server } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const connectError = sql.connect().catch(e => e);
      // close in the same tick: the pool slot exists but its native handle
      // has not been assigned yet
      await sql.close({ timeout: "0" });
      expect((await connectError).code).toBe(closedCode);
    } finally {
      server.close();
    }
  });
}

// https://github.com/oven-sh/bun/issues/32198
//
// The pool's connection array is allocated as `new Array(max)` and filled one
// slot at a time when the pool starts. A function-valued `password` option
// runs synchronously during that fill, so pool methods re-entered from it
// used to dereference unassigned slots and throw a raw TypeError.
test("pool scans tolerate unassigned connection slots during pool start", async () => {
  const { port, server } = await neverAnsweringServer();
  let passwordCalls = 0;
  const errors: unknown[] = [];
  const sql = new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port,
    username: "u",
    database: "d",
    max: 2,
    connectionTimeout: 0,
    password: () => {
      passwordCalls++;
      try {
        sql.flush();
      } catch (e) {
        errors.push(e);
      }
      try {
        sql.connect().catch(() => {});
      } catch (e) {
        errors.push(e);
      }
      return "";
    },
  });
  try {
    sql.connect().catch(() => {});
    // the pool-start fill loop runs synchronously inside connect(), invoking
    // password() once per pool slot
    expect(passwordCalls).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    // force an immediate close even with waiters queued
    await sql.close({ timeout: "0" });
    server.close();
  }
});

// When the client itself gives up on a connection (connection timeout, protocol
// violation, forced close while still connecting, ...) it has to close the
// socket without waiting for the peer. Over TLS the graceful close both drivers
// used to issue from fail() sends a close_notify and keeps the socket open until
// the peer answers it, which a peer that has stopped responding never does: the
// failure was reported, but the socket stayed open and, with it, the process
// stayed alive. The fixture runs both drivers against mocks that complete the
// TLS handshake and then stop responding, and has to exit by itself once each
// client has reported the failure and each mock has seen its connection close.
//
// Test timeout: the fixture is a second debug build doing four TLS handshakes,
// and without the fix it only ends when it runs into the spawn timeout.
test("a TLS connection the client gives up on is closed at once even though the peer stopped responding", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "sql-tls-peer-stopped-responding.fixture.ts")],
    env: { ...bunEnv, MOCK_TLS_KEY: tls.key, MOCK_TLS_CERT: tls.cert },
    stdout: "pipe",
    stderr: "pipe",
    // Without the fix the fixture never exits; this turns that into a failure
    // that shows which lines never got printed.
    timeout: 20_000,
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.trim().split(/\r?\n/).sort(),
    exitCode: proc.exitCode,
    signalCode: proc.signalCode,
    stderr,
  }).toEqual({
    stdout: [
      "mysql close: rejected with ERR_MYSQL_CONNECTION_CLOSED",
      "mysql close: the mock saw the connection close",
      "mysql unexpected: rejected with ERR_MYSQL_UNEXPECTED_PACKET",
      "mysql unexpected: the mock saw the connection close",
      "postgres close: rejected with ERR_POSTGRES_CONNECTION_CLOSED",
      "postgres close: the mock saw the connection close",
      "postgres unexpected: rejected with ERR_POSTGRES_UNEXPECTED_MESSAGE",
      "postgres unexpected: the mock saw the connection close",
    ],
    exitCode: 0,
    signalCode: null,
    // not asserted; included so that whatever the fixture died of shows up
    // in the diff
    stderr: expect.any(String),
  });
}, 30_000);
