import { YAML, file } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";

describe("Bun.YAML", () => {
  describe("parse", () => {
    // Test various input types
    describe("input types", () => {
      test("parses from Buffer", () => {
        const buffer = Buffer.from("key: value\nnumber: 42");
        expect(YAML.parse(buffer)).toEqual({ key: "value", number: 42 });
      });

      test("parses from Buffer with UTF-8", () => {
        const buffer = Buffer.from("emoji: 🎉\ntext: hello");
        expect(YAML.parse(buffer)).toEqual({ emoji: "🎉", text: "hello" });
      });

      test("parses from ArrayBuffer", () => {
        const str = "name: test\ncount: 3";
        const encoder = new TextEncoder();
        const arrayBuffer = encoder.encode(str).buffer;
        expect(YAML.parse(arrayBuffer)).toEqual({ name: "test", count: 3 });
      });

      test("parses from Uint8Array", () => {
        const str = "- item1\n- item2\n- item3";
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(str);
        expect(YAML.parse(uint8Array)).toEqual(["item1", "item2", "item3"]);
      });

      test("parses from Uint16Array", () => {
        const str = "foo: bar";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Create Uint16Array from the bytes
        const uint16Array = new Uint16Array(bytes.buffer.slice(0, bytes.length));
        expect(YAML.parse(uint16Array)).toEqual({ foo: "bar" });
      });

      test("parses from Int8Array", () => {
        const str = "enabled: true\ncount: -5";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        const int8Array = new Int8Array(bytes.buffer);
        expect(YAML.parse(int8Array)).toEqual({ enabled: true, count: -5 });
      });

      test("parses from Int16Array", () => {
        const str = "status: ok";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Ensure buffer is aligned for Int16Array
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 2) * 2);
        new Uint8Array(alignedBuffer).set(bytes);
        const int16Array = new Int16Array(alignedBuffer);
        expect(YAML.parse(int16Array)).toEqual({ status: "ok" });
      });

      test("parses from Int32Array", () => {
        const str = "value: 42";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Ensure buffer is aligned for Int32Array; pad with LF (NUL is not c-printable)
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 4) * 4);
        new Uint8Array(alignedBuffer).fill(0x0a).set(bytes);
        const int32Array = new Int32Array(alignedBuffer);
        expect(YAML.parse(int32Array)).toEqual({ value: 42 });
      });

      test("parses from Uint32Array", () => {
        const str = "test: pass";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Ensure buffer is aligned for Uint32Array; pad with LF (NUL is not c-printable)
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 4) * 4);
        new Uint8Array(alignedBuffer).fill(0x0a).set(bytes);
        const uint32Array = new Uint32Array(alignedBuffer);
        expect(YAML.parse(uint32Array)).toEqual({ test: "pass" });
      });

      test("parses from Float32Array", () => {
        const str = "pi: 3.14";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Ensure buffer is aligned for Float32Array
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 4) * 4);
        new Uint8Array(alignedBuffer).set(bytes);
        const float32Array = new Float32Array(alignedBuffer);
        expect(YAML.parse(float32Array)).toEqual({ pi: 3.14 });
      });

      test("parses from Float64Array", () => {
        const str = "e: 2.718";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Ensure buffer is aligned for Float64Array
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 8) * 8);
        new Uint8Array(alignedBuffer).set(bytes);
        const float64Array = new Float64Array(alignedBuffer);
        expect(YAML.parse(float64Array)).toEqual({ e: 2.718 });
      });

      test("parses from BigInt64Array", () => {
        const str = "big: 999";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Ensure buffer is aligned for BigInt64Array
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 8) * 8);
        new Uint8Array(alignedBuffer).set(bytes);
        const bigInt64Array = new BigInt64Array(alignedBuffer);
        expect(YAML.parse(bigInt64Array)).toEqual({ big: 999 });
      });

      test("parses from BigUint64Array", () => {
        const str = "huge: 1000";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Ensure buffer is aligned for BigUint64Array; pad with LF (NUL is not c-printable)
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 8) * 8);
        new Uint8Array(alignedBuffer).fill(0x0a).set(bytes);
        const bigUint64Array = new BigUint64Array(alignedBuffer);
        expect(YAML.parse(bigUint64Array)).toEqual({ huge: 1000 });
      });

      test("parses from DataView", () => {
        const str = "test: value\nnum: 123";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        const dataView = new DataView(bytes.buffer);
        expect(YAML.parse(dataView)).toEqual({ test: "value", num: 123 });
      });

      test("parses from Blob", async () => {
        const blob = new Blob(["key1: value1\nkey2: value2"], { type: "text/yaml" });
        expect(YAML.parse(blob)).toEqual({ key1: "value1", key2: "value2" });
      });

      test("parses from Blob with multiple parts", async () => {
        const blob = new Blob(["users:\n", "  - name: Alice\n", "  - name: Bob"], { type: "text/yaml" });
        expect(YAML.parse(blob)).toEqual({
          users: [{ name: "Alice" }, { name: "Bob" }],
        });
      });

      test("parses complex YAML from Buffer", () => {
        const yaml = `
database:
  host: localhost
  port: 5432
  credentials:
    username: admin
    password: secret
`;
        const buffer = Buffer.from(yaml);
        expect(YAML.parse(buffer)).toEqual({
          database: {
            host: "localhost",
            port: 5432,
            credentials: {
              username: "admin",
              password: "secret",
            },
          },
        });
      });

      test("parses arrays from TypedArray", () => {
        const yaml = "[1, 2, 3, 4, 5]";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(yaml);
        // Ensure buffer is aligned for Uint32Array; pad with LF (NUL is not c-printable)
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 4) * 4);
        new Uint8Array(alignedBuffer).fill(0x0a).set(bytes);
        const uint32Array = new Uint32Array(alignedBuffer);
        expect(YAML.parse(uint32Array)).toEqual([1, 2, 3, 4, 5]);
      });

      test("handles empty Buffer", () => {
        const buffer = Buffer.from("");
        expect(YAML.parse(buffer)).toBe(null);
      });

      test("handles empty ArrayBuffer", () => {
        const arrayBuffer = new ArrayBuffer(0);
        expect(YAML.parse(arrayBuffer)).toBe(null);
      });

      test("handles empty Blob", () => {
        const blob = new Blob([]);
        expect(YAML.parse(blob)).toBe(null);
      });

      test("parses multiline strings from Buffer", () => {
        const yaml = `
message: |
  This is a
  multiline
  string
`;
        const buffer = Buffer.from(yaml);
        expect(YAML.parse(buffer)).toEqual({
          message: "This is a\nmultiline\nstring\n",
        });
      });

      test("handles invalid YAML in Buffer", () => {
        const buffer = Buffer.from("{ invalid: yaml:");
        expect(() => YAML.parse(buffer)).toThrow();
      });

      test("handles invalid YAML in ArrayBuffer", () => {
        const encoder = new TextEncoder();
        const arrayBuffer = encoder.encode("[ unclosed").buffer;
        expect(() => YAML.parse(arrayBuffer)).toThrow();
      });

      test("parses with anchors and aliases from Buffer", () => {
        const yaml = `
defaults: &defaults
  adapter: postgres
  host: localhost
development:
  <<: *defaults
  database: dev_db
`;
        const buffer = Buffer.from(yaml);
        expect(YAML.parse(buffer)).toEqual({
          defaults: {
            adapter: "postgres",
            host: "localhost",
          },
          development: {
            adapter: "postgres",
            host: "localhost",
            database: "dev_db",
          },
        });
      });

      test("round-trip with Buffer", () => {
        const obj = {
          name: "test",
          items: [1, 2, 3],
          nested: { key: "value" },
        };
        const yamlStr = YAML.stringify(obj);
        const buffer = Buffer.from(yamlStr);
        expect(YAML.parse(buffer)).toEqual(obj);
      });

      test("round-trip with ArrayBuffer", () => {
        const data = {
          users: ["Alice", "Bob"],
          settings: { theme: "dark", notifications: true },
        };
        const yamlStr = YAML.stringify(data);
        const encoder = new TextEncoder();
        const arrayBuffer = encoder.encode(yamlStr).buffer;
        expect(YAML.parse(arrayBuffer)).toEqual(data);
      });

      test("handles Buffer with offset", () => {
        // Create a larger buffer and use a slice of it
        const fullBuffer = Buffer.from("garbage_datakey: value\nmore_garbage");
        const slicedBuffer = fullBuffer.slice(12, 22); // "key: value"
        expect(YAML.parse(slicedBuffer)).toEqual({ key: "value" });
      });

      test("handles TypedArray with offset", () => {
        const str = "name: test\ncount: 5";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Create a larger buffer with padding
        const largerBuffer = new ArrayBuffer(bytes.length + 20);
        const uint8View = new Uint8Array(largerBuffer);
        // Put some garbage data before
        uint8View.set(encoder.encode("garbage"), 0);
        // Put our actual YAML data at offset 10
        uint8View.set(bytes, 10);
        // Create a view that points to just our YAML data
        const view = new Uint8Array(largerBuffer, 10, bytes.length);
        expect(YAML.parse(view)).toEqual({ name: "test", count: 5 });
      });

      // Test SharedArrayBuffer if available
      if (typeof SharedArrayBuffer !== "undefined") {
        test("parses from SharedArrayBuffer", () => {
          const str = "shared: data";
          const encoder = new TextEncoder();
          const bytes = encoder.encode(str);
          const sharedBuffer = new SharedArrayBuffer(bytes.length);
          new Uint8Array(sharedBuffer).set(bytes);
          expect(YAML.parse(sharedBuffer)).toEqual({ shared: "data" });
        });

        test("parses from TypedArray backed by SharedArrayBuffer", () => {
          const str = "type: shared\nvalue: 123";
          const encoder = new TextEncoder();
          const bytes = encoder.encode(str);
          const sharedBuffer = new SharedArrayBuffer(bytes.length);
          const sharedArray = new Uint8Array(sharedBuffer);
          sharedArray.set(bytes);
          expect(YAML.parse(sharedArray)).toEqual({ type: "shared", value: 123 });
        });
      }

      test("handles File (which is a Blob)", () => {
        const file = new File(["file:\n  name: test.yaml\n  size: 100"], "test.yaml", { type: "text/yaml" });
        expect(YAML.parse(file)).toEqual({
          file: {
            name: "test.yaml",
            size: 100,
          },
        });
      });

      test("complex nested structure from various input types", () => {
        const complexYaml = `
version: "1.0"
services:
  web:
    image: nginx:latest
    ports:
      - 80
      - 443
  db:
    image: postgres:13
    environment:
      POSTGRES_PASSWORD: secret
`;

        // Test with Buffer
        const buffer = Buffer.from(complexYaml);
        const expected = {
          version: "1.0",
          services: {
            web: {
              image: "nginx:latest",
              ports: [80, 443],
            },
            db: {
              image: "postgres:13",
              environment: {
                POSTGRES_PASSWORD: "secret",
              },
            },
          },
        };
        expect(YAML.parse(buffer)).toEqual(expected);

        // Test with ArrayBuffer
        const encoder = new TextEncoder();
        const arrayBuffer = encoder.encode(complexYaml).buffer;
        expect(YAML.parse(arrayBuffer)).toEqual(expected);

        // Test with Blob
        const blob = new Blob([complexYaml]);
        expect(YAML.parse(blob)).toEqual(expected);
      });
    });

    test("parses null values (YAML 1.2 Core Schema)", () => {
      // YAML 1.2 Core Schema: null, Null, NULL, ~ and empty are null
      expect(YAML.parse("null")).toBe(null);
      expect(YAML.parse("Null")).toBe(null);
      expect(YAML.parse("NULL")).toBe(null);
      expect(YAML.parse("~")).toBe(null);
      expect(YAML.parse("")).toBe(null);
    });

    test("parses boolean values (YAML 1.2 Core Schema)", () => {
      // YAML 1.2 Core Schema: true, True, TRUE, false, False, FALSE are booleans
      expect(YAML.parse("true")).toBe(true);
      expect(YAML.parse("True")).toBe(true);
      expect(YAML.parse("TRUE")).toBe(true);
      expect(YAML.parse("false")).toBe(false);
      expect(YAML.parse("False")).toBe(false);
      expect(YAML.parse("FALSE")).toBe(false);
      // YAML 1.2: these YAML 1.1 legacy values are strings, not booleans
      expect(YAML.parse("yes")).toBe("yes");
      expect(YAML.parse("no")).toBe("no");
      expect(YAML.parse("on")).toBe("on");
      expect(YAML.parse("off")).toBe("off");
      expect(YAML.parse("Yes")).toBe("Yes");
      expect(YAML.parse("No")).toBe("No");
      expect(YAML.parse("YES")).toBe("YES");
      expect(YAML.parse("NO")).toBe("NO");
      expect(YAML.parse("On")).toBe("On");
      expect(YAML.parse("Off")).toBe("Off");
      expect(YAML.parse("ON")).toBe("ON");
      expect(YAML.parse("OFF")).toBe("OFF");
      expect(YAML.parse("y")).toBe("y");
      expect(YAML.parse("n")).toBe("n");
    });

    test("parses number values (YAML 1.2 Core Schema)", () => {
      expect(YAML.parse("42")).toBe(42);
      expect(YAML.parse("3.14")).toBe(3.14);
      expect(YAML.parse("-17")).toBe(-17);
      expect(YAML.parse("0")).toBe(0);
      expect(YAML.parse(".inf")).toBe(Infinity);
      expect(YAML.parse("-.inf")).toBe(-Infinity);
      expect(YAML.parse(".nan")).toBeNaN();
      // YAML 1.2 Core Schema: octal (0o) and hex (0x) are supported
      expect(YAML.parse("0o777")).toBe(511);
      expect(YAML.parse("0o10")).toBe(8);
      expect(YAML.parse("0xFF")).toBe(255);
      expect(YAML.parse("0x10")).toBe(16);
      expect(YAML.parse("0xDEADBEEF")).toBe(0xdeadbeef);
    });

    test("parses string values", () => {
      expect(YAML.parse('"hello world"')).toBe("hello world");
      expect(YAML.parse("'single quoted'")).toBe("single quoted");
      expect(YAML.parse("unquoted string")).toBe("unquoted string");
      expect(YAML.parse('key: "value with spaces"')).toEqual({
        key: "value with spaces",
      });
    });

    test("parses arrays", () => {
      expect(YAML.parse("[1, 2, 3]")).toEqual([1, 2, 3]);
      expect(YAML.parse("- 1\n- 2\n- 3")).toEqual([1, 2, 3]);
      expect(YAML.parse("- a\n- b\n- c")).toEqual(["a", "b", "c"]);
      expect(YAML.parse("[]")).toEqual([]);
    });

    test("parses objects", () => {
      expect(YAML.parse("{a: 1, b: 2}")).toEqual({ a: 1, b: 2 });
      expect(YAML.parse("a: 1\nb: 2")).toEqual({ a: 1, b: 2 });
      expect(YAML.parse("{}")).toEqual({});
      expect(YAML.parse('name: "John"\nage: 30')).toEqual({
        name: "John",
        age: 30,
      });
    });

    test("parses nested structures", () => {
      const yaml = `
users:
  - name: Alice
    age: 30
    hobbies:
      - reading
      - hiking
  - name: Bob
    age: 25
    hobbies:
      - gaming
      - cooking
`;
      expect(YAML.parse(yaml)).toEqual({
        users: [
          {
            name: "Alice",
            age: 30,
            hobbies: ["reading", "hiking"],
          },
          {
            name: "Bob",
            age: 25,
            hobbies: ["gaming", "cooking"],
          },
        ],
      });
    });

    test("parses complex nested objects", () => {
      const yaml = `
database:
  host: localhost
  port: 5432
  credentials:
    username: admin
    password: secret
  options:
    ssl: true
    timeout: 30
`;
      expect(YAML.parse(yaml)).toEqual({
        database: {
          host: "localhost",
          port: 5432,
          credentials: {
            username: "admin",
            password: "secret",
          },
          options: {
            ssl: true,
            timeout: 30,
          },
        },
      });
    });

    test.todo("handles circular references with anchors and aliases", () => {
      const yaml = `
parent: &ref
  name: parent
  child:
    name: child
    parent: *ref
`;
      const result = YAML.parse(yaml);
      expect(result.parent.name).toBe("parent");
      expect(result.parent.child.name).toBe("child");
      expect(result.parent.child.parent).toBe(result.parent);
    });

    test("handles multiple documents", () => {
      const yaml = `
---
document: 1
---
document: 2
`;
      expect(YAML.parse(yaml)).toEqual([{ document: 1 }, { document: 2 }]);
    });

    test("document markers in quoted strings", () => {
      const inputs = [
        { expected: "hi ... hello", input: '"hi ... hello"' },
        { expected: "hi ... hello", input: "'hi ... hello'" },
        { expected: { foo: "hi ... hello" }, input: 'foo: "hi ... hello"' },
        { expected: { foo: "hi ... hello" }, input: "foo: 'hi ... hello'" },
        {
          expected: "hi ... hello",
          input: `"hi
  ...
  hello"`,
        },
        {
          expected: "hi ... hello",
          input: `'hi
  ...
  hello'`,
        },
        {
          expected: { foo: "hi ... hello" },
          input: `foo: "hi
  ...
  hello"`,
        },
        {
          expected: { foo: "hi ... hello" },
          input: `foo: 'hi
  ...
  hello'`,
        },
        {
          expected: { foo: { bar: "hi ... hello" } },
          input: `foo:
  bar: "hi
    ...
    hello"`,
        },
        {
          expected: { foo: { bar: "hi ... hello" } },
          input: `foo:
  bar: 'hi
    ...
    hello'`,
        },
      ];

      for (const { input, expected } of inputs) {
        expect(YAML.parse(input)).toEqual(expected);
        expect(YAML.parse(YAML.stringify(YAML.parse(input)))).toEqual(expected);
      }
    });

    test("handles multiline strings", () => {
      const yaml = `
literal: |
  This is a
  multiline
  string
folded: >
  This is also
  a multiline
  string
`;
      expect(YAML.parse(yaml)).toEqual({
        literal: "This is a\nmultiline\nstring\n",
        folded: "This is also a multiline string\n",
      });
    });

    describe("block scalars", () => {
      describe("header parsing", () => {
        test.each([
          ["|1-", " x"],
          ["|-1", " x"],
          ["|1+", " x\n"],
          ["|+1", " x\n"],
          [">1-", " x"],
          [">-1", " x"],
          [">1+", " x\n"],
          [">+1", " x\n"],
        ])("indicator and chomp in either order: %s", (hdr, expected) => {
          expect(YAML.parse(`- ${hdr}\n  x\n`)).toEqual([expected]);
        });

        test.each(["|0", "|10", "|12", "|++", "|--", "|-+", "|+-", "|1-2", "|x", ">0", ">  text"])(
          "rejects invalid header %j",
          hdr => {
            expect(() => YAML.parse(`- ${hdr}\n x\n`)).toThrow();
          },
        );

        test.each([
          ["| # comment", "x\n"],
          ["|- # comment", "x"],
          ["|+ # comment", "x\n"],
          ["|2 # comment", "x\n"],
          ["|2- # comment", "x"],
          ["|  \t # c", "x\n"],
        ])("trailing comment after header %j", (hdr, expected) => {
          expect(YAML.parse(`- ${hdr}\n  x\n`)).toEqual([expected]);
        });
      });

      describe("explicit indentation indicator", () => {
        test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("|%d strips exactly N spaces", n => {
          const indent = Buffer.alloc(n, " ").toString();
          expect(YAML.parse(`- |${n}\n${indent}text\n`)).toEqual(["text\n"]);
          expect(YAML.parse(`- |${n}\n${indent} extra\n`)).toEqual([" extra\n"]);
        });

        test("preserves leading spaces beyond indicator", () => {
          expect(YAML.parse("- |1\n  explicit\n")).toEqual([" explicit\n"]);
          expect(YAML.parse("- |1\n    explicit\n")).toEqual(["   explicit\n"]);
          expect(YAML.parse("- |2\n  explicit\n")).toEqual(["explicit\n"]);
        });

        test("relative to parent indent in nested mapping", () => {
          expect(YAML.parse("outer:\n  inner: |1\n    text\n")).toEqual({ outer: { inner: " text\n" } });
          expect(YAML.parse("outer:\n  inner: |2\n    text\n")).toEqual({ outer: { inner: "text\n" } });
        });

        test("relative to parent indent in nested sequence", () => {
          expect(YAML.parse("- - |1\n    text\n")).toEqual([[" text\n"]]);
          expect(YAML.parse("- - |2\n    text\n")).toEqual([["text\n"]]);
        });

        test("with leading empty lines", () => {
          expect(YAML.parse("- |2\n\n\n  text\n")).toEqual(["\n\ntext\n"]);
          expect(YAML.parse("- |2\n  \n  text\n")).toEqual(["\ntext\n"]);
          expect(YAML.parse("- |2\n \n  text\n")).toEqual(["\ntext\n"]);
        });

        test("folded with more-indented first line", () => {
          expect(YAML.parse("a: >2\n   more\n  regular\n")).toEqual({ a: " more\nregular\n" });
          expect(YAML.parse("a: >2\n\n\n   more\n  regular\n")).toEqual({ a: "\n\n more\nregular\n" });
        });

        test("empty body with explicit indicator", () => {
          expect(YAML.parse("- |2\n")).toEqual([""]);
          expect(YAML.parse("- |2-\n")).toEqual([""]);
          expect(YAML.parse("- |2+\n\n")).toEqual(["\n"]);
        });
      });

      describe("chomping", () => {
        test.each([
          ["strip |-", "|-", "text"],
          ["clip |", "|", "text\n"],
          ["keep |+", "|+", "text\n"],
          ["strip >-", ">-", "text"],
          ["clip >", ">", "text\n"],
          ["keep >+", ">+", "text\n"],
        ])("%s: single line, single trailing break", (_name, hdr, expected) => {
          expect(YAML.parse(`a: ${hdr}\n  text\n`)).toEqual({ a: expected });
        });

        test.each([
          ["strip |-", "|-", "text"],
          ["clip |", "|", "text\n"],
          ["keep |+", "|+", "text\n\n\n"],
        ])("%s: multiple trailing breaks", (_name, hdr, expected) => {
          expect(YAML.parse(`a: ${hdr}\n  text\n\n\n`)).toEqual({ a: expected });
        });

        test.each([
          ["strip |-", "|-", ""],
          ["clip |", "|", ""],
          ["keep |+", "|+", "\n"],
          ["strip >-", ">-", ""],
          ["clip >", ">", ""],
          ["keep >+", ">+", "\n"],
        ])("%s: empty body", (_name, hdr, expected) => {
          expect(YAML.parse(`a: ${hdr}\n\nb: 1\n`)).toEqual({ a: expected, b: 1 });
        });

        test.each([
          ["strip |-", "|-", "text"],
          ["clip |", "|", "text\n"],
          ["keep |+", "|+", "text\n"],
        ])("%s: no final break before EOF", (_name, hdr, expected) => {
          // [165] b-chomped-last(CLIP|KEEP) ::= b-as-line-feed | <end-of-input>
          // Reference parsers split 2-2 on whether <end-of-input> implies a
          // break; the official suite (L24T/01) requires that it does.
          expect(YAML.parse(`a: ${hdr}\n  text`)).toEqual({ a: expected });
        });

        test("keep counts trailing blank lines exactly", () => {
          expect(YAML.parse("- |+\n  a\n")).toEqual(["a\n"]);
          expect(YAML.parse("- |+\n  a\n\n")).toEqual(["a\n\n"]);
          expect(YAML.parse("- |+\n  a\n\n\n")).toEqual(["a\n\n\n"]);
          expect(YAML.parse("- |+\n  a\n\n\n\n")).toEqual(["a\n\n\n\n"]);
        });

        test("keep with whitespace-only trailing lines", () => {
          expect(YAML.parse("- |+\n\n\n")).toEqual(["\n\n"]);
          expect(YAML.parse("- |+\n   \n")).toEqual(["\n"]);
          // yaml-test-suite JEF9/02: trailing indentation at EOF without a
          // final break counts as one trailing empty line.
          expect(YAML.parse("- |+\n   ")).toEqual(["\n"]);
          expect(YAML.parse("- |+\n\n   ")).toEqual(["\n\n"]);
          expect(YAML.parse("- |+\n  a\n  ")).toEqual(["a\n"]);
          expect(YAML.parse("- |+\n  a\n  \n")).toEqual(["a\n\n"]);
        });

        test("clip drops trailing empties but keeps one break", () => {
          expect(YAML.parse("- |\n  a\n\n\n\n")).toEqual(["a\n"]);
          expect(YAML.parse("- |\n  a\n  \n  \n")).toEqual(["a\n"]);
        });
      });

      describe("literal style", () => {
        test("preserves all interior breaks", () => {
          expect(YAML.parse("|\n  a\n  b\n  c\n")).toEqual("a\nb\nc\n");
        });

        test("preserves interior blank lines", () => {
          expect(YAML.parse("|\n  a\n\n  b\n")).toEqual("a\n\nb\n");
          expect(YAML.parse("|\n  a\n\n\n  b\n")).toEqual("a\n\n\nb\n");
        });

        test("preserves more-indented content as spaces", () => {
          expect(YAML.parse("|\n  a\n    b\n  c\n")).toEqual("a\n  b\nc\n");
        });

        test("preserves leading empties", () => {
          expect(YAML.parse("|\n\n  a\n")).toEqual("\na\n");
          expect(YAML.parse("|\n\n\n  a\n")).toEqual("\n\na\n");
        });

        test("preserves tabs in content", () => {
          expect(YAML.parse("|\n  a\tb\n")).toEqual("a\tb\n");
          expect(YAML.parse("|\n  \ta\n")).toEqual("\ta\n");
        });

        test("content with - and . chars", () => {
          expect(YAML.parse("|\n  - item\n  . dot\n")).toEqual("- item\n. dot\n");
          expect(YAML.parse("- |\n  ---\n")).toEqual(["---\n"]);
        });
      });

      describe("folded style", () => {
        test("folds single break to space", () => {
          expect(YAML.parse(">\n  a\n  b\n  c\n")).toEqual("a b c\n");
        });

        test("blank line becomes single break", () => {
          expect(YAML.parse(">\n  a\n\n  b\n")).toEqual("a\nb\n");
          expect(YAML.parse(">\n  a\n\n\n  b\n")).toEqual("a\n\nb\n");
          expect(YAML.parse(">\n  a\n\n\n\n  b\n")).toEqual("a\n\n\nb\n");
        });

        test("more-indented lines are not folded (before)", () => {
          expect(YAML.parse(">\n  a\n    indented\n")).toEqual("a\n  indented\n");
        });

        test("more-indented lines are not folded (after)", () => {
          expect(YAML.parse(">2\n    indented\n  a\n")).toEqual("  indented\na\n");
          expect(YAML.parse("- >1\n   indented\n a\n")).toEqual(["  indented\na\n"]);
        });

        test("more-indented lines are not folded (both sides)", () => {
          expect(YAML.parse(">\n  a\n    x\n  b\n")).toEqual("a\n  x\nb\n");
          expect(YAML.parse(">\n  a\n    x\n    y\n  b\n")).toEqual("a\n  x\n  y\nb\n");
        });

        test("alternating normal/more-indented", () => {
          expect(YAML.parse(">\n  a\n    x\n  b\n    y\n  c\n")).toEqual("a\n  x\nb\n  y\nc\n");
        });

        test("tab makes line more-indented", () => {
          expect(YAML.parse(">\n  a\n  \tindented\n  b\n")).toEqual("a\n\tindented\nb\n");
        });

        test("leading empty lines emitted literally", () => {
          expect(YAML.parse(">\n\n  text\n")).toEqual("\ntext\n");
          expect(YAML.parse(">\n\n\n  text\n")).toEqual("\n\ntext\n");
          expect(YAML.parse(">\n\n\n\n  text\n")).toEqual("\n\n\ntext\n");
        });

        test("blank between more-indented lines", () => {
          expect(YAML.parse(">2\n    a\n\n    b\n")).toEqual("  a\n\n  b\n");
        });

        test("trailing whitespace on content line preserved", () => {
          expect(YAML.parse(">\n  a \n  b\n")).toEqual("a  b\n");
        });
      });

      describe("termination", () => {
        test("ends at less-indented sibling key", () => {
          expect(YAML.parse("a: |\n  x\nb: 1\n")).toEqual({ a: "x\n", b: 1 });
        });

        test("ends at less-indented sequence item", () => {
          expect(YAML.parse("- |\n  x\n- y\n")).toEqual(["x\n", "y"]);
        });

        test("ends at document end marker", () => {
          expect(YAML.parse("|\n  x\n...\n")).toEqual("x\n");
        });

        test("--- inside indented content is literal", () => {
          expect(YAML.parse("- |\n  ---\n  x\n")).toEqual(["---\nx\n"]);
        });

        test("trailing comment at less indent ends scalar", () => {
          expect(YAML.parse("a: |\n    x\n  # comment\nb: 1\n")).toEqual({ a: "x\n", b: 1 });
        });
      });

      describe("line endings", () => {
        test.each([
          ["LF", "\n"],
          ["CRLF", "\r\n"],
        ])("%s normalized to \\n in literal", (_name, eol) => {
          expect(YAML.parse(`|-${eol}  a${eol}  b${eol}`)).toEqual("a\nb");
          expect(YAML.parse(`|${eol}  a${eol}  b${eol}`)).toEqual("a\nb\n");
          expect(YAML.parse(`|+${eol}  a${eol}${eol}`)).toEqual("a\n\n");
        });

        test.each([
          ["LF", "\n"],
          ["CRLF", "\r\n"],
        ])("%s normalized in folded", (_name, eol) => {
          expect(YAML.parse(`>${eol}  a${eol}  b${eol}`)).toEqual("a b\n");
          expect(YAML.parse(`>${eol}  a${eol}${eol}  b${eol}`)).toEqual("a\nb\n");
        });
      });

      describe("error cases", () => {
        test("rejects tab as indentation", () => {
          expect(() => YAML.parse("|\n\ttext\n")).toThrow();
          expect(() => YAML.parse("|\n  text\n\tmore\n")).toThrow();
        });

        test("rejects leading empty more-indented than first content (auto)", () => {
          expect(() => YAML.parse("|\n    \n  text\n")).toThrow();
        });

        test("explicit indicator does not error on more-indented leading empty", () => {
          expect(YAML.parse("- |1\n    \n text\n")).toEqual(["   \ntext\n"]);
        });

        test("rejects content at column 0 with explicit indicator", () => {
          // 4/4 reference parsers error here; previously Bun's stale
          // line_indent let column-0 content slip through as if indented.
          expect(() => YAML.parse("- |1\nx\n")).toThrow();
          expect(() => YAML.parse("- |2\nx\n")).toThrow();
          expect(() => YAML.parse("- >1\nx\n")).toThrow();
        });
      });

      describe("context", () => {
        test("root scalar", () => {
          expect(YAML.parse("|\ntext\n")).toEqual("text\n");
          expect(YAML.parse("|\n text\n")).toEqual("text\n");
        });

        test("sequence value", () => {
          expect(YAML.parse("- |\n  a\n- |\n  b\n")).toEqual(["a\n", "b\n"]);
        });

        test("mapping value", () => {
          expect(YAML.parse("a: |\n  x\nb: |\n  y\n")).toEqual({ a: "x\n", b: "y\n" });
        });

        test("nested mapping", () => {
          expect(YAML.parse("outer:\n  inner: |\n    text\n")).toEqual({ outer: { inner: "text\n" } });
        });

        test("nested sequence", () => {
          expect(YAML.parse("- - |\n    text\n")).toEqual([["text\n"]]);
        });

        test("deep nesting with explicit indicator", () => {
          expect(YAML.parse("a:\n  b:\n    c: |2\n      text\n")).toEqual({ a: { b: { c: "text\n" } } });
        });
      });
    });

    test("handles special keys", () => {
      const yaml = `
"special-key": value1
'another.key': value2
123: numeric-key
`;
      expect(YAML.parse(yaml)).toEqual({
        "special-key": "value1",
        "another.key": "value2",
        "123": "numeric-key",
      });
    });

    describe("explicit mapping keys (?)", () => {
      describe("basic", () => {
        test("single explicit entry", () => {
          expect(YAML.parse("? a\n: 1\n")).toEqual({ a: 1 });
        });

        test("? alone (empty key, no value)", () => {
          expect(YAML.parse("?\n")).toEqual({ null: null });
          expect(YAML.parse("?\n: v\n")).toEqual({ null: "v" });
        });

        test("bare ? followed by next entry at same indent", () => {
          // [185] e-node — `?` with nothing more-indented has empty key
          expect(YAML.parse("?\nb: 2\n")).toEqual({ null: null, b: 2 });
          expect(YAML.parse("x: 1\n?\nb: 2\n")).toEqual({ x: 1, null: null, b: 2 });
          expect(YAML.parse("?\n? b\n")).toEqual({ null: null, b: null });
        });

        test("bare ? followed by more-indented content (the key)", () => {
          expect(YAML.parse("?\n b: 2\n")).toEqual({ "[object Object]": null });
          expect(YAML.parse("?\n  b\n: 2\n")).toEqual({ b: 2 });
        });

        test("bare ? followed by zero-indented sequence (the key)", () => {
          expect(YAML.parse("?\n- a\n- b\n:\n- c\n- d\n")).toEqual({ "a,b": ["c", "d"] });
        });

        test("? then EOF (no newline)", () => {
          expect(YAML.parse("? a")).toEqual({ a: null });
        });

        test("? with quoted key", () => {
          expect(YAML.parse('? "a b"\n: 1\n')).toEqual({ "a b": 1 });
          expect(YAML.parse("? 'a b'\n: 1\n")).toEqual({ "a b": 1 });
        });

        test("? with multiline plain key in flow", () => {
          expect(YAML.parse("[\n? foo\n bar : baz\n]\n")).toEqual([{ "foo bar": "baz" }]);
        });
      });

      describe("compact collection as key", () => {
        test("compact sequence", () => {
          expect(YAML.parse("? - a\n: v\n")).toEqual({ a: "v" });
          expect(YAML.parse("? - a\n  - b\n: v\n")).toEqual({ "a,b": "v" });
          expect(YAML.parse("? - a\n  - b\n  - c\n: v\n")).toEqual({ "a,b,c": "v" });
        });

        test("compact sequence, omitted value", () => {
          expect(YAML.parse("? - a\n  - b\n")).toEqual({ "a,b": null });
        });

        test("compact sequence with extra spaces (m>1)", () => {
          expect(YAML.parse("?  - a\n   - b\n: v\n")).toEqual({ "a,b": "v" });
          expect(YAML.parse("?   - a\n    - b\n: v\n")).toEqual({ "a,b": "v" });
        });

        test("compact mapping", () => {
          expect(YAML.parse("? a: b\n: v\n")).toEqual({ "[object Object]": "v" });
          expect(YAML.parse("? a: b\n: c: d\n")).toEqual({ "[object Object]": { c: "d" } });
        });

        test("compact mapping, omitted value", () => {
          expect(YAML.parse("? a: b\n")).toEqual({ "[object Object]": null });
        });

        test("compact mapping nested under outer mapping", () => {
          expect(YAML.parse("a:\n  ? b: c\n")).toEqual({ a: { "[object Object]": null } });
          expect(YAML.parse("a:\n  ? [1]: 2\n")).toEqual({ a: { "[object Object]": null } });
          expect(YAML.parse("a:\n  ? b: c\n  : d: e\n")).toEqual({ a: { "[object Object]": { d: "e" } } });
        });

        test("compact seq key + compact seq value", () => {
          expect(YAML.parse("? - a\n: - b\n")).toEqual({ a: ["b"] });
          expect(YAML.parse("? - a\n  - b\n: - c\n  - d\n")).toEqual({ "a,b": ["c", "d"] });
        });

        test("nested under sequence (V9D5 pattern)", () => {
          expect(YAML.parse("- ? earth: blue\n  : moon: white\n")).toEqual([{ "[object Object]": { moon: "white" } }]);
        });

        test("compact ? : (M2N8/00 pattern)", () => {
          expect(YAML.parse("- ? : x\n")).toEqual([{ "[object Object]": null }]);
        });

        test("mis-indented compact-seq continuation errors", () => {
          // second `-` at indent 1 ≠ first `-` at indent 2
          expect(() => YAML.parse("? - a\n - b\n: v\n")).toThrow("Unexpected token");
        });
      });

      describe("tab separation after ?", () => {
        test("tab before scalar key (s-separate)", () => {
          expect(YAML.parse("?\ta\n: 1\n")).toEqual({ a: 1 });
          expect(YAML.parse("a: 1\n?\tb\n: 2\n")).toEqual({ a: 1, b: 2 });
          expect(YAML.parse("? a\n: b\n?\tc\n: d\n")).toEqual({ a: "b", c: "d" });
        });

        test("tab then newline after ? is an e-node key", () => {
          // A trailing tab does not change `?\n…` semantics (s-separate, not content).
          expect(YAML.parse("?\t\nb: 2\n")).toEqual({ null: null, b: 2 });
          expect(YAML.parse("?\t\n: v\n")).toEqual({ null: "v" });
        });

        test("tab in nested context", () => {
          expect(YAML.parse("outer:\n  a: 1\n  ?\tb\n  : 2\n")).toEqual({ outer: { a: 1, b: 2 } });
        });

        test("tab before compact construct errors (s-indent requires spaces)", () => {
          // [185] same-line compact constructs after `?`/`:` need s-indent
          // (spaces only); a tab is plain s-separate and does not qualify.
          // All four reference parsers reject these (eemeli/js-yaml/PyYAML/ruamel).
          expect(() => YAML.parse("?\t- a\n: v\n")).toThrow("Tab characters cannot be used as indentation");
          expect(() => YAML.parse("? key\n:\t- x\n")).toThrow("Tab characters cannot be used as indentation");
          expect(() => YAML.parse("? a\n: 1\n? b\n:\t- x\n")).toThrow("Tab characters cannot be used as indentation");
          expect(() => YAML.parse("?\t-\n")).toThrow("Tab characters cannot be used as indentation");
          expect(() => YAML.parse("?\t? a\n: v\n")).toThrow("Tab characters cannot be used as indentation");
        });
      });

      describe("explicit value on same line", () => {
        test("Y79Y/009 pattern (tab + trailing :) errors", () => {
          expect(() => YAML.parse("? key:\n:\tkey:\n")).toThrow("Tab characters cannot be used as indentation");
        });

        test("compact-mapping value via space is valid", () => {
          // `: key:` after `?`-compact-key is value = {key:null} per [191]+[185]
          expect(YAML.parse("? key:\n: key:\n")).toEqual({ "[object Object]": { key: null } });
        });

        test("plain scalar value on : line is fine", () => {
          expect(YAML.parse("? key:\n: val\n")).toEqual({ "[object Object]": "val" });
          expect(YAML.parse("? key:\n:\tval\n")).toEqual({ "[object Object]": "val" });
        });
      });

      describe("? in flow context", () => {
        test("flow sequence", () => {
          expect(YAML.parse("[? a: b]\n")).toEqual([{ a: "b" }]);
          expect(YAML.parse("[? a\n: b]\n")).toEqual([{ a: "b" }]);
        });

        test("flow mapping with explicit ?", () => {
          // [142]/[143] flow `?` is just an indicator; the entry is a normal
          // implicit pair (or e-node : e-node when nothing follows).
          expect(YAML.parse("{? a\n  : b}\n")).toEqual({ a: "b" });
          expect(YAML.parse("{? a}\n")).toEqual({ a: null });
          expect(YAML.parse("{?}\n")).toEqual({ null: null });
          expect(YAML.parse("{?, x}\n")).toEqual({ null: null, x: null });
          expect(YAML.parse("{? a: b, ? c: d}\n")).toEqual({ a: "b", c: "d" });
        });

        test("flow mapping with bare : (e-node key)", () => {
          // [147] e-node key followed by `:`
          expect(YAML.parse("{: x}\n")).toEqual({ null: "x" });
          expect(YAML.parse("{a: 1, : 2}\n")).toEqual({ a: 1, null: 2 });
          expect(YAML.parse("{? : x}\n")).toEqual({ null: "x" });
        });

        test("JSON-adjacent : after JSON-style key", () => {
          // [149] a `:` may follow a quoted scalar / `]` / `}` with no
          // separation in flow context. Plain scalars do not qualify.
          expect(YAML.parse('["a":b]\n')).toEqual([{ a: "b" }]);
          expect(YAML.parse("['a':b]\n")).toEqual([{ a: "b" }]);
          expect(YAML.parse("[{a: 1}:b]\n")).toEqual([{ "[object Object]": "b" }]);
          expect(YAML.parse("[[1, 2]:b]\n")).toEqual([{ "1,2": "b" }]);
          // plain scalar — `:` is part of the scalar
          expect(YAML.parse("[a:b]\n")).toEqual(["a:b"]);
        });

        test("JSON-adjacent : in flow mapping", () => {
          expect(YAML.parse('{"a":b}\n')).toEqual({ a: "b" });
          expect(YAML.parse("{{a: 1}:b}\n")).toEqual({ "[object Object]": "b" });
        });

        test("e-node value after : in flow-seq pair", () => {
          // [149] adjacent value may be e-node
          expect(YAML.parse('["a":]\n')).toEqual([{ a: null }]);
          expect(YAML.parse('["a":,"b":]\n')).toEqual([{ a: null }, { b: null }]);
          expect(YAML.parse("[a: ]\n")).toEqual([{ a: null }]);
          expect(YAML.parse("[[x]:]\n")).toEqual([{ x: null }]);
        });

        test("? with e-node key in flow sequence", () => {
          // [143] ns-flow-map-explicit-entry ::= … | (e-node e-node)
          expect(YAML.parse("[? ]\n")).toEqual([{ null: null }]);
          expect(YAML.parse("[?,]\n")).toEqual([{ null: null }]);
          expect(YAML.parse("[? , ? ]\n")).toEqual([{ null: null }, { null: null }]);
          expect(YAML.parse("[? : x]\n")).toEqual([{ null: "x" }]);
          expect(YAML.parse("[\n?\n]\n")).toEqual([{ null: null }]);
        });

        test("? with JSON-adjacent key in flow sequence", () => {
          // [150] flow-seq `?` key parse is in flow-key context, so the
          // post-JSON-node `:` lookahead recognizes adjacency.
          expect(YAML.parse('[? "a":1]\n')).toEqual([{ a: 1 }]);
          expect(YAML.parse("[? [x]:1]\n")).toEqual([{ x: 1 }]);
          expect(YAML.parse("[? {a:1}:2]\n")).toEqual([{ "[object Object]": 2 }]);
        });

        test("rejects ? in non-pair flow positions", () => {
          // [148] flow-map value is ns-flow-node; [143] explicit key is
          // ns-flow-map-implicit-entry — neither admits another `?`.
          expect(() => YAML.parse("{a: ?}\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("{? ?}\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("[? ? a]\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("{a: ? : b}\n")).toThrow("Unexpected token");
        });

        test(":-prefixed plain scalar after ?", () => {
          // [126] `:` followed by ns-plain-safe is ns-plain-first; the post-`?`
          // scan stays in flow-in so this is a plain-scalar key, not a separator.
          expect(YAML.parse("[? :b]\n")).toEqual([{ ":b": null }]);
          expect(YAML.parse("{? :b}\n")).toEqual({ ":b": null });
          expect(YAML.parse("[? :b: c]\n")).toEqual([{ ":b": "c" }]);
        });

        test("rejects nested : in flow-seq explicit-entry value", () => {
          // [147] the value is ns-flow-node, not a pair.
          expect(() => YAML.parse("[?\n  a: b: c]\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("[? a:\n  b: c]\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("[? a: b: c]\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("[? [1]: [2]: 3]\n")).toThrow("Unexpected token");
        });

        test("e-node pair value is gated to pair-allowed positions", () => {
          // The [149] e-node arm in parse_block_mapping must not fire when
          // reached via a flow-map value (where ns-flow-pair is not allowed).
          expect(() => YAML.parse('{a: "b":,c: d}\n')).toThrow("Unexpected token");
          expect(() => YAML.parse("{a: [1]:,c: d}\n")).toThrow("Unexpected token");
          expect(() => YAML.parse('{x: "a":,b}\n')).toThrow("Unexpected token");
        });

        test("plain scalar in flow-in terminates at : followed by flow indicator", () => {
          // [130] `:` is ns-plain-char only when followed by ns-plain-safe(c);
          // in flow context that excludes c-flow-indicator.
          expect(() => YAML.parse("{a: b:,c: d}\n")).toThrow("Unexpected token");
        });
      });

      describe("anchor/tag on empty node ([161] e-scalar)", () => {
        test("anchor on empty mapping value", () => {
          // [197] s-l+flow-in-block: content on a later line must be at
          // indent > n; `b` at indent 0 is the next key, not content for `&x`.
          const r = YAML.parse("a: &x\nb: *x\n");
          expect(r).toEqual({ a: null, b: null });
          expect(r.a).toBe(r.b);
        });

        test("tag on empty mapping value", () => {
          expect(YAML.parse("a: !!str\nb: y\n")).toEqual({ a: "", b: "y" });
          expect(YAML.parse("a: &x !!str\nb: *x\n")).toEqual({ a: "", b: "" });
        });

        test("anchor on empty sequence item", () => {
          const r = YAML.parse("- &a\n- *a\n");
          expect(r).toEqual([null, null]);
          expect(r[0]).toBe(r[1]);
        });

        test("content at indent > n still attaches", () => {
          // s-separate-lines(n+1): content on later line at indent > n.
          expect(YAML.parse("a: &x\n  b\n")).toEqual({ a: "b" });
          expect(YAML.parse("a: &x\n b\n")).toEqual({ a: "b" });
          expect(YAML.parse("a:\n &x\n b\n")).toEqual({ a: "b" });
        });

        test("[200]/[201] block sequence may sit at indent n", () => {
          // BLOCK-OUT seq-space(n) = l+block-sequence(n-1).
          expect(YAML.parse("a: !!seq\n- x\n- y\n")).toEqual({ a: ["x", "y"] });
          expect(YAML.parse("a:\n &m\n- x\n")).toEqual({ a: ["x"] });
        });

        test("second property at parent indent terminates first", () => {
          // [197] property at indent ≤ n is the parent's, not value content.
          expect(() => YAML.parse("key: &x\n!!map\n  a: b\n")).toThrow("Unexpected token");
        });

        test("second anchor at indent > n is the [200] collection's first key", () => {
          const r = YAML.parse("top: &node\n  &k key: one\n");
          expect(r).toEqual({ top: { key: "one" } });
        });

        test("anchor on empty `?` key", () => {
          expect(YAML.parse("? &d\n: v\n")).toEqual({ null: "v" });
          expect(YAML.parse("- ? &d\n- ? &e\n  : &a\n")).toEqual([{ null: null }, { null: null }]);
        });

        test("anchor on e-node implicit key — [200]/[193] line split", () => {
          // Same line as `:` → key's anchor.
          expect(YAML.parse("&a : x\nb: *a\n")).toEqual({ null: "x", b: null });
          // Prior line → [200] collection's anchor.
          expect(YAML.parse("- &a\n  : x\n- *a\n")).toEqual([{ null: "x" }, { null: "x" }]);
          // Two anchors on separate lines before `:` — the inner can't be the
          // key's (different line), and [161] disallows two collection-props.
          expect(() => YAML.parse("&outer\n&inner\n: x\n")).toThrow("Multiple anchors");
          // Overflow (3 anchors / 2 tags) reaches the post-loop guards.
          expect(() => YAML.parse("&a\n&b\n&c : x\n")).toThrow("Multiple anchors");
          expect(() => YAML.parse("!!str\n!!map\n: x\n")).toThrow("Multiple tags");
        });

        test("two anchors before e-node `:` (outer=mapping, inner=key)", () => {
          // Valid per [200]/[193]: outer anchors the collection, inner the
          // e-node key.
          expect(YAML.parse("&outer\n&inner : x\n")).toEqual({ null: "x" });
        });

        test("tag on e-node implicit key — [200]/[193] line split", () => {
          // Same line → key's tag (`!!str` e-node = "").
          expect(YAML.parse("!!str : x\n")).toEqual({ "": "x" });
          // Prior line → collection's tag; key stays null.
          expect(YAML.parse("!!str\n: x\n")).toEqual({ null: "x" });
        });

        test("at top level, content at indent 0 is still content (n = -1)", () => {
          expect(YAML.parse("&x\nb\n")).toEqual("b");
          expect(YAML.parse("&x\n")).toEqual(null);
        });

        test("nested explicit `?` key uses its own indent for sibling detection", () => {
          // The `?` key parse passes the `?`'s indent as n, not the outer
          // mapping's, so `:` at the inner indent terminates the entry.
          expect(YAML.parse("x:\n  ? a\n  : b\ny: z\n")).toEqual({
            x: { a: "b" },
            y: "z",
          });
          expect(YAML.parse("? a\n:\n  ? b\n  : c\n")).toEqual({ a: { b: "c" } });
        });

        test("seq-item property followed by non-`- ` at parent indent", () => {
          // [185] s-l+block-indented(n, BLOCK-IN): content on a later line at
          // indent ≤ n belongs to the parent.
          expect(() => YAML.parse("- &a\nk: v\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("- &a\nb\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("-\na\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("-\ta: b\n")).toThrow("Tab characters cannot be used as indentation");
        });

        test("rejects same-line `?` at indent ≤ n after indicator", () => {
          // [185] compact construct on the indicator line needs s-indent
          // (spaces, indent ≥ n+1). Tab leaves indent at the line's natural
          // value; implicit-`:` scan has no additional_parent_indent.
          expect(() => YAML.parse("?\t? x\n")).toThrow("Tab characters cannot be used as indentation");
          expect(() => YAML.parse("a:\t? x\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("-\t? x\n")).toThrow("Tab characters cannot be used as indentation");
          // [194] implicit value reaches s-l+block-node, not block-indented;
          // no same-line compact `?` allowed.
          expect(() => YAML.parse("a: ? x\n")).toThrow("Unexpected token");
          // [186] seq entry reaches block-indented; compact `?` is valid here.
          expect(YAML.parse("- ? x\n")).toEqual([{ x: null }]);
        });

        test("anchor on empty subsequent-mapping value", () => {
          const r = YAML.parse("a: 1\nb: &x\nc: *x\n");
          expect(r).toEqual({ a: 1, b: null, c: null });
          expect(YAML.parse("a: 1\nb: !!str\nc: y\n")).toEqual({ a: 1, b: "", c: "y" });
        });

        test("tag on empty `?` key", () => {
          expect(YAML.parse("? !!str\n: v\n")).toEqual({ "": "v" });
          expect(YAML.parse("? !!str &k\n: *k\n")).toEqual({ "": "" });
        });

        test("anchor and tag in both orders on e-node", () => {
          expect(YAML.parse("a: &x !!str\nb: *x\n")).toEqual({ a: "", b: "" });
          expect(YAML.parse("a: !!str &x\nb: *x\n")).toEqual({ a: "", b: "" });
          expect(YAML.parse("- &x !!str\n- *x\n")).toEqual(["", ""]);
          expect(YAML.parse("- !!str &x\n- *x\n")).toEqual(["", ""]);
        });

        test("properties span lines, content/e-node decided by next-line indent", () => {
          expect(YAML.parse("a:\n  &x\n  !!str\nb: *x\n")).toEqual({ a: "", b: "" });
          expect(YAML.parse("a:\n  &x\n  !!str\n  c\n")).toEqual({ a: "c" });
          expect(YAML.parse("a:\n  &x\n  b\n")).toEqual({ a: "b" });
        });

        test("block scalar after a property uses the indicator's indent", () => {
          // Token.indent for `|`/`>` is the indicator's s-indent (not the
          // auto-detected content indent), so belongs_to_parent compares
          // consistently with other scalar kinds.
          expect(YAML.parse("a: &x\n |\nb: c\n")).toEqual({ a: "", b: "c" });
          expect(YAML.parse("a: &x\n >\nb: c\n")).toEqual({ a: "", b: "c" });
          expect(YAML.parse("a: !!str\n |\n  text\nb: c\n")).toEqual({ a: "text\n", b: "c" });
          // [199] s-separate(n+1,c) before `|`: indent 0 isn't reached.
          expect(() => YAML.parse("key:\n|\n text\n")).toThrow("Unexpected token");
        });

        test("rewind only applies to plain single-line scalars", () => {
          // Quoted scalars: token.start is past the opening quote, and
          // ScanOptions.tag doesn't affect their resolution anyway.
          expect(YAML.parse('a: !!str\n"b": c\n')).toEqual({ a: "", b: "c" });
          expect(YAML.parse("a: !!str\n'b': c\n")).toEqual({ a: "", b: "c" });
          // Same for a seq entry; the tag resolves e-scalar and the quoted
          // sibling is not re-scanned.
          expect(YAML.parse('- !!str\n- "123"\n')).toEqual(["", "123"]);
          expect(YAML.parse("- !!str\n- '123'\n")).toEqual(["", "123"]);
          // A quoted scalar that *is* content (indent > n) takes the tag as-is.
          expect(YAML.parse('a:\n  !!str\n  "0xFF"\n')).toEqual({ a: "0xFF" });
          expect(YAML.parse("a:\n  !!str\n  '0xFF'\n")).toEqual({ a: "0xFF" });
          // Block scalar at parent indent after a tag: tag resolves e-scalar
          // (`|` at indent 0 cannot be [197] flow-in-block content for `a:`).
          expect(() => YAML.parse("a: !!str\n|\n text\n")).toThrow("Unexpected token");
        });

        test("multi-line quoted scalars fold line breaks per [120]/[109]", () => {
          // Line folding: a single break becomes a space, an extra break
          // becomes a literal newline, and `\\<break>` in double-quoted is a
          // line continuation (no space). These are the inputs the old
          // `multiline` computation keyed on; the resolved value is the only
          // observable.
          expect(YAML.parse('a: "one\n  two"\n')).toEqual({ a: "one two" });
          expect(YAML.parse("a: 'one\n  two'\n")).toEqual({ a: "one two" });
          expect(YAML.parse('a: "one\n\n  two"\n')).toEqual({ a: "one\ntwo" });
          expect(YAML.parse('a: "one\\\n  two"\n')).toEqual({ a: "onetwo" });
          expect(YAML.parse('a:\n  "one\n   two"\nb: y\n')).toEqual({ a: "one two", b: "y" });
          expect(YAML.parse("a:\n  'one\n   two'\nb: y\n")).toEqual({ a: "one two", b: "y" });
          // Same folding applies in flow context.
          expect(YAML.parse('["a\n b", c]\n')).toEqual(["a b", "c"]);
          expect(YAML.parse('{"a\n b": 1}\n')).toEqual({ "a b": 1 });
          // A multi-line quoted scalar used as an implicit block-map key is
          // still a [154] violation, regardless of how the value folds.
          expect(() => YAML.parse('a: !!str\n"b\n c": x\n')).toThrow("Multiline implicit key");
        });

        test("tag does not leak to abandoned sibling key", () => {
          // The post-tag re-scan resolves a plain scalar under that tag; when
          // belongs_to_parent then abandons it, the sibling key must be
          // re-scanned tag-neutral.
          expect(YAML.parse("a: !!str\n0xFF: c\n")).toEqual({ a: "", 255: "c" });
          expect(YAML.parse("a: !!str\n~: c\n")).toEqual({ a: "", null: "c" });
          expect(YAML.parse("a: !!int\ntrue: c\n")).toEqual({ a: null, true: "c" });
          // Content (indent > n) keeps the tag.
          expect(YAML.parse("a: !!str\n  0xFF\n")).toEqual({ a: "0xFF" });
          expect(YAML.parse("a:\n  !!str\n  0xFF\n")).toEqual({ a: "0xFF" });
        });

        test("tag on e-node resolves per resolve_null", () => {
          expect(YAML.parse("a: !!null\nb: y\n")).toEqual({ a: null, b: "y" });
          expect(YAML.parse("a: !!str\nb: y\n").a).toBe("");
          // Unknown tag on e-scalar resolves as null.
          expect(YAML.parse("a: !foo\nb: y\n")).toEqual({ a: null, b: "y" });
        });

        test("BLOCK-OUT vs BLOCK-IN seq-space at indent == n", () => {
          // [201] After `:` (BLOCK-OUT) a `- ` at indent n is content; after
          // `-` (BLOCK-IN) it's a sibling.
          expect(YAML.parse("a:\n- x\n")).toEqual({ a: ["x"] });
          expect(YAML.parse("-\n- x\n")).toEqual([null, "x"]);
          expect(YAML.parse("-\n  - x\n")).toEqual([["x"]]);
        });

        test("properties on e-node in flow context (PW8X family)", () => {
          expect(YAML.parse("[&a , *a]\n")).toEqual([null, null]);
          expect(YAML.parse("[!!str , !!null ]\n")).toEqual(["", null]);
          expect(YAML.parse("{? &k : v, x: *k}\n")).toEqual({ null: "v", x: null });
          expect(YAML.parse("{&a : v}\n")).toEqual({ null: "v" });
        });

        test("two anchors on a seq item: [200] collection vs first-key", () => {
          // The helper falls through on a second anchor so parse_node's
          // mapping-anchor split applies. Only valid when the content is a
          // mapping (so the second anchors the first key).
          expect(YAML.parse("- &outer\n  &inner b: 1\n- *outer\n- *inner\n")).toEqual([{ b: 1 }, { b: 1 }, "b"]);
          expect(() => YAML.parse("- &x &y a\n")).toThrow("Multiple anchors");
          // The inner anchor is the implicit key's, so it must share the
          // key's line (BLOCK-KEY = s-separate-in-line). On its own line it
          // would be a second [200] collection-prop, which [161] disallows.
          expect(() => YAML.parse("- &x\n  &y\n  a: 1\n")).toThrow("Multiple anchors");
          expect(() => YAML.parse("a: &x\n  &y\n  c: 1\n")).toThrow("Multiple anchors");
          // Both props more-indented; inner same-line as key — valid.
          expect(YAML.parse("a:\n  &x\n  &y c: 1\n")).toEqual({ a: { c: 1 } });
          // 3rd anchor on a 3rd line — set_anchor's overflow guard catches it.
          expect(() => YAML.parse("&a\n&b\n&c d: 1\n")).toThrow("Multiple anchors");
        });

        test.todo("two tags before e-node `:` — [200]/[193] line split (tag analogue)", () => {
          // The MappingValue arm clears has_anchor/has_mapping_anchor but not
          // has_mapping_tag, so the post-loop guard over-rejects the valid
          // 2-tag case. set_tag also lacks the has_mapping_tag.is_some()
          // overflow guard that set_anchor has, so a 3rd tag on a 3rd line
          // silently overwrites instead of erroring.
          expect(YAML.parse("!!map\n!!str : x\n")).toEqual({ "": "x" });
          expect(() => YAML.parse("!!a\n!!b\n!!c d: 1\n")).toThrow("Multiple tags");
        });
      });

      // [62]/[63] s-indent(n) is spaces only. A tab in indent position is
      // s-separate-in-line — valid before [197] flow-in-block content, never
      // before a [184]/[192]/[195] structural sibling (`-`/`?`/`:`/key).
      describe("tab in s-indent position", () => {
        const TAB_ERR = "Tab characters cannot be used as indentation";

        test("rejects tab before sibling block-seq `-` ([184])", () => {
          expect(() => YAML.parse("- a\n\t- b\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("k:\n  - a\n  \t- b\n")).toThrow(TAB_ERR);
        });

        test("rejects tab before sibling block-map entry ([192]/[195])", () => {
          expect(() => YAML.parse("a: 1\n\tb: 2\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("foo:\n  a: 1\n  \tb: 2\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("? a\n\t? b\n")).toThrow(TAB_ERR);
          // Tag-neutral rewind in the helper preserves the taint.
          expect(() => YAML.parse("a: !!str\n\tb: 2\n")).toThrow(TAB_ERR);
        });

        test("rejects tab before explicit `:` continuation ([191])", () => {
          expect(() => YAML.parse("? a\n\t: b\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("k:\n  ? a\n  \t: b\n")).toThrow(TAB_ERR);
        });

        test("rejects tab before first `?`/`:` of a new mapping", () => {
          expect(() => YAML.parse("a:\n  \t? x\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("a:\n  \t: x\n")).toThrow(TAB_ERR);
        });

        test("rejects tab before first `-` of a new sequence", () => {
          expect(() => YAML.parse("a:\n  \t- x\n")).toThrow(TAB_ERR);
        });

        test("rejects tab in compact-construct position ([185] same line)", () => {
          // Y79Y/005, /006, /007, /008 family.
          expect(() => YAML.parse("- \t-\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("?\t-\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("? -\n:\t-\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("?\tkey:\n")).toThrow(TAB_ERR);
        });

        test("rejects tab before sibling that immediately follows block-scalar body", () => {
          // The block-scalar body scanner is the third leading-whitespace
          // consumer (after scan() and fold_lines()) and must taint
          // tab_after_indent on the line that terminates the body.
          expect(() => YAML.parse("- |\n  x\n\t- y\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("a: |\n  x\n\tb: y\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("? |\n  x\n\t: y\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("a: >\n  x\n\tb: y\n")).toThrow(TAB_ERR);
          // Same when the FIRST line after the header terminates (phase-1).
          expect(() => YAML.parse("a:\n  - |\n  \t- x\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("a:\n  key: |\n  \tsibling: x\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("a:\n  key: >\n  \tsibling: x\n")).toThrow(TAB_ERR);
          // Tab in more-indented body content is valid (part of the scalar).
          expect(YAML.parse("- |\n  x\n  \ty\n")).toEqual(["x\n\ty\n"]);
          expect(YAML.parse("- |\n  \t- x\n")).toEqual(["\t- x\n"]);
        });

        test("rejects tab before alias/flow as implicit-key sibling", () => {
          expect(() => YAML.parse("&x a: 1\n\t*x : 2\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("a: 1\n\t[b]: 2\n")).toThrow(TAB_ERR);
          expect(() => YAML.parse("a: 1\n\t{b}: 2\n")).toThrow(TAB_ERR);
        });

        test("accepts tab before [197] flow-in-block content", () => {
          // s-separate(n+1,c) admits s-separate-in-line (which permits tab)
          // after s-indent(n+1).
          expect(YAML.parse("a:\n  \tb\n")).toEqual({ a: "b" });
          expect(YAML.parse("a:\n  \t[1]\n")).toEqual({ a: [1] });
          expect(YAML.parse("a:\n  \t&x b\n")).toEqual({ a: "b" });
          expect(YAML.parse('a:\n  \t"b"\n')).toEqual({ a: "b" });
        });

        test("accepts tab as same-line s-separate after indicator", () => {
          // [80] s-separate-in-line between indicator and content.
          expect(YAML.parse("-\tx\n")).toEqual(["x"]);
          expect(YAML.parse("?\tx\n")).toEqual({ x: null });
          expect(YAML.parse(":\tx\n")).toEqual({ null: "x" });
          expect(YAML.parse("a:\tx\n")).toEqual({ a: "x" });
        });

        test("accepts tab in flow context (not s-indent)", () => {
          expect(YAML.parse("[\n\ta\n]\n")).toEqual(["a"]);
          expect(YAML.parse("{\n\ta: 1\n}\n")).toEqual({ a: 1 });
        });

        test("accepts tab in plain-scalar fold (continuation, not key)", () => {
          // The tab is consumed by fold_lines lookahead; the next line is
          // content of the same plain scalar, not a sibling.
          expect(YAML.parse("a: 1\n  \tb\n")).toEqual({ a: "1 b" });
        });

        // The tag-neutral rewind in parse_block_indented re-scans an
        // abandoned scalar from token.start (past the tab), so the original
        // taint must be preserved across the rewind. Exhaustive over each
        // indicator × each property prefix × each tab position.
        describe("property prefix does not lose tab taint on abandoned sibling", () => {
          const indicators = [
            ["map-value", (n: string, p: string, t: string) => `${n}a: ${p}\n${t}b: 2\n`],
            ["seq-entry", (n: string, p: string, t: string) => `${n}- a\n${n}- ${p}\n${t}- b\n`],
            ["explicit-key", (n: string, p: string, t: string) => `${n}? a\n${n}? ${p}\n${t}? b\n`],
          ] as const;
          const props = ["!!str", "&x", "!!str &x", "&x !!str"] as const;
          const tabs = [
            ["col0", "\t", ""],
            ["after-spaces", "  \t", "  "],
          ] as const;
          for (const [iname, build] of indicators) {
            for (const prop of props) {
              for (const [tname, tab, indent] of tabs) {
                test(`${iname} × ${prop} × ${tname}`, () => {
                  expect(() => YAML.parse(build(indent, prop, tab))).toThrow(TAB_ERR);
                });
              }
            }
          }
        });
      });

      describe("flow-context spec conformance", () => {
        test("flow-map requires `,` between entries", () => {
          // [140] ns-s-flow-map-entries — entry must be followed by `,` or `}`.
          expect(() => YAML.parse('{a: "b":1}\n')).toThrow("Unexpected token");
          expect(() => YAML.parse("{a: 1 b: 2}\n")).toThrow("Unexpected token");
        });

        test(":-prefixed plain scalar after `? &x` / `? !!str`", () => {
          // The first scan after `?` is in flow-in so `:b` tokenizes as
          // ns-plain-first per [126]; parse_flow_explicit_key consumes
          // c-ns-properties in flow-in too, so the post-property re-scan does
          // the same.
          expect(YAML.parse("[? &x :b]\n")).toEqual([{ ":b": null }]);
          expect(YAML.parse("{? !!str :b}\n")).toEqual({ ":b": null });
        });

        test("flow-map value is ns-flow-node, not a pair", () => {
          // [147] c-ns-flow-map-separate-value — value is ns-flow-node only.
          expect(() => YAML.parse("{a: b: c}\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("{? a: b: c}\n")).toThrow("Unexpected token");
        });

        test("flow-map value with multiline c-ns-properties before nested pair", () => {
          // [147] flow-map value is ns-flow-node; the Scalar arm returns the
          // bare scalar in FlowIn when !flow_pair_allowed, regardless of cmi.
          expect(() => YAML.parse("{a: &x\n b: c}\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("{a: !!str\n b: c}\n")).toThrow("Unexpected token");
        });

        test("flow-seq pair value on next line at column ≤ key indent", () => {
          // [149]/[80] s-separate(n,FLOW-IN) = s-separate-lines, so a newline
          // before the value at any indentation is valid.
          expect(YAML.parse('["a":\nb]\n')).toEqual([{ a: "b" }]);
          expect(YAML.parse("[a: \nb]\n")).toEqual([{ a: "b" }]);
        });

        test("flow-map [147] value guard mirrored to Alias/SequenceStart/MappingStart arms", () => {
          expect(() => YAML.parse("{a: &x\n [b]: c}\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("{a: &x\n {b}: c}\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("{x: &y 1, a: &z\n *y : c}\n")).toThrow("Unexpected token");
        });

        test("multiline JSON-style key check ordering", () => {
          // §7.4.2 prose says implicit keys are "restricted to a single
          // line", but the official yaml-test-suite (4MUZ/*, 5MUD, 9SA2,
          // K3WX, NJ66, UT92, VJP3/01) expects these to PARSE — the grammar
          // ([148] s-separate spans lines) wins. js-yaml/PyYAML/ruamel reject
          // (libyaml lookahead limit, not spec); eemeli/yaml accepts.
          expect(YAML.parse("{[1]\n:2}\n")).toEqual({ 1: 2 });
          expect(YAML.parse("{{k:1}\n:2}\n")).toEqual({ "[object Object]": 2 });
          expect(YAML.parse('{"a"\n:1}\n')).toEqual({ a: 1 });
          // Block context ([150] s-separate-in-line) and flow-seq pairs
          // ([151]/[150]) are still single-line.
          expect(() => YAML.parse("[1]\n:2\n")).toThrow();
          expect(() => YAML.parse("[[1]\n:2]\n")).toThrow("Multiline implicit key");
        });

        test("tab before block construct after `?`/`:` (Y79Y/008 family)", () => {
          // [185] s-l+block-indented requires s-indent (spaces only) before a
          // same-line compact construct.
          expect(() => YAML.parse("?\ta: b\n")).toThrow("Tab characters cannot be used as indentation");
          expect(() => YAML.parse("? a\n:\t? b\n")).toThrow("Tab characters cannot be used as indentation");
          expect(() => YAML.parse("?\t: x\n")).toThrow("Tab characters cannot be used as indentation");
        });

        test("block-scalar phase-2 mid-line `---`/`...` is content, not a doc marker", () => {
          expect(YAML.parse("|\nx\n  z---\n")).toEqual("x\n  z---\n");
          expect(YAML.parse("|\nx\n  z...\n")).toEqual("x\n  z...\n");
        });

        test("block collection on the `---` line", () => {
          // [200] s-l+block-collection requires s-l-comments (a line break)
          // before l+block-sequence/mapping; same-line content after `---` is
          // s-separate-in-line + ns-flow-node only.
          expect(() => YAML.parse("---\t- x\n")).toThrow();
          expect(() => YAML.parse("--- - x\n")).toThrow();
          // Same-line flow node IS valid.
          expect(YAML.parse("--- foo\n")).toEqual("foo");
          expect(YAML.parse("---\tfoo\n")).toEqual("foo");
        });

        test("`---` inside a plain scalar (issue #25660)", () => {
          // [128] ns-plain-char admits `-`; a `---` not at column 0 (or not
          // followed by /[ \t\r\n]|$/) is content, not c-directives-end.
          expect(YAML.parse("name: some-text---\ndescription: x\n")).toEqual({
            name: "some-text---",
            description: "x",
          });
        });
      });

      // [203]/[204] c-directives-end / c-document-end are line-starting
      // tokens at column 0, followed by s-white/b-break/eof. Everywhere else
      // `-` and `.` are ns-plain-char per [126]/[130]. Exhaustive over
      // position × column × follower × count × scanner context. Each row
      // verified against ≥2/3 of eemeli/yaml, js-yaml, PyYAML.
      describe("`---`/`...` doc-marker recognition", () => {
        const E = (msg = "Unexpected token") => ({ throws: msg });
        test.each([
          // Mid-line / end-of-line in a plain-scalar value (not at column 0)
          ["trail-dash", "a: text---\n", { a: "text---" }],
          ["trail-dot", "a: text...\n", { a: "text..." }],
          ["mid-dash", "a: te---xt\n", { a: "te---xt" }],
          ["mid-dot", "a: te...xt\n", { a: "te...xt" }],
          ["lead-dash", "a: ---text\n", { a: "---text" }],
          ["lead-dot", "a: ...text\n", { a: "...text" }],
          ["only-dash-val", "a: ---\n", { a: "---" }],
          ["only-dot-val", "a: ...\n", { a: "..." }],
          ["git-diff-line", "line: --- a/file\n", { line: "--- a/file" }],
          // Count: only exactly 3 with ws/eol after is a marker
          ["2dash", "a: b--\n", { a: "b--" }],
          ["4dash", "a: b----\n", { a: "b----" }],
          ["5dash", "a: b-----\n", { a: "b-----" }],
          ["2dot", "a: b..\n", { a: "b.." }],
          ["4dot", "a: b....\n", { a: "b...." }],
          // Follower: must be s-white/b-break/eof
          ["col0-4dash", "a\n----\n", "a ----"],
          ["col0-dash-noeol", "a\n---b\n", "a ---b"],
          ["col0-dot-noeol", "a\n...b\n", "a ...b"],
          // Top-level plain scalar (no key prefix)
          ["top-trail", "text---\n", "text---"],
          ["top-trail-dot", "text...\n", "text..."],
          ["top-followed-eof", "text---", "text---"],
          ["top-followed-sp", "text--- more\n", "text--- more"],
          // Column 0 — IS a marker
          ["col0-dash", "a\n---\nb\n", ["a", "b"]],
          ["col0-dot", "a\n...\n", "a"],
          ["col0-dash-sp", "a\n--- b\n", ["a", "b"]],
          ["col0-dash-tab", "a\n---\tb\n", ["a", "b"]],
          ["col0-dash-eof", "a\n---", ["a", null]],
          ["col0-dash-crlf", "a\r\n---\r\nb\r\n", ["a", "b"]],
          // Indented — NOT a marker
          ["indent1-dash", "a\n ---\n", "a ---"],
          ["indent1-dot", "a\n ...\n", "a ..."],
          // Block scalar body
          ["bs-mid", "|\nx\n  z---\n", "x\n  z---\n"],
          ["bs-mid-dot", "|\nx\n  z...\n", "x\n  z...\n"],
          ["bsf-mid", ">\nx\n  z---\n", "x\n  z---\n"],
          ["bs-col0", "|\nx\n---\ny\n", ["x\n", "y"]],
          ["bs-col0-dot", "|\nx\n...\n", "x\n"],
          ["bs-first-mid", "|\n  z---\n", "z---\n"],
          // Quoted scalars — always content
          ["sq", "a: 'x---'\n", { a: "x---" }],
          ["dq", 'a: "x---"\n', { a: "x---" }],
          ["sq-dot", "a: 'x...'\n", { a: "x..." }],
          // Flow context — always content
          ["flow-seq", "[a---, b...]\n", ["a---", "b..."]],
          ["flow-map", "{a: b---}\n", { a: "b---" }],
          ["flow-only", "[---, ...]\n", ["---", "..."]],
          // Nested
          ["nested-trail", "k:\n  a: text---\n  b: y\n", { k: { a: "text---", b: "y" } }],
          ["nested-col0", "k:\n  a: text\n---\nb\n", [{ k: { a: "text" } }, "b"]],
          // Real-world text patterns
          ["ellipsis", "msg: wait...\n", { msg: "wait..." }],
          ["ellipsis-mid", "msg: wait... done\n", { msg: "wait... done" }],
          ["range", "span: 2023--2025\n", { span: "2023--2025" }],
          ["arrow", "dir: <--->\n", { dir: "<--->" }],
          ["em-dash-ish", "a: foo --- bar\n", { a: "foo --- bar" }],
          ["frontmatter", "---\ntitle: x\n---\n", [{ title: "x" }, null]],
          // Mixed
          ["dash-dot", "a: ---...\n", { a: "---..." }],
          ["dot-dash", "a: ...---\n", { a: "...---" }],
          // After --- on the same line: only flow node allowed
          ["doc-sl-seq", "--- - x\n", E()],
          ["doc-sl-seq-tab", "---\t- x\n", E()],
          ["doc-sl-map", "--- a: b\n", E()],
          ["doc-sl-qmark", "--- ? a\n", E()],
          ["doc-sl-flow", "--- [a]\n", ["a"]],
          ["doc-sl-flowmap", "--- {a: 1}\n", { a: 1 }],
          ["doc-sl-scalar", "--- foo\n", "foo"],
          ["doc-nl-seq", "---\n- x\n", ["x"]],
          ["doc-nl-map", "---\na: b\n", { a: "b" }],
          // ... immediately at EOF (no trailing newline)
          ["dot-eof-plain", "abc\n...", "abc"],
          ["dot-eof-seq", "- a\n...", ["a"]],
          ["dot-eof-map", "a: 1\n...", { a: 1 }],
          ["dot-eof-bs", "|\nx\n...", "x\n"],
          ["dot-eof-only", "...", null],
          ["dash-eof-only", "---", null],
          // ── Nesting depth / structural variation ──────────────────────────
          // Deep block-map nesting (--- at columns 8, 12)
          ["deep-3-dash", "a:\n  b:\n    c: text---\n    d: y\n", { a: { b: { c: "text---", d: "y" } } }],
          ["deep-3-dot", "a:\n  b:\n    c: text...\n    d: y\n", { a: { b: { c: "text...", d: "y" } } }],
          ["deep-4", "a:\n  b:\n    c:\n      d: t---\n", { a: { b: { c: { d: "t---" } } } }],
          // Block-seq nesting
          ["seq-2", "- - text---\n", [["text---"]]],
          ["seq-3", "- - - text...\n", [[["text..."]]]],
          ["seq-map-seq", "- a:\n    - b---\n    - c\n", [{ a: ["b---", "c"] }]],
          // Mixed block↔flow
          ["block-flow-seq", "a:\n  - [text---, x]\n", { a: [["text---", "x"]] }],
          ["block-flow-map", "a:\n  - {k: text...}\n", { a: [{ k: "text..." }] }],
          ["flow-in-flow", "[[text---], {k: text...}]\n", [["text---"], { k: "text..." }]],
          ["flow-nested-3", "[[[a---]]]\n", [[["a---"]]]],
          // Block scalar inside nesting
          ["nested-bs", "a:\n  b: |\n    text---\n  c: x\n", { a: { b: "text---\n", c: "x" } }],
          ["nested-bs-fold", "a:\n  b: >\n    text...\n  c: x\n", { a: { b: "text...\n", c: "x" } }],
          ["seq-bs", "- |\n  text---\n- y\n", ["text---\n", "y"]],
          // Quoted inside nesting
          ["nested-sq", "a:\n  b: 'text---'\n  c: x\n", { a: { b: "text---", c: "x" } }],
          ["nested-dq", 'a:\n  b: "text..."\n  c: x\n', { a: { b: "text...", c: "x" } }],
          // Key position (--- as part of a key)
          ["key-dash", "text---: v\n", { "text---": "v" }],
          ["key-dot", "text...: v\n", { "text...": "v" }],
          ["nested-key", "a:\n  text---: v\n", { a: { "text---": "v" } }],
          ["explicit-key", "? text---\n: v\n", { "text---": "v" }],
          // After anchor/tag
          ["anchor-val", "a: &x text---\nb: *x\n", { a: "text---", b: "text---" }],
          ["tag-val", "a: !!str text---\n", { a: "text---" }],
          ["anchor-tag-val", "a: &x !!str text...\n", { a: "text..." }],
          // After flow indicator (, [ {)
          ["flow-after-comma", "[a, text---, b]\n", ["a", "text---", "b"]],
          ["flow-after-colon", "{a: text---, b: text...}\n", { a: "text---", b: "text..." }],
          ["flow-map-key", "{text---: v}\n", { "text---": "v" }],
          // Multi-doc with --- as content in a doc
          ["multidoc-content", "---\na: text---\n---\nb: text...\n", [{ a: "text---" }, { b: "text..." }]],
          // Multi-line plain with --- on continuation (column > 0)
          ["fold-dash", "a: text\n  ---more\n", { a: "text ---more" }],
          ["fold-dot", "a: text\n  ...more\n", { a: "text ...more" }],
          ["fold-dash-end", "a: text\n  more---\n", { a: "text more---" }],
          // Multi-line plain with --- on continuation at column 0 (IS marker)
          ["fold-col0", "a: text\n---\nb\n", [{ a: "text" }, "b"]],
          // Seq item that's just --- (column > 0)
          ["seq-only-dash", "- ---\n- x\n", ["---", "x"]],
          ["seq-only-dot", "- ...\n- x\n", ["...", "x"]],
          // Compact `- -` prefix collision
          ["compact-dash-val", "- - ---\n", [["---"]]],
          // #23489: ellipsis inside quoted strings (the original case `nl` was added for)
          ["i23489", `balance: "👛 لا تمتلك محفظة... !"\n`, { balance: "👛 لا تمتلك محفظة... !" }],
          ["dq-dot-mid", 'a: "x ... y"\n', { a: "x ... y" }],
          ["dq-dot-start", 'a: "... rest"\n', { a: "... rest" }],
          ["dq-dot-end", 'a: "rest ..."\n', { a: "rest ..." }],
          ["dq-dash-mid", 'a: "x --- y"\n', { a: "x --- y" }],
        ] as const)("%s", (_id, input, expected) => {
          if (typeof expected === "object" && expected && "throws" in expected) {
            expect(() => YAML.parse(input)).toThrow(expected.throws as string);
          } else {
            expect(YAML.parse(input)).toEqual(expected);
          }
        });

        test("multi-line quoted scalar: tab-prefixed `---`/`...` is content", () => {
          // is_at_line_start() (prev byte == LF/CR) replaces the `nl &&
          // line_indent==0` gate; after fold_lines() consumed `\n\t`, prev is
          // tab, not at line start.
          expect(YAML.parse("'foo\n\t--- x'\n")).toEqual("foo --- x");
          expect(YAML.parse('"foo\n\t--- x"\n')).toEqual("foo --- x");
          expect(() => YAML.parse("'foo\n--- x'\n")).toThrow("document start");
        });

        test("rejects content on the last `...` line of a multi-suffix run", () => {
          expect(() => YAML.parse("a\n...\n... b\n")).toThrow("Unexpected token");
        });

        test("BOM-prefixed `---` recognized as doc marker", () => {
          // [206] l-document-prefix ::= c-byte-order-mark? l-comment*
          expect(YAML.parse("\uFEFF---\na: 1\n")).toEqual({ a: 1 });
          expect(YAML.parse("\uFEFFa: 1\n")).toEqual({ a: 1 });
          expect(YAML.parse("\uFEFF# comment\na: 1\n")).toEqual({ a: 1 });
          expect(YAML.parse("\uFEFF")).toEqual(null);
          // BOM mid-stream is not stripped (only [206] document-prefix).
          expect(YAML.parse("a: \uFEFFx\n")).toEqual({ a: "\uFEFFx" });
        });

        test("UTF-8 BOM on byte input is stripped", () => {
          expect(YAML.parse(Buffer.from("a: 1\n"))).toEqual({ a: 1 });
          expect(YAML.parse(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("a: 1\n")]))).toEqual({ a: 1 });
        });
      });

      describe("[10.2.1.4] Core schema number resolution", () => {
        // The lexer loop accepted `+`/`-`/`e`/`.` at any position and
        // wtf::parse_double prefix-parses, so `1+1` resolved as 1. Validation
        // now requires the consumed slice to match the Core schema regex.
        test.each([
          ["1+1", "1+1"],
          ["1-1", "1-1"],
          ["++1", "++1"],
          ["--1", "--1"],
          ["+-1", "+-1"],
          ["1e", "1e"],
          ["1e+", "1e+"],
          ["1e-", "1e-"],
          ["1E", "1E"],
          ["1e1.5", "1e1.5"],
          ["1e.5", "1e.5"],
          ["1.2.3", "1.2.3"],
          [".", "."],
          [".e5", ".e5"],
          ["-.e5", "-.e5"],
          ["e5", "e5"],
        ] as const)("%s resolves as string", (input, expected) => {
          expect(YAML.parse(input)).toBe(expected);
        });
        test.each([
          ["1", 1],
          ["-1", -1],
          ["+1", 1],
          ["0", 0],
          ["-0", -0],
          ["1.5", 1.5],
          [".5", 0.5],
          ["-.5", -0.5],
          ["+.5", 0.5],
          ["1.", 1],
          ["1e5", 1e5],
          ["1e+5", 1e5],
          ["1e-5", 1e-5],
          ["1.5e10", 1.5e10],
          [".5e2", 50],
          ["-.5e2", -50],
          ["0x1f", 31],
          ["0o17", 15],
        ] as const)("%s resolves as number %p", (input, expected) => {
          expect(YAML.parse(input)).toBe(expected);
        });
        test.todo.each(["-0x1f", "+0x1f", "-0o17", "+0o17"])(
          "signed hex/octal %s resolves as string (§10.2.1.2)",
          input => {
            // Core schema int regex is `0x [0-9a-fA-F]+` — no sign. js-yaml,
            // PyYAML, ruamel agree. Pre-existing on the int path (not gated
            // by is_core_schema_number, which only validates the float path).
            expect(YAML.parse(input)).toBe(input);
          },
        );
        test.each([
          [".inf", Infinity],
          ["+.inf", Infinity],
          [".Inf", Infinity],
          [".INF", Infinity],
          ["-.inf", -Infinity],
          ["-.Inf", -Infinity],
          ["-.INF", -Infinity],
        ] as const)("%s resolves as %p", (input, expected) => {
          expect(YAML.parse(input)).toBe(expected);
        });
        test(".nan resolves as NaN", () => {
          expect(YAML.parse(".nan")).toBeNaN();
          expect(YAML.parse(".NaN")).toBeNaN();
          expect(YAML.parse(".NAN")).toBeNaN();
        });
      });

      // Bugs surfaced by the multi-modal bughunt (12 finder lenses × 3 rounds).
      // Each todo asserts the spec-correct result.
      describe("bughunt findings", () => {
        describe("NUL byte (U+0000) is not c-printable — should error, not truncate", () => {
          // [1] c-printable excludes NUL. NUL is the peek()/next() EOF sentinel,
          // so a literal NUL in the input must be distinguished from real EOF.
          test.each([
            ["between mappings", "a: 1\x00b: 2"],
            ["inside a plain scalar value", "key: foo\x00bar"],
            ["at start of input", "\x00a: 1"],
            ["as the only byte", "\x00"],
            ["inside a block sequence", "- a\n- b\x00- c"],
            ["inside a literal block scalar", "x: |\n  foo\x00bar"],
            ["inside a folded block scalar", "x: >\n  foo\x00bar"],
            ["in a block scalar header", "x: |\x00"],
            ["inside a comment", "# foo\x00bar\nkey: 1"],
            ["inside a block-scalar header comment", "x: | # foo\x00bar\n  body"],
            ["inside a directive trailing comment", "%YAML 1.2 # c\x00mt\n---\nkey: 1"],
            ["inside a plain scalar (utf16 input)", "😀: foo\x00bar"],
            ["from a Buffer", Buffer.from("a: 1\x00b: 2")],
          ] as const)("%s", (_name, input) => {
            expect(() => YAML.parse(input as string)).toThrow(SyntaxError);
          });
          test("flow collections still error (not truncate) on NUL", () => {
            expect(() => YAML.parse("[a, b\x00, c]")).toThrow(SyntaxError);
            expect(() => YAML.parse("{a: 1\x00, b: 2}")).toThrow(SyntaxError);
          });
          test("quoted scalars still error on NUL", () => {
            expect(() => YAML.parse('"foo\x00bar"')).toThrow(SyntaxError);
            expect(() => YAML.parse("'foo\x00bar'")).toThrow(SyntaxError);
          });
          test('escaped NUL ("\\0") remains valid', () => {
            expect(YAML.parse('"a\\0b"')).toBe("a\x00b");
          });
        });

        test.todo("C0/C1/DEL control characters are not c-printable — should error", () => {
          // [1] c-printable: x09, x0A, x0D, x20-x7E, x85, xA0-D7FF, E000-FFFD,
          // 10000-10FFFF. Currently x01-x08/x0B/x0C/x0E-x1F/x7F/x80-x84/x86-x9F
          // are accepted as scalar content.
          expect(() => YAML.parse("a\x01b")).toThrow();
          expect(() => YAML.parse("a\x7Fb")).toThrow();
          expect(() => YAML.parse("a\x80b")).toThrow();
        });

        test.todo("CRLF in quoted scalars folds as one line break (→ space)", () => {
          // [73] b-l-folded: a single break folds to a space. Currently `\r\n`
          // in quoted scalars produces `\n` instead.
          expect(YAML.parse('"a\r\nb"')).toBe("a b");
          expect(YAML.parse("'a\r\nb'")).toBe("a b");
        });

        test.todo("verbatim/named-handle tags resolve as Core-schema types", () => {
          // [10.2] tag:yaml.org,2002:int via `!<...>` or `%TAG !y! ...` should
          // resolve identically to `!!int`. Currently only the `!!` shorthand
          // resolves.
          expect(YAML.parse("!<tag:yaml.org,2002:int> 42")).toBe(42);
          expect(YAML.parse("%TAG !y! tag:yaml.org,2002:\n---\n!y!int 42")).toBe(42);
        });

        test.todo("explicit tag on quoted scalar coerces ([10.1.1.8] resolve via tag)", () => {
          expect(YAML.parse("!!bool 'true'")).toBe(true);
          expect(YAML.parse('!!int "42"')).toBe(42);
        });

        test.todo("`!!int`/`!!float` validate their content", () => {
          // [10.2.1.2]/[10.2.1.4] — the tag's regex must match.
          expect(() => YAML.parse("!!int 1.5")).toThrow();
          expect(() => YAML.parse("!!float 0x1f")).toThrow();
        });

        test("`\\uXXXX` surrogate pairs combine ([57] ns-esc-16-bit)", () => {
          // YAML 1.2 is a JSON superset; JSON encodes supplementary code
          // points as `\uD8xx\uDCxx` surrogate pairs.
          expect(YAML.parse('"\\uD834\\uDD1E"')).toBe("𝄞");
          expect(YAML.parse('"\\uD83D\\uDE00"')).toBe("😀");
          expect(YAML.parse('"\\ud83d\\ude00"')).toBe("😀");
          expect(YAML.parse('"a\\uD83D\\uDE00b"')).toBe("a😀b");
          expect(YAML.parse('"\\uD83D\\uDE00\\uD83D\\uDE01"')).toBe("😀😁");
          expect(YAML.parse('"\\uDBFF\\uDFFF"')).toBe("\u{10FFFF}");
          // Matches JSON.parse on the same document.
          const doc = '{"k": "\\uD83D\\uDE00"}';
          expect(YAML.parse(doc)).toEqual(JSON.parse(doc));
          // `\U` 32-bit escapes for the same code point still work.
          expect(YAML.parse('"\\U0001F600"')).toBe("😀");
          // Lone or mis-ordered surrogates are rejected.
          expect(() => YAML.parse('"\\uD83D"')).toThrow(SyntaxError);
          expect(() => YAML.parse('"\\uD83Dx"')).toThrow(SyntaxError);
          expect(() => YAML.parse('"\\uDE00"')).toThrow(SyntaxError);
          expect(() => YAML.parse('"\\uDE00\\uD83D"')).toThrow(SyntaxError);
          expect(() => YAML.parse('"\\uD83D\\uD83D"')).toThrow(SyntaxError);
          expect(() => YAML.parse('"\\uD83D\\u0041"')).toThrow(SyntaxError);
          expect(() => YAML.parse('"\\uD83D\\n"')).toThrow(SyntaxError);
          // `\U` ([60] ns-esc-32-bit) names a Unicode character; surrogate
          // code points are not characters and are never combined.
          expect(() => YAML.parse('"\\U0000D83D"')).toThrow(SyntaxError);
          expect(() => YAML.parse('"\\U0000D83D\\uDE00"')).toThrow(SyntaxError);
          expect(() => YAML.parse('"\\U0000D83D\\U0000DE00"')).toThrow(SyntaxError);
        });

        test.todo("s-separate required after tag ([97] c-ns-tag-property)", () => {
          // No whitespace between tag and content.
          expect(() => YAML.parse("!<a>b")).toThrow();
          expect(() => YAML.parse("!tag,x a")).toThrow();
        });

        test.todo("`%YAML`/`%TAG` directive validation", () => {
          // [86]/[88] require arguments; [87] requires major version 1;
          // [89] forbids duplicate handle in same document.
          expect(() => YAML.parse("%YAML\n---\nfoo")).toThrow();
          expect(() => YAML.parse("%YAML 2.0\n---\nfoo")).toThrow();
          expect(() => YAML.parse("%TAG !e! tag:a:\n%TAG !e! tag:b:\n---\nfoo")).toThrow();
        });

        test.todo("§7.4.2 1024-char implicit-key limit enforced", () => {
          const long = Buffer.alloc(1025, "a").toString();
          expect(() => YAML.parse(`${long}: v`)).toThrow();
          expect(() => YAML.parse(`[${long}: v]`)).toThrow();
        });

        test.todo("error message includes line:col position", () => {
          // ParseResultError carries Pos; the JS binding discards it.
          expect(() => YAML.parse("a: 1\nb:\n\tc: 2")).toThrow(/line\s*\d|:\d+:\d+/);
        });

        test.todo("`<<:` merge preserves source property order", () => {
          const r: any = YAML.parse("x: &x\n  a: 1\n  b: 2\n  c: 3\ny:\n  <<: *x");
          expect(Object.keys(r.y)).toEqual(["a", "b", "c"]);
        });

        test.todo("alias with property on prior line is rejected ([104] c-ns-alias-node)", () => {
          // An alias node has no properties; a tag/anchor on a prior line
          // belongs to a different node.
          expect(() => YAML.parse("- &a 1\n- !!str\n  *a")).toThrow();
        });

        test.todo("block-scalar header rejects whitespace before chomp/indent indicator", () => {
          // [162] c-b-block-header: no s-separate between `|`/`>` and indicators.
          expect(() => YAML.parse("| 1\n  text")).toThrow();
        });
      });

      describe("flow comma/separator placement", () => {
        test("JSON-adjacent does not apply in flow-map value position", () => {
          // [147] flow-map value is ns-flow-node, not ns-flow-pair; [140]
          // requires `,`/`}` after the entry.
          expect(() => YAML.parse('{a: "b":c}\n')).toThrow("Unexpected token");
          expect(() => YAML.parse("{x: [a]:b}\n")).toThrow("Unexpected token");
        });

        test("leading/double comma in flow sequence still errors", () => {
          // [138] ns-s-flow-seq-entries — entry must precede `,`
          expect(() => YAML.parse("[ , a]\n")).toThrow("Unexpected token");
          expect(() => YAML.parse("[a, , b]\n")).toThrow("Unexpected token");
        });
      });

      describe("tab-only blank line in block context", () => {
        // Tab on an otherwise-blank line is treated as content separation,
        // not indentation; matches main and eemeli/js-yaml. (PyYAML/ruamel
        // reject — a 2/2 reference split — but Bun has always accepted these
        // and changing it broke other suite cases.)
        test("inside block sequence", () => {
          expect(YAML.parse("-\n\t\n- b\n")).toEqual([null, "b"]);
          expect(YAML.parse("- 'a'\n\t\n- b\n")).toEqual(["a", "b"]);
        });

        test("inside block mapping", () => {
          expect(YAML.parse("a:\n\t\nb: 2\n")).toEqual({ a: null, b: 2 });
        });

        test("tab before comment line", () => {
          expect(YAML.parse("a: \n\t# comment\nb: c\n")).toEqual({ a: null, b: "c" });
        });
      });

      describe("CRLF line endings", () => {
        test("explicit entry", () => {
          expect(YAML.parse("? a\r\n: 1\r\n")).toEqual({ a: 1 });
          expect(YAML.parse("? a\r\n: 1\r\n? b\r\n: 2\r\n")).toEqual({ a: 1, b: 2 });
        });

        test("compact seq key", () => {
          expect(YAML.parse("? - a\r\n  - b\r\n: v\r\n")).toEqual({ "a,b": "v" });
        });
      });

      test("multiple explicit entries", () => {
        expect(YAML.parse("? a\n: 1\n? b\n: 2\n")).toEqual({ a: 1, b: 2 });
        expect(YAML.parse("? a\n: 1\n? b\n: 2\n? c\n: 3\n")).toEqual({ a: 1, b: 2, c: 3 });
      });

      test("explicit key with omitted value", () => {
        expect(YAML.parse("? a\n")).toEqual({ a: null });
        expect(YAML.parse("? a\n? b\n")).toEqual({ a: null, b: null });
        expect(YAML.parse("? a\n? b\n? c\n")).toEqual({ a: null, b: null, c: null });
      });

      test("explicit key followed by implicit entry", () => {
        expect(YAML.parse("? a\nb: 2\n")).toEqual({ a: null, b: 2 });
        expect(YAML.parse("? a\n? b\nc: 3\n")).toEqual({ a: null, b: null, c: 3 });
        expect(YAML.parse("? a\n: 1\nb: 2\n")).toEqual({ a: 1, b: 2 });
      });

      test("implicit entry followed by explicit", () => {
        expect(YAML.parse("a: 1\n? b\n: 2\n")).toEqual({ a: 1, b: 2 });
        expect(YAML.parse("a: 1\n? b\n")).toEqual({ a: 1, b: null });
      });

      test("nested under mapping", () => {
        expect(YAML.parse("outer:\n  ? a\n  : 1\n")).toEqual({ outer: { a: 1 } });
        expect(YAML.parse("outer:\n  ? a\n  : 1\n  ? b\n  : 2\n")).toEqual({ outer: { a: 1, b: 2 } });
        expect(YAML.parse("outer:\n  ? a\n  : 1\n  b: 2\n")).toEqual({ outer: { a: 1, b: 2 } });
      });

      test("nested under sequence", () => {
        expect(YAML.parse("- ? a\n  : 1\n")).toEqual([{ a: 1 }]);
      });

      test("block scalar as key", () => {
        expect(YAML.parse("? |\n  multi\n  line\n: v\n")).toEqual({ "multi\nline\n": "v" });
        expect(YAML.parse("? >\n  folded\n  key\n: v\n")).toEqual({ "folded key\n": "v" });
      });

      test("sequence value (compact, : on next line)", () => {
        expect(YAML.parse("? a\n: - b\n")).toEqual({ a: ["b"] });
        expect(YAML.parse("? a\n: - b\n  - c\n")).toEqual({ a: ["b", "c"] });
        expect(YAML.parse("? a\n:\n  - b\n  - c\n")).toEqual({ a: ["b", "c"] });
      });

      test("block scalar value", () => {
        expect(YAML.parse("? a\n: |\n  v\n")).toEqual({ a: "v\n" });
      });

      test("mapping value", () => {
        expect(YAML.parse("? a\n: b: c\n")).toEqual({ a: { b: "c" } });
      });

      test("tagged key", () => {
        expect(YAML.parse("? !!str a\n: !!int 47\n")).toEqual({ a: 47 });
      });

      test("anchored key", () => {
        expect(YAML.parse("? &x a\n: v\n")).toEqual({ a: "v" });
      });

      test("comments", () => {
        expect(YAML.parse("? a # c\n: 1\n")).toEqual({ a: 1 });
        expect(YAML.parse("? a\n: # c\n  1\n")).toEqual({ a: 1 });
      });

      test("rejects implicit compact-seq value on key line", () => {
        expect(() => YAML.parse("a: - b\n")).toThrow("Unexpected token");
      });

      test("rejects nested implicit on key line", () => {
        expect(() => YAML.parse("a: b: c\n")).toThrow("Unexpected token");
      });

      test("rejects explicit : at deeper indent than ?", () => {
        // [191] requires `:` at exactly the `?` indent
        expect(() => YAML.parse("? a\n  : b\n")).toThrow("Unexpected token");
        expect(() => YAML.parse("x: 1\n? a\n  : b\n")).toThrow("Unexpected token");
        expect(() => YAML.parse("x: 1\n? a\n    : b\n")).toThrow("Unexpected token");
        // tab after `:` does not bypass the [191] check
        expect(() => YAML.parse("? a\n  :\tb\n")).toThrow("Unexpected token");
        expect(() => YAML.parse("x: 1\n? a\n  :\tb\n")).toThrow("Unexpected token");
      });

      test("explicit : at lesser indent ends the entry (e-node value)", () => {
        // [189] explicit-value is optional; a `:` at lesser indent belongs to
        // an outer construct. Reference parsers split 2-2 on this.
        expect(YAML.parse("outer:\n  ? a\n: v\n")).toEqual({ outer: { a: null }, null: "v" });
        expect(YAML.parse("outer:\n  x: 1\n  ? a\n: v\n")).toEqual({ outer: { x: 1, a: null }, null: "v" });
        expect(YAML.parse("?\n  ? inner\n: outer\n")).toEqual({ "[object Object]": "outer" });
        // tab after the lesser-indent `:` does not change the e-node decision
        expect(YAML.parse("outer:\n  ? a\n:\tv\n")).toEqual({ outer: { a: null }, null: "v" });
      });

      test("Y79Y/009 pattern in loop entries", () => {
        // The first-entry guard must also apply in the loop: a second entry
        // on the same line as the explicit `:` is rejected in all positions.
        expect(() => YAML.parse("? key:\n:\tkey:\n")).toThrow("Tab characters cannot be used as indentation");
        expect(() => YAML.parse("x: 1\n? key:\n:\tkey:\n")).toThrow("Tab characters cannot be used as indentation");
      });

      test("flow collection inside ? - …", () => {
        expect(YAML.parse("? - [1]\n: b\n")).toEqual({ 1: "b" });
        expect(YAML.parse("? - {k: 1}\n: b\n")).toEqual({ "[object Object]": "b" });
      });

      test("alias / flow collection as nested explicit key", () => {
        expect(YAML.parse("outer:\n  ? [1]\n  : v\n")).toEqual({ outer: { 1: "v" } });
        expect(YAML.parse("outer:\n  ? {k: 1}\n  : v\n")).toEqual({ outer: { "[object Object]": "v" } });
        expect(YAML.parse("x: &a 1\nouter:\n  ? *a\n  : v\n")).toEqual({ x: 1, outer: { 1: "v" } });
      });

      test("pnpm-lock style", () => {
        expect(
          YAML.parse(
            "packages:\n  ? /@types/node@20.0.0\n  : dependencies:\n      undici-types: 5.0.0\n    dev: true\n",
          ),
        ).toEqual({
          packages: { "/@types/node@20.0.0": { dependencies: { "undici-types": "5.0.0" }, dev: true } },
        });
      });
    });

    test("handles empty values", () => {
      const yaml = `
empty_string: ""
empty_array: []
empty_object: {}
null_value: null
`;
      expect(YAML.parse(yaml)).toEqual({
        empty_string: "",
        empty_array: [],
        empty_object: {},
        null_value: null,
      });
    });

    test("throws on invalid YAML", () => {
      expect(() => YAML.parse("[ invalid")).toThrow(SyntaxError);
      expect(() => YAML.parse("{ key: value")).toThrow(SyntaxError);
      expect(() => YAML.parse(":\n :  - invalid")).toThrow(SyntaxError);
    });

    test("throws on invalid flow mapping inside block mapping (no assertion failure)", () => {
      expect(() => YAML.parse("a: 1\nb: {c]}")).toThrow(SyntaxError);
      expect(() => YAML.parse("a: 1\nb: {c: [}")).toThrow(SyntaxError);
      expect(() => YAML.parse("a: 1\nb: { @bad }")).toThrow(SyntaxError);
      expect(() => YAML.parse("a: 1\nb: {x: {y: ]}}")).toThrow(SyntaxError);
      expect(() => YAML.parse("first: ok\nsecond: {key: [unclosed}")).toThrow(SyntaxError);
    });

    test("handles dates and timestamps", () => {
      const yaml = `
date: 2024-01-15
timestamp: 2024-01-15T10:30:00Z
`;
      const result = YAML.parse(yaml);
      // Dates might be parsed as strings or Date objects depending on implementation
      expect(result.date).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    test("preserves object identity for aliases", () => {
      const yaml = `
definitions:
  - &user1
    id: 1
    name: Alice
  - &user2
    id: 2
    name: Bob
assignments:
  project1:
    - *user1
    - *user2
  project2:
    - *user2
`;
      const result = YAML.parse(yaml);
      expect(result.assignments.project1[0]).toBe(result.definitions[0]);
      expect(result.assignments.project1[1]).toBe(result.definitions[1]);
      expect(result.assignments.project2[0]).toBe(result.definitions[1]);
    });

    test("handles comments", () => {
      const yaml = `
# This is a comment
key: value # inline comment
# Another comment
another: value
`;
      expect(YAML.parse(yaml)).toEqual({
        key: "value",
        another: "value",
      });
    });

    test("handles flow style mixed with block style", () => {
      const yaml = `
array: [1, 2, 3]
object: {a: 1, b: 2}
mixed:
  - {name: Alice, age: 30}
  - {name: Bob, age: 25}
block:
  key1: value1
  key2: value2
`;
      expect(YAML.parse(yaml)).toEqual({
        array: [1, 2, 3],
        object: { a: 1, b: 2 },
        mixed: [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 25 },
        ],
        block: {
          key1: "value1",
          key2: "value2",
        },
      });
    });

    test("handles quoted strings with special characters", () => {
      const yaml = `
single: 'This is a ''quoted'' string'
double: "Line 1\\nLine 2\\tTabbed"
unicode: "\\u0041\\u0042\\u0043"
`;
      expect(YAML.parse(yaml)).toEqual({
        single: "This is a 'quoted' string",
        double: "Line 1\nLine 2\tTabbed",
        unicode: "ABC",
      });
    });

    test("handles large numbers (YAML 1.2 Core Schema)", () => {
      const yaml = `
int: 9007199254740991
float: 1.7976931348623157e+308
hex: 0xFF
octal: 0o777
binary: 0b1010
`;
      const result = YAML.parse(yaml);
      expect(result.int).toBe(9007199254740991);
      expect(result.float).toBe(1.7976931348623157e308);
      // YAML 1.2 Core Schema: hex (0x) is supported, binary (0b) is NOT
      expect(result.hex).toBe(255);
      expect(result.octal).toBe(511);
      expect(result.binary).toBe("0b1010");
    });

    test("handles explicit typing", () => {
      const yaml = `
explicit_string: !!str 123
explicit_int: !!int "456"
explicit_float: !!float "3.14"
explicit_bool: !!bool "yes"
explicit_null: !!null "anything"
`;
      expect(YAML.parse(yaml)).toEqual({
        explicit_string: "123",
        explicit_int: "456",
        explicit_float: "3.14",
        explicit_bool: "yes",
        explicit_null: "anything",
      });
    });

    test("handles strings that look like numbers", () => {
      const yaml = `
shasum1: 1e18495d9d7f6b41135e5ee828ef538dc94f9be4
shasum2: 19f3afed71c8ee421de3892615197b57bd0f2c8f
`;
      expect(YAML.parse(yaml)).toEqual({
        shasum1: "1e18495d9d7f6b41135e5ee828ef538dc94f9be4",
        shasum2: "19f3afed71c8ee421de3892615197b57bd0f2c8f",
      });
    });

    test("handles merge keys", () => {
      const yaml = `
defaults: &defaults
  adapter: postgres
  host: localhost
development:
  <<: *defaults
  database: dev_db
production:
  <<: *defaults
  database: prod_db
  host: prod.example.com
`;
      expect(YAML.parse(yaml)).toEqual({
        defaults: {
          adapter: "postgres",
          host: "localhost",
        },
        development: {
          adapter: "postgres",
          host: "localhost",
          database: "dev_db",
        },
        production: {
          adapter: "postgres",
          host: "prod.example.com",
          database: "prod_db",
        },
      });
    });

    test("issue 22659", () => {
      const input1 = `- test2: next
  test1: +`;
      expect(YAML.parse(input1)).toMatchInlineSnapshot(`
        [
          {
            "test1": "+",
            "test2": "next",
          },
        ]
      `);
      const input2 = `- test1: +
  test2: next`;
      expect(YAML.parse(input2)).toMatchInlineSnapshot(`
        [
          {
            "test1": "+",
            "test2": "next",
          },
        ]
      `);
    });

    test("issue 22392", () => {
      const input = `
foo: "some
  ...
  string"
`;
      expect(YAML.parse(input)).toMatchInlineSnapshot(`
        {
          "foo": "some ... string",
        }
      `);
    });

    test("issue 22286", async () => {
      const input1 = `
my_anchor: &MyAnchor "MyAnchor"

my_config:
  *MyAnchor :
    some_key: "some_value"
`;
      expect(YAML.parse(input1)).toMatchInlineSnapshot(`
        {
          "my_anchor": "MyAnchor",
          "my_config": {
            "MyAnchor": {
              "some_key": "some_value",
            },
          },
        }
      `);
      const input2 = await file(join(import.meta.dir, "fixtures", "AHatInTime.yaml")).text();
      expect(YAML.parse(input2)).toMatchSnapshot();
    });

    test(
      "handles YAML bombs",
      () => {
        function buildTest(depth) {
          const lines: string[] = [];
          lines.push(`a0: &a0\n  k0: 0`);
          for (let i = 1; i <= depth; i++) {
            const refs = Array.from({ length: i }, (_, j) => `*a${j}`).join(", ");
            lines.push(`a${i}: &a${i}\n  <<: [${refs}]\n  k${i}: ${i}`);
          }
          lines.push(`root:\n  <<: *a${depth}`);
          const input = lines.join("\n");

          const expected: any = {};
          for (let i = 0; i <= depth; i++) {
            const record = {};
            for (let j = 0; j <= i; j++) record[`k${j}`] = j;
            expected[`a${i}`] = record;
          }
          expected.root = { ...expected[`a${depth}`] };

          return { input, expected };
        }

        const { input, expected } = buildTest(24);

        expect(YAML.parse(input)).toEqual(expected);
      },
      isDebug || isASAN ? 2000 : 100,
    );

    describe("merge keys", () => {
      test("merge overrides", () => {
        const input = `
---
- &CENTER { x: 1, 'y': 2 }
- &LEFT { x: 0, 'y': 2 }
- &BIG { r: 10 }
- &SMALL { r: 1 }

# All the following maps are equal:

- # Explicit keys
  x: 1
  'y': 2
  r: 10
  label: center/big

- # Merge one map
  << : *CENTER
  r: 10
  label: center/big

- # Merge multiple maps
  << : [ *CENTER, *BIG ]
  label: center/big

- # Override
  << : [ *BIG, *LEFT, *SMALL ]
  x: 1
  label: center/big
  `;

        const expected = [
          { x: 1, y: 2 },
          { x: 0, y: 2 },
          { r: 10 },
          { r: 1 },
          { x: 1, y: 2, r: 10, label: "center/big" },
          { x: 1, y: 2, r: 10, label: "center/big" },
          { x: 1, y: 2, r: 10, label: "center/big" },
          { x: 1, y: 2, r: 10, label: "center/big" },
        ];

        expect(YAML.parse(input)).toEqual(expected);
      });

      test("duplicate merge key", () => {
        const input = `
---
<<: {x: 1, y: 2}
foo: bar
<<: {z: 3, t: 4}
`;

        expect(YAML.parse(input)).toEqual({
          x: 1,
          y: 2,
          z: 3,
          t: 4,
          foo: "bar",
        });
      });

      test("duplicate keys from the same anchor", () => {
        let input = `
defaults: &d
  foo: 1
  foo: 2
config:
  <<: *d`;
        expect(YAML.parse(input)).toEqual({
          defaults: {
            foo: 2,
          },
          config: {
            foo: 2,
          },
        });

        // Can still override
        input = `
defaults: &d
  foo: 1
  foo: 2
config:
  <<: *d
  foo: 3`;
        expect(YAML.parse(input)).toEqual({
          defaults: {
            foo: 2,
          },
          config: {
            foo: 3,
          },
        });
      });
    });
  });

  describe("stringify", () => {
    // Basic data type tests
    test("stringifies null", () => {
      expect(YAML.stringify(null)).toBe("null");
      expect(YAML.stringify(undefined)).toBe(undefined);
    });

    test("stringifies booleans", () => {
      expect(YAML.stringify(true)).toBe("true");
      expect(YAML.stringify(false)).toBe("false");
    });

    test("stringifies numbers", () => {
      expect(YAML.stringify(42)).toBe("42");
      expect(YAML.stringify(3.14)).toBe("3.14");
      expect(YAML.stringify(-17)).toBe("-17");
      expect(YAML.stringify(0)).toBe("0");
      expect(YAML.stringify(-0)).toBe("-0");
      expect(YAML.stringify(Infinity)).toBe(".inf");
      expect(YAML.stringify(-Infinity)).toBe("-.inf");
      expect(YAML.stringify(NaN)).toBe(".nan");
    });

    test("stringifies strings", () => {
      expect(YAML.stringify("hello")).toBe("hello");
      expect(YAML.stringify("hello world")).toBe("hello world");
      expect(YAML.stringify("")).toBe('""');
      expect(YAML.stringify("true")).toBe('"true"'); // Keywords need quoting
      expect(YAML.stringify("false")).toBe('"false"');
      expect(YAML.stringify("null")).toBe('"null"');
      expect(YAML.stringify("123")).toBe('"123"'); // Numbers need quoting
    });

    test("stringifies strings with special characters", () => {
      expect(YAML.stringify("line1\nline2")).toBe('"line1\\nline2"');
      expect(YAML.stringify('with "quotes"')).toBe('"with \\"quotes\\""');
      expect(YAML.stringify("with\ttab")).toBe('"with\\ttab"');
      expect(YAML.stringify("with\rcarriage")).toBe('"with\\rcarriage"');
      expect(YAML.stringify("with\x00null")).toBe('"with\\0null"');
    });

    test("stringifies strings that need quoting", () => {
      expect(YAML.stringify("&anchor")).toBe('"&anchor"');
      expect(YAML.stringify("*alias")).toBe('"*alias"');
      expect(YAML.stringify("#comment")).toBe('"#comment"');
      expect(YAML.stringify("---")).toBe('"---"');
      expect(YAML.stringify("...")).toBe('"..."');
      expect(YAML.stringify("{flow}")).toBe('"{flow}"');
      expect(YAML.stringify("[flow]")).toBe('"[flow]"');
      expect(YAML.stringify("key: value")).toBe('"key: value"');
      expect(YAML.stringify(" leading space")).toBe('" leading space"');
      expect(YAML.stringify("trailing space ")).toBe('"trailing space "');
    });

    test("stringifies empty arrays", () => {
      expect(YAML.stringify([])).toBe("[]");
    });

    test("space parameter with Infinity/NaN/large numbers", () => {
      expect(YAML.stringify({ a: 1 }, null, Infinity)).toEqual(YAML.stringify({ a: 1 }, null, 10));
      expect(YAML.stringify({ a: 1 }, null, -Infinity)).toEqual(YAML.stringify({ a: 1 }));
      expect(YAML.stringify({ a: 1 }, null, NaN)).toEqual(YAML.stringify({ a: 1 }));
      expect(YAML.stringify({ a: 1 }, null, 100)).toEqual(YAML.stringify({ a: 1 }, null, 10));
      expect(YAML.stringify({ a: 1 }, null, 2147483648)).toEqual(YAML.stringify({ a: 1 }, null, 10));
      expect(YAML.stringify({ a: 1 }, null, 3e9)).toEqual(YAML.stringify({ a: 1 }, null, 10));
    });

    test("space parameter with boxed Number", () => {
      expect(YAML.stringify({ a: 1 }, null, new Number(2) as any)).toEqual(YAML.stringify({ a: 1 }, null, 2));
      expect(YAML.stringify({ a: 1 }, null, new Number(0) as any)).toEqual(YAML.stringify({ a: 1 }, null, 0));
      expect(YAML.stringify({ a: 1 }, null, new Number(-1) as any)).toEqual(YAML.stringify({ a: 1 }, null, -1));
      expect(YAML.stringify({ a: 1 }, null, new Number(Infinity) as any)).toEqual(YAML.stringify({ a: 1 }, null, 10));
      expect(YAML.stringify({ a: 1 }, null, new Number(NaN) as any)).toEqual(YAML.stringify({ a: 1 }, null, 0));
    });

    test("space parameter with boxed String", () => {
      expect(YAML.stringify({ a: 1 }, null, new String("\t") as any)).toEqual(YAML.stringify({ a: 1 }, null, "\t"));
      expect(YAML.stringify({ a: 1 }, null, new String("") as any)).toEqual(YAML.stringify({ a: 1 }, null, ""));
    });

    test("all-undefined properties produces empty object", () => {
      expect(YAML.stringify({ a: undefined, b: undefined }, null, 2)).toBe("{}");
      expect(YAML.stringify({ a: () => {}, b: () => {} }, null, 2)).toBe("{}");
    });

    test("stringifies simple arrays", () => {
      expect(YAML.stringify([1, 2, 3], null, 2)).toBe("- 1\n- 2\n- 3");
      expect(YAML.stringify(["a", "b", "c"], null, 2)).toBe("- a\n- b\n- c");
      expect(YAML.stringify([true, false, null], null, 2)).toBe("- true\n- false\n- null");
    });

    test("stringifies nested arrays", () => {
      expect(
        YAML.stringify(
          [
            [1, 2],
            [3, 4],
          ],
          null,
          2,
        ),
      ).toBe("- - 1\n  - 2\n- - 3\n  - 4");
      expect(YAML.stringify([1, [2, 3], 4], null, 2)).toBe("- 1\n- - 2\n  - 3\n- 4");
    });

    test("stringifies empty objects", () => {
      expect(YAML.stringify({})).toBe("{}");
    });

    test("stringifies simple objects", () => {
      expect(YAML.stringify({ a: 1, b: 2 }, null, 2)).toBe("a: 1\nb: 2");
      expect(YAML.stringify({ name: "John", age: 30 }, null, 2)).toBe("name: John\nage: 30");
      expect(YAML.stringify({ flag: true, value: null }, null, 2)).toBe("flag: true\nvalue: null");
    });

    test("stringifies nested objects", () => {
      const obj = {
        database: {
          host: "localhost",
          port: 5432,
        },
      };
      expect(YAML.stringify(obj, null, 2)).toBe("database: \n  host: localhost\n  port: 5432");
    });

    test("stringifies mixed structures", () => {
      const obj = {
        users: [
          { name: "Alice", hobbies: ["reading", "hiking"] },
          { name: "Bob", hobbies: ["gaming"] },
        ],
      };
      const expected =
        "users: \n  - name: Alice\n    hobbies: \n      - reading\n      - hiking\n  - name: Bob\n    hobbies: \n      - gaming";
      expect(YAML.stringify(obj, null, 2)).toBe(expected);
    });

    test("stringifies objects with special keys", () => {
      expect(YAML.stringify({ "special-key": "value" }, null, 2)).toBe("special-key: value");
      expect(YAML.stringify({ "123": "numeric" }, null, 2)).toBe('"123": numeric');
      expect(YAML.stringify({ "": "empty" }, null, 2)).toBe('"": empty');
      expect(YAML.stringify({ "true": "keyword" }, null, 2)).toBe('"true": keyword');
    });

    // Error case tests
    test("throws on BigInt", () => {
      expect(() => YAML.stringify(BigInt(123))).toThrow("YAML.stringify cannot serialize BigInt");
    });

    test("throws on symbols", () => {
      expect(YAML.stringify(Symbol("test"))).toBe(undefined);
    });

    test("throws on replacer parameter", () => {
      expect(() => YAML.stringify({ a: 1 }, () => {})).toThrow("YAML.stringify does not support the replacer argument");
    });

    test("handles functions", () => {
      // Functions get stringified as empty objects
      expect(YAML.stringify(() => {})).toBe(undefined);
      expect(YAML.stringify({ fn: () => {}, value: 42 }, null, 2)).toBe("value: 42");
    });

    // Round-trip tests
    describe("round-trip compatibility", () => {
      test("round-trips null values", () => {
        expect(YAML.parse(YAML.stringify(null))).toBe(null);
      });

      test("round-trips boolean values", () => {
        expect(YAML.parse(YAML.stringify(true))).toBe(true);
        expect(YAML.parse(YAML.stringify(false))).toBe(false);
      });

      test("round-trips number values", () => {
        expect(YAML.parse(YAML.stringify(42))).toBe(42);
        expect(YAML.parse(YAML.stringify(3.14))).toBe(3.14);
        expect(YAML.parse(YAML.stringify(-17))).toBe(-17);
        expect(YAML.parse(YAML.stringify(0))).toBe(0);
        expect(YAML.parse(YAML.stringify(-0))).toBe(-0);
        expect(YAML.parse(YAML.stringify(Infinity))).toBe(Infinity);
        expect(YAML.parse(YAML.stringify(-Infinity))).toBe(-Infinity);
        expect(YAML.parse(YAML.stringify(NaN))).toBeNaN();
      });

      test("round-trips string values", () => {
        expect(YAML.parse(YAML.stringify("hello"))).toBe("hello");
        expect(YAML.parse(YAML.stringify("hello world"))).toBe("hello world");
        expect(YAML.parse(YAML.stringify(""))).toBe("");
        expect(YAML.parse(YAML.stringify("true"))).toBe("true");
        expect(YAML.parse(YAML.stringify("123"))).toBe("123");
      });

      test("round-trips strings with special characters", () => {
        expect(YAML.parse(YAML.stringify("line1\nline2"))).toBe("line1\nline2");
        expect(YAML.parse(YAML.stringify('with "quotes"'))).toBe('with "quotes"');
        expect(YAML.parse(YAML.stringify("with\ttab"))).toBe("with\ttab");
        expect(YAML.parse(YAML.stringify("with\rcarriage"))).toBe("with\rcarriage");
      });

      test("round-trips U+00A8/U+00A9 and escapes U+2028/U+2029 as \\L/\\P", () => {
        // U+00A8 (DIAERESIS) and U+00A9 (COPYRIGHT SIGN) are ordinary printable
        // characters; only U+2028/U+2029 map to the YAML \L and \P escapes.
        expect(YAML.parse(YAML.stringify("\u00a8"))).toBe("\u00a8");
        expect(YAML.parse(YAML.stringify("\u00a9"))).toBe("\u00a9");
        expect(YAML.parse(YAML.stringify("x\u00a8y"))).toBe("x\u00a8y");
        expect(YAML.parse(YAML.stringify("x\u00a9y"))).toBe("x\u00a9y");
        expect(YAML.parse(YAML.stringify({ k: "a\u00a8b\u00a9c" }))).toEqual({ k: "a\u00a8b\u00a9c" });

        expect(YAML.stringify("\u00a8")).not.toContain("\\L");
        expect(YAML.stringify("\u00a9")).not.toContain("\\P");
        expect(YAML.stringify("\u2028")).toBe('"\\L"');
        expect(YAML.stringify("\u2029")).toBe('"\\P"');
        expect(YAML.parse(YAML.stringify("\u2028"))).toBe("\u2028");
        expect(YAML.parse(YAML.stringify("\u2029"))).toBe("\u2029");
        expect(YAML.parse(YAML.stringify("a\u2028b\u2029c"))).toBe("a\u2028b\u2029c");
      });

      test("round-trips every non-surrogate BMP code point", () => {
        let all = "";
        for (let cp = 0; cp <= 0xffff; cp++) {
          if (cp >= 0xd800 && cp <= 0xdfff) continue;
          all += String.fromCharCode(cp);
        }
        const back = YAML.parse(YAML.stringify(all));
        expect(typeof back).toBe("string");
        expect(back.length).toBe(all.length);
        for (let i = 0; i < all.length; i++) {
          if (back.charCodeAt(i) !== all.charCodeAt(i)) {
            throw new Error(
              `U+${all.charCodeAt(i).toString(16).padStart(4, "0")} did not round-trip: ` +
                `got U+${back.charCodeAt(i).toString(16).padStart(4, "0")}`,
            );
          }
        }
      });

      test("round-trips arrays", () => {
        expect(YAML.parse(YAML.stringify([]))).toEqual([]);
        expect(YAML.parse(YAML.stringify([1, 2, 3]))).toEqual([1, 2, 3]);
        expect(YAML.parse(YAML.stringify(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
        expect(YAML.parse(YAML.stringify([true, false, null]))).toEqual([true, false, null]);
      });

      test("round-trips nested arrays", () => {
        expect(
          YAML.parse(
            YAML.stringify([
              [1, 2],
              [3, 4],
            ]),
          ),
        ).toEqual([
          [1, 2],
          [3, 4],
        ]);
        expect(YAML.parse(YAML.stringify([1, [2, 3], 4]))).toEqual([1, [2, 3], 4]);
      });

      test("round-trips objects", () => {
        expect(YAML.parse(YAML.stringify({}))).toEqual({});
        expect(YAML.parse(YAML.stringify({ a: 1, b: 2 }))).toEqual({ a: 1, b: 2 });
        expect(YAML.parse(YAML.stringify({ name: "John", age: 30 }))).toEqual({ name: "John", age: 30 });
      });

      test("round-trips nested objects", () => {
        const obj = {
          database: {
            host: "localhost",
            port: 5432,
            credentials: {
              username: "admin",
              password: "secret",
            },
          },
        };
        expect(YAML.parse(YAML.stringify(obj))).toEqual(obj);
      });

      test("round-trips mixed structures", () => {
        const obj = {
          users: [
            { name: "Alice", age: 30, hobbies: ["reading", "hiking"] },
            { name: "Bob", age: 25, hobbies: ["gaming", "cooking"] },
          ],
          config: {
            debug: true,
            timeout: 5000,
          },
        };
        expect(YAML.parse(YAML.stringify(obj))).toEqual(obj);
      });

      test("round-trips objects with special keys", () => {
        const obj = {
          "special-key": "value1",
          "123": "numeric-key",
          "true": "keyword-key",
          "": "empty-key",
        };
        expect(YAML.parse(YAML.stringify(obj))).toEqual(obj);
      });

      test("round-trips arrays with mixed types", () => {
        const arr = ["string", 42, true, null, { nested: "object" }, [1, 2, 3]];
        expect(YAML.parse(YAML.stringify(arr))).toEqual(arr);
      });

      test("round-trips complex real-world structures", () => {
        const config = {
          version: "1.0",
          services: {
            web: {
              image: "nginx:latest",
              ports: ["80:80", "443:443"],
              environment: {
                NODE_ENV: "production",
                DEBUG: false,
              },
            },
            db: {
              image: "postgres:13",
              environment: {
                POSTGRES_PASSWORD: "secret",
                POSTGRES_DB: "myapp",
              },
              volumes: ["./data:/var/lib/postgresql/data"],
            },
          },
          networks: {
            default: {
              driver: "bridge",
            },
          },
        };
        expect(YAML.parse(YAML.stringify(config))).toEqual(config);
      });
    });

    const indicatorQuotingTests = [
      "-",
      "?",
      ":",
      ",",
      "[",
      "]",
      "{",
      "}",
      "#",
      "&",
      "*",
      "!",
      "|",
      ">",
      "'",
      '"',
      "%",
      "@",
      "`",
      " ",
      "\t",
      "\n",
      "\r",
    ];

    for (const indicatorOrWhitespace of indicatorQuotingTests) {
      test(`round-trip string starting with '${indicatorOrWhitespace}'`, () => {
        const array = [{ key: indicatorOrWhitespace }];
        expect(YAML.parse(YAML.stringify(array))).toEqual(array);
        expect(YAML.parse(YAML.stringify(array, null, 2))).toEqual(array);
      });
    }

    test("strings are properly referenced", () => {
      const config = {
        version: "1.0",
        services: {
          web: {
            image: "nginx:latest",
            ports: ["80:80", "443:443"],
            environment: {
              NODE_ENV: "production",
              DEBUG: false,
            },
          },
          db: {
            image: "postgres:13",
            environment: {
              POSTGRES_PASSWORD: "secret",
              POSTGRES_DB: "myapp",
            },
            volumes: ["./data:/var/lib/postgresql/data"],
          },
        },
        networks: {
          default: {
            driver: "bridge",
          },
        },
      };

      // Debug/ASAN builds are much slower; keep this stress test within the default test timeout.
      const iterations = isDebug || isASAN ? 1000 : 10000;
      for (let i = 0; i < iterations; i++) {
        expect(YAML.stringify(config)).toBeString();
      }
    });

    // Anchor and alias tests (reference handling)
    describe("reference handling", () => {
      test("handles object references with anchors and aliases", () => {
        const shared = { shared: "value" };
        const obj = {
          first: shared,
          second: shared,
        };
        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        // Should preserve object identity
        expect(parsed.first).toBe(parsed.second);
        expect(parsed.first.shared).toBe("value");
      });

      test("handles array references with anchors and aliases", () => {
        const sharedArray = [1, 2, 3];
        const obj = {
          arrays: [sharedArray, sharedArray],
        };
        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        // Should preserve array identity
        expect(parsed.arrays[0]).toBe(parsed.arrays[1]);
        expect(parsed.arrays[0]).toEqual([1, 2, 3]);
      });

      test("handles deeply nested references", () => {
        const sharedConfig = { host: "localhost", port: 5432 };
        const obj = {
          development: {
            database: sharedConfig,
          },
          test: {
            database: sharedConfig,
          },
          shared: sharedConfig,
        };
        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        expect(parsed.development.database).toBe(parsed.test.database);
        expect(parsed.development.database).toBe(parsed.shared);
        expect(parsed.shared.host).toBe("localhost");
      });

      test.todo("handles self-referencing objects", () => {
        // Skipping as this causes build issues with circular references
        const obj = { name: "root" };
        obj.self = obj;

        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        expect(parsed.self).toBe(parsed);
        expect(parsed.name).toBe("root");
      });

      test("generates unique anchor names for different objects", () => {
        const obj1 = { type: "first" };
        const obj2 = { type: "second" };
        const container = {
          a: obj1,
          b: obj1,
          c: obj2,
          d: obj2,
        };

        const yaml = YAML.stringify(container);
        const parsed = YAML.parse(yaml);

        expect(parsed.a).toBe(parsed.b);
        expect(parsed.c).toBe(parsed.d);
        expect(parsed.a).not.toBe(parsed.c);
        expect(parsed.a.type).toBe("first");
        expect(parsed.c.type).toBe("second");
      });

      test("anchors named after keys with special characters re-parse", () => {
        const specialKeys = [
          "\\u{10FFFF}a", // literal backslash-u-braces text, not a codepoint
          "{",
          "}",
          "[",
          "]",
          ",",
          "{a}",
          "key[0]",
          "a,b",
          "a\\b",
          "a b",
          "a\tb",
          "a\nb",
          " ",
          "key:with#chars",
          "🙂emoji",
        ];

        for (const key of specialKeys) {
          const shared = [1, 2];
          const obj = { [key]: shared, other: shared };

          for (const space of [undefined, 2]) {
            const yaml = YAML.stringify(obj, null, space);
            const parsed = YAML.parse(yaml);
            expect(parsed).toEqual({ [key]: [1, 2], other: [1, 2] });
            expect(parsed[key]).toBe(parsed.other);
          }
        }
      });

      test("falls back to generated anchor names for unsafe keys", () => {
        const shared = [1, 2];
        expect(YAML.stringify({ "a[b]": shared, other: shared })).toBe('{"a[b]": &value0 [1,2],other: *value0}');
      });

      test("generated anchor names cannot collide with keys named like them", () => {
        const cases: Array<{ obj: Record<string, unknown>; expected: Record<string, unknown> }> = [];

        {
          // literal "value0" key vs generated name for an unsafe key
          const a = [1];
          const b = [2];
          cases.push({
            obj: { value0: a, "[k]": b, x: a, y: b },
            expected: { value0: [1], "[k]": [2], x: [1], y: [2] },
          });
        }
        {
          // literal "value0" key vs generated name for an empty key
          const a = [1];
          const b = [2];
          cases.push({
            obj: { "": a, value0: b, x: a, y: b },
            expected: { "": [1], value0: [2], x: [1], y: [2] },
          });
        }
        {
          // literal "item0" key vs array item anchor names
          const a = [1];
          const b = [2];
          cases.push({
            obj: { item0: a, list: [b, b], x: a },
            expected: { item0: [1], list: [[2], [2]], x: [1] },
          });
        }

        for (const { obj, expected } of cases) {
          for (const space of [undefined, 2]) {
            const parsed = YAML.parse(YAML.stringify(obj, null, space));
            expect(parsed).toEqual(expected);
          }
        }
      });

      test("round-trips parsed documents whose aliased keys contain flow indicators", () => {
        const doc = "\\u{10FFFF}a: &x [1, 2]\nb: *x";
        const value = YAML.parse(doc);
        expect(value).toEqual({ "\\u{10FFFF}a": [1, 2], b: [1, 2] });

        const yaml = YAML.stringify(value);
        const reparsed = YAML.parse(yaml);
        expect(reparsed).toEqual(value);
        expect(reparsed["\\u{10FFFF}a"]).toBe(reparsed.b);
      });
    });

    // Edge cases and error handling
    describe("edge cases", () => {
      test("handles very deep nesting", () => {
        let deep = {};
        let current = deep;
        for (let i = 0; i < 100; i++) {
          current.next = { level: i };
          current = current.next;
        }

        const yaml = YAML.stringify(deep);
        const parsed = YAML.parse(yaml);

        expect(parsed.next.next.next.level).toBe(2);
      });

      // Test strings that need quoting due to YAML keywords
      test("quotes YAML boolean keywords", () => {
        // All variations of true/false keywords
        expect(YAML.stringify("True")).toBe('"True"');
        expect(YAML.stringify("TRUE")).toBe('"TRUE"');
        expect(YAML.stringify("False")).toBe('"False"');
        expect(YAML.stringify("FALSE")).toBe('"FALSE"');
        expect(YAML.stringify("yes")).toBe('"yes"');
        expect(YAML.stringify("Yes")).toBe('"Yes"');
        expect(YAML.stringify("YES")).toBe('"YES"');
        expect(YAML.stringify("no")).toBe('"no"');
        expect(YAML.stringify("No")).toBe('"No"');
        expect(YAML.stringify("NO")).toBe('"NO"');
        expect(YAML.stringify("on")).toBe('"on"');
        expect(YAML.stringify("On")).toBe('"On"');
        expect(YAML.stringify("ON")).toBe('"ON"');
        expect(YAML.stringify("off")).toBe('"off"');
        expect(YAML.stringify("Off")).toBe('"Off"');
        expect(YAML.stringify("OFF")).toBe('"OFF"');
        // Single letter booleans
        expect(YAML.stringify("n")).toBe('"n"');
        expect(YAML.stringify("N")).toBe('"N"');
        expect(YAML.stringify("y")).toBe('"y"');
        expect(YAML.stringify("Y")).toBe('"Y"');
      });

      test("quotes YAML null keywords", () => {
        expect(YAML.stringify("Null")).toBe('"Null"');
        expect(YAML.stringify("NULL")).toBe('"NULL"');
        expect(YAML.stringify("~")).toBe('"~"');
      });

      test("quotes YAML infinity and NaN keywords", () => {
        expect(YAML.stringify(".inf")).toBe('".inf"');
        expect(YAML.stringify(".Inf")).toBe('".Inf"');
        expect(YAML.stringify(".INF")).toBe('".INF"');
        expect(YAML.stringify(".nan")).toBe('".nan"');
        expect(YAML.stringify(".NaN")).toBe('".NaN"');
        expect(YAML.stringify(".NAN")).toBe('".NAN"');
      });

      test("quotes strings starting with special indicators", () => {
        expect(YAML.stringify("?question")).toBe('"?question"');
        expect(YAML.stringify("|literal")).toBe('"|literal"');
        expect(YAML.stringify("-dash")).toBe('"-dash"');
        expect(YAML.stringify("<less")).toBe('"<less"');
        expect(YAML.stringify(">greater")).toBe('">greater"');
        expect(YAML.stringify("!exclaim")).toBe('"!exclaim"');
        expect(YAML.stringify("%percent")).toBe('"%percent"');
        expect(YAML.stringify("@at")).toBe('"@at"');
      });

      test("quotes strings that look like numbers", () => {
        // Decimal numbers
        expect(YAML.stringify("42")).toBe('"42"');
        expect(YAML.stringify("3.14")).toBe('"3.14"');
        expect(YAML.stringify("-17")).toBe('"-17"');
        expect(YAML.stringify("+99")).toBe('"+99"'); // +-prefixed numbers parse back as numbers, must quote
        expect(YAML.stringify(".5")).toBe('".5"');
        expect(YAML.stringify("-.5")).toBe('"-.5"');

        // Scientific notation
        expect(YAML.stringify("1e10")).toBe('"1e10"');
        expect(YAML.stringify("1E10")).toBe('"1E10"');
        expect(YAML.stringify("1.5e-10")).toBe('"1.5e-10"');
        expect(YAML.stringify("3.14e+5")).toBe('"3.14e+5"');

        // Hex numbers
        expect(YAML.stringify("0x1F")).toBe('"0x1F"');
        expect(YAML.stringify("0xDEADBEEF")).toBe('"0xDEADBEEF"');
        expect(YAML.stringify("0XFF")).toBe('"0XFF"');

        // Octal numbers
        expect(YAML.stringify("0o777")).toBe('"0o777"');
        expect(YAML.stringify("0O644")).toBe('"0O644"');

        // Zero prefix
        expect(YAML.stringify({ a: "011", b: "110" })).toBe('{a: "011",b: "110"}');
        expect(YAML.stringify(YAML.parse('"0123"'))).toBe('"0123"');
        expect(YAML.stringify("0000123")).toBe('"0000123"');
      });

      test("quotes strings with colons followed by spaces", () => {
        expect(YAML.stringify("key: value")).toBe('"key: value"');
        expect(YAML.stringify("key:value")).toBe("key:value"); // no quote when no space
        expect(YAML.stringify("http://example.com")).toBe("http://example.com"); // URLs shouldn't need quotes

        // These need quotes due to colon+space pattern
        expect(YAML.stringify("desc: this is")).toBe('"desc: this is"');
        expect(YAML.stringify("label:\ttab")).toBe('"label:\\ttab"');
        expect(YAML.stringify("text:\n")).toBe('"text:\\n"');
        expect(YAML.stringify("item:\r")).toBe('"item:\\r"');
      });

      // https://github.com/oven-sh/bun/issues/25439
      test("quotes strings ending with colons", () => {
        // Trailing colons can be misinterpreted as mapping indicators
        expect(YAML.stringify("tin:")).toBe('"tin:"');
        expect(YAML.stringify("hello:")).toBe('"hello:"');
        expect(YAML.stringify("a:")).toBe('"a:"');
        expect(YAML.stringify("http://example.com:")).toBe('"http://example.com:"');
        expect(YAML.stringify("key:value:")).toBe('"key:value:"');
        expect(YAML.stringify(":::")).toBe('":::"');

        // Round-trip should work
        const testCases = ["tin:", "hello:", "a:", "http://example.com:", "key:value:", ":::"];
        for (const str of testCases) {
          const doc = { value: str };
          expect(YAML.parse(YAML.stringify(doc))).toEqual(doc);
        }

        // Exact reproduction case from issue #25439
        const doc = { txt: { en: "tin:" } };
        const yml = YAML.stringify(doc, null, 2);
        expect(yml).toContain('"tin:"');
        expect(YAML.parse(yml)).toEqual(doc);
      });

      test("quotes strings containing flow indicators", () => {
        expect(YAML.stringify("{json}")).toBe('"{json}"');
        expect(YAML.stringify("[array]")).toBe('"[array]"');
        expect(YAML.stringify("a,b,c")).toBe('"a,b,c"');
        expect(YAML.stringify("mixed{flow")).toBe('"mixed{flow"');
        expect(YAML.stringify("mixed}flow")).toBe('"mixed}flow"');
        expect(YAML.stringify("mixed[flow")).toBe('"mixed[flow"');
        expect(YAML.stringify("mixed]flow")).toBe('"mixed]flow"');
      });

      test("quotes strings with special single characters", () => {
        expect(YAML.stringify("#")).toBe('"#"');
        expect(YAML.stringify("`")).toBe('"`"');
        expect(YAML.stringify("'")).toBe('"\'"');
      });

      test("handles control characters and special escapes", () => {
        // Basic control characters
        expect(YAML.stringify("\x00")).toBe('"\\0"'); // null
        expect(YAML.stringify("\x07")).toBe('"\\a"'); // bell
        expect(YAML.stringify("\x08")).toBe('"\\b"'); // backspace
        expect(YAML.stringify("\x09")).toBe('"\\t"'); // tab
        expect(YAML.stringify("\x0a")).toBe('"\\n"'); // line feed
        expect(YAML.stringify("\x0b")).toBe('"\\v"'); // vertical tab
        expect(YAML.stringify("\x0c")).toBe('"\\f"'); // form feed
        expect(YAML.stringify("\x0d")).toBe('"\\r"'); // carriage return
        expect(YAML.stringify("\x1b")).toBe('"\\e"'); // escape
        expect(YAML.stringify("\x22")).toBe('"\\\""'); // double quote
        expect(YAML.stringify("\x5c")).toBe("\\"); // backslash - not quoted

        // Other control characters (hex notation)
        expect(YAML.stringify("\x01")).toBe('"\\x01"');
        expect(YAML.stringify("\x02")).toBe('"\\x02"');
        expect(YAML.stringify("\x03")).toBe('"\\x03"');
        expect(YAML.stringify("\x04")).toBe('"\\x04"');
        expect(YAML.stringify("\x05")).toBe('"\\x05"');
        expect(YAML.stringify("\x06")).toBe('"\\x06"');
        expect(YAML.stringify("\x0e")).toBe('"\\x0e"');
        expect(YAML.stringify("\x0f")).toBe('"\\x0f"');
        expect(YAML.stringify("\x10")).toBe('"\\x10"');
        expect(YAML.stringify("\x7f")).toBe('"\\x7f"'); // delete

        // Unicode control characters
        expect(YAML.stringify("\x85")).toBe('"\\N"'); // next line
        expect(YAML.stringify("\xa0")).toBe('"\\_"'); // non-breaking space

        // Combined in strings
        expect(YAML.stringify("hello\x00world")).toBe('"hello\\0world"');
        expect(YAML.stringify("line1\x0bline2")).toBe('"line1\\vline2"');
        expect(YAML.stringify("alert\x07sound")).toBe('"alert\\asound"');
      });

      test("handles special number formats", () => {
        // Positive zero
        expect(YAML.stringify(+0)).toBe("0"); // +0 becomes just 0

        // Round-trip special numbers
        expect(YAML.parse(YAML.stringify(+0))).toBe(0);
        expect(Object.is(YAML.parse(YAML.stringify(-0)), -0)).toBe(true);
      });

      test("quotes strings that would be ambiguous YAML", () => {
        // Strings that look like YAML document markers
        expect(YAML.stringify("---")).toBe('"---"');
        expect(YAML.stringify("...")).toBe('"..."');

        // But these don't need quotes (not exactly three)
        expect(YAML.stringify("--")).toBe('"--"'); // -- gets quoted
        expect(YAML.stringify("----")).toBe('"----"');
        expect(YAML.stringify("..")).toBe("..");
        // "...." contains "..." at the end which is structurally ambiguous, so it gets quoted.
        expect(YAML.stringify("....")).toBe('"...."');
      });

      test("handles mixed content strings", () => {
        // Strings with numbers and text (shouldn't be quoted unless they parse as numbers)
        expect(YAML.stringify("abc123")).toBe("abc123");
        expect(YAML.stringify("123abc")).toBe("123abc");
        expect(YAML.stringify("1.2.3")).toBe("1.2.3");
        expect(YAML.stringify("v1.0.0")).toBe("v1.0.0");

        // SHA-like strings that could be mistaken for scientific notation
        expect(YAML.stringify("1e10abc")).toBe("1e10abc");
        expect(YAML.stringify("deadbeef")).toBe("deadbeef");
        expect(YAML.stringify("0xNotHex")).toBe("0xNotHex");
      });

      // https://github.com/oven-sh/bun/issues/30433
      test("quotes number-like strings so they round-trip as strings", () => {
        // Leading '0' followed by 'e'/'E' parses as float exponent (0e6836 == 0).
        expect(YAML.stringify("0e6836")).toBe('"0e6836"');
        expect(YAML.stringify("0E6836")).toBe('"0E6836"');
        expect(YAML.stringify("0e0")).toBe('"0e0"');

        // Leading '0' followed by '.' parses as decimal float.
        expect(YAML.stringify("0.0")).toBe('"0.0"');
        expect(YAML.stringify("0.5")).toBe('"0.5"');

        // Leading '+' followed by digits/dot parses as a positive number.
        expect(YAML.stringify("+0")).toBe('"+0"');
        expect(YAML.stringify("+1")).toBe('"+1"');
        expect(YAML.stringify("+99")).toBe('"+99"');
        expect(YAML.stringify("+1.5")).toBe('"+1.5"');
        expect(YAML.stringify("+1e5")).toBe('"+1e5"');

        // Signed exponent after the mantissa — "+1e+5" and "-1e-5" both parse back as
        // numbers, so the scanner must accept a sign immediately after e/E.
        expect(YAML.stringify("+1e+5")).toBe('"+1e+5"');
        expect(YAML.stringify("-1e-5")).toBe('"-1e-5"');
        expect(YAML.stringify("1e+5")).toBe('"1e+5"');
        expect(YAML.stringify("1e-5")).toBe('"1e-5"');
        expect(YAML.stringify("3.14e+5")).toBe('"3.14e+5"');
        expect(YAML.stringify("1.5e-10")).toBe('"1.5e-10"');

        // Signed infinity — the YAML parser accepts "+.inf"/"+.Inf"/"+.INF" (and the
        // '-' variants) as signed infinity, so strings that look like those must be
        // quoted. "+.nan" / "-.nan" are *not* treated as numbers by the parser so
        // they don't need quoting for numeric reasons.
        expect(YAML.stringify("+.inf")).toBe('"+.inf"');
        expect(YAML.stringify("+.Inf")).toBe('"+.Inf"');
        expect(YAML.stringify("+.INF")).toBe('"+.INF"');

        // Round-trip: every number-like string must come back as the original string.
        const numberLike = [
          "0e6836",
          "0E6836",
          "0e0",
          "0.0",
          "0.5",
          "+0",
          "+1",
          "+99",
          "+1.5",
          "+1e5",
          "-1",
          "-0",
          "1e5",
          "1.0",
          "123",
          "0123",
          ".5",
          // signed exponents
          "+1e+5",
          "-1e-5",
          "+1e-5",
          "-1e+5",
          "1e+5",
          "1e-5",
          "3.14e+5",
          "1.5e-10",
          // signed special floats
          "+.inf",
          "+.Inf",
          "+.INF",
          "-.inf",
          "-.Inf",
          "-.INF",
          // Embedded signs — wtf.parseDouble is a strtod-style prefix parser, so
          // "1+5" etc. round-trip to the leading digits as a number unless quoted.
          "1+5",
          "1-5",
          "0+5",
          "0-5",
          "123-456",
          "3.14+2",
          ".5+3",
        ];
        for (const value of numberLike) {
          expect(YAML.parse(YAML.stringify({ id: value }))).toEqual({ id: value });
        }

        // Exact reproduction from issue #30433.
        const obj = {
          subject: "Q2 planning followup:",
          note: "foo:",
          safe: "bar: baz",
          id: "0e6836",
        };
        expect(YAML.parse(YAML.stringify(obj, null, 2))).toEqual(obj);
      });

      test("quotes strings whose leading number-like prefix precedes a flow indicator", () => {
        // These previously slipped through unquoted because the number scanner advanced past
        // the flow indicator.
        const roundTrippers = ["9{", "9,", "9}", "9]", ".{", "0{", "+{", ".,"];
        for (const value of roundTrippers) {
          // Direct scalar emission must be quoted — otherwise the round-trip only passes
          // by accident when the parser later rejects the bare form.
          expect(YAML.stringify(value)).toMatch(/^".*"$/);
          expect(YAML.parse(YAML.stringify({ id: value }))).toEqual({ id: value });
        }
      });

      test("handles whitespace edge cases", () => {
        // Leading/trailing whitespace
        expect(YAML.stringify(" leading")).toBe('" leading"');
        expect(YAML.stringify("trailing ")).toBe('"trailing "');
        expect(YAML.stringify("\tleading")).toBe('"\\tleading"');
        expect(YAML.stringify("trailing\t")).toBe('"trailing\\t"');
        expect(YAML.stringify("\nleading")).toBe('"\\nleading"');
        expect(YAML.stringify("trailing\n")).toBe('"trailing\\n"');
        expect(YAML.stringify("\rleading")).toBe('"\\rleading"');
        expect(YAML.stringify("trailing\r")).toBe('"trailing\\r"');

        // Mixed internal content is okay
        expect(YAML.stringify("no  problem")).toBe("no  problem");
        expect(YAML.stringify("internal\ttabs\tok")).toBe('"internal\\ttabs\\tok"');
      });

      test("handles boxed primitives", () => {
        // Boxed primitives should be unwrapped
        const boxedNumber = new Number(42);
        const boxedString = new String("hello");
        const boxedBoolean = new Boolean(true);

        expect(YAML.stringify(boxedNumber)).toBe("42");
        expect(YAML.stringify(boxedString)).toBe("hello");
        expect(YAML.stringify(boxedBoolean)).toBe("true");

        // In objects
        const obj = {
          num: new Number(3.14),
          str: new String("world"),
          bool: new Boolean(false),
        };
        expect(YAML.stringify(obj, null, 2)).toBe("num: \n  3.14\nstr: world\nbool: \n  false");
      });

      test("handles Date objects", () => {
        // Date objects get converted to ISO string via toString()
        const date = new Date("2024-01-15T10:30:00Z");
        const result = YAML.stringify(date);
        // Dates become empty objects currently
        expect(result).toBe("{}");

        // In objects
        const obj = { created: date };
        expect(YAML.stringify(obj, null, 2)).toBe("created: \n  {}");
      });

      test("handles RegExp objects", () => {
        // RegExp objects become empty objects
        const regex = /test/gi;
        expect(YAML.stringify(regex)).toBe("{}");

        const obj = { pattern: regex };
        expect(YAML.stringify(obj, null, 2)).toBe("pattern: \n  {}");
      });

      test("handles Error objects", () => {
        // Error objects have enumerable properties
        const error = new Error("Test error");
        const result = YAML.stringify(error);
        expect(result).toBe("{}"); // Errors have no enumerable properties

        // Custom error with properties
        const customError = new Error("Custom");
        customError.code = "ERR_TEST";
        customError.details = { line: 42 };
        const customResult = YAML.stringify(customError);
        expect(customResult).toContain("code: ERR_TEST");
        expect(customResult).toContain("details:");
        expect(customResult).toContain("line: 42");
      });

      test("handles Maps and Sets", () => {
        // Maps become empty objects
        const map = new Map([
          ["key1", "value1"],
          ["key2", "value2"],
        ]);
        expect(YAML.stringify(map)).toBe("{}");

        // Sets become empty objects
        const set = new Set([1, 2, 3]);
        expect(YAML.stringify(set)).toBe("{}");
      });

      test("handles property descriptors", () => {
        // Non-enumerable properties should be skipped
        const obj = {};
        Object.defineProperty(obj, "hidden", {
          value: "secret",
          enumerable: false,
        });
        Object.defineProperty(obj, "visible", {
          value: "public",
          enumerable: true,
        });

        expect(YAML.stringify(obj, null, 2)).toBe("visible: public");
      });

      test("handles getters", () => {
        // Getters should be evaluated
        const obj = {
          get computed() {
            return "computed value";
          },
          normal: "normal value",
        };

        const result = YAML.stringify(obj);
        expect(result).toContain("computed: computed value");
        expect(result).toContain("normal: normal value");
      });

      test("handles object with numeric string keys", () => {
        // Keys that look like numbers but are strings
        const obj = {
          "0": "zero",
          "1": "one",
          "42": "answer",
          "3.14": "pi",
          "-1": "negative",
          "1e10": "scientific",
        };

        const result = YAML.stringify(obj);
        expect(result).toContain('"0": zero');
        expect(result).toContain('"1": one');
        expect(result).toContain('"42": answer');
        expect(result).toContain('"3.14": pi');
        expect(result).toContain('"-1": negative');
        expect(result).toContain('"1e10": scientific');
      });

      test("handles complex anchor scenarios", () => {
        // Multiple references to same empty object/array
        const emptyObj = {};
        const emptyArr = [];
        const container = {
          obj1: emptyObj,
          obj2: emptyObj,
          arr1: emptyArr,
          arr2: emptyArr,
        };

        const yaml = YAML.stringify(container);
        const parsed = YAML.parse(yaml);
        expect(parsed.obj1).toBe(parsed.obj2);
        expect(parsed.arr1).toBe(parsed.arr2);
      });

      test("handles property names that need escaping", () => {
        const obj = {
          "": "empty key",
          " ": "space key",
          "\t": "tab key",
          "\n": "newline key",
          "null": "null key",
          "true": "true key",
          "123": "numeric key",
          "#comment": "hash key",
          "key:value": "colon key",
          "key: value": "colon space key",
          "[array]": "bracket key",
          "{object}": "brace key",
        };

        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        expect(parsed[""]).toBe("empty key");
        expect(parsed[" "]).toBe("space key");
        expect(parsed["\t"]).toBe("tab key");
        expect(parsed["\n"]).toBe("newline key");
        expect(parsed["null"]).toBe("null key");
        expect(parsed["true"]).toBe("true key");
        expect(parsed["123"]).toBe("numeric key");
        expect(parsed["#comment"]).toBe("hash key");
        expect(parsed["key:value"]).toBe("colon key");
        expect(parsed["key: value"]).toBe("colon space key");
        expect(parsed["[array]"]).toBe("bracket key");
        expect(parsed["{object}"]).toBe("brace key");
      });

      test("handles arrays with objects containing undefined/symbol", () => {
        const arr = [{ a: 1, b: undefined, c: 2 }, { x: Symbol("test"), y: 3 }, { valid: "data" }];

        const yaml = YAML.stringify(arr);
        const parsed = YAML.parse(yaml);

        expect(parsed).toEqual([{ a: 1, c: 2 }, { y: 3 }, { valid: "data" }]);
      });

      test("handles stack overflow protection", () => {
        // Create deeply nested structure approaching stack limit
        let deep = {};
        let current = deep;
        for (let i = 0; i < 1000000; i++) {
          current.next = {};
          current = current.next;
        }

        // Should throw stack overflow for deeply nested structures
        expect(() => YAML.stringify(deep)).toThrow("Maximum call stack size exceeded");
      });

      test("handles arrays as root with references", () => {
        const shared = { shared: true };
        const arr = [shared, "middle", shared];

        const yaml = YAML.stringify(arr);
        const parsed = YAML.parse(yaml);

        expect(parsed[0]).toBe(parsed[2]);
        expect(parsed[0].shared).toBe(true);
        expect(parsed[1]).toBe("middle");
      });

      test("handles mixed references in nested structures", () => {
        const sharedData = { type: "shared" };
        const sharedArray = [1, 2, 3];

        const complex = {
          level1: {
            data: sharedData,
            items: sharedArray,
          },
          level2: {
            reference: sharedData,
            moreItems: sharedArray,
            nested: {
              deepRef: sharedData,
            },
          },
        };

        const yaml = YAML.stringify(complex);
        const parsed = YAML.parse(yaml);

        expect(parsed.level1.data).toBe(parsed.level2.reference);
        expect(parsed.level1.data).toBe(parsed.level2.nested.deepRef);
        expect(parsed.level1.items).toBe(parsed.level2.moreItems);
      });

      test("handles anchor name conflicts with property names", () => {
        // Test 1: Object used as property value with same name conflicts
        const sharedObj = { value: "shared" };
        const obj1 = {
          data: sharedObj,
          nested: {
            data: sharedObj, // Same property name "data"
          },
        };

        const yaml1 = YAML.stringify(obj1, null, 2);
        expect(yaml1).toMatchInlineSnapshot(`
"data: 
  &data
  value: shared
nested: 
  data: 
    *data"
`);

        // Test 2: Multiple objects with same property names needing counters
        const obj2Shared = { type: "A" };
        const obj3Shared = { type: "B" };
        const obj4Shared = { type: "C" };

        const obj2 = {
          item: obj2Shared,
          nested1: {
            item: obj2Shared, // second use, will be alias
            other: {
              item: obj3Shared, // different object, needs &item1
            },
          },
          nested2: {
            item: obj3Shared, // alias to &item1
            sub: {
              item: obj4Shared, // another different object, needs &item2
            },
          },
          refs: {
            item: obj4Shared, // alias to &item2
          },
        };

        const yaml2 = YAML.stringify(obj2, null, 2);
        expect(yaml2).toMatchInlineSnapshot(`
"item: 
  &item
  type: A
nested1: 
  item: 
    *item
  other: 
    item: 
      &item1
      type: B
nested2: 
  item: 
    *item1
  sub: 
    item: 
      &item2
      type: C
refs: 
  item: 
    *item2"
`);

        const parsed2 = YAML.parse(yaml2);
        expect(parsed2.item).toBe(parsed2.nested1.item);
        expect(parsed2.nested1.other.item).toBe(parsed2.nested2.item);
        expect(parsed2.nested2.sub.item).toBe(parsed2.refs.item);
        expect(parsed2.item.type).toBe("A");
        expect(parsed2.nested1.other.item.type).toBe("B");
        expect(parsed2.nested2.sub.item.type).toBe("C");
      });

      test("handles array item anchor counter increments", () => {
        // Test 1: Multiple array items that are objects need incrementing counters
        const sharedA = { id: "A" };
        const sharedB = { id: "B" };
        const sharedC = { id: "C" };

        const arr1 = [
          sharedA, // Gets &item0
          sharedA, // Gets *item0
          sharedB, // Gets &item1
          sharedC, // Gets &item2
          sharedB, // Gets *item1
          sharedC, // Gets *item2
        ];

        const yaml1 = YAML.stringify(arr1, null, 2);
        expect(yaml1).toMatchInlineSnapshot(`
"- &item0
  id: A
- *item0
- &item1
  id: B
- &item2
  id: C
- *item1
- *item2"
`);

        const parsed1 = YAML.parse(yaml1);
        expect(parsed1[0]).toBe(parsed1[1]);
        expect(parsed1[2]).toBe(parsed1[4]);
        expect(parsed1[3]).toBe(parsed1[5]);
        expect(parsed1[0].id).toBe("A");
        expect(parsed1[2].id).toBe("B");
        expect(parsed1[3].id).toBe("C");

        // Test 2: Arrays in nested structures
        const shared1 = [1, 2];
        const shared2 = [3, 4];
        const shared3 = [5, 6];

        const complex = {
          arrays: [
            shared1, // &item0
            shared2, // &item1
            shared1, // *item0
          ],
          nested: {
            moreArrays: [
              shared3, // &item2
              shared2, // *item1
              shared3, // *item2
            ],
          },
        };

        const yaml2 = YAML.stringify(complex, null, 2);
        expect(yaml2).toMatchInlineSnapshot(`
"arrays: 
  - &item0
    - 1
    - 2
  - &item1
    - 3
    - 4
  - *item0
nested: 
  moreArrays: 
    - &item2
      - 5
      - 6
    - *item1
    - *item2"
`);

        const parsed2 = YAML.parse(yaml2);
        expect(parsed2.arrays[0]).toBe(parsed2.arrays[2]);
        expect(parsed2.arrays[1]).toBe(parsed2.nested.moreArrays[1]);
        expect(parsed2.nested.moreArrays[0]).toBe(parsed2.nested.moreArrays[2]);
      });

      test("handles mixed property and array anchors with name conflicts", () => {
        // Test case where property name "item" conflicts with array item anchors
        const objShared = { type: "object" };
        const arrShared = ["array"];
        const nestedShared = { nested: "obj" };

        const mixed = {
          item: objShared, // Gets &item (property anchor)
          items: [
            arrShared, // Gets &item0 (array item anchor)
            nestedShared, // Gets &item1
            arrShared, // Gets *item0
            nestedShared, // Gets *item1
          ],
          refs: {
            item: objShared, // Gets *item (property alias)
          },
        };

        const yaml = YAML.stringify(mixed, null, 2);
        expect(yaml).toMatchInlineSnapshot(`
"item: 
  &item
  type: object
items: 
  - &item0
    - array
  - &item1
    nested: obj
  - *item0
  - *item1
refs: 
  item: 
    *item"
`);

        const parsed = YAML.parse(yaml);
        expect(parsed.item).toBe(parsed.refs.item);
        expect(parsed.items[0]).toBe(parsed.items[2]);
        expect(parsed.items[1]).toBe(parsed.items[3]);
        expect(parsed.item.type).toBe("object");
        expect(parsed.items[0][0]).toBe("array");
        expect(parsed.items[1].nested).toBe("obj");
      });

      test("handles empty string property names in anchors", () => {
        // Empty property names should get a counter appended
        const shared = { empty: "key" };
        const more = {};
        const obj = {
          "": shared, // Empty key - should get counter
          nested: {
            "": shared, // Same empty key - should be alias
          },
          another: {
            "": more,
            what: more,
          },
        };

        const yaml = YAML.stringify(obj, null, 2);
        expect(yaml).toMatchInlineSnapshot(`
          """: 
            &value0
            empty: key
          nested: 
            "": 
              *value0
          another: 
            "": 
              &value1
              {}
            what: 
              *value1"
        `);
        // Since empty names can't be used as anchors, they get a counter

        const parsed = YAML.parse(yaml);
        expect(parsed[""]).toBe(parsed.nested[""]);
        expect(parsed[""].empty).toBe("key");
      });

      test("handles complex counter scenarios with many conflicts", () => {
        // Create many objects that will cause property name conflicts
        const objects = Array.from({ length: 5 }, (_, i) => ({ id: i }));

        const complex = {
          data: objects[0],
          level1: {
            data: objects[0], // alias
            sub1: {
              data: objects[1], // &data1
            },
            sub2: {
              data: objects[1], // alias to data1
            },
          },
          level2: {
            data: objects[2], // &data2
            nested: {
              data: objects[3], // &data3
              deep: {
                data: objects[4], // &data4
              },
            },
          },
          refs: {
            data: objects[2], // alias to data2
            all: [
              { data: objects[3] }, // alias to data3
              { data: objects[4] }, // alias to data4
            ],
          },
        };

        const yaml = YAML.stringify(complex, null, 2);
        expect(yaml).toMatchInlineSnapshot(`
"data: 
  &data
  id: 0
level1: 
  data: 
    *data
  sub1: 
    data: 
      &data1
      id: 1
  sub2: 
    data: 
      *data1
level2: 
  data: 
    &data2
    id: 2
  nested: 
    data: 
      &data3
      id: 3
    deep: 
      data: 
        &data4
        id: 4
refs: 
  data: 
    *data2
  all: 
    - data: 
        *data3
    - data: 
        *data4"
`);

        const parsed = YAML.parse(yaml);
        expect(parsed.data).toBe(parsed.level1.data);
        expect(parsed.level1.sub1.data).toBe(parsed.level1.sub2.data);
        expect(parsed.level2.data).toBe(parsed.refs.data);
        expect(parsed.level2.nested.data).toBe(parsed.refs.all[0].data);
        expect(parsed.level2.nested.deep.data).toBe(parsed.refs.all[1].data);

        // Verify IDs
        expect(parsed.data.id).toBe(0);
        expect(parsed.level1.sub1.data.id).toBe(1);
        expect(parsed.level2.data.id).toBe(2);
        expect(parsed.level2.nested.data.id).toBe(3);
        expect(parsed.level2.nested.deep.data.id).toBe(4);
      });

      test.todo("handles root level anchors correctly", () => {
        // When the root itself is referenced
        const obj = { name: "root" };
        obj.self = obj;

        const yaml = YAML.stringify(obj);
        expect(yaml).toContain("&root");
        expect(yaml).toContain("*root");

        const parsed = YAML.parse(yaml);
        expect(parsed.self).toBe(parsed);
        expect(parsed.name).toBe("root");
      });

      test("root collision with property name", () => {
        const obj = {};
        const root = {};
        obj.cycle = obj;
        obj.root = root;
        obj.root2 = root;
        expect(YAML.stringify(obj, null, 2)).toMatchInlineSnapshot(`
          "&root
          cycle: 
            *root
          root: 
            &root1
            {}
          root2: 
            *root1"
        `);
      });
    });

    // JavaScript edge cases and exotic objects
    describe("JavaScript edge cases", () => {
      test("handles symbols", () => {
        const sym = Symbol("test");
        expect(YAML.stringify(sym)).toBe(undefined);

        const obj = {
          [sym]: "symbol key value",
          normalKey: "normal value",
          symbolValue: sym,
        };
        // Symbol keys are not enumerable, symbol values are undefined
        expect(YAML.stringify(obj, null, 2)).toBe("normalKey: normal value\ntest: symbol key value");
      });

      test("handles WeakMap and WeakSet", () => {
        const weakMap = new WeakMap();
        const weakSet = new WeakSet();
        const key = {};
        weakMap.set(key, "value");
        weakSet.add(key);

        expect(YAML.stringify(weakMap)).toBe("{}");
        expect(YAML.stringify(weakSet)).toBe("{}");
      });

      test("handles ArrayBuffer and TypedArrays", () => {
        const buffer = new ArrayBuffer(8);
        const uint8 = new Uint8Array([1, 2, 3, 4]);
        const int32 = new Int32Array([100, 200]);
        const float64 = new Float64Array([3.14, 2.71]);

        expect(YAML.stringify(buffer)).toBe("{}");
        expect(YAML.stringify(uint8, null, 2)).toBe('"0": 1\n"1": 2\n"2": 3\n"3": 4');
        expect(YAML.stringify(int32, null, 2)).toBe('"0": 100\n"1": 200');
        expect(YAML.stringify(float64, null, 2)).toBe('"0": 3.14\n"1": 2.71');
      });

      test("handles Proxy objects", () => {
        const target = { a: 1, b: 2 };
        const proxy = new Proxy(target, {
          get(obj, prop) {
            if (prop === "c") return 3;
            return obj[prop];
          },
          ownKeys(obj) {
            return [...Object.keys(obj), "c"];
          },
          getOwnPropertyDescriptor(obj, prop) {
            if (prop === "c") {
              return { configurable: true, enumerable: true, value: 3 };
            }
            return Object.getOwnPropertyDescriptor(obj, prop);
          },
        });

        const result = YAML.stringify(proxy);
        expect(result).toContain("a: 1");
        expect(result).toContain("b: 2");
        expect(result).toContain("c: 3");
      });

      test("handles Proxy that throws", () => {
        const throwingProxy = new Proxy(
          {},
          {
            get() {
              throw new Error("Proxy get trap error");
            },
            ownKeys() {
              return ["key"];
            },
            getOwnPropertyDescriptor() {
              return { configurable: true, enumerable: true };
            },
          },
        );

        expect(() => YAML.stringify(throwingProxy)).toThrow("Proxy get trap error");
      });

      test("handles getters that throw", () => {
        const obj = {
          normal: "value",
          get throwing() {
            throw new Error("Getter error");
          },
        };

        expect(() => YAML.stringify(obj)).toThrow("Getter error");
      });

      test("handles getters that return different values", () => {
        let count = 0;
        const obj = {
          get counter() {
            return ++count;
          },
        };

        const yaml1 = YAML.stringify(obj, null, 2);
        const yaml2 = YAML.stringify(obj, null, 2);

        expect(yaml1).toBe("counter: 2");
        expect(yaml2).toBe("counter: 4");
      });

      test.todo("handles circular getters", () => {
        const obj = {
          get self() {
            return obj;
          },
        };

        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        // The getter returns the object itself, creating a circular reference
        expect(parsed.self).toBe(parsed);
      });

      test("handles Promise objects", () => {
        const promise = Promise.resolve(42);
        const pendingPromise = new Promise(() => {});

        expect(YAML.stringify(promise)).toBe("{}");
        expect(YAML.stringify(pendingPromise)).toBe("{}");
      });

      test("handles Generator functions and iterators", () => {
        function* generator() {
          yield 1;
          yield 2;
        }

        const gen = generator();
        const genFunc = generator;

        expect(YAML.stringify(gen)).toBe("{}");
        expect(YAML.stringify(genFunc)).toBe(undefined);
      });

      test("handles AsyncFunction and async iterators", () => {
        const asyncFunc = async () => 42;
        async function* asyncGen() {
          yield 1;
        }
        const asyncIterator = asyncGen();

        expect(YAML.stringify(asyncFunc)).toBe(undefined);
        expect(YAML.stringify(asyncIterator)).toBe("{}");
      });

      test("handles objects with null prototype", () => {
        const nullProto = Object.create(null);
        nullProto.key = "value";
        nullProto.number = 42;

        const result = YAML.stringify(nullProto);
        expect(result).toContain("key: value");
        expect(result).toContain("number: 42");
      });

      test("handles objects with custom toJSON", () => {
        const obj = {
          data: "secret",
          toJSON() {
            return { data: "public" };
          },
        };

        // YAML.stringify doesn't use toJSON (unlike JSON.stringify)
        expect(YAML.stringify(obj, null, 2)).toContain("data: secret");
      });

      test("handles objects with valueOf", () => {
        const obj = {
          value: 100,
          valueOf() {
            return 42;
          },
        };

        // valueOf is not called for objects
        const result = YAML.stringify(obj, null, 2);
        expect(result).toContain("value: 100");
      });

      test("handles objects with toString", () => {
        const obj = {
          data: "test",
          toString() {
            return "custom string";
          },
        };

        // toString is not called for objects
        const result = YAML.stringify(obj, null, 2);
        expect(result).toContain("data: test");
      });

      test("handles frozen and sealed objects", () => {
        const frozen = Object.freeze({ a: 1, b: 2 });
        const sealed = Object.seal({ x: 10, y: 20 });
        const nonExtensible = Object.preventExtensions({ foo: "bar" });

        expect(YAML.stringify(frozen, null, 2)).toBe("a: 1\nb: 2");
        expect(YAML.stringify(sealed, null, 2)).toBe('x: 10\n"y": 20');
        expect(YAML.stringify(nonExtensible, null, 2)).toBe("foo: bar");
      });

      test("handles objects with symbol.toPrimitive", () => {
        const obj = {
          normal: "value",
          [Symbol.toPrimitive](hint) {
            return hint === "string" ? "primitive" : 42;
          },
        };

        expect(YAML.stringify(obj, null, 2)).toBe("normal: value");
      });

      test("handles Intl objects", () => {
        const dateFormat = new Intl.DateTimeFormat("en-US");
        const numberFormat = new Intl.NumberFormat("en-US");
        const collator = new Intl.Collator("en-US");

        expect(YAML.stringify(dateFormat)).toBe("{}");
        expect(YAML.stringify(numberFormat)).toBe("{}");
        expect(YAML.stringify(collator)).toBe("{}");
      });

      test("handles URL and URLSearchParams", () => {
        const url = new URL("https://example.com/path?query=1");
        const params = new URLSearchParams("a=1&b=2");

        expect(YAML.stringify(url)).toBe("{}");
        expect(YAML.stringify(params)).toBe("{}");
      });

      test("handles empty objects and arrays in various contexts", () => {
        const nested = {
          emptyObj: {},
          emptyArr: [],
          nested: {
            deepEmpty: {},
            deepArr: [],
          },
          mixed: [{}, [], { inner: {} }, { inner: [] }],
        };

        const yaml = YAML.stringify(nested, null, 2);
        expect(yaml).toMatchInlineSnapshot(`
          "emptyObj: 
            {}
          emptyArr: 
            []
          nested: 
            deepEmpty: 
              {}
            deepArr: 
              []
          mixed: 
            - {}
            - []
            - inner: 
                {}
            - inner: 
                []"
        `);
      });

      test("handles sparse arrays in objects", () => {
        const obj = {
          sparse: [1, , , 4], // eslint-disable-line no-sparse-arrays
          normal: [1, 2, 3, 4],
        };

        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        expect(parsed.sparse).toEqual([1, 4]);
        expect(parsed.normal).toEqual([1, 2, 3, 4]);
      });

      test("handles very large objects", () => {
        const large = {};
        for (let i = 0; i < 10000; i++) {
          large[`key${i}`] = `value${i}`;
        }

        const yaml = YAML.stringify(large);
        const parsed = YAML.parse(yaml);

        expect(Object.keys(parsed).length).toBe(10000);
        expect(parsed.key0).toBe("value0");
        expect(parsed.key9999).toBe("value9999");
      });

      test("handles property names that parse incorrectly", () => {
        const obj = {
          "key: value": "colon space key",
        };

        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        expect(parsed["key: value"]).toBe("colon space key");
      });

      test("handles empty string keys without crashing", () => {
        const obj = { "": "empty key value" };
        const yaml = YAML.stringify(obj, null, 1);
        expect(yaml).toBe('"": empty key value');

        const parsed = YAML.parse(yaml);
        expect(parsed[""]).toBe("empty key value");
      });

      test("handles arrays with sparse elements", () => {
        const arr = [1, , 3, undefined, 5]; // eslint-disable-line no-sparse-arrays
        const yaml = YAML.stringify(arr);
        const parsed = YAML.parse(yaml);

        // Undefined and sparse elements should be filtered out
        expect(parsed).toEqual([1, 3, 5]);
      });

      test("handles objects with undefined values", () => {
        const obj = {
          defined: "value",
          undefined: undefined,
          null: null,
        };
        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        // Should preserve null but not undefined
        expect(parsed).toEqual({
          defined: "value",
          null: null,
        });
      });

      test("handles numeric object keys", () => {
        const obj = {
          0: "first",
          1: "second",
          42: "answer",
        };
        const yaml = YAML.stringify(obj);
        const parsed = YAML.parse(yaml);

        expect(parsed).toEqual({
          "0": "first",
          "1": "second",
          "42": "answer",
        });
      });
    });
  });

  describe("roundtrip (stringify -> parse)", () => {
    // Test that stringify -> parse produces deep equality for YAML 1.2 compliant values

    test("roundtrips booleans", () => {
      expect(YAML.parse(YAML.stringify(true))).toBe(true);
      expect(YAML.parse(YAML.stringify(false))).toBe(false);
    });

    test("roundtrips null", () => {
      expect(YAML.parse(YAML.stringify(null))).toBe(null);
    });

    test("roundtrips numbers", () => {
      const numbers = [0, 1, -1, 42, 3.14, -17.5, 1e10, 1.5e-10, Infinity, -Infinity];
      for (const n of numbers) {
        expect(YAML.parse(YAML.stringify(n))).toBe(n);
      }
      expect(YAML.parse(YAML.stringify(NaN))).toBeNaN();
    });

    test("roundtrips strings", () => {
      const strings = [
        "hello",
        "hello world",
        "with\nnewline",
        "with\ttab",
        'with "quotes"',
        "with 'single quotes'",
        // YAML 1.2: these YAML 1.1 legacy values are strings, should roundtrip
        "yes",
        "no",
        "on",
        "off",
        "Yes",
        "No",
        "YES",
        "NO",
        "On",
        "Off",
        "ON",
        "OFF",
        "y",
        "n",
        // YAML 1.2 Core Schema: True/TRUE/False/FALSE/Null/NULL are special values,
        // but when passed as strings to stringify, they should be quoted and roundtrip
        "True",
        "False",
        "TRUE",
        "FALSE",
        "Null",
        "NULL",
      ];
      for (const s of strings) {
        const roundtripped = YAML.parse(YAML.stringify(s));
        expect(roundtripped).toBe(s);
      }
    });

    test("roundtrips arrays", () => {
      const arrays = [
        [],
        [1, 2, 3],
        ["a", "b", "c"],
        [true, false, null],
        [1, "two", true, null],
        [
          [1, 2],
          [3, 4],
        ],
        // YAML 1.2: these YAML 1.1 legacy strings should survive roundtrip
        ["yes", "no", "on", "off"],
        // YAML 1.2: these are booleans/null when parsed, but stringify should quote string values
        ["True", "False", "NULL"],
      ];
      for (const arr of arrays) {
        expect(YAML.parse(YAML.stringify(arr))).toEqual(arr);
      }
    });

    test("roundtrips objects", () => {
      const objects = [
        {},
        { a: 1, b: 2 },
        { name: "test", count: 42 },
        { nested: { deep: { value: true } } },
        { arr: [1, 2, 3], obj: { key: "value" } },
        // YAML 1.2: these YAML 1.1 legacy strings as values should survive roundtrip
        { yes: "yes", no: "no", on: "on", off: "off" },
        // YAML 1.2: these are special values but stringify should quote string values
        { True: "True", False: "False", NULL: "NULL" },
      ];
      for (const obj of objects) {
        expect(YAML.parse(YAML.stringify(obj))).toEqual(obj);
      }
    });

    test("roundtrips complex nested structures", () => {
      const complex = {
        users: [
          { name: "Alice", active: true, score: 100 },
          { name: "Bob", active: false, score: null },
        ],
        settings: {
          enabled: true,
          count: 42,
          values: [1, 2, 3],
        },
        // YAML 1.2: these YAML 1.1 legacy strings should survive roundtrip
        yaml11strings: {
          yes: "yes",
          no: "no",
          on: "on",
          off: "off",
          // These are YAML 1.1 legacy - strings in YAML 1.2
          yes_variants: ["Yes", "YES"],
          no_variants: ["No", "NO"],
          on_variants: ["On", "ON"],
          off_variants: ["Off", "OFF"],
          // These are special in YAML 1.2 Core Schema but stringify quotes them
          true_variants: ["True", "TRUE"],
          false_variants: ["False", "FALSE"],
          null_variants: ["Null", "NULL"],
        },
      };
      expect(YAML.parse(YAML.stringify(complex))).toEqual(complex);
    });

    test("roundtrips GitHub Actions workflow keys", () => {
      // This was a common pain point with YAML 1.1 - 'on' being parsed as true
      const workflow = {
        name: "CI",
        on: {
          push: {
            branches: ["main"],
          },
          pull_request: {
            branches: ["main"],
          },
        },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [{ uses: "actions/checkout@v4" }, { run: "npm test" }],
          },
        },
      };
      expect(YAML.parse(YAML.stringify(workflow))).toEqual(workflow);
    });
  });
});

test("merging the same large anchor many times completes quickly", () => {
  // `<<: [*a, *a, ...]` adds no new data after the first merge, but
  // deduplicating each repeated alias must not rescan the entire property
  // list per merged key — that makes a ~25 KB document take minutes.
  const keyCount = 1200;
  const aliasCount = 3000;

  const lines: string[] = ["a: &a"];
  for (let i = 0; i < keyCount; i++) {
    lines.push(`  k${i}: ${i}`);
  }
  lines.push("b:");
  lines.push(`  <<: [${new Array(aliasCount).fill("*a").join(", ")}]`);
  const input = lines.join("\n");

  const start = performance.now();
  const parsed = YAML.parse(input) as { a: Record<string, number>; b: Record<string, number> };
  const elapsed = performance.now() - start;

  // Merge semantics are preserved: `b` receives every key of `a` exactly once.
  expect(Object.keys(parsed.a)).toHaveLength(keyCount);
  expect(parsed.b).toEqual(parsed.a);
  expect(parsed.b.k0).toBe(0);
  expect(parsed.b[`k${keyCount - 1}`]).toBe(keyCount - 1);

  // Repeated alias merges must be near-linear in the document size.
  expect(elapsed).toBeLessThan(isDebug || isASAN ? 15_000 : 4_000);
}, 30_000);

test("limits how many properties merge keys can materialize from a small document", () => {
  // A normal merge-key document still resolves.
  const small = YAML.parse("base: &base\n  x: 1\n  y: 2\nchild:\n  <<: *base\n  z: 3\n") as {
    base: Record<string, number>;
    child: Record<string, number>;
  };
  expect(small.child).toEqual({ x: 1, y: 2, z: 3 });

  // One anchor with `keyCount` properties merged into `mergeCount` separate
  // mappings would materialize keyCount * mergeCount (~1.2 million) property
  // entries from a ~30 KB document. The parser caps the total number of
  // properties materialized through merge keys and reports an error instead
  // of allocating memory proportional to the product.
  const keyCount = 2048;
  const mergeCount = 600;

  const lines: string[] = ["a: &a"];
  for (let i = 0; i < keyCount; i++) {
    lines.push(`  k${i}: ${i}`);
  }
  for (let i = 0; i < mergeCount; i++) {
    lines.push(`m${i}:`);
    lines.push("  <<: *a");
  }
  const input = lines.join("\n");

  expect(() => YAML.parse(input)).toThrow();
}, 30_000);

test("bounds alias expansion for parsed and imported YAML documents", async () => {
  // A document with a few levels of anchors, where each level is a sequence of
  // aliases to the previous one, expands to width^depth nodes even though the
  // source is only ~1 KB. The parser must cap the total number of nodes
  // reachable through alias expansion and report an error instead of letting
  // the .yaml import / bundler paths materialize the full expansion.
  const width = 30;
  const levelNames = ["a", "b", "c", "d"];
  const lines: string[] = [`a: &a [${new Array(width).fill("0").join(", ")}]`];
  for (let i = 1; i < levelNames.length; i++) {
    lines.push(`${levelNames[i]}: &${levelNames[i]} [${new Array(width).fill(`*${levelNames[i - 1]}`).join(", ")}]`);
  }
  lines.push(`e: [${new Array(width).fill("*d").join(", ")}]`);
  const payload = lines.join("\n") + "\n";

  // Ordinary anchor/alias reuse still parses.
  const legit = YAML.parse("base: &base [1, 2, 3]\nuses: [*base, *base, *base]\n") as {
    base: number[];
    uses: number[][];
  };
  expect(legit.uses).toEqual([
    [1, 2, 3],
    [1, 2, 3],
    [1, 2, 3],
  ]);

  // The payload's aliases would expand to ~24 million nodes (30^5). The parser
  // rejects it instead of materializing the expansion.
  expect(() => YAML.parse(payload)).toThrow();

  // The same document reaches the parser through the runtime .yaml import path.
  // A reasonable document still imports; the over-expanding one fails with a
  // catchable parse error instead of allocating memory proportional to the
  // expanded node count.
  using dir = tempDir("yaml-alias-budget", {
    "ok.yaml": "base: &base\n  retries: 3\n  region: us-east-1\ncopy: *base\n",
    "payload.yaml": payload,
    "index.ts": `
      const ok = (await import("./ok.yaml")).default;
      console.log("ok:" + JSON.stringify(ok.copy));
      try {
        const big = (await import("./payload.yaml")).default;
        console.log("payload:" + Object.keys(big).length);
      } catch (err) {
        console.log("rejected:" + String((err && err.name) || err));
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain('ok:{"retries":3,"region":"us-east-1"}');
  expect(stdout).toContain("rejected:");
  expect(stdout).not.toContain("payload:");
  expect(exitCode).toBe(0);
}, 60_000);

describe("plain scalar whitespace handling", () => {
  test("internal whitespace runs are preserved exactly", () => {
    expect(YAML.parse("key: word1   word2")).toEqual({ key: "word1   word2" });
    expect(YAML.parse("key: a \t b")).toEqual({ key: "a \t b" });
  });

  test("trailing whitespace is dropped", () => {
    expect(YAML.parse("key: value   ")).toEqual({ key: "value" });
    expect(YAML.parse("key: value\t")).toEqual({ key: "value" });
  });

  test("whitespace before a line break is dropped when folding", () => {
    expect(YAML.parse("key: foo  \n  bar")).toEqual({ key: "foo bar" });
    expect(YAML.parse("key: foo \t \n  bar")).toEqual({ key: "foo bar" });
  });

  test("multiline plain scalars fold with newline counts", () => {
    expect(YAML.parse("key: foo\n  bar")).toEqual({ key: "foo bar" });
    expect(YAML.parse("key: foo\n\n  bar")).toEqual({ key: "foo\nbar" });
    expect(YAML.parse("key: foo\n\n\n  bar")).toEqual({ key: "foo\n\nbar" });
  });

  test("whitespace buffer state does not leak between sibling scalars", () => {
    // Each scalar scan reuses the parser's whitespace buffer; pending
    // whitespace from one scalar must never appear in the next.
    expect(YAML.parse("a: one  two   \nb: three\nc: four  \n  five\nd: 6")).toEqual({
      a: "one  two",
      b: "three",
      c: "four five",
      d: 6,
    });
  });

  test("many scalars in one document reuse the buffer correctly", () => {
    const n = 256;
    const doc = Array.from({ length: n }, (_, i) => `k${i}: v${i} a  b   c\t`).join("\n");
    const parsed = YAML.parse(doc) as Record<string, string>;
    expect(Object.keys(parsed)).toHaveLength(n);
    for (let i = 0; i < n; i++) {
      expect(parsed[`k${i}`]).toBe(`v${i} a  b   c`);
    }
  });

  test("number resolution followed by more content becomes a string", () => {
    expect(YAML.parse("key: 12  34")).toEqual({ key: "12  34" });
    expect(YAML.parse("key: 1+1")).toEqual({ key: "1+1" });
    expect(YAML.parse("key: 12 then words")).toEqual({ key: "12 then words" });
  });

  test("special float forms resolve through the scalar resolver", () => {
    expect(YAML.parse("key: .nan")).toEqual({ key: NaN });
    expect(YAML.parse("key: .NaN")).toEqual({ key: NaN });
    expect(YAML.parse("key: .NAN")).toEqual({ key: NaN });
    expect((YAML.parse("key: .inf") as any).key).toBe(Infinity);
    expect((YAML.parse("key: .Inf") as any).key).toBe(Infinity);
    expect((YAML.parse("key: .INF") as any).key).toBe(Infinity);
    expect((YAML.parse("key: -.inf") as any).key).toBe(-Infinity);
    expect((YAML.parse("key: -.Inf") as any).key).toBe(-Infinity);
    expect((YAML.parse("key: +.inf") as any).key).toBe(Infinity);
  });

  test("near-miss special floats fall back to strings", () => {
    expect(YAML.parse("key: .in")).toEqual({ key: ".in" });
    expect(YAML.parse("key: .na")).toEqual({ key: ".na" });
    expect(YAML.parse("key: .infx")).toEqual({ key: ".infx" });
    expect(YAML.parse("key: .nanx")).toEqual({ key: ".nanx" });
    expect(YAML.parse("key: -.in")).toEqual({ key: "-.in" });
  });

  test("resolved keyword followed by more content becomes a string", () => {
    expect(YAML.parse("key: null x")).toEqual({ key: "null x" });
    expect(YAML.parse("key: true ish")).toEqual({ key: "true ish" });
    expect(YAML.parse("key: falsey")).toEqual({ key: "falsey" });
  });

  test("plain scalars in flow context preserve internal whitespace", () => {
    expect(YAML.parse("[one  two, 3, four   five]")).toEqual(["one  two", 3, "four   five"]);
    expect(YAML.parse("{a: x  y, b: 1 2}")).toEqual({ a: "x  y", b: "1 2" });
  });

  test("multiline plain scalar folding in UTF-16 input", () => {
    // Non-Latin1 characters force the UTF-16 scanner through the same
    // whitespace-buffer machinery.
    expect(YAML.parse("key: 测试  值\n  续行")).toEqual({ key: "测试  值 续行" });
    expect(YAML.parse("key: 🎉 party  time   ")).toEqual({ key: "🎉 party  time" });
  });

  test("plain scalar terminated by document markers drops pending whitespace", () => {
    expect(YAML.parse("key: value \n...")).toEqual({ key: "value" });
  });

  test("deeply interleaved numbers, keywords, and folded text in one document", () => {
    const doc = [
      "a: -1.5e3",
      "b: nan but not  really",
      "c: .nan",
      "d: word",
      "  folded  line",
      "e: 0x10",
      "f: 0b1",
      "h: +",
    ].join("\n");
    const parsed = YAML.parse(doc) as any;
    expect(parsed.a).toBe(-1500);
    expect(parsed.b).toBe("nan but not  really");
    expect(Number.isNaN(parsed.c)).toBe(true);
    expect(parsed.d).toBe("word folded  line");
    expect(parsed.e).toBe(16);
    expect(parsed.f).toBe("0b1");
    expect(parsed.h).toBe("+");
  });

  test("bare dash after a mapping key is a block-sequence indicator, not a plain scalar", () => {
    expect(() => YAML.parse("g: -")).toThrow(SyntaxError);
  });
});

// The YAML scanner records every source position as an i32, so an input of
// 2**31 bytes or more used to abort the process with
// `panic: int cast: TryFromIntError(PosOverflow)` instead of throwing. It is
// rejected before parsing, so the Uint8Array below is virtual pages that are
// never read. The runtime accepts a TypedArray here (the binding takes a
// Blob, Buffer or string); the declared `string` type is narrower.
test("parse rejects an input of 2**31 bytes or more instead of panicking", () => {
  let input: Uint8Array;
  try {
    input = new Uint8Array(2 ** 31 + 2);
  } catch {
    // The 2 GiB reservation itself can fail on a memory-pressured runner;
    // there is nothing to test then.
    return;
  }
  let err: any;
  try {
    YAML.parse(input as unknown as string);
  } catch (e) {
    err = e;
  }
  expect(err?.constructor?.name).toBe("RangeError");
  expect(err?.code).toBe("ERR_OUT_OF_RANGE");
  expect(err?.message).toBe(
    'The value of "input.byteLength" is out of range. It must be <= 2147483647. Received 2147483650',
  );
});
