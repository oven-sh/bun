// A named prepared statement that the server invalidates (SQLSTATE 26000 after
// DEALLOCATE/DISCARD, or 0A000 "cached plan must not change result type" after
// a schema change) used to stay Prepared in the per-connection statement cache,
// so every later execution of that query bound the dead server-side name and
// failed forever. The ErrorResponse handler now evicts the cached entry and,
// when the failing exchange is the only one in flight, transparently
// re-prepares under a fresh name and re-runs once.
import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      idleTimeout: 30,
    });

  test("ALTER TABLE (0A000) is recovered by re-preparing instead of poisoning the connection", async () => {
    await container.ready;
    await using sql = connect();
    const tbl = "t_inv_" + randomUUIDv7("hex").replaceAll("-", "");
    try {
      await sql`create table ${sql(tbl)}(a int, b int)`.simple();
      await sql`insert into ${sql(tbl)} values (1, 2)`.simple();
      const q = () => sql`select * from ${sql(tbl)}`;
      expect(await q()).toEqual([{ a: 1, b: 2 }]);

      await sql`alter table ${sql(tbl)} add column c int default 3`.simple();
      // Before the fix every call below rejected with errno 0A000; now the
      // stale plan is re-prepared under a fresh name and the new column is
      // returned.
      expect(await q()).toEqual([{ a: 1, b: 2, c: 3 }]);
      expect(await q()).toEqual([{ a: 1, b: 2, c: 3 }]);

      // ALTER COLUMN TYPE: the postgres.js "Recreate prepared statements on
      // RevalidateCachedQuery error" case (same 0A000, different DDL shape).
      await sql`alter table ${sql(tbl)} alter column b type text using b::text`.simple();
      expect(await q()).toEqual([{ a: 1, b: "2", c: 3 }]);
    } finally {
      await sql`drop table if exists ${sql(tbl)}`.simple();
    }
  });

  test("DEALLOCATE/DISCARD (26000) is recovered by re-preparing instead of poisoning the connection", async () => {
    await container.ready;
    await using sql = connect();
    const tbl = "t_inv_" + randomUUIDv7("hex").replaceAll("-", "");
    try {
      await sql`create table ${sql(tbl)}(a int)`.simple();
      await sql`insert into ${sql(tbl)} values (7)`.simple();
      // With a parameter so the two-phase Parse+Describe / Bind+Execute path
      // is exercised as well.
      const q = (n: number) => sql`select a from ${sql(tbl)} where a = ${n}`;
      expect(await q(7)).toEqual([{ a: 7 }]);

      await sql`deallocate all`.simple();
      expect(await q(7)).toEqual([{ a: 7 }]);

      await sql`discard all`.simple();
      expect(await q(7)).toEqual([{ a: 7 }]);
      expect(await q(7)).toEqual([{ a: 7 }]);
    } finally {
      await sql`drop table if exists ${sql(tbl)}`.simple();
    }
  });

  test("a pipelined batch over an invalidated statement recovers for later queries", async () => {
    await container.ready;
    await using sql = connect();
    const tbl = "t_inv_" + randomUUIDv7("hex").replaceAll("-", "");
    try {
      await sql`create table ${sql(tbl)}(x int)`.simple();
      await sql`insert into ${sql(tbl)} values (1)`.simple();
      const p = () => sql`select * from ${sql(tbl)}`;
      expect(await p()).toEqual([{ x: 1 }]);

      await sql`alter table ${sql(tbl)} add column y int default 9`.simple();
      // Two Bind+Execute pipelined against the stale plan. Both were already
      // on the wire when the first ErrorResponse arrives, so at least the
      // first is surfaced; the second may be transparently re-prepared.
      const [r0, r1] = await Promise.allSettled([p(), p()]);
      expect(r0.status === "rejected" ? (r0.reason as any).errno : r0.value).toEqual(
        r0.status === "rejected" ? "0A000" : [{ x: 1, y: 9 }],
      );
      expect(r1.status === "rejected" ? (r1.reason as any).errno : r1.value).toEqual(
        r1.status === "rejected" ? "0A000" : [{ x: 1, y: 9 }],
      );
      // The connection must not be poisoned: the next execution succeeds.
      // Before the fix this rejected with errno 0A000 forever.
      expect(await p()).toEqual([{ x: 1, y: 9 }]);
    } finally {
      await sql`drop table if exists ${sql(tbl)}`.simple();
    }
  });
});

// Wire-level counterpart: runs without a container. The scripted server forgets
// every prepared statement after the first successful execution, so the next
// Bind answers 26000. The client must evict its cache entry and Parse a fresh
// name; the test asserts the second Parse name differs from the first and that
// the query resolves.
test("postgres: a 26000 on Bind evicts the cached statement and re-prepares under a new name", async () => {
  const parses: string[] = [];
  const { port, server } = await listeningServer(socket => {
    let sawStartup = false;
    let pending = Buffer.alloc(0);
    const known = new Set<string>();
    let boundName: string | null = null;
    const rowDesc = pgRowDescription([{ name: "v", typeOid: 25 }]);
    socket.on("error", () => {});
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
      const out: Buffer[] = [];
      pending = pgReadFrontendMessages(pending, (type, body) => {
        switch (type) {
          case 0x50 /* 'P' Parse */: {
            const name = body.subarray(0, body.indexOf(0)).toString("utf-8");
            parses.push(name);
            known.add(name);
            out.push(pgParseComplete());
            break;
          }
          case 0x44 /* 'D' Describe */:
            out.push(rowDesc);
            break;
          case 0x42 /* 'B' Bind */: {
            const afterPortal = body.indexOf(0) + 1;
            const name = body.subarray(afterPortal, body.indexOf(0, afterPortal)).toString("utf-8");
            if (known.has(name)) {
              boundName = name;
              out.push(pgBindComplete());
            } else {
              boundName = null;
              out.push(pgErrorResponse({ S: "ERROR", C: "26000", M: `prepared statement "${name}" does not exist` }));
            }
            break;
          }
          case 0x45 /* 'E' Execute */:
            if (boundName !== null) {
              out.push(pgDataRow([Buffer.from("ok")]), pgCommandComplete("SELECT 1"));
            }
            break;
          case 0x53 /* 'S' Sync */:
            if (boundName !== null) {
              // Forget every statement after one successful exchange, as if
              // the backend ran DEALLOCATE ALL.
              known.clear();
              boundName = null;
            }
            out.push(pgReadyForQuery());
            break;
          case 0x48 /* 'H' Flush */:
          case 0x58 /* 'X' Terminate */:
            break;
          default:
            break;
        }
      });
      if (out.length) socket.write(Buffer.concat(out));
    });
  });

  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5 });
    const q = () => sql`select v`;
    // First run: Parse name #0, Bind, Execute → ok. Server then forgets it.
    expect(await q()).toEqual([{ v: "ok" }]);
    // Second run: cache hit, Bind name #0 → 26000. Client must evict + Parse a
    // new name + re-run; before the fix this rejected with errno 26000.
    expect(await q()).toEqual([{ v: "ok" }]);
    // Third run: same again (cache was re-populated with the new name, which
    // the server has now also forgotten).
    expect(await q()).toEqual([{ v: "ok" }]);

    expect({
      parseCount: parses.length,
      uniqueNames: new Set(parses).size,
    }).toEqual({
      parseCount: 3,
      uniqueNames: 3,
    });
  } finally {
    server.close();
  }
});

// The retry is capped at one attempt per query: a server that answers every
// Bind with 26000 must not loop forever.
test("postgres: a 26000 on the re-prepared Bind is surfaced instead of retried again", async () => {
  let parses = 0;
  const { port, server } = await listeningServer(socket => {
    let sawStartup = false;
    let pending = Buffer.alloc(0);
    const rowDesc = pgRowDescription([{ name: "v", typeOid: 25 }]);
    socket.on("error", () => {});
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
      const out: Buffer[] = [];
      pending = pgReadFrontendMessages(pending, (type, body) => {
        if (type === 0x50 /* Parse */) {
          parses++;
          out.push(pgParseComplete());
        } else if (type === 0x44 /* Describe */) {
          out.push(rowDesc);
        } else if (type === 0x42 /* Bind */) {
          const afterPortal = body.indexOf(0) + 1;
          const name = body.subarray(afterPortal, body.indexOf(0, afterPortal)).toString("utf-8");
          out.push(pgErrorResponse({ S: "ERROR", C: "26000", M: `prepared statement "${name}" does not exist` }));
        } else if (type === 0x53 /* Sync */) {
          out.push(pgReadyForQuery());
        }
      });
      if (out.length) socket.write(Buffer.concat(out));
    });
  });

  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5 });
    const err = await sql`select v`.catch(e => e);
    expect({ errno: (err as any)?.errno, parses }).toEqual({ errno: "26000", parses: 2 });
  } finally {
    server.close();
  }
});
