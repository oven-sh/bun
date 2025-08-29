import { describe, expect, test } from "bun:test";

describe("Bun.TOML.stringify", () => {
  test("empty object", () => {
    expect(Bun.TOML.stringify({})).toBe("");
  });

  test("basic values", () => {
    expect(Bun.TOML.stringify({ key: "value" })).toBe('key = "value"\n');
    expect(Bun.TOML.stringify({ num: 42 })).toBe("num = 42\n");
    expect(Bun.TOML.stringify({ bool: true })).toBe("bool = true\n");
    expect(Bun.TOML.stringify({ bool: false })).toBe("bool = false\n");
  });

  test("special number values", () => {
    expect(Bun.TOML.stringify({ nan: NaN })).toBe("nan = nan\n");
    expect(Bun.TOML.stringify({ inf: Infinity })).toBe("inf = inf\n");
    expect(Bun.TOML.stringify({ ninf: -Infinity })).toBe("ninf = -inf\n");
    expect(Bun.TOML.stringify({ float: 3.14159 })).toBe("float = 3.14159\n");
    expect(Bun.TOML.stringify({ zero: 0 })).toBe("zero = 0\n");
  });

  test("string escaping", () => {
    expect(Bun.TOML.stringify({ simple: "hello" })).toBe('simple = "hello"\n');
    expect(Bun.TOML.stringify({ empty: "" })).toBe('empty = ""\n');
    expect(Bun.TOML.stringify({ quote: 'he said "hello"' })).toBe('quote = "he said \\"hello\\""\n');
    expect(Bun.TOML.stringify({ backslash: "path\\to\\file" })).toBe('backslash = "path\\\\to\\\\file"\n');
    expect(Bun.TOML.stringify({ newline: "line1\nline2" })).toBe('newline = "line1\\nline2"\n');
    expect(Bun.TOML.stringify({ tab: "a\tb" })).toBe('tab = "a\\tb"\n');
    expect(Bun.TOML.stringify({ carriage: "a\rb" })).toBe('carriage = "a\\rb"\n');
  });

  test("key quoting", () => {
    expect(Bun.TOML.stringify({ "simple-key": "value" })).toBe('simple-key = "value"\n');
    expect(Bun.TOML.stringify({ "key with spaces": "value" })).toBe('"key with spaces" = "value"\n');
    expect(Bun.TOML.stringify({ "key.with.dots": "value" })).toBe('"key.with.dots" = "value"\n');
    expect(Bun.TOML.stringify({ "key@#$%": "value" })).toBe('"key@#$%" = "value"\n');
  });

  test("arrays", () => {
    expect(Bun.TOML.stringify({ arr: [] })).toBe("arr = []\n");
    expect(Bun.TOML.stringify({ nums: [1, 2, 3] })).toBe("nums = [1, 2, 3]\n");
    expect(Bun.TOML.stringify({ strings: ["a", "b"] })).toBe('strings = ["a", "b"]\n');
    expect(Bun.TOML.stringify({ mixed: [1, "two", true] })).toBe('mixed = [1, "two", true]\n');
    expect(Bun.TOML.stringify({ bools: [true, false, true] })).toBe("bools = [true, false, true]\n");
  });

  test("multiline arrays", () => {
    const longArray = [1, 2, 3, 4, 5];
    const result = Bun.TOML.stringify({ long: longArray });
    expect(result).toBe("long = [\n  1, \n  2, \n  3, \n  4, \n  5\n]\n");
  });

  test("arrays always use consistent multiline formatting for long arrays", () => {
    const shortArr = [1, 2, 3];
    const longArr = [1, 2, 3, 4, 5];
    expect(Bun.TOML.stringify({ shortArr })).toBe("shortArr = [1, 2, 3]\n");
    expect(Bun.TOML.stringify({ longArr })).toBe("longArr = [\n  1, \n  2, \n  3, \n  4, \n  5\n]\n");
  });

  test("nested objects become tables", () => {
    const obj = { name: { first: "John", last: "Doe" } };
    const result = Bun.TOML.stringify(obj);
    expect(result).toBe(
      `
[name]
first = "John"
last = "Doe"
`.trim() + "\n",
    );
  });

  test("regular tables", () => {
    const obj = { database: { server: "192.168.1.1", port: 5432 } };
    const result = Bun.TOML.stringify(obj);
    expect(result).toBe(
      `
[database]
server = "192.168.1.1"
port = 5432
`.trim() + "\n",
    );
  });

  test("mixed simple and table values", () => {
    const obj = {
      title: "TOML Example",
      database: {
        server: "192.168.1.1",
        ports: [8001, 8001, 8002],
        connection_max: 5000,
        enabled: true,
      },
    };
    const result = Bun.TOML.stringify(obj);
    expect(result).toMatchInlineSnapshot(`
"title = "TOML Example"

[database]
server = "192.168.1.1"
ports = [8001, 8001, 8002]
connection_max = 5000
enabled = true
"
`);
  });

  test("nested objects become separate tables", () => {
    const obj = {
      global: "value",
      section1: {
        key1: "value1",
        key2: 42,
      },
      section2: {
        key3: "value3",
        key4: true,
      },
    };
    const result = Bun.TOML.stringify(obj);
    expect(result).toMatchInlineSnapshot(`
"global = "value"

[section1]
key1 = "value1"
key2 = 42

[section2]
key3 = "value3"
key4 = true
"
`);
  });

  test("round-trip compatibility", () => {
    const original = {
      title: "Test Document",
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      section: {
        key: "value",
        nested_number: 123,
      },
    };

    const tomlString = Bun.TOML.stringify(original);
    const parsed = Bun.TOML.parse(tomlString);

    expect(parsed).toEqual(original);
  });

  test("handles null and undefined values", () => {
    expect(Bun.TOML.stringify({ key: null })).toBe("");
    expect(Bun.TOML.stringify({ key: undefined })).toBe("");
    expect(Bun.TOML.stringify({ a: "value", b: null, c: "value2" })).toBe('a = "value"\nc = "value2"\n');
  });

  test("error handling", () => {
    expect(() => Bun.TOML.stringify()).toThrow();
    expect(() => Bun.TOML.stringify(null)).toThrow();
    expect(() => Bun.TOML.stringify(undefined)).toThrow();
  });

  test("JSON.stringify-like API", () => {
    const obj = { key: "value" };

    // Should work with single argument
    expect(Bun.TOML.stringify(obj)).toBe('key = "value"\n');

    // Should ignore replacer (like YAML.stringify)
    expect(() => Bun.TOML.stringify(obj, () => {})).toThrow("TOML.stringify does not support the replacer argument");

    // Should ignore space parameter (TOML has fixed formatting)
    expect(Bun.TOML.stringify(obj, null, 4)).toBe('key = "value"\n');
    expect(Bun.TOML.stringify(obj, null, "  ")).toBe('key = "value"\n');
  });

  test("very deeply nested objects", () => {
    const obj = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: "deep",
              number: 42,
            },
            other: "value",
          },
          simple: "test",
        },
        another: "branch",
      },
      root: "value",
    };

    const result = Bun.TOML.stringify(obj);
    expect(result).toMatchInlineSnapshot(`
"root = "value"

[level1]
another = "branch"

[level1.level2]
simple = "test"

[level1.level2.level3]
other = "value"

[level1.level2.level3.level4]
value = "deep"
number = 42
"
`);

    // Verify round-trip
    const parsed = Bun.TOML.parse(result);
    expect(parsed).toEqual(obj);
  });

  test("arrays with simple values only", () => {
    const obj = {
      metadata: {
        version: "1.0",
        tags: ["production", "web"],
        numbers: [1, 2, 3, 4, 5],
      },
      config: {
        database: {
          host: "localhost",
          port: 5432,
        },
        cache: {
          enabled: true,
          ttl: 300,
        },
      },
    };

    const result = Bun.TOML.stringify(obj);
    expect(result).toMatchInlineSnapshot(`
"
[metadata]
version = "1.0"
tags = ["production", "web"]
numbers = [
  1, 
  2, 
  3, 
  4, 
  5
]

[config]

[config.database]
host = "localhost"
port = 5432

[config.cache]
enabled = true
ttl = 300
"
`);

    // Verify round-trip
    const parsed = Bun.TOML.parse(result);
    expect(parsed).toEqual(obj);
  });

  test("circular reference detection", () => {
    const obj: any = { name: "test" };
    obj.self = obj;
    expect(() => Bun.TOML.stringify(obj)).toThrow();
  });

  test("complex nested structure", () => {
    const obj = {
      title: "Complex TOML Example",
      owner: {
        name: "Tom Preston-Werner",
        dob: "1979-05-27T00:00:00-08:00",
      },
      database: {
        server: "192.168.1.1",
        ports: [8001, 8001, 8002],
        connection_max: 5000,
        enabled: true,
      },
      servers: {
        alpha: {
          ip: "10.0.0.1",
          dc: "eqdc10",
        },
        beta: {
          ip: "10.0.0.2",
          dc: "eqdc10",
        },
      },
    };

    const result = Bun.TOML.stringify(obj);
    expect(result).toMatchInlineSnapshot(`
"title = "Complex TOML Example"

[owner]
name = "Tom Preston-Werner"
dob = "1979-05-27T00:00:00-08:00"

[database]
server = "192.168.1.1"
ports = [8001, 8001, 8002]
connection_max = 5000
enabled = true

[servers]

[servers.alpha]
ip = "10.0.0.1"
dc = "eqdc10"

[servers.beta]
ip = "10.0.0.2"
dc = "eqdc10"
"
`);

    // Verify round-trip
    const parsed = Bun.TOML.parse(result);
    expect(parsed).toEqual(obj);
  });
});

describe("Bun.TOML.parse additional tests", () => {
  test("parse empty string", () => {
    expect(Bun.TOML.parse("")).toEqual({});
  });

  test("parse basic values", () => {
    expect(Bun.TOML.parse('key = "value"')).toEqual({ key: "value" });
    expect(Bun.TOML.parse("num = 42")).toEqual({ num: 42 });
    expect(Bun.TOML.parse("bool = true")).toEqual({ bool: true });
    expect(Bun.TOML.parse("bool = false")).toEqual({ bool: false });
  });

  test("parse arrays", () => {
    expect(Bun.TOML.parse("arr = []")).toEqual({ arr: [] });
    expect(Bun.TOML.parse("nums = [1, 2, 3]")).toEqual({ nums: [1, 2, 3] });
    expect(Bun.TOML.parse('strings = ["a", "b"]')).toEqual({ strings: ["a", "b"] });
  });

  test("parse tables", () => {
    const toml = `
[database]
server = "192.168.1.1"
port = 5432
`;
    expect(Bun.TOML.parse(toml)).toEqual({
      database: {
        server: "192.168.1.1",
        port: 5432,
      },
    });
  });

  test("parse mixed content", () => {
    const toml = `
title = "Test"
version = 1.0

[database]
server = "localhost"
enabled = true
`;
    expect(Bun.TOML.parse(toml)).toEqual({
      title: "Test",
      version: 1.0,
      database: {
        server: "localhost",
        enabled: true,
      },
    });
  });

  test("parse error handling", () => {
    expect(() => Bun.TOML.parse()).toThrow("Expected a string to parse");
    expect(() => Bun.TOML.parse(null)).toThrow("Expected a string to parse");
    expect(() => Bun.TOML.parse(undefined)).toThrow("Expected a string to parse");
    expect(() => Bun.TOML.parse("invalid toml [")).toThrow();
  });
});
