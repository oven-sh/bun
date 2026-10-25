// Mock server so no Postgres is needed. A connection caches its prepared
// statements, and each of them keeps its result-row Structure in a
// bun_jsc::Strong. close() leaves the cache alone: it goes with the connection,
// in the finalizer of its wrapper, i.e. while JSC is sweeping. COUNT spans more
// than two StrongRootBlocks (960 slots each) so at least one block holds nothing
// but these and goes empty inside that sweep.

import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import {
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const replies: Record<string, Buffer | Buffer[]> = {
  P: pgParseComplete(),
  D: [pgParameterDescription([25]), pgRowDescription([{ name: "c", typeOid: 25 }])],
  B: pgBindComplete(),
  E: [pgDataRow([Buffer.from("1")]), pgCommandComplete("SELECT 1")],
  S: pgReadyForQuery(),
};
const { server, port } = await pgMockServer((type, _, socket) => {
  if (type === "X") socket.end();
  else return replies[type];
});

const COUNT = 2 * 960 + 128;
// Enough of them that none has to evict a statement from its cache.
const CONNECTIONS = 16;
const protectedStructures = () => heapStats().protectedObjectTypeCounts.Structure ?? 0;

async function run() {
  const clients = Array.from({ length: CONNECTIONS }, () => new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 }));
  // A text of its own is a statement of its own.
  const queries = Array.from({ length: COUNT }, (_, i) =>
    clients[i % CONNECTIONS].unsafe(`select $1 as c -- ${i}`, ["1"]),
  );
  for (const [row] of await Promise.all(queries)) {
    if (row.c !== "1") throw new Error("unexpected row " + JSON.stringify(row));
  }
  const protectedWhileHeld = protectedStructures();
  await Promise.all(clients.map(sql => sql.close({ timeout: 0 })));
  return { protectedWhileHeld, protectedAfterClose: protectedStructures() };
}
const held = await run();
server.close();

let protectedAfter = held.protectedAfterClose;
for (let i = 0; i < 10 && protectedAfter >= 10; i++) {
  await new Promise(r => setImmediate(r));
  Bun.gc(true);
  protectedAfter = protectedStructures();
}
console.log(JSON.stringify({ count: COUNT, ...held, protectedAfter }));
