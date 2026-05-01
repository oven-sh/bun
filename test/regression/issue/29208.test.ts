// https://github.com/oven-sh/bun/issues/29208
//
// MySQL DATETIME/TIMESTAMP values are deserialized through JSC's local-time
// constructor, so on any machine whose process TZ is not UTC the returned
// JS `Date` is off by the client's UTC offset. The `utcDate: true` connection
// option opts into interpreting the components as UTC so the value
// round-trips. The default (`utcDate` unset / false) keeps the historical
// local-time behaviour for compatibility.
//
// `bun test` forces TZ=Etc/UTC on the test runner, which masks the
// difference, so we set process.env.TZ before decoding and round-trip both
// DATETIME and TIMESTAMP via the binary (prepared) and text (simple)
// protocols.

import { SQL, randomUUIDv7 } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

// With TZ=Asia/Bangkok (UTC+7, no DST) the local-time constructor interprets
// (2024, 0, 15, 12, 30, 45, 678) as 2024-01-15T12:30:45.678+07:00
// = 2024-01-15T05:30:45.678Z. The MySQL server stores the UTC components
// "2024-01-15 05:30:45.678". Interpreting those as local time (+07:00) yields
// 2024-01-14T22:30:45.678Z.
const UTC_ISO = "2024-01-15T05:30:45.678Z" as const;
const LOCAL_ISO = "2024-01-14T22:30:45.678Z" as const;

async function runRoundTrip(url: string) {
  // Apply the non-UTC TZ *before* any Date is constructed or SQL query is
  // decoded — JSC's date cache reads $TZ lazily on its first use.
  const savedTz = process.env.TZ;
  process.env.TZ = "Asia/Bangkok";

  try {
    const sent = new Date(2024, 0, 15, 12, 30, 45, 678);
    expect(sent.toISOString()).toBe(UTC_ISO);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Bangkok");

    const tableName = "ts_29208_" + randomUUIDv7("hex").replaceAll("-", "");

    // Two connections: `local` doubles as the writer and as the default-mode
    // reader (`utcDate` omitted → defaults to false); `utc` opts in. The send
    // path encodes the Date's UTC components regardless of `utcDate`, so the
    // stored value is fixed.
    await using local = new SQL({ url, max: 1 });
    await using utc = new SQL({ url, max: 1, utcDate: true });
    await local`DROP TABLE IF EXISTS ${local(tableName)}`;
    await local`CREATE TABLE ${local(tableName)} (id INT PRIMARY KEY, ts DATETIME(3), tstz TIMESTAMP(3))`;

    try {
      await local`INSERT INTO ${local(tableName)} (id, ts, tstz) VALUES (${1}, ${sent}, ${sent})`;

      const read = async (sql: InstanceType<typeof SQL>) => {
        // Binary (prepared statement) protocol.
        const [bin] = (await sql`SELECT ts, tstz FROM ${sql(tableName)} WHERE id = 1`) as any[];
        // Text (simple query) protocol.
        const [txt] = (await sql`SELECT ts, tstz FROM ${sql(tableName)} WHERE id = 1`.simple()) as any[];
        return {
          binaryDatetime: (bin.ts as Date).toISOString(),
          binaryTimestamp: (bin.tstz as Date).toISOString(),
          textDatetime: (txt.ts as Date).toISOString(),
          textTimestamp: (txt.tstz as Date).toISOString(),
        };
      };

      // ── utcDate: true — every column, binary and text, must decode to the
      // same UTC instant the client sent.
      expect(await read(utc)).toEqual({
        binaryDatetime: UTC_ISO,
        binaryTimestamp: UTC_ISO,
        textDatetime: UTC_ISO,
        textTimestamp: UTC_ISO,
      });

      // ── utcDate omitted (default false) — historical local-time decoding
      // is preserved: the stored UTC components are re-interpreted as
      // Asia/Bangkok local time, shifting the result by -7h.
      expect(await read(local)).toEqual({
        binaryDatetime: LOCAL_ISO,
        binaryTimestamp: LOCAL_ISO,
        textDatetime: LOCAL_ISO,
        textTimestamp: LOCAL_ISO,
      });

      // ── utcDate: false (explicit) behaves identically to omitting it.
      {
        await using explicitFalse = new SQL({ url, max: 1, utcDate: false });
        expect(await read(explicitFalse)).toEqual({
          binaryDatetime: LOCAL_ISO,
          binaryTimestamp: LOCAL_ISO,
          textDatetime: LOCAL_ISO,
          textTimestamp: LOCAL_ISO,
        });
      }
    } finally {
      await local`DROP TABLE IF EXISTS ${local(tableName)}`;
    }
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
}

// ─── Docker path (used in CI) ───────────────────────────────────────────────
// Not `concurrent: true` — this test mutates process.env.TZ, which is global.
// Running in the default serial mode keeps the TZ flip isolated from any
// other concurrent tests.
if (isDockerEnabled()) {
  describeWithContainer("issue #29208 (containerized MySQL)", { image: "mysql_plain" }, container => {
    beforeAll(() => container.ready);
    test("utcDate option gates UTC decoding of DATETIME/TIMESTAMP under non-UTC TZ", async () => {
      await runRoundTrip(`mysql://root@${container.host}:${container.port}/bun_sql_test`);
    });
  });
}

// ─── Local-server path (used in dev/reproduction shells without Docker) ────
//
// Detection order:
//   1. BUN_TEST_LOCAL_MYSQL_URL — explicit override.
//   2. mysql://bun_test:bun_test_pw@127.0.0.1:3306/bun_sql_test — the farm
//      convention; auto-provisioned via `mysql -u root` if reachable.
//
// Skipped cleanly if neither is available.
describe("issue #29208 (local MySQL)", () => {
  let resolvedUrl: string | undefined;

  beforeAll(async () => {
    const explicitUrl = process.env.BUN_TEST_LOCAL_MYSQL_URL;
    if (explicitUrl) {
      resolvedUrl = explicitUrl;
      return;
    }

    // Idempotently auto-provision the farm-convention user. If the mysql
    // CLI is missing or root isn't trusted, provisioning fails silently and
    // the test becomes a no-op.
    try {
      await using proc = Bun.spawn({
        cmd: ["mysql", "-u", "root"],
        stdin: new TextEncoder().encode(
          `CREATE DATABASE IF NOT EXISTS bun_sql_test;
           CREATE USER IF NOT EXISTS 'bun_test'@'%' IDENTIFIED BY 'bun_test_pw';
           GRANT ALL ON bun_sql_test.* TO 'bun_test'@'%';
           FLUSH PRIVILEGES;`,
        ),
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await proc.exited) === 0) {
        resolvedUrl = "mysql://bun_test:bun_test_pw@127.0.0.1:3306/bun_sql_test";
      }
    } catch {
      // mysql CLI unavailable — no local server path, rely on Docker above.
    }
  });

  test("utcDate option gates UTC decoding of DATETIME/TIMESTAMP under non-UTC TZ", async () => {
    if (!resolvedUrl) {
      // No local MySQL — skip cleanly. CI relies on the Docker path above.
      return;
    }
    await runRoundTrip(resolvedUrl);
  });
});
