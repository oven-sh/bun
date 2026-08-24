// Every field of a Postgres ErrorResponse (message/detail/hint/…) was leaked
// once per error. A mock server that answers every query with a large
// ErrorResponse is enough. All wire-protocol bytes come from wire-frames.ts.

import { SQL } from "bun";
import {
  listeningServer,
  pgAuthenticationOk,
  pgErrorResponse,
  pgReadFrontendMessages,
  pgReadyForQuery,
} from "./wire-frames";

const big = Buffer.alloc(256 * 1024, "m").toString();
let n = 0;
const error = () => pgErrorResponse({ S: "ERROR", C: "42601", M: big + n++, D: big + n++, H: big + n++ });

const { server, port } = await listeningServer(socket => {
  let buf = Buffer.alloc(0);
  let startup = true;
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    const out: Buffer[] = [];
    if (startup) {
      if (buf.length < 4 || buf.length < buf.readInt32BE(0)) return;
      buf = buf.subarray(buf.readInt32BE(0));
      startup = false;
      out.push(pgAuthenticationOk(), pgReadyForQuery());
    }
    buf = pgReadFrontendMessages(buf, type => {
      switch (String.fromCharCode(type)) {
        case "Q": out.push(error(), pgReadyForQuery()); break;
        case "P": out.push(error()); break;
        case "S": out.push(pgReadyForQuery()); break;
        case "X": socket.end(); break;
      }
    });
    if (out.length) socket.write(Buffer.concat(out));
  });
  socket.on("error", () => {});
});

const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1 });
for (let i = 0; i < 10; i++) await sql.unsafe("select 1").simple().catch(e => e);
Bun.gc(true);
const rssBefore = process.memoryUsage.rss();
for (let i = 0; i < 150; i++) await sql.unsafe("select 1").simple().catch(e => e);
await sql.close({ timeout: 0 });
server.close();
for (let i = 0; i < 8; i++) {
  await new Promise(r => setImmediate(r));
  Bun.gc(true);
}
console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - rssBefore) / 1024 / 1024 }));
