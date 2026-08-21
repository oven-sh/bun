// Mock postgres server that replies to a named-statement prepare with its four
// backend messages in separate socket writes, so ParameterDescription arrives
// in an earlier on_data() than ReadyForQuery. That is ordinary inbound TCP
// segmentation; the bytes and their order are identical to a coalesced reply.
//
// Queries issued during that gap must not overtake earlier-enqueued queries on
// the wire: responses are attributed by enqueue order (requests.peek_item(0)),
// so a Bind written out of order delivers another query's rows.

import net from "node:net";
import {
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgParameterDescription,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const SPLIT = process.env.SPLIT !== "0";
const tick = () => new Promise<void>(r => setImmediate(r));

// Parse a Bind body far enough to return the first parameter value as text.
function bindFirstParam(body: Buffer): string {
  let o = body.indexOf(0) + 1; // skip portal name
  o = body.indexOf(0, o) + 1; // skip statement name
  const nFmt = body.readInt16BE(o);
  o += 2 + 2 * nFmt;
  o += 2; // nParams
  const len = body.readInt32BE(o);
  o += 4;
  return body.subarray(o, o + len).toString("utf-8");
}

let bindsServed = 0;
const server = net.createServer(socket => {
  socket.on("error", () => {});
  let pending = Buffer.alloc(0);
  let sawStartup = false;
  // Replies go out in the order they were enqueued even though each reply is
  // written message-by-message across event-loop turns.
  let replyChain: Promise<void> = Promise.resolve();
  const reply = (msgs: Buffer[]) => {
    replyChain = replyChain.then(async () => {
      if (!SPLIT) return void socket.write(Buffer.concat(msgs));
      for (const m of msgs) {
        socket.write(m);
        await tick();
        await tick();
      }
    });
  };
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
    pending = pgReadFrontendMessages(pending, (type, body) => {
      if (type === 0x50 /* 'P' Parse */) {
        // Followed by Describe('S') + Sync; reply with the four-message prepare
        // response, one write per message so the client sees them across reads.
        reply([
          pgParseComplete(),
          pgParameterDescription([25]),
          pgRowDescription([{ name: "v", typeOid: 25 }]),
          pgReadyForQuery(),
        ]);
      } else if (type === 0x42 /* 'B' Bind */) {
        const v = bindFirstParam(body);
        // Followed by Execute + Sync; echo the bound parameter back as one row.
        reply([pgBindComplete(), pgDataRow([Buffer.from(v)]), pgCommandComplete("SELECT 1"), pgReadyForQuery()]);
        bindsServed++;
      }
    });
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

// q0 triggers Parse+Describe+Sync; q1..q3 share the statement and sit Pending
// behind it. Then one query per event-loop turn so several land between the
// split ParameterDescription and ReadyForQuery reads.
const expected: string[] = [];
const got: (string | undefined)[] = [];
const settled: boolean[] = [];
const errors: string[] = [];
const issue = (tag: string) => {
  const i = expected.length;
  expected.push(tag);
  got.push(undefined);
  settled.push(false);
  sql`SELECT ${tag} AS v`.then(
    rows => {
      got[i] = rows[0]?.v;
      settled[i] = true;
    },
    err => {
      errors.push(`${tag}: ${err?.message ?? err}`);
      settled[i] = true;
    },
  );
};
for (let i = 0; i < 4; i++) issue(`q${i}`);
for (let i = 4; i < 16; i++) {
  await tick();
  issue(`q${i}`);
}

// Await settlement by condition: the server first has to answer as many Binds
// as were issued, then every query has to have settled. Both polls are bounded
// so the never-settle face surfaces as a reported failure instead of a hang.
for (let t = 0; t < 10000 && bindsServed < expected.length; t++) await tick();
for (let t = 0; t < 10000 && settled.some(s => !s); t++) await tick();

await sql.close({ timeout: 0 }).catch(() => {});
server.close();

const unsettled = expected.filter((_, i) => !settled[i]);
const mismatches = expected.map((e, i) => [e, got[i]] as const).filter(([e, g], i) => settled[i] && e !== g);
if (unsettled.length > 0 || mismatches.length > 0 || errors.length > 0) {
  console.error(
    JSON.stringify({ unsettled: unsettled.length, mismatches, errors, got, total: expected.length }),
  );
  process.exit(1);
}
console.log(`ok ${expected.length}/${expected.length}`);
process.exit(0);
