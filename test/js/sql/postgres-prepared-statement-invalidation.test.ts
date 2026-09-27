// A named prepared statement that the server invalidates (SQLSTATE 26000 after
// DEALLOCATE/DISCARD, or 0A000 "cached plan must not change result type" after
// a schema change) used to stay Prepared in the per-connection statement cache,
// so every later execution of that query bound the dead server-side name and
// failed forever. The ErrorResponse handler now evicts the cached entry,
// re-prepares under a fresh name and re-runs each affected query once. A
// pipelined sibling still on the wire gets its own ErrorResponse and is
// re-queued behind the others, so a whole burst recovers. Only an error that
// answers the Bind counts: after BindComplete the same SQLSTATE comes from the
// query.
import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgBindParameters,
  pgBindResultFormats,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgHold,
  pgMockServer,
  pgParameterDescription,
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
      // Two Bind+Execute pipelined against the stale plan. Both are already
      // on the wire when the first ErrorResponse arrives; each is re-queued
      // behind the other and re-run once under the fresh name.
      expect(await Promise.all([p(), p()])).toEqual([[{ x: 1, y: 9 }], [{ x: 1, y: 9 }]]);
      // Before the fix this rejected with errno 0A000 forever.
      expect(await p()).toEqual([{ x: 1, y: 9 }]);
    } finally {
      await sql`drop table if exists ${sql(tbl)}`.simple();
    }
  });

  test("a pipelined pair of parameterised queries over a DISCARDed statement recovers for later queries", async () => {
    await container.ready;
    await using sql = connect();
    const q = (n: number) => sql`select ${n}::int as v`;
    expect(await q(1)).toEqual([{ v: 1 }]);

    await sql`discard all`.simple();
    // Both Binds name the discarded statement and are on the wire together.
    // Each gets its own 26000, and each is re-run once under the fresh name,
    // in order.
    expect(await Promise.all([q(2), q(3)])).toEqual([[{ v: 2 }], [{ v: 3 }]]);

    // Before the fix this rejected with errno 26000 forever.
    expect(await q(4)).toEqual([{ v: 4 }]);
  });

  test("a concurrent burst over an invalidated statement re-runs every query", async () => {
    await container.ready;
    await using sql = connect();
    const tbl = "t_inv_" + randomUUIDv7("hex").replaceAll("-", "");
    try {
      await sql`create table ${sql(tbl)}(id int primary key, a int)`.simple();
      await sql`insert into ${sql(tbl)} values (1, 1)`.simple();
      const select = (n: number) => sql`select * from ${sql(tbl)} where id = ${n}`;
      await Promise.all(Array.from({ length: 20 }, () => select(1)));

      await sql`alter table ${sql(tbl)} add column b int`.simple();
      // Twenty Bind+Execute for the stale plan are on the wire when the first
      // 0A000 arrives. Every one of them is re-run under the fresh name, so
      // a migration that lands under load does not fail a burst of requests.
      // With the retry limited to the last request in flight, 19 of these
      // rejected with errno 0A000.
      const burst = await Promise.all(Array.from({ length: 20 }, () => select(1)));
      expect(burst).toEqual(Array.from({ length: 20 }, () => [{ id: 1, a: 1, b: null }]));
      expect(await select(1)).toEqual([{ id: 1, a: 1, b: null }]);
    } finally {
      await sql`drop table if exists ${sql(tbl)}`.simple();
    }
  });

  test("a 0A000 raised by the query itself keeps the statement cached and is not retried", async () => {
    await container.ready;
    await using sql = connect();
    const fn = "fn_inv_" + randomUUIDv7("hex").replaceAll("-", "");
    try {
      // This 0A000 comes from PL/pgSQL (routine exec_stmt_raise), not from the
      // plan cache: the prepared statement is fine and must stay cached.
      await sql`
        create function ${sql(fn)}(int) returns int as $$ begin raise feature_not_supported; end $$ language plpgsql
      `.simple();
      const call = (n: number) => sql`select ${sql(fn)}(${n})`.catch(e => e);
      // The only prepared statement mentioning the function is the call above
      // (create/drop run through the simple protocol and are never prepared).
      const prepared = () => sql`select name from pg_prepared_statements where statement like ${"%" + fn + "%"}`;

      const first = await call(0);
      expect(first.errno).toBe("0A000");
      expect(first.routine).not.toBe("RevalidateCachedQuery");

      const before = await prepared();
      expect(before).toHaveLength(1);
      const again = await Promise.all([call(1), call(2), call(3)]);
      expect(again.map(e => e.errno)).toEqual(["0A000", "0A000", "0A000"]);
      // Same server-side name as before: nothing was evicted or re-prepared.
      expect(await prepared()).toEqual(before);
    } finally {
      await sql`drop function if exists ${sql(fn)}(int)`.simple();
    }
  });

  test("a 26000 raised by the query itself after rows were sent is surfaced and not retried", async () => {
    await container.ready;
    await using sql = connect();
    const id = randomUUIDv7("hex").replaceAll("-", "");
    const seq = "seq_inv_" + id;
    const fn = "fn_inv_" + id;
    try {
      await sql.unsafe(`create sequence ${seq}`);
      // Raises on row 3 of its first run only. nextval is not rolled back, so
      // the sequence counts the runs that reached row 3.
      await sql.unsafe(`
        create function ${fn}(i int) returns int as $$
        begin
          if i = 3 and nextval('${seq}') = 1 then
            raise exception 'boom' using errcode = '26000';
          end if;
          return i;
        end $$ language plpgsql
      `);
      const settled = await sql`select ${sql(fn)}(i::int) as v from generate_series(1, ${5}) as i`.catch(e => e);
      const [{ runs }] = await sql.unsafe(
        `select (case when is_called then last_value else 0 end)::int as runs from ${seq}`,
      );
      // A retry runs the function a second time and resolves with the rows of
      // both runs: [1, 2, 1, 2, 3, 4, 5].
      expect({ errno: (settled as any)?.errno, routine: (settled as any)?.routine, runs }).toEqual({
        errno: "26000",
        routine: "exec_stmt_raise",
        runs: 1,
      });
    } finally {
      await sql.unsafe(`drop function if exists ${fn}(int)`);
      await sql.unsafe(`drop sequence if exists ${seq}`);
    }
  });

  test("inside a transaction block the original 0A000 is surfaced (not masked by a retry)", async () => {
    await container.ready;
    await using sql = connect();
    const tbl = "t_inv_" + randomUUIDv7("hex").replaceAll("-", "");
    try {
      await sql`create table ${sql(tbl)}(a int, b int)`.simple();
      await sql`insert into ${sql(tbl)} values (1, 2)`.simple();
      const q = () => sql`select * from ${sql(tbl)}`;
      expect(await q()).toEqual([{ a: 1, b: 2 }]);
      await sql`alter table ${sql(tbl)} add column c int default 3`.simple();

      // Inside an open transaction block a re-Parse would be rejected with
      // 25P02 (current transaction is aborted), so the retry is suppressed
      // and the caller sees the real invalidation error.
      await sql`BEGIN`.simple();
      const err = await q().catch(e => e);
      await sql`ROLLBACK`.simple();
      expect((err as any)?.errno).toBe("0A000");

      // The cache was still evicted, so the connection recovers after
      // ROLLBACK. Before the fix this rejected with errno 0A000 forever.
      expect(await q()).toEqual([{ a: 1, b: 2, c: 3 }]);
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

// Pipelined siblings: five Binds for the stale name are on the wire when the
// first 26000 arrives, and a sixth query with a new statement text is queued
// behind them. Every sibling is answered 26000 in turn, the client Parses the
// fresh name once, re-runs all five in their original order, and only then
// Parses the sixth.
test("postgres: every pipelined Bind that hits 26000 is re-run once under one fresh name", async () => {
  const parses: string[] = [];
  let bindErrors = 0;
  const known = new Set<string>();
  let forgetAfterNextSync = true;
  let bound: Buffer | null = null;
  const mock = await pgMockServer((type, body) => {
    switch (type) {
      case "P": {
        const name = body.subarray(0, body.indexOf(0)).toString("utf-8");
        parses.push(name);
        known.add(name);
        return pgParseComplete();
      }
      case "D":
        return [pgParameterDescription([25 /* text */]), pgRowDescription([{ name: "v", typeOid: 25 }])];
      case "B": {
        const afterPortal = body.indexOf(0) + 1;
        const name = body.subarray(afterPortal, body.indexOf(0, afterPortal)).toString("utf-8");
        if (!known.has(name)) {
          bindErrors++;
          bound = null;
          return pgErrorResponse({ S: "ERROR", C: "26000", M: `prepared statement "${name}" does not exist` });
        }
        bound = pgBindParameters(body)[0]!;
        return pgBindComplete();
      }
      case "E":
        return bound === null ? undefined : [pgDataRow([bound]), pgCommandComplete("SELECT 1")];
      case "S":
        if (bound !== null && forgetAfterNextSync) {
          // As if the backend ran DEALLOCATE ALL after the warm-up.
          known.clear();
          forgetAfterNextSync = false;
        }
        bound = null;
        return pgReadyForQuery();
    }
  });

  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, idleTimeout: 5 });
    const echo = (text: string) => sql`select ${text} as v`;
    const other = (text: string) => sql`select ${text}::text as v`;
    expect(await echo("0")).toEqual([{ v: "0" }]);

    // Five Bind+Execute pipelined against the forgotten name, then a statement
    // the server has never seen (its Parse waits for the pipeline to drain).
    const results = await Promise.all([echo("1"), echo("2"), echo("3"), echo("4"), echo("5"), other("6")]);
    expect({ results, bindErrors, parses: parses.length, uniqueNames: new Set(parses).size }).toEqual({
      results: [[{ v: "1" }], [{ v: "2" }], [{ v: "3" }], [{ v: "4" }], [{ v: "5" }], [{ v: "6" }]],
      bindErrors: 5,
      // warm-up, the one re-Parse, then `other`
      parses: 3,
      uniqueNames: 3,
    });
  } finally {
    mock.server.close();
  }
});

// The server flushes an ErrorResponse before the ReadyForQuery that ends the
// batch, so the two can arrive in separate reads. An earlier sibling's
// ReadyForQuery has already marked the connection ready. A query enqueued in
// that window must not make the client write the re-Parse before the error
// batch's ReadyForQuery: the later ReadyForQuery would then pipeline the new
// query ahead of the retry's Bind and hand each the other's rows.
test("postgres: a query enqueued between a sibling's ErrorResponse and its ReadyForQuery keeps its own rows", async () => {
  const parses: string[] = [];
  const queries = new Map<string, string>();
  const known = new Set<string>();
  let bound: Buffer | null = null;
  let bindFailed = false;
  let holdOnce = true;
  const mock = await pgMockServer((type, body) => {
    switch (type) {
      case "P": {
        const name = body.subarray(0, body.indexOf(0)).toString("utf-8");
        const after = body.indexOf(0) + 1;
        queries.set(name, body.subarray(after, body.indexOf(0, after)).toString("utf-8"));
        parses.push(name);
        known.add(name);
        return pgParseComplete();
      }
      case "D":
        return [pgParameterDescription([25 /* text */]), pgRowDescription([{ name: "v", typeOid: 25 }])];
      case "B": {
        const afterPortal = body.indexOf(0) + 1;
        const name = body.subarray(afterPortal, body.indexOf(0, afterPortal)).toString("utf-8");
        if (!known.has(name)) {
          bound = null;
          bindFailed = true;
          return pgErrorResponse({ S: "ERROR", C: "26000", M: `prepared statement "${name}" does not exist` });
        }
        bound = pgBindParameters(body)[0]!;
        return pgBindComplete();
      }
      case "E":
        return bound === null ? undefined : [pgDataRow([bound]), pgCommandComplete("SELECT 1")];
      case "S": {
        bound = null;
        const hold = bindFailed && holdOnce;
        bindFailed = false;
        if (hold) {
          holdOnce = false;
          return [pgHold, pgReadyForQuery()];
        }
        return pgReadyForQuery();
      }
    }
  });

  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, idleTimeout: 5 });
    const echo = (text: string) => sql`select ${text} as v`;
    const other = (text: string) => sql`select ${text}::text as v`;
    expect(await echo("0")).toEqual([{ v: "0" }]);
    expect(await other("a")).toEqual([{ v: "a" }]);
    for (const [name, query] of queries) if (!query.includes("::text")) known.delete(name);

    // execute() sends at once, so these two are pipelined: `other` succeeds,
    // `echo` gets 26000 and its ReadyForQuery is held back.
    const s0 = other("b").execute();
    const s1 = echo("1").execute();
    expect(await s0).toEqual([{ v: "b" }]);
    // Enqueued while the error batch's ReadyForQuery is outstanding.
    const s3 = other("x").execute();
    mock.release();
    expect(await Promise.all([s1, s3])).toEqual([[{ v: "1" }], [{ v: "x" }]]);
    expect(parses.length).toBe(3);
  } finally {
    mock.server.close();
  }
});

// The idle check runs when the error arrives, but the retry is written only
// after the requests ahead of it answer. If one of those is a BEGIN, the
// session is in a transaction block by then. The retry must not run inside a
// block the query was issued before: it surfaces the original error instead.
test("postgres: a retry queued behind a pipelined BEGIN surfaces the 26000 instead of running in the block", async () => {
  const parses: string[] = [];
  const queries = new Map<string, string>(); // statement name -> query text
  const known = new Set<string>();
  let bound: { name: string; param: Buffer | null } | null = null;
  let inBlock = false;
  const mock = await pgMockServer((type, body) => {
    switch (type) {
      case "P": {
        const name = body.subarray(0, body.indexOf(0)).toString("utf-8");
        const after = body.indexOf(0) + 1;
        const query = body.subarray(after, body.indexOf(0, after)).toString("utf-8");
        parses.push(name);
        queries.set(name, query);
        known.add(name);
        return pgParseComplete();
      }
      case "D": {
        const name = body.subarray(1, body.indexOf(0, 1)).toString("utf-8");
        const params = queries.get(name)!.includes("$1") ? [25 /* text */] : [];
        return [pgParameterDescription(params), pgRowDescription([{ name: "v", typeOid: 25 }])];
      }
      case "B": {
        const afterPortal = body.indexOf(0) + 1;
        const name = body.subarray(afterPortal, body.indexOf(0, afterPortal)).toString("utf-8");
        if (!known.has(name)) {
          bound = null;
          return pgErrorResponse({ S: "ERROR", C: "26000", M: `prepared statement "${name}" does not exist` });
        }
        bound = { name, param: pgBindParameters(body)[0] ?? null };
        return pgBindComplete();
      }
      case "E": {
        if (bound === null) return;
        const query = queries.get(bound.name)!;
        if (query === "BEGIN") {
          inBlock = true;
          return pgCommandComplete("BEGIN");
        }
        if (query === "COMMIT") {
          inBlock = false;
          return pgCommandComplete("COMMIT");
        }
        return [pgDataRow([bound.param!]), pgCommandComplete("SELECT 1")];
      }
      case "S":
        bound = null;
        return pgReadyForQuery(inBlock ? "T" : "I");
    }
  });

  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, idleTimeout: 5 });
    const echo = (text: string) => sql`select ${text} as v`;
    expect(await echo("0")).toEqual([{ v: "0" }]);
    await sql`BEGIN`;
    await sql`COMMIT`;
    // The server forgets the select statement only. BEGIN stays prepared, so
    // the next BEGIN is a cache hit and pipelines behind the stale select.
    for (const [name, query] of queries) if (query !== "BEGIN" && query !== "COMMIT") known.delete(name);

    const [stale, begin] = await Promise.allSettled([echo("1"), sql`BEGIN`]);
    await sql`COMMIT`;
    // With the session idle again the next run re-prepares as usual.
    const after = await echo("2");
    expect({
      stale: stale.status === "rejected" ? (stale.reason as any).errno : stale.value,
      begin: begin.status,
      after,
      // warm-up select, BEGIN, COMMIT, then only the re-Parse for echo("2")
      parses: parses.length,
    }).toEqual({ stale: "26000", begin: "fulfilled", after: [{ v: "2" }], parses: 4 });
  } finally {
    mock.server.close();
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

// 0A000 is the generic feature_not_supported class; only the plancache
// RevalidateCachedQuery case means the prepared statement is stale. An
// execute-time 0A000 from anything else must not trigger a silent re-execute.
test("postgres: a 0A000 without routine RevalidateCachedQuery is not retried", async () => {
  let parses = 0;
  let executes = 0;
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
      pending = pgReadFrontendMessages(pending, type => {
        if (type === 0x50 /* Parse */) {
          parses++;
          out.push(pgParseComplete());
        } else if (type === 0x44 /* Describe */) {
          out.push(rowDesc);
        } else if (type === 0x42 /* Bind */) {
          out.push(pgBindComplete());
        } else if (type === 0x45 /* Execute */) {
          executes++;
          if (executes === 1) {
            out.push(pgDataRow([Buffer.from("ok")]), pgCommandComplete("SELECT 1"));
          } else {
            out.push(pgErrorResponse({ S: "ERROR", C: "0A000", M: "feature not supported", R: "some_fdw_handler" }));
          }
        } else if (type === 0x53 /* Sync */) {
          out.push(pgReadyForQuery());
        }
      });
      if (out.length) socket.write(Buffer.concat(out));
    });
  });

  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5 });
    expect(await sql`select v`).toEqual([{ v: "ok" }]);
    const err = await sql`select v`.catch(e => e);
    // Exactly one Parse and two Executes: the first run prepared and
    // succeeded, the second hit the cache and was rejected at Execute. No
    // silent re-prepare (which would have bumped parses to 2 and executes
    // to 3).
    expect({ errno: (err as any)?.errno, routine: (err as any)?.routine, parses, executes }).toEqual({
      errno: "0A000",
      routine: "some_fdw_handler",
      parses: 1,
      executes: 2,
    });
  } finally {
    server.close();
  }
});

// The position in the exchange decides, not the fields of the error. After
// BindComplete the server has found the statement and its plan, so a 26000
// there comes from the query itself. Rows of the request can have arrived by
// then, and a retry would resolve with the rows of both attempts.
test("postgres: a 26000 after BindComplete is surfaced and the statement stays cached", async () => {
  let parses = 0;
  let executes = 0;
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
      pending = pgReadFrontendMessages(pending, type => {
        if (type === 0x50 /* Parse */) {
          parses++;
          out.push(pgParseComplete());
        } else if (type === 0x44 /* Describe */) {
          out.push(rowDesc);
        } else if (type === 0x42 /* Bind */) {
          out.push(pgBindComplete());
        } else if (type === 0x45 /* Execute */) {
          executes++;
          if (executes === 2) {
            out.push(
              pgDataRow([Buffer.from("a")]),
              pgDataRow([Buffer.from("b")]),
              pgErrorResponse({
                S: "ERROR",
                C: "26000",
                M: 'prepared statement "other" does not exist',
                R: "FetchPreparedStatement",
              }),
            );
          } else {
            out.push(pgDataRow([Buffer.from("ok")]), pgCommandComplete("SELECT 1"));
          }
        } else if (type === 0x53 /* Sync */) {
          out.push(pgReadyForQuery());
        }
      });
      if (out.length) socket.write(Buffer.concat(out));
    });
  });

  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5 });
    expect(await sql`select v`).toEqual([{ v: "ok" }]);
    const err = await sql`select v`.catch(e => e);
    const after = await sql`select v`;
    // One Parse for three runs: the second run was not re-prepared, and the
    // third one still found the statement in the cache.
    expect({ errno: (err as any)?.errno, after, parses, executes }).toEqual({
      errno: "26000",
      after: [{ v: "ok" }],
      parses: 1,
      executes: 3,
    });
  } finally {
    server.close();
  }
});

// The reply to a re-prepare can arrive split across reads between
// ParseComplete and RowDescription. A query issued there finds the statement
// Prepared and is written at once. Its Bind must not ask for the column
// formats of the statement that the server invalidated: the server then sends
// a value in one format and the client reads it in the other.
type Column = { name: string; typeOid: number; text: string; binary: Buffer };

function int4(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test.each([
  {
    change: "ALTER COLUMN TYPE",
    before: [{ name: "a", typeOid: 25 /* text */, text: "42", binary: Buffer.from("42") }],
    after: [{ name: "a", typeOid: 23 /* int4 */, text: "42", binary: int4(42) }],
    row: { a: 42 },
  },
  {
    change: "ADD COLUMN",
    before: [
      { name: "a", typeOid: 23, text: "1", binary: int4(1) },
      { name: "b", typeOid: 25, text: "x", binary: Buffer.from("x") },
    ],
    after: [
      { name: "a", typeOid: 23, text: "1", binary: int4(1) },
      { name: "b", typeOid: 25, text: "x", binary: Buffer.from("x") },
      { name: "c", typeOid: 23, text: "3", binary: int4(3) },
    ],
    row: { a: 1, b: "x", c: 3 },
  },
] satisfies { change: string; before: Column[]; after: Column[]; row: object }[])(
  "postgres: a query issued before the RowDescription of a re-prepare asks for no stale column format ($change)",
  async ({ before, after, row }) => {
    let schema: Column[] = before;
    let version = 1;
    const parsedUnder = new Map<string, number>(); // statement name -> schema version
    let portal: number[] | null = null; // the format of each column; null after a failed Bind
    let holdNextDescribe = false;
    let held = false;
    let windowOpen = false;
    let bindsInWindow = 0;
    const describeHeld = Promise.withResolvers<void>();
    // The mock does what the server does: a statement parsed under an older
    // schema answers 0A000 to each Bind, the count of result formats must be
    // 0, 1 or the column count, and a value goes out in the format asked for.
    const mock = await pgMockServer((type, body) => {
      switch (type) {
        case "P":
          parsedUnder.set(body.subarray(0, body.indexOf(0)).toString("utf-8"), version);
          return pgParseComplete();
        case "D":
          if (!holdNextDescribe) return [pgParameterDescription([]), pgRowDescription(schema)];
          holdNextDescribe = false;
          held = true;
          describeHeld.resolve();
          return [pgParameterDescription([]), pgHold, pgRowDescription(schema)];
        case "B": {
          if (windowOpen) bindsInWindow++;
          portal = null;
          const afterPortal = body.indexOf(0) + 1;
          const name = body.subarray(afterPortal, body.indexOf(0, afterPortal)).toString("utf-8");
          if (parsedUnder.get(name) !== version) {
            return pgErrorResponse({
              S: "ERROR",
              C: "0A000",
              M: "cached plan must not change result type",
              R: "RevalidateCachedQuery",
            });
          }
          const formats = pgBindResultFormats(body);
          if (formats.length > 1 && formats.length !== schema.length) {
            return pgErrorResponse({
              S: "ERROR",
              C: "08P01",
              M: `bind message has ${formats.length} result formats but query has ${schema.length} columns`,
              R: "PortalSetResultFormat",
            });
          }
          portal = schema.map((_, i) => (formats.length === 0 ? 0 : formats.length === 1 ? formats[0] : formats[i]));
          return pgBindComplete();
        }
        case "E": {
          if (portal === null) return;
          const formats = portal;
          const values = schema.map((column, i) => (formats[i] === 1 ? column.binary : Buffer.from(column.text)));
          return [pgDataRow(values), pgCommandComplete("SELECT 1")];
        }
        case "S":
          portal = null;
          // The batch of the re-prepare ends here. A Bind after it is a new query.
          if (held) windowOpen = true;
          return pgReadyForQuery();
      }
    });

    try {
      await using sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, idleTimeout: 5 });
      const q = () => sql`select * from t`;
      await q();
      // The cached statement now has the columns of `before`.
      await q();

      schema = after;
      version = 2;
      holdNextDescribe = true;
      const first = q().execute();
      await describeHeld.promise;
      // The client gives no signal when it has read ParseComplete and
      // ParameterDescription, so the second query waits many turns of the
      // loop. `bindsInWindow` below proves that it was written in the window.
      let second: Promise<unknown> | undefined;
      for (let turn = 0; turn < 20_000 && bindsInWindow === 0; turn++) {
        await tick();
        if (turn === 1_000) second = q().execute();
      }
      held = false;
      windowOpen = false;
      mock.release();

      expect({ first: await first, second: await second, bindsInWindow }).toEqual({
        first: [row],
        second: [row],
        bindsInWindow: 1,
      });
    } finally {
      mock.server.close();
    }
  },
);
