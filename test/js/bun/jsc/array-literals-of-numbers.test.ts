import { describe, expect, test } from "bun:test";
import { runInThisContext } from "node:vm";

// A long run of integers and nulls in an array literal is read as values. Nothing around the run, and nothing that ends it, may show that.
const indirect = eval;
const lengths = [0, 1, 2, 31, 32, 33, 34, 35, 64, 959, 960, 961, 991, 992, 993, 994, 1952, 1953, 1954, 3000];
const element = (index: number): number | null => (index % 97 === 13 ? null : (index * 7919) % 10 ** (1 + (index % 7)));
const elements = (length: number) => Array.from({ length }, (_, index) => element(index));
const literal = (values: unknown[]) => `[${values.map(String).join(",")}]`;
const run = (length: number) => elements(length).map(String).join(",");

describe.each(lengths)("a literal of %d integers and nulls", length => {
  const expected = elements(length);
  const text = literal(expected);

  test("has its elements wherever it stands", () => {
    expect(indirect(text)).toEqual(expected);
    expect(new Function(`return ${text}`)()).toEqual(expected);
    expect(indirect(`(${text}).length`)).toBe(length);
    expect(indirect(`((...list) => list)(...${text})`)).toEqual(expected);
    expect(indirect(`(function () { return Array.from(arguments); }).apply(null, ${text})`)).toEqual(expected);
    expect(indirect(`Reflect.construct(class { constructor(...list) { this.list = list; } }, ${text}).list`)).toEqual(
      expected,
    );
    expect(indirect(`[${text}, ${text}]`)).toEqual([expected, expected]);
    expect(indirect(`[...${text}, 1, ...${text}]`)).toEqual([...expected, 1, ...expected]);
  });

  test("is another array each time", () => {
    const make = new Function(`return ${text}`);
    const changed = make();
    changed.push("more");
    changed[0] = "changed";
    expect(make()).toEqual(expected);
  });
});

test.each([
  "0",
  "9",
  "10",
  "9999999",
  "10000000",
  "99999999",
  "2147483647",
  "2147483648",
  "4294967295",
  "4294967296",
  "999999999999999",
  "1000000000000000",
  "9007199254740991",
  "9007199254740993",
  "123456789012345678901",
])("%s behind a run", text => {
  for (const before of [31, 32, 33, 959, 960, 961, 992]) {
    const result = indirect(`[${run(before)},${text},1,null,${text}]`);
    expect(result.length).toBe(before + 4);
    expect([result[before], result[before + 1], result[before + 2], result[before + 3]]).toEqual([
      Number(text),
      1,
      null,
      Number(text),
    ]);
  }
});

test.each([
  ["-0", -0],
  ["-1", -1],
  ["1.5", 1.5],
  ["0.5", 0.5],
  ["5.", 5],
  [".5", 0.5],
  ["12e3", 12000],
  ["1e400", Infinity],
  ["0x10", 16],
  ["1_000", 1000],
  ["017", 15],
  ["089", 89],
  ["7n", 7n],
  ["NaN", NaN],
  ["nullish", "variable"],
  ["undefined", undefined],
  ["'text'", "text"],
  ["[1,2]", [1, 2]],
  ["/* , ] */ 8", 8],
  ["8 // ]\n", 8],
  ["\n8", 8],
  ["8 + 1", 9],
  ["null ?? 4", 4],
  ["null\n", null],
])("%j in a run", (text, value) => {
  for (const length of [33, 40, 960, 1000, 2000])
    for (const at of [0, 1, 31, 32, 33, length - 1, length]) {
      const values: unknown[] = elements(length);
      values.splice(at, 0, text);
      const result = new Function("nullish", `return ${literal(values)}`)("variable");
      expect(result.length).toBe(length + 1);
      // toBe() tells -0 from 0.
      if (typeof value === "object" && value) expect(result[at]).toEqual(value);
      else expect(result[at]).toBe(value);
      result.splice(at, 1);
      expect(result).toEqual(elements(length));
    }
});

test("holes, trailing commas and spreads in, before and behind a run", () => {
  for (const length of [32, 33, 34, 960, 961, 1500]) {
    const expected = elements(length);
    for (const at of [0, 1, 32, length]) {
      const before = expected.slice(0, at);
      const after = expected.slice(at);
      const holed = indirect(`[${before.map(value => `${value},`).join("")},${after.map(String).join(",")}]`);
      expect(holed.length).toBe(length + 1);
      expect(at in holed).toBe(false);
      holed.splice(at, 1);
      expect(holed).toEqual(expected);
      expect(indirect(literal([...before, "...[1,2]", ...after]))).toEqual([...before, 1, 2, ...after]);
    }
    expect(indirect(`[${run(length)},]`)).toEqual(expected);
    expect(indirect(literal(["...[]", ...expected]))).toEqual(expected);
    expect(indirect(literal([...expected, "...[]"]))).toEqual(expected);
  }
});

test("syntax errors in and behind a run, and their lines", () => {
  const told = (text: string) => {
    try {
      runInThisContext(text, { filename: "run.js" });
      return "no error";
    } catch (error: any) {
      return `${error.message} | ${/run\.js:(\d+)/.exec(error.stack)?.[1]}`;
    }
  };
  const texts = (list: string) => [
    `\n[${list},`,
    `\n[${list},1 2]`,
    `\n\n[${list},1)]`,
    `\n[${list},3in]`,
    `"use strict";\n[${list},017]`,
    `\n([${list}] = 1)`,
    `\n[${list}]++`,
    `\nvar read = [${list}];\nread.x.y`,
    `[${list}];\n\nnull.x`,
    `[${list},\n1,2,\n3 4]`,
  ];
  const short = texts("1,2").map(told);
  expect(short).toEqual([
    "Unexpected end of script | 2",
    "Unexpected number '2'. Expected either a closing ']' or a ',' following an array element. | 2",
    "Unexpected token ')'. Expected either a closing ']' or a ',' following an array element. | 3",
    "No identifiers allowed directly after numeric literal | 2",
    "Decimal integer literals with a leading zero are forbidden in strict mode | 2",
    "Invalid destructuring assignment target. | 2",
    "Postfix ++ operator applied to value that is not a reference. | 2",
    "undefined is not an object (evaluating 'read.x.y') | 3",
    "null is not an object (evaluating 'null.x') | 3",
    "Unexpected number '4'. Expected either a closing ']' or a ',' following an array element. | 3",
  ]);
  for (const length of [33, 960, 1000, 2500]) expect(texts(run(length)).map(told)).toEqual(short);
});

test("functions with runs show their text, and directives count", () => {
  const list = run(1100);
  const text = `function named(a = [${list}]) { return [${list}, a.length, this === undefined]; }`;
  const named = indirect(`(${text})`);
  expect(named.toString()).toBe(text);
  expect(named().slice(-2)).toEqual([1100, false]);
  expect(indirect(`(function () { "use strict"; return [${list}, this === undefined]; })()`).at(-1)).toBe(true);
  expect(indirect(`(() => [${list}])`).toString()).toBe(`() => [${list}]`);
  expect(indirect(`(function () { const [a, , b = 5, ...rest] = [${list}]; return [a, b, rest.length]; })()`)).toEqual([
    element(0),
    element(2),
    1097,
  ]);
});
