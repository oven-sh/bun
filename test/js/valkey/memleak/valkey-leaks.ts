import { describe, expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { ConnectionType, createClient, isEnabled } from "../test-utils";
import { numeric } from "harness";

const gc = globalThis.gc || globalThis.Bun?.gc || (() => {});

describe.skipIf(!isEnabled)("Valkey doesn't leak memory", () => {
  // The Pearson correlation coefficient tells you how much two things move
  // together on a scale from -1 to 1, where -1 means when one goes up the other
  // always goes down, 0 means they're completely unrelated, and 1 means they
  // always move up and down together. 0.10 is considered an extremely weak
  // correlation, and 0.3 is considered weak.

  describe("properly cleaning up a client doesn't leak", async () => {
    test("client count isn't correlated with leaks", async () => {
      const maxCorrelation = 0.15; // We expect almost no correlation between client count and leak size.
      const clientCountPoints = numeric.expSpace(1, 500, 32, 10).map(Math.floor);

      const runTest = async (clientCount: number): Promise<number> => {
        const before = heapStats();
        {
          gc(true);
          for (let i = 0; i < clientCount; i++) {
            const client = createClient(ConnectionType.TCP);
            await client.connect();
            client.close();
          }
          gc(true);
        }
        const after = heapStats();
        return after.heapSize - before.heapSize;
      };

      const leakedStats = await Promise.all(clientCountPoints.map(runTest));

      expect(numeric.stats.computePearsonCorrelation(clientCountPoints, leakedStats)).toBeLessThan(maxCorrelation);
    }, 15_000);
  });

  describe("publishing messages doesn't leak", async () => {
    test("message count isn't correlated with leaks", async () => {
      // This test sends out a bunch of messages and ensures that memory usage
      // is about the same for each number of messages we send.
      const messageCountPoints = numeric.expSpace(1, 100, 32, 10).map(Math.floor);
      // We expect almost no correlation between message count and leak size.
      // We've decided to have a pretty large correlation threshold because we
      // don't have that much data to work with.
      const maxCorrelation = 0.3;

      const publisher = createClient(ConnectionType.TCP);
      await publisher.connect();

      const runTest = async (msgCount: number): Promise<number> => {
        const before = heapStats();

        {
          gc(true);
          await Promise.all(
            Array.from({ length: msgCount }).map(() => publisher.publish("memleak-test", "x".repeat(1024))),
          );
          gc(true);
        }

        const after = heapStats();

        return after.heapSize - before.heapSize;
      };

      const leakedStats = await Promise.all(messageCountPoints.map(runTest));

      expect(numeric.stats.computePearsonCorrelation(messageCountPoints, leakedStats)).toBeLessThan(maxCorrelation);

      publisher.close();
    }, 15_000);
  });

  describe("subscriptions don't leak", async () => {
    test("repeated subs and unsubs don't leak", async () => {
      const subscriptionCountPoints = numeric.expSpace(1, 100, 16, 10).map(Math.floor);
      // We expect almost no correlation between subscription count and leak size.
      const maxCorrelation = 0.15;

      const subscriber = createClient(ConnectionType.TCP);
      await subscriber.connect();

      const runTest = async (subCount: number): Promise<number> => {
        const before = heapStats();

        {
          gc(true);
          await Promise.all(
            Array.from({ length: subCount }).map(async () => {
              const listener = () => {};
              await subscriber.subscribe("foo-channel", listener);
              await subscriber.unsubscribe("foo-channel", listener);
            }),
          );
          gc(true);
        }

        const after = heapStats();

        return after.heapSize - before.heapSize;
      };

      const leakedStats = await Promise.all(subscriptionCountPoints.map(runTest));

      expect(numeric.stats.computePearsonCorrelation(subscriptionCountPoints, leakedStats)).toBeLessThan(
        maxCorrelation,
      );

      subscriber.close();
    });

    test("sub count isn't correlated with leaked memory", async () => {
      const subscriptionCountPoints = numeric.expSpace(1, 100, 64, 10).map(Math.floor);
      // We expect almost no correlation between subscription count and leak size.
      const maxCorrelation = 0.15;

      const subscriber = createClient(ConnectionType.TCP);
      await subscriber.connect();

      const runTest = async (subCount: number): Promise<number> => {
        const before = heapStats();

        {
          gc(true);
          await Promise.all(
            Array.from({ length: subCount }).map(async () => {
              const listener = () => {};
              await subscriber.subscribe("foo-channel", listener);
            }),
          );
          await subscriber.unsubscribe("foo-channel");
          gc(true);
        }

        const after = heapStats();

        return after.heapSize - before.heapSize;
      };

      const leakedStats = await Promise.all(subscriptionCountPoints.map(runTest));

      expect(numeric.stats.computePearsonCorrelation(subscriptionCountPoints, leakedStats)).toBeLessThan(
        maxCorrelation,
      );

      subscriber.close();
    }, 15_000);
  });
});
