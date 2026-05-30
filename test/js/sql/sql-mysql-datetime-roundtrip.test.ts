import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled } from "harness";
import path from "path";

// A JS Date bound to a MySQL DATETIME/TIMESTAMP and read back must be the same
// instant regardless of the process timezone. Encode breaks the Date's epoch-ms
// into Y/M/D h:m:s via pure-UTC arithmetic, so decode has to treat those
// components as UTC too — if it interprets them as local time, the round-trip
// silently shifts by the machine's UTC offset.
//
// The fixture runs against a real MySQL server (docker-compose in CI, or a
// MYSQL_URL/local instance otherwise) and prints "OK TZ=<tz> offsetMin=<n>"
// only when every Date round-trips to the same instant.

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
  // "CONNECTED" vs "OK" mismatch. (ASAN emits a harmless interposition warning.)
  const diagnostics = stderr
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(diagnostics).toBe("");
  // "OK TZ=<tz>" only prints when all three Dates round-trip to the same instant.
  expect(stdout).toContain(`OK TZ=${TZ}`);
  // And the child runtime must actually have adopted the injected timezone —
  // a non-zero offset for the non-UTC zones — otherwise a silently-unapplied TZ
  // would degenerate all three runs into the UTC case and stop exercising the
  // local-time decode bug.
  expect(stdout).toMatch(TZ === "Etc/UTC" ? /offsetMin=0\b/ : /offsetMin=-?[1-9]/);
}

if (isDockerEnabled()) {
  // CI: run against the docker-compose MySQL service.
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
} else {
  // No docker daemon (e.g. local/sandboxed environments). If a MySQL server is
  // reachable at MYSQL_URL or the conventional local address, exercise the
  // fixture there so the round-trip is still covered without a mock.
  const url = process.env.MYSQL_URL || "mysql://bun@127.0.0.1:3306/bun_sql_test";

  describe.each(TIMEZONES)("mysql (local) TZ=%s", TZ => {
    test("DATETIME Date round-trip is the identity", () => {
      const { stdout, stderr, exitCode } = runFixture(url, TZ);
      const out = String(stdout);
      // The fixture prints "CONNECTED" once it reaches the server. If it never
      // got that far, there's no MySQL to talk to here; the docker-gated branch
      // above provides the CI coverage.
      if (!out.includes("CONNECTED")) {
        if (process.env.MYSQL_URL) {
          throw new Error(
            `sql-mysql-datetime-roundtrip: MYSQL_URL was provided but fixture never reached CONNECTED\nstdout:\n${out}\nstderr:\n${String(stderr)}`,
          );
        }
        console.warn("sql-mysql-datetime-roundtrip: no MySQL reachable at " + url + "; skipping assertions");
        return;
      }
      assertRoundTrip(out, String(stderr), TZ);
      expect(exitCode).toBe(0);
    });
  });
}
