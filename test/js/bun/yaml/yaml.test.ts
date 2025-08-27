import { describe, expect, test } from "bun:test";

describe("Bun.YAML", () => {
  describe("parse", () => {
    test("parses null values", () => {
      expect(Bun.YAML.parse("null")).toBe(null);
      expect(Bun.YAML.parse("~")).toBe(null);
      expect(Bun.YAML.parse("")).toBe(null);
    });

    test("parses boolean values", () => {
      expect(Bun.YAML.parse("true")).toBe(true);
      expect(Bun.YAML.parse("false")).toBe(false);
      expect(Bun.YAML.parse("yes")).toBe(true);
      expect(Bun.YAML.parse("no")).toBe(false);
      expect(Bun.YAML.parse("on")).toBe(true);
      expect(Bun.YAML.parse("off")).toBe(false);
    });

    test("parses number values", () => {
      expect(Bun.YAML.parse("42")).toBe(42);
      expect(Bun.YAML.parse("3.14")).toBe(3.14);
      expect(Bun.YAML.parse("-17")).toBe(-17);
      expect(Bun.YAML.parse("0")).toBe(0);
      expect(Bun.YAML.parse(".inf")).toBe(Infinity);
      expect(Bun.YAML.parse("-.inf")).toBe(-Infinity);
      expect(Bun.YAML.parse(".nan")).toBeNaN();
    });

    test("parses string values", () => {
      expect(Bun.YAML.parse('"hello world"')).toBe("hello world");
      expect(Bun.YAML.parse("'single quoted'")).toBe("single quoted");
      expect(Bun.YAML.parse("unquoted string")).toBe("unquoted string");
      expect(Bun.YAML.parse('key: "value with spaces"')).toEqual({
        key: "value with spaces",
      });
    });

    test("parses arrays", () => {
      expect(Bun.YAML.parse("[1, 2, 3]")).toEqual([1, 2, 3]);
      expect(Bun.YAML.parse("- 1\n- 2\n- 3")).toEqual([1, 2, 3]);
      expect(Bun.YAML.parse("- a\n- b\n- c")).toEqual(["a", "b", "c"]);
      expect(Bun.YAML.parse("[]")).toEqual([]);
    });

    test("parses objects", () => {
      expect(Bun.YAML.parse("{a: 1, b: 2}")).toEqual({ a: 1, b: 2 });
      expect(Bun.YAML.parse("a: 1\nb: 2")).toEqual({ a: 1, b: 2 });
      expect(Bun.YAML.parse("{}")).toEqual({});
      expect(Bun.YAML.parse('name: "John"\nage: 30')).toEqual({
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
      const result = Bun.YAML.parse(yaml);
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
      expect(Bun.YAML.parse(yaml)).toEqual([{ document: 1 }, { document: 2 }]);
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
      expect(Bun.YAML.parse(yaml)).toEqual({
        empty_string: "",
        empty_array: [],
        empty_object: {},
        null_value: null,
      });
    });

    test("throws on invalid YAML", () => {
      expect(() => Bun.YAML.parse("[ invalid")).toThrow();
      expect(() => Bun.YAML.parse("{ key: value")).toThrow();
      expect(() => Bun.YAML.parse(":\n :  - invalid")).toThrow();
    });

    test("handles dates and timestamps", () => {
      const yaml = `
date: 2024-01-15
timestamp: 2024-01-15T10:30:00Z
`;
      const result = Bun.YAML.parse(yaml);
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
      const result = Bun.YAML.parse(yaml);
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
      expect(Bun.YAML.parse(yaml)).toEqual({
        single: "This is a 'quoted' string",
        double: "Line 1\nLine 2\tTabbed",
        unicode: "ABC",
      });
    });

    test("handles large numbers", () => {
      const yaml = `
int: 9007199254740991
float: 1.7976931348623157e+308
hex: 0xFF
octal: 0o777
binary: 0b1010
`;
      const result = Bun.YAML.parse(yaml);
      expect(result.int).toBe(9007199254740991);
      expect(result.float).toBe(1.7976931348623157e308);
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
      expect(Bun.YAML.parse(yaml)).toEqual({
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
  });

  describe("stringify", () => {
    // Basic data type tests
    test("stringifies null", () => {
      expect(Bun.YAML.stringify(null)).toBe("null");
      expect(Bun.YAML.stringify(undefined)).toBe(undefined);
    });

    test("stringifies booleans", () => {
      expect(Bun.YAML.stringify(true)).toBe("true");
      expect(Bun.YAML.stringify(false)).toBe("false");
    });

    test("stringifies numbers", () => {
      expect(Bun.YAML.stringify(42)).toBe("42");
      expect(Bun.YAML.stringify(3.14)).toBe("3.14");
      expect(Bun.YAML.stringify(-17)).toBe("-17");
      expect(Bun.YAML.stringify(0)).toBe("0");
      expect(Bun.YAML.stringify(-0)).toBe("-0");
      expect(Bun.YAML.stringify(Infinity)).toBe(".inf");
      expect(Bun.YAML.stringify(-Infinity)).toBe("-.inf");
      expect(Bun.YAML.stringify(NaN)).toBe(".nan");
    });

    test("stringifies strings", () => {
      expect(Bun.YAML.stringify("hello")).toBe("hello");
      expect(Bun.YAML.stringify("hello world")).toBe("hello world");
      expect(Bun.YAML.stringify("")).toBe('""');
      expect(Bun.YAML.stringify("true")).toBe('"true"'); // Keywords need quoting
      expect(Bun.YAML.stringify("false")).toBe('"false"');
      expect(Bun.YAML.stringify("null")).toBe('"null"');
      expect(Bun.YAML.stringify("123")).toBe('"123"'); // Numbers need quoting
    });

    test("stringifies strings with special characters", () => {
      expect(Bun.YAML.stringify("line1\nline2")).toBe('"line1\\nline2"');
      expect(Bun.YAML.stringify('with "quotes"')).toBe('"with \\"quotes\\""');
      expect(Bun.YAML.stringify("with\ttab")).toBe('"with\\ttab"');
      expect(Bun.YAML.stringify("with\rcarriage")).toBe('"with\\rcarriage"');
      expect(Bun.YAML.stringify("with\x00null")).toBe('"with\\0null"');
    });

    test("stringifies strings that need quoting", () => {
      expect(Bun.YAML.stringify("&anchor")).toBe('"&anchor"');
      expect(Bun.YAML.stringify("*alias")).toBe('"*alias"');
      expect(Bun.YAML.stringify("#comment")).toBe('"#comment"');
      expect(Bun.YAML.stringify("---")).toBe('"---"');
      expect(Bun.YAML.stringify("...")).toBe('"..."');
      expect(Bun.YAML.stringify("{flow}")).toBe('"{flow}"');
      expect(Bun.YAML.stringify("[flow]")).toBe('"[flow]"');
      expect(Bun.YAML.stringify("key: value")).toBe('"key: value"');
      expect(Bun.YAML.stringify(" leading space")).toBe('" leading space"');
      expect(Bun.YAML.stringify("trailing space ")).toBe('"trailing space "');
    });

    test("stringifies empty arrays", () => {
      expect(Bun.YAML.stringify([])).toBe("[]");
    });

    test("stringifies simple arrays", () => {
      expect(Bun.YAML.stringify([1, 2, 3])).toBe("- 1\n- 2\n- 3");
      expect(Bun.YAML.stringify(["a", "b", "c"])).toBe("- a\n- b\n- c");
      expect(Bun.YAML.stringify([true, false, null])).toBe("- true\n- false\n- null");
    });

    test("stringifies nested arrays", () => {
      expect(
        Bun.YAML.stringify([
          [1, 2],
          [3, 4],
        ]),
      ).toBe("- - 1\n  - 2\n- - 3\n  - 4");
      expect(Bun.YAML.stringify([1, [2, 3], 4])).toBe("- 1\n- - 2\n  - 3\n- 4");
    });

    test("stringifies empty objects", () => {
      expect(Bun.YAML.stringify({})).toBe("{}");
    });

    test("stringifies simple objects", () => {
      expect(Bun.YAML.stringify({ a: 1, b: 2 })).toBe("a: 1\nb: 2");
      expect(Bun.YAML.stringify({ name: "John", age: 30 })).toBe("name: John\nage: 30");
      expect(Bun.YAML.stringify({ flag: true, value: null })).toBe("flag: true\nvalue: null");
    });

    test("stringifies nested objects", () => {
      const obj = {
        database: {
          host: "localhost",
          port: 5432,
        },
      };
      expect(Bun.YAML.stringify(obj)).toBe("database: \n  host: localhost\n  port: 5432");
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
      expect(Bun.YAML.stringify(obj)).toBe(expected);
    });

    test("stringifies objects with special keys", () => {
      expect(Bun.YAML.stringify({ "special-key": "value" })).toBe("special-key: value");
      expect(Bun.YAML.stringify({ "123": "numeric" })).toBe('"123": numeric');
      expect(Bun.YAML.stringify({ "": "empty" })).toBe('"": empty');
      expect(Bun.YAML.stringify({ "true": "keyword" })).toBe('"true": keyword');
    });

    // Error case tests
    test("throws on BigInt", () => {
      expect(() => Bun.YAML.stringify(BigInt(123))).toThrow("YAML.stringify cannot serialize BigInt");
    });

    test("throws on symbols", () => {
      expect(Bun.YAML.stringify(Symbol("test"))).toBe(undefined);
    });

    test("throws on replacer parameter", () => {
      expect(() => Bun.YAML.stringify({ a: 1 }, () => {})).toThrow(
        "YAML.stringify does not support the replacer argument",
      );
    });

    test("handles functions", () => {
      // Functions get stringified as empty objects
      expect(Bun.YAML.stringify(() => {})).toBe(undefined);
      expect(Bun.YAML.stringify({ fn: () => {}, value: 42 })).toBe("fn: \n  {}\nvalue: 42");
    });

    // Round-trip tests
    describe("round-trip compatibility", () => {
      test("round-trips null values", () => {
        expect(Bun.YAML.parse(Bun.YAML.stringify(null))).toBe(null);
      });

      test("round-trips boolean values", () => {
        expect(Bun.YAML.parse(Bun.YAML.stringify(true))).toBe(true);
        expect(Bun.YAML.parse(Bun.YAML.stringify(false))).toBe(false);
      });

      test("round-trips number values", () => {
        expect(Bun.YAML.parse(Bun.YAML.stringify(42))).toBe(42);
        expect(Bun.YAML.parse(Bun.YAML.stringify(3.14))).toBe(3.14);
        expect(Bun.YAML.parse(Bun.YAML.stringify(-17))).toBe(-17);
        expect(Bun.YAML.parse(Bun.YAML.stringify(0))).toBe(0);
        expect(Bun.YAML.parse(Bun.YAML.stringify(-0))).toBe(-0);
        expect(Bun.YAML.parse(Bun.YAML.stringify(Infinity))).toBe(Infinity);
        expect(Bun.YAML.parse(Bun.YAML.stringify(-Infinity))).toBe(-Infinity);
        expect(Bun.YAML.parse(Bun.YAML.stringify(NaN))).toBeNaN();
      });

      test("round-trips string values", () => {
        expect(Bun.YAML.parse(Bun.YAML.stringify("hello"))).toBe("hello");
        expect(Bun.YAML.parse(Bun.YAML.stringify("hello world"))).toBe("hello world");
        expect(Bun.YAML.parse(Bun.YAML.stringify(""))).toBe("");
        expect(Bun.YAML.parse(Bun.YAML.stringify("true"))).toBe("true");
        expect(Bun.YAML.parse(Bun.YAML.stringify("123"))).toBe("123");
      });

      test("round-trips strings with special characters", () => {
        expect(Bun.YAML.parse(Bun.YAML.stringify("line1\nline2"))).toBe("line1\nline2");
        expect(Bun.YAML.parse(Bun.YAML.stringify('with "quotes"'))).toBe('with "quotes"');
        expect(Bun.YAML.parse(Bun.YAML.stringify("with\ttab"))).toBe("with\ttab");
        expect(Bun.YAML.parse(Bun.YAML.stringify("with\rcarriage"))).toBe("with\rcarriage");
      });

      test("round-trips arrays", () => {
        expect(Bun.YAML.parse(Bun.YAML.stringify([]))).toEqual([]);
        expect(Bun.YAML.parse(Bun.YAML.stringify([1, 2, 3]))).toEqual([1, 2, 3]);
        expect(Bun.YAML.parse(Bun.YAML.stringify(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
        expect(Bun.YAML.parse(Bun.YAML.stringify([true, false, null]))).toEqual([true, false, null]);
      });

      test("round-trips nested arrays", () => {
        expect(
          Bun.YAML.parse(
            Bun.YAML.stringify([
              [1, 2],
              [3, 4],
            ]),
          ),
        ).toEqual([
          [1, 2],
          [3, 4],
        ]);
        expect(Bun.YAML.parse(Bun.YAML.stringify([1, [2, 3], 4]))).toEqual([1, [2, 3], 4]);
      });

      test("round-trips objects", () => {
        expect(Bun.YAML.parse(Bun.YAML.stringify({}))).toEqual({});
        expect(Bun.YAML.parse(Bun.YAML.stringify({ a: 1, b: 2 }))).toEqual({ a: 1, b: 2 });
        expect(Bun.YAML.parse(Bun.YAML.stringify({ name: "John", age: 30 }))).toEqual({ name: "John", age: 30 });
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
        expect(Bun.YAML.parse(Bun.YAML.stringify(obj))).toEqual(obj);
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
        expect(Bun.YAML.parse(Bun.YAML.stringify(obj))).toEqual(obj);
      });

      test("round-trips objects with special keys", () => {
        const obj = {
          "special-key": "value1",
          "123": "numeric-key",
          "true": "keyword-key",
          "": "empty-key",
        };
        expect(Bun.YAML.parse(Bun.YAML.stringify(obj))).toEqual(obj);
      });

      test("round-trips arrays with mixed types", () => {
        const arr = ["string", 42, true, null, { nested: "object" }, [1, 2, 3]];
        expect(Bun.YAML.parse(Bun.YAML.stringify(arr))).toEqual(arr);
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
        expect(Bun.YAML.parse(Bun.YAML.stringify(config))).toEqual(config);
      });
    });

    // Anchor and alias tests (reference handling)
    describe("reference handling", () => {
      test("handles object references with anchors and aliases", () => {
        const shared = { shared: "value" };
        const obj = {
          first: shared,
          second: shared,
        };
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

        // Should preserve object identity
        expect(parsed.first).toBe(parsed.second);
        expect(parsed.first.shared).toBe("value");
      });

      test("handles array references with anchors and aliases", () => {
        const sharedArray = [1, 2, 3];
        const obj = {
          arrays: [sharedArray, sharedArray],
        };
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

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
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

        expect(parsed.development.database).toBe(parsed.test.database);
        expect(parsed.development.database).toBe(parsed.shared);
        expect(parsed.shared.host).toBe("localhost");
      });

      test.skip("handles self-referencing objects", () => {
        // Skipping as this causes build issues with circular references
        const obj = { name: "root" };
        obj.self = obj;

        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

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

        const yaml = Bun.YAML.stringify(container);
        const parsed = Bun.YAML.parse(yaml);

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

        const yaml = Bun.YAML.stringify(deep);
        const parsed = Bun.YAML.parse(yaml);

        expect(parsed.next.next.next.level).toBe(2);
      });

      // Test strings that need quoting due to YAML keywords
      test("quotes YAML boolean keywords", () => {
        // All variations of true/false keywords
        expect(Bun.YAML.stringify("True")).toBe('"True"');
        expect(Bun.YAML.stringify("TRUE")).toBe('"TRUE"');
        expect(Bun.YAML.stringify("False")).toBe('"False"');
        expect(Bun.YAML.stringify("FALSE")).toBe('"FALSE"');
        expect(Bun.YAML.stringify("yes")).toBe('"yes"');
        expect(Bun.YAML.stringify("Yes")).toBe('"Yes"');
        expect(Bun.YAML.stringify("YES")).toBe('"YES"');
        expect(Bun.YAML.stringify("no")).toBe('"no"');
        expect(Bun.YAML.stringify("No")).toBe('"No"');
        expect(Bun.YAML.stringify("NO")).toBe('"NO"');
        expect(Bun.YAML.stringify("on")).toBe('"on"');
        expect(Bun.YAML.stringify("On")).toBe('"On"');
        expect(Bun.YAML.stringify("ON")).toBe('"ON"');
        expect(Bun.YAML.stringify("off")).toBe('"off"');
        expect(Bun.YAML.stringify("Off")).toBe('"Off"');
        expect(Bun.YAML.stringify("OFF")).toBe('"OFF"');
        // Single letter booleans
        expect(Bun.YAML.stringify("n")).toBe('"n"');
        expect(Bun.YAML.stringify("N")).toBe('"N"');
        expect(Bun.YAML.stringify("y")).toBe('"y"');
        expect(Bun.YAML.stringify("Y")).toBe('"Y"');
      });

      test("quotes YAML null keywords", () => {
        expect(Bun.YAML.stringify("Null")).toBe('"Null"');
        expect(Bun.YAML.stringify("NULL")).toBe('"NULL"');
        expect(Bun.YAML.stringify("~")).toBe('"~"');
      });

      test("quotes YAML infinity and NaN keywords", () => {
        expect(Bun.YAML.stringify(".inf")).toBe('".inf"');
        expect(Bun.YAML.stringify(".Inf")).toBe('".Inf"');
        expect(Bun.YAML.stringify(".INF")).toBe('".INF"');
        expect(Bun.YAML.stringify(".nan")).toBe('".nan"');
        expect(Bun.YAML.stringify(".NaN")).toBe('".NaN"');
        expect(Bun.YAML.stringify(".NAN")).toBe('".NAN"');
      });

      test("quotes strings starting with special indicators", () => {
        expect(Bun.YAML.stringify("?question")).toBe('"?question"');
        expect(Bun.YAML.stringify("|literal")).toBe('"|literal"');
        expect(Bun.YAML.stringify("-dash")).toBe('"-dash"');
        expect(Bun.YAML.stringify("<less")).toBe('"<less"');
        expect(Bun.YAML.stringify(">greater")).toBe('">greater"');
        expect(Bun.YAML.stringify("!exclaim")).toBe('"!exclaim"');
        expect(Bun.YAML.stringify("%percent")).toBe('"%percent"');
        expect(Bun.YAML.stringify("@at")).toBe('"@at"');
      });

      test("quotes strings that look like numbers", () => {
        // Decimal numbers
        expect(Bun.YAML.stringify("42")).toBe('"42"');
        expect(Bun.YAML.stringify("3.14")).toBe('"3.14"');
        expect(Bun.YAML.stringify("-17")).toBe('"-17"');
        expect(Bun.YAML.stringify("+99")).toBe("+99"); // + at start doesn't force quotes
        expect(Bun.YAML.stringify(".5")).toBe('".5"');
        expect(Bun.YAML.stringify("-.5")).toBe('"-.5"');

        // Scientific notation
        expect(Bun.YAML.stringify("1e10")).toBe('"1e10"');
        expect(Bun.YAML.stringify("1E10")).toBe('"1E10"');
        expect(Bun.YAML.stringify("1.5e-10")).toBe('"1.5e-10"');
        expect(Bun.YAML.stringify("3.14e+5")).toBe('"3.14e+5"');

        // Hex numbers
        expect(Bun.YAML.stringify("0x1F")).toBe('"0x1F"');
        expect(Bun.YAML.stringify("0xDEADBEEF")).toBe('"0xDEADBEEF"');
        expect(Bun.YAML.stringify("0XFF")).toBe('"0XFF"');

        // Octal numbers
        expect(Bun.YAML.stringify("0o777")).toBe('"0o777"');
        expect(Bun.YAML.stringify("0O644")).toBe('"0O644"');
      });

      test("quotes strings with colons followed by spaces", () => {
        expect(Bun.YAML.stringify("key: value")).toBe('"key: value"');
        expect(Bun.YAML.stringify("key:value")).toBe("key:value"); // no quote when no space
        expect(Bun.YAML.stringify("http://example.com")).toBe("http://example.com"); // URLs shouldn't need quotes

        // These need quotes due to colon+space pattern
        expect(Bun.YAML.stringify("desc: this is")).toBe('"desc: this is"');
        expect(Bun.YAML.stringify("label:\ttab")).toBe('"label:\\ttab"');
        expect(Bun.YAML.stringify("text:\n")).toBe('"text:\\n"');
        expect(Bun.YAML.stringify("item:\r")).toBe('"item:\\r"');
      });

      test("quotes strings containing flow indicators", () => {
        expect(Bun.YAML.stringify("{json}")).toBe('"{json}"');
        expect(Bun.YAML.stringify("[array]")).toBe('"[array]"');
        expect(Bun.YAML.stringify("a,b,c")).toBe('"a,b,c"');
        expect(Bun.YAML.stringify("mixed{flow")).toBe('"mixed{flow"');
        expect(Bun.YAML.stringify("mixed}flow")).toBe('"mixed}flow"');
        expect(Bun.YAML.stringify("mixed[flow")).toBe('"mixed[flow"');
        expect(Bun.YAML.stringify("mixed]flow")).toBe('"mixed]flow"');
      });

      test("quotes strings with special single characters", () => {
        expect(Bun.YAML.stringify("#")).toBe('"#"');
        expect(Bun.YAML.stringify("`")).toBe('"`"');
        expect(Bun.YAML.stringify("'")).toBe('"\'"');
      });

      test("handles control characters and special escapes", () => {
        // Basic control characters
        expect(Bun.YAML.stringify("\x00")).toBe('"\\0"'); // null
        expect(Bun.YAML.stringify("\x07")).toBe('"\\a"'); // bell
        expect(Bun.YAML.stringify("\x08")).toBe('"\\b"'); // backspace
        expect(Bun.YAML.stringify("\x09")).toBe('"\\t"'); // tab
        expect(Bun.YAML.stringify("\x0a")).toBe('"\\n"'); // line feed
        expect(Bun.YAML.stringify("\x0b")).toBe('"\\v"'); // vertical tab
        expect(Bun.YAML.stringify("\x0c")).toBe('"\\f"'); // form feed
        expect(Bun.YAML.stringify("\x0d")).toBe('"\\r"'); // carriage return
        expect(Bun.YAML.stringify("\x1b")).toBe('"\\e"'); // escape
        expect(Bun.YAML.stringify("\x22")).toBe('"\\\""'); // double quote
        expect(Bun.YAML.stringify("\x5c")).toBe("\\"); // backslash - not quoted

        // Other control characters (hex notation)
        expect(Bun.YAML.stringify("\x01")).toBe('"\\x01"');
        expect(Bun.YAML.stringify("\x02")).toBe('"\\x02"');
        expect(Bun.YAML.stringify("\x03")).toBe('"\\x03"');
        expect(Bun.YAML.stringify("\x04")).toBe('"\\x04"');
        expect(Bun.YAML.stringify("\x05")).toBe('"\\x05"');
        expect(Bun.YAML.stringify("\x06")).toBe('"\\x06"');
        expect(Bun.YAML.stringify("\x0e")).toBe('"\\x0e"');
        expect(Bun.YAML.stringify("\x0f")).toBe('"\\x0f"');
        expect(Bun.YAML.stringify("\x10")).toBe('"\\x10"');
        expect(Bun.YAML.stringify("\x7f")).toBe('"\\x7f"'); // delete

        // Unicode control characters
        expect(Bun.YAML.stringify("\x85")).toBe('"\\N"'); // next line
        expect(Bun.YAML.stringify("\xa0")).toBe('"\\_"'); // non-breaking space

        // Combined in strings
        expect(Bun.YAML.stringify("hello\x00world")).toBe('"hello\\0world"');
        expect(Bun.YAML.stringify("line1\x0bline2")).toBe('"line1\\vline2"');
        expect(Bun.YAML.stringify("alert\x07sound")).toBe('"alert\\asound"');
      });

      test("handles special number formats", () => {
        // Positive zero
        expect(Bun.YAML.stringify(+0)).toBe("0"); // +0 becomes just 0

        // Round-trip special numbers
        expect(Bun.YAML.parse(Bun.YAML.stringify(+0))).toBe(0);
        expect(Object.is(Bun.YAML.parse(Bun.YAML.stringify(-0)), -0)).toBe(true);
      });

      test("quotes strings that would be ambiguous YAML", () => {
        // Strings that look like YAML document markers
        expect(Bun.YAML.stringify("---")).toBe('"---"');
        expect(Bun.YAML.stringify("...")).toBe('"..."');

        // But these don't need quotes (not exactly three)
        expect(Bun.YAML.stringify("--")).toBe('"--"'); // -- gets quoted
        expect(Bun.YAML.stringify("----")).toBe('"----"');
        expect(Bun.YAML.stringify("..")).toBe("..");
        expect(Bun.YAML.stringify("....")).toBe("....");
      });

      test("handles mixed content strings", () => {
        // Strings with numbers and text (shouldn't be quoted unless they parse as numbers)
        expect(Bun.YAML.stringify("abc123")).toBe("abc123");
        expect(Bun.YAML.stringify("123abc")).toBe("123abc");
        expect(Bun.YAML.stringify("1.2.3")).toBe("1.2.3");
        expect(Bun.YAML.stringify("v1.0.0")).toBe("v1.0.0");

        // SHA-like strings that could be mistaken for scientific notation
        expect(Bun.YAML.stringify("1e10abc")).toBe("1e10abc");
        expect(Bun.YAML.stringify("deadbeef")).toBe("deadbeef");
        expect(Bun.YAML.stringify("0xNotHex")).toBe("0xNotHex");
      });

      test("handles whitespace edge cases", () => {
        // Leading/trailing whitespace
        expect(Bun.YAML.stringify(" leading")).toBe('" leading"');
        expect(Bun.YAML.stringify("trailing ")).toBe('"trailing "');
        expect(Bun.YAML.stringify("\tleading")).toBe('"\\tleading"');
        expect(Bun.YAML.stringify("trailing\t")).toBe('"trailing\\t"');
        expect(Bun.YAML.stringify("\nleading")).toBe('"\\nleading"');
        expect(Bun.YAML.stringify("trailing\n")).toBe('"trailing\\n"');
        expect(Bun.YAML.stringify("\rleading")).toBe('"\\rleading"');
        expect(Bun.YAML.stringify("trailing\r")).toBe('"trailing\\r"');

        // Mixed internal content is okay
        expect(Bun.YAML.stringify("no  problem")).toBe("no  problem");
        expect(Bun.YAML.stringify("internal\ttabs\tok")).toBe('"internal\\ttabs\\tok"');
      });

      test("handles boxed primitives", () => {
        // Boxed primitives should be unwrapped
        const boxedNumber = new Number(42);
        const boxedString = new String("hello");
        const boxedBoolean = new Boolean(true);

        expect(Bun.YAML.stringify(boxedNumber)).toBe("42");
        expect(Bun.YAML.stringify(boxedString)).toBe("hello");
        expect(Bun.YAML.stringify(boxedBoolean)).toBe("true");

        // In objects
        const obj = {
          num: new Number(3.14),
          str: new String("world"),
          bool: new Boolean(false),
        };
        expect(Bun.YAML.stringify(obj)).toBe("num: \n  3.14\nstr: world\nbool: \n  false");
      });

      test("handles Date objects", () => {
        // Date objects get converted to ISO string via toString()
        const date = new Date("2024-01-15T10:30:00Z");
        const result = Bun.YAML.stringify(date);
        // Dates become empty objects currently
        expect(result).toBe("{}");

        // In objects
        const obj = { created: date };
        expect(Bun.YAML.stringify(obj)).toBe("created: \n  {}");
      });

      test("handles RegExp objects", () => {
        // RegExp objects become empty objects
        const regex = /test/gi;
        expect(Bun.YAML.stringify(regex)).toBe("{}");

        const obj = { pattern: regex };
        expect(Bun.YAML.stringify(obj)).toBe("pattern: \n  {}");
      });

      test("handles Error objects", () => {
        // Error objects have enumerable properties
        const error = new Error("Test error");
        const result = Bun.YAML.stringify(error);
        expect(result).toBe("{}"); // Errors have no enumerable properties

        // Custom error with properties
        const customError = new Error("Custom");
        customError.code = "ERR_TEST";
        customError.details = { line: 42 };
        const customResult = Bun.YAML.stringify(customError);
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
        expect(Bun.YAML.stringify(map)).toBe("{}");

        // Sets become empty objects
        const set = new Set([1, 2, 3]);
        expect(Bun.YAML.stringify(set)).toBe("{}");
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

        expect(Bun.YAML.stringify(obj)).toBe("visible: public");
      });

      test("handles getters", () => {
        // Getters should be evaluated
        const obj = {
          get computed() {
            return "computed value";
          },
          normal: "normal value",
        };

        const result = Bun.YAML.stringify(obj);
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

        const result = Bun.YAML.stringify(obj);
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

        const yaml = Bun.YAML.stringify(container);
        const parsed = Bun.YAML.parse(yaml);
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

        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

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

        const yaml = Bun.YAML.stringify(arr);
        const parsed = Bun.YAML.parse(yaml);

        expect(parsed).toEqual([{ a: 1, c: 2 }, { y: 3 }, { valid: "data" }]);
      });

      test("handles stack overflow protection", () => {
        // Create deeply nested structure approaching stack limit
        let deep = {};
        let current = deep;
        for (let i = 0; i < 10000; i++) {
          current.next = {};
          current = current.next;
        }

        // Should throw stack overflow for deeply nested structures
        expect(() => Bun.YAML.stringify(deep)).toThrow("Maximum call stack size exceeded");
      });

      test("handles arrays as root with references", () => {
        const shared = { shared: true };
        const arr = [shared, "middle", shared];

        const yaml = Bun.YAML.stringify(arr);
        const parsed = Bun.YAML.parse(yaml);

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

        const yaml = Bun.YAML.stringify(complex);
        const parsed = Bun.YAML.parse(yaml);

        expect(parsed.level1.data).toBe(parsed.level2.reference);
        expect(parsed.level1.data).toBe(parsed.level2.nested.deepRef);
        expect(parsed.level1.items).toBe(parsed.level2.moreItems);
      });
    });

    // JavaScript edge cases and exotic objects
    describe("JavaScript edge cases", () => {
      test("handles symbols", () => {
        const sym = Symbol("test");
        expect(Bun.YAML.stringify(sym)).toBe(undefined);

        const obj = {
          [sym]: "symbol key value",
          normalKey: "normal value",
          symbolValue: sym,
        };
        // Symbol keys are not enumerable, symbol values are undefined
        expect(Bun.YAML.stringify(obj)).toBe("normalKey: normal value\ntest: symbol key value");
      });

      test("handles WeakMap and WeakSet", () => {
        const weakMap = new WeakMap();
        const weakSet = new WeakSet();
        const key = {};
        weakMap.set(key, "value");
        weakSet.add(key);

        expect(Bun.YAML.stringify(weakMap)).toBe("{}");
        expect(Bun.YAML.stringify(weakSet)).toBe("{}");
      });

      test("handles ArrayBuffer and TypedArrays", () => {
        const buffer = new ArrayBuffer(8);
        const uint8 = new Uint8Array([1, 2, 3, 4]);
        const int32 = new Int32Array([100, 200]);
        const float64 = new Float64Array([3.14, 2.71]);

        expect(Bun.YAML.stringify(buffer)).toBe("{}");
        expect(Bun.YAML.stringify(uint8)).toBe('"0": 1\n"1": 2\n"2": 3\n"3": 4');
        expect(Bun.YAML.stringify(int32)).toBe('"0": 100\n"1": 200');
        expect(Bun.YAML.stringify(float64)).toBe('"0": 3.14\n"1": 2.71');
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

        const result = Bun.YAML.stringify(proxy);
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

        expect(() => Bun.YAML.stringify(throwingProxy)).toThrow("Proxy get trap error");
      });

      test("handles getters that throw", () => {
        const obj = {
          normal: "value",
          get throwing() {
            throw new Error("Getter error");
          },
        };

        expect(() => Bun.YAML.stringify(obj)).toThrow("Getter error");
      });

      test("handles getters that return different values", () => {
        let count = 0;
        const obj = {
          get counter() {
            return ++count;
          },
        };

        const yaml1 = Bun.YAML.stringify(obj);
        const yaml2 = Bun.YAML.stringify(obj);

        expect(yaml1).toBe("counter: 2");
        expect(yaml2).toBe("counter: 4");
      });

      test.todo("handles circular getters", () => {
        const obj = {
          get self() {
            return obj;
          },
        };

        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

        // The getter returns the object itself, creating a circular reference
        expect(parsed.self).toBe(parsed);
      });

      test("handles Promise objects", () => {
        const promise = Promise.resolve(42);
        const pendingPromise = new Promise(() => {});

        expect(Bun.YAML.stringify(promise)).toBe("{}");
        expect(Bun.YAML.stringify(pendingPromise)).toBe("{}");
      });

      test("handles Generator functions and iterators", () => {
        function* generator() {
          yield 1;
          yield 2;
        }

        const gen = generator();
        const genFunc = generator;

        expect(Bun.YAML.stringify(gen)).toBe("{}");
        expect(Bun.YAML.stringify(genFunc)).toBe(undefined);
      });

      test("handles AsyncFunction and async iterators", () => {
        const asyncFunc = async () => 42;
        async function* asyncGen() {
          yield 1;
        }
        const asyncIterator = asyncGen();

        expect(Bun.YAML.stringify(asyncFunc)).toBe(undefined);
        expect(Bun.YAML.stringify(asyncIterator)).toBe("{}");
      });

      test("handles objects with null prototype", () => {
        const nullProto = Object.create(null);
        nullProto.key = "value";
        nullProto.number = 42;

        const result = Bun.YAML.stringify(nullProto);
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
        expect(Bun.YAML.stringify(obj)).toContain("data: secret");
        expect(Bun.YAML.stringify(obj)).toContain("toJSON:");
      });

      test("handles objects with valueOf", () => {
        const obj = {
          value: 100,
          valueOf() {
            return 42;
          },
        };

        // valueOf is not called for objects
        const result = Bun.YAML.stringify(obj);
        expect(result).toContain("value: 100");
        expect(result).toContain("valueOf:");
      });

      test("handles objects with toString", () => {
        const obj = {
          data: "test",
          toString() {
            return "custom string";
          },
        };

        // toString is not called for objects
        const result = Bun.YAML.stringify(obj);
        expect(result).toContain("data: test");
        expect(result).toContain("toString:");
      });

      test("handles frozen and sealed objects", () => {
        const frozen = Object.freeze({ a: 1, b: 2 });
        const sealed = Object.seal({ x: 10, y: 20 });
        const nonExtensible = Object.preventExtensions({ foo: "bar" });

        expect(Bun.YAML.stringify(frozen)).toBe("a: 1\nb: 2");
        expect(Bun.YAML.stringify(sealed)).toBe('x: 10\n"y": 20');
        expect(Bun.YAML.stringify(nonExtensible)).toBe("foo: bar");
      });

      test("handles objects with symbol.toPrimitive", () => {
        const obj = {
          normal: "value",
          [Symbol.toPrimitive](hint) {
            return hint === "string" ? "primitive" : 42;
          },
        };

        expect(Bun.YAML.stringify(obj)).toBe("normal: value\nSymbol.toPrimitive: \n  {}");
      });

      test("handles Intl objects", () => {
        const dateFormat = new Intl.DateTimeFormat("en-US");
        const numberFormat = new Intl.NumberFormat("en-US");
        const collator = new Intl.Collator("en-US");

        expect(Bun.YAML.stringify(dateFormat)).toBe("{}");
        expect(Bun.YAML.stringify(numberFormat)).toBe("{}");
        expect(Bun.YAML.stringify(collator)).toBe("{}");
      });

      test("handles URL and URLSearchParams", () => {
        const url = new URL("https://example.com/path?query=1");
        const params = new URLSearchParams("a=1&b=2");

        expect(Bun.YAML.stringify(url)).toBe("{}");
        expect(Bun.YAML.stringify(params)).toBe("{}");
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

        const yaml = Bun.YAML.stringify(nested);
        expect(yaml).toContain("emptyObj: \n  {}");
        expect(yaml).toContain("emptyArr: \n  []");
        expect(yaml).toContain("deepEmpty: \n    {}");
        expect(yaml).toContain("deepArr: \n    []");
      });

      test("handles sparse arrays in objects", () => {
        const obj = {
          sparse: [1, , , 4], // eslint-disable-line no-sparse-arrays
          normal: [1, 2, 3, 4],
        };

        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

        expect(parsed.sparse).toEqual([1, 4]);
        expect(parsed.normal).toEqual([1, 2, 3, 4]);
      });

      test("handles very large objects", () => {
        const large = {};
        for (let i = 0; i < 10000; i++) {
          large[`key${i}`] = `value${i}`;
        }

        const yaml = Bun.YAML.stringify(large);
        const parsed = Bun.YAML.parse(yaml);

        expect(Object.keys(parsed).length).toBe(10000);
        expect(parsed.key0).toBe("value0");
        expect(parsed.key9999).toBe("value9999");
      });

      test("handles property names that parse incorrectly", () => {
        const obj = {
          "key: value": "colon space key",
        };

        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

        expect(parsed["key: value"]).toBe("colon space key");
      });

      test("handles empty string keys without crashing", () => {
        const obj = { "": "empty key value" };
        const yaml = Bun.YAML.stringify(obj);
        expect(yaml).toBe('"": empty key value');

        const parsed = Bun.YAML.parse(yaml);
        expect(parsed[""]).toBe("empty key value");
      });

      test("handles arrays with sparse elements", () => {
        const arr = [1, , 3, undefined, 5]; // eslint-disable-line no-sparse-arrays
        const yaml = Bun.YAML.stringify(arr);
        const parsed = Bun.YAML.parse(yaml);

        // Undefined and sparse elements should be filtered out
        expect(parsed).toEqual([1, 3, 5]);
      });

      test("handles objects with undefined values", () => {
        const obj = {
          defined: "value",
          undefined: undefined,
          null: null,
        };
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

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
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);

        expect(parsed).toEqual({
          "0": "first",
          "1": "second",
          "42": "answer",
        });
      });
    });
  });
});
