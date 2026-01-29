import { YAML, file } from "bun";
import { describe, expect, test } from "bun:test";
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
        // Ensure buffer is aligned for Int32Array
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 4) * 4);
        new Uint8Array(alignedBuffer).set(bytes);
        const int32Array = new Int32Array(alignedBuffer);
        expect(YAML.parse(int32Array)).toEqual({ value: 42 });
      });

      test("parses from Uint32Array", () => {
        const str = "test: pass";
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        // Ensure buffer is aligned for Uint32Array
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 4) * 4);
        new Uint8Array(alignedBuffer).set(bytes);
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
        // Ensure buffer is aligned for BigUint64Array
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 8) * 8);
        new Uint8Array(alignedBuffer).set(bytes);
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
        // Ensure buffer is aligned for Uint32Array
        const alignedBuffer = new ArrayBuffer(Math.ceil(bytes.length / 4) * 4);
        new Uint8Array(alignedBuffer).set(bytes);
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

    test("handles YAML bombs", () => {
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
    }, 100);

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

      for (let i = 0; i < 10000; i++) {
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
        expect(YAML.stringify("+99")).toBe("+99"); // + at start doesn't force quotes
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
        expect(YAML.stringify("....")).toBe("....");
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
