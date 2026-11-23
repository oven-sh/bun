// Every field of a Postgres ErrorResponse (message/detail/hint/…) was leaked
// once per error. A mock server that answers every query with a large
// ErrorResponse is enough. All wire-protocol bytes come from wire-frames.ts.

import { SQL } from "bun";
import { pgErrorResponse, pgMockServer, pgReadyForQuery } from "./wire-frames";

const big = Buffer.alloc(256 * 1024, "m").toString();
let n = 0;
const error = () => pgErrorResponse({ S: "ERROR", C: "42601", M: big + n++, D: big + n++, H: big + n++ });

const { server, port } = await pgMockServer((type, _, socket) => {
  switch (type) {
    case "Q": return [error(), pgReadyForQuery()];
    case "P": return error();
    case "S": return pgReadyForQuery();
    case "X": socket.end(); break;
  }
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
