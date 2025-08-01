import { beforeEach, describe, expect, test } from "bun:test";
import { ConnectionType, createClient, ctx, expectType, isEnabled } from "../test-utils";

/**
 * Test suite covering Redis set operations
 * - Basic operations (SADD, SREM, SISMEMBER)
 * - Set retrieval (SMEMBERS, SCARD)
 * - Set manipulation (SPOP, SRANDMEMBER)
 * - Set operations (SUNION, SINTER, SDIFF)
 */
describe.skipIf(!isEnabled)("Valkey: Set Data Type Operations", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });

  describe("Basic Set Operations", () => {
    test("SADD and SISMEMBER commands", async () => {
      const key = ctx.generateKey("set-test");

      // Add a single member
      const singleAddResult = await ctx.redis.sadd(key, "member1");
      console.log("singleAddResult", singleAddResult);
      expectType<number>(singleAddResult, "number");
      expect(singleAddResult).toBe(1); // 1 new member added

      // Add multiple members using sendCommand
      const multiAddResult = await ctx.redis.send("SADD", [key, "member2", "member3", "member1"]);
      expectType<number>(multiAddResult, "number");
      expect(multiAddResult).toBe(2); // 2 new members added, 1 duplicate ignored

      // Check if member exists
      const isFirstMember = await ctx.redis.sismember(key, "member1");
      expect(isFirstMember).toBe(true);

      // Check if non-existent member exists
      const isNonMember = await ctx.redis.sismember(key, "nonexistent");
      expect(isNonMember).toBe(false);
    });

    test("SREM command", async () => {
      const key = ctx.generateKey("srem-test");

      // Add multiple members
      await ctx.redis.send("SADD", [key, "member1", "member2", "member3", "member4"]);

      // Remove a single member
      const singleRemResult = await ctx.redis.srem(key, "member1");
      expectType<number>(singleRemResult, "number");
      expect(singleRemResult).toBe(1); // 1 member removed

      // Remove multiple members using sendCommand
      const multiRemResult = await ctx.redis.send("SREM", [key, "member2", "member3", "nonexistent"]);
      expectType<number>(multiRemResult, "number");
      expect(multiRemResult).toBe(2); // 2 members removed, non-existent member ignored

      // Verify only member4 remains
      const members = await ctx.redis.smembers(key);
      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBe(1);
      expect(members[0]).toBe("member4");
    });

    test("SMEMBERS command", async () => {
      const key = ctx.generateKey("smembers-test");

      // Add members one at a time using direct sadd method
      await ctx.redis.sadd(key, "apple");
      await ctx.redis.sadd(key, "banana");
      await ctx.redis.sadd(key, "cherry");

      // Get all members using direct smembers method
      const members = await ctx.redis.smembers(key);
      expect(Array.isArray(members)).toBe(true);

      // Sort for consistent snapshot since set members can come in any order
      const sortedMembers = [...members].sort();
      expect(sortedMembers).toMatchInlineSnapshot(`
        [
          "apple",
          "banana",
          "cherry",
        ]
      `);
    });

    test("SCARD command", async () => {
      const key = ctx.generateKey("scard-test");

      // Add members - using direct sadd method for first item, then send for multiple
      await ctx.redis.sadd(key, "item1");
      await ctx.redis.send("SADD", [key, "item2", "item3", "item4"]);

      // Get set cardinality (size)
      // TODO: When a direct scard method is implemented, use that instead
      const size = await ctx.redis.send("SCARD", [key]);
      expectType<number>(size, "number");
      expect(size).toMatchInlineSnapshot(`4`);

      // Remove some members - using direct srem method for first item, then send for second
      await ctx.redis.srem(key, "item1");
      await ctx.redis.send("SREM", [key, "item2"]);

      // Check size again
      const updatedSize = await ctx.redis.send("SCARD", [key]);
      expectType<number>(updatedSize, "number");
      expect(updatedSize).toMatchInlineSnapshot(`2`);
    });
  });

  describe("Set Manipulation", () => {
    test("SPOP command", async () => {
      const key = ctx.generateKey("spop-test");

      // Add members - using send for multiple values
      // TODO: When a SADD method that supports multiple values is added, use that instead
      await ctx.redis.send("SADD", [key, "red", "green", "blue", "yellow", "purple"]);

      // Pop a single member - using direct spop method
      const popResult = await ctx.redis.spop(key);
      expect(popResult).toBeDefined();
      expect(typeof popResult).toBe("string");

      // Pop multiple members
      // TODO: When SPOP method that supports count parameter is added, use that instead
      const multiPopResult = await ctx.redis.send("SPOP", [key, "2"]);
      expect(Array.isArray(multiPopResult)).toBe(true);
      expect(multiPopResult.length).toMatchInlineSnapshot(`2`);

      // Verify remaining members
      // TODO: When a direct scard method is added, use that instead
      const remainingCount = await ctx.redis.send("SCARD", [key]);
      expectType<number>(remainingCount, "number");
      expect(remainingCount).toMatchInlineSnapshot(`2`); // 5 original - 1 - 2 = 2 remaining
    });

    test("SRANDMEMBER command", async () => {
      const key = ctx.generateKey("srandmember-test");

      // Add members - first with direct sadd, then with send for remaining
      await ctx.redis.sadd(key, "one");
      await ctx.redis.send("SADD", [key, "two", "three", "four", "five"]);

      // Get a random member - using direct srandmember method
      const randResult = await ctx.redis.srandmember(key);
      expect(randResult).toBeDefined();
      expect(typeof randResult).toBe("string");

      // Get multiple random members
      // TODO: When srandmember method with count parameter is added, use that instead
      const multiRandResult = await ctx.redis.send("SRANDMEMBER", [key, "3"]);
      expect(Array.isArray(multiRandResult)).toBe(true);
      expect(multiRandResult.length).toMatchInlineSnapshot(`3`);

      // Verify set is unchanged
      const count = await ctx.redis.send("SCARD", [key]);
      expectType<number>(count, "number");
      expect(count).toMatchInlineSnapshot(`5`); // All members still present unlike SPOP
    });

    test("SMOVE command", async () => {
      const sourceKey = ctx.generateKey("smove-source");
      const destinationKey = ctx.generateKey("smove-dest");

      // Set up source and destination sets
      await ctx.redis.send("SADD", [sourceKey, "a", "b", "c"]);
      await ctx.redis.send("SADD", [destinationKey, "c", "d", "e"]);

      // Move a member from source to destination
      const moveResult = await ctx.redis.send("SMOVE", [sourceKey, destinationKey, "b"]);
      expectType<number>(moveResult, "number");
      expect(moveResult).toBe(1); // 1 indicates success

      // Try to move a non-existent member
      const failedMoveResult = await ctx.redis.send("SMOVE", [sourceKey, destinationKey, "z"]);
      expectType<number>(failedMoveResult, "number");
      expect(failedMoveResult).toBe(0); // 0 indicates failure

      // Verify source set (should have "a" and "c" left)
      const sourceMembers = await ctx.redis.smembers(sourceKey);
      expect(Array.isArray(sourceMembers)).toBe(true);
      expect(sourceMembers.length).toBe(2);
      expect(sourceMembers).toContain("a");
      expect(sourceMembers).toContain("c");
      expect(sourceMembers).not.toContain("b");

      // Verify destination set (should have "b", "c", "d", "e")
      const destMembers = await ctx.redis.smembers(destinationKey);
      expect(Array.isArray(destMembers)).toBe(true);
      expect(destMembers.length).toBe(4);
      expect(destMembers).toContain("b");
      expect(destMembers).toContain("c");
      expect(destMembers).toContain("d");
      expect(destMembers).toContain("e");
    });
  });

  describe("Set Operations", () => {
    test("SUNION and SUNIONSTORE commands", async () => {
      const set1 = ctx.generateKey("sunion-1");
      const set2 = ctx.generateKey("sunion-2");
      const set3 = ctx.generateKey("sunion-3");
      const destSet = ctx.generateKey("sunion-dest");

      // Set up test sets
      await ctx.redis.send("SADD", [set1, "a", "b", "c"]);
      await ctx.redis.send("SADD", [set2, "c", "d", "e"]);
      await ctx.redis.send("SADD", [set3, "e", "f", "g"]);

      // Get union of two sets
      const unionResult = await ctx.redis.send("SUNION", [set1, set2]);
      expect(Array.isArray(unionResult)).toBe(true);
      expect(unionResult.length).toBe(5);
      expect(unionResult).toContain("a");
      expect(unionResult).toContain("b");
      expect(unionResult).toContain("c");
      expect(unionResult).toContain("d");
      expect(unionResult).toContain("e");

      // Store union of three sets
      const storeResult = await ctx.redis.send("SUNIONSTORE", [destSet, set1, set2, set3]);
      expectType<number>(storeResult, "number");
      expect(storeResult).toBe(7); // 7 unique members across all sets

      // Verify destination set
      const destMembers = await ctx.redis.smembers(destSet);
      expect(Array.isArray(destMembers)).toBe(true);
      expect(destMembers.length).toBe(7);
      expect(destMembers).toContain("a");
      expect(destMembers).toContain("b");
      expect(destMembers).toContain("c");
      expect(destMembers).toContain("d");
      expect(destMembers).toContain("e");
      expect(destMembers).toContain("f");
      expect(destMembers).toContain("g");
    });

    test("SINTER and SINTERSTORE commands", async () => {
      const set1 = ctx.generateKey("sinter-1");
      const set2 = ctx.generateKey("sinter-2");
      const set3 = ctx.generateKey("sinter-3");
      const destSet = ctx.generateKey("sinter-dest");

      // Set up test sets
      await ctx.redis.send("SADD", [set1, "a", "b", "c", "d"]);
      await ctx.redis.send("SADD", [set2, "c", "d", "e"]);
      await ctx.redis.send("SADD", [set3, "a", "c", "e"]);

      // Get intersection of two sets
      const interResult = await ctx.redis.send("SINTER", [set1, set2]);
      expect(Array.isArray(interResult)).toBe(true);
      expect(interResult.length).toBe(2);
      expect(interResult).toContain("c");
      expect(interResult).toContain("d");

      // Store intersection of three sets
      const storeResult = await ctx.redis.send("SINTERSTORE", [destSet, set1, set2, set3]);
      expectType<number>(storeResult, "number");
      expect(storeResult).toBe(1); // Only "c" is in all three sets

      // Verify destination set
      const destMembers = await ctx.redis.smembers(destSet);
      expect(Array.isArray(destMembers)).toBe(true);
      expect(destMembers.length).toBe(1);
      expect(destMembers[0]).toBe("c");
    });

    test("SDIFF and SDIFFSTORE commands", async () => {
      const set1 = ctx.generateKey("sdiff-1");
      const set2 = ctx.generateKey("sdiff-2");
      const destSet = ctx.generateKey("sdiff-dest");

      // Set up test sets
      await ctx.redis.send("SADD", [set1, "a", "b", "c", "d"]);
      await ctx.redis.send("SADD", [set2, "c", "d", "e"]);

      // Get difference (elements in set1 that aren't in set2)
      const diffResult = await ctx.redis.send("SDIFF", [set1, set2]);
      expect(Array.isArray(diffResult)).toBe(true);
      expect(diffResult.length).toBe(2);
      expect(diffResult).toContain("a");
      expect(diffResult).toContain("b");

      // Store difference
      const storeResult = await ctx.redis.send("SDIFFSTORE", [destSet, set1, set2]);
      expectType<number>(storeResult, "number");
      expect(storeResult).toBe(2); // "a" and "b" are only in set1

      // Verify destination set
      const destMembers = await ctx.redis.smembers(destSet);
      expect(Array.isArray(destMembers)).toBe(true);
      expect(destMembers.length).toBe(2);
      expect(destMembers).toContain("a");
      expect(destMembers).toContain("b");
    });
  });

  describe("Scanning Operations", () => {
    test("SSCAN command", async () => {
      const key = ctx.generateKey("sscan-test");

      // Create a set with many members
      const memberCount = 100;
      const members = [];
      for (let i = 0; i < memberCount; i++) {
        members.push(`member:${i}`);
      }

      await ctx.redis.send("SADD", [key, ...members]);

      // Use SSCAN to iterate through members
      const scanResult = await ctx.redis.send("SSCAN", [key, "0", "COUNT", "20"]);
      expect(Array.isArray(scanResult)).toBe(true);
      expect(scanResult.length).toBe(2);

      const cursor = scanResult[0];
      const items = scanResult[1];

      // Cursor should be either "0" (done) or a string number
      expect(typeof cursor).toBe("string");

      // Items should be an array of members
      expect(Array.isArray(items)).toBe(true);

      // All results should match our expected pattern
      for (const item of items) {
        expect(item.startsWith("member:")).toBe(true);
      }

      // Verify MATCH pattern works
      const patternResult = await ctx.redis.send("SSCAN", [key, "0", "MATCH", "member:1*", "COUNT", "1000"]);
      expect(Array.isArray(patternResult)).toBe(true);
      expect(patternResult.length).toBe(2);

      const patternItems = patternResult[1];
      expect(Array.isArray(patternItems)).toBe(true);

      // Should return only members that match the pattern (member:1, member:10-19, etc)
      // There should be at least "member:1" and "member:10" through "member:19"
      expect(patternItems.length).toBeGreaterThan(0);

      for (const item of patternItems) {
        expect(item.startsWith("member:1")).toBe(true);
      }
    });
  });
});
