import { SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { isDockerEnabled } from "harness";

// Use docker-compose infrastructure
import * as dockerCompose from "../../docker/index.ts";

if (isDockerEnabled()) {
  describe("PostgreSQL LISTEN/NOTIFY", async () => {
    let container: { port: number; host: string };
    let options: Bun.SQL.PostgresOrMySQLOptions;

    const info = await dockerCompose.ensure("postgres_plain");
    container = {
      port: info.ports[5432],
      host: info.host,
    };

    options = {
      db: "bun_sql_test",
      username: "bun_sql_test",
      host: container.host,
      port: container.port,
      max: 2, // Need at least 2 connections for listen/notify
    };

    afterAll(async () => {
      if (!process.env.BUN_KEEP_DOCKER) {
        await dockerCompose.down();
      }
    });

    test("sql.listen() receives notifications", async () => {
      const sql = new SQL(options);
      const notifications: string[] = [];

      const { promise, resolve } = Promise.withResolvers<void>();

      // Set up listener
      const unlisten = await sql.listen("test_channel", payload => {
        notifications.push(payload);
        if (notifications.length === 1) {
          resolve();
        }
      });

      // Send notification from the same connection pool
      await sql`SELECT pg_notify('test_channel', 'hello world')`;

      // Wait for notification to be received
      await promise;

      expect(notifications).toEqual(["hello world"]);

      // Clean up
      await unlisten();
      await sql.close();
    });

    test("sql.listen() receives multiple notifications", async () => {
      const sql = new SQL(options);
      const notifications: string[] = [];

      const { promise, resolve } = Promise.withResolvers<void>();

      const unlisten = await sql.listen("multi_channel", payload => {
        notifications.push(payload);
        if (notifications.length === 3) {
          resolve();
        }
      });

      // Send multiple notifications
      await sql`SELECT pg_notify('multi_channel', 'first')`;
      await sql`SELECT pg_notify('multi_channel', 'second')`;
      await sql`SELECT pg_notify('multi_channel', 'third')`;

      await promise;

      expect(notifications).toEqual(["first", "second", "third"]);

      await unlisten();
      await sql.close();
    });

    test("sql.listen() with multiple channels", async () => {
      const sql = new SQL(options);
      const channelA: string[] = [];
      const channelB: string[] = [];

      const { promise: promiseA, resolve: resolveA } = Promise.withResolvers<void>();
      const { promise: promiseB, resolve: resolveB } = Promise.withResolvers<void>();

      const unlistenA = await sql.listen("channel_a", payload => {
        channelA.push(payload);
        resolveA();
      });

      const unlistenB = await sql.listen("channel_b", payload => {
        channelB.push(payload);
        resolveB();
      });

      await sql`SELECT pg_notify('channel_a', 'message A')`;
      await sql`SELECT pg_notify('channel_b', 'message B')`;

      await Promise.all([promiseA, promiseB]);

      expect(channelA).toEqual(["message A"]);
      expect(channelB).toEqual(["message B"]);

      await unlistenA();
      await unlistenB();
      await sql.close();
    });

    test("sql.unlisten() stops receiving notifications", async () => {
      const sql = new SQL(options);
      const notifications: string[] = [];

      const { promise, resolve } = Promise.withResolvers<void>();

      const unlisten = await sql.listen("unlisten_test", payload => {
        notifications.push(payload);
        resolve();
      });

      // Should receive this
      await sql`SELECT pg_notify('unlisten_test', 'before')`;
      await promise;

      // Unlisten
      await unlisten();

      // Should NOT receive this (give it a moment to potentially arrive)
      await sql`SELECT pg_notify('unlisten_test', 'after')`;
      await Bun.sleep(100);

      expect(notifications).toEqual(["before"]);

      await sql.close();
    });

    test("sql.unlisten() by channel name", async () => {
      const sql = new SQL(options);
      const notifications: string[] = [];

      const { promise, resolve } = Promise.withResolvers<void>();

      await sql.listen("named_unlisten", payload => {
        notifications.push(payload);
        resolve();
      });

      await sql`SELECT pg_notify('named_unlisten', 'before')`;
      await promise;

      // Unlisten by channel name
      await sql.unlisten("named_unlisten");

      // Should NOT receive this
      await sql`SELECT pg_notify('named_unlisten', 'after')`;
      await Bun.sleep(100);

      expect(notifications).toEqual(["before"]);

      await sql.close();
    });

    test("listen validates channel argument", async () => {
      const sql = new SQL(options);

      // @ts-expect-error - Testing invalid argument
      await expect(sql.listen("", () => {})).rejects.toThrow();
      // @ts-expect-error - Testing invalid argument
      await expect(sql.listen(null, () => {})).rejects.toThrow();

      await sql.close();
    });

    test("listen validates callback argument", async () => {
      const sql = new SQL(options);

      // @ts-expect-error - Testing invalid argument
      await expect(sql.listen("test", "not a function")).rejects.toThrow();
      // @ts-expect-error - Testing invalid argument
      await expect(sql.listen("test", null)).rejects.toThrow();

      await sql.close();
    });
  });
} else {
  test.skip("PostgreSQL LISTEN/NOTIFY tests require Docker", () => {});
}
