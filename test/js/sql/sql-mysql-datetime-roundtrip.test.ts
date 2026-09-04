import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "path";

// A JS Date bound to a MySQL DATETIME/TIMESTAMP and read back must be the same
// instant regardless of the process timezone. Encode breaks the Date's epoch-ms
// into Y/M/D h:m:s via pure-UTC arithmetic, so decode has to treat those
// components as UTC too — if it interprets them as local time, the round-trip
// silently shifts by the machine's UTC offset.
//
// The fixture runs against a real MySQL server (docker-compose in CI, or a
// BUN_TEST_SERVICE_mysql_plain override otherwise) and prints
// "OK TZ=<tz> offsetMin=<n>" only when every Date round-trips to the same
// instant.

const TIMEZONES = ["Etc/UTC", "America/New_York", "Asia/Tokyo"];
const fixture = path.join(import.meta.dir, "sql-mysql-datetime-tz-fixture.ts");

function runFixture(url: string, TZ: string, caPath = "") {
  return Bun.spawnSync([bunExe(), fixture], {
    env: { ...bunEnv, MYSQL_URL: url, CA_PATH: caPath, TZ },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function assertRoundTrip(stdout: string, stderr: string, TZ: string) {
  // On a round-trip mismatch the fixture writes `FAIL TZ=… offsetMin=…` plus the
  // per-row `diffMin` breakdown to stderr, then exits 1. Assert it's empty so a
  // CI failure surfaces *which* dates drifted and by how much, not just a bare
  // "CONNECTED" vs "OK" mismatch.
  expect(stderr).toBe("");
  // "OK TZ=<tz>" only prints when all three Dates round-trip to the same instant.
  expect(stdout).toContain(`OK TZ=${TZ}`);
  // And the child runtime must actually have adopted the injected timezone —
  // a non-zero offset for the non-UTC zones — otherwise a silently-unapplied TZ
  // would degenerate all three runs into the UTC case and stop exercising the
  // local-time decode bug.
  expect(stdout).toMatch(TZ === "Etc/UTC" ? /offsetMin=0\b/ : /offsetMin=-?[1-9]/);
}

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  describe.each(TIMEZONES)("TZ=%s", TZ => {
    test("DATETIME Date round-trip is the identity", async () => {
      await container.ready;
      const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, stderr, exitCode } = runFixture(url, TZ);
      const out = String(stdout);
      expect(out).toContain("CONNECTED");
      assertRoundTrip(out, String(stderr), TZ);
      expect(exitCode).toBe(0);
    });
  });
});
