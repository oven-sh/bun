// A `sql.reserve()` client dropped without `release()` / `using` kept its pool
// slot for the rest of the process: the connection's close handler retained
// the client (through its scope, and through state.reject -> promise ->
// client), so it was never even collectable. Once every slot leaked this way,
// every later query hung.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  // The `{ signal }` variant keeps a live AbortSignal (held by the test) wired
  // to the reservation, which must not keep the dropped client reachable.
  test.each([["reserve()", false] as const, ["reserve({ signal })", true] as const])(
    "a dropped %s client returns its pool slot on GC",
    async (_name, withSignal) => {
      await container.ready;
      // Force-close in the finally so a regression fails the assertion instead
      // of hanging in the disposer behind the leaked slot.
      const sql = new SQL({ url: url(), max: 1, idleTimeout: 5 });
      const controller = new AbortController();
      try {
        // Leak the client inside an inner scope so nothing on this frame
        // retains it once the inner async function returns.
        await (async () => {
          await sql.reserve(withSignal ? { signal: controller.signal } : undefined);
        })();

        let result: unknown = "pending";
        const probe = sql`select 42 as v`.then(
          ([{ v }]) => (result = v),
          e => (result = e),
        );
        // Drive GC until the FinalizationRegistry releases the slot; give up
        // after a bounded number of sweeps instead of waiting on wall-clock
        // time.
        for (let i = 0; i < 50 && result === "pending"; i++) {
          Bun.gc(true);
          await Bun.sleep(10);
        }
        await Promise.race([probe, Promise.resolve()]);
        expect(result).toBe(42);
        expect(controller.signal.aborted).toBe(false);
      } finally {
        // timeout: 0 falls through to graceful close today; a small positive
        // value reaches the forced-close path.
        await sql.close({ timeout: 0.1 });
      }
    },
  );

  test("collecting a client that was already released does not release its connection again", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5 });

    // Observes when the released client is actually collected, so the test
    // waits for the collection itself rather than for a number of GC passes.
    let collected = false;
    const observer = new FinalizationRegistry(() => (collected = true));
    await (async () => {
      const client = await sql.reserve();
      observer.register(client, undefined);
      client.release();
    })();
    // Hold the only connection while the released client is collected. A
    // second release() would put the connection back in the pool underneath
    // this reservation and the plain query below would run on it at once.
    const reserved = await sql.reserve();
    let served = false;
    let parked: Promise<{ v: number }[]>;
    try {
      for (let i = 0; i < 50 && !collected; i++) {
        Bun.gc(true);
        await Bun.sleep(10);
      }
      expect(collected).toBe(true);

      parked = sql`select 1 as v`.then(rows => ((served = true), rows));
      // A wrongly served query would be written to the connection before this
      // one, so it is answered before this round trip completes.
      await reserved`select 2 as v`;
      expect(served).toBe(false);
    } finally {
      reserved.release();
    }
    expect((await parked)[0].v).toBe(1);
  });

  // The close handler already returned the slot when the server killed the
  // connection; collecting the dropped client afterwards must not return it
  // twice, which would leave the reconnected slot permanently "busy".
  test("collecting a client whose connection died does not release its slot again", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5 });
    await using admin = new SQL({ url: url(), max: 1, idleTimeout: 5 });

    let collected = false;
    const observer = new FinalizationRegistry(() => (collected = true));
    await (async () => {
      const client = await sql.reserve();
      observer.register(client, undefined);
      const [{ pid }] = await client`select pg_backend_pid() as pid`;
      await admin`select pg_terminate_backend(${pid})`;
      // Rejects once the client has observed the close.
      await expect(client`select 1`).rejects.toBeDefined();
    })();

    for (let i = 0; i < 50 && !collected; i++) {
      Bun.gc(true);
      await Bun.sleep(10);
    }
    expect(collected).toBe(true);

    // Both need the reconnected slot to be accounted as free.
    expect((await sql`select 1 as v`)[0].v).toBe(1);
    using again = await sql.reserve();
    expect((await again`select 2 as v`)[0].v).toBe(2);
  });
});
