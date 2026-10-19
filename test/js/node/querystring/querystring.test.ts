import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import qs from "node:querystring";

// [input, Node's parse result, Node's key order]. Generated with node v26.
// Inputs with a malformed escape take the unescapeBuffer fallback, which writes
// each UTF-16 unit into a byte, so "\u4e2d" becomes "-" (0x2d) there.
const nodeParseResults: [string, Record<string, string | string[]>, string[]][] = [
  ["__proto__=1", JSON.parse('{"__proto__":"1"}'), ["__proto__"]],
  ["foo=bar&foo=quux", { foo: ["bar", "quux"] }, ["foo"]],
  ["my+weird+field=q1%212%22%27w%245%267%2Fz8%29%3F", { "my weird field": "q1!2\"'w$5&7/z8)?" }, ["my weird field"]],
  ["foo=baz=bar", { foo: "baz=bar" }, ["foo"]],
  [
    "str=foo&arr=1&arr=2&arr=3&somenull=&undef=",
    { str: "foo", arr: ["1", "2", "3"], somenull: "", undef: "" },
    ["str", "arr", "somenull", "undef"],
  ],
  ["foo=%zx", { foo: "%zx" }, ["foo"]],
  ["foo=%EF%BF%BD", { foo: "\ufffd" }, ["foo"]],
  ["foo&bar=baz", { foo: "", bar: "baz" }, ["foo", "bar"]],
  ["a=b&=c&d=e", { a: "b", "": "c", d: "e" }, ["a", "", "d"]],
  ["&&foo=bar&&", { foo: "bar" }, ["foo"]],
  ["&=&=", { "": ["", ""] }, [""]],
  ["=", { "": "" }, [""]],
  ["+", { " ": "" }, [" "]],
  ["=+", { "": " " }, [""]],
  ["a+&", { "a ": "" }, ["a "]],
  ["=%20+&", { "": "  " }, [""]],
  ["a=%E4\u00e9", { a: "\ufffd\ufffd" }, ["a"]],
  ["%2sf%2a\u4e2d", { "%2sf*-": "" }, ["%2sf*-"]],
  ["a=%zz\u4e2d", { a: "%zz\u4e2d" }, ["a"]],
  ["a=%2+0\u4e2d", { a: "%2 0-" }, ["a"]],
  ["%2+0\u4e2d=1", { "%2 0\u4e2d": "1" }, ["%2 0\u4e2d"]],
  ["%", { "%": "" }, ["%"]],
  ["q=100%", { q: "100%" }, ["q"]],
  ["%E2%82", { "\ufffd": "" }, ["\ufffd"]],
  ["%ED%A0%80", { "\ufffd\ufffd\ufffd": "" }, ["\ufffd\ufffd\ufffd"]],
  ["%C0%80", { "\ufffd\ufffd": "" }, ["\ufffd\ufffd"]],
  ["a=\ud800", { a: "\ud800" }, ["a"]],
  ["a=\ud800%41", { a: "\ud800A" }, ["a"]],
  ["0=1", { "0": "1" }, ["0"]],
  ["0=a&0=b", { "0": ["a", "b"] }, ["0"]],
  ["1=a&0=b&x=y", { "0": "b", "1": "a", x: "y" }, ["0", "1", "x"]],
  ["a=b&", { a: "b" }, ["a"]],
  ["%41%42=%zz\u4e2d", { AB: "%zz-" }, ["AB"]],
  ["%41%42=100%", { AB: "100%" }, ["AB"]],
  ["a=%F0%9F%98%80&b=%E4%B8%AD%E6%96%87", { a: "\ud83d\ude00", b: "\u4e2d\u6587" }, ["a", "b"]],
  ["a=%F4%90%80%80", { a: "\ufffd\ufffd\ufffd\ufffd" }, ["a"]],
  ["a=%E0%9F%BF", { a: "\ufffd\ufffd\ufffd" }, ["a"]],
  ["x=%2G", { x: "%2G" }, ["x"]],
  ["x=%", { x: "%" }, ["x"]],
  ["x=%4", { x: "%4" }, ["x"]],
  ["4294967295=a", { "4294967295": "a" }, ["4294967295"]],
  ["4294967294=a", { "4294967294": "a" }, ["4294967294"]],
  ["01=a", { "01": "a" }, ["01"]],
  ["a=b&a=c&a=d", { a: ["b", "c", "d"] }, ["a"]],
  ["k%E4%B8%AD=v&k%E4%B8%AD=w", { "k\u4e2d": ["v", "w"] }, ["k\u4e2d"]],
  ["\u00e9=\u00e9&\u00e9=x", { "\u00e9": ["\u00e9", "x"] }, ["\u00e9"]],
  ["a%2Bb=c%2Bd", { "a+b": "c+d" }, ["a+b"]],
];

function plain(result: object) {
  return JSON.parse(JSON.stringify(result));
}

describe("querystring.parse", () => {
  test.each(nodeParseResults)("parse(%j) matches Node", (input, expected, keys) => {
    const result = qs.parse(input);
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(plain(result)).toEqual(expected);
    expect(Object.keys(result)).toEqual(keys);
  });

  test("__proto__ is an own property", () => {
    const result = qs.parse("__proto__=1&a=2");
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(null);
  });

  test("the default parser and the generic loop (explicit '&' and '=') agree", () => {
    // The explicit separators take the generic loop. The default takes the fast path.
    let seed = 20261019;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const alphabet = [
      "a",
      "b",
      "z",
      "0",
      "1",
      "9",
      "A",
      "F",
      "f",
      "%",
      "%",
      "%",
      "&",
      "&",
      "=",
      "=",
      "+",
      "+",
      "\u00e9",
      "\u4e2d",
      "\ud83d",
      "\ude00",
      "\ud83d\ude00",
      "%41",
      "%E4%B8%AD",
      "%F0%9F%98%80",
      "%ED%A0%80",
      "%C0%80",
      "%2",
      "%zz",
      "__proto__",
      "4",
      "12",
      " ",
    ];
    const serialize = (r: object) =>
      JSON.stringify(r) + "|" + Object.keys(r).join("\u0001") + "|" + (Object.getPrototypeOf(r) === null);
    for (let i = 0; i < 2000; i++) {
      const length = rand() % 12;
      let input = "";
      for (let j = 0; j < length; j++) input += alphabet[rand() % alphabet.length];
      const options = rand() % 4 === 0 ? { maxKeys: rand() % 4 } : undefined;
      const fast = serialize(qs.parse(input, undefined, undefined, options));
      const loop = serialize(qs.parse(input, "&", "=", options));
      if (fast !== loop) {
        throw new Error(`parse(${JSON.stringify(input)}, ${JSON.stringify(options)}): ${fast} !== ${loop}`);
      }
    }
  });

  test("maxKeys counts every '&', the same as Node", () => {
    expect(plain(qs.parse("a=1&b=1&c=1", undefined, undefined, { maxKeys: 1 }))).toEqual({ a: "1" });
    expect(plain(qs.parse("a=1&b=1&c=1", undefined, undefined, { maxKeys: 2 }))).toEqual({ a: "1", b: "1" });
    expect(plain(qs.parse("&a", undefined, undefined, { maxKeys: 1 }))).toEqual({});
    expect(plain(qs.parse("&&a=b&c=d", undefined, undefined, { maxKeys: 2 }))).toEqual({});
    expect(plain(qs.parse("&&a=b&c=d", undefined, undefined, { maxKeys: 3 }))).toEqual({ a: "b" });
    expect(plain(qs.parse("a=1&a=2&a=3&b=4", undefined, undefined, { maxKeys: 3 }))).toEqual({ a: ["1", "2", "3"] });
    for (const maxKeys of [0, -1, 1.5, Infinity, NaN, 2 ** 33]) {
      expect(plain(qs.parse("a=1&b=1&c=1", undefined, undefined, { maxKeys }))).toEqual({ a: "1", b: "1", c: "1" });
    }
    const many = Array.from({ length: 1200 }, (_, i) => `k${i}=${i}`).join("&");
    expect(Object.keys(qs.parse(many)).length).toBe(1000);
    expect(Object.keys(qs.parse(many, undefined, undefined, { maxKeys: 0 })).length).toBe(1200);
  });

  test("a custom decodeURIComponent option gets '+' as %20", () => {
    const seen: string[] = [];
    const result = qs.parse("a+b=c+d&e=%41", undefined, undefined, {
      decodeURIComponent: (s: string) => {
        seen.push(s);
        return s.toUpperCase();
      },
    });
    expect(seen).toEqual(["a%20b", "c%20d", "e", "%41"]);
    expect(plain(result)).toEqual({ "A%20B": "C%20D", E: "%41" });
  });

  test("a patched querystring.unescape is used", () => {
    const original = qs.unescape;
    try {
      qs.unescape = (s: string) => `[${s}]`;
      expect(plain(qs.parse("a%41=b%42"))).toEqual({ "[a%41]": "[b%42]" });
    } finally {
      qs.unescape = original;
    }
    expect(plain(qs.parse("a%41=b%42"))).toEqual({ aA: "bB" });
  });

  test("parse ignores a patched global decodeURIComponent, the same as Node", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `globalThis.decodeURIComponent = () => "patched";
         const qs = require("node:querystring");
         console.log(JSON.stringify([qs.parse("a=%41"), qs.parse("a=%41%zz"), qs.unescape("%42")]));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(JSON.stringify([{ a: "A" }, { a: "A%zz" }, "B"]));
    expect(exitCode).toBe(0);
  });

  test("decode is parse", () => {
    expect(qs.decode).toBe(qs.parse);
  });
});
