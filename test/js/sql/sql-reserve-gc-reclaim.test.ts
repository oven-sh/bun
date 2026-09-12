// A `sql.reserve()` client dropped without `release()` / `using` kept its pool
// slot for the rest of the process: the connection's close handler retained
// the client (through its scope, and through state.reject -> promise ->
// client), so it was never even collectable. Once every slot leaked this way,
// every later query hung.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// One GC pass from a timer callback, resolved one macrotask later so the
// registry callbacks it queued have run. GC from the awaiting continuation
// itself can still see the settled work's stale stack slots (conservative
// scanning) and keep the object alive for a while on release builds.
function collectOnce(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(() => {
    Bun.gc(true);
    setTimeout(resolve, 0);
  }, 0);
  return promise;
}

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
        sql`select 42 as v`.then(
          ([{ v }]) => (result = v),
          e => (result = e),
        );
        // Drive GC until the registry releases the slot, with a bounded number
        // of passes.
        for (let i = 0; i < 50 && result === "pending"; i++) {
          await collectOnce();
        }
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
        await collectOnce();
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
      await expect(client`select 1`).rejects.toBeInstanceOf(Error);
    })();

    for (let i = 0; i < 50 && !collected; i++) {
      await collectOnce();
    }
    expect(collected).toBe(true);

    // Both need the reconnected slot to be accounted as free.
    expect((await sql`select 1 as v`)[0].v).toBe(1);
    using again = await sql.reserve();
    expect((await again`select 2 as v`)[0].v).toBe(2);
  });

  // `client.begin()` returned without the caller holding `client`: the running
  // transaction must keep the client alive, or collecting it would hand the
  // connection, with its transaction still open, to the next pool caller.
  test("a dropped client is not collected while its begin() is running, and is reclaimed after", async () => {
    await container.ready;
    // Force-closed in the finally: on a regression the parked query below
    // never runs, and a graceful close would wait for it.
    const sql = new SQL({ url: url(), max: 1, idleTimeout: 5 });
    const gate = Promise.withResolvers<void>();
    try {
      let collected = false;
      const observer = new FinalizationRegistry(() => (collected = true));
      const started = Promise.withResolvers<void>();
      let served = false;
      let servedDuringTransaction: boolean | null = null;
      const transaction = (async () => {
        const client = await sql.reserve();
        observer.register(client, undefined);
        return client.begin(async tx => {
          await tx`select 1`;
          started.resolve();
          await gate.promise;
          // A plain query wrongly served on this connection was written before
          // this statement, so it has been answered by the time this resolves.
          await tx`select 2`;
          servedDuringTransaction = served;
        });
      })();
      // transaction cannot resolve before the gate opens, so it only wins the
      // race by rejecting, which surfaces a setup failure instead of a hang.
      await Promise.race([started.promise, transaction]);

      // Nothing but the running transaction references the client now.
      for (let i = 0; i < 10; i++) {
        await collectOnce();
      }
      expect(collected).toBe(false);

      const parked = sql`select 3 as v`.then(rows => ((served = true), rows));
      gate.resolve();
      await transaction;
      expect(servedDuringTransaction).toBe(false);

      // Once the transaction has settled the client is collectable and its
      // slot comes back, which is what lets the parked query run.
      for (let i = 0; i < 50 && !served; i++) {
        await collectOnce();
      }
      expect({ collected, served }).toEqual({ collected: true, served: true });
      expect((await parked)[0].v).toBe(3);
    } finally {
      gate.resolve();
      await sql.close({ timeout: 0.1 });
    }
  });

  // close({ timeout }) whose in-flight work drains in time resolves without
  // closing or releasing anything today, so a client dropped after it is the
  // same leak as one that was never closed and must still be reclaimed.
  test("a client dropped after close({ timeout }) drained its work still returns its slot", async () => {
    await container.ready;
    const sql = new SQL({ url: url(), max: 1, idleTimeout: 5 });
    try {
      await (async () => {
        const client = await sql.reserve();
        const inflight = client`select pg_sleep(0.01)`;
        await client.close({ timeout: 5 });
        await inflight;
      })();

      let result: unknown = "pending";
      sql`select 4 as v`.then(
        ([{ v }]) => (result = v),
        e => (result = e),
      );
      for (let i = 0; i < 50 && result === "pending"; i++) {
        await collectOnce();
      }
      expect(result).toBe(4);
    } finally {
      await sql.close({ timeout: 0.1 });
    }
  });

  // The finished transaction's `tx` object must not keep the dropped client
  // (and so its slot) alive through the settle callbacks that pin the client
  // while the transaction runs.
  test("a tx kept after its reserved begin() finished does not keep the dropped client's slot", async () => {
    await container.ready;
    const sql = new SQL({ url: url(), max: 1, idleTimeout: 5 });
    try {
      let escaped: unknown;
      await (async () => {
        const client = await sql.reserve();
        await client.begin(async tx => {
          escaped = tx;
          await tx`select 1`;
        });
      })();

      let result: unknown = "pending";
      sql`select 5 as v`.then(
        ([{ v }]) => (result = v),
        e => (result = e),
      );
      for (let i = 0; i < 50 && result === "pending"; i++) {
        await collectOnce();
      }
      expect({ result, escapedIsFunction: typeof escaped }).toEqual({ result: 5, escapedIsFunction: "function" });
    } finally {
      await sql.close({ timeout: 0.1 });
    }
  });
});
