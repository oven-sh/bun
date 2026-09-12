// https://github.com/oven-sh/bun/issues/40102: binding a json/jsonb parameter
// leaked the JSON.stringify result once per query. The json arm is reached once
// ParameterDescription reports oid 114 for the parameter, so a mock server is
// enough. All wire-protocol bytes come from wire-frames.ts.

import { SQL } from "bun";
import {
  pgBindComplete,
  pgCommandComplete,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgRaw,
  pgReadyForQuery,
} from "./wire-frames";

const noData = pgRaw("n", Buffer.alloc(0));

const { server, port } = await pgMockServer((type, _, socket) => {
  switch (type) {
    case "P": return pgParseComplete();
    case "D": return [pgParameterDescription([114]), noData];
    case "B": return pgBindComplete();
    case "E": return pgCommandComplete("SELECT 0");
    case "S": return pgReadyForQuery();
    case "X": socket.end(); break;
  }
});

const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1 });

// ~512 KiB of JSON per bind; the stringified payload is what leaked.
const payload = { data: Buffer.alloc(512 * 1024, 0x61).toString("latin1") };

// Warm up so statement.parameters is populated from ParameterDescription.
for (let i = 0; i < 4; i++) await sql`select ${payload}::json`;
Bun.gc(true);
const rssBefore = process.memoryUsage.rss();

for (let i = 0; i < 300; i++) {
  await sql`select ${payload}::json`;
  if ((i & 15) === 15) Bun.gc(true);
}

await sql.close({ timeout: 0 }).catch(() => {});
server.close();
for (let i = 0; i < 8; i++) {
  await new Promise(r => setImmediate(r));
  Bun.gc(true);
}

const deltaMiB = (process.memoryUsage.rss() - rssBefore) / 1024 / 1024;
console.log(JSON.stringify({ deltaMiB }));
