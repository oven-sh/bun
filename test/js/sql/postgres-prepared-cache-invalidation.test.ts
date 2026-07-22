// Regression test for https://github.com/oven-sh/bun/issues/29484.
//
// After a prepared statement has been parsed, PostgreSQL may later reject it
// with SQLSTATE 0A000 ("cached plan must not change result type", after DDL
// alters a referenced column) or 26000 ("prepared statement ... does not
// exist", after DEALLOCATE / DISCARD ALL / a pooler swapping the backend).
// The per-connection prepared-statement cache must drop that entry so the next
// execution re-prepares; otherwise every future attempt on the connection
// keeps sending Bind against a plan the server no longer accepts.
import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("0A000 (cached plan must not change result type) evicts the prepared statement", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    const table = `t_cache_0a000_${randomUUIDv7("hex").slice(-12)}`;
    await sql.unsafe(`CREATE TABLE ${table} (a int)`);
    // A non-empty parameter list is what routes unsafe() through the
    // extended protocol (named Parse + Bind), so the plan is cached.
    const query = `SELECT a FROM ${table} WHERE $1::int = 0`;
    try {
      await sql.unsafe(query, [0]);

      // Change the result type server-side.
      await sql.unsafe(`ALTER TABLE ${table} ALTER COLUMN a TYPE text`);

      // The first re-run sees the server's 0A000 and the cache entry is dropped.
      const first = await sql.unsafe(query, [0]).catch((e: any) => e);
      expect(first).toBeInstanceOf(Error);
      expect((first as any).errno).toBe("0A000");

      // The second re-run must re-prepare and succeed. Before the fix it
      // failed 0A000 forever on this connection.
      const second = await sql.unsafe(query, [0]);
      expect(second).toEqual([]);
    } finally {
      await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  test("26000 (invalid_sql_statement_name) after DISCARD ALL evicts the prepared statement", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    // Prepare and cache a parameterised SELECT.
    expect(await sql`SELECT ${1}::int AS v`).toEqual([{ v: 1 }]);

    // DISCARD ALL drops every server-side prepared statement on the session.
    await sql`DISCARD ALL`.simple();

    // The first re-run sees 26000 and the cache entry is dropped.
    const first = await sql`SELECT ${2}::int AS v`.catch((e: any) => e);
    expect(first).toBeInstanceOf(Error);
    expect((first as any).errno).toBe("26000");

    // The second re-run must re-prepare and succeed.
    expect(await sql`SELECT ${3}::int AS v`).toEqual([{ v: 3 }]);
  });

  test("26000 with a second queued request sharing the cached statement settles both", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await sql`SELECT ${1}::int AS v`).toEqual([{ v: 1 }]);
    await sql`DISCARD ALL`.simple();

    // Two executions of the same cached statement queued back-to-back. With
    // auto-pipelining both write Bind immediately and each receives its own
    // 26000 ErrorResponse; both must reject (not hang), and the next
    // execution must re-prepare.
    const [a, b] = await Promise.all([
      sql`SELECT ${2}::int AS v`.then(
        v => ({ ok: v }),
        e => ({ err: (e as any).errno ?? (e as any).code }),
      ),
      sql`SELECT ${3}::int AS v`.then(
        v => ({ ok: v }),
        e => ({ err: (e as any).errno ?? (e as any).code }),
      ),
    ]);
    expect(a).toEqual({ err: "26000" });
    expect(b).toEqual({ err: "26000" });

    // And the next execution re-prepares and succeeds.
    expect(await sql`SELECT ${4}::int AS v`).toEqual([{ v: 4 }]);
  });
});
