// Mock server so no Postgres is needed. In simple-query mode every query gets
// its own PostgresSQLStatement whose cached result-row Structure is a
// bun_jsc::Strong released from the query's finalizer, i.e. while JSC is
// sweeping. COUNT spans more than two StrongRootBlocks (960 slots each) so at
// least one block holds nothing but these and goes empty inside that sweep.

import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { pgCommandComplete, pgDataRow, pgMockServer, pgReadyForQuery, pgRowDescription } from "./wire-frames";

const reply = [
  pgRowDescription([{ name: "c", typeOid: 23 }]),
  pgDataRow([Buffer.from("1")]),
  pgCommandComplete("SELECT 1"),
  pgReadyForQuery(),
];
const { server, port } = await pgMockServer((type, _, socket) => {
  if (type === "Q") return reply;
  if (type === "X") socket.end();
});

const COUNT = 2 * 960 + 128;
async function run() {
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1 });
  const queries = Array.from({ length: COUNT }, () => sql.unsafe("select 1 as c"));
  for (const [row] of await Promise.all(queries)) {
    if (row.c !== 1) throw new Error("unexpected row " + JSON.stringify(row));
  }
  const protectedWhileHeld = heapStats().protectedObjectTypeCounts.Structure ?? 0;
  if (queries.length !== COUNT) throw new Error("unreachable; keeps `queries` alive across heapStats()");
  await sql.close({ timeout: 0 });
  return protectedWhileHeld;
}
const protectedWhileHeld = await run();
server.close();

let protectedAfter = protectedWhileHeld;
for (let i = 0; i < 10 && protectedAfter >= 10; i++) {
  await new Promise(r => setImmediate(r));
  Bun.gc(true);
  protectedAfter = heapStats().protectedObjectTypeCounts.Structure ?? 0;
}
console.log(JSON.stringify({ count: COUNT, protectedWhileHeld, protectedAfter }));
