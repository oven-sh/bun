import { SQL } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "sql-empty-column-name.fixture.ts");

// A result set wider than JSFinalObject::maxInlineCapacity (62) is built by a different path than a narrow one,
// and a column named like an array index ("7") selects a third path that interleaves names and indices.
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

// Column i of every result set, mock or real, holds "v<i>".
const expectedRow = (names: string[]) => Object.fromEntries(names.map((name, i) => [name, `v${i}`]));

// PostgreSQL rejects `as ""`, so there the name can only come from a proxy or a broken server.
test.concurrent(
  'postgres: every mock-server scenario decodes to a row with a "" key, over both protocols',
  async () => {
    const jobs = (["simple", "prepared"] as const).flatMap(protocol =>
      Object.entries(scenarios).map(([scenario, names]) => ({ scenario, protocol, names })),
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, JSON.stringify(jobs)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // One line per job, in job order: after a crash the list stops at the job that died.
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
    expect(results.map(({ rows }) => Object.keys(rows[0]))).toEqual(
      jobs.map(({ names }) => Object.keys(expectedRow(names))),
    );
  },
);

for (const image of ["mysql_plain", "mariadb_plain"]) {
  describeWithContainer(`${image}: a result set with an empty column name`, { image, concurrent: true }, container => {
    const connect = () => new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

    test("select '' returns a row with a \"\" key over both protocols", async () => {
      await container.ready;
      await using sql = connect();

      expect(await sql`select ''`).toEqual([{ "": "" }]);
      expect(await sql`select ''`.simple()).toEqual([{ "": "" }]);

      const [row] = await sql`select '', 'abc', 1 as n`;
      expect(row).toEqual({ "": "", abc: "abc", n: 1 });
      expect(Object.keys(row)).toEqual(["", "abc", "n"]);
    });

    test.each(Object.entries(scenarios))("%s, over both protocols", async (_, names) => {
      await container.ready;
      await using sql = connect();

      const expected = expectedRow(names);
      const select = sql.unsafe("select " + names.map((name, i) => `'v${i}' as \`${name}\``).join(", "));
      for (const rows of [await sql`${select}`, await sql`${select}`.simple()]) {
        expect(rows).toEqual([expected]);
        expect(Object.keys(rows[0])).toEqual(Object.keys(expected));
      }
    });
  });
}
