import { sql } from "bun";
import { describe, expect, test } from "bun:test";

// This test validates that sql.array() rejects malicious type parameters
// that could lead to SQL injection via the array type interpolation in
// normalizeQuery (src/js/internal/sql/postgres.ts line 1382).
//
// The vulnerability: sql.array(values, type) interpolates `type` directly
// into the query string as `$N::TYPE[]` without validation.

describe("sql.array type parameter validation", () => {
  test("sql.array rejects type with SQL injection payload (semicolon)", () => {
    expect(() => {
      sql.array([1, 2, 3], "INT); DROP TABLE users--" as any);
    }).toThrow();
  });

  test("sql.array rejects type with UNION injection", () => {
    expect(() => {
      sql.array([1, 2, 3], "INT[] UNION SELECT password FROM users--" as any);
    }).toThrow();
  });

  test("sql.array rejects type with subquery injection", () => {
    expect(() => {
      sql.array([1, 2, 3], "INT[] (SELECT 1)" as any);
    }).toThrow();
  });

  test("sql.array rejects type with parentheses", () => {
    expect(() => {
      sql.array([1, 2, 3], "INT()" as any);
    }).toThrow();
  });

  test("sql.array rejects type with single quotes", () => {
    expect(() => {
      sql.array([1, 2, 3], "INT' OR '1'='1" as any);
    }).toThrow();
  });

  test("sql.array rejects type with double quotes", () => {
    expect(() => {
      sql.array([1, 2, 3], 'INT" OR "1"="1' as any);
    }).toThrow();
  });

  test("sql.array rejects empty type", () => {
    expect(() => {
      sql.array([1, 2, 3], "" as any);
    }).toThrow();
  });

  test("sql.array rejects type with empty segment (leading dot)", () => {
    expect(() => {
      sql.array([1, 2, 3], ".INTEGER" as any);
    }).toThrow();
  });

  test("sql.array rejects type with empty segment (trailing dot)", () => {
    expect(() => {
      sql.array([1, 2, 3], "myschema." as any);
    }).toThrow();
  });

  test("sql.array rejects type with empty segment (consecutive dots)", () => {
    expect(() => {
      sql.array([1, 2, 3], "myschema..INTEGER" as any);
    }).toThrow();
  });

  test("sql.array rejects space in schema segment", () => {
    expect(() => {
      sql.array([1, 2, 3], "my schema.INTEGER" as any);
    }).toThrow();
  });

  test("sql.array accepts valid types", () => {
    expect(() => sql.array([1, 2], "INTEGER")).not.toThrow();
    expect(() => sql.array([1, 2], "INT")).not.toThrow();
    expect(() => sql.array([1, 2], "BIGINT")).not.toThrow();
    expect(() => sql.array(["a", "b"], "TEXT")).not.toThrow();
    expect(() => sql.array(["a", "b"], "VARCHAR")).not.toThrow();
    expect(() => sql.array([true, false], "BOOLEAN")).not.toThrow();
    expect(() => sql.array([1.5, 2.5], "DOUBLE PRECISION")).not.toThrow();
    expect(() => sql.array([1, 2], "INT2VECTOR")).not.toThrow();
    expect(() => sql.array(["{}", "[]"], "JSON")).not.toThrow();
    expect(() => sql.array(["{}", "[]"], "JSONB")).not.toThrow();
  });

  test("sql.array accepts lowercase valid types", () => {
    expect(() => sql.array([1, 2], "integer")).not.toThrow();
    expect(() => sql.array([1, 2], "int")).not.toThrow();
    expect(() => sql.array(["a", "b"], "text")).not.toThrow();
    expect(() => sql.array([1.5, 2.5], "double precision")).not.toThrow();
  });

  test("sql.array accepts schema-qualified type names", () => {
    expect(() => sql.array([1, 2], "myschema.INTEGER" as any)).not.toThrow();
    expect(() => sql.array([1, 2], "pg_catalog.int4" as any)).not.toThrow();
    expect(() => sql.array([1, 2], "public.my_type" as any)).not.toThrow();
  });

  test("sql.array accepts schema-qualified type with space in last segment", () => {
    expect(() => sql.array([1, 2], "myschema.DOUBLE PRECISION" as any)).not.toThrow();
  });
});
