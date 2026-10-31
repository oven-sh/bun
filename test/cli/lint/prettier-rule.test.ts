// `prettier/prettier` is built in. It reports where a file differs from `bun fmt`'s output. It only replaces
// eslint-plugin-prettier's rule where that output matches Prettier's byte for byte. Otherwise the package's rule runs.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// A run with an `eslint.config.mjs` evaluates the config in JavaScript, and some also run the package's rule there. In a
// debug build such a run takes seconds, and longer while the runs of four other tests go on: more than the 5 s that a
// test has by default. A build that is not a debug build keeps the limit that it has.
const timeout = isDebug ? 120_000 : undefined;

// A stub for the package's rule, which shows which of the two rules ran. Its options are validated by its own schema
// too.
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

/**
 * Runs `bun lint ...flags .` in a temporary directory with `files`. In `stdout` and `stderr` that directory is `<dir>`,
 * and the summary line has no time. `raw` is stdout as it was printed.
 */
async function run(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("prettier-rule", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...flags, "."],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [raw, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const tidy = (text: string) => normalizeBunSnapshot(text, String(dir));
  return { root: realpathSync(String(dir)), raw, stdout: tidy(raw), stderr: tidy(stderr), exitCode };
}

/** What a `-f json` run reported in each file, and how it ended. `outputs` is what `--fix-dry-run` made of the files. */
type Linted = { reports: Record<string, string[]>; outputs?: Record<string, string>; stderr: string; exitCode: number };

async function lint(files: Record<string, string>, ...flags: string[]): Promise<Linted> {
  const { root, raw, stderr, exitCode } = await run(files, "-f", "json", ...flags);
  // A run that crashed printed no report. This fails with what the run said, not with a parse error.
  expect(exitCode, stderr).toBeOneOf([0, 1]);
  const results: { filePath: string; messages: Message[]; output?: string }[] = JSON.parse(raw);
  const name = (path: string) => relative(root, path).replaceAll("\\", "/");
  // A report of the two rules has a fix and says which kind: `insert`, `delete` or `replace`. Any other is its message.
  const summarize = (it: Message) =>
    it.fix && it.messageId
      ? `${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.messageId} [${it.fix.range}] ${JSON.stringify(it.fix.text)} ${it.message}`
      : it.message;
  const outputs = results.flatMap(it => (it.output === undefined ? [] : [[name(it.filePath), it.output]]));
  return {
    reports: Object.fromEntries(results.map(it => [name(it.filePath), it.messages.map(summarize)])),
    ...(outputs.length > 0 && { outputs: Object.fromEntries(outputs) }),
    stderr,
    exitCode,
  };
}

/** `-f stylish`, a format for people: the notes are printed, and stdout has the path of each file with a report. */
async function stylish(files: Record<string, string>) {
  const { stdout, stderr, exitCode } = await run(files, "-f", "stylish");
  return { stdout, stderr, exitCode };
}

/** `-f unix` with an oxlint config: the lines about `bun/format`. oxlint's default rules report in these files too. */
async function unix(files: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(files, "-f", "unix", ...flags);
  return { reports: stdout.split("\n").filter(it => it.includes("bun(format)")), stderr, exitCode };
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
  test("reports the same as the package's rule", { timeout }, async () => {
    expect(await lint({ ...files, ...installed(), "eslint.config.mjs": config(blocks) })).toEqual({
      reports: expected,
      stderr: "Linted 15 files",
      exitCode: 1,
    });
  });

  test("--fix-dry-run produces Prettier's output", { timeout }, async () => {
    const project = { ...files, ...installed(), "eslint.config.mjs": config(blocks) };
    expect(await lint(project, "--fix-dry-run")).toEqual({
      // Nothing is left to report in the fixed text.
      reports: Object.fromEntries(Object.keys(expected).map(it => [it, []])),
      outputs: fixed,
      stderr: "✓ No problems in 15 files",
      exitCode: 0,
    });
  });

  test.each([
    [
      "a different minor version of prettier",
      installed("3.3.3"),
      {},
      "the installed prettier is not version 3.9, which bun fmt matches",
    ],
    [
      "a different major version of prettier",
      installed("2.8.8"),
      {},
      "the installed prettier is not version 3.9, which bun fmt matches",
    ],
    [
      "prettier isn't installed",
      {
        "node_modules/eslint-plugin-prettier/package.json":
          installed()["node_modules/eslint-plugin-prettier/package.json"],
      },
      {},
      "the installed prettier is not version 3.9, which bun fmt matches",
    ],
    [
      "a different major version of the plugin",
      installed("3.9.9", "4.2.1"),
      {},
      "the installed eslint-plugin-prettier is not version 5",
    ],
    [
      "a Prettier plugin that isn't built in",
      installed(),
      { ".prettierrc": `{ "plugins": ["prettier-plugin-of-theirs"] }` },
      "the Prettier config uses a plugin that bun fmt does not include",
    ],
    [
      "an option that isn't Prettier's",
      installed(),
      { "eslint.config.mjs": config([{ rules: { "prettier/prettier": ["error", { optionOfTheirs: true }] } }]) },
      "bun fmt does not support one of the options",
    ],
  ])("runs the package's rule: %s", { timeout }, async (_, packages, more, why) => {
    const files = { "a.js": "const a = {b:1}\n", "eslint.config.mjs": config(), ...packages, ...more };
    // The note is only printed in the formats meant for people. One run in such a format shows both the report of the
    // rule that ran, which is the stub's, and the note.
    expect(await stylish(files)).toEqual({
      stdout: "<dir>/a.js\n  1:1  error  theirs  prettier/prettier\n\n✖ 1 problem (1 error, 0 warnings)",
      stderr: `Linted 1 file\nnote: prettier/prettier ran in JavaScript for 1 file because ${why}`,
      exitCode: 1,
    });
  });

  // ESLint's parser accepts it. Prettier's, which is chosen by the file name, doesn't.
  test("runs the package's rule: a syntax error that only the formatter finds", { timeout }, async () => {
    const blocks = [{ files: ["a.js"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } } }];
    const files = {
      "a.js": "namespace N {\n  export const a = 1;\n}\n",
      "b.js": "const a = {b:1}\n",
      ...installed(),
      "eslint.config.mjs": config(blocks),
    };
    const [json, text] = await Promise.all([lint(files), stylish(files)]);
    expect(json).toEqual({
      reports: { "a.js": ["theirs"], "b.js": expected["git.js"] },
      stderr: "Linted 2 files",
      exitCode: 1,
    });
    expect(text).toEqual({
      stdout: [
        "<dir>/a.js",
        "  1:1  error  theirs  prettier/prettier",
        "",
        "<dir>/b.js",
        "  1:12  error  Replace `b:1}` with `·b:·1·};`  prettier/prettier",
        "",
        "✖ 2 problems (2 errors, 0 warnings)",
        "  1 error and 0 warnings potentially fixable with the `--fix` option.",
      ].join("\n"),
      stderr: [
        "Linted 2 files",
        "note: prettier/prettier ran in JavaScript for 1 file because bun fmt found a syntax error",
      ].join("\n"),
      exitCode: 1,
    });
  });

  test(
    "prettier-plugin-tailwindcss: runs the package's rule, unless Tailwind CSS isn't installed",
    { timeout },
    async () => {
      const plugin = "prettier-plugin-tailwindcss";
      const files = {
        "a.js": 'html`<a class="p-4 flex"></a>`  ;\n',
        ".prettierrc": `{ "plugins": ["${plugin}"] }`,
        ...installed(),
        "eslint.config.mjs": config(),
      };
      const [withPlugin, withPackage, without] = await Promise.all([
        lint({ ...files, [`node_modules/${plugin}/package.json`]: "{}" }),
        lint({ ...files, "node_modules/tailwindcss/package.json": "{}" }),
        lint(files),
      ]);
      expect(withPlugin).toEqual({ reports: { "a.js": ["theirs"] }, stderr: "Linted 1 file", exitCode: 1 });
      expect(withPackage).toEqual({ reports: { "a.js": ["theirs"] }, stderr: "Linted 1 file", exitCode: 1 });
      // Same as `bun fmt`, which doesn't sort the classes then.
      expect(without).toEqual({
        reports: { "a.js": ['1:31-1:33 delete [30,32] "" Delete `··`'] },
        stderr: "Linted 1 file",
        exitCode: 1,
      });
    },
  );

  test("a disable comment also turns off the package's rule, and isn't reported as unused", { timeout }, async () => {
    const files = {
      // The stub reports the `Program` node, which starts at the first token.
      "a.js": "const a = {b:1} // eslint-disable-line prettier/prettier\n",
      "b.js": "/* eslint-disable prettier/prettier */\nconst a = {b:1}\n",
      "c.js": "const a = {b:1}\n",
      ...installed("3.3.3"),
      "eslint.config.mjs": config(),
    };
    expect(await lint(files)).toEqual({
      reports: { "a.js": [], "b.js": [], "c.js": ["theirs"] },
      stderr: "Linted 3 files",
      exitCode: 1,
    });
  });

  // As with pnpm, when a workspace package has the config: neither package can be resolved from the working directory.
  test("reads the versions of the plugin and the prettier that the config loaded", { timeout }, async () => {
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
    const [json, text] = await Promise.all([lint(files), stylish(files)]);
    expect(json).toEqual({ reports: { "a.js": expected["git.js"] }, stderr: "Linted 1 file", exitCode: 1 });
    // No note: nothing ran in JavaScript.
    expect(text).toEqual({
      stdout: [
        "<dir>/a.js",
        "  1:12  error  Replace `b:1}` with `·b:·1·};`  prettier/prettier",
        "",
        "✖ 1 problem (1 error, 0 warnings)",
        "  1 error and 0 warnings potentially fixable with the `--fix` option.",
      ].join("\n"),
      stderr: "Linted 1 file",
      exitCode: 1,
    });
  });

  // A project that's halfway through migrating from one major version of the plugin to the next.
  test("with two plugins under the same name, each file uses the one its config block loads", { timeout }, async () => {
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
    const [json, text] = await Promise.all([lint(files), stylish(files)]);
    expect(json).toEqual({
      reports: { "x/a.js": expected["git.js"], "y/a.js": ["theirs"] },
      stderr: "Linted 2 files",
      exitCode: 1,
    });
    expect(text).toEqual({
      stdout: [
        "<dir>/x/a.js",
        "  1:12  error  Replace `b:1}` with `·b:·1·};`  prettier/prettier",
        "",
        "<dir>/y/a.js",
        "  1:1  error  theirs  prettier/prettier",
        "",
        "✖ 2 problems (2 errors, 0 warnings)",
        "  1 error and 0 warnings potentially fixable with the `--fix` option.",
      ].join("\n"),
      stderr: [
        "Linted 2 files",
        "note: eslint-plugin-prettier 4.2.1 is installed, but bun lint's built-in rules match 5.5.6",
        "note: prettier/prettier ran in JavaScript for 1 file because the installed eslint-plugin-prettier is not version 5",
      ].join("\n"),
      exitCode: 1,
    });
  });

  // It behaves like `bun fmt`, which also skips files in `.gitignore`. The comment in off.js is for the other rule.
  test("bun/format reports the same without anything installed", { timeout }, async () => {
    const own = (text: string) => text.replaceAll("prettier/prettier", "bun/format");
    const { "off.js": _, ...others } = files;
    const { "off.js": __, ...reported } = expected;
    expect(await lint({ ...others, "eslint.config.mjs": own(config(blocks)) })).toEqual({
      reports: { ...reported, "git.js": [] },
      stderr: "Linted 14 files",
      exitCode: 1,
    });
  });

  // No other rule would check them.
  test("bun/format reports the files it can't check, with the reason", { timeout }, async () => {
    const rule = { "eslint.config.mjs": `export default [{ rules: { "bun/format": "error" } }];` };
    const unchecked = (why: string) => [`This file was not checked because ${why}.`];
    const withClasses = {
      ...rule,
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      "a.js": 'a  (`<a class="p-4 flex">`);\nhtml`<a class="p-4 flex"></a>`;\n',
      "b.js": "b  ;\n",
      "off.js": '/* eslint-disable bun/format */\nhtml`<a class="p-4 flex"></a>`;\n',
    };
    const html = 'html`<a class="p-4 flex"></a>`;\n';
    const [plugin, classes, oxlint, checked] = await Promise.all([
      lint({ ...rule, ".prettierrc": '{ "plugins": ["prettier-plugin-brace-style"] }', "a.js": "a  ;\n" }),
      lint({ ...withClasses, "node_modules/tailwindcss/package.json": "{}" }),
      unix({
        ".oxlintrc.json": '{ "rules": { "bun/format": "error" } }',
        ".oxfmtrc.json": '{ "sortTailwindcss": true }',
        "node_modules/tailwindcss/package.json": "{}",
        "a.js": `#!/usr/bin/env bun\n// a\n${html}`,
        "off.js": `/* oxlint-disable bun/format */\n${html}`,
      }),
      lint(withClasses),
    ]);
    // This config ignores nothing, so its own file is linted as well. The file has no line break at its end.
    const spaces = ['1:2-1:4 delete [1,3] "" Delete `··`'];
    const lineBreak = ['1:55-1:55 insert [54,54] "\\n" Insert `⏎`'];
    const usesPlugin = unchecked("the Prettier config uses a plugin that bun fmt does not include");
    const hasClasses = unchecked("only bun fmt can sort Tailwind CSS classes");
    expect(plugin).toEqual({
      reports: { "a.js": usesPlugin, "eslint.config.mjs": usesPlugin },
      stderr: "Linted 2 files",
      exitCode: 1,
    });
    expect(classes).toEqual({
      reports: { "a.js": hasClasses, "b.js": spaces, "eslint.config.mjs": lineBreak, "off.js": [] },
      stderr: "Linted 4 files",
      exitCode: 1,
    });
    // An oxlint disable comment takes effect at its end, so the report goes after the comments at the top of the file.
    expect(oxlint).toEqual({ reports: [`a.js:3:1: ${hasClasses[0]} [Error/bun(format)]`], stderr: "", exitCode: 1 });
    // Without the package, `bun fmt` doesn't sort the classes, so the rule can check these files. It finds nothing in
    // off.js, where the comment then turns off no report.
    expect(checked).toEqual({
      reports: {
        "a.js": spaces,
        "b.js": spaces,
        "eslint.config.mjs": lineBreak,
        "off.js": ["Unused eslint-disable directive (no problems were reported from 'bun/format')."],
      },
      stderr: "Linted 4 files",
      exitCode: 1,
    });
  });

  test("bun/format: one package's formatter config doesn't affect another package's files", async () => {
    const files = {
      ".oxlintrc.json": '{ "rules": { "bun/format": "error" } }',
      "a/.prettierrc": '{ "sortTailwindcss": true }',
      "a/a.js": "a  ;\n",
      "b/.prettierrc": "{}",
      "b/b.js": "b  ;\n",
    };
    expect(await unix(files, "--threads=1")).toEqual({
      reports: [
        "a/a.js:1:1: This file was not checked because bun fmt does not support one of the options. [Error/bun(format)]",
        "b/b.js:1:2: Delete `··` [Error/bun(format)]",
      ],
      stderr: "",
      exitCode: 1,
    });
  });

  test("bun/format respects allowUnsupported in [fmt], like bun fmt", async () => {
    const files = {
      ".oxlintrc.json": '{ "rules": { "bun/format": "error" } }',
      ".prettierrc": '{ "plugins": ["prettier-plugin-brace-style"], "sortTailwindcss": true }',
      "bunfig.toml": "[fmt]\nallowUnsupported = true\n",
      "a.js": "a  ;\n",
      "b.js": "b;\n",
    };
    const classes = {
      ".oxlintrc.json": files[".oxlintrc.json"],
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      "bunfig.toml": files["bunfig.toml"],
      "a.js": 'html`<a class="p-4 flex"></a>`  ;\n',
      "b.js": 'html`<a class="p-4 flex"></a>`;\n',
    };
    const { ".oxfmtrc.json": _, ...rest } = classes;
    const plugin = "prettier-plugin-tailwindcss";
    const [unsupported, withoutPackage, withPackage, withPlugin, withMissingPackage] = await Promise.all([
      unix(files),
      unix(classes),
      unix({ ...classes, "node_modules/tailwindcss/package.json": "{}" }),
      unix({ ...rest, ".prettierrc": `{ "plugins": ["${plugin}"] }`, [`node_modules/${plugin}/package.json`]: "{}" }),
      unix({ ...rest, ".prettierrc": `{ "plugins": ["${plugin}"], "tailwindPackageName": "@acme/tw" }` }),
    ]);
    // Each run ends like this: the rule is set to "error", and it reports in each of them.
    const ended = { stderr: "", exitCode: 1 };
    expect(unsupported).toEqual({ reports: ["a.js:1:2: Delete `··` [Error/bun(format)]"], ...ended });
    // Without the package, the classes aren't sorted. With it, only `bun fmt` can sort them.
    expect(withoutPackage).toEqual({ reports: ["a.js:1:31: Delete `··` [Error/bun(format)]"], ...ended });
    const unchecked = "This file was not checked because only bun fmt can sort Tailwind CSS classes.";
    const neither = [`a.js:1:1: ${unchecked} [Error/bun(format)]`, `b.js:1:1: ${unchecked} [Error/bun(format)]`];
    expect(withPackage).toEqual({ reports: neither, ...ended });
    // The Prettier plugin bundles its own Tailwind CSS, which `bun fmt` uses if the project doesn't have one.
    expect(withPlugin).toEqual({ reports: neither, ...ended });
    // A `tailwindPackageName` that isn't installed is the same as no Tailwind CSS.
    expect(withMissingPackage).toEqual({ reports: ["a.js:1:31: Delete `··` [Error/bun(format)]"], ...ended });
  });

  // A component is linted script by script, under the component's file name. `--fix` once turned this whole script into
  // one comment.
  test("bun/format skips the scripts in a component", async () => {
    const script = "// a\nconst a = 1;\nexport default { data: () => ({ a }) };\n";
    const files = {
      ".oxlintrc.json": '{ "rules": { "bun/format": "error" } }',
      "a.vue": `<template>\n  <p>{{ a }}</p>\n</template>\n\n<script>\n${script}</script>\n`,
    };
    const { stdout, stderr, exitCode } = await run(files, "-f", "unix");
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});
