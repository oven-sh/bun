// sql.reserve({ signal }): a caller waiting for a connection can give up.
// Without cancellation, a reserve() whose promise is abandoned (for example
// the loser of a Promise.race timeout) still receives a connection once one
// frees up; nobody releases it, so the pool permanently shrinks and
// sql.end() never resolves (issue #39451).
//
// Every test owns its pool, so the tests run concurrently. Most pools have
// max: 1, which is what makes "the connection is busy" observable.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = (max = 1) =>
    new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max });
  // pg_advisory_lock key; no other test takes it
  const LOCK_KEY = 39454;
  const closed = { name: "PostgresError", code: "ERR_POSTGRES_CONNECTION_CLOSED", message: "Connection closed" };

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
    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
    const again = await sql.reserve();
    expect(await again`select 2 as x`).toEqual([{ x: 2 }]);
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
    const events: string[] = [];
    // registered before reserve(), so it runs first on dispatch
    controller.signal.addEventListener("abort", e => {
      events.push("user listener");
      e.stopImmediatePropagation();
    });
    const pending = sql.reserve({ signal: controller.signal });
    controller.abort(reason);
    try {
      await expect(pending).rejects.toBe(reason);
    } finally {
      reserved.release();
    }
    expect(events).toEqual(["user listener"]);

    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
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

    await expect(sql.reserve()).rejects.toMatchObject(closed);
  });

  test("abort while the pool is still establishing its first connection", async () => {
    await container.ready;
    await using sql = connect();

    const controller = new AbortController();
    const reason = new Error("gave up waiting");
    const pending = sql.reserve({ signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);

    expect(await sql`select 2 as x`).toEqual([{ x: 2 }]);
    await sql.end();
  });

  test("an already aborted signal rejects without taking a connection", async () => {
    await container.ready;
    await using sql = connect();

    const reason = new Error("already aborted");
    await expect(sql.reserve({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);

    // max is 1: this reserve() hangs if the rejected one took the connection
    const reserved = await sql.reserve();
    expect(await reserved`select 1 as x`).toEqual([{ x: 1 }]);
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
      expect(await reserved`select 3 as x`).toEqual([{ x: 3 }]);
    } finally {
      reserved.release();
    }
    // release() put the connection back, so a pool query gets it
    expect(await sql`select 4 as x`).toEqual([{ x: 4 }]);
    await sql.end();
  });

  test("a non-AbortSignal signal option rejects with ERR_INVALID_ARG_TYPE", async () => {
    await container.ready;
    await using sql = connect();

    await expect(sql.reserve({ signal: 123 as unknown as AbortSignal })).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "options.signal" property must be of type AbortSignal. Received type number (123)',
    });

    // the rejected call did not take the pool's only connection
    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
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
      const inflight = sql`select 1 as x`.execute();

      const controller = new AbortController();
      const reason = new Error("gave up waiting");
      const aborted = sql.reserve({ signal: controller.signal });
      controller.abort(reason);

      const order: string[] = [];
      const queryDone = sql`select 2 as x`.execute().then(rows => {
        order.push("query");
        return rows;
      });
      const secondReserve = sql.reserve();
      await expect(aborted).rejects.toBe(reason);

      const reserved = await secondReserve;
      order.push("reserve");
      reserved.release();

      expect(await queryDone).toEqual([{ x: 2 }]);
      expect(await inflight).toEqual([{ x: 1 }]);
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
      const quick = sql`select 1 as x`.execute();
      const firstReserve = sql.reserve();

      // only the quick connection can go idle, so it serves the reservation
      const reserved = await firstReserve;
      expect(await quick).toEqual([{ x: 1 }]);

      // No reservation is pending, so this query belongs on the blocked
      // connection at once, ahead of the reserve() issued right after it.
      const order: string[] = [];
      const queryDone = sql`select 2 as x`.execute().then(rows => {
        order.push("query");
        return rows;
      });
      const secondReserve = sql.reserve();

      // true: the locker session held the lock until now
      expect(await locker`select pg_advisory_unlock(${LOCK_KEY}::bigint) as unlocked`).toEqual([{ unlocked: true }]);
      await blocked;

      const reservedAgain = await secondReserve;
      order.push("reserve");
      reservedAgain.release();
      reserved.release();

      expect(await queryDone).toEqual([{ x: 2 }]);
      expect(order).toEqual(["query", "reserve"]);
      // closing the pool ends the session that now holds the lock
      await sql.end();
      await locker.end();
    });
  });
});
