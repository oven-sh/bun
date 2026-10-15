// Mock server so no Postgres is needed. A connection keeps its prepared
// statements, each with its result-row Structure in a bun_jsc::Strong, until the
// connection itself is freed: close() leaves them, the finalizer of its wrapper
// drops them, i.e. while JSC is sweeping. COUNT spans more than two
// StrongRootBlocks (960 slots each) so at least one block holds nothing but
// these and goes empty inside that sweep.

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

const { server, port } = await pgMockServer((type, _, socket) => {
  switch (type) {
    case "P":
      return pgParseComplete();
    case "D":
      return [pgParameterDescription([25]), pgRowDescription([{ name: "c", typeOid: 25 }])];
    case "B":
      return pgBindComplete();
    case "E":
      return [pgDataRow([Buffer.from("1")]), pgCommandComplete("SELECT 1")];
    case "S":
      return pgReadyForQuery();
    case "X":
      socket.end();
      break;
  }
});

// Well under what one connection caches, so none is evicted.
const STATEMENTS = 128;
const CONNECTIONS = 16;
const COUNT = CONNECTIONS * STATEMENTS;
if (COUNT < 2 * 960 + 128) throw new Error("COUNT is too small");

const protectedStructures = () => heapStats().protectedObjectTypeCounts.Structure ?? 0;

async function run() {
  const clients = Array.from(
    { length: CONNECTIONS },
    () => new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1 }),
  );
  const queries = clients.flatMap(sql =>
    // a text of its own is a statement of its own
    Array.from({ length: STATEMENTS }, (_, i) => sql.unsafe(`select $1 as c -- ${i}`, ["1"])),
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
