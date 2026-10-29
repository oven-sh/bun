const { iniInternals } = require("bun:internal-for-testing");
const { parse } = iniInternals;
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";

function numbered(count: number, text: (i: number) => string) {
  let all = "";
  for (let i = 0; i < count; i++) all += text(i);
  return all;
}

describe("parse ini", () => {
  test("weird section", () => {
    const ini = /* ini */ `
[foo\\]]
lol = true
`;

    expect(parse(ini)).toEqual({ "[foo\\]]": true, "lol": true });
  });

  test("really long input", () => {
    const ini = /* ini */ `
[${Array(1024).fill("a").join("")}.lol.this.be.long]
wow = 'hi'
`;

    expect(parse(ini)).toEqual({
      [`${Array(1024).fill("a").join("")}`]: {
        lol: {
          this: {
            be: {
              long: {
                wow: "hi",
              },
            },
          },
        },
      },
    });
  });
  describe("env vars", () => {
    // Tests translated from npm's workspaces/config/test/env-replace.js
    envVarTest({
      name: "replaces multiple defined variables",
      ini: "hi = ${FOO}${BAR}",
      env: { FOO: "bar", BAR: "baz" },
      expected: { hi: "barbaz" },
    });

    envVarTest({
      name: "replaces mixed defined/undefined variables with ? modifier",
      ini: "hi = ${FOO?}${BAZ?}",
      env: { FOO: "bar" },
      expected: { hi: "bar" },
    });

    envVarTest({
      name: "escapes normal variable",
      ini: "hi = \\${FOO}",
      env: { FOO: "bar" },
      expected: { hi: "${FOO}" },
    });

    envVarTest({
      name: "double escape allows replacement",
      ini: "hi = \\\\${FOO}",
      env: { FOO: "bar" },
      expected: { hi: "\\bar" },
    });

    envVarTest({
      name: "triple escape prevents replacement",
      ini: "hi = \\\\\\${FOO}",
      env: { FOO: "bar" },
      expected: { hi: "\\${FOO}" },
    });

    envVarTest({
      name: "leaves undefined variable unreplaced",
      ini: "hi = ${BAZ}",
      env: { FOO: "bar" },
      expected: { hi: "${BAZ}" },
    });

    envVarTest({
      name: "escapes undefined variable",
      ini: "hi = \\${BAZ}",
      env: { FOO: "bar" },
      expected: { hi: "${BAZ}" },
    });

    envVarTest({
      name: "double escape with undefined variable",
      ini: "hi = \\\\${BAZ}",
      env: { FOO: "bar" },
      expected: { hi: "\\${BAZ}" },
    });

    envVarTest({
      name: "escapes optional variable",
      ini: "hi = \\${FOO?}",
      env: { FOO: "bar" },
      expected: { hi: "${FOO?}" },
    });

    envVarTest({
      name: "double escape allows optional replacement",
      ini: "hi = \\\\${FOO?}",
      env: { FOO: "bar" },
      expected: { hi: "\\bar" },
    });

    envVarTest({
      name: "replaces undefined variable with empty string when using ? modifier",
      ini: "hi = ${BAZ?}",
      env: { FOO: "bar" },
      expected: { hi: "" },
    });

    envVarTest({
      name: "escapes undefined optional variable",
      ini: "hi = \\${BAZ?}",
      env: { FOO: "bar" },
      expected: { hi: "${BAZ?}" },
    });

    envVarTest({
      name: "double escape with undefined optional variable results in empty replacement",
      ini: "hi = \\\\${BAZ?}",
      env: { FOO: "bar" },
      expected: { hi: "\\" },
    });

    // Original bun tests
    envVarTest({
      name: "escaped",
      ini: "hi = \\${NODE_ENV}",
      env: { NODE_ENV: "production" },
      expected: { hi: "${NODE_ENV}" },
    });

    envVarTest({
      name: "escaped2",
      ini: "hi = \\\\${NODE_ENV}",
      env: { NODE_ENV: "production" },
      expected: { hi: "\\production" },
    });

    envVarTest({
      name: "backslashes",
      ini: "filepath=C:\\Home\\someuser\\My Documents\nfilepath2=\\\\\\\\TwoBackslashes",
      env: {},
      expected: { filepath: "C:\\Home\\someuser\\My Documents", filepath2: "\\\\TwoBackslashes" },
    });

    envVarTest({
      name: "basic",
      ini: /* ini */ `
hello = \${LOL}
      `,
      env: { LOL: "hi" },
      expected: { hello: "hi" },
    });

    envVarTest({
      name: "no val",
      ini: /* ini */ `
hello = \${oooooooooooooooogaboga}
      `,
      env: {},
      expected: { hello: "${oooooooooooooooogaboga}" },
    });

    envVarTest({
      name: "concat",
      ini: /* ini */ `
hello = greeting: \${LOL}
      `,
      env: { LOL: "hi" },
      expected: { hello: "greeting: hi" },
    });

    envVarTest({
      name: "nesting selects the inner most",
      ini: /* ini */ `
hello = greeting: \${what\${LOL}lol}
      `,
      env: { LOL: "hi" },
      expected: { hello: "greeting: ${whathilol}" },
    });

    envVarTest({
      name: "nesting 2 selects the inner most",
      ini: /* ini */ `
hello = greeting: \${what\${omg\${LOL}why}lol}
      `,
      env: { LOL: "hi" },
      expected: { hello: "greeting: ${what${omghiwhy}lol}" },
    });

    envVarTest({
      name: "unclosed",
      ini: /* ini */ `
hello = greeting: \${LOL
      `,
      env: { LOL: "hi" },
      expected: { hello: "greeting: ${LOL" },
    });

    envVarTest({
      name: "double quoted env var",
      ini: /* ini */ `
hello = "\${LOL}"
      `,
      env: { LOL: "hi" },
      expected: { hello: "hi" },
    });

    envVarTest({
      name: "single quoted env var",
      ini: /* ini */ `
hello = '\${LOL}'
      `,
      env: { LOL: "hi" },
      expected: { hello: "hi" },
    });

    envVarTest({
      name: "double quoted env var with prefix",
      ini: /* ini */ `
hello = "Bearer \${TOKEN}"
      `,
      env: { TOKEN: "secret123" },
      expected: { hello: "Bearer secret123" },
    });

    envVarTest({
      name: "double quoted env var not found leaves as-is",
      ini: /* ini */ `
hello = "\${NOTFOUND}"
      `,
      env: {},
      expected: { hello: "${NOTFOUND}" },
    });

    envVarTest({
      name: "unquoted optional env var expands to empty when not found",
      ini: /* ini */ `
hello = \${NOTFOUND?}
      `,
      env: {},
      expected: { hello: "" },
    });

    envVarTest({
      name: "unquoted optional env var expands to value when found",
      ini: /* ini */ `
hello = \${TOKEN?}
      `,
      env: { TOKEN: "secret" },
      expected: { hello: "secret" },
    });

    envVarTest({
      name: "double quoted optional env var expands to empty when not found",
      ini: /* ini */ `
hello = "\${NOTFOUND?}"
      `,
      env: {},
      expected: { hello: "" },
    });

    envVarTest({
      name: "double quoted optional env var expands to value when found",
      ini: /* ini */ `
hello = "\${TOKEN?}"
      `,
      env: { TOKEN: "secret" },
      expected: { hello: "secret" },
    });

    envVarTest({
      name: "single quoted optional env var expands to empty when not found",
      ini: /* ini */ `
hello = '\${NOTFOUND?}'
      `,
      env: {},
      expected: { hello: "" },
    });

    envVarTest({
      name: "unquoted optional env var with prefix",
      ini: /* ini */ `
hello = Bearer \${TOKEN?}
      `,
      env: {},
      expected: { hello: "Bearer " },
    });

    envVarTest({
      name: "double quoted optional env var with prefix",
      ini: /* ini */ `
hello = "Bearer \${TOKEN?}"
      `,
      env: {},
      expected: { hello: "Bearer " },
    });

    // Note: In JSON strings, \$ is just $ (backslash doesn't escape $)
    // So "\\${LOL}" in .npmrc becomes "\${LOL}" after JSON parsing, which expands to "\hi"
    // This matches npm behavior where escaping env vars in quoted strings requires \\$
    envVarTest({
      name: "double quoted with backslash before env var",
      ini: /* ini */ `
hello = "\\\\$\{LOL}"
      `,
      env: { LOL: "hi" },
      expected: { hello: "\\hi" },
    });

    // npm/ini cuts and trims the comment first, and npm expands the env var in
    // what is left, so the trim never touches whitespace from the variable
    envVarTest({
      name: "inline comment is cut before the env var expands",
      ini: /* ini */ `
cache = \${CACHE}#comment
padded = \${PADDED} ; comment
plain = \${LOL} # comment
inside = \${LOL;c?}
escaped = \${LOL}\\;x ; comment
hash = \${LOL} \\# x # comment
trailing = \${LOL}\\
      `,
      env: { CACHE: "/tmp/cache ", PADDED: " padded  ", LOL: "hi" },
      expected: {
        cache: "/tmp/cache ",
        padded: " padded  ",
        plain: "hi",
        inside: "${LOL",
        escaped: "hi;x",
        hash: "hi # x",
        trailing: "hi\\",
      },
    });

    function envVarTest(args: { name: string; ini: string; env: Record<string, string>; expected: any }) {
      const { name, ini, env, expected } = args;
      test(name, async () => {
        await using tempdir = tempDir("hi", { "foo.ini": ini });
        const inipath = `${tempdir}/foo.ini`.replaceAll("\\", "/");
        const code = /* ts */ `
const { iniInternals } = require("bun:internal-for-testing");
const { parse } = iniInternals;

const ini = await Bun.$\`cat ${inipath}\`.text()

console.log(JSON.stringify(parse(ini)))
        `;

        const result = await Bun.$`${bunExe()} -e ${code}`.env({ ...bunEnv, ...env }).json();
        expect(result).toEqual(expected);
      });
    }
  });

  it("works with unicode in the .ini file", () => {
    let ini /* ini */ = `
hi👋lol = 'lol hi 👋'
`;

    expect(parse(ini)).toEqual({
      "hi👋lol": "lol hi 👋",
    });

    ini = /* ini */ `
[😎.🫒.🤦‍♀️]
lol = 'wtf'
    `;

    expect(parse(ini)).toEqual({
      "😎": {
        "🫒": {
          "🤦‍♀️": {
            lol: "wtf",
          },
        },
      },
    });
  });

  it("matches stupid npm/ini behavior", () => {
    let ini /* ini */ = `
'{ "what": "is this" }' = seriously?
`;

    let result = parse(ini);
    expect(result).toEqual({
      "[Object object]": "seriously?",
    });

    ini = /* ini */ `
'[1, 2, 3]' = cmon man
`;

    result = parse(ini);
    expect(result).toEqual({
      "1,2,3": "cmon man",
    });
  });

  test("basic", () => {
    const ini = /* ini */ `
    hello = 'friends'
    `;

    expect(parse(ini)).toEqual({
      hello: "friends",
    });
  });

  test("basic sections", () => {
    const ini = /* ini */ `
hello = 'friends'

[foo]
bar = 'baz'
    `;

    expect(parse(ini)).toEqual({
      hello: "friends",
      foo: {
        bar: "baz",
      },
    });
  });

  test("inline comments are cut from unquoted values, keys and sections", () => {
    // npm/ini cuts an unquoted value at the first unescaped `;` or `#` and
    // trims what is left. An escaped comment char stays in the value.
    const ini = /* ini */ `
a = hello ; comment
b = world # comment
c = x\\;y ; z
d = foo#bar
e ; comment = v
h = http://r/#frag
i = true ;c
j = "q" ;c
k = "a;b#c"
[sec ; comment]
f = 1
[x.y # comment]
g = 2
`;

    expect(parse(ini)).toEqual({
      a: "hello",
      b: "world",
      c: "x;y",
      d: "foo",
      e: "v",
      h: "http://r/",
      i: true,
      j: '"q"',
      k: "a;b#c",
      sec: { f: "1" },
      x: { y: { g: "2" } },
    });
  });

  test("Unicode whitespace around keys, values and sections is trimmed", () => {
    expect(parse("a\u00a0=\u00a01\u00a0\n\u3000\n[s]\u00a0\nb\u000c=\u000b2\n\ufeff; comment\n")).toEqual({
      a: "1",
      s: { b: "2" },
    });
  });

  test("key and then section edgecase", () => {
    const ini = /* ini */ `
foo = 'hihihi'

[foo]
isbar = 'lol'
    `;

    expect(parse(ini)).toEqual({
      foo: "hihihi",
    });
  });

  describe("empty single-quoted value", () => {
    test.each([
      ["a='", { a: "" }],
      ["a=''", { a: "" }],
      ["'=x", { "": "x" }],
      ["''=x", { "": "x" }],
      ["[']\nx=1", { "": { x: "1" } }],
      ["['']\nx=1", { "": { x: "1" } }],
    ])("%s", (ini, expected) => {
      expect(parse(ini)).toEqual(expected);
    });

    test("section over empty-quote value does not mutate shared state", () => {
      expect(parse("a=''\n[a]\nhello=world")).toEqual({ a: "" });
      expect(parse("x=''")).toEqual({ x: "" });
    });

    test("fuzz repro ='\\n[]\\n=' does not create a self-referential object", () => {
      expect(parse("='\n[]\n='")).toEqual({ "": "" });
    });

    test.each([
      ["a='\n[a]\nb='", { a: "" }],
      ["a=''\n[a]\nb=''", { a: "" }],
    ])("no infinite recursion for %j", (ini, expected) => {
      expect(parse(ini)).toEqual(expected);
    });
  });

  describe("duplicate properties", () => {
    test("decode with duplicate properties", () => {
      const ini = /* ini */ `
zr[] = deedee
zr=123
ar[] = one
ar[] = three
str = 3
brr = 1
brr = 2
brr = 3
brr = 3
`;

      expect(parse(ini)).toEqual({
        zr: ["deedee", "123"],
        ar: ["one", "three"],
        str: "3",
        brr: "3",
      });
    });
  });

  // The parser scans an object of up to 32 keys for a key, and uses a hash table for a larger object.
  // Each case runs with the object under test on both sides of that limit.
  describe.each([0, 31, 32, 33, 300])("an object with %d other keys", count => {
    const otherKeys = Array.from({ length: count }, (_, i) => `other${i}`);
    const otherLines = otherKeys.map(key => `${key} = x`);
    const others = Object.fromEntries(otherKeys.map(key => [key, "x"]));

    function expectParsed(lines: string[], expected: object) {
      const parsed = parse(lines.join("\n"));
      expect(parsed).toEqual(expected);
      // `toEqual` accepts the keys in any order.
      expect(JSON.stringify(parsed)).toBe(JSON.stringify(expected));
    }

    test("a repeated key replaces the value and keeps its place", () => {
      expectParsed(["a = 1", ...otherLines, "b = 2", "a = 3"], { a: "3", ...others, b: "2" });
    });

    test("key[] after a plain key makes an array of both values", () => {
      expectParsed(["a = 1", ...otherLines, "b = 2", "a[] = 3"], { a: ["1", "3"], ...others, b: "2" });
    });

    test("a plain key after key[] adds to the array", () => {
      expectParsed(["a[] = 1", ...otherLines, "b = 2", "a = 3", "a[] = 4"], {
        a: ["1", "3", "4"],
        ...others,
        b: "2",
      });
    });

    test("a section that is opened again keeps its keys", () => {
      expectParsed(["[s]", "x = 1", ...otherLines, "[t]", "y = 2", "[s]", "z = 3", "x = 9"], {
        s: { x: "9", ...others, z: "3" },
        t: { y: "2" },
      });
    });

    test("a nested section is found again in its parent", () => {
      expectParsed(["[a]", ...otherLines, "[a.b]", "x = 1", "[a]", "y = 2", "[a.b]", "z = 3"], {
        a: { ...others, b: { x: "1", z: "3" }, y: "2" },
      });
    });

    test("a key replaces a nested section, and the header of that section is then skipped", () => {
      expectParsed(["[a]", ...otherLines, "[a.b]", "x = 1", "[a]", "b = 5", "[a.b]", "y = 2", "[c]", "z = 3"], {
        a: { ...others, b: "5" },
        c: { z: "3" },
      });
    });

    test("the header of a key with a string value is skipped", () => {
      expectParsed(["foo = bar", ...otherLines, "[foo]", "x = 1", "[ok]", "y = 2"], {
        foo: "bar",
        ...others,
        ok: { y: "2" },
      });
    });

    test("a section adds to the keys of a JSON value", () => {
      const json = JSON.stringify({ a: 1, b: [2], ...others });
      expectParsed([`foo = '${json}'`, "[foo]", "c = 3", "a = 7", "b = 8"], {
        foo: { a: "7", b: [2, "8"], ...others, c: "3" },
      });
    });

    test("a section replaces the first of two equal keys of a JSON value", () => {
      const json = `{"a":1,${otherKeys.map(key => `"${key}":"x",`).join("")}"a":2}`;
      expectParsed([`foo = '${json}'`, "[foo]", "a = 3"], { foo: { a: 2, ...others } });
    });

    test("a header continues in the last object of an array", () => {
      const json = JSON.stringify({ x: 1, ...others });
      expectParsed([...otherLines, `a[] = '${json}'`, "[a.b]", "k = v", "[a.c]", "[a.b]", "l = w", "[a]", "m = n"], {
        ...others,
        a: [{ x: 1, ...others, b: { k: "v", l: "w" }, c: {} }],
      });
    });

    test.each([
      ["whose last element is not an object", "a[] = 1", ["1"]],
      ["that is empty", "a = '[]'", []],
    ])("a header under an array %s is skipped", (_, line, a) => {
      expectParsed([...otherLines, line, "[a.b]", "k = v", "[ok]", "y = 2"], { ...others, a, ok: { y: "2" } });
    });

    test("a header that is skipped leaves the section that was open", () => {
      expectParsed(["[s]", ...otherLines, "a[] = 1", "[s.a.b]", "k = v", "[", "m = n"], {
        s: { ...others, a: ["1"], m: "n" },
      });
    });

    test("a __proto__ key is skipped, and a [__proto__] section is an own property", () => {
      expectParsed([...otherLines, "__proto__ = 1", "ok = 1", "[__proto__]", "x = 1", "[s]", "[__proto__]", "y = 2"], {
        ...others,
        ok: "1",
        ["__proto__"]: { x: "1", y: "2" },
        s: {},
      });
    });

    test("two sections that take turns, with their keys in opposite orders", () => {
      const keys = ["first", ...otherKeys];
      const reversed = keys.toReversed();
      expectParsed(
        [
          ...keys.flatMap((key, i) => ["[a]", `${key} = a`, "[b]", `${reversed[i]} = b`]),
          ...keys.flatMap((key, i) => ["[a]", `${key} = A`, "[b]", `${reversed[i]}[] = B`]),
        ],
        {
          a: Object.fromEntries(keys.map(key => [key, "A"])),
          b: Object.fromEntries(reversed.map(key => [key, ["b", "B"]])),
        },
      );
    });
  });

  // The same lines with and without 33 more keys in each object: the first is read through the hash table, the second
  // with a scan.
  test("an object of many keys is read like a small one in 24 random files", () => {
    const filler = numbered(33, i => `filler${i} = x\n`);
    const withoutFiller = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(withoutFiller)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => !key.startsWith("filler"))
                .map(([key, inner]) => [key, withoutFiller(inner)]),
            )
          : value;
    let seed = 1;
    const random = (below: number) => (seed = (seed * 48271) % 0x7fffffff) % below;
    for (let file = 0; file < 24; file++) {
      let small = "";
      let large = filler;
      for (let line = 0; line < 30; line++) {
        const key = `k${random(5)}`;
        const text = [
          `${key} = ${line}\n`,
          `${key}[] = ${line}\n`,
          `${key} = '{"k${random(5)}":${line},"a":[1,{"b":2}]}'\n`,
          `[${key}]\n`,
          `[${key}.k${random(5)}]\n`,
          `[${key}.a.c]\n`,
        ][random(6)];
        small += text;
        large += text.startsWith("[") ? text + filler : text;
      }
      expect(JSON.stringify(withoutFiller(parse(large)))).toBe(JSON.stringify(parse(small)));
    }
  });

  test("two keys with the same hash stay apart in an object of many keys", () => {
    // The hash table of an object uses the low 32 bits of wyhash.
    const [one, two] = ["key85982", "key146395"];
    expect(Bun.hash.wyhash(one) & 0xffff_ffffn).toBe(Bun.hash.wyhash(two) & 0xffff_ffffn);
    const parsed = parse(numbered(40, i => `other${i} = x\n`) + `${one} = 1\n${two} = 2\n${one} = 3\n${two}[] = 4\n`);
    expect(Object.keys(parsed)).toHaveLength(42);
    expect([parsed[one], parsed[two]]).toEqual(["3", ["2", "4"]]);
  });

  test("a key is found among 4,000 keys", () => {
    const parsed = parse(
      numbered(4000, i => `key${i} = ${i}\n`) + "key0 = first\nkey2000[] = middle\nkey3999 = last\n[key1]\nx = 1\n",
    );
    expect(Object.keys(parsed)).toHaveLength(4000);
    expect([parsed.key0, parsed.key1, parsed.key2000, parsed.key3999]).toEqual([
      "first",
      "1",
      ["2000", "middle"],
      "last",
    ]);
  });

  test("a section is found among 4,000 sections", () => {
    const parsed = parse(
      numbered(4000, i => `[section${i}]\nkey = ${i}\n`) +
        "[section0]\nkey = first\n[section2000]\nkey[] = middle\n[section3999.nested]\nkey = last\n",
    );
    expect(Object.keys(parsed)).toHaveLength(4000);
    expect([parsed.section0, parsed.section1, parsed.section2000, parsed.section3999]).toEqual([
      { key: "first" },
      { key: "1" },
      { key: ["2000", "middle"] },
      { key: "3999", nested: { key: "last" } },
    ]);
  });

  test("bigboi", async () => {
    const foo = await Bun.$`cat ${__dirname}/foo.ini`.text();
    const result = parse(foo);
    console.log(JSON.stringify(result));
    expect(result).toEqual({
      " xa  n          p ": '"\r\nyoyoyo\r\r\n',
      "[disturbing]": "hey you never know",
      "a": {
        "[]": "a square?",
        "av": "a val",
        "b": {
          "c": {
            "e": "1",
            "j": "2",
          },
        },
        "cr": ["four", "eight"],
        "e": '{ o: p, a: { av: a val, b: { c: { e: "this [value]" } } } }',
        "j": '"{ o: "p", a: { av: "a val", b: { c: { e: "this [value]" } } } }"',
      },
      "a with spaces": "b  c",
      "ar": ["one", "three", "this is included"],
      "b": {},
      "br": "warm",
      "eq": "eq=eq",
      "false": false,
      "null": null,
      "o": "p",
      "s": "something",
      "s1": "\"something'",
      "s2": "something else",
      "s3": "",
      "s4": "",
      "s5": "   ",
      "s6": " a ",
      "s7": true,
      "true": true,
      "undefined": "undefined",
      "x.y.z": {
        "a.b.c": {
          "a.b.c": "abc",
          "nocomment": "this; this is not a comment",
          "noHashComment": "this# this is not a comment",
        },
        "x.y.z": "xyz",
      },
      "zr": ["deedee"],
    });
  });

  describe("truncated/invalid utf-8", () => {
    test("bare continuation byte (0x80) should not crash", () => {
      // 0x80 is a continuation byte without a leading byte
      // utf8ByteSequenceLength returns 0, which must not hit unreachable
      const ini = Buffer.concat([Buffer.from("key = "), Buffer.from([0x80])]).toString("latin1");
      // Should not crash - just parse gracefully
      expect(() => parse(ini)).not.toThrow();
    });

    test("truncated 2-byte sequence at end of value", () => {
      // 0xC0 is a 2-byte lead byte, but there's no continuation byte following
      const ini = Buffer.concat([Buffer.from("key = "), Buffer.from([0xc0])]).toString("latin1");
      expect(() => parse(ini)).not.toThrow();
    });

    test("truncated 3-byte sequence at end of value", () => {
      // 0xE0 is a 3-byte lead byte, but only 0 continuation bytes follow
      const ini = Buffer.concat([Buffer.from("key = "), Buffer.from([0xe0])]).toString("latin1");
      expect(() => parse(ini)).not.toThrow();
    });

    test("truncated 3-byte sequence with 1 continuation byte at end", () => {
      // 0xE0 is a 3-byte lead byte, but only 1 continuation byte follows
      const ini = Buffer.concat([Buffer.from("key = "), Buffer.from([0xe0, 0x80])]).toString("latin1");
      expect(() => parse(ini)).not.toThrow();
    });

    test("truncated 4-byte sequence at end of value", () => {
      // 0xF0 is a 4-byte lead byte, but only 0 continuation bytes follow
      const ini = Buffer.concat([Buffer.from("key = "), Buffer.from([0xf0])]).toString("latin1");
      expect(() => parse(ini)).not.toThrow();
    });

    test("truncated 4-byte sequence with 1 continuation byte at end", () => {
      const ini = Buffer.concat([Buffer.from("key = "), Buffer.from([0xf0, 0x80])]).toString("latin1");
      expect(() => parse(ini)).not.toThrow();
    });

    test("truncated 4-byte sequence with 2 continuation bytes at end", () => {
      const ini = Buffer.concat([Buffer.from("key = "), Buffer.from([0xf0, 0x80, 0x80])]).toString("latin1");
      expect(() => parse(ini)).not.toThrow();
    });

    test("truncated 2-byte sequence in escaped context", () => {
      // Backslash followed by a 2-byte lead byte at end of value
      const ini = Buffer.concat([Buffer.from("key = \\"), Buffer.from([0xc0])]).toString("latin1");
      expect(() => parse(ini)).not.toThrow();
    });

    test("bare continuation byte in escaped context", () => {
      const ini = Buffer.concat([Buffer.from("key = \\"), Buffer.from([0x80])]).toString("latin1");
      expect(() => parse(ini)).not.toThrow();
    });
  });
});

// A read that scans the lines before each line takes 13 to 50 seconds of CPU for these files in a debug build,
// and 5 to 17 seconds in a release build.
describe.concurrent("a large .npmrc is read in time in proportion to its lines", () => {
  const lines = isDebug ? 16_000 : 64_000;

  test.each<[string, () => string]>([
    ["keys", () => numbered(lines, i => `key${i} = value\n`)],
    ["key[] lines", () => numbered(lines, i => `key${i}[] = value\n`)],
    ["sections", () => numbered(lines, i => `[section${i}]\n`)],
    ["nested sections", () => numbered(lines, i => `[a.b${i}]\n`)],
    ["the keys of one section", () => "[section]\n" + numbered(lines, i => `key${i} = value\n`)],
    [
      "the keys that a section adds to a JSON value",
      () =>
        `foo = '{${numbered(lines / 2, i => `"json${i}":${i},`)}"last":0}'\n[foo]\n` +
        numbered(lines / 2, i => `key${i} = value\n`),
    ],
    ["two sections that take turns", () => numbered(lines / 2, i => `[a]\nkey${i} = value\n[b]\nkey${i} = value\n`)],
  ])("%s", async (_, npmrc) => {
    using dir = tempDir("ini-large-npmrc", {
      ".npmrc": npmrc(),
      "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      "home/.gitkeep": "",
    });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "bin"],
      cwd: String(dir),
      // `bun pm bin` reads the `.npmrc` of the project, and no other: `home` has none.
      env: {
        ...bunEnv,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: home,
        NPM_CONFIG_USERCONFIG: undefined,
        npm_config_userconfig: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    // CPU time, in seconds. Wall-clock time means little on a busy machine.
    expect(Number(proc.resourceUsage()!.cpuTime.total) / 1e6).toBeLessThan(isDebug || isASAN ? 4 : 1);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });
});

const wtf = {
  "o": "p",
  "a with spaces": "b  c",
  " xa  n          p ": '"\r\nyoyoyo\r\r\n',
  "[disturbing]": "hey you never know",
  "s": "something",
  "s1": "\"something'",
  "s2": "something else",
  "s3": true,
  "s4": true,
  "s5": "   ",
  "s6": " a ",
  "s7": true,
  "true": true,
  "false": false,
  "null": null,
  "undefined": "undefined",
  "zr": ["deedee"],
  "ar": [["one"], "three", "this is included"],
  "br": "warm",
  "eq": "eq=eq",
  "a": {
    "av": "a val",
    "e": '{ o: p, a: { av: a val, b: { c: { e: "this [value]" } } } }',
    "j": '"{ o: "p", a: { av: "a val", b: { c: { e: "this [value]" } } } }"',
    "[]": "a square?",
    "cr": [["four"], "eight"],
    "b": { "c": { "e": "1", "j": "2" } },
  },
  "b": {},
  "x.y.z": {
    "x.y.z": "xyz",
    "a.b.c": {
      "a.b.c": "abc",
      "nocomment": "this; this is not a comment",
      "noHashComment": "this# this is not a comment",
    },
  },
};
