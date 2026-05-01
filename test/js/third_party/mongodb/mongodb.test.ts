import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";
import { MongoClient } from "mongodb";

const databaseUrl = getSecret("TLS_MONGODB_DATABASE_URL");

describe.skipIf(!databaseUrl)("mongodb", () => {
  test("should connect and inpect", async () => {
    const client = new MongoClient(databaseUrl!);

    const clientConnection = await client.connect();

    try {
      const db = client.db("bun");

      const schema = db.collection("bun");

      await schema.insertOne({ name: "bunny", version: 1.0 });
      const result = await schema.find();
      await schema.deleteOne({ name: "bunny" });
      const text = Bun.inspect(result);

      expect(text).toBeDefined();
    } finally {
      await clientConnection.close();
    }
  });
});
