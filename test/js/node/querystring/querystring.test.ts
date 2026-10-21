import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import qs from "node:querystring";
import nodeResults from "./querystring-node-results.json";

const serialize = (result: object) =>
  JSON.stringify(result) + "|" + Object.keys(result).join("\u0001") + "|" + (Object.getPrototypeOf(result) === null);

function plain(result: object) {
  return JSON.parse(JSON.stringify(result));
}

describe("querystring.parse", () => {
  // querystring-node-results.json is the output of querystring-node-oracle.mjs
  // under node v26.12.0: an edge matrix, the maxKeys forms, and 800 seeded
  // inputs in the default form, with { maxKeys } and with (input, null, null).
  test(`matches node ${nodeResults.version} on every oracle input`, () => {
    expect(nodeResults.results.length).toBeGreaterThan(800);
    const mismatches: string[] = [];
    for (const { input, sep, eq, options, expected } of nodeResults.results) {
      const opts =
        options && typeof options.maxKeys === "string"
          ? { ...options, maxKeys: Number(options.maxKeys.slice(1)) }
          : options;
      const actual = serialize(qs.parse(input, sep, eq, opts));
      if (actual !== expected) {
        mismatches.push(
          `parse(${JSON.stringify(input)}, ${sep}, ${eq}, ${JSON.stringify(opts)})\n  bun:  ${actual}\n  node: ${expected}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("a malformed escape in the value does not inherit the key's decoding (nodejs/node#66553)", () => {
    const expected = { "\u00e4": "caf\u00e9%" };
    expect(plain(qs.parse("%C3%A4=caf\u00e9%"))).toEqual(expected);
    expect(plain(qs.parse("%C3%A4=caf\u00e9%", undefined, undefined, { maxKeys: 1000 }))).toEqual(expected);
    expect(plain(qs.parse("%C3%A4=caf\u00e9%", null, null))).toEqual(expected);
    expect(plain(qs.parse("%C3%A4=caf\u00e9%", "&", "="))).toEqual(expected);
    expect(plain(qs.parse("%41%42=%zz\u4e2d"))).toEqual({ AB: "%zz\u4e2d" });
  });

  test("a sliced or concatenated input parses the same as a flat one", () => {
    const url = "https://example.com/path?X-Amz-Expires=900&versionId=abc&x-id=GetObject&e=%41%42";
    const expected = { "X-Amz-Expires": "900", versionId: "abc", "x-id": "GetObject", e: "AB" };
    expect(plain(qs.parse(url.slice(url.indexOf("?") + 1)))).toEqual(expected);
    expect(plain(qs.parse(url.split("?")[1]))).toEqual(expected);
    let rope = "";
    for (const part of ["X-Amz-Expires=900&", "versionId=", "abc&x-id=", "GetObject&e=%41%42"]) rope += part;
    expect(plain(qs.parse(rope))).toEqual(expected);
    expect(plain(qs.parse(url.substring(25, 60)))).toEqual({ "X-Amz-Expires": "900", versionId: "abc", "x-i": "" });
  });

  test("maxKeys stops the work at the last counted pair", () => {
    const tail = "&" + Buffer.alloc(100000, "%zz&").toString();
    expect(plain(qs.parse("a=1&b=2" + tail, undefined, undefined, { maxKeys: 2 }))).toEqual({ a: "1", b: "2" });
    expect(plain(qs.parse("a=%41&b=2" + tail, undefined, undefined, { maxKeys: 3 }))).toEqual({
      a: "A",
      b: "2",
      "%zz": "",
    });
  });

  test("__proto__ is an own property", () => {
    const result = qs.parse("__proto__=1&a=2");
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(null);
  });

  test("the default parser and the generic loop (explicit '&' and '=') agree", () => {
    // The explicit separators take the generic loop. The default takes the fast path.
    let seed = 20261019;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8;
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
    expect(plain(qs.parse("&&a=b&c=d", undefined, undefined, { maxKeys: 2 }))).toEqual({});
    expect(plain(qs.parse("&&a=b&c=d", undefined, undefined, { maxKeys: 3 }))).toEqual({ a: "b" });
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

  test.concurrent("parse ignores a patched global decodeURIComponent, the same as Node", async () => {
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

  test.concurrent("the default form allocates one string per value and none per key", async () => {
    // The generic loop also slices a key string per pair. This tells the
    // native parser apart from the loop, which produce the same values.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { heapStats } from "bun:jsc";
         const qs = require("node:querystring");
         const q3 = "X-Amz-Expires=900&versionId=abc&x-id=GetObject";
         const keep = [];
         for (let i = 0; i < 200; i++) keep.push(qs.parse(q3));
         Bun.gc(true);
         const before = heapStats().objectTypeCounts.string;
         for (let i = 0; i < 1000; i++) keep.push(qs.parse(q3));
         const after = heapStats().objectTypeCounts.string;
         console.log(keep.length, (after - before) / 1000);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const [kept, stringsPerCall] = stdout.trim().split(" ").map(Number);
    expect(kept).toBe(1200);
    expect(stringsPerCall).toBeLessThanOrEqual(4);
    expect(exitCode).toBe(0);
  });

  test("decode is parse", () => {
    expect(qs.decode).toBe(qs.parse);
  });
});

describe("querystring.unescape", () => {
  // qs.unescape is decodeURIComponent with the unescapeBuffer fallback. The
  // decoder is native, so pin it to the engine's decodeURIComponent.
  function reference(s: string) {
    try {
      return decodeURIComponent(s);
    } catch {
      return qs.unescapeBuffer(s).toString();
    }
  }

  test("matches decodeURIComponent with the unescapeBuffer fallback", () => {
    const inputs: string[] = [];
    for (let byte = 0; byte < 256; byte++) {
      const hex = byte.toString(16).padStart(2, "0");
      inputs.push(`%${hex.toUpperCase()}\u4e2d`, `%${hex}\u00e9`, `a%${hex}`);
    }
    inputs.push(
      "%C0%80",
      "%C1%BF",
      "%E0%80%80",
      "%E0%9F%BF",
      "%ED%A0%80",
      "%ED%BF%BF",
      "%F0%80%80%80",
      "%F0%8F%BF%BF",
      "%F4%90%80%80",
      "%F5%80%80%80",
      "%F8%80%80%80%80",
      "%FF",
      "%80",
      "%BF",
      "%E4%B8%41",
      "%E4%B8",
      "%E4",
      "%F0%9F%98",
      "%u0041",
      "%u00e9",
      "%",
      "%4",
      "%4G",
      "%G4",
      "a+b",
      "a%20b",
      "%2B",
      "%25",
      "%2525",
      "%E4%B8%AD",
      "%e4%b8%ad",
      "%F0%9F%98%80",
      "%f0%9f%98%80",
      "%F4%8F%BF%BF",
      "%F0%90%80%80",
      "%EF%BF%BD",
      "\ud800%41",
      "%41\udc00",
      "\u00e9%E4",
      "\u4e2d%zz",
    );
    let seed = 7;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8;
    const pieces = [
      "%",
      "%4",
      "%41",
      "%E4",
      "%B8",
      "%AD",
      "%F0",
      "%9F",
      "%98",
      "%80",
      "%ED",
      "%A0",
      "%C0",
      "%zz",
      "a",
      "+",
      "\u00e9",
      "\u4e2d",
      "\ud83d",
      "\ude00",
    ];
    for (let i = 0; i < 3000; i++) {
      const length = rand() % 6;
      let input = "";
      for (let j = 0; j < length; j++) input += pieces[rand() % pieces.length];
      inputs.push(input);
    }
    const mismatches: string[] = [];
    for (const input of inputs) {
      const actual = qs.unescape(input);
      const expected = reference(input);
      if (actual !== expected) {
        mismatches.push(`${JSON.stringify(input)}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("decodeSpaces applies to the fallback only, as in Node", () => {
    expect(qs.unescape("a+b", true)).toBe("a+b");
    expect(qs.unescape("a+b%zz", true)).toBe("a b%zz");
    expect(qs.unescape("a+b%zz")).toBe("a+b%zz");
    expect(qs.unescape(123 as any)).toBe("123");
  });
});
