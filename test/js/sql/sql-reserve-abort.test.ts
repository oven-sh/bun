// sql.reserve({ signal }): a caller waiting for a connection can give up.
// Without cancellation, a reserve() whose promise is abandoned (for example
// the loser of a Promise.race timeout) still receives a connection once one
// frees up; nobody releases it, so the pool permanently shrinks and
// sql.end() never resolves (issue #39451).
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = (max = 1) =>
    new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max });
  // pg_advisory_lock key; no other test takes it
  const LOCK_KEY = 39454;

  test("aborting a queued reserve() keeps the pool intact and lets end() resolve", async () => {
    await container.ready;
    await using sql = connect();
    const reserved = await sql.reserve();

    const controller = new AbortController();
    const reason = new Error("gave up waiting");
    const pending = sql.reserve({ signal: controller.signal });
    controller.abort(reason);
    try {
      await expect(pending).rejects.toBe(reason);
    } finally {
      reserved.release();
    }

    // the aborted reservation must not have consumed the pool's only
    // connection: a query and a fresh reserve both succeed
    expect((await sql`select 1 as x`)[0].x).toBe(1);
    const again = await sql.reserve();
    again.release();

    // hangs forever if the aborted reserve still holds a connection
    await sql.end();
  });

  test("a user abort listener calling stopImmediatePropagation() cannot starve the cancellation", async () => {
    await container.ready;
    await using sql = connect();
    const reserved = await sql.reserve();

    const controller = new AbortController();
    const reason = new Error("gave up waiting");
    // registered before reserve(), so it runs first on dispatch
    controller.signal.addEventListener("abort", e => e.stopImmediatePropagation());
    const pending = sql.reserve({ signal: controller.signal });
    controller.abort(reason);
    try {
      await expect(pending).rejects.toBe(reason);
    } finally {
      reserved.release();
    }
    await sql.end();
  });

  test("end() resolves when an aborted reserve was the only pending work", async () => {
    await container.ready;
    await using sql = connect();

    const controller = new AbortController();
    const reason = new Error("gave up waiting");
    const pending = sql.reserve({ signal: controller.signal });
    // the queued reservation is pending work the graceful close waits for
    const ended = sql.end();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await ended;
  });

  test("abort while the pool is still establishing its first connection", async () => {
    await container.ready;
    await using sql = connect();

    const controller = new AbortController();
    const reason = new Error("gave up waiting");
    const pending = sql.reserve({ signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);

    expect((await sql`select 2 as x`)[0].x).toBe(2);
    await sql.end();
  });

  test("an already aborted signal rejects without taking a connection", async () => {
    await container.ready;
    await using sql = connect();

    const reason = new Error("already aborted");
    await expect(sql.reserve({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);

    const reserved = await sql.reserve();
    reserved.release();
    await sql.end();
  });

  test("aborting after reserve() resolved does not revoke the connection", async () => {
    await container.ready;
    await using sql = connect();

    const controller = new AbortController();
    const reserved = await sql.reserve({ signal: controller.signal });
    controller.abort();

    try {
      expect((await reserved`select 3 as x`)[0].x).toBe(3);
    } finally {
      reserved.release();
    }
    await sql.end();
  });

  test("a non-AbortSignal signal option rejects with ERR_INVALID_ARG_TYPE", async () => {
    await container.ready;
    await using sql = connect();

    await expect(sql.reserve({ signal: 123 as unknown as AbortSignal })).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
    });
    await sql.end();
  });

  // A reserve() that finds every connection busy picks one of them and stops
  // the pool from pipelining more queries onto it, so that it drains toward the
  // reservation. Once the reservation is gone, that hold has no purpose and
  // queries must be pipelined onto the connection again.
  //
  // The tests observe the hold through ordering, not timing. A query issued
  // while a stale hold is in place is parked until the connection goes idle,
  // and at that moment a pending reserve() takes the connection first. A query
  // pipelined onto the connection finishes before the connection goes idle, so
  // it resolves before that reserve() does.
  describe("a connection held for a reservation that no longer exists", () => {
    test("aborting the reservation gives the connection back to queries", async () => {
      await container.ready;
      await using sql = connect();
      await sql`select 1`;

      // execute() binds a query to the pool's only connection synchronously.
      // Nothing yields before the `await` below, so the connection is busy
      // during the whole reserve / abort / query / reserve sequence.
      const inflight = sql`select 1`.execute();

      const controller = new AbortController();
      const reason = new Error("gave up waiting");
      const aborted = sql.reserve({ signal: controller.signal });
      controller.abort(reason);

      const order: string[] = [];
      const queryDone = sql`select 2 as x`.execute().then(() => {
        order.push("query");
      });
      const secondReserve = sql.reserve();
      await expect(aborted).rejects.toBe(reason);

      const reserved = await secondReserve;
      order.push("reserve");
      reserved.release();

      await queryDone;
      await inflight;
      expect(order).toEqual(["query", "reserve"]);
      await sql.end();
    });

    test("serving the reservation from another connection gives the held one back to queries", async () => {
      await container.ready;
      // A separate single-connection pool (one session) holds the advisory
      // lock, so a query for it in the pool below stays in flight until this
      // test unlocks through the same session.
      await using locker = connect();
      await locker`select pg_advisory_lock(${LOCK_KEY}::bigint)`;

      // reserving both connections brings both up; releasing them puts both
      // back into the idle set
      await using sql = connect(2);
      const first = await sql.reserve();
      const second = await sql.reserve();
      first.release();
      second.release();

      // Each connection gets one query. reserve() holds the first busy
      // connection it sees, which is the one the blocked query went to.
      const blocked = sql`select pg_advisory_lock(${LOCK_KEY}::bigint)`.execute();
      const quick = sql`select 1`.execute();
      const firstReserve = sql.reserve();

      // only the quick connection can go idle, so it serves the reservation
      const reserved = await firstReserve;
      await quick;

      // No reservation is pending, so this query belongs on the blocked
      // connection at once, ahead of the reserve() issued right after it.
      const order: string[] = [];
      const queryDone = sql`select 2 as x`.execute().then(() => {
        order.push("query");
      });
      const secondReserve = sql.reserve();

      await locker`select pg_advisory_unlock(${LOCK_KEY}::bigint)`;
      await blocked;

      const reservedAgain = await secondReserve;
      order.push("reserve");
      reservedAgain.release();
      reserved.release();

      await queryDone;
      expect(order).toEqual(["query", "reserve"]);
      // closing the pool ends the session that now holds the lock
      await sql.end();
      await locker.end();
    });
  });
});
