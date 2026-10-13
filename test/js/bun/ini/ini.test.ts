const { iniInternals } = require("bun:internal-for-testing");
const { parse } = iniInternals;
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { totalmem } from "node:os";

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

// The parser records a source position as an i32 byte offset, so it takes at most i32::MAX bytes.
// The hooks parse a Uint8Array as it is, which lets a case hand over 2 GiB of untouched memory.
// Each case runs in a child, so the array does not stay in the test runner.
describe.concurrent("source length", () => {
  // Inside a container totalmem() reports the RAM of the host, and constrainedMemory() the cgroup limit.
  const memory = Math.min(totalmem(), process.constrainedMemory() || Infinity);

  async function run(code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const { parse, loadNpmrc } = require("bun:internal-for-testing").iniInternals;\n${code}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // The parser rejects the source by its length before it reads a byte, so the 2 GiB stay
  // untouched virtual memory.
  test("a source of 2 GiB is an error", async () => {
    expect(
      await run(`
        const source = new Uint8Array(2 ** 31);
        const results = {};
        try {
          results.parse = parse(source);
        } catch (e) {
          results.parse = e.message;
        }
        try {
          results.loadNpmrc = loadNpmrc(source, {}).message;
        } catch (e) {
          results.loadNpmrc = "threw " + e.message;
        }
        console.log(JSON.stringify(results));
      `),
    ).toEqual({
      stdout: JSON.stringify({
        parse: "INI document is too large to parse (2 GiB maximum)",
        loadNpmrc: "INI document is too large to parse (2 GiB maximum)",
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  // The largest source the parser takes. The key line starts 4 bytes before i32::MAX. The comment
  // line before it is untouched memory, and the search for its line end reads all of it: on Linux
  // that maps the shared zero page, elsewhere it commits the 2 GiB.
  test.skipIf(!isLinux && memory < 10 * 1024 ** 3)(
    "a source one byte under 2 GiB parses",
    async () => {
      expect(
        await run(`
          const source = new Uint8Array(2 ** 31 - 1);
          source[0] = "#".charCodeAt(0);
          source.set(Buffer.from("\\nk=v"), source.length - 4);
          console.log(JSON.stringify(parse(source)));
        `),
      ).toEqual({ stdout: JSON.stringify({ k: "v" }), stderr: "", exitCode: 0 });
    },
    120_000,
  );
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
