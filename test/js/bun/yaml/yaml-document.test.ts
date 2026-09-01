import { YAML } from "bun";
import { describe, expect, test } from "bun:test";

describe("Bun.YAML.Document", () => {
  describe("parseDocument", () => {
    test("parses a simple mapping", () => {
      const doc = YAML.parseDocument("name: Alice\nage: 30");
      expect(doc).toBeDefined();
      expect(doc.toJS()).toEqual({ name: "Alice", age: 30 });
    });

    test("parses nested structure", () => {
      const doc = YAML.parseDocument(
        "server:\n  host: localhost\n  port: 8080\n",
      );
      expect(doc.toJS()).toEqual({
        server: { host: "localhost", port: 8080 },
      });
    });

    test("parses an array", () => {
      const doc = YAML.parseDocument("- a\n- b\n- c");
      expect(doc.toJS()).toEqual(["a", "b", "c"]);
    });

    test("returns empty document for null input", () => {
      const doc = YAML.parseDocument(null as never);
      expect(doc.toJS()).toBeNull();
    });

    test("returns empty document for undefined input", () => {
      const doc = YAML.parseDocument(undefined as never);
      expect(doc.toJS()).toBeUndefined();
    });

    test("throws on non-string, non-null input", () => {
      expect(() => YAML.parseDocument(123 as never)).toThrow();
    });

    test("throws on malformed YAML", () => {
      expect(() => YAML.parseDocument("key: [unterminated")).toThrow();
    });

    test("retains comments from source", () => {
      const source = "# Header comment\nname: Alice\nage: 30 # inline age\n";
      const doc = YAML.parseDocument(source);
      const out = doc.toString();
      expect(out).toContain("Header comment");
    });

    test("does not duplicate the line preceding an inline comment", () => {
      // Regression: the whole line up to the comment was stored, so the
      // mapping entry appeared twice in the serialized output.
      const doc = YAML.parseDocument("a: 1 # note\n");
      const out = doc.toString();
      expect(out).toContain("# note");
      expect(out.match(/a: 1/g)).toHaveLength(1);
    });

    test("preserves non-ASCII comment text", () => {
      // Regression: comments were filtered down to ASCII or re-encoded as
      // Latin-1, dropping/mangling every non-ASCII character.
      const doc = YAML.parseDocument("a: 1 # héllo 🦀\n");
      expect(doc.toString()).toContain("héllo 🦀");
      const d2 = YAML.parseDocument("a: 1");
      d2.comment("héllo 🦀");
      expect(d2.toString()).toContain("héllo 🦀");
    });

    test("retains a comment on a block-scalar header", () => {
      // `value: | # note` — the header comment was consumed but not recorded.
      const doc = YAML.parseDocument("value: | # note\n  text\n");
      expect(doc.toString()).toContain("# note");
    });

    test("works when parseDocument is destructured off the namespace", () => {
      // Regression: a destructured `this` is undefined, and the fallback
      // returned a bare object with no prototype methods.
      const { parseDocument } = YAML;
      const doc = parseDocument("a: 1");
      expect(doc.toJS()).toEqual({ a: 1 });
      doc.setIn("a", 2);
      expect(doc.toJS()).toEqual({ a: 2 });
    });

    test("uniqueKeys option rejects duplicate keys", () => {
      expect(() =>
        YAML.parseDocument("key: 1\nkey: 2", { uniqueKeys: true }),
      ).toThrow();
    });
  });

  describe("toJS", () => {
    test("returns parsed value", () => {
      const doc = YAML.parseDocument("x: 1\ny: 2");
      expect(doc.toJS()).toEqual({ x: 1, y: 2 });
    });

    test("returns null for empty document", () => {
      const doc = YAML.parseDocument(null as never);
      expect(doc.toJS()).toBeNull();
    });

    test("returns value set via constructor", () => {
      const doc = new YAML.Document({ foo: "bar" });
      expect(doc.toJS()).toEqual({ foo: "bar" });
    });

    test("throws when called on non-Document", () => {
      expect(() => {
        // @ts-expect-error intentional
        const d: unknown = {};
        d.toJS();
      }).toThrow();
    });
  });

  describe("toString", () => {
    test("round-trips a simple mapping", () => {
      const doc = YAML.parseDocument("name: Alice\nage: 30");
      const out = doc.toString();
      expect(out).toContain("name: Alice");
      expect(out).toContain("age: 30");
    });

    test("uses 2-space indentation by default", () => {
      const doc = YAML.parseDocument(
        "outer:\n  inner:\n    deep: value\n",
      );
      const out = doc.toString();
      expect(out).toContain("  inner");
    });

    test("appends retained comments at end", () => {
      const source = "# Top comment\nname: Alice\n";
      const doc = YAML.parseDocument(source);
      const out = doc.toString();
      expect(out).toContain("Top comment");
    });

    test("appends a final newline", () => {
      const doc = YAML.parseDocument("key: value");
      const out = doc.toString();
      expect(out.endsWith("\n")).toBe(true);
    });

    test("empty document yields just a newline", () => {
      const doc = YAML.parseDocument(null as never);
      expect(doc.toString()).toBe("\n");
    });
  });

  describe("setIn", () => {
    test("sets a nested object property", () => {
      const doc = YAML.parseDocument("a:\n  b:\n    c: 1");
      doc.setIn("a.b.c", 42);
      expect(doc.toJS()).toEqual({ a: { b: { c: 42 } } });
    });

    test("sets a deeply nested property via array path", () => {
      const doc = YAML.parseDocument("root: {}");
      doc.setIn(["root", "level1", "level2"], "deep");
      expect(doc.toJS()).toEqual({
        root: { level1: { level2: "deep" } },
      });
    });

    test("creates intermediate objects", () => {
      const doc = YAML.parseDocument("x: 1");
      doc.setIn(["y", "z"], 99);
      expect(doc.toJS()).toEqual({ x: 1, y: { z: 99 } });
    });

    test("sets array indices", () => {
      const doc = YAML.parseDocument("items: [1, 2, 3]");
      doc.setIn(["items", "1"], 999);
      expect(doc.toJS()).toEqual({ items: [1, 999, 3] });
    });

    test("rejects non-numeric array indices instead of writing element 0", () => {
      // Regression: `bun_string_to_u32` mapped garbage to 0, so
      // `setIn(["items", "name"], v)` silently overwrote element 0.
      const doc = YAML.parseDocument("items: [1, 2, 3]");
      expect(() => doc.setIn(["items", "name"], 99)).toThrow();
      expect(doc.toJS()).toEqual({ items: [1, 2, 3] });
    });

    test("trailing separator in a string path is ignored", () => {
      // Regression: `a.` produced ["a", ""] and wrote a ""-named property.
      const doc = YAML.parseDocument("a: 1");
      doc.setIn("a.", 2);
      expect(doc.toJS()).toEqual({ a: 2 });
    });

    test("empty path is a no-op", () => {
      const doc = YAML.parseDocument("a: 1");
      doc.setIn("", 2);
      expect(doc.toJS()).toEqual({ a: 1 });
    });

    test("throws when no value provided", () => {
      const doc = YAML.parseDocument("x: 1");
      expect(() => doc.setIn("x")).toThrow();
    });

    test("returns the document for chaining", () => {
      const doc = YAML.parseDocument("x: 1");
      const ret = doc.setIn("x", 2);
      expect(ret).toBe(doc);
    });
  });

  describe("deleteIn", () => {
    test("deletes a nested property", () => {
      const doc = YAML.parseDocument("a:\n  b:\n    c: 1");
      doc.deleteIn("a.b.c");
      expect(doc.toJS()).toEqual({ a: { b: {} } });
    });

    test("deletes a top-level key", () => {
      const doc = YAML.parseDocument("x: 1\ny: 2");
      doc.deleteIn("y");
      expect(doc.toJS()).toEqual({ x: 1 });
    });

    test("does nothing for non-existent path", () => {
      const doc = YAML.parseDocument("x: 1");
      doc.deleteIn("z.q.w");
      expect(doc.toJS()).toEqual({ x: 1 });
    });

    test("does not wipe a scalar document value on a miss", () => {
      // Regression: delete_in_impl returned undefined for primitive/missing
      // nodes, and the document value was overwritten with it.
      const doc = YAML.parseDocument("hello");
      doc.deleteIn("a.b");
      expect(doc.toJS()).toBe("hello");
      doc.deleteIn(["a"]);
      expect(doc.toJS()).toBe("hello");
    });

    test("throws when no path provided", () => {
      const doc = YAML.parseDocument("x: 1");
      expect(() => doc.deleteIn()).toThrow();
    });

    test("returns the document for chaining", () => {
      const doc = YAML.parseDocument("x: 1");
      const ret = doc.deleteIn("x");
      expect(ret).toBe(doc);
    });
  });

  describe("comment", () => {
    test("appends a comment with proper prefix", () => {
      const doc = YAML.parseDocument("name: Alice");
      doc.comment("this is a note");
      const out = doc.toString();
      expect(out).toContain("# this is a note");
    });

    test("preserves existing # prefix", () => {
      const doc = YAML.parseDocument("name: Alice");
      doc.comment("# existing hash");
      const out = doc.toString();
      expect(out).toContain("# existing hash");
    });

    test("appends multiple comments", () => {
      const doc = YAML.parseDocument("name: Alice");
      doc.comment("first");
      doc.comment("second");
      const out = doc.toString();
      expect(out).toContain("# first");
      expect(out).toContain("# second");
    });

    test("throws when no text provided", () => {
      const doc = YAML.parseDocument("name: Alice");
      expect(() => doc.comment()).toThrow();
    });

    test("returns the document for chaining", () => {
      const doc = YAML.parseDocument("x: 1");
      const ret = doc.comment("hello");
      expect(ret).toBe(doc);
    });
  });

  describe("Document constructor", () => {
    test("creates document with initial value", () => {
      const doc = new YAML.Document({ hello: "world" });
      expect(doc.toJS()).toEqual({ hello: "world" });
    });

    test("prototype methods are not enumerable", () => {
      // Regression: `put` installed the five methods as enumerable, so
      // `for...in` over a Document listed them.
      const doc = YAML.parseDocument("a: 1");
      const names: string[] = [];
      for (const k in doc) names.push(k);
      expect(names).toEqual([]);
    });

    test("creates empty document with no args", () => {
      const doc = new YAML.Document();
      expect(doc.toJS()).toBeNull();
    });

    test("toString serialises initial value", () => {
      const doc = new YAML.Document({ a: 1, b: 2 });
      const out = doc.toString();
      expect(out).toContain("a: 1");
      expect(out).toContain("b: 2");
    });
  });
});