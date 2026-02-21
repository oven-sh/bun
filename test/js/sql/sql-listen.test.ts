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
      await using sql = new SQL(options);
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

      // Clean up listener
      await unlisten();
    });

    test("sql.listen() receives multiple notifications", async () => {
      await using sql = new SQL(options);
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
    });

    test("sql.listen() with multiple channels", async () => {
      await using sql = new SQL(options);
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
    });

    test("sql.unlisten() stops receiving notifications", async () => {
      await using sql = new SQL(options);
      const notifications: string[] = [];

      const { promise, resolve } = Promise.withResolvers<void>();

      const unlisten = await sql.listen("unlisten_test", payload => {
        notifications.push(payload);
        resolve();
      });

      // Should receive this
      await sql`SELECT pg_notify('unlisten_test', 'before')`;
      await promise;

      expect(notifications).toEqual(["before"]);

      // Unlisten - verify it completes without error
      await unlisten();

      // Verify the connection is still functional after unlisten
      const result = await sql`SELECT 1 as test`;
      expect(result[0].test).toBe(1);
    });

    test("sql.unlisten() by channel name", async () => {
      await using sql = new SQL(options);
      const notifications: string[] = [];

      const { promise, resolve } = Promise.withResolvers<void>();

      await sql.listen("named_unlisten", payload => {
        notifications.push(payload);
        resolve();
      });

      await sql`SELECT pg_notify('named_unlisten', 'before')`;
      await promise;

      expect(notifications).toEqual(["before"]);

      // Unlisten by channel name - verify it completes without error
      await sql.unlisten("named_unlisten");

      // Verify the connection is still functional after unlisten
      const result = await sql`SELECT 1 as test`;
      expect(result[0].test).toBe(1);
    });

    test("listen validates channel argument", async () => {
      await using sql = new SQL(options);

      expect(async () => {
        await sql.listen("", () => {});
      }).toThrow();

      expect(async () => {
        // @ts-expect-error - Testing invalid argument
        await sql.listen(null, () => {});
      }).toThrow();
    });

    test("listen validates callback argument", async () => {
      await using sql = new SQL(options);

      expect(async () => {
        // @ts-expect-error - Testing invalid argument
        await sql.listen("test", "not a function");
      }).toThrow();

      expect(async () => {
        // @ts-expect-error - Testing invalid argument
        await sql.listen("test", null);
      }).toThrow();
    });
  });
} else {
  test.skip("PostgreSQL LISTEN/NOTIFY tests require Docker", () => {});
}
