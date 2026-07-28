import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled } from "harness";
import path from "path";

// A Postgres `timestamp` (WITHOUT TIME ZONE) carries no offset, so the binary
// path decodes it as UTC (µs since 2000-01-01). The simple/text path must do
// the same — otherwise it goes through JS Date.parse and is read as local time,
// making the two protocols disagree on non-UTC hosts. `timestamptz` and `date`
// must keep decoding correctly.
//
// The fixture runs against a real Postgres server (docker-compose in CI, or a
// DATABASE_URL/local instance otherwise) and prints "OK TZ=<tz> offsetMin=<n>"
// only when binary and text decode to the same instant for every column.

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

if (isDockerEnabled()) {
  // CI: run against the docker-compose Postgres service.
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
} else {
  // No docker daemon (e.g. local/sandboxed environments). If a Postgres server
  // is reachable at DATABASE_URL or the conventional local address, exercise
  // the fixture there so the round-trip is still covered.
  const url = process.env.DATABASE_URL || "postgres://bun_sql_test@127.0.0.1:5432/bun_sql_test";

  describe.each(TIMEZONES)("postgres (local) TZ=%s", TZ => {
    test.concurrent("TIMESTAMP decode is UTC on both protocols", async () => {
      const { stdout, stderr, exitCode } = await runFixture(url, TZ);
      // The fixture prints "CONNECTED" once it reaches the server. If it never
      // got that far, there's no Postgres to talk to here; the docker-gated
      // branch above provides the CI coverage.
      if (!stdout.includes("CONNECTED")) {
        if (process.env.DATABASE_URL) {
          throw new Error(
            `sql-postgres-datetime-roundtrip: DATABASE_URL was provided but fixture never reached CONNECTED\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          );
        }
        console.warn("sql-postgres-datetime-roundtrip: no Postgres reachable at " + url + "; skipping assertions");
        return;
      }
      assertRoundTrip(stdout, stderr, TZ);
      expect(exitCode).toBe(0);
    });
  });
}
