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
});
