// `connectionTimeout` previously bounded only the TCP/handshake phase. A caller
// waiting for a free pool slot (all `max` connections reserved) had no
// deadline, and a `sql.reserve()` handle dropped without `release()` / `using`
// was never reclaimed, so a single leak permanently shrank the pool and at
// zero the app hung forever. These tests cover the acquisition timeout and the
// GC safety net that returns a leaked reserved handle to the pool.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("connectionTimeout bounds waiting for a free pool slot", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 0.5 });
    using reserved = await sql.reserve();

    // Both a plain query and a second reserve() must time out rather than
    // stay pending forever.
    const queryErr = await sql`select 1 as v`.then(
      () => null,
      e => e,
    );
    expect(queryErr).toBeInstanceOf(SQL.PostgresError);
    expect(queryErr.code).toBe("ERR_POSTGRES_CONNECTION_TIMEOUT");
    expect(queryErr.message).toMatch(/pool/);

    const reserveErr = await sql.reserve().then(
      () => null,
      e => e,
    );
    expect(reserveErr?.code).toBe("ERR_POSTGRES_CONNECTION_TIMEOUT");

    // The reserved connection that caused the timeout is still usable, and
    // its slot returns to the pool on dispose.
    const [{ v }] = await reserved`select 7 as v`;
    expect(v).toBe(7);
  });

  test("a dropped reserve() handle returns its pool slot on GC", async () => {
    await container.ready;
    // connectionTimeout: 0 disables the acquisition timeout so only the GC
    // safety net can unblock the second query. Force-close in the finally so
    // a regression fails the assertion instead of hanging the disposer.
    const sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 0 });
    try {
      // Leak the handle inside an inner scope so nothing on this frame
      // retains it once the inner async function returns.
      await (async () => {
        await sql.reserve();
      })();

      let result: unknown = "pending";
      const probe = sql`select 42 as v`.then(
        ([{ v }]) => (result = v),
        e => (result = e),
      );
      // Drive GC until the FinalizationRegistry releases the slot; give up
      // after a bounded number of sweeps instead of waiting on wall-clock
      // time.
      for (let i = 0; i < 200 && result === "pending"; i++) {
        Bun.gc(true);
        await Bun.sleep(10);
      }
      await Promise.race([probe, Promise.resolve()]);
      expect(result).toBe(42);
    } finally {
      // timeout: 0 falls through to graceful close today; a small positive
      // value reaches the forced-close path so a regression surfaces the
      // assertion instead of hanging here.
      await sql.close({ timeout: 0.1 });
    }
  });

  test("sql.begin() times out instead of hanging when the pool is fully reserved", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 0.5 });
    using _reserved = await sql.reserve();

    const err = await sql
      .begin(async tx => tx`select 1`)
      .then(
        () => null,
        e => e,
      );
    expect(err?.code).toBe("ERR_POSTGRES_CONNECTION_TIMEOUT");
  });
});
