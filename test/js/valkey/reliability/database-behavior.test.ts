import { describe, expect, test } from "bun:test";
import { ConnectionType, createClient, isEnabled } from "../test-utils";

/**
 * Test suite for checking if connections to different database numbers behave the same
 */
describe.skipIf(!isEnabled)("Valkey: Database behavior", () => {
  describe("Set & get accross different databases", () => {
    test("should return a set value no matter the database", async () => {
      const stringified = JSON.stringify({ value: "Hello, Valkey!" });

      for (let i = 0; i < 16; i++) {
        const client = createClient(ConnectionType.TCP, { db: i });
        await client.set("hello-valkey-test", stringified);
        const value = await client.get("hello-valkey-test");
        expect(value).toEqual(stringified);
        client.close();
      }
    });
  });
});
