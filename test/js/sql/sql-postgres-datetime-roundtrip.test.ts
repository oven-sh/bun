import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "path";

// A Postgres `timestamp` (WITHOUT TIME ZONE) carries no offset, so the binary
// path decodes it as UTC (µs since 2000-01-01). The simple/text path must do
// the same — otherwise it goes through JS Date.parse and is read as local time,
// making the two protocols disagree on non-UTC hosts. `timestamptz` and `date`
// must keep decoding correctly, including the seconds-resolution offsets the
// server prints for historical instants and the always-text array types.
//
// The fixture runs against a real Postgres server (docker-compose in CI, or a
// BUN_TEST_SERVICE_postgres_plain override otherwise) and prints
// "OK TZ=<tz> offsetMin=<n>" only when binary and text decode to the same
// instant for every column.

const TIMEZONES = ["Etc/UTC", "America/New_York", "Asia/Tokyo"];
const fixture = path.join(import.meta.dir, "sql-postgres-datetime-tz-fixture.ts");

// The fixture creates its own uniquely-named TEMPORARY table on its own
// connection, so runs for different TZ values are independent and can spawn
// concurrently.
async function runFixture(url: string, TZ: string, caPath = "") {
  await using proc = Bun.spawn([bunExe(), fixture], {
    env: { ...bunEnv, DATABASE_URL: url, CA_PATH: caPath, TZ },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function assertRoundTrip(stdout: string, stderr: string, TZ: string) {
  // On a mismatch the fixture writes `FAIL TZ=… offsetMin=…` plus a per-column
  // breakdown to stderr, then exits 1. Assert it's empty so a CI failure
  // surfaces *which* value drifted, not just a bare "CONNECTED" vs "OK"
  // mismatch. (ASAN emits a harmless interposition warning.)
  const diagnostics = stderr
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(diagnostics).toBe("");
  // "OK TZ=<tz>" only prints when binary and text agree for every column.
  expect(stdout).toContain(`OK TZ=${TZ}`);
  // And the child runtime must actually have adopted the injected timezone —
  // a non-zero offset for the non-UTC zones — otherwise a silently-unapplied TZ
  // would degenerate all three runs into the UTC case and stop exercising the
  // local-time decode bug.
  expect(stdout).toMatch(TZ === "Etc/UTC" ? /offsetMin=0\b/ : /offsetMin=-?[1-9]/);
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  describe.each(TIMEZONES)("TZ=%s", TZ => {
    test.concurrent("TIMESTAMP decode is UTC on both protocols", async () => {
      await container.ready;
      const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, stderr, exitCode } = await runFixture(url, TZ);
      expect(stdout).toContain("CONNECTED");
      assertRoundTrip(stdout, stderr, TZ);
      expect(exitCode).toBe(0);
    });
  });
});
