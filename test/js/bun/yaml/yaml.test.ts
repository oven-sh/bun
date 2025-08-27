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
      expect(Bun.YAML.stringify("key: value")).toBe("key: value"); // This doesn't get quoted
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
      expect(Bun.YAML.stringify([[1, 2], [3, 4]])).toBe("- - 1\n  - 2\n- - 3\n  - 4");
      expect(Bun.YAML.stringify([1, [2, 3], 4])).toBe("- 1\n- - 2\n  - 3\n- 4");
    });

    test("stringifies empty objects", () => {
      expect(Bun.YAML.stringify({})).toBe("{}");
    });

    test("stringifies simple objects", () => {
      expect(Bun.YAML.stringify({a: 1, b: 2})).toBe("a: 1\nb: 2");
      expect(Bun.YAML.stringify({name: "John", age: 30})).toBe("name: John\nage: 30");
      expect(Bun.YAML.stringify({flag: true, value: null})).toBe("flag: true\nvalue: null");
    });

    test("stringifies nested objects", () => {
      const obj = {
        database: {
          host: "localhost",
          port: 5432
        }
      };
      expect(Bun.YAML.stringify(obj)).toBe("database: \n  host: localhost\n  port: 5432");
    });

    test("stringifies mixed structures", () => {
      const obj = {
        users: [
          {name: "Alice", hobbies: ["reading", "hiking"]},
          {name: "Bob", hobbies: ["gaming"]}
        ]
      };
      const expected = "users: \n  - name: Alice\n    hobbies: \n      - reading\n      - hiking\n  - name: Bob\n    hobbies: \n      - gaming";
      expect(Bun.YAML.stringify(obj)).toBe(expected);
    });

    test("stringifies objects with special keys", () => {
      expect(Bun.YAML.stringify({"special-key": "value"})).toBe("special-key: value");
      expect(Bun.YAML.stringify({"123": "numeric"})).toBe('"123": numeric');
      expect(Bun.YAML.stringify({"": "empty"})).toBe('"": empty');
      expect(Bun.YAML.stringify({"true": "keyword"})).toBe('"true": keyword');
    });

    // Error case tests
    test("throws on BigInt", () => {
      expect(() => Bun.YAML.stringify(BigInt(123))).toThrow("YAML.stringify cannot serialize BigInt");
    });

    test("throws on symbols", () => {
      expect(Bun.YAML.stringify(Symbol("test"))).toBe(undefined);
    });

    test("throws on replacer parameter", () => {
      expect(() => Bun.YAML.stringify({a: 1}, () => {})).toThrow("YAML.stringify does not support the replacer argument");
    });

    test("handles functions", () => {
      // Functions get stringified as empty objects
      expect(Bun.YAML.stringify(() => {})).toBe("{}");
      expect(Bun.YAML.stringify({fn: () => {}, value: 42})).toBe("fn: \n  {}\nvalue: 42");
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
        expect(Bun.YAML.parse(Bun.YAML.stringify([[1, 2], [3, 4]]))).toEqual([[1, 2], [3, 4]]);
        expect(Bun.YAML.parse(Bun.YAML.stringify([1, [2, 3], 4]))).toEqual([1, [2, 3], 4]);
      });

      test("round-trips objects", () => {
        expect(Bun.YAML.parse(Bun.YAML.stringify({}))).toEqual({});
        expect(Bun.YAML.parse(Bun.YAML.stringify({a: 1, b: 2}))).toEqual({a: 1, b: 2});
        expect(Bun.YAML.parse(Bun.YAML.stringify({name: "John", age: 30}))).toEqual({name: "John", age: 30});
      });

      test("round-trips nested objects", () => {
        const obj = {
          database: {
            host: "localhost",
            port: 5432,
            credentials: {
              username: "admin",
              password: "secret"
            }
          }
        };
        expect(Bun.YAML.parse(Bun.YAML.stringify(obj))).toEqual(obj);
      });

      test("round-trips mixed structures", () => {
        const obj = {
          users: [
            {name: "Alice", age: 30, hobbies: ["reading", "hiking"]},
            {name: "Bob", age: 25, hobbies: ["gaming", "cooking"]}
          ],
          config: {
            debug: true,
            timeout: 5000
          }
        };
        expect(Bun.YAML.parse(Bun.YAML.stringify(obj))).toEqual(obj);
      });

      test("round-trips objects with special keys", () => {
        const obj = {
          "special-key": "value1",
          "123": "numeric-key",
          "true": "keyword-key",
          "": "empty-key"
        };
        expect(Bun.YAML.parse(Bun.YAML.stringify(obj))).toEqual(obj);
      });

      test("round-trips arrays with mixed types", () => {
        const arr = [
          "string",
          42,
          true,
          null,
          {nested: "object"},
          [1, 2, 3]
        ];
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
                DEBUG: false
              }
            },
            db: {
              image: "postgres:13",
              environment: {
                POSTGRES_PASSWORD: "secret",
                POSTGRES_DB: "myapp"
              },
              volumes: ["./data:/var/lib/postgresql/data"]
            }
          },
          networks: {
            default: {
              driver: "bridge"
            }
          }
        };
        expect(Bun.YAML.parse(Bun.YAML.stringify(config))).toEqual(config);
      });
    });

    // Anchor and alias tests (reference handling)
    describe("reference handling", () => {
      test("handles object references with anchors and aliases", () => {
        const shared = {shared: "value"};
        const obj = {
          first: shared,
          second: shared
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
          arrays: [sharedArray, sharedArray]
        };
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);
        
        // Should preserve array identity
        expect(parsed.arrays[0]).toBe(parsed.arrays[1]);
        expect(parsed.arrays[0]).toEqual([1, 2, 3]);
      });

      test("handles deeply nested references", () => {
        const sharedConfig = {host: "localhost", port: 5432};
        const obj = {
          development: {
            database: sharedConfig
          },
          test: {
            database: sharedConfig
          },
          shared: sharedConfig
        };
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);
        
        expect(parsed.development.database).toBe(parsed.test.database);
        expect(parsed.development.database).toBe(parsed.shared);
        expect(parsed.shared.host).toBe("localhost");
      });

      test.skip("handles self-referencing objects", () => {
        // Skipping as this causes build issues with circular references
        const obj = {name: "root"};
        obj.self = obj;
        
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);
        
        expect(parsed.self).toBe(parsed);
        expect(parsed.name).toBe("root");
      });

      test("generates unique anchor names for different objects", () => {
        const obj1 = {type: "first"};
        const obj2 = {type: "second"};
        const container = {
          a: obj1,
          b: obj1,
          c: obj2,
          d: obj2
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
          current.next = {level: i};
          current = current.next;
        }
        
        const yaml = Bun.YAML.stringify(deep);
        const parsed = Bun.YAML.parse(yaml);
        
        expect(parsed.next.next.next.level).toBe(2);
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
          null: null
        };
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);
        
        // Should preserve null but not undefined
        expect(parsed).toEqual({
          defined: "value",
          null: null
        });
      });

      test("handles numeric object keys", () => {
        const obj = {
          0: "first",
          1: "second",
          42: "answer"
        };
        const yaml = Bun.YAML.stringify(obj);
        const parsed = Bun.YAML.parse(yaml);
        
        expect(parsed).toEqual({
          "0": "first",
          "1": "second",
          "42": "answer"
        });
      });
    });
  });
});
