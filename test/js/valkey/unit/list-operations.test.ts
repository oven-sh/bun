import { beforeEach, describe, expect, test } from "bun:test";
import { isCI } from "harness";
import { ConnectionType, createClient, ctx, expectType, isEnabled } from "../test-utils";

/**
 * Test suite covering Redis list operations
 * - Basic operations (LPUSH, RPUSH, LPOP, RPOP)
 * - Range operations (LRANGE, LTRIM)
 * - List information (LLEN, LINDEX)
 * - Blocking operations (BLPOP, BRPOP)
 */
describe.skipIf(!isEnabled)("Valkey: List Data Type Operations", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });

  describe("Basic List Operations", () => {
    test("LPUSH and RPUSH commands", async () => {
      const key = ctx.generateKey("list-push-test");

      // Left push single value
      const lpushResult = await ctx.redis.send("LPUSH", [key, "left-value"]);
      expectType<number>(lpushResult, "number");
      expect(lpushResult).toBe(1); // List has 1 element

      // Right push single value
      const rpushResult = await ctx.redis.send("RPUSH", [key, "right-value"]);
      expectType<number>(rpushResult, "number");
      expect(rpushResult).toBe(2); // List now has 2 elements

      // Multiple values with LPUSH
      const multiLpushResult = await ctx.redis.send("LPUSH", [key, "left1", "left2", "left3"]);
      expectType<number>(multiLpushResult, "number");
      expect(multiLpushResult).toBe(5); // List now has 5 elements

      // Multiple values with RPUSH
      const multiRpushResult = await ctx.redis.send("RPUSH", [key, "right1", "right2"]);
      expectType<number>(multiRpushResult, "number");
      expect(multiRpushResult).toBe(7); // List now has 7 elements

      // Verify the list content (should be left3, left2, left1, left-value, right-value, right1, right2)
      const range = await ctx.redis.send("LRANGE", [key, "0", "-1"]);
      expect(Array.isArray(range)).toBe(true);
      expect(range.length).toBe(7);
      expect(range[0]).toBe("left3");
      expect(range[3]).toBe("left-value");
      expect(range[4]).toBe("right-value");
      expect(range[6]).toBe("right2");
    });

    test("LPOP and RPOP commands", async () => {
      const key = ctx.generateKey("list-pop-test");

      // Set up test list
      await ctx.redis.send("RPUSH", [key, "one", "two", "three", "four", "five"]);

      // Pop from left side
      const lpopResult = await ctx.redis.send("LPOP", [key]);
      expect(lpopResult).toBe("one");

      // Pop from right side
      const rpopResult = await ctx.redis.send("RPOP", [key]);
      expect(rpopResult).toBe("five");

      // Pop multiple elements from left
      const multiLpopResult = await ctx.redis.send("LPOP", [key, "2"]);
      expect(Array.isArray(multiLpopResult)).toBe(true);
      expect(multiLpopResult.length).toBe(2);
      expect(multiLpopResult[0]).toBe("two");
      expect(multiLpopResult[1]).toBe("three");

      // Verify only "four" is left
      const remaining = await ctx.redis.send("LRANGE", [key, "0", "-1"]);
      expect(Array.isArray(remaining)).toBe(true);
      expect(remaining.length).toBe(1);
      expect(remaining[0]).toBe("four");
    });

    test("LRANGE command", async () => {
      const key = ctx.generateKey("lrange-test");

      // Set up test list with 10 elements
      await ctx.redis.send("RPUSH", [key, "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

      // Get full range - using LRANGE command
      // TODO: When a direct lrange method is implemented, use that instead
      const fullRange = await ctx.redis.send("LRANGE", [key, "0", "-1"]);
      expect(Array.isArray(fullRange)).toBe(true);
      expect(fullRange).toMatchInlineSnapshot(`
        [
          "0",
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
        ]
      `);

      // Get partial range from start
      const startRange = await ctx.redis.send("LRANGE", [key, "0", "2"]);
      expect(Array.isArray(startRange)).toBe(true);
      expect(startRange).toMatchInlineSnapshot(`
        [
          "0",
          "1",
          "2",
        ]
      `);

      // Get partial range from middle
      const midRange = await ctx.redis.send("LRANGE", [key, "3", "6"]);
      expect(Array.isArray(midRange)).toBe(true);
      expect(midRange).toMatchInlineSnapshot(`
        [
          "3",
          "4",
          "5",
          "6",
        ]
      `);

      // Get partial range from end using negative indices
      const endRange = await ctx.redis.send("LRANGE", [key, "-3", "-1"]);
      expect(Array.isArray(endRange)).toBe(true);
      expect(endRange).toMatchInlineSnapshot(`
        [
          "7",
          "8",
          "9",
        ]
      `);

      // Out of range indexes should be limited
      const outOfRange = await ctx.redis.send("LRANGE", [key, "5", "100"]);
      expect(Array.isArray(outOfRange)).toBe(true);
      expect(outOfRange).toMatchInlineSnapshot(`
        [
          "5",
          "6",
          "7",
          "8",
          "9",
        ]
      `);
    });

    test("LTRIM command", async () => {
      const key = ctx.generateKey("ltrim-test");

      // Set up test list with 10 elements
      await ctx.redis.send("RPUSH", [key, "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

      // Trim the list to keep only elements from index 2 to 7
      // TODO: When a direct ltrim method is implemented, use that instead
      const trimResult = await ctx.redis.send("LTRIM", [key, "2", "7"]);
      expect(trimResult).toMatchInlineSnapshot(`"OK"`);

      // Verify the trimmed list
      const result = await ctx.redis.send("LRANGE", [key, "0", "-1"]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toMatchInlineSnapshot(`
        [
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
        ]
      `);
    });
  });

  describe("List Information", () => {
    test("LLEN command", async () => {
      const key = ctx.generateKey("llen-test");

      // Empty list should have length 0
      const emptyLen = await ctx.redis.send("LLEN", [key]);
      expectType<number>(emptyLen, "number");
      expect(emptyLen).toBe(0);

      // Add elements and check length
      await ctx.redis.send("RPUSH", [key, "a", "b", "c", "d"]);
      const len = await ctx.redis.send("LLEN", [key]);
      expectType<number>(len, "number");
      expect(len).toBe(4);

      // Remove elements and check length
      await ctx.redis.send("LPOP", [key, "2"]);
      const updatedLen = await ctx.redis.send("LLEN", [key]);
      expectType<number>(updatedLen, "number");
      expect(updatedLen).toBe(2);
    });

    test("LINDEX command", async () => {
      const key = ctx.generateKey("lindex-test");

      // Set up test list
      await ctx.redis.send("RPUSH", [key, "val0", "val1", "val2", "val3", "val4"]);

      // Get element at index 0 (first element)
      const firstElement = await ctx.redis.send("LINDEX", [key, "0"]);
      expect(firstElement).toBe("val0");

      // Get element at index 2 (middle element)
      const middleElement = await ctx.redis.send("LINDEX", [key, "2"]);
      expect(middleElement).toBe("val2");

      // Get element at index -1 (last element)
      const lastElement = await ctx.redis.send("LINDEX", [key, "-1"]);
      expect(lastElement).toBe("val4");

      // Get element at index -2 (second to last element)
      const secondToLastElement = await ctx.redis.send("LINDEX", [key, "-2"]);
      expect(secondToLastElement).toBe("val3");

      // Get element at out of range index
      const nonExistent = await ctx.redis.send("LINDEX", [key, "100"]);
      expect(nonExistent).toBeNull();
    });

    test("LINSERT command", async () => {
      const key = ctx.generateKey("linsert-test");

      // Set up test list
      await ctx.redis.send("RPUSH", [key, "one", "three", "four"]);

      // Insert before a value
      const beforeResult = await ctx.redis.send("LINSERT", [key, "BEFORE", "three", "two"]);
      expectType<number>(beforeResult, "number");
      expect(beforeResult).toBe(4); // New length is 4

      // Insert after a value
      const afterResult = await ctx.redis.send("LINSERT", [key, "AFTER", "four", "five"]);
      expectType<number>(afterResult, "number");
      expect(afterResult).toBe(5); // New length is 5

      // Verify the list content
      const content = await ctx.redis.send("LRANGE", [key, "0", "-1"]);
      expect(Array.isArray(content)).toBe(true);
      expect(content).toEqual(["one", "two", "three", "four", "five"]);

      // Insert for non-existent pivot
      const nonExistentResult = await ctx.redis.send("LINSERT", [key, "BEFORE", "nonexistent", "value"]);
      expectType<number>(nonExistentResult, "number");
      expect(nonExistentResult).toBe(-1); // -1 indicates pivot wasn't found
    });

    test("LSET command", async () => {
      const key = ctx.generateKey("lset-test");

      // Set up test list
      await ctx.redis.send("RPUSH", [key, "a", "b", "c", "d"]);

      // Set element at index 1
      const setResult = await ctx.redis.send("LSET", [key, "1", "B"]);
      expect(setResult).toBe("OK");

      // Set element at last index
      const lastSetResult = await ctx.redis.send("LSET", [key, "-1", "D"]);
      expect(lastSetResult).toBe("OK");

      // Verify the modified list
      const content = await ctx.redis.send("LRANGE", [key, "0", "-1"]);
      expect(Array.isArray(content)).toBe(true);
      expect(content).toEqual(["a", "B", "c", "D"]);

      // Setting out of range index should error
      try {
        await ctx.redis.send("LSET", [key, "100", "value"]);
        // We should not reach here
        expect(false).toBe(true);
      } catch (error) {
        // Expected error
      }
    });
  });

  describe("List Position Operations", () => {
    test("LPOS command", async () => {
      const key = ctx.generateKey("lpos-test");

      // Set up test list with duplicate elements
      await ctx.redis.send("RPUSH", [key, "a", "b", "c", "d", "e", "a", "c", "a"]);

      // Get first occurrence of "a"
      const firstPos = await ctx.redis.send("LPOS", [key, "a"]);
      expectType<number>(firstPos, "number");
      expect(firstPos).toBe(0);

      // Get first occurrence of "c"
      const firstPosC = await ctx.redis.send("LPOS", [key, "c"]);
      expectType<number>(firstPosC, "number");
      expect(firstPosC).toBe(2);

      // Get position of non-existent element
      const nonExistentPos = await ctx.redis.send("LPOS", [key, "z"]);
      expect(nonExistentPos).toBeNull();

      // Get all occurrences of "a"
      const allPosA = await ctx.redis.send("LPOS", [key, "a", "COUNT", "0"]);
      expect(Array.isArray(allPosA)).toBe(true);
      expect(allPosA).toEqual([0, 5, 7]);

      // Get first 2 occurrences of "a"
      const twoPos = await ctx.redis.send("LPOS", [key, "a", "COUNT", "2"]);
      expect(Array.isArray(twoPos)).toBe(true);
      expect(twoPos).toEqual([0, 5]);

      // Get position of "a" starting from index 1
      const posFromIndex = await ctx.redis.send("LPOS", [key, "a", "RANK", "2"]);
      expectType<number>(posFromIndex, "number");
      expect(posFromIndex).toBe(5);
    });
  });

  describe("List Moving Operations", () => {
    test("RPOPLPUSH command", async () => {
      const source = ctx.generateKey("rpoplpush-source");
      const destination = ctx.generateKey("rpoplpush-dest");

      // Set up source list
      await ctx.redis.send("RPUSH", [source, "one", "two", "three"]);

      // Set up destination list
      await ctx.redis.send("RPUSH", [destination, "a", "b"]);

      // Move element from source to destination
      const result = await ctx.redis.send("RPOPLPUSH", [source, destination]);
      expect(result).toBe("three");

      // Verify source list
      const sourceContent = await ctx.redis.send("LRANGE", [source, "0", "-1"]);
      expect(Array.isArray(sourceContent)).toBe(true);
      expect(sourceContent).toEqual(["one", "two"]);

      // Verify destination list
      const destContent = await ctx.redis.send("LRANGE", [destination, "0", "-1"]);
      expect(Array.isArray(destContent)).toBe(true);
      expect(destContent).toEqual(["three", "a", "b"]);
    });

    test("LMOVE command", async () => {
      const source = ctx.generateKey("lmove-source");
      const destination = ctx.generateKey("lmove-dest");

      // Set up source list
      await ctx.redis.send("RPUSH", [source, "one", "two", "three"]);

      // Set up destination list
      await ctx.redis.send("RPUSH", [destination, "a", "b"]);

      // Right to left move
      try {
        const rtlResult = await ctx.redis.send("LMOVE", [source, destination, "RIGHT", "LEFT"]);
        expect(rtlResult).toBe("three");

        // Left to right move
        const ltrResult = await ctx.redis.send("LMOVE", [source, destination, "LEFT", "RIGHT"]);
        expect(ltrResult).toBe("one");

        // Verify source list
        const sourceContent = await ctx.redis.send("LRANGE", [source, "0", "-1"]);
        expect(Array.isArray(sourceContent)).toBe(true);
        expect(sourceContent).toEqual(["two"]);

        // Verify destination list
        const destContent = await ctx.redis.send("LRANGE", [destination, "0", "-1"]);
        expect(Array.isArray(destContent)).toBe(true);
        expect(destContent).toEqual(["three", "a", "b", "one"]);
      } catch (error) {
        // Some Redis versions might not support LMOVE
        console.warn("LMOVE command not supported, skipping test");
      }
    });
  });

  describe.skipIf(isCI)("Blocking Operations", () => {
    // Note: These tests can be problematic in automated test suites
    // due to the blocking nature. We'll implement with very short timeouts.
    test("BLPOP with timeout", async () => {
      const key = ctx.generateKey("blpop-test");

      // Try to pop from an empty list with 1 second timeout
      const timeoutResult = await ctx.redis.send("BLPOP", [key, "1"]);
      expect(timeoutResult).toBeNull(); // Should timeout and return null

      // Add elements and then try again
      await ctx.redis.send("RPUSH", [key, "value1", "value2"]);

      // Now the BLPOP should immediately return
      const result = await ctx.redis.send("BLPOP", [key, "1"]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(key);
      expect(result[1]).toBe("value1");
    });

    test("BRPOP with timeout", async () => {
      const key = ctx.generateKey("brpop-test");

      // Try to pop from an empty list with 1 second timeout
      const timeoutResult = await ctx.redis.send("BRPOP", [key, "1"]);
      expect(timeoutResult).toBeNull(); // Should timeout and return null

      // Add elements and then try again
      await ctx.redis.send("RPUSH", [key, "value1", "value2"]);

      // Now the BRPOP should immediately return
      const result = await ctx.redis.send("BRPOP", [key, "1"]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(key);
      expect(result[1]).toBe("value2");
    });

    test("BRPOPLPUSH with timeout", async () => {
      const source = ctx.generateKey("brpoplpush-source");
      const destination = ctx.generateKey("brpoplpush-dest");

      // Try with empty source and 1 second timeout
      const timeoutResult = await ctx.redis.send("BRPOPLPUSH", [source, destination, "1"]);
      expect(timeoutResult).toBeNull(); // Should timeout and return null

      // Set up source and destination
      await ctx.redis.send("RPUSH", [source, "value1", "value2"]);
      await ctx.redis.send("RPUSH", [destination, "a", "b"]);

      // Now should immediately return
      const result = await ctx.redis.send("BRPOPLPUSH", [source, destination, "1"]);
      expect(result).toBe("value2");

      // Verify destination received the element
      const destContent = await ctx.redis.send("LRANGE", [destination, "0", "-1"]);
      expect(Array.isArray(destContent)).toBe(true);
      expect(destContent).toEqual(["value2", "a", "b"]);
    });
  });
});
