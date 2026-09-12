// A result column whose name is the empty string crashed the process (null
// dereference while building the row object) on both the Postgres and the
// MySQL adapter: the name reaches SQLClient.cpp as an empty BunString, which
// toWTFString() turns into a null WTF::String, and Identifier::fromString
// dereferences the null impl. The row must instead decode to an object with a
// "" key, the same as `({ "": value })` in JavaScript.
//
// MySQL and MariaDB name an un-aliased literal after its text, so an honest
// server returns such a column for plain `select ''` (real-server coverage at
// the bottom). Postgres itself rejects `as ""` (zero-length delimited
// identifier), so for that adapter an empty name only comes from a proxy or a
// misbehaving server; the mock servers in sql-empty-column-name.fixture.ts
// cover it for both adapters. The fixture runs all of an adapter's scenarios
// in one child process because the failure mode is the process dying. All wire
// bytes come from ./wire-frames.ts.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isCI, isDockerEnabled } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "sql-empty-column-name.fixture.ts");

// A result set wider than JSFinalObject::maxInlineCapacity (62) is built by a
// different path than a narrow one: the column names are kept on the side and
// put onto each row object individually instead of being baked into a
// Structure once. The "7" column is stored as an array index rather than a
// name, which selects a third path that interleaves the two kinds.
const wide = (...overrides: [index: number, name: string][]) => {
  const names = Array.from({ length: 80 }, (_, i) => `c${i}`);
  for (const [index, name] of overrides) names[index] = name;
  return names;
};
const scenarios: Record<string, string[]> = {
  "a single unnamed column": [""],
  "an unnamed column between a named and an indexed column": ["x", "", "7"],
  "an unnamed column in a wide result set": wide([40, ""]),
  "an unnamed column in a wide result set with an indexed column": wide([40, ""], [41, "7"]),
};

// Column i of every result set, mock or real, holds "v<i>", so a row that maps
// each name to its own column's value proves the names landed in the right
// slots.
const expectedRow = (names: string[]) => Object.fromEntries(names.map((name, i) => [name, `v${i}`]));

const protocols = ["simple", "prepared"] as const;

// One child per adapter: a debug build pays most of a second to start a child
// and milliseconds per scenario, and the two children run side by side. Under
// ASan with exception-check validation a child takes about 4s on a slow box,
// hence the explicit timeout.
test.concurrent.each(["postgres", "mysql"] as const)(
  '%s: every mock-server scenario decodes to a row with a "" key, over both protocols',
  async adapter => {
    const jobs = protocols.flatMap(protocol =>
      Object.entries(scenarios).map(([scenario, names]) => ({ scenario, adapter, protocol, names })),
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, JSON.stringify(jobs)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // One line per job, in job order. A crash mid-matrix shows up as a list
    // that stops at the job that died, next to the signal and the stderr trace.
    const results = stdout
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line));
    expect({ results, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      results: jobs.map(({ names, ...job }) => ({ ...job, rows: [expectedRow(names)] })),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    // toEqual ignores property order; the row must also list its keys in column
    // order (array indices first, as for any object), so `Object.values(row)`
    // walks the columns in order.
    expect(results.map(({ rows }) => Object.keys(rows[0]))).toEqual(
      jobs.map(({ names }) => Object.keys(expectedRow(names))),
    );
  },
  15_000,
);

// Real-server coverage: `select ''` is enough to get an unnamed column out of
// MariaDB, and `as ''` puts a chosen value under the empty name; the client
// decodes MySQL's and MariaDB's result sets identically.
// Same gating as sql-mariadb-json.test.ts: only attempt the container when
// something can provide it, since a half-working local docker would fail the
// suite instead of skipping it.
const mariadbProvided =
  !!process.env.BUN_TEST_SERVICE_mariadb_plain || !!process.env.BUN_DOCKER_COORDINATOR || (isCI && isDockerEnabled());
if (!mariadbProvided) {
  describe.todo("mariadb: a result set with an empty column name");
} else {
  describeWithContainer(
    "mariadb: a result set with an empty column name",
    { image: "mariadb_plain", concurrent: true },
    container => {
      const connect = () => new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

      test("select '' returns a row with a \"\" key over both protocols", async () => {
        await container.ready;
        await using sql = connect();

        expect(await sql`select ''`).toEqual([{ "": "" }]);
        expect(await sql`select ''`.simple()).toEqual([{ "": "" }]);
        expect(await sql`select 'v0' as ''`).toEqual([{ "": "v0" }]);
        expect(await sql`select 'v0' as ''`.simple()).toEqual([{ "": "v0" }]);

        const [row] = await sql`select '', 'abc', 1 as n`;
        expect(row).toEqual({ "": "", abc: "abc", n: 1 });
        expect(Object.keys(row)).toEqual(["", "abc", "n"]);
      });

      test("an unnamed column between a named and an indexed column", async () => {
        await container.ready;
        await using sql = connect();

        const expected = { "7": "v2", x: "v0", "": "v1" };
        const prepared = await sql`select 'v0' as x, 'v1' as '', 'v2' as \`7\``;
        expect(prepared).toEqual([expected]);
        expect(Object.keys(prepared[0])).toEqual(["7", "x", ""]);
        const simple = await sql`select 'v0' as x, 'v1' as '', 'v2' as \`7\``.simple();
        expect(simple).toEqual([expected]);
        expect(Object.keys(simple[0])).toEqual(["7", "x", ""]);
      });

      test("an unnamed column in a wide result set with an indexed column", async () => {
        await container.ready;
        await using sql = connect();

        const names = wide([40, ""], [41, "7"]);
        const expected = expectedRow(names);
        const columns = names.map((name, i) => `'v${i}' as \`${name}\``);
        // unsafe() without parameters takes the text protocol; binding the
        // unnamed column's value is what makes the first query a prepared one.
        columns[40] = "? as ``";
        const prepared = await sql.unsafe(`select ${columns.join(", ")}`, ["v40"]);
        expect(prepared).toEqual([expected]);
        expect(Object.keys(prepared[0])).toEqual(Object.keys(expected));
        columns[40] = "'v40' as ``";
        const simple = await sql.unsafe(`select ${columns.join(", ")}`);
        expect(simple).toEqual([expected]);
        expect(Object.keys(simple[0])).toEqual(Object.keys(expected));
      });
    },
  );
}
