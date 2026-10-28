import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { join } from "node:path";
import { run } from "../../../aot/harness/run";

// The text after "Received" in an ERR_INVALID_ARG_TYPE message follows determineSpecificType() in Node's
// lib/internal/errors.js: it reads value.constructor.name, and falls back to util.inspect(value, { depth: -1 }).
function received(value: unknown): string {
  const prefix = 'The "buf1" argument must be an instance of Buffer or Uint8Array. Received ';
  try {
    Buffer.compare(value as Buffer, Buffer.alloc(1));
  } catch (error: any) {
    expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(error.message).toStartWith(prefix);
    return error.message.slice(prefix.length);
  }
  throw new Error("Buffer.compare() did not throw");
}

class Foo {}
class Bar extends Foo {}

test.each([
  [new Foo(), "an instance of Foo"],
  [new Bar(), "an instance of Bar"],
  [new (class {})(), "an instance of "],
  [new (Object.defineProperty(class Declared {}, "name", { value: "Stored" }))(), "an instance of Stored"],
  [{}, "an instance of Object"],
  [[], "an instance of Array"],
  [new Map(), "an instance of Map"],
  [[].values(), "an instance of Iterator"],
  [new URL("http://example.com/"), "an instance of URL"],
  [Object.create(URL.prototype), "an instance of URL"],
  [new Headers(), "an instance of Headers"],
  [{ constructor: Foo }, "an instance of Foo"],
  [{ constructor: { name: "Fake" } }, "an instance of Fake"],
  [Object.create({ constructor: Bar }), "an instance of Bar"],
  [Object.create(null), "[Object: null prototype] {}"],
])("object %#", (value, expected) => {
  expect(received(value)).toBe(expected);
});

test.each([
  [function foo() {}, "function foo"],
  [Foo, "function Foo"],
  ["abc", "type string ('abc')"],
  ["it's", 'type string ("it\'s")'],
  [Buffer.alloc(40, "a").toString(), "type string ('aaaaaaaaaaaaaaaaaaaaaaaaa...')"],
  [1, "type number (1)"],
  [NaN, "type number (NaN)"],
  [true, "type boolean (true)"],
  [1n, "type bigint (1n)"],
  [Symbol("s"), "type symbol (Symbol(s))"],
  [null, "null"],
  [undefined, "undefined"],
])("function or primitive %#", (value, expected) => {
  expect(received(value)).toBe(expected);
});

// Node runs code of the program while it describes a rejected argument: a getter, a proxy trap, a custom inspect
// function. So does Bun. These lines are what Node prints for the program. An executable built with `bun compile` runs
// none of that code: what it prints is beside the program, in rejected-argument-description.expected.txt.
test("describing a rejected argument runs the program's code where Node runs it", async () => {
  const program = join(import.meta.dir, "../../../aot/programs/builtin-modules/rejected-argument-description.ts");
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", program]);
  const wrongType = 'ERR_INVALID_ARG_TYPE: The "buf1" argument must be an instance of Buffer or Uint8Array. Received ';
  const wrongValue = "ERR_INVALID_ARG_VALUE: The argument 'flags' is invalid. Received ";
  expect({ lines: stdout.split("\n"), stderr, exitCode }).toEqual({
    lines: [
      wrongType + "an instance of Point | ran nothing",
      wrongType + "an instance of  | ran nothing",
      wrongType + "an instance of Object | ran nothing",
      wrongType + "an instance of Array | ran nothing",
      wrongType + "[Object: null prototype] {} | ran nothing",
      wrongType + "an instance of Point | ran code of the program",
      wrongType + "an instance of Point | ran code of the program",
      wrongType + "an instance of Computed | ran code of the program",
      wrongType + "an instance of Array | ran nothing",
      wrongType + "an instance of Point | ran code of the program",
      wrongType + "CUSTOM | ran code of the program",
      wrongValue + "{} | ran nothing",
      wrongValue + "[] | ran nothing",
      wrongValue + "{ a: 1 } | ran nothing",
      wrongValue + "[ 1, 2 ] | ran nothing",
      wrongValue + "Point { x: 1, y: 2 } | ran nothing",
      wrongValue + "{ point: Point { x: 1, y: 2 }, list: [ 1, [ 2 ] ] } | ran nothing",
      wrongValue + "{ a: [Getter], b: 2 } | ran nothing",
      wrongValue + "CUSTOM | ran code of the program",
      wrongValue + "CUSTOM | ran code of the program",
      wrongValue + "{ a: 1 } | ran nothing",
      wrongValue + "1970-01-01T00:00:00.000Z | ran nothing",
      wrongValue + "/x/g | ran nothing",
      wrongValue + "Uint8Array(2) [ 1, 2 ] | ran nothing",
      wrongValue + "{ when: 1970-01-01T00:00:00.000Z, list: [ /x/g ] } | ran nothing",
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
});
