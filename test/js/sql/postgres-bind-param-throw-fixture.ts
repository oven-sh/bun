// Mock Postgres server that frames every frontend message by its declared
// length, the same way a real server does. A parameter conversion that throws
// (valueOf / toString / toJSON / Proxy trap) must not leave a partially written
// Bind message in the connection's write buffer: the Bind header and any
// preceding parameters would already be buffered with a length field of 0 (the
// length is backfilled last), which makes the stream unframeable and desyncs
// every subsequent query on the connection.

import net from "node:net";
import {
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// (type, declared body length) of every frontend frame after startup, in
// arrival order. A half-written Bind shows up as "B:0".
const frames: string[] = [];
let partial = false;
let bindsServed = 0;
let firstBindParam0: number | undefined;
let lastBindParam0: number | undefined;

function firstInt4Param(body: Buffer): number {
  let o = body.indexOf(0) + 1; // skip portal name
  o = body.indexOf(0, o) + 1; // skip statement name
  const nFmt = body.readInt16BE(o);
  o += 2 + 2 * nFmt; // skip format codes
  o += 2; // nParams
  o += 4; // param 0 byte length (== 4 for int4 binary)
  return body.readInt32BE(o);
}

const server = net.createServer(socket => {
  socket.on("error", () => {});
  let pending = Buffer.alloc(0);
  let sawStartup = false;
  socket.on("data", chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (!sawStartup) {
      if (pending.length < 4) return;
      const len = pending.readInt32BE(0);
      if (pending.length < len) return;
      pending = pending.subarray(len);
      sawStartup = true;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    }
    // Frame using the client-declared length. A length below 4 is unframeable;
    // a real server drops the connection. Record it and reply with a FATAL
    // protocol error so the client's pending query settles instead of hanging.
    while (pending.length >= 5) {
      const len = pending.readInt32BE(1);
      if (len < 4) {
        partial = true;
        frames.push(`${String.fromCharCode(pending[0])}:${len}`);
        socket.write(pgErrorResponse({ S: "FATAL", C: "08P01", M: "invalid frontend message length" }));
        socket.end();
        pending = Buffer.alloc(0);
        return;
      }
      if (pending.length < 1 + len) break;
      const type = pending[0];
      const body = pending.subarray(5, 1 + len);
      pending = pending.subarray(1 + len);
      frames.push(`${String.fromCharCode(type)}:${body.length}`);
      if (type === 0x50 /* 'P' Parse */) {
        socket.write(
          Buffer.concat([
            pgParseComplete(),
            pgParameterDescription([23, 23]), // int4, int4
            pgRowDescription([{ name: "v", typeOid: 25 }]),
            pgReadyForQuery(),
          ]),
        );
      } else if (type === 0x42 /* 'B' Bind */) {
        bindsServed++;
        const p0 = firstInt4Param(body);
        firstBindParam0 ??= p0;
        lastBindParam0 = p0;
        socket.write(
          Buffer.concat([
            pgBindComplete(),
            pgDataRow([Buffer.from(String(p0))]),
            pgCommandComplete("SELECT 1"),
            pgReadyForQuery(),
          ]),
        );
      }
    }
  });
});

await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const port = (server.address() as net.AddressInfo).port;

const sql = new Bun.SQL({
  adapter: "postgres",
  hostname: "127.0.0.1",
  port,
  username: "u",
  password: "",
  database: "db",
  tls: false,
  max: 1,
  prepare: true,
  connectionTimeout: 20,
});

// Warm-up so the two-int4 statement is Prepared and the follow-up query after
// the throwing bind hits the fast path on the same connection.
const warm = await sql`SELECT ${1}::int AS v, ${2}::int AS w`;

// Param 1's valueOf throws during int4 coercion, after the Bind header and
// param 0 have already been appended to the write buffer.
let thrown: unknown;
const boom = {
  valueOf() {
    throw new Error("boom-valueOf");
  },
  toString() {
    throw new Error("boom-toString");
  },
};
await sql`SELECT ${7}::int AS v, ${boom}::int AS w`.then(
  () => {},
  e => (thrown = e),
);

// The connection must still be usable. Poll on server-observed frames so a
// wedged connection surfaces as a reported failure rather than a hang.
let after: any;
let afterErr: unknown;
let afterSettled = false;
sql`SELECT ${9}::int AS v, ${10}::int AS w`.then(
  r => ((after = r), (afterSettled = true)),
  e => ((afterErr = e), (afterSettled = true)),
);
const tick = () => new Promise<void>(r => setImmediate(r));
for (let t = 0; t < 5000 && !afterSettled; t++) await tick();

await sql.close({ timeout: 0 }).catch(() => {});
server.close();

const result = {
  warm: warm[0]?.v,
  thrown: thrown instanceof Error ? thrown.message : String(thrown),
  after: !afterSettled ? "hung" : afterErr ? `rejected: ${(afterErr as any)?.code ?? afterErr}` : after?.[0]?.v,
  partial,
  bindsServed,
  binds: [firstBindParam0, lastBindParam0],
  frames: frames.join(" "),
};
const ok =
  result.thrown.includes("boom") &&
  result.after === "9" &&
  !result.partial &&
  result.bindsServed === 2 &&
  result.binds[0] === 1 &&
  result.binds[1] === 9;
(ok ? console.log : console.error)((ok ? "ok " : "fail ") + JSON.stringify(result));
process.exit(ok ? 0 : 1);
