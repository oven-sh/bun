const { iniInternals } = require("bun:internal-for-testing");
const { parse } = iniInternals;
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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

    function envVarTest(args: { name: string; ini: string; env: Record<string, string>; expected: any }) {
      const { name, ini, env, expected } = args;
      test(name, async () => {
        const tempdir = tempDirWithFiles("hi", { "foo.ini": ini });
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
