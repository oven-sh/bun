// `prettier/prettier` is built in: it reports where a file differs from what `bun format` prints. It stands in for the rule of
// eslint-plugin-prettier only where that text is Prettier's, byte for byte. Elsewhere the rule of the package is asked.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// The rule of the package, to tell which of the two has answered. Its options are validated by its own schema too.
const theirs = `{
  meta: { schema: [{ type: "object" }, { type: "object" }] },
  create: context => ({ Program(node) { context.report({ node, message: "theirs" }); } }),
}`;
const config = (blocks: unknown[] = []) => `export default [
  { ignores: ["eslint.config.mjs"] },
  { files: ["**/*.ts"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } } },
  {
    files: ["**/*.{js,mjs,ts}"],
    plugins: { prettier: { meta: { name: "eslint-plugin-prettier", version: "5.5.6" }, rules: { prettier: ${theirs} } } },
    rules: { "prettier/prettier": "error" },
  },
  ...${JSON.stringify(blocks)},
];`;
const installed = (prettier = "3.9.9", plugin = "5.5.6") => ({
  "node_modules/prettier/package.json": JSON.stringify({ name: "prettier", version: prettier }),
  "node_modules/eslint-plugin-prettier/package.json": JSON.stringify({
    name: "eslint-plugin-prettier",
    version: plugin,
  }),
});

type Message = {
  messageId?: string;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  fix?: { range: [number, number]; text: string };
};

async function run(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("prettier-rule", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...flags, "."],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { root: realpathSync(String(dir)), stdout, stderr, exitCode };
}

async function lint(files: Record<string, string>, ...flags: string[]) {
  const { root, stdout, stderr, exitCode } = await run(files, "-f", "json", ...flags);
  const results: { filePath: string; messages: Message[]; output?: string }[] = JSON.parse(stdout);
  const name = (path: string) => relative(root, path).replaceAll("\\", "/");
  const shown = (it: Message) =>
    it.fix
      ? `${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.messageId} [${it.fix.range}] ${JSON.stringify(it.fix.text)} ${it.message}`
      : it.message;
  return {
    reports: Object.fromEntries(results.map(it => [name(it.filePath), it.messages.map(shown)])),
    outputs: Object.fromEntries(
      results.flatMap(it => (it.output === undefined ? [] : [[name(it.filePath), it.output]])),
    ),
    stderr,
    exitCode,
  };
}

const files = {
  "basic.js": "const a = {b:1}\nfoo( a );\n\n\nlet  c = 'x'\n",
  "unicode.js": "const s = 'é😀' ;\nconst t = \"世界\"  ;\n",
  "bom.js": "\uFEFFconst a = 1 ;\n",
  "crlf.js": "const a = 1;\r\nconst b = 2;\r\n",
  "tabs.js": "function f() {\n\treturn 1;\n}\n",
  "clean.js": "const a = 1;\n",
  "types.ts": "type A = {a:string}\n",
  "long.js": "call(firstArgument, secondArgument, thirdArgument, fourthArgument, fifthArgument, sixth);\n",
  "off.js": "// eslint-disable-next-line prettier/prettier\nconst a = {b:1}\n",
  "ignored.js": "const a = {b:1}\n",
  "git.js": "const a = {b:1}\n",
  "rc/a.js": 'const a = "x";\n',
  "rc/override.mjs": "const a = 'x'\n",
  "rc/norc.js": "const a = 'x'\n",
  "rc/option.js": "const a = 'x'\nf(b => b)\n",
  "rc/.prettierrc": '{"semi":false,"singleQuote":true,"overrides":[{"files":"*.mjs","options":{"semi":true}}]}',
  ".prettierignore": "ignored.js\n",
  ".gitignore": "git.js\n",
};
const blocks = [
  {
    "files": ["rc/norc.js"],
    "rules": {
      "prettier/prettier": [
        "error",
        {},
        {
          "usePrettierrc": false,
        },
      ],
    },
  },
  {
    "files": ["rc/option.js"],
    "rules": {
      "prettier/prettier": [
        "error",
        {
          "semi": true,
          "arrowParens": "avoid",
        },
      ],
    },
  },
];

// What ESLint 10.12.0 reports with eslint-plugin-prettier 5.5.6 and Prettier 3.9.9.
const expected = {
  "basic.js": [
    '1:12-1:16 replace [11,15] " b: 1 };" Replace `b:1}` with `·b:·1·};`',
    '2:5-3:1 replace [20,26] "a);" Replace `·a·);⏎` with `a);`',
    '5:5-5:13 replace [32,40] "c = \\"x\\";" Replace `·c·=·\'x\'` with `c·=·"x";`',
  ],
  "unicode.js": [
    '1:11-1:17 replace [10,16] "\\"é😀\\"" Replace `\'é😀\'·` with `"é😀"`',
    '2:15-2:17 delete [32,34] "" Delete `··`',
  ],
  "bom.js": ['1:12-1:13 delete [11,12] "" Delete `·`'],
  "crlf.js": ['1:13-1:14 delete [12,13] "" Delete `␍`', '2:13-2:14 delete [26,27] "" Delete `␍`'],
  "tabs.js": ['2:1-2:2 replace [15,16] "  " Replace `↹` with `··`'],
  "clean.js": [],
  "types.ts": ['1:11-1:20 replace [10,19] " a: string };" Replace `a:string}` with `·a:·string·};`'],
  "long.js": [
    '1:6-1:88 replace [5,87] "\\n  firstArgument,\\n  secondArgument,\\n  thirdArgument,\\n  fourthArgument,\\n  fifthArgument,\\n  sixth,\\n" Replace `firstArgument,·secondArgument,·thirdArgument,·fourthArgument,·fifthArgument,·sixth` with `⏎··firstArgument,⏎··secondArgument,⏎··thirdArgument,⏎··fourthArgument,⏎··fifthArgument,⏎··sixth,⏎`',
  ],
  "off.js": [],
  "ignored.js": [],
  "git.js": ['1:12-1:16 replace [11,15] " b: 1 };" Replace `b:1}` with `·b:·1·};`'],
  "rc/a.js": ["1:11-1:15 replace [10,14] \"'x'\" Replace `\"x\";` with `'x'`"],
  "rc/override.mjs": ['1:14-1:14 insert [13,13] ";" Insert `;`'],
  "rc/norc.js": ['1:11-1:14 replace [10,13] "\\"x\\";" Replace `\'x\'` with `"x";`'],
  "rc/option.js": ['1:14-1:14 insert [13,13] ";" Insert `;`', '2:10-2:10 insert [23,23] ";" Insert `;`'],
};
const fixed = {
  "basic.js": 'const a = { b: 1 };\nfoo(a);\n\nlet c = "x";\n',
  "unicode.js": 'const s = "é😀";\nconst t = "世界";\n',
  "bom.js": "\uFEFFconst a = 1;\n",
  "crlf.js": "const a = 1;\nconst b = 2;\n",
  "tabs.js": "function f() {\n  return 1;\n}\n",
  "types.ts": "type A = { a: string };\n",
  "long.js":
    "call(\n  firstArgument,\n  secondArgument,\n  thirdArgument,\n  fourthArgument,\n  fifthArgument,\n  sixth,\n);\n",
  "git.js": "const a = { b: 1 };\n",
  "rc/a.js": "const a = 'x'\n",
  "rc/override.mjs": "const a = 'x';\n",
  "rc/norc.js": 'const a = "x";\n',
  "rc/option.js": "const a = 'x';\nf(b => b);\n",
};

describe.concurrent("prettier/prettier", () => {
  test("reports what the rule of the package reports", async () => {
    const { reports, exitCode } = await lint({ ...files, ...installed(), "eslint.config.mjs": config(blocks) });
    expect(reports).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  test("--fix-dry-run gives the text of Prettier", async () => {
    const { outputs } = await lint({ ...files, ...installed(), "eslint.config.mjs": config(blocks) }, "--fix-dry-run");
    expect(outputs).toEqual(fixed);
  });

  test.each([
    [
      "another minor version of prettier",
      installed("3.3.3"),
      {},
      "the prettier that is installed is not 3.9, which bun format follows",
    ],
    [
      "another major version of prettier",
      installed("2.8.8"),
      {},
      "the prettier that is installed is not 3.9, which bun format follows",
    ],
    [
      "no prettier",
      {
        "node_modules/eslint-plugin-prettier/package.json":
          installed()["node_modules/eslint-plugin-prettier/package.json"],
      },
      {},
      "the prettier that is installed is not 3.9, which bun format follows",
    ],
    [
      "another major version of the plugin",
      installed("3.9.9", "4.2.1"),
      {},
      "the eslint-plugin-prettier that is installed is not 5",
    ],
    [
      "a plugin of Prettier that is not built in",
      installed(),
      { ".prettierrc": `{ "plugins": ["prettier-plugin-of-theirs"] }` },
      "a plugin of Prettier that bun format does not have may print them",
    ],
  ])("the rule of the package is asked: %s", async (_, packages, more, why) => {
    const files = { "a.js": "const a = {b:1}\n", ...packages, ...more, "eslint.config.mjs": config() };
    // A note is for people.
    const [{ reports }, { stderr }] = await Promise.all([lint(files), run(files, "-f", "stylish")]);
    expect(reports).toEqual({ "a.js": ["theirs"] });
    expect(stderr.split("\n")).toContain(`note: prettier/prettier ran in JavaScript for 1 file: ${why}.`);
  });

  // The parser of ESLint takes it, that of Prettier, which goes by the name of the file, does not.
  test("the rule of the package is asked: a syntax error that only the formatter finds", async () => {
    const blocks = [{ files: ["a.js"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } } }];
    const files = {
      "a.js": "namespace N {\n  export const a = 1;\n}\n",
      "b.js": "const a = {b:1}\n",
      ...installed(),
      "eslint.config.mjs": config(blocks),
    };
    const [{ reports }, { stderr }] = await Promise.all([lint(files), run(files, "-f", "stylish")]);
    expect(reports).toEqual({ "a.js": ["theirs"], "b.js": expected["git.js"] });
    expect(stderr.split("\n")).toContain(
      "note: prettier/prettier ran in JavaScript for 1 file: bun format finds a syntax error in them.",
    );
  });

  test("a comment turns the rule of the package off as well, and is not called unused", async () => {
    const files = {
      // The stand-in reports the `Program`, which begins where the text does.
      "a.js": "const a = {b:1} // eslint-disable-line prettier/prettier\n",
      "b.js": "/* eslint-disable prettier/prettier */\nconst a = {b:1}\n",
      "c.js": "const a = {b:1}\n",
      ...installed("3.3.3"),
      "eslint.config.mjs": config(),
    };
    expect((await lint(files)).reports).toEqual({ "a.js": [], "b.js": [], "c.js": ["theirs"] });
  });

  // As with pnpm, where a package of the workspace has the configuration: from the working directory neither is to be found.
  test("the versions are those of the plugin that the configuration has loaded", async () => {
    const shared = "packages/config/node_modules";
    const files = {
      "a.js": "const a = {b:1}\n",
      [`${shared}/prettier/package.json`]: JSON.stringify({ name: "prettier", version: "3.9.9" }),
      [`${shared}/eslint-plugin-prettier/package.json`]: JSON.stringify({
        name: "eslint-plugin-prettier",
        version: "5.5.6",
        main: "index.js",
      }),
      [`${shared}/eslint-plugin-prettier/index.js`]: `module.exports = { meta: { name: "eslint-plugin-prettier", version: "5.5.6" }, rules: { prettier: ${theirs} } };`,
      "packages/config/index.mjs": `import prettier from "eslint-plugin-prettier";
        export default [{ ignores: ["eslint.config.mjs", "packages"] }, { plugins: { prettier }, rules: { "prettier/prettier": "error" } }];`,
      "eslint.config.mjs": `export { default } from "./packages/config/index.mjs";`,
    };
    const [{ reports }, { stderr }] = await Promise.all([lint(files), run(files, "-f", "stylish")]);
    expect(reports).toEqual({ "a.js": expected["git.js"] });
    expect(stderr).not.toContain("ran in JavaScript");
  });

  // A project that is half way from one major version of the plugin to the next.
  test("of two plugins under the one name each file has its own", async () => {
    const copy = (directory: string, version: string) => ({
      [`${directory}/node_modules/prettier/package.json`]: JSON.stringify({ name: "prettier", version: "3.9.9" }),
      [`${directory}/node_modules/eslint-plugin-prettier/package.json`]: JSON.stringify({
        name: "eslint-plugin-prettier",
        version,
        main: "index.js",
      }),
      [`${directory}/node_modules/eslint-plugin-prettier/index.js`]: `module.exports = { meta: { name: "eslint-plugin-prettier", version: "${version}" }, rules: { prettier: ${theirs} } };`,
      [`${directory}/plugin.mjs`]: `export { default } from "eslint-plugin-prettier";`,
      [`${directory}/a.js`]: "const a = {b:1}\n",
    });
    const files = {
      ...copy("x", "5.5.6"),
      ...copy("y", "4.2.1"),
      "eslint.config.mjs": `import x from "./x/plugin.mjs";
        import y from "./y/plugin.mjs";
        export default [
          { ignores: ["eslint.config.mjs", "**/plugin.mjs"] },
          { files: ["x/**"], plugins: { prettier: x }, rules: { "prettier/prettier": "error" } },
          { files: ["y/**"], plugins: { prettier: y }, rules: { "prettier/prettier": "error" } },
        ];`,
    };
    const [{ reports }, { stderr }] = await Promise.all([lint(files), run(files, "-f", "stylish")]);
    expect(reports).toEqual({ "x/a.js": expected["git.js"], "y/a.js": ["theirs"] });
    expect(stderr.split("\n")).toContain(
      "note: prettier/prettier ran in JavaScript for 1 file: the eslint-plugin-prettier that is installed is not 5.",
    );
  });

  // It is `bun format`, which also leaves alone what `.gitignore` names. The comment in off.js is for the other rule.
  test("bun/format reports the same, and nothing has to be installed", async () => {
    const own = (text: string) => text.replaceAll("prettier/prettier", "bun/format");
    const { "off.js": _, ...others } = files;
    const { "off.js": __, ...reported } = expected;
    const { reports, stderr, exitCode } = await lint({ ...others, "eslint.config.mjs": own(config(blocks)) });
    expect(reports).toEqual({ ...reported, "git.js": [] });
    expect(stderr).not.toContain("ran in JavaScript");
    expect(exitCode).toBe(1);
  });

  test("the rule of the package is asked: an option that is not Prettier's", async () => {
    const blocks = [{ rules: { "prettier/prettier": ["error", { optionOfTheirs: true }] } }];
    const files = { "a.js": "const a = {b:1}\n", ...installed(), "eslint.config.mjs": config(blocks) };
    const [{ reports }, { stderr }] = await Promise.all([lint(files), run(files, "-f", "stylish")]);
    expect(reports).toEqual({ "a.js": ["theirs"] });
    expect(stderr.split("\n")).toContain(
      "note: prettier/prettier ran in JavaScript for 1 file: bun format does not know one of the options.",
    );
  });
});
