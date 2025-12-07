import { test, expect } from "bun:test";
import { SQL } from "bun";

test("custom adapter", async () => {
  const customAdapter = {
    normalizeQuery(strings, values) {
      // Simple implementation for testing
      let sql = "";
      for (let i = 0; i < strings.length; i++) {
        sql += strings[i];
        if (i < values.length) {
          sql += "?";
        }
      }
      return [sql, values];
    },
    createQueryHandle(sql, values, flags) {
      return {
        run(connection, query) {
          // Mock execution
          // Custom adapters can return plain arrays with metadata properties
          const result = [{ sql, values }];
          result.count = 1;
          result.command = "SELECT";
          result.lastInsertRowid = null;
          result.affectedRows = null;
          query.resolve(result);
        },
        setMode() {},
      };
    },
    connect(onConnected) {
      onConnected(null, {}); // Connected mock
    },
    release() {},
    close() {
      return Promise.resolve();
    },
    flush() {},
    isConnected() {
      return true;
    },
    get closed() {
      return false;
    },
    getTransactionCommands() {
      return {
        BEGIN: "BEGIN",
        COMMIT: "COMMIT",
        ROLLBACK: "ROLLBACK",
        SAVEPOINT: "SAVEPOINT",
        RELEASE_SAVEPOINT: "RELEASE SAVEPOINT",
        ROLLBACK_TO_SAVEPOINT: "ROLLBACK TO SAVEPOINT",
      };
    },
    array() {
      return null;
    },
    escapeIdentifier(name) {
      return `"${name}"`;
    },
    notTaggedCallError() {
      return new Error("Not tagged");
    },
    connectionClosedError() {
      return new Error("Connection closed");
    },
    queryCancelledError() {
      return new Error("Query cancelled");
    },
    invalidTransactionStateError(msg) {
      return new Error(msg);
    },
  };

  const sql = new SQL({ adapter: customAdapter });
  const result = await sql`SELECT ${1}`;
  expect(result).toHaveLength(1);
  expect(result[0].sql).toBe("SELECT ?");
  expect(result[0].values).toEqual([1]);

  await sql.close();
});
