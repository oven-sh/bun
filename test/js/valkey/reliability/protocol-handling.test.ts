import { describe, test, expect } from "bun:test";
import { randomUUIDv7 } from "bun";
import { createClient, delay, testKey } from "../test-utils";

/**
 * Test suite for RESP protocol handling, focusing on edge cases
 * - RESP3 data types handling
 * - Protocol parsing edge cases
 * - Bulk string/array handling
 * - Special value encoding/decoding
 */
describe("Valkey: Protocol Handling", () => {
  describe("RESP3 Data Type Handling", () => {
    test("should handle RESP3 Map type (HGETALL)", async () => {
      const client = createClient();

      try {
        // Create a hash with multiple fields
        const hashKey = testKey("map-test");
        await client.send("HSET", [
          hashKey,
          "field1",
          "value1",
          "field2",
          "value2",
          "number",
          "42",
          "empty",
          "",
          "special",
          "hello\r\nworld",
        ]);

        // Get as RESP3 Map via HGETALL
        const mapResult = await client.send("HGETALL", [hashKey]);

        // Should be returned as an object
        expect(typeof mapResult).toBe("object");
        expect(mapResult).not.toBeNull();

        if (mapResult !== null) {
          // Verify all fields
          expect(mapResult.field1).toBe("value1");
          expect(mapResult.field2).toBe("value2");
          expect(mapResult.number).toBe("42");
          expect(mapResult.empty).toBe("");
          expect(mapResult.special).toBe("hello\r\nworld");

          // Verify object structure
          expect(Object.keys(mapResult).length).toBe(5);
        }
      } catch (error) {
        console.warn("RESP3 Map test failed:", error.message);
        throw error;
      }
    });

    test("should handle RESP3 Set type", async () => {
      const client = createClient();

      try {
        // Create a set with multiple members
        const setKey = testKey("set-test");
        await client.send("SADD", [setKey, "member1", "member2", "42", "", "special \r\n character"]);

        // Get as RESP3 Set via SMEMBERS
        const setResult = await client.send("SMEMBERS", [setKey]);

        // Should be returned as an array
        expect(Array.isArray(setResult)).toBe(true);

        // Verify expected members (order may vary)
        expect(setResult.length).toBe(5);
        expect(setResult).toContain("member1");
        expect(setResult).toContain("member2");
        expect(setResult).toContain("42");
        expect(setResult).toContain("");
        expect(setResult).toContain("special \r\n character");
      } catch (error) {
        console.warn("RESP3 Set test failed:", error.message);
        throw error;
      }
    });

    test("should handle RESP3 Boolean type", async () => {
      const client = createClient();

      try {
        // Set up test keys
        const key = testKey("bool-test");
        await client.set(key, "value");

        // EXISTS returns Boolean in RESP3
        const existsResult = await client.exists(key);
        expect(typeof existsResult).toBe("boolean");
        expect(existsResult).toBe(true);

        // Non-existent key
        const notExistsResult = await client.exists(testKey("nonexistent"));
        expect(typeof notExistsResult).toBe("boolean");
        expect(notExistsResult).toBe(false);
      } catch (error) {
        console.warn("RESP3 Boolean test failed:", error.message);
        throw error;
      }
    });

    test("should handle RESP3 Number types", async () => {
      const client = createClient();

      try {
        // Various numeric commands to test number handling
        const counterKey = testKey("counter");

        // INCR returns integer
        const incrResult = await client.incr(counterKey);
        expect(typeof incrResult).toBe("number");
        expect(incrResult).toBe(1);

        // Use INCRBYFLOAT to test double/float handling
        const doubleResult = await client.send("INCRBYFLOAT", [counterKey, "1.5"]);
        // Some Redis versions return this as string, either is fine
        expect(doubleResult === "2.5" || doubleResult === 2.5).toBe(true);

        // Use HINCRBYFLOAT to test another float command
        const hashKey = testKey("hash-float");
        const hashDoubleResult = await client.send("HINCRBYFLOAT", [hashKey, "field", "10.5"]);
        // Should be string or number
        expect(hashDoubleResult === "10.5" || hashDoubleResult === 10.5).toBe(true);
      } catch (error) {
        console.warn("RESP3 Number test failed:", error.message);
        throw error;
      }
    });

    test("should handle RESP3 Null type", async () => {
      const client = createClient();

      try {
        // GET non-existent key
        const nullResult = await client.get(testKey("nonexistent"));
        expect(nullResult).toBeNull();

        // HGET non-existent field
        const hashKey = testKey("hash");
        await client.send("HSET", [hashKey, "existing", "value"]);

        const nullFieldResult = await client.send("HGET", [hashKey, "nonexistent"]);
        expect(nullFieldResult).toBeNull();

        // BLPOP with timeout
        const listKey = testKey("empty-list");
        const timeoutResult = await client.send("BLPOP", [listKey, "1"]);
        expect(timeoutResult).toBeNull();
      } catch (error) {
        console.warn("RESP3 Null test failed:", error.message);
        throw error;
      }
    });

    test("should handle RESP3 Error type", async () => {
      const client = createClient();

      try {
        // Command with wrong arguments
        await client.send("GET", []);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should be properly parsed error type
        expect(error instanceof Error).toBe(true);
        expect(error.message).toMatch(/wrong number|arguments/i);
      }

      try {
        // Syntax error
        await client.send("SYNTAX-ERROR", []);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should be properly parsed error
        expect(error instanceof Error).toBe(true);
        expect(error.message).toMatch(/unknown command|syntax/i);
      }
    });
  });

  describe("Protocol Parsing Edge Cases", () => {
    test("should handle nested array structures", async () => {
      const client = createClient();

      try {
        // XRANGE returns array of arrays
        const streamKey = testKey("stream");

        // Add entries to stream
        await client.send("XADD", [streamKey, "*", "field1", "value1", "field2", "value2"]);
        await client.send("XADD", [streamKey, "*", "field1", "value3", "field2", "value4"]);

        // Get range
        const rangeResult = await client.send("XRANGE", [streamKey, "-", "+"]);

        // Should get array of arrays
        expect(Array.isArray(rangeResult)).toBe(true);
        expect(rangeResult.length).toBe(2);

        // First entry should have ID and fields
        const firstEntry = rangeResult[0];
        expect(Array.isArray(firstEntry)).toBe(true);
        expect(firstEntry.length).toBe(2);

        // ID should be string
        expect(typeof firstEntry[0]).toBe("string");

        // Fields should be array of field-value pairs in RESP2 or object in RESP3
        const fields = firstEntry[1];
        if (Array.isArray(fields)) {
          // RESP2 style
          expect(fields.length % 2).toBe(0); // Even number for field-value pairs
        } else if (typeof fields === "object" && fields !== null) {
          // RESP3 style (map)
          expect(fields.field1).toBeTruthy();
          expect(fields.field2).toBeTruthy();
        }
      } catch (error) {
        // Some Redis implementations might not support streams
        console.warn("Nested array test failed:", error.message);
        throw error;
      }
    });

    test("should handle empty strings in bulk strings", async () => {
      const client = createClient();

      try {
        // Set empty string value
        const key = testKey("empty-string");
        await client.set(key, "");

        // Get it back
        const result = await client.get(key);
        expect(result).toBe("");

        // HSET with empty field and/or value
        const hashKey = testKey("hash-empty");
        await client.send("HSET", [hashKey, "empty-field", ""]);
        await client.send("HSET", [hashKey, "", "empty-field-name"]);

        // Get them back
        const emptyValue = await client.send("HGET", [hashKey, "empty-field"]);
        expect(emptyValue).toBe("");

        const emptyField = await client.send("HGET", [hashKey, ""]);
        expect(emptyField).toBe("empty-field-name");
      } catch (error) {
        console.warn("Empty string test failed:", error.message);
        throw error;
      }
    });

    test("should handle large arrays", async () => {
      const client = createClient();

      try {
        // Create a large set
        const setKey = testKey("large-set");
        const itemCount = 10000;

        // Add many members (in chunks to avoid huge command)
        for (let i = 0; i < itemCount; i += 100) {
          const members = [];
          for (let j = 0; j < 100 && i + j < itemCount; j++) {
            members.push(`member-${i + j}`);
          }
          await client.send("SADD", [setKey, ...members]);
        }

        // Get all members
        const membersResult = await client.send("SMEMBERS", [setKey]);

        // Should get all members back
        expect(Array.isArray(membersResult)).toBe(true);
        expect(membersResult.length).toBe(itemCount);

        // Check a few random members
        for (let i = 0; i < 10; i++) {
          const index = Math.floor(Math.random() * itemCount);
          expect(membersResult).toContain(`member-${index}`);
        }
      } catch (error) {
        console.warn("Large array test failed:", error.message);
        throw error;
      }
    });

    test("should handle very large bulk strings", async () => {
      const client = createClient();

      try {
        // Create various sized strings
        const sizes = [
          1024, // 1KB
          10 * 1024, // 10KB
          100 * 1024, // 100KB
          1024 * 1024, // 1MB
        ];

        for (const size of sizes) {
          const key = testKey(`large-string-${size}`);
          const value = "x".repeat(size);

          // Set the large value
          await client.set(key, value);

          // Get it back
          const result = await client.get(key);

          // Should be same length
          expect(result?.length).toBe(size);

          // Check first/last characters
          if (result) {
            expect(result[0]).toBe("x");
            expect(result[result.length - 1]).toBe("x");
          }
        }
      } catch (error) {
        console.warn("Large bulk string test failed:", error.message);
        throw error;
      }
    });

    test("should handle binary data", async () => {
      const client = createClient();

      try {
        // Create binary data with full byte range
        const binaryData = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
          binaryData[i] = i;
        }

        // Convert to string for Redis storage
        const binaryString = String.fromCharCode(...binaryData);

        // Store binary data
        const key = testKey("binary-data");
        await client.set(key, binaryString);

        // Get it back
        const result = await client.get(key);

        // Should have same length
        expect(result?.length).toBe(binaryString.length);

        // Verify each byte
        if (result) {
          for (let i = 0; i < Math.min(256, result.length); i++) {
            expect(result.charCodeAt(i)).toBe(i);
          }
        }
      } catch (error) {
        console.warn("Binary data test failed:", error.message);
        throw error;
      }
    });
  });

  describe("Special Value Handling", () => {
    test("should handle RESP protocol delimiter characters", async () => {
      const client = createClient();

      try {
        // Set values containing RESP delimiters
        const testCases = [
          { key: testKey("cr"), value: "contains\rcarriage\rreturn" },
          { key: testKey("lf"), value: "contains\nline\nfeed" },
          { key: testKey("crlf"), value: "contains\r\ncrlf\r\ndelimiters" },
          { key: testKey("mixed"), value: "mixed\r\n\r\n\r\ndelimiters" },
        ];

        for (const { key, value } of testCases) {
          await client.set(key, value);

          const result = await client.get(key);
          expect(result).toBe(value);
        }
      } catch (error) {
        console.warn("RESP delimiter test failed:", error.message);
        throw error;
      }
    });

    test("should handle special RESP types in data", async () => {
      const client = createClient();

      try {
        // Values that might confuse RESP parser if not properly handled
        const testCases = [
          { key: testKey("plus"), value: "+OK\r\n" }, // Simple string prefix
          { key: testKey("minus"), value: "-ERR\r\n" }, // Error prefix
          { key: testKey("colon"), value: ":123\r\n" }, // Integer prefix
          { key: testKey("dollar"), value: "$5\r\nhello\r\n" }, // Bulk string format
          { key: testKey("asterisk"), value: "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n" }, // Array format
        ];

        for (const { key, value } of testCases) {
          await client.set(key, value);

          const result = await client.get(key);
          expect(result).toBe(value);
        }
      } catch (error) {
        console.warn("RESP types in data test failed:", error.message);
        throw error;
      }
    });
  });

  describe("RESP3 Push Type Handling", () => {
    // Note: PubSub would use RESP3 Push type, but it's not fully implemented yet
    test("should handle MONITOR command output", async () => {
      const client = createClient();

      try {
        // Start monitor mode - this sends Push messages
        // Only test if client actually implements monitor callback
        if (typeof client.send !== "function") {
          console.warn("Client doesn't support sendCommand, skipping test");
          throw error;
          return;
        }

        // Warning: MONITOR is a debugging command and can affect performance
        // We're only running it briefly for testing
        try {
          await client.send("MONITOR", []);

          // MONITOR starts a stream of push messages
          // Since we don't have callbacks set up yet, just wait a moment
          await delay(100);

          // Generate some activity to monitor
          const testKey = `test-key-${randomUUIDv7()}`;
          await client.set(testKey, "test-value");

          // Stop MONITOR by using another client
          const stopClient = createClient();
          await stopClient.get(testKey);

          // This test mainly validates that MONITOR doesn't crash the client
          // A future implementation might expose the MONITOR stream through callbacks
        } catch (error) {
          // Some Redis configurations might disable MONITOR
          console.warn("MONITOR test got error:", error.message);
          throw error;
        }
      } catch (error) {
        console.warn("RESP3 Push test failed:", error.message);
        throw error;
      }
    });
  });

  describe("Extreme Protocol Conditions", () => {
    test("should handle rapidly switching between command types", async () => {
      const client = createClient();

      try {
        // Rapidly alternate between different command types
        // to stress protocol parser context switching
        const iterations = 100;
        const prefix = testKey("rapid");

        for (let i = 0; i < iterations; i++) {
          // String operations
          await client.set(`${prefix}-str-${i}`, `value-${i}`);
          await client.get(`${prefix}-str-${i}`);

          // Integer operations
          await client.incr(`${prefix}-int-${i}`);

          // Array result operations
          await client.send("KEYS", [`${prefix}-str-${i}`]);

          // Hash operations (map responses)
          await client.send("HSET", [`${prefix}-hash-${i}`, "field", "value"]);
          await client.send("HGETALL", [`${prefix}-hash-${i}`]);

          // Set operations
          await client.send("SADD", [`${prefix}-set-${i}`, "member1", "member2"]);
          await client.send("SMEMBERS", [`${prefix}-set-${i}`]);
        }

        // If we got here without protocol parse errors, test passes
      } catch (error) {
        console.warn("Rapid command switching test failed:", error.message);

        throw error;
      }
    });

    test("should handle simultaneous command streams", async () => {
      // Create multiple clients for parallel operations
      const clientCount = 5;
      const clients = Array.from({ length: clientCount }, () => createClient());

      try {
        // Run many operations in parallel across clients
        const operationsPerClient = 20;
        const prefix = testKey("parallel");

        const allPromises = clients.flatMap((client, clientIndex) => {
          const promises = [];

          for (let i = 0; i < operationsPerClient; i++) {
            const key = `${prefix}-c${clientIndex}-${i}`;

            // Mix of operation types
            promises.push(client.set(key, `value-${i}`));
            promises.push(client.get(key));
            promises.push(client.incr(`${key}-counter`));
            promises.push(client.send("HSET", [`${key}-hash`, "field", "value"]));
          }

          return promises;
        });

        // Run all operations simultaneously
        await Promise.all(allPromises);

        // If we got here without errors, test passes
      } catch (error) {
        console.warn("Parallel client test failed:", error.message);
        throw error;
      } finally {
        // Clean up clients
        await Promise.all(clients.map(client => client.disconnect()));
      }
    });
  });
});
