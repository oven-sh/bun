// Fault-injection fixture: an in-process Postgres extended-protocol wire server
// that answers every Bind/Execute by echoing the bound parameter back as the
// sole DataRow column. The client pipelines bursts of queries whose single
// text parameter is large enough (~16 KB each) that one burst's serialized
// Bind/Execute groups exceed the connection's write-buffer pipelining cap,
// leaving at least one queued request un-serialized while later queries are
// accepted.
//
// Correct behavior: every query's promise resolves with the exact parameter
// value it sent. If the client ever serializes a later-accepted query before
// an earlier un-serialized one, the server (which answers strictly in wire
// order) returns the later query's value to the earlier query's promise.
//
// A healthy Postgres produces exactly this response sequence; the mock exists
// only so the ordering the client emitted is observable end to end, and so the
// test does not need a container. All wire-protocol bytes come from
// ./wire-frames.

import { SQL } from "bun";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgInt32,
  pgRaw,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// --- mock server -----------------------------------------------------------

// Read the single text-format parameter value out of a Bind ('B') message body
// (body = bytes after the Byte1 type + Int32 length header).
// Layout: portal\0 statement\0 Int16 nFmt Int16[nFmt] Int16 nVals (Int32 len Byte[len])...
function bindParamValue(body: Buffer): Buffer {
  let o = body.indexOf(0) + 1; // skip portal name
  o = body.indexOf(0, o) + 1; // skip statement name
  const nFmt = body.readInt16BE(o);
  o += 2 + 2 * nFmt; // skip format codes
  o += 2; // skip nVals (always 1 here)
  const len = body.readInt32BE(o);
  o += 4;
  return body.subarray(o, o + len);
}

// ParameterDescription: Byte1('t') Int32(len) Int16(nparams) Int32[nparams](type oids)
const parameterDescription = pgRaw("t", Buffer.concat([Buffer.from([0, 1]), pgInt32(25)])); // 1 param, oid 25 (text)
const rowDescription = pgRowDescription([{ name: "v", typeOid: 25, format: 0 }]);
const parseComplete = pgRaw("1", Buffer.alloc(0));
const bindComplete = pgRaw("2", Buffer.alloc(0));

const bindWireOrder: string[] = [];

const { server, port } = await listeningServer(socket => {
  let buffered = Buffer.alloc(0);
  let sawStartup = false;
  // Pending responses for the current Sync group, flushed on 'S'.
  let pending: Buffer[] = [];
  socket.on("data", chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    // The StartupMessage has no Byte1 type tag; handle it once, before framing.
    if (!sawStartup) {
      if (buffered.length < 4) return;
      const len = buffered.readInt32BE(0);
      if (buffered.length < len) return;
      buffered = buffered.subarray(len);
      sawStartup = true;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    }
    // Every subsequent frontend message is Byte1(type) Int32(len) body[len-4].
    while (buffered.length >= 5) {
      const type = buffered[0];
      const len = buffered.readInt32BE(1);
      if (buffered.length < 1 + len) return;
      const body = buffered.subarray(5, 1 + len);
      buffered = buffered.subarray(1 + len);
      switch (type) {
        case 0x50 /* 'P' Parse */:
          pending.push(parseComplete);
          break;
        case 0x44 /* 'D' Describe */:
          pending.push(parameterDescription, rowDescription);
          break;
        case 0x42 /* 'B' Bind */: {
          const v = bindParamValue(body);
          bindWireOrder.push(v.subarray(0, v.indexOf(0x21 /* '!' */)).toString());
          pending.push(bindComplete, pgDataRow([Buffer.from(v)]), pgCommandComplete("SELECT 1"));
          break;
        }
        case 0x45 /* 'E' Execute */:
        case 0x48 /* 'H' Flush */:
          break;
        case 0x53 /* 'S' Sync */:
          pending.push(pgReadyForQuery());
          socket.write(Buffer.concat(pending));
          pending = [];
          break;
        case 0x58 /* 'X' Terminate */:
          socket.end();
          return;
        default:
          console.log(`SERVER_UNKNOWN_MSG 0x${type.toString(16)}`);
          process.exit(98);
      }
    }
  });
  socket.on("error", () => {});
});

// --- client ----------------------------------------------------------------

const sql = new SQL({
  adapter: "postgres",
  hostname: "127.0.0.1",
  port,
  username: "u",
  password: "pw",
  database: "db",
  tls: false,
  max: 1,
  prepare: true,
  connectionTimeout: 20,
  idleTimeout: 20,
});

const EPAD = Number(process.env.EPAD ?? 16000);
const pad = Buffer.alloc(EPAD, 0x7e /* '~' */).toString();
const issued: string[] = [];
const promises: Promise<void>[] = [];
let wrong = 0;

function q(tag: string) {
  const p = `${tag}!` + pad;
  issued.push(tag);
  promises.push(
    sql`SELECT ${p} AS v`.then(
      rows => {
        if (rows.length !== 1 || rows[0].v !== p) {
          const gotTag = String(rows[0]?.v ?? "").split("!")[0];
          console.log(`WRONG_RESULT ${tag} got=${gotTag} rows=${rows.length}`);
          wrong++;
        }
      },
      err => {
        console.log(`REJECTED ${tag} ${err?.code ?? err?.message}`);
        wrong++;
      },
    ),
  );
}

let seq = 0;
for (let round = 0; round < 8; round++) {
  for (let j = 0; j < 6; j++) q(`ax${seq++}`);
  await Bun.sleep(1);
  q(`ax${seq++}`);
  await Bun.sleep(2);
}

await Promise.all(promises);
await sql.close().catch(() => {});
await new Promise<void>(r => server.close(() => r()));

if (wrong > 0) {
  console.log(`BIND_WIRE_ORDER ${bindWireOrder.join(",")}`);
  console.log(`ISSUED_ORDER    ${issued.join(",")}`);
  process.exit(70);
}
console.log(`OK issued=${issued.length} settled=${promises.length} pad=${EPAD}`);
