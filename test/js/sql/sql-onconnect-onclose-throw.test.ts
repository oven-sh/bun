// A user-provided onconnect/onclose callback that throws used to abort the
// pool's connection handler mid-way: the connection state stayed pending,
// storedError was never recorded, pending queries were never notified and
// release() never ran, so anything awaiting the pool (queries, connect(),
// end()) hung forever. The callback exception must not abort the pool
// bookkeeping; it still surfaces as an uncaughtException.
// https://github.com/oven-sh/bun/issues/32037
//
// Uses mock servers / closed ports so the tests run without Docker. Each
// scenario runs in a subprocess because the throwing callback is reported as
// a process-level uncaughtException.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runFixture(code: string) {
  using dir = tempDir("sql-throwing-hooks", { "fixture.ts": code });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Minimal postgres handshake: reply to the startup message with
// AuthenticationOk + ReadyForQuery, then ignore everything else.
const pgMockServer = /* ts */ `
const net = require("net");
function startServer() {
  const server = net.createServer(socket => {
    let handshakeDone = false;
    socket.on("data", () => {
      if (handshakeDone) return;
      handshakeDone = true;
      const authOk = Buffer.alloc(9);
      authOk.write("R", 0);
      authOk.writeInt32BE(8, 1);
      authOk.writeInt32BE(0, 5);
      const ready = Buffer.alloc(6);
      ready.write("Z", 0);
      ready.writeInt32BE(5, 1);
      ready.write("I", 5);
      socket.write(Buffer.concat([authOk, ready]));
    });
    socket.on("error", () => {});
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}
`;

// Minimal mysql handshake: HandshakeV10, then an OK packet for the
// handshake response, then ignore everything else.
const mysqlMockServer = /* ts */ `
const net = require("net");
function u16le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff]); }
function u24le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]); }
function u32le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]); }
function packet(seq, payload) { return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]); }
const SERVER_CAPS = (1 << 9) | (1 << 15) | (1 << 19) | (1 << 21) | (1 << 24);
function handshakeV10() {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  return packet(0, Buffer.concat([
    Buffer.from([10]), Buffer.from("mock-5.7.0\\0"), u32le(1), authData1,
    Buffer.from([0]), u16le(SERVER_CAPS & 0xffff), Buffer.from([0x2d]),
    u16le(0x0002), u16le((SERVER_CAPS >>> 16) & 0xffff), Buffer.from([21]),
    Buffer.alloc(10, 0), authData2, Buffer.from("mysql_native_password\\0"),
  ]));
}
function okPacket(seq) { return packet(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])); }
function startServer() {
  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0), authed = false;
    socket.write(handshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
        if (buffered.length < 4 + len) break;
        const seq = buffered[3];
        buffered = buffered.subarray(4 + len);
        if (!authed) { authed = true; socket.write(okPacket(seq + 1)); }
      }
    });
    socket.on("error", () => {});
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}
`;

// A port with nothing listening on it.
const closedPort = /* ts */ `
const net = require("net");
function closedPort() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
`;

function connectAndEnd(adapter: "postgres" | "mysql", hook: "onconnect" | "onclose") {
  const url = adapter === "postgres" ? "postgres://postgres@127.0.0.1:" : "mysql://root@127.0.0.1:";
  const db = adapter === "postgres" ? "/postgres" : "/db";
  return (
    (adapter === "postgres" ? pgMockServer : mysqlMockServer) +
    /* ts */ `
import { SQL } from "bun";
process.on("uncaughtException", err => console.log("uncaught:", err.message));
const port = await startServer();
const sql = new SQL({
  url: "${url}" + port + "${db}",
  max: 1,
  ${hook}(err) {
    console.log("${hook}:", err === null || err === undefined ? null : err.message);
    throw new Error("boom from ${hook}");
  },
});
await sql.connect();
console.log("connected");
await sql.end();
console.log("ended");
process.exit(0);
`
  );
}

function failToConnect(adapter: "postgres" | "mysql") {
  const url = adapter === "postgres" ? "postgres://postgres@127.0.0.1:" : "mysql://root@127.0.0.1:";
  const db = adapter === "postgres" ? "/postgres" : "/db";
  return (
    closedPort +
    /* ts */ `
import { SQL } from "bun";
process.on("uncaughtException", err => console.log("uncaught:", err.message));
const port = await closedPort();
const sql = new SQL({
  url: "${url}" + port + "${db}",
  max: 1,
  onclose(err) {
    console.log("onclose:", err.code);
    throw new Error("boom from onclose");
  },
});
try {
  await sql.unsafe("SELECT 1");
  console.log("query resolved");
} catch (err) {
  console.log("query rejected:", err.code);
}
process.exit(0);
`
  );
}

test.concurrent("postgres: a throwing onconnect callback does not leave the pool stuck", async () => {
  const { stdout, exitCode } = await runFixture(connectAndEnd("postgres", "onconnect"));
  expect(stdout).toBe("onconnect: null\nuncaught: boom from onconnect\nconnected\nended\n");
  expect(exitCode).toBe(0);
});

test.concurrent("mysql: a throwing onconnect callback does not leave the pool stuck", async () => {
  const { stdout, exitCode } = await runFixture(connectAndEnd("mysql", "onconnect"));
  expect(stdout).toBe("onconnect: null\nuncaught: boom from onconnect\nconnected\nended\n");
  expect(exitCode).toBe(0);
});

test.concurrent("postgres: a throwing onclose callback does not hang sql.end()", async () => {
  const { stdout, exitCode } = await runFixture(connectAndEnd("postgres", "onclose"));
  expect(stdout).toBe("connected\nonclose: Connection closed\nuncaught: boom from onclose\nended\n");
  expect(exitCode).toBe(0);
});

test.concurrent("mysql: a throwing onclose callback does not hang sql.end()", async () => {
  const { stdout, exitCode } = await runFixture(connectAndEnd("mysql", "onclose"));
  expect(stdout).toBe("connected\nonclose: Connection closed\nuncaught: boom from onclose\nended\n");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "postgres: a throwing onclose callback still rejects pending queries when the connection is refused",
  async () => {
    const { stdout, exitCode } = await runFixture(failToConnect("postgres"));
    expect(stdout).toBe(
      "onclose: ERR_POSTGRES_CONNECTION_REFUSED\nuncaught: boom from onclose\nquery rejected: ERR_POSTGRES_CONNECTION_REFUSED\n",
    );
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "mysql: a throwing onclose callback still rejects pending queries when the connection is refused",
  async () => {
    const { stdout, exitCode } = await runFixture(failToConnect("mysql"));
    expect(stdout).toBe(
      "onclose: ERR_MYSQL_CONNECTION_REFUSED\nuncaught: boom from onclose\nquery rejected: ERR_MYSQL_CONNECTION_REFUSED\n",
    );
    expect(exitCode).toBe(0);
  },
);

// When createConnection fails synchronously (here: a password function that
// throws), onclose used to be invoked while the adapter was still filling
// this.connections, so pool methods that scan that array (flush, isConnected,
// close) threw a TypeError on the holes when called from inside the callback.
// The callback is now deferred until the pool is fully constructed.
test.concurrent("postgres: pool calls from onclose are safe when connecting fails synchronously", async () => {
  const fixture = /* ts */ `
import { SQL } from "bun";
process.on("uncaughtException", err => console.log("uncaught:", err.message));
const sql = new SQL({
  adapter: "postgres",
  hostname: "127.0.0.1",
  port: 1, // never dialed: password() throws before the connection is created
  username: "postgres",
  database: "postgres",
  max: 2,
  password: () => {
    throw new Error("password error");
  },
  onclose(err) {
    try {
      sql.flush();
      console.log("reentry ok");
    } catch (err2) {
      console.log("reentry threw:", err2.constructor.name);
    }
  },
});
try {
  await sql.unsafe("SELECT 1");
  console.log("query resolved");
} catch (err) {
  console.log("query rejected:", err.message);
}
process.exit(0);
`;
  const { stdout, exitCode } = await runFixture(fixture);
  expect(stdout).toBe("reentry ok\nreentry ok\nquery rejected: password error\n");
  expect(exitCode).toBe(0);
});
