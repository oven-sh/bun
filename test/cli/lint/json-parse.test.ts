// Native rules read package.json and other JSON files with `bun_lint::linter::json_parse`, and `/* eslint rule: .. */` comments are
// parsed with it too. It behaves like V8's `JSON.parse`: same error messages, and no limit on nesting.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const packages = Object.fromEntries(
  ["listed", "unlisted"].flatMap(name => [
    [`node_modules/${name}/package.json`, JSON.stringify({ name, main: "index.js" })],
    [`node_modules/${name}/index.js`, "module.exports = 1;\n"],
  ]),
);
const code = `import a from "listed";\nimport b from "unlisted";\nconsole.log(a, b);\n`;
const unlisted = "'unlisted' should be listed in the project's dependencies. Run 'npm i -S unlisted' to add it";

async function lint(files: Record<string, string>, args: string[]) {
  using dir = tempDir("bun-lint-json-parse", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const couldNotBeParsed = "The package.json file could not be parsed: ";
/** What the rule says is wrong with the text. It also reports the imports, since it knows no dependencies then. */
const syntaxErrors = (messages: string[]) => messages.filter(it => it.startsWith(couldNotBeParsed));

/**
 * Runs `import/no-extraneous-dependencies` once per text, with that text as the package.json it reads.
 * Returns the rule's messages for each text.
 */
async function readAsPackageJson(texts: string[]) {
  const rule = (packageDir: string) => ({ "import/no-extraneous-dependencies": ["error", { packageDir }] });
  const { stdout, stderr } = await lint(
    {
      ...packages,
      "package.json": `{"name":"root"}`,
      ".oxlintrc.json": JSON.stringify({
        plugins: ["import"],
        categories: { correctness: "off" },
        overrides: texts.map((_, i) => ({ files: [`${i}.js`], rules: rule(`./${i}`) })),
      }),
      ...Object.fromEntries(
        texts.flatMap((text, i) => [[`${i}.js`, code] as const, [`${i}/package.json`, text] as const]),
      ),
    },
    ["-f", "json", ...texts.map((_, i) => `${i}.js`)],
  );
  expect(stderr).toBe("");
  const found = JSON.parse(stdout).diagnostics as { filename: string; message: string }[];
  return texts.map((_, i) => found.filter(it => it.filename === `${i}.js`).map(it => it.message));
}

// Deep enough that anything that recurses once per level overflows an 8 MB stack.
const depth = 100_000;
// `String.prototype.repeat` is very slow in debug builds of JavaScriptCore.
const repeat = (unit: string, count: number) => Buffer.alloc(count * unit.length, unit).toString();
const nested = {
  arrays: repeat("[", depth) + repeat("]", depth),
  objects: repeat('{"a":', depth) + "1" + repeat("}", depth),
  both: repeat('[{"a":', depth / 2) + "1" + repeat("}]", depth / 2),
};

describe.concurrent("JSON files that rules read", () => {
  // What `JSON.parse(text)` throws in Node.js 26. V8 cuts between the halves of a surrogate pair, and half a pair prints as U+FFFD.
  const invalid: [text: string, message: string][] = [
    ["", "Unexpected end of JSON input"],
    [" \n", "Unexpected end of JSON input"],
    ["{", "Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
    ["[", "Unexpected end of JSON input"],
    ["]", "Unexpected token ']', \"]\" is not valid JSON"],
    ["[1", "Expected ',' or ']' after array element in JSON at position 2 (line 1 column 3)"],
    ["[1,", "Unexpected end of JSON input"],
    ["[1,]", "Unexpected token ']', \"[1,]\" is not valid JSON"],
    ["[,1]", "Unexpected token ',', \"[,1]\" is not valid JSON"],
    ["[1 2]", "Expected ',' or ']' after array element in JSON at position 3 (line 1 column 4)"],
    ['{"a"', "Expected ':' after property name in JSON at position 4 (line 1 column 5)"],
    ['{"a":', "Unexpected end of JSON input"],
    ['{"a":1', "Expected ',' or '}' after property value in JSON at position 6 (line 1 column 7)"],
    ['{"a":1,', "Expected double-quoted property name in JSON at position 7 (line 1 column 8)"],
    ['{"a":1,}', "Expected double-quoted property name in JSON at position 7 (line 1 column 8)"],
    ["{a:1}", "Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
    ["{'a':1}", "Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
    ['{"a" 1}', "Expected ':' after property name in JSON at position 5 (line 1 column 6)"],
    ['{"a":1 "b":2}', "Expected ',' or '}' after property value in JSON at position 7 (line 1 column 8)"],
    ["{,}", "Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
    ["{1:2}", "Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
    ["-", "No number after minus sign in JSON at position 1 (line 1 column 2)"],
    ["-a", "No number after minus sign in JSON at position 1 (line 1 column 2)"],
    ["01", "Unexpected number in JSON at position 1 (line 1 column 2)"],
    ["-01", "Unexpected number in JSON at position 2 (line 1 column 3)"],
    ["1.", "Unterminated fractional number in JSON at position 2 (line 1 column 3)"],
    ["1.e1", "Unterminated fractional number in JSON at position 2 (line 1 column 3)"],
    ["1e", "Exponent part is missing a number in JSON at position 2 (line 1 column 3)"],
    ["1e+", "Exponent part is missing a number in JSON at position 3 (line 1 column 4)"],
    ["0x1", "Unexpected non-whitespace character after JSON at position 1 (line 1 column 2)"],
    ["+1", "Unexpected token '+', \"+1\" is not valid JSON"],
    [".5", "Unexpected token '.', \".5\" is not valid JSON"],
    ["1 2", "Unexpected non-whitespace character after JSON at position 2 (line 1 column 3)"],
    ['"', "Unterminated string in JSON at position 1 (line 1 column 2)"],
    ['"a', "Unterminated string in JSON at position 2 (line 1 column 3)"],
    ['"\\', "Unexpected end of JSON input"],
    ['"\\x"', "Bad escaped character in JSON at position 2 (line 1 column 3)"],
    ['"\\u12"', "Bad Unicode escape in JSON at position 5 (line 1 column 6)"],
    ['"\\u123g"', "Bad Unicode escape in JSON at position 6 (line 1 column 7)"],
    ['"a\nb"', "Bad control character in string literal in JSON at position 2 (line 1 column 3)"],
    ['"a\tb"', "Bad control character in string literal in JSON at position 2 (line 1 column 3)"],
    ['"\\é"', "Bad escaped character in JSON at position 2 (line 1 column 3)"],
    ["tru", "Unexpected end of JSON input"],
    ["truex", "Unexpected non-whitespace character after JSON at position 4 (line 1 column 5)"],
    ["true x", "Unexpected non-whitespace character after JSON at position 5 (line 1 column 6)"],
    ["nul", "Unexpected end of JSON input"],
    ["NaN", '"NaN" is not valid JSON'],
    ["Infinity", '"Infinity" is not valid JSON'],
    ["-Infinity", "No number after minus sign in JSON at position 1 (line 1 column 2)"],
    ["undefined", '"undefined" is not valid JSON'],
    ["[object Object]", '"[object Object]" is not valid JSON'],
    [" NaN", "Unexpected token 'N', \" NaN\" is not valid JSON"],
    ["[NaN]", "Unexpected token 'N', \"[NaN]\" is not valid JSON"],
    ["é", "Unexpected token 'é', \"é\" is not valid JSON"],
    ["😀", "Unexpected token '\ufffd', \"😀\" is not valid JSON"],
    ["[😀]", "Unexpected token '\ufffd', \"[😀]\" is not valid JSON"],
    ["// c\n{}", "Unexpected token '/', \"// c\n{}\" is not valid JSON"],
    ["{} // c", "Unexpected non-whitespace character after JSON at position 3 (line 1 column 4)"],
    ["[1]\n\n  x", "Unexpected non-whitespace character after JSON at position 7 (line 3 column 3)"],
    ["[1]\r\n\r\n  x", "Unexpected non-whitespace character after JSON at position 9 (line 3 column 3)"],
    ["[1]\r\r x", "Unexpected non-whitespace character after JSON at position 6 (line 3 column 2)"],
    ['{\n  "a": 1,\n  "b": x\n}', 'Unexpected token \'x\', ..."1,\n  "b": x\n}" is not valid JSON'],
    [
      "[1,2,3,4,5,6,7,8,9,10,x,12,13,14,15,16,17,18]",
      "Unexpected token 'x', ...\",7,8,9,10,x,12,13,14\"... is not valid JSON",
    ],
    ["[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,x]", "Unexpected token 'x', ...\",15,16,17,x]\" is not valid JSON"],
    ["[x,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]", "Unexpected token 'x', \"[x,2,3,4,5,\"... is not valid JSON"],
    ["          x          ", "Unexpected token 'x', ...\"          x         \"... is not valid JSON"],
    ["          x         ", "Unexpected token 'x', \"          x         \" is not valid JSON"],
    ['"abc" "def"', "Unexpected non-whitespace character after JSON at position 6 (line 1 column 7)"],
    ['["a" "b"]', "Expected ',' or ']' after array element in JSON at position 5 (line 1 column 6)"],
    ['{"a":"b" "c"}', "Expected ',' or '}' after property value in JSON at position 9 (line 1 column 10)"],
    [
      '["😀😀😀😀😀😀",y,"😀😀😀😀😀😀"]',
      'Unexpected token \'y\', ..."😀😀😀😀",y,"😀😀😀\ufffd"... is not valid JSON',
    ],
    ["[1,\u000b2]", "Unexpected token '\u000b', \"[1,\u000b2]\" is not valid JSON"],
    ["\u0000", "Unexpected token '\u0000', \"\u0000\" is not valid JSON"],
  ];

  test("syntax errors have V8's messages and positions", async () => {
    const said = await readAsPackageJson(invalid.map(it => it[0]));
    expect(said.map((it, i) => [invalid[i][0], syntaxErrors(it)])).toEqual(
      invalid.map(it => [it[0], [couldNotBeParsed + it[1]]]),
    );
  });

  test.each(Object.entries(nested))("deeply nested %s are read", async (_, value) => {
    const dependencies = `"dependencies":{"listed":"1"}`;
    const said = await readAsPackageJson([`{${dependencies},"x":${value}}\n`, `{"x":${value},${dependencies}}\n`]);
    expect(said).toEqual([[unlisted], [unlisted]]);
  });

  test("an object with 100,000 names is read as fast as any other text of that size", async () => {
    const names = Array.from({ length: 100_000 }, (_, i) => `"package-${i}":"1"`);
    expect(await readAsPackageJson([`{"dependencies":{${names.join(",")},"listed":"1"}}`])).toEqual([[unlisted]]);
  });

  test("the last value of a repeated name counts", async () => {
    const others = Array.from({ length: 40 }, (_, i) => `"name-${i}":${i}`).join(",");
    const first = `"dependencies":{"unlisted":"1"}`;
    const last = `"dependencies":{"listed":"1"}`;
    const said = await readAsPackageJson([`{${first},${last}}`, `{${first},${others},${last}}`]);
    expect(said).toEqual([[unlisted], [unlisted]]);
  });

  test("the closest package.json can be deeply nested", async () => {
    const { stdout, exitCode } = await lint(
      {
        ...packages,
        ".oxlintrc.json": JSON.stringify({
          plugins: ["import"],
          categories: { correctness: "off" },
          rules: { "import/no-extraneous-dependencies": "error" },
        }),
        "package.json": `{"name":"root"}`,
        "inner/package.json": `{"dependencies":{"listed":"1"},"x":${nested.arrays}}\n`,
        "inner/src/a.js": code,
      },
      ["-f", "unix", "inner"],
    );
    expect(stdout).toBe(`inner/src/a.js:2:1: ${unlisted} [Error/import(no-extraneous-dependencies)]\n\n1 problem\n`);
    expect(exitCode).toBe(1);
  });

  test("errors in deeply nested text have V8's messages and positions", async () => {
    const texts: [text: string, message: string][] = [
      [repeat("[", depth), "Unexpected end of JSON input"],
      [repeat('{"a":', depth), "Unexpected end of JSON input"],
      [
        nested.arrays + "]",
        `Unexpected non-whitespace character after JSON at position ${2 * depth} (line 1 column ${2 * depth + 1})`,
      ],
      [repeat("[", depth) + "}", `Unexpected token '}', ..."[[[[[[[[[[}" is not valid JSON`],
      [
        repeat("[\n", depth) + "1 2",
        `Expected ',' or ']' after array element in JSON at position ${2 * depth + 2} (line ${depth + 1} column 3)`,
      ],
    ];
    const said = await readAsPackageJson(texts.map(it => it[0]));
    expect(said.map(syntaxErrors)).toEqual(texts.map(it => [couldNotBeParsed + it[1]]));
  });
});

// `bun lint` looks for `eslintConfig` in every package.json on the way up.
test.concurrent("a deeply nested package.json without eslintConfig doesn't stop the run", async () => {
  const files = { "package.json": `{"name":"a","x":${nested.arrays}}\n`, "a.js": "debugger;\n" };
  const { stdout, exitCode } = await lint(files, ["-f", "json", "--rule", "no-debugger: error", "a.js"]);
  expect(JSON.parse(stdout)[0].messages.map((it: { message: string }) => it.message)).toEqual([
    "Unexpected 'debugger' statement.",
  ]);
  expect(exitCode).toBe(1);
});

describe.concurrent("/* eslint rule: .. */ comments", () => {
  const plugin = `
    const create = context => ({
      Program(node) {
        let depth = 0;
        let value = context.options[0];
        for (; value !== null && typeof value === "object"; depth++) value = Array.isArray(value) ? value[0] : value.a;
        context.report({ node, message: "depth " + depth + ", innermost " + value });
      },
    });
    const self = { anyOf: [{ type: "number" }, { type: "array", items: { $ref: "#/definitions/self" } }] };
    export default {
      rules: {
        unchecked: { meta: { schema: false }, create },
        anything: { meta: { schema: [{}] }, create },
        recursive: { meta: { schema: { definitions: { self }, type: "array", items: [self] } }, create },
      },
    };
  `;
  const config = `import mini from "./plugin.mjs";\nexport default [{ plugins: { mini } }];\n`;

  /** Shortens runs of brackets: `[[[[[[[[[[[[` becomes `<12 [>`. */
  const short = (text: string) =>
    text.replace(/(\[|\]|\{"a":|\})\1{9,}/g, (run, unit) => `<${run.length / unit.length} ${unit}>`);

  async function messages(comment: string) {
    const files = { "eslint.config.mjs": config, "plugin.mjs": plugin, "a.js": `/* eslint ${comment} */\nlet a;\n` };
    const { stdout } = await lint(files, ["-f", "json", "a.js"]);
    const found = JSON.parse(stdout)[0].messages as { ruleId: string | null; message: string }[];
    return found.map(it => `${it.ruleId}: ${short(it.message)}`);
  }

  // All of these are what ESLint 10.12 prints.
  test.each([
    ["mini/unchecked", nested.arrays, `depth ${depth}, innermost undefined`],
    ["mini/unchecked", nested.objects, `depth ${depth}, innermost 1`],
    ["mini/anything", nested.both, `depth ${depth}, innermost 1`],
  ])("%s gets deeply nested options", async (rule, options, said) => {
    expect(await messages(`${rule}: [2, ${options}]`)).toEqual([`${rule}: ${said}`]);
  });

  test("messages about invalid options print deeply nested values", async () => {
    const said = await Promise.all([nested.arrays, nested.objects].map(it => messages(`eqeqeq: [2, ${it}]`)));
    const invalid = (value: string, all: string) =>
      `eqeqeq: Inline configuration for rule "eqeqeq" is invalid:\n` +
      `\tValue ${value} should be equal to one of the allowed values.\n`.repeat(2) +
      `\tValue ${all} should match some schema in anyOf.\n`;
    expect(said).toEqual([
      [invalid(`<${depth} [><${depth} ]>`, `<${depth + 1} [><${depth + 1} ]>`)],
      [invalid(`<${depth} {"a":>1<${depth} }>`, `[<${depth} {"a":>1<${depth} }>]`)],
    ]);
  });

  test("a schema that refers to itself runs out of stack like Ajv does", async () => {
    expect(await messages(`mini/recursive: [2, ${repeat("[", depth)}1${repeat("]", depth)}]`)).toEqual([
      `mini/recursive: Inline configuration for rule "mini/recursive" is invalid:\n\tMaximum call stack size exceeded\n`,
    ]);
  });

  test("errors in deeply nested text have V8's messages and positions", async () => {
    const texts = [repeat("[", depth), nested.arrays + "]", repeat('{"a":', depth)];
    const failed = `null: Failed to parse JSON from '"eqeqeq": [2, `;
    expect(await Promise.all(texts.map(it => messages(`eqeqeq: [2, ${it}]`)))).toEqual([
      [
        `${failed}<${depth} [>]': Expected ',' or ']' after array element in JSON ` +
          `at position ${depth + 16} (line 1 column ${depth + 17})`,
      ],
      [
        `${failed}<${depth} [><${depth + 2} ]>': Expected ',' or '}' after property value in JSON ` +
          `at position ${2 * depth + 16} (line 1 column ${2 * depth + 17})`,
      ],
      [`${failed}<${depth} {"a":>]': Unexpected token ']', ..."{"a":{"a":]}" is not valid JSON`],
    ]);
  });
});
