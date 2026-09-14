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
// cover it for both adapters. The fixture runs in a child process because the
// failure mode is the process dying. All wire bytes come from ./wire-frames.ts.

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

async function decodeThroughMockServer(
  adapter: "postgres" | "mysql",
  protocol: "simple" | "prepared",
  names: string[],
) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, adapter, protocol, JSON.stringify(names)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let rows: unknown = null;
  try {
    rows = JSON.parse(stdout);
  } catch {}
  // stderr is not asserted (debug/ASan builds print benign notes); it is part
  // of the compared object so the crash report shows up when the fixture dies.
  return { rows, exitCode, signalCode: proc.signalCode, stderr };
}

function expectedRow(names: string[]) {
  return Object.fromEntries(names.map((name, i) => [name, `v${i}`]));
}

describe.each(["postgres", "mysql"] as const)("%s: a result set with an empty column name", adapter => {
  // The text protocol of each adapter carries every scenario; the row object is
  // built the same way on both protocols, so the prepared (binary) protocol
  // only needs to prove it reaches the same place.
  test.concurrent.each(Object.entries(scenarios))(
    '%s decodes to a row with a "" key',
    async (_, names) => {
      expect(await decodeThroughMockServer(adapter, "simple", names)).toEqual({
        rows: [expectedRow(names)],
        exitCode: 0,
        signalCode: null,
        stderr: expect.any(String),
      });
    },
    30_000,
  );

  test.concurrent(
    "a single unnamed column decodes over the prepared-statement protocol",
    async () => {
      expect(await decodeThroughMockServer(adapter, "prepared", [""])).toEqual({
        rows: [{ "": "v0" }],
        exitCode: 0,
        signalCode: null,
        stderr: expect.any(String),
      });
    },
    30_000,
  );
});

// Real-server coverage: `select ''` is enough to get an unnamed column out of
// MySQL and MariaDB; the client decodes both servers' result sets identically.
// Same gating as sql-mariadb-json.test.ts: only attempt the container when
// something can provide it, since a half-working local docker would fail the
// suite instead of skipping it.
const mariadbProvided =
  !!process.env.BUN_TEST_SERVICE_mariadb_plain || !!process.env.BUN_DOCKER_COORDINATOR || (isCI && isDockerEnabled());
if (!mariadbProvided) {
  describe.todo("mariadb: select '' returns a row with a \"\" key");
} else {
  describeWithContainer("mariadb", { image: "mariadb_plain" }, container => {
    test("select '' returns a row with a \"\" key", async () => {
      await container.ready;
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

      expect(await sql`select ''`).toEqual([{ "": "" }]);
      expect(await sql`select ''`.simple()).toEqual([{ "": "" }]);
      expect(await sql`select '', 'abc', 1 as n`).toEqual([{ "": "", abc: "abc", n: 1 }]);
    });
  });
}
