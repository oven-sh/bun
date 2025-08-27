import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

test("serialize with invalid argument should throw proper error (issue 6549)", () => {
  const db = new Database(":memory:");

  // This should throw a proper SQLite error, not "Out of memory"
  expect(() => {
    db.serialize(function () {});
  }).toThrow();

  // The error should not be "Out of memory"
  try {
    db.serialize(function () {});
  } catch (error) {
    expect(error.message).not.toBe("Out of memory");
    // Should be a more specific error about the database not existing
    expect(error.message.toLowerCase()).toContain("does not exist");
  }

  db.close();
});

test("serialize with valid database name should work", () => {
  const db = new Database(":memory:");

  // This should work with the default "main" database
  const result = db.serialize();
  expect(result).toBeInstanceOf(Buffer);
  expect(result.length).toBeGreaterThan(0);

  // Also test with explicit "main" parameter
  const result2 = db.serialize("main");
  expect(result2).toBeInstanceOf(Buffer);
  expect(result2.length).toBeGreaterThan(0);

  db.close();
});

test("serialize with nonexistent database name should throw proper error", () => {
  const db = new Database(":memory:");

  expect(() => {
    db.serialize("nonexistent_db");
  }).toThrow();

  // The error should not be "Out of memory"
  try {
    db.serialize("nonexistent_db");
  } catch (error) {
    expect(error.message).not.toBe("Out of memory");
    expect(error.message.toLowerCase()).toContain("does not exist");
  }

  db.close();
});
