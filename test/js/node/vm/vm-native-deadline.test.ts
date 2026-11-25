import { expireCurrentVMDeadline } from "bun:internal-for-testing";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

describe("VM deadline elapsed before its timer callback", () => {
  test("a native call reports its deadline on return", () => {
    expect(() => runInNewContext("expire()", { expire: expireCurrentVMDeadline }, { timeout: 60_000 })).toThrow(
      expect.objectContaining({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT" }),
    );
  });

  test.each(["all", "values", "get", "run", "iterate"] as const)("SQLite %s releases its write cursor", method => {
    using dir = tempDir("vm-sqlite-deadline", {});
    const file = join(String(dir), "db.sqlite");
    using db = new Database(file);
    db.run(`
      CREATE TABLE docs (id INTEGER PRIMARY KEY, body);
      CREATE VIRTUAL TABLE ft USING fts5(body, content='docs', content_rowid='id');
      CREATE TRIGGER ai AFTER INSERT ON docs BEGIN INSERT INTO ft (rowid, body) VALUES (new.id, new.body); END;
    `);
    db.function("expire_deadline", () => {
      expireCurrentVMDeadline();
      return "hello";
    });
    const statement = db.prepare("INSERT INTO docs (body) VALUES (expire_deadline()) RETURNING 1");
    const read = () => (method === "iterate" ? statement.iterate().next() : statement[method]());
    expect(() => runInNewContext("read()", { read }, { timeout: 60_000 })).toThrow(
      expect.objectContaining({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT" }),
    );
    using other = new Database(file);
    other.run("CREATE TABLE later (x)");
    expect(other.query("SELECT count(*) AS n FROM docs").get()).toEqual({ n: 1 });
    expect(other.query("SELECT count(*) AS n FROM ft WHERE ft MATCH 'hello'").get()).toEqual({ n: 1 });
  });
});
