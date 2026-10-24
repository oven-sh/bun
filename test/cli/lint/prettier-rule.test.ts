// `prettier/prettier` is built in. It reports where a file differs from `bun fmt`'s output. It only replaces
// eslint-plugin-prettier's rule where that output matches Prettier's byte for byte. Otherwise the package's rule runs.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

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
  const summarize = (it: Message) =>
    it.fix
      ? `${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.messageId} [${it.fix.range}] ${JSON.stringify(it.fix.text)} ${it.message}`
      : it.message;
  return {
    reports: Object.fromEntries(results.map(it => [name(it.filePath), it.messages.map(summarize)])),
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
  test("reports the same as the package's rule", async () => {
    const { reports, exitCode } = await lint({ ...files, ...installed(), "eslint.config.mjs": config(blocks) });
    expect(reports).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  test("--fix-dry-run produces Prettier's output", async () => {
    const { outputs } = await lint({ ...files, ...installed(), "eslint.config.mjs": config(blocks) }, "--fix-dry-run");
    expect(outputs).toEqual(fixed);
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
  ])("runs the package's rule: %s", async (_, packages, more, why) => {
    const files = { "a.js": "const a = {b:1}\n", ...packages, ...more, "eslint.config.mjs": config() };
    // The note is only printed in the formats meant for people.
    const [{ reports }, { stderr }] = await Promise.all([lint(files), run(files, "-f", "stylish")]);
    expect(reports).toEqual({ "a.js": ["theirs"] });
    expect(stderr.split("\n")).toContain(`note: prettier/prettier ran in JavaScript for 1 file because ${why}`);
  });

  // ESLint's parser accepts it. Prettier's, which is chosen by the file name, doesn't.
  test("runs the package's rule: a syntax error that only the formatter finds", async () => {
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
      "note: prettier/prettier ran in JavaScript for 1 file because bun fmt found a syntax error",
    );
  });

  test("prettier-plugin-tailwindcss: runs the package's rule, unless Tailwind CSS isn't installed", async () => {
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
    expect(withPlugin.reports).toEqual({ "a.js": ["theirs"] });
    expect(withPackage.reports).toEqual({ "a.js": ["theirs"] });
    // Same as `bun fmt`, which doesn't sort the classes then.
    expect(without.reports).toEqual({ "a.js": ['1:31-1:33 delete [30,32] "" Delete `··`'] });
  });

  test("a disable comment also turns off the package's rule, and isn't reported as unused", async () => {
    const files = {
      // The stub reports the `Program` node, which starts at the first token.
      "a.js": "const a = {b:1} // eslint-disable-line prettier/prettier\n",
      "b.js": "/* eslint-disable prettier/prettier */\nconst a = {b:1}\n",
      "c.js": "const a = {b:1}\n",
      ...installed("3.3.3"),
      "eslint.config.mjs": config(),
    };
    expect((await lint(files)).reports).toEqual({ "a.js": [], "b.js": [], "c.js": ["theirs"] });
  });

  // As with pnpm, when a workspace package has the config: neither package can be resolved from the working directory.
  test("reads the versions of the plugin and the prettier that the config loaded", async () => {
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

  // A project that's halfway through migrating from one major version of the plugin to the next.
  test("with two plugins under the same name, each file uses the one its config block loads", async () => {
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
      "note: prettier/prettier ran in JavaScript for 1 file because the installed eslint-plugin-prettier is not version 5",
    );
  });

  // It behaves like `bun fmt`, which also skips files in `.gitignore`. The comment in off.js is for the other rule.
  test("bun/format reports the same without anything installed", async () => {
    const own = (text: string) => text.replaceAll("prettier/prettier", "bun/format");
    const { "off.js": _, ...others } = files;
    const { "off.js": __, ...reported } = expected;
    const { reports, stderr, exitCode } = await lint({ ...others, "eslint.config.mjs": own(config(blocks)) });
    expect(reports).toEqual({ ...reported, "git.js": [] });
    expect(stderr).not.toContain("ran in JavaScript");
    expect(exitCode).toBe(1);
  });

  // No other rule would check them.
  test("bun/format reports the files it can't check, with the reason", async () => {
    const rule = { "eslint.config.mjs": `export default [{ rules: { "bun/format": "error" } }];` };
    const unchecked = (why: string) => [`This file was not checked because ${why}.`];
    const plugin = await lint({
      ...rule,
      ".prettierrc": '{ "plugins": ["prettier-plugin-brace-style"] }',
      "a.js": "a  ;\n",
    });
    expect(plugin.reports["a.js"]).toEqual(
      unchecked("the Prettier config uses a plugin that bun fmt does not include"),
    );
    expect(plugin.exitCode).toBe(1);
    const withClasses = {
      ...rule,
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      "a.js": 'a  (`<a class="p-4 flex">`);\nhtml`<a class="p-4 flex"></a>`;\n',
      "b.js": "b  ;\n",
      "off.js": '/* eslint-disable bun/format */\nhtml`<a class="p-4 flex"></a>`;\n',
    };
    const classes = await lint({ ...withClasses, "node_modules/tailwindcss/package.json": "{}" });
    expect(classes.reports["a.js"]).toEqual(unchecked("only bun fmt can sort Tailwind CSS classes"));
    expect(classes.reports["off.js"]).toEqual([]);
    expect(classes.reports["b.js"]).toEqual(['1:2-1:4 delete [1,3] "" Delete `··`']);
    expect(classes.exitCode).toBe(1);
    // An oxlint disable comment takes effect at its end, so the report goes after the comments at the top of the file.
    const html = 'html`<a class="p-4 flex"></a>`;\n';
    const { stdout } = await run(
      {
        ".oxlintrc.json": '{ "rules": { "bun/format": "error" } }',
        ".oxfmtrc.json": '{ "sortTailwindcss": true }',
        "node_modules/tailwindcss/package.json": "{}",
        "a.js": `#!/usr/bin/env bun\n// a\n${html}`,
        "off.js": `/* oxlint-disable bun/format */\n${html}`,
      },
      "-f",
      "unix",
    );
    const formatReports = stdout.split("\n").filter(it => it.includes("bun(format)"));
    expect(formatReports.map(it => it.split(": ")[0])).toEqual(["a.js:3:1"]);
    // Without the package, `bun fmt` doesn't sort the classes, so the rule can check these files.
    const { reports, exitCode } = await lint(withClasses);
    expect(reports).toMatchObject({
      "a.js": ['1:2-1:4 delete [1,3] "" Delete `··`'],
      "b.js": ['1:2-1:4 delete [1,3] "" Delete `··`'],
    });
    expect(exitCode).toBe(1);
  });

  test("bun/format: one package's formatter config doesn't affect another package's files", async () => {
    const { stdout } = await run(
      {
        ".oxlintrc.json": '{ "rules": { "bun/format": "error" } }',
        "a/.prettierrc": '{ "sortTailwindcss": true }',
        "a/a.js": "a  ;\n",
        "b/.prettierrc": "{}",
        "b/b.js": "b  ;\n",
      },
      "-f",
      "unix",
      "--threads=1",
    );
    expect(stdout.split("\n").filter(it => it.includes("bun(format)"))).toEqual([
      "a/a.js:1:1: This file was not checked because bun fmt does not support one of the options. [Error/bun(format)]",
      "b/b.js:1:2: Delete `··` [Error/bun(format)]",
    ]);
  });

  test("bun/format respects allowUnsupported in [fmt], like bun fmt", async () => {
    const files = {
      ".oxlintrc.json": '{ "rules": { "bun/format": "error" } }',
      ".prettierrc": '{ "plugins": ["prettier-plugin-brace-style"], "sortTailwindcss": true }',
      "bunfig.toml": "[fmt]\nallowUnsupported = true\n",
      "a.js": "a  ;\n",
      "b.js": "b;\n",
    };
    const { stdout, exitCode } = await run(files, "-f", "unix");
    expect(stdout.split("\n").filter(it => it.includes("bun(format)"))).toEqual([
      "a.js:1:2: Delete `··` [Error/bun(format)]",
    ]);
    expect(exitCode).toBe(1);
    // Without the package, the classes aren't sorted. With it, only `bun fmt` can sort them.
    const classes = {
      ".oxlintrc.json": files[".oxlintrc.json"],
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      "bunfig.toml": files["bunfig.toml"],
      "a.js": 'html`<a class="p-4 flex"></a>`  ;\n',
      "b.js": 'html`<a class="p-4 flex"></a>`;\n',
    };
    const reportsOf = async (files: Record<string, string>) =>
      (await run(files, "-f", "unix")).stdout.split("\n").filter(it => it.includes("bun(format)"));
    expect(await reportsOf(classes)).toEqual(["a.js:1:31: Delete `··` [Error/bun(format)]"]);
    const unchecked = "This file was not checked because only bun fmt can sort Tailwind CSS classes.";
    expect(await reportsOf({ ...classes, "node_modules/tailwindcss/package.json": "{}" })).toEqual([
      `a.js:1:1: ${unchecked} [Error/bun(format)]`,
      `b.js:1:1: ${unchecked} [Error/bun(format)]`,
    ]);
    // The Prettier plugin bundles its own Tailwind CSS, which `bun fmt` uses if the project doesn't have one.
    const { ".oxfmtrc.json": _, ...rest } = classes;
    const plugin = "prettier-plugin-tailwindcss";
    expect(
      await reportsOf({
        ...rest,
        ".prettierrc": `{ "plugins": ["${plugin}"] }`,
        [`node_modules/${plugin}/package.json`]: "{}",
      }),
    ).toEqual([`a.js:1:1: ${unchecked} [Error/bun(format)]`, `b.js:1:1: ${unchecked} [Error/bun(format)]`]);
    // A `tailwindPackageName` that isn't installed is the same as no Tailwind CSS.
    expect(
      await reportsOf({ ...rest, ".prettierrc": `{ "plugins": ["${plugin}"], "tailwindPackageName": "@acme/tw" }` }),
    ).toEqual(["a.js:1:31: Delete `··` [Error/bun(format)]"]);
  });

  // A component is linted script by script, under the component's file name. `--fix` once turned this whole script into
  // one comment.
  test("bun/format skips the scripts in a component", async () => {
    const script = "// a\nconst a = 1;\nexport default { data: () => ({ a }) };\n";
    const files = {
      ".oxlintrc.json": '{ "rules": { "bun/format": "error" } }',
      "a.vue": `<template>\n  <p>{{ a }}</p>\n</template>\n\n<script>\n${script}</script>\n`,
    };
    expect(await run(files, "-f", "unix")).toMatchObject({ stdout: "", exitCode: 0 });
  });

  test("runs the package's rule: an option that isn't Prettier's", async () => {
    const blocks = [{ rules: { "prettier/prettier": ["error", { optionOfTheirs: true }] } }];
    const files = { "a.js": "const a = {b:1}\n", ...installed(), "eslint.config.mjs": config(blocks) };
    const [{ reports }, { stderr }] = await Promise.all([lint(files), run(files, "-f", "stylish")]);
    expect(reports).toEqual({ "a.js": ["theirs"] });
    expect(stderr.split("\n")).toContain(
      "note: prettier/prettier ran in JavaScript for 1 file because bun fmt does not support one of the options",
    );
  });
});
