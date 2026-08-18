// sql.reserve({ signal }): a caller waiting for a connection can give up.
// Without cancellation, a reserve() whose promise is abandoned (for example
// the loser of a Promise.race timeout) still receives a connection once one
// frees up; nobody releases it, so the pool permanently shrinks and
// sql.end() never resolves (issue #39451).
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = () => new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max: 1 });

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
});
