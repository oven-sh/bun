// https://github.com/oven-sh/bun/issues/32741
//
// The per-connection prepared-statement cache was keyed on a wyhash of
// `signature.name` (= query text + one suffix per bound param), so two
// distinct queries whose names collide under that hash shared one server-side
// statement. The cache now keys on the name bytes themselves; these are the
// constructed colliding inputs that broke the old key.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";
import { constructStdCollision } from "../../cli/install/wyhash-std-collision";

// signature.name = SQL text + ".null" for one null-bound param. The free
// 8-byte word sits inside a string literal, so the two queries return
// different `v` values while their names collide under std.Wyhash(0).
function collidingQueryPair(placeholder: string, freeB = "BBBBBBBB") {
  // Every printable ASCII char that is valid inside a single-quoted SQL
  // string literal. A wide charset lets the collision search land an in-set
  // kill word in far fewer iterations, which matters under debug JSC.
  let charset = "";
  for (let c = 0x20; c < 0x7f; c++) if (c !== 0x27 && c !== 0x5c) charset += String.fromCharCode(c);
  const paramSuffix = ".null";
  const r = constructStdCollision({
    seed: 0n,
    prefixStr: "SELECT '",
    suffixStr: `' AS v, ${placeholder} AS p${paramSuffix}`,
    charset,
    freeA: "AAAAAAAA",
    freeB,
    padFillCh: "x",
  });
  const sqlA = r.str1.slice(0, -paramSuffix.length);
  const sqlB = r.str2.slice(0, -paramSuffix.length);
  const enc = (s: string) => new TextEncoder().encode(s);
  // Self-verify the pair collides under `Bun.hash.wyhash` (seed 0), the hash
  // that keyed the cache before the fix; that collision is what makes this
  // pair the regression input.
  if (Bun.hash.wyhash(enc(r.str1), 0n) !== Bun.hash.wyhash(enc(r.str2), 0n)) {
    throw new Error("constructed pair does not collide under wyhash");
  }
  return { sqlA, sqlB };
}

async function assertDistinctStatements(sql: SQL, label: string, placeholder: string) {
  const { sqlA, sqlB } = collidingQueryPair(placeholder);
  expect(sqlA).not.toBe(sqlB);
  expect(sqlA).toContain("AAAAAAAA");
  expect(sqlB).toContain("BBBBBBBB");

  // Query A populates the statement cache; query B, byte-distinct but
  // wyhash-colliding, must prepare its own statement and return its own value.
  const [[rA], [rB], [rC]] = await Promise.all([
    sql.unsafe(sqlA, [null]),
    sql.unsafe(sqlB, [null]),
    sql.unsafe(`SELECT 'CONTROL' AS v, ${placeholder} AS p`, [null]),
  ]);
  expect({ a: rA.v.includes("AAAAAAAA"), b: rB.v.includes("BBBBBBBB"), c: rC.v }).toEqual({
    a: true,
    b: true,
    c: "CONTROL",
  });
  // Before the fix, rB.v contained "AAAAAAAA" (A's statement was reused).
  expect(rB.v).not.toContain("AAAAAAAA");

  // Re-running A still hits its cached statement (nothing was evicted) and
  // still returns A's own value.
  const [rA2] = await sql.unsafe(sqlA, [null]);
  expect(rA2.v).toBe(rA.v);

  // Re-running B hits B's own cached statement and still returns B's value.
  const [rB2] = await sql.unsafe(sqlB, [null]);
  expect(rB2.v).toBe(rB.v);

  console.log(`${label}: A="${rA.v.includes("AAAAAAAA") ? "A" : "?"}", B="${rB.v.includes("BBBBBBBB") ? "B" : "?"}"`);
}

if (isDockerEnabled() || process.env.BUN_TEST_SERVICE_mysql_plain) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("MySQL: hash-colliding prepared statements are not confused", async () => {
      await container.ready;
      await using sql = new SQL({
        url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
      });
      await assertDistinctStatements(sql, "mysql", "?");
    });
  });
}

if (isDockerEnabled() || process.env.BUN_TEST_SERVICE_postgres_plain) {
  describeWithContainer("postgres", { image: "postgres_plain" }, container => {
    test("Postgres: hash-colliding prepared statements are not confused", async () => {
      await container.ready;
      await using sql = new SQL({
        url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
      });
      await assertDistinctStatements(sql, "postgres", "$1");
    });

    test("Postgres: a hash-colliding query that fails to parse does not evict or free the cached statement", async () => {
      await container.ready;
      await using sql = new SQL({
        url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
      });
      // The bad query's 8-byte free word breaks out of the string literal, so
      // Postgres rejects it at Parse; its name wyhash-collides with the good
      // query's, which is the input that confused the old hash-keyed cache.
      const { sqlA: good, sqlB: bad } = collidingQueryPair("$1", "'||qq9z(");
      const [rGood] = await sql.unsafe(good, [null]);
      expect(rGood.v).toContain("AAAAAAAA");

      // Before the collision fix this resolved with the good query's row
      // instead of erroring, because it reused the cached Prepared statement.
      const err = await sql.unsafe(bad, [null]).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/syntax error|unterminated|multiple commands/i);

      Bun.gc(true);

      // The connection must survive the parse failure: the good query still
      // hits its cached statement and returns its own row, and a fresh query
      // still works.
      const [rGood2] = await sql.unsafe(good, [null]);
      const [rCtl] = await sql.unsafe(`SELECT 'CONTROL' AS v, $1 AS p`, [null]);
      expect({ good: rGood2.v.includes("AAAAAAAA"), control: rCtl.v }).toEqual({ good: true, control: "CONTROL" });
    });
  });
}
