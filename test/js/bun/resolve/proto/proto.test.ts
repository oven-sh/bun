import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import * as editions from "./editions.proto";
import * as names from "./names.proto";
import { Closed, Defaults, Legacy, Required } from "./proto2.proto";
import { Choice, Color, Lists, Maps, Outer, Outer_Inner, Outer_Inner_Kind, Scalars } from "./proto3.proto";
import * as forwards from "./shared/forwards.proto";
import * as point from "./shared/point.proto";

const { Features } = editions;
const hex = (text: string) => Uint8Array.fromHex(text.replaceAll(" ", ""));
const bytes = (...values: number[]) => new Uint8Array(values);

async function run(files: Record<string, string>, ...args: string[]) {
  using dir = tempDir("proto-loader", files);
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd: String(dir), stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The bytes are from `protoc --encode`.
describe.each([
  [
    "the extremes of every scalar",
    Scalars,
    {
      d: -1.5,
      f: 0.25,
      i32: -(2 ** 31),
      i64: -(2n ** 63n),
      u32: 2 ** 32 - 1,
      u64: 2n ** 64n - 1n,
      s32: -(2 ** 31),
      s64: -(2n ** 63n),
      f32: 2 ** 32 - 1,
      f64: 2n ** 64n - 1n,
      sf32: -(2 ** 31),
      sf64: -(2n ** 63n),
      b: true,
      s: "é☃😀",
      by: bytes(0, 255),
      color: Color.NEGATIVE,
      tracked: 0,
      highestNumber: 1,
    },
    "09000000000000f8bf150000803e1880808080f8ffffffff01208080808080808080800128ffffffff0f30ffffffffffffffffff0138ffffffff0f40ffffffffffffffffff014dffffffff51ffffffffffffffff5d0000008061000000000000008068017209c3a9e29883f09f98807a0200ff8001f9ffffffffffffffff01880100f8ffffff0f01",
  ],
  [
    "the other extremes, -0 and NaN",
    Scalars,
    {
      d: -0,
      f: NaN,
      i32: 2 ** 31 - 1,
      i64: 2n ** 63n - 1n,
      u32: 128,
      u64: 2n ** 32n,
      s32: 2 ** 31 - 1,
      s64: 2n ** 63n - 1n,
      sf32: 1,
      sf64: 1n,
    },
    "090000000000000080150000c07f18ffffffff0720ffffffffffffffff7f28800130808080801038feffffff0f40feffffffffffffffff015d01000000610100000000000000",
  ],
  [
    "repeated fields",
    Lists,
    {
      i32: [1, -1, 300],
      s64: [-1n, 1n],
      d: [1, 0],
      b: [true, false],
      color: [Color.RED, Color.NEGATIVE],
      s: ["", "a"],
      by: [bytes(), bytes(0x62)],
      child: [{}, { i32: [5] }],
      expanded: [1, 2],
    },
    "0a0d01ffffffffffffffffff01ac02120201021a10000000000000f03f0000000000000000220201002a0b01f9ffffffffffffffff0132003201613a003a0162420042030a010548014802",
  ],
  [
    "maps",
    Maps,
    {
      byString: { a: {} },
      byInt32: { "-1": Color.RED },
      byUint64: { "18446744073709551615": "x" },
      byBool: { false: bytes() },
      bySfixed32: { 7: 0 },
    },
    "0a050a01611200120d08ffffffffffffffffff0110011a0e08ffffffffffffffffff011201782204080012002a0e0d07000000110000000000000000",
  ],
  ["a oneof that holds a zero", Choice, { value: { case: "number", value: 0 }, middle: 1 }, "08001001"],
  [
    "a oneof that holds a message",
    Choice,
    { value: { case: "nested", value: { value: { case: "textValue", value: "" } } }, middle: 1 },
    "100122021a00",
  ],
  [
    "nested, imported and well-known types",
    Outer,
    {
      inner: { outer: {} },
      point: { x: -1, y: 2 },
      unit: forwards.Unit.METER,
      at: { seconds: 1700000000n, nanos: 5 },
      value: {
        kind: {
          case: "structValue",
          value: {
            fields: {
              k: {
                kind: {
                  case: "listValue",
                  value: {
                    values: [{ kind: { case: "nullValue", value: 0 } }, { kind: { case: "boolValue", value: true } }],
                  },
                },
              },
            },
          },
        },
      },
      any: { typeUrl: "t", value: bytes(0x76) },
    },
    "0a021200120408011004180122080880e2cfaa0610052a132a110a0f0a016b120a32080a0208000a02200132060a0174120176",
  ],
  [
    "proto2",
    Legacy,
    {
      closed: Closed.ONE,
      expanded: [Closed.ONE, Closed.FOUR],
      packed: [Closed.TWO, Closed.FOUR],
      byNumber: { 1: 5 },
      result: { x: 0, item: [{ name: "a" }, {}] },
      value: { case: "chosen", value: Closed.TWO },
      unchecked: "",
    },
    "0801100110041a0202042204080110052b30003b4201613c3b3c2c48025a00",
  ],
  ["a field that is set to its default", Defaults, { i32: -5, none: 0 }, "08fbffffffffffffffff015000"],
  [
    "editions",
    Features,
    {
      explicit: 0,
      implicit: 0,
      needed: 0,
      delimited: { needed: 1 },
      packed: [1, 2],
      expanded: [1, 2],
      open: 0,
      closed: 3,
      loose: "a",
      strict: "b",
      withDefault: 9,
    },
    "08001800231801242a02010230013002380040034a01615201625809",
  ],
] as [string, any, object, string][])("%s", (_, type, message, expected) => {
  test("encode", () => expect(type.encode(message).toHex()).toBe(expected));
  test("decode", () => expect(type.decode(hex(expected))).toMatchObject(message));
});

describe("decode", () => {
  test("has every field", () => {
    expect(Scalars.decode(bytes())).toStrictEqual({
      d: 0,
      f: 0,
      i32: 0,
      i64: 0n,
      u32: 0,
      u64: 0n,
      s32: 0,
      s64: 0n,
      f32: 0,
      f64: 0n,
      sf32: 0,
      sf64: 0n,
      b: false,
      s: "",
      by: bytes(),
      color: 0,
      tracked: undefined,
      highestNumber: 0,
    });
    expect(Choice.decode(bytes())).toStrictEqual({ middle: 0, value: undefined });
    expect(Outer_Inner.decode(bytes())).toStrictEqual({ kind: Outer_Inner_Kind.NONE, outer: undefined });
  });

  test("fills in [default]", () => {
    expect(Defaults.decode(bytes())).toStrictEqual({
      i32: -5,
      u64: 2n ** 64n - 1n,
      f: Math.fround(0.1),
      d: -Infinity,
      nan: NaN,
      s: 'a"\néb',
      by: bytes(0, 255),
      closed: Closed.TWO,
      b: true,
      none: undefined,
    });
    expect(Defaults.decode(bytes()).by).not.toBe(Defaults.decode(bytes()).by);
  });

  test("takes packed and expanded elements whatever the schema says", () => {
    expect(Lists.decode(hex("0801 0a020203 0804 4a020506 4807"))).toMatchObject({
      i32: [1, 2, 3, 4],
      expanded: [5, 6, 7],
    });
  });

  test("merges a message that comes twice, and keeps the last scalar", () => {
    expect(Outer.decode(hex("12020802 12021004 1801 1800"))).toMatchObject({ point: { x: 1, y: 2 }, unit: 0 });
    expect(Choice.decode(hex("22021001 22020805")).value).toEqual({
      case: "nested",
      value: { middle: 1, value: { case: "number", value: 5 } },
    });
    expect(Choice.decode(hex("22021001 0807 2200")).value).toEqual({
      case: "nested",
      value: { middle: 0, value: undefined },
    });
  });

  test("skips unknown fields of every wire type, and known fields of another wire type", () => {
    const unknown = "a00601 a1060000000000000000 a2060161 a306a806 01ab06ac06a406 a50600000000 0a0161";
    expect(point.Point.decode(hex(`${unknown} 1004`))).toStrictEqual({ x: 0, y: 2 });
    expect(Legacy.decode(hex("a00601"))).not.toContainKey("extension");
  });

  test("keeps a number that an open enum does not list, and drops one that a closed enum does not", () => {
    expect(Scalars.decode(hex("800163")).color).toBe(99);
    expect(Features.decode(hex("1800 3863 4063"))).toMatchObject({ open: 99, closed: undefined });
    expect(Legacy.decode(hex("0803 1001 1003 1a03020304 220408011004 220408021005 5001 4803"))).toMatchObject({
      closed: undefined,
      expanded: [1],
      packed: [2, 4],
      byNumber: { 2: 5 },
      value: { case: "other", value: 1 },
    });
  });

  test("completes a map entry, in any order", () => {
    const { byString, byInt32 } = Maps.decode(hex("0a00 12041001 0802 1200"));
    expect(Object.keys(byString)).toEqual([""]);
    expect(byString[""].byBool).toEqual({});
    expect(byInt32).toEqual({ 0: 0, 2: 1 });
  });

  test("a map key cannot reach a prototype", () => {
    const entries = Object.create(null);
    entries["__proto__"] = {};
    entries["constructor"] = {};
    const { byString } = Maps.decode(Maps.encode({ byString: entries }));
    expect(Object.getPrototypeOf(byString)).toBeNull();
    expect(Object.keys(byString)).toEqual(["__proto__", "constructor"]);
  });

  test("truncates a 64-bit varint for a 32-bit field", () => {
    expect(Scalars.decode(hex("188180808010 288180808010 68808080808001"))).toMatchObject({ i32: 1, u32: 1, b: true });
  });

  test("verifies UTF-8 where the schema does", () => {
    expect(Legacy.decode(hex("5a01ff")).unchecked).toBe("�");
    expect(Features.decode(hex("1800 4a01ff")).loose).toBe("�");
    expect(() => Features.decode(hex("1800 5201ff"))).toThrow("a string is not valid UTF-8");
    expect(Scalars.decode(hex("7204efbbbf61")).s).toBe("﻿a");
  });

  test("reads a view into a larger buffer, and copies bytes out of it", () => {
    const buffer = Buffer.from("ff7a020102ff", "hex");
    const { by } = Scalars.decode(buffer.subarray(1, 5));
    buffer.fill(0);
    expect(by).toStrictEqual(bytes(1, 2));
  });

  test.each([
    ["18", Scalars, "unexpected end of data"],
    ["1880", Scalars, "unexpected end of data"],
    ["0900000000", Scalars, "unexpected end of data"],
    ["150000", Scalars, "unexpected end of data"],
    ["720561", Scalars, "unexpected end of data"],
    ["72ffffffff0f", Scalars, "unexpected end of data"],
    ["72808080808001", Scalars, "unexpected end of data"],
    ["18ffffffffffffffffffff01", Scalars, "a varint is longer than 10 bytes"],
    ["7201ff", Scalars, "a string is not valid UTF-8"],
    ["0001", Scalars, "a field has the number 0"],
    ["0e", Scalars, "unknown wire type 6"],
    ["0c", Scalars, "a group ends that did not start"],
    ["ffffffff0f", Scalars, "unknown wire type 7"],
    ["988080801001", Scalars, "a tag has more than 32 bits"],
    ["a10600", Scalars, "a field is longer than what contains it"],
    ["a306", Scalars, "unexpected end of data"],
    ["a306ac06", Scalars, "a group ends that did not start"],
    ["0a018001", Lists, "a field is longer than what contains it"],
    ["42020a020101", Lists, "a field is longer than what contains it"],
    ["0a020a026161", Maps, "a field is longer than what contains it"],
    ["2b3001", Legacy, "a group has no end"],
    ["", Required, "missing required field fixture.v2.Required.id"],
    ["0a001200", Required, "missing required field fixture.v2.Required.id"],
    ["", Features, "missing required field fixture.editions.Features.needed"],
  ] as [string, any, string][])("refuses %j", (input, type, why) => {
    expect(() => type.decode(hex(input))).toThrow(new RangeError(`Invalid protobuf message: ${why}`));
  });

  test("limits nesting", () => {
    const nested = (depth: number) => {
      let message = {};
      for (let i = 1; i < depth; i++) message = { child: [message] };
      return Lists.encode(message);
    };
    expect(() => Lists.decode(nested(100))).not.toThrow();
    expect(() => Lists.decode(nested(101))).toThrow("nested more than 100 levels deep");
    expect(() => Lists.decode(Buffer.alloc(100_000, "a306", "hex"))).toThrow("nested more than 100 levels deep");
  });

  test("refuses what is not a Uint8Array", () => {
    expect(() => Scalars.decode("18" as any)).toThrow(new TypeError('Expected a Uint8Array, received "18"'));
  });
});

describe("encode", () => {
  test("leaves out zeros, null and undefined", () => {
    expect(Scalars.encode(Scalars.decode(bytes()))).toHaveLength(0);
    expect(Scalars.encode({ i64: 0, s: null, tracked: undefined } as any)).toHaveLength(0);
    expect(Lists.encode(Lists.decode(bytes()))).toHaveLength(0);
  });

  test("takes a number for a 64-bit field", () => {
    expect(Scalars.encode({ i64: -1, u64: Number.MAX_SAFE_INTEGER }).toHex()).toBe(
      "20ffffffffffffffffff0130ffffffffffffff0f",
    );
  });

  test("replaces a lone surrogate", () => {
    expect(Scalars.encode({ s: "a\ud800" }).toHex()).toBe("720461efbfbd");
  });

  test.each([0, 1, 42, 43, 64, 65, 127, 128, 255, 256, 5461, 5462, 16383, 16384, 70000])(
    "writes the length of %d units",
    length => {
      for (const unit of ["a", "é", "☃"]) {
        const s = Buffer.alloc(length * Buffer.byteLength(unit), unit).toString();
        expect(Lists.decode(Lists.encode({ child: [{ s: [s, "end"] }] })).child[0].s).toEqual([s, "end"]);
      }
      const by = new Uint8Array(length).fill(7);
      const [child] = Lists.decode(Lists.encode({ child: [{ by: [by], expanded: [1] }] })).child;
      expect([Buffer.compare(child.by[0], by), child.expanded]).toEqual([0, [1]]);
    },
  );

  test("writes a length of four bytes", () => {
    const encoded = Lists.encode({ child: [{ by: [new Uint8Array(1 << 21)], expanded: [1] }] });
    expect(encoded.subarray(0, 10).toHex()).toBe("42878080013a80808001");
    expect(Lists.decode(encoded).child[0].expanded).toEqual([1]);
  });

  test("returns bytes that a later call does not change", () => {
    const first = Scalars.encode({ i32: 1 });
    Scalars.encode({ i32: 2 });
    expect(first.toHex()).toBe("1801");
  });

  test("can be entered again from a getter", () => {
    const message = {
      i32: 1,
      get by() {
        return Scalars.encode({ i32: 2 });
      },
    };
    expect(Scalars.encode(message).toHex()).toBe("18017a021802");
  });

  test.each([
    [Scalars, { i32: 2 ** 31 }, "Expected an int32, received 2147483648"],
    [Scalars, { i32: 1.5 }, "Expected an int32, received 1.5"],
    [Scalars, { i32: "1" }, 'Expected an int32, received "1"'],
    [Scalars, { u32: -1 }, "Expected a uint32, received -1"],
    [Scalars, { s32: NaN }, "Expected an int32, received NaN"],
    [Scalars, { i64: 2n ** 63n }, "Expected an int64, received 9223372036854775808n"],
    [Scalars, { i64: 2 ** 53 }, "Expected an int64, received 9007199254740992"],
    [Scalars, { u64: -1n }, "Expected a uint64, received -1n"],
    [Scalars, { d: "1" }, 'Expected a number, received "1"'],
    [Scalars, { b: 1 }, "Expected a boolean, received 1"],
    [Scalars, { s: 1 }, "Expected a string, received 1"],
    [Scalars, { by: [1] }, "Expected a Uint8Array, received object"],
    [Maps, { byInt32: { "01": 1 } }, 'Expected an integer as the key of a map, received "01"'],
    [Maps, { byUint64: { "": "" } }, 'Expected an integer as the key of a map, received ""'],
    [Maps, { byBool: { yes: bytes() } }, 'Expected "true" or "false" as the key of a map, received "yes"'],
    [Choice, { value: { case: "no" } }, 'Expected a case of fixture.v3.Choice.value, received "no"'],
    [Lists, { i32: new Set([1]) }, "Expected an array, received object"],
    [Lists, { s: "abc" }, 'Expected an array, received "abc"'],
    [Lists, { child: [null] }, "Expected a message, received null"],
    [Maps, { byInt32: new Map([[1, 1]]) }, "Expected a plain object, received object"],
    [Maps, { byUint64: "abc" }, 'Expected a plain object, received "abc"'],
    [Outer, { point: "abc" }, 'Expected a message, received "abc"'],
    [names.Symbol, { entries: new Map() }, "Expected a plain object, received object"],
    [names.Empty, undefined, "Expected a message, received undefined"],
    [Required, {}, "Missing required field fixture.v2.Required.id"],
  ] as [any, object, string][])("refuses a value: %#", (type, message, error) => {
    expect(() => type.encode(message)).toThrow(new TypeError(error));
    expect(Scalars.encode({ i32: 1 }).toHex()).toBe("1801");
  });
});

describe("exports", () => {
  test("enums", () => {
    expect(Color).toStrictEqual({ COLOR_UNSPECIFIED: 0, RED: 1, CRIMSON: 1, NEGATIVE: -7 });
  });

  test("import public", () => {
    expect(forwards.Point).toBe(point.Point);
  });

  test("names that JavaScript has a use for", () => {
    expect(names.Object.decode(bytes())).toStrictEqual({
      constructor$: "",
      toString$: "",
      then$: "",
      Proto: "",
      class: "",
      _1: "",
    });
    expect(names.default.encode({ value: { class: "a" } }).toHex()).toBe("0a032a0161");
    expect(names.Uint8Array).toStrictEqual({ toString$: 0 });
    expect([names.A_B.typeName, names.A_B$.typeName]).toEqual(["A_B", "A.B"]);
  });

  test("services", () => {
    expect(Object.getOwnPropertyNames(names.Promise.Client.prototype)).toEqual(["constructor", "client", "channel"]);
    expect(Object.keys(names.Promise.routes({}))).toEqual(["/Promise/Client", "/Promise/Channel"]);
    expect(Object.keys(names.Routes.routes({}))).toEqual(["/Routes/Routes"]);
    expect(names.Names).toMatchObject({
      typeName: "Names",
      methods: {
        getHTTPThing: {
          path: "/Names/GetHTTPThing",
          request: { typeName: "google.protobuf.Empty" },
          response: names.Empty,
          requestStream: false,
          responseStream: false,
        },
        snakeCase: { path: "/Names/snake_case", response: names.A_B$, requestStream: true, responseStream: true },
        then$: { path: "/Names/Then" },
      },
    });
  });
});

describe("a mistake in a schema", () => {
  const proto3 = 'syntax = "proto3";\n';
  test.each([
    [`${proto3}message A { int32 a = 1 }`, 'Expected ";" but found "}"', 2, 25],
    [`${proto3}message A {`, "Expected a type but found end of file", 2, 11],
    [`${proto3}message A { B b = 1; }`, '"B" is not defined', 2, 13],
    [`${proto3}message A { int32 a = 1; int32 b = 1; }`, "Another field has the number 1", 2, 36],
    [`${proto3}message A { int32 a = 1; int32 a = 2; }`, '"a" is already defined', 2, 32],
    [`${proto3}message A {} message A {}`, '"A" is already defined', 2, 22],
    [`${proto3}message A { int32 a = 0; }`, "Expected an integer from 1 to 536870911", 2, 23],
    [`${proto3}message A { int32 a = 19000; }`, "The numbers from 19000 to 19999 are reserved", 2, 23],
    [`${proto3}message A { reserved 1 to 3; int32 a = 2; }`, "The number 2 is reserved", 2, 40],
    [`${proto3}message A { reserved "a"; int32 a = 2; }`, 'The name "a" is reserved', 2, 33],
    [`${proto3}message A { map<double, int32> a = 1; }`, "The key of a map must be", 2, 17],
    [`${proto3}message A { oneof a {} }`, "A oneof must have at least one field", 2, 19],
    [`${proto3}enum A { B = 1; }`, "The first value of an open enum must be 0", 2, 10],
    [`${proto3}enum A { B = 0; C = 0; }`, "Another value has the number 0", 2, 21],
    [`${proto3}enum A { B = 0; } service S { rpc M(A) returns (A); }`, '"A" is not a message', 2, 37],
    [`${proto3}/* `, 'Expected "*/" to end this comment', 2, 1],
    [`${proto3}import "a`, "Unterminated string", 2, 8],
    [`message A { int32 a = 1; }`, 'A file without a "syntax" statement is proto2', 1, 13],
    [`message A { optional int32 a = 1 [default = 2147483648]; }`, "does not match the type of the field", 1, 45],
    [`syntax = "proto4";`, 'Unsupported syntax "proto4"', 1, 10],
    [`edition = "2023"; message A { optional int32 a = 1; }`, "Editions replace this label", 1, 31],
    [Buffer.alloc(11 * 5000, "message A {").toString(), "nested more than 64 levels deep", 1, 713],
  ])("%#", (schema, message, line, column) => {
    let error: any;
    try {
      new Bun.Transpiler().transformSync(schema, "proto");
    } catch (thrown) {
      error = thrown;
    }
    expect(error.message).toContain(message);
    expect(error.position).toMatchObject({ line, column });
  });

  test.concurrent("is shown in the file that has it", async () => {
    const { stderr, exitCode } = await run(
      {
        "main.ts": `import "./a.proto";`,
        "a.proto": `${proto3}import "b.proto";`,
        "b.proto": `${proto3}\nmessage = 1;`,
      },
      "main.ts",
    );
    expect(stderr).toContain("3 | message = 1;");
    expect(stderr).toMatch(/error: Expected .* but found "="\n\s+at .*b\.proto:3:9/);
    expect(exitCode).toBe(1);
  });

  test.concurrent("an import that cannot be read is not looked for further up", async () => {
    const files = {
      "app/a.proto": `${proto3}import "b.proto";`,
      "app/b.proto/file": "",
      "b.proto": proto3,
    };
    const { stderr, exitCode } = await run(files, "-p", `require("./app/a.proto")`);
    expect(stderr).toMatch(/error: Cannot read ".*b\.proto": E[A-Z]+\n\s+at .*a\.proto:2:8/);
    expect(exitCode).toBe(1);
  });

  test.concurrent("names the imports that were not found, if a type is missing", async () => {
    const files = {
      "unused.proto": `${proto3}import "gone.proto"; message A {}`,
      "used.proto": `${proto3}import "gone.proto"; message A { Gone gone = 1; }`,
    };
    expect(await run(files, "-p", `require("./unused.proto").A.typeName`)).toMatchObject({
      stdout: "A\n",
      exitCode: 0,
    });
    const { stderr, exitCode } = await run(files, "-p", `require("./used.proto")`);
    expect(stderr).toContain(
      `"Gone" is not defined. "gone.proto" is not in the directory of this file or in one above`,
    );
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("loading", () => {
  const schema = `syntax = "proto3"; message A { int32 a = 1; }`;

  test("import(), require() and an empty file", async () => {
    const script = `
      const imported = await import("./a.proto");
      console.log(imported.A === require("./a.proto").A, Object.keys(await import("./empty.proto")).length);`;
    expect(await run({ "a.proto": schema, "empty.proto": "", "main.ts": script }, "main.ts")).toEqual({
      stdout: "true 0\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a service without methods", async () => {
    const script = `const { S } = require("./s.proto"); new S.Client("http://a"); JSON.stringify(S.routes({}))`;
    expect(await run({ "s.proto": "service S {}" }, "-p", script)).toEqual({ stdout: "{}\n", stderr: "", exitCode: 0 });
  });

  test("import attributes", async () => {
    const files = {
      "a.proto": "not a schema",
      "b.proto": "not a schema",
      "a.schema": `syntax = "proto3"; import public "b.schema"; message A { int32 a = 1; B b = 2; }`,
      "b.schema": `syntax = "proto3"; message B {}`,
      "main.ts": `
        import text from "./a.proto" with { type: "text" };
        import path from "./b.proto" with { type: "file" };
        import { A } from "./a.schema" with { type: "proto" };
        console.log(text, path.endsWith("b.proto"), A.encode({ a: 1 }).toHex());`,
    };
    expect(await run(files, "main.ts")).toEqual({ stdout: "not a schema true 0801\n", stderr: "", exitCode: 0 });
  });

  test("--loader", async () => {
    const files = {
      "a.proto": "not a schema",
      "a.schema": schema,
      "main.ts": `import text from "./a.proto"; import { A } from "./a.schema"; console.log(text, A.typeName);`,
    };
    expect(await run(files, "--loader=.proto:text", "--loader=.schema:proto", "main.ts")).toEqual({
      stdout: "not a schema A\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a plugin", async () => {
    const script = `
      Bun.plugin({
        setup(build) {
          build.onResolve({ filter: /.*/, namespace: "schema" }, ({ path }) => ({ path, namespace: "schema" }));
          build.onLoad({ filter: /.*/, namespace: "schema" }, () => ({ contents: ${JSON.stringify(schema)}, loader: "proto" }));
        },
      });
      console.log((await import("schema:a")).A.typeName);`;
    expect(await run({ "main.ts": script }, "main.ts")).toEqual({ stdout: "A\n", stderr: "", exitCode: 0 });
  });

  test("an import is looked up from the directory of the file upwards, before the well-known types", async () => {
    const files = {
      "protos/app/v1/a.proto": `syntax = "proto3";
        import "common/b.proto"; import "c.proto"; import "google/protobuf/empty.proto";
        message A { B b = 1; C c = 2; google.protobuf.Empty e = 3; }`,
      "protos/app/v1/c.proto": `syntax = "proto3"; message C { int32 near = 1; }`,
      "protos/c.proto": `syntax = "proto3"; message C { int32 far = 1; }`,
      "protos/common/b.proto": `syntax = "proto3"; message B { int32 b = 1; }`,
      "protos/google/protobuf/empty.proto": `syntax = "proto3"; package google.protobuf; message Empty { int32 own = 1; }`,
    };
    const script = `JSON.stringify(require("./protos/app/v1/a.proto").A.decode(Uint8Array.fromHex("0a0012001a00")))`;
    expect(await run(files, "-p", script)).toEqual({
      stdout: `{"b":{"b":0},"c":{"near":0},"e":{"own":0}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("two files can use one name in different packages", async () => {
    const files = {
      "a.proto": `syntax = "proto3"; package a; import "b.proto"; message M { b.M other = 1; M self = 2; }`,
      "b.proto": `syntax = "proto3"; package b; message M { int32 n = 1; }`,
    };
    const script = `require("./a.proto").M.encode({ other: { n: 1 }, self: { other: {} } }).toHex()`;
    expect(await run(files, "-p", script)).toEqual({ stdout: "0a02080112020a00\n", stderr: "", exitCode: 0 });
  });

  test("--watch sees the fix of a mistake in an imported file", async () => {
    using dir = tempDir("proto-watch", {
      "main.ts": `import { A } from "./a.proto"; console.log(A.typeName);`,
      "a.proto": `syntax = "proto3"; import "b.proto"; message A { B b = 1; }`,
      "b.proto": `syntax = "proto3"; message B {`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--watch", "--no-clear-screen", "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    let stderr = "";
    for await (const chunk of proc.stderr) {
      stderr += Buffer.from(chunk);
      if (stderr.includes("b.proto:1")) break;
    }
    await Bun.write(join(String(dir), "b.proto"), `syntax = "proto3"; message B {}`);
    const { value } = await proc.stdout.getReader().read();
    expect(Buffer.from(value!).toString()).toBe("A\n");
  });

  test("a change to an imported file is not hidden by the transpiler cache", async () => {
    const fields = Array.from({ length: 400 }, (_, i) => `repeated string s${i} = ${i + 2};`).join("\n");
    using dir = tempDir("proto-cache", {
      "a.proto": `syntax = "proto2"; import "b.proto"; message A { optional B b = 1; ${fields} }`,
    });
    const results: string[] = [];
    for (const declaration of ["enum B { X = 1; }", "enum B { X = 1; Y = 2; }"]) {
      await Bun.write(join(String(dir), "b.proto"), `syntax = "proto2"; ${declaration}`);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-p", `require("./a.proto").A.decode(new Uint8Array([8, 2])).b`],
        env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), "cache") },
        cwd: String(dir),
      });
      results.push(await proc.stdout.text());
    }
    expect(results).toEqual(["undefined\n", "2\n"]);
  });
});
