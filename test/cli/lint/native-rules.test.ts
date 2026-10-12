// `bun lint` in a project without a config of ESLint or oxlint: every built-in rule can be set in `[lint.rules]` of bunfig.toml,
// with `--rule` and in comments, under every name it has. A name of no rule is an error.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

async function lint(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("bun-lint-native", files);
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

type Setting = string | [string, ...unknown[]];

/** TOML has JSON's strings, numbers, booleans and arrays. */
const toml = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(toml).join(", ")}]`
    : value !== null && typeof value === "object"
      ? `{ ${Object.entries(value)
          .map(([key, value]) => `${JSON.stringify(key)} = ${toml(value)}`)
          .join(", ")} }`
      : JSON.stringify(value);

const bunfig = (rules: Record<string, Setting>) => ({
  "bunfig.toml": `[lint.rules]\n${Object.entries(rules)
    .map(([id, setting]) => `${JSON.stringify(id)} = ${toml(setting)}\n`)
    .join("")}`,
});

/** `file:line rule` of each problem, in the order of the report. */
const problems = (stdout: string) =>
  (JSON.parse(stdout) as { filePath: string; messages: { line: number; ruleId: string | null; severity: number }[] }[])
    .flatMap(file => file.messages.map(it => `${basename(file.filePath)}:${it.line} ${it.ruleId}`))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

/** What can be before the name of a rule, by what `--rules` calls the plugin. A report has the first. */
const spellings: Record<string, string[]> = {
  "eslint": ["", "eslint/"],
  "typescript": ["@typescript-eslint/", "typescript-eslint/", "typescript/"],
  "react": ["react/"],
  "react-hooks": ["react-hooks/", "react_hooks/", "react/"],
  "react_perf": ["react-perf/", "react_perf/"],
  "jsx_a11y": ["jsx-a11y/", "jsx_a11y/"],
  "nextjs": ["@next/next/", "nextjs/"],
  "node": ["n/", "node/"],
  "import": ["import/", "import-x/"],
  "unicorn": ["unicorn/"],
  "oxc": ["oxc/"],
  "promise": ["promise/"],
  "jest": ["jest/"],
  "vitest": ["vitest/"],
  "prettier": ["prettier/"],
  "bun": ["bun/"],
  "bun:test": ["bun:test/"],
};

/** The one rule that does not run without an option. */
const setting = (id: string, severity: string): Setting =>
  id.endsWith("enforce-node-protocol-usage") ? [severity, "always"] : severity;

describe.concurrent("every built-in rule", () => {
  const sources = { "a.js": "", "b.jsx": "", "c.ts": "", "d.tsx": "" };

  async function listed() {
    const { stdout } = await lint({}, ["--rules", "-f", "json"]);
    const rules = JSON.parse(stdout) as { scope: string; value: string }[];
    expect(rules.length).toBeGreaterThan(1000);
    expect([...new Set(rules.map(it => it.scope))].filter(it => !(it in spellings))).toEqual([]);
    return rules;
  }

  /** The rules that are set for `file`, with their severities. */
  async function configured(files: Record<string, string>, file: string) {
    const { stdout, stderr, exitCode } = await lint({ ...sources, ...files }, ["--print-config", file]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { rules } = JSON.parse(stdout) as { rules: Record<string, [number, ...unknown[]]> };
    return new Map(Object.entries(rules).map(([id, [severity]]) => [id, severity]));
  }

  test("is accepted under each of its names, and is called the same whatever it is written as", async () => {
    const rules = await listed();
    // oxlint has the rules of eslint-plugin-react-hooks in `react`, and so has the list.
    const asListed = await configured(
      bunfig(Object.fromEntries(rules.map(it => [`${it.scope}/${it.value}`, setting(it.value, "error")]))),
      "d.tsx",
    );
    const ofHooks = (it: { scope: string; value: string }) =>
      it.scope === "react" && asListed.has(`react-hooks/${it.value}`);
    expect(rules.filter(ofHooks).map(it => it.value)).toContain("rules-of-hooks");
    expect(rules.filter(ofHooks).map(it => it.value)).toContain("exhaustive-deps");
    expect(rules.filter(ofHooks).map(it => it.value)).not.toContain("jsx-key");
    const names = rules.map(it => spellings[ofHooks(it) ? "react-hooks" : it.scope].map(prefix => prefix + it.value));
    const ids = names.map(it => it[0]).sort();
    const on = (found: Map<string, number>) =>
      [...found].flatMap(([id, severity]) => (severity === 2 ? [id] : [])).sort();
    expect(on(asListed)).toEqual(ids);
    await Promise.all(
      [0, 1, 2].map(async nth => {
        const written = names.map(it => it[Math.min(nth, it.length - 1)]);
        const found = await configured(
          bunfig(Object.fromEntries(written.map(id => [id, setting(id, "error")]))),
          "a.js",
        );
        expect(on(found)).toEqual(ids);
      }),
    );
  });

  test("can be an error in a project with JavaScript, JSX and TypeScript", async () => {
    const rules = await listed();
    const all = bunfig(Object.fromEntries(rules.map(it => [`${it.scope}/${it.value}`, setting(it.value, "error")])));
    const code = "export const value = 1;\n";
    const files = Object.fromEntries(Object.keys(sources).map(name => [name, code]));
    const [{ stdout, stderr, exitCode }, ...perFile] = await Promise.all([
      lint({ ...files, ...all }, ["-f", "json"]),
      ...Object.keys(sources).map(file => configured(all, file)),
    ]);
    expect(stderr).not.toContain("error:");
    expect((JSON.parse(stdout) as { filePath: string }[]).map(it => basename(it.filePath)).sort()).toEqual(
      Object.keys(sources),
    );
    expect(exitCode).toBe(1);
    for (const found of perFile) {
      expect([...found.values()].filter(severity => severity !== 2)).toEqual([]);
      expect(found.size).toBe(rules.length);
    }
  });

  test("a rule of typescript-eslint in a project with one JavaScript file", async () => {
    const { stdout, stderr, exitCode } = await lint(
      { "a.js": "const self = this;\nexport { self };\n", ...bunfig({ "@typescript-eslint/no-this-alias": "error" }) },
      ["-f", "json"],
    );
    expect(stderr).not.toContain("error:");
    expect(problems(stdout)).toEqual(["a.js:1 @typescript-eslint/no-this-alias"]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("rules of every plugin report", () => {
  const files = {
    "a.js": `import b from "./b.js";
import c from "./b.js";
import self from "./a.js";
var a = null;
[1].map(x => [x]).flat();
if (a) throw Error("a");
import late from "./late.js";
exports = {};
new require("a");
process.exit(1);
if (a < b < c) a();
[1].reduce((all, x) => [...all, x], []);
new Promise((ok, no) => ok(no));
new Promise.resolve();
export default [b, c, self, late];
`,
    "b.js": `import a from "./a.js";\nexport default a;\n`,
    "late.js": "export default 1;\n",
    "a.test.js": `import { test as t } from "node:test";
it.only("a", () => {});
it("b", () => {});
it("b", () => {});
t();
`,
    "view.tsx": `import { useEffect, useState } from "react";
export function A({ list, on }: { list: any[]; on: Object }) {
  if (on) {
    useState(0);
  }
  useEffect(() => {
    console.log(list);
  }, []);
  const now = Date.now();
  return (
    <div dangerouslySetInnerHTML={{ __html: "a" }} title={now}>
      {list.map(it => (
        <img src={it} />
      ))}
      <a>b</a>
      <script src="https://a.b/c.js"></script>
      <B list={[]} />
    </div>
  );
}
`,
  };
  // As it is written, and where it reports as what.
  const rules: [written: string, reports: string[]][] = [
    ["unicorn/no-null", ["a.js:4 unicorn/no-null"]],
    ["unicorn/prefer-array-flat-map", ["a.js:5 unicorn/prefer-array-flat-map"]],
    ["unicorn/throw-new-error", ["a.js:6 unicorn/throw-new-error"]],
    ["import/no-self-import", ["a.js:3 import/no-self-import"]],
    ["import/no-duplicates", ["a.js:1 import/no-duplicates", "a.js:2 import/no-duplicates"]],
    ["import/no-cycle", ["a.js:1 import/no-cycle", "b.js:1 import/no-cycle"]],
    ["import-x/first", ["a.js:7 import/first"]],
    ["jest/no-focused-tests", ["a.test.js:2 jest/no-focused-tests"]],
    ["jest/no-identical-title", ["a.test.js:4 jest/no-identical-title"]],
    ["vitest/no-focused-tests", ["a.test.js:2 vitest/no-focused-tests"]],
    ["vitest/no-import-node-test", ["a.test.js:1 vitest/no-import-node-test"]],
    ["jsx-a11y/alt-text", ["view.tsx:13 jsx-a11y/alt-text"]],
    ["jsx_a11y/anchor-is-valid", ["view.tsx:15 jsx-a11y/anchor-is-valid"]],
    ["@next/next/no-img-element", ["view.tsx:13 @next/next/no-img-element"]],
    ["nextjs/no-sync-scripts", ["view.tsx:16 @next/next/no-sync-scripts"]],
    ["n/no-exports-assign", ["a.js:8 n/no-exports-assign"]],
    ["node/no-new-require", ["a.js:9 n/no-new-require"]],
    ["n/no-process-exit", ["a.js:10 n/no-process-exit"]],
    ["oxc/bad-comparison-sequence", ["a.js:11 oxc/bad-comparison-sequence"]],
    ["oxc/no-accumulating-spread", ["a.js:12 oxc/no-accumulating-spread"]],
    ["promise/param-names", ["a.js:13 promise/param-names", "a.js:13 promise/param-names"]],
    ["promise/no-new-statics", ["a.js:14 promise/no-new-statics"]],
    ["react/jsx-key", ["view.tsx:13 react/jsx-key"]],
    ["react/no-danger", ["view.tsx:11 react/no-danger"]],
    ["react/rules-of-hooks", ["view.tsx:4 react-hooks/rules-of-hooks"]],
    ["react-hooks/exhaustive-deps", ["view.tsx:8 react-hooks/exhaustive-deps"]],
    // Both eslint-plugin-react-hooks and oxlint have it: the first answers.
    ["react/purity", ["view.tsx:9 react-hooks/purity"]],
    ["react-perf/jsx-no-new-object-as-prop", ["view.tsx:11 react-perf/jsx-no-new-object-as-prop"]],
    ["react_perf/jsx-no-new-array-as-prop", ["view.tsx:17 react-perf/jsx-no-new-array-as-prop"]],
    ["typescript/no-explicit-any", ["view.tsx:2 @typescript-eslint/no-explicit-any"]],
    // Only oxlint still has it.
    ["@typescript-eslint/ban-types", ["view.tsx:2 @typescript-eslint/ban-types"]],
    ["eslint/no-var", ["a.js:4 no-var"]],
  ];
  const expected = rules.flatMap(it => it[1]).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const ids = new Set(expected.map(it => it.slice(it.indexOf(" ") + 1)));
  const ofThese = (stdout: string) => problems(stdout).filter(it => ids.has(it.slice(it.indexOf(" ") + 1)));

  test("[lint.rules]", async () => {
    const { stdout, exitCode } = await lint(
      { ...files, ...bunfig(Object.fromEntries(rules.map(it => [it[0], "error"]))) },
      ["-f", "json"],
    );
    expect(ofThese(stdout)).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  test("--rule", async () => {
    const { stdout, exitCode } = await lint(files, [
      "-f",
      "json",
      "--rule",
      JSON.stringify(Object.fromEntries(rules.map(it => [it[0], "error"]))),
    ]);
    expect(ofThese(stdout)).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  test("none of them without a word", async () => {
    const { stdout } = await lint(files, ["-f", "json"]);
    // What is on for TypeScript by default.
    expect(ofThese(stdout)).toEqual(["view.tsx:2 @typescript-eslint/no-explicit-any"]);
  });

  test("prettier/prettier needs no package", async () => {
    const { stdout } = await lint({ "a.js": "export   const a = 1\n", ...bunfig({ "prettier/prettier": "error" }) }, [
      "-f",
      "unix",
    ]);
    expect(stdout).toContain("a.js:1:8: Replace `··const·a·=·1` with `const·a·=·1;` [Error/prettier/prettier]");
  });

  test("the help of a rule of oxlint", async () => {
    const { stdout } = await lint({ "a.js": "export default null;\n", ...bunfig({ "unicorn/no-null": "error" }) }, [
      "-f",
      "pretty",
    ]);
    expect(stdout).toContain("Replace `null` with `undefined`.");
  });
});

describe.concurrent("options", () => {
  // Rules as oxlint has them, whose options are oxlint's.
  const cases: [id: string, options: unknown[], code: string, lines: number[], withoutOptions: number[]][] = [
    ["jest/max-expects", [{ max: 1 }], `it("a", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n`, [3], []],
    [
      "promise/param-names",
      [{ resolvePattern: "^ok$" }],
      "new Promise(ok => ok());\nnew Promise(resolve => resolve());\n",
      [2],
      [1],
    ],
    ["unicorn/catch-error-name", [{ name: "oops" }], "try {\n} catch (error) {\n  f(error);\n}\n", [2], []],
    ["jsx-a11y/alt-text", [{ img: ["Picture"] }], "export default <Picture />;\n", [1], []],
    ["vitest/max-expects", [{ max: 1 }], `it("a", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n`, [3], []],
    ["n/no-process-env", [{ allowedVariables: ["A"] }], "process.env.A;\nprocess.env.B;\n", [2], [1, 2]],
  ];

  test.each(cases)("%s", async (id, options, code, lines, withoutOptions) => {
    const of = (stdout: string) => problems(stdout).filter(it => it.endsWith(` ${id}`));
    const at = (lines: number[]) => lines.map(line => `a.jsx:${line} ${id}`);
    const [plain, inFile, byFlag, inComment] = await Promise.all([
      lint({ "a.jsx": code, ...bunfig({ [id]: "error" }) }, ["-f", "json"]),
      lint({ "a.jsx": code, ...bunfig({ [id]: ["error", ...options] }) }, ["-f", "json"]),
      lint({ "a.jsx": code }, ["-f", "json", "--rule", JSON.stringify({ [id]: ["error", ...options] })]),
      lint({ "a.jsx": `${code}/* eslint ${id}: ${JSON.stringify(["error", ...options])} */\n` }, ["-f", "json"]),
    ]);
    expect(of(plain.stdout)).toEqual(at(withoutOptions));
    expect(of(inFile.stdout)).toEqual(at(lines));
    expect(of(byFlag.stdout)).toEqual(at(lines));
    expect(of(inComment.stdout)).toEqual(at(lines));
  });

  test("of the rule of a plugin for ESLint are that plugin's", async () => {
    const code = "export default [1].map(it => <b>{it}</b>, <></>);\nexport const a = [<></>];\n";
    const [plain, checked] = await Promise.all([
      lint({ "a.jsx": code, ...bunfig({ "react/jsx-key": "error" }) }, ["-f", "json"]),
      lint({ "a.jsx": code, ...bunfig({ "react/jsx-key": ["error", { checkFragmentShorthand: true }] }) }, [
        "-f",
        "json",
      ]),
    ]);
    expect(problems(plain.stdout)).toEqual(["a.jsx:1 react/jsx-key"]);
    expect(problems(checked.stdout)).toEqual(["a.jsx:1 react/jsx-key", "a.jsx:2 react/jsx-key"]);
  });
});

describe.concurrent("comments", () => {
  const rules = bunfig({
    "unicorn/no-null": "error",
    "typescript/no-explicit-any": "error",
    "nextjs/no-img-element": "error",
    "jsx_a11y/alt-text": "error",
    "node/no-exports-assign": "error",
    "react/rules-of-hooks": "error",
  });

  test("eslint-disable takes every name of a rule", async () => {
    const code = `// eslint-disable-next-line unicorn/no-null
export const a = null;
// eslint-disable-next-line typescript/no-explicit-any
export const b: any = 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const c: any = 1;
// eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
export const d = <img />;
// eslint-disable-next-line nextjs/no-img-element, jsx_a11y/alt-text
export const e = <img />;
export function F(x) {
  // eslint-disable-next-line react/rules-of-hooks
  if (x) useState();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (x) useState();
}
// eslint-disable-next-line n/no-exports-assign
exports = {};
// eslint-disable-next-line node/no-exports-assign
exports = {};
`;
    const [disabled, enabled] = await Promise.all([
      lint({ "a.tsx": code, ...rules }, ["-f", "json"]),
      lint({ "a.tsx": code.replaceAll("eslint-disable-next-line", "see"), ...rules }, ["-f", "json"]),
    ]);
    expect(problems(disabled.stdout)).toEqual([]);
    expect(disabled.exitCode).toBe(0);
    expect(problems(enabled.stdout)).toEqual([
      "a.tsx:2 unicorn/no-null",
      "a.tsx:4 @typescript-eslint/no-explicit-any",
      "a.tsx:6 @typescript-eslint/no-explicit-any",
      "a.tsx:8 @next/next/no-img-element",
      "a.tsx:8 jsx-a11y/alt-text",
      "a.tsx:10 @next/next/no-img-element",
      "a.tsx:10 jsx-a11y/alt-text",
      "a.tsx:13 react-hooks/rules-of-hooks",
      "a.tsx:15 react-hooks/rules-of-hooks",
      "a.tsx:18 n/no-exports-assign",
      "a.tsx:20 n/no-exports-assign",
    ]);
  });

  test("a rule that is off can be named", async () => {
    const code = "// eslint-disable-next-line oxc/no-accumulating-spread, jsx_a11y/alt-text\nexport {};\n";
    const { stdout, exitCode } = await lint({ "a.js": code }, ["-f", "json"]);
    expect(problems(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("/* eslint rule: .. */ turns rules on and off", async () => {
    const code = `/* eslint unicorn/no-null: off, eslint/no-var: error, promise/param-names: error, nextjs/no-img-element: off */
export const a = null;
var b = new Promise(ok => ok());
export const c = [b, <img alt="" />];
`;
    const { stdout } = await lint({ "a.jsx": code, ...rules }, ["-f", "json"]);
    expect(problems(stdout)).toEqual(["a.jsx:3 no-var", "a.jsx:3 promise/param-names"]);
  });

  test("a comment cannot turn on a rule that does not exist, and can name one of a plugin that is here in part", async () => {
    const code = `/* eslint react-hooks/jsx-key: error, unicorn/nothing: error */
// eslint-disable-next-line unicorn/nothing
export {};
`;
    const { stdout } = await lint({ "a.js": code }, ["-f", "json"]);
    expect(problems(stdout)).toEqual(["a.js:1 react-hooks/jsx-key", "a.js:1 unicorn/nothing"]);
    expect(stdout).toContain("Definition for rule 'react-hooks/jsx-key' was not found.");
  });

  test("unicorn/no-abusive-eslint-disable is not turned off by the comment that it is about", async () => {
    const code = "// eslint-disable-next-line\nf();\nf(); // eslint-disable-line\n/* eslint-disable */\nf();\n";
    const { stdout } = await lint({ "a.js": code, ...bunfig({ "unicorn/no-abusive-eslint-disable": "error" }) }, [
      "-f",
      "json",
    ]);
    expect(problems(stdout).filter(it => it.endsWith("disable"))).toEqual([
      "a.js:1 unicorn/no-abusive-eslint-disable",
      "a.js:3 unicorn/no-abusive-eslint-disable",
      "a.js:4 unicorn/no-abusive-eslint-disable",
    ]);
  });
});

describe.concurrent("[lint.categories]", () => {
  const files = {
    "a.jsx": `[1].map(x => [x]).flat();
[1].reduce((all, x) => [...all, x], []);
export default B => <B list={[]} />;
`,
    "b.ts": "export class A {\n  f(): void;\n  f(a?: number): void {\n    g(a);\n  }\n}\nexport default null;\n",
  };
  const categories = (lines: string) => ({ "bunfig.toml": `[lint.categories]\n${lines}\n` });

  test("reach the rules of every plugin", async () => {
    const [plain, perf] = await Promise.all([
      lint(files, ["-f", "json"]),
      lint({ ...files, ...categories(`perf = "error"`) }, ["-f", "json"]),
    ]);
    expect(problems(plain.stdout)).toEqual([]);
    expect(problems(perf.stdout)).toEqual([
      "a.jsx:1 unicorn/prefer-array-flat-map",
      "a.jsx:2 oxc/no-accumulating-spread",
      "a.jsx:3 react-perf/jsx-no-new-array-as-prop",
    ]);
    expect(perf.exitCode).toBe(1);
  });

  test("come before [lint.rules], and `all` before the others", async () => {
    const lines = `perf = "off"\nall = "warn"\n[lint.rules]\n"oxc/no-accumulating-spread" = "error"`;
    const { stdout } = await lint({ ...files, ...categories(lines) }, ["-f", "json"]);
    const found = problems(stdout);
    expect(found).toContain("a.jsx:2 oxc/no-accumulating-spread");
    expect(found).not.toContain("a.jsx:1 unicorn/prefer-array-flat-map");
    expect(found).toContain("b.ts:7 unicorn/no-null");
  });

  test("in TypeScript the extension of typescript-eslint stands in for a rule of ESLint", async () => {
    const { stdout } = await lint({ ...files, ...categories(`correctness = "error"`) }, ["--print-config", "b.ts"]);
    const { rules } = JSON.parse(stdout);
    expect(rules["no-dupe-class-members"]).toEqual([0]);
    expect(rules["@typescript-eslint/no-dupe-class-members"]).toEqual([2]);
  });
});

describe.concurrent("[lint.settings]", () => {
  // The rule, the code, the table, and the lines that are reported without it and with it.
  const cases: [id: string, code: string, settings: string, without: number[], withIt: number[]][] = [
    [
      "react/no-deprecated",
      "export const A = React.createClass({});\n",
      `[lint.settings.react]\nversion = "15.0"`,
      [1],
      [],
    ],
    [
      "react-hooks/exhaustive-deps",
      "export function A({ a }) {\n  useMine(() => {\n    f(a);\n  }, []);\n}\n",
      `[lint.settings.react-hooks]\nadditionalEffectHooks = "useMine"`,
      [],
      [4],
    ],
    ["import/no-unresolved", `import "electron";\n`, `[lint.settings]\n"import/core-modules" = ["electron"]`, [1], []],
    [
      "jsx-a11y/alt-text",
      "export default <Picture />;\n",
      `[lint.settings."jsx-a11y".components]\nPicture = "img"`,
      [],
      [1],
    ],
    ["jest/no-deprecated-functions", `jest.genMockFromModule("a");\n`, `[lint.settings.jest]\nversion = 20`, [1], []],
  ];

  test.each(cases)("%s", async (id, code, settings, without, withIt) => {
    const of = (stdout: string) => problems(stdout).filter(it => it.endsWith(` ${id}`));
    const rules = bunfig({ [id]: "error" })["bunfig.toml"];
    const [plain, set] = await Promise.all([
      lint({ "a.jsx": code, "bunfig.toml": rules }, ["-f", "json"]),
      lint({ "a.jsx": code, "bunfig.toml": `${rules}\n${settings}\n` }, ["-f", "json"]),
    ]);
    expect(of(plain.stdout)).toEqual(without.map(line => `a.jsx:${line} ${id}`));
    expect(of(set.stdout)).toEqual(withIt.map(line => `a.jsx:${line} ${id}`));
  });

  test("are added to those of a config of ESLint or oxlint", async () => {
    const files = {
      "a.jsx": "export default <Picture />;\n",
      "bunfig.toml": `[lint.settings."jsx-a11y".components]\nPicture = "img"\n`,
    };
    const oxlint = { ".oxlintrc.json": `{ "plugins": ["jsx-a11y"], "rules": { "jsx-a11y/alt-text": "error" } }` };
    const eslint = {
      "eslint.config.mjs": `const rule = { create: context => ({ Program: node => context.report({ node, message: JSON.stringify(context.settings) }) }) };
export default [{ files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, settings: { mine: 1 }, plugins: { p: { rules: { r: rule } } }, rules: { "p/r": "error" } }];\n`,
    };
    const [ofOxlint, ofESLint] = await Promise.all([
      lint({ ...files, ...oxlint }, ["-f", "unix"]),
      lint({ ...files, ...eslint }, ["-f", "unix"]),
    ]);
    expect(ofOxlint.stdout).toContain("[Error/jsx-a11y(alt-text)]");
    expect(ofESLint.stdout).toContain(`{"mine":1,"jsx-a11y":{"components":{"Picture":"img"}}}`);
  });
});

describe.concurrent("a rule that does not exist", () => {
  const source = { "a.js": "debugger;\n" };
  const cases: [written: string, said: string][] = [
    // A rule of ESLint, a rule of a plugin, a plugin.
    ["no-vra", `Unknown rule "no-vra"\n  Did you mean "no-var"?`],
    ["eslint/no-vra", `Unknown rule "eslint/no-vra"\n  Did you mean "eslint/no-var"?`],
    ["unicorn/no-nul", `Unknown rule "unicorn/no-nul"\n  Did you mean "unicorn/no-null"?`],
    ["unicron/no-null", `Unknown rule "unicron/no-null"\n  Did you mean "unicorn/no-null"?`],
    [
      "typescript/no-explicit-ayn",
      `Unknown rule "typescript/no-explicit-ayn"\n  Did you mean "typescript/no-explicit-any"?`,
    ],
    [
      "@typescript-eslint/no-explict-any",
      `Unknown rule "@typescript-eslint/no-explict-any"\n  Did you mean "@typescript-eslint/no-explicit-any"?`,
    ],
    // Without a plugin: as reports name the rule.
    ["no-explicit-an", `Unknown rule "no-explicit-an"\n  Did you mean "@typescript-eslint/no-explicit-any"?`],
    ["rules-of-hook", `Unknown rule "rules-of-hook"\n  Did you mean "react-hooks/rules-of-hooks"?`],
    ["no-img-elemnt", `Unknown rule "no-img-elemnt"\n  Did you mean "@next/next/no-img-element"?`],
    ["no-exports-asign", `Unknown rule "no-exports-asign"\n  Did you mean "n/no-exports-assign"?`],
    // With another spelling of the plugin: that one.
    ["nextjs/no-img-elemnt", `Unknown rule "nextjs/no-img-elemnt"\n  Did you mean "nextjs/no-img-element"?`],
    ["node/no-proces-exit", `Unknown rule "node/no-proces-exit"\n  Did you mean "node/no-process-exit"?`],
    ["react/rules-of-hook", `Unknown rule "react/rules-of-hook"\n  Did you mean "react/rules-of-hooks"?`],
    // The right name without its plugin, or with another.
    ["no-null", `Unknown rule "no-null"\n  Did you mean "unicorn/no-null"?`],
    ["react-hooks/jsx-key", `Unknown rule "react-hooks/jsx-key"\n  Did you mean "react/jsx-key"?`],
    // Nothing is near.
    ["foo/bar-baz", `Unknown rule "foo/bar-baz"`],
    ["perfectly-fine", `Unknown rule "perfectly-fine"`],
    // Left out on purpose.
    ["indent", `"indent" is a formatting rule\n  bun format does that`],
    ["eslint/semi", `"eslint/semi" is a formatting rule\n  bun format does that`],
    ["@stylistic/quotes", `"@stylistic/quotes" is a formatting rule\n  bun format does that`],
    ["jsdoc/require-param", `"jsdoc/require-param" is not supported\n  bun lint has no jsdoc rules`],
    ["vue/no-dupe-keys", `"vue/no-dupe-keys" is not supported\n  bun lint has no vue rules`],
  ];

  test.each(cases)("%s", async (written, said) => {
    const [inFile, byFlag] = await Promise.all([
      lint({ ...source, "bunfig.toml": `[lint.rules]\n"no-debugger" = "error"\n"${written}" = "error"\n` }),
      lint(source, ["--rule", JSON.stringify({ [written]: "error" })]),
    ]);
    expect(inFile).toEqual({
      stdout: "",
      stderr: `3 | "${written}" = "error"\n    ^\nerror: ${said}\n    at bunfig.toml:3:1\n`,
      exitCode: 2,
    });
    expect(byFlag).toEqual({ stdout: "", stderr: `error: ${said}\n`, exitCode: 2 });
  });

  test("is an error though it is off, unless it was left out on purpose", async () => {
    const [mistyped, leftOut] = await Promise.all([
      lint({ ...source, ...bunfig({ "no-debuger": "off" }) }, ["-f", "json"]),
      lint(
        { ...source, ...bunfig({ "indent": "off", "jsdoc/require-param": "off", "vue/no-dupe-keys": 0 as never }) },
        ["-f", "json"],
      ),
    ]);
    expect(mistyped.stderr).toContain(`error: Unknown rule "no-debuger"\n  Did you mean "no-debugger"?\n`);
    expect(mistyped.exitCode).toBe(2);
    expect(problems(leftOut.stdout)).toEqual(["a.js:1 no-debugger"]);
    expect(leftOut.exitCode).toBe(1);
  });

  test("one more instance of no-restricted-syntax has a name of its own", async () => {
    const { stdout } = await lint(
      { ...source, ...bunfig({ "no-debugger": "off", "no-restricted-syntax/mine": ["error", "DebuggerStatement"] }) },
      ["-f", "json"],
    );
    expect(problems(stdout)).toEqual(["a.js:1 no-restricted-syntax/mine"]);
  });
});

describe.concurrent("a setting that a rule does not take", () => {
  const source = { "a.js": "export {};\n" };
  // The line of `[lint.rules]`, the column that is pointed at, and what is said.
  const cases: [line: string, column: number, said: string][] = [
    [
      `"eqeqeq" = ["error", "smrt"]`,
      22,
      `"smrt" is not a valid option for eqeqeq\n  Expected "always", "smart", or "allow-null"`,
    ],
    [
      `"no-console" = ["warn", { alow = ["log"] }]`,
      27,
      `Unknown option "alow" for no-console\n  Did you mean "allow"?`,
    ],
    [`"no-console" = ["warn", { allow = ["lgo"] }]`, 36, ""],
    [
      `"no-console" = ["warn", { allow = "log" }]`,
      35,
      `"log" is not valid for "allow" of no-console\n  Expected an array`,
    ],
    [`"no-debugger" = ["error", "always"]`, 27, `no-debugger takes no options`],
    [`"eqeqeq" = ["error", "always", { null = "ignore" }, 1]`, 53, `eqeqeq takes at most 2 options`],
    [
      `"max-depth" = ["error", -1]`,
      25,
      `-1 is not a valid option for max-depth\n  Expected a number that is at least 0 or an object`,
    ],
    [
      `"typescript/ban-ts-comment" = ["error", { minimumDescriptionLength = "3" }]`,
      70,
      `"3" is not valid for "minimumDescriptionLength" of typescript/ban-ts-comment\n  Expected a number`,
    ],
    [
      `"import/enforce-node-protocol-usage" = "error"`,
      40,
      `import/enforce-node-protocol-usage needs at least 1 option`,
    ],
    [`"eqeqeq" = "eror"`, 12, `"eror" is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"`],
    [
      `"eqeqeq" = ["eror", "smart"]`,
      13,
      `"eror" is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"`,
    ],
    // What no schema can tell, and the rule finds out.
    [
      `"no-restricted-syntax" = ["error", "Foo["]`,
      36,
      `Invalid options for no-restricted-syntax\n  Syntax error in selector "Foo[" at position 4: Expected " " or [^ [\\],():#!=><~+.] but end of input found.`,
    ],
    [`"eqeqeq" = 3`, 12, `3 is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"`],
  ];

  test.each(cases.filter(it => it[2] !== ""))("%s", async (line, column, said) => {
    const { stdout, stderr, exitCode } = await lint({ ...source, "bunfig.toml": `[lint.rules]\n${line}\n` });
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `2 | ${line}\n${" ".repeat(column + 3)}^\nerror: ${said}\n    at bunfig.toml:2:${column}\n`,
      exitCode: 2,
    });
  });

  test("--rule says the same without the lines of a file", async () => {
    const [options, severity, overBunfig] = await Promise.all([
      lint(source, ["--rule", `eqeqeq: [error, smrt]`]),
      lint(source, ["--rule", `eqeqeq: eror`]),
      lint({ ...source, ...bunfig({ eqeqeq: ["error", "smart"] }) }, ["--rule", `eqeqeq: [error, smrt]`]),
    ]);
    const said = `error: "smrt" is not a valid option for eqeqeq\n  Expected "always", "smart", or "allow-null"\n`;
    expect(options).toEqual({ stdout: "", stderr: said, exitCode: 2 });
    expect(overBunfig).toEqual({ stdout: "", stderr: said, exitCode: 2 });
    expect(severity).toEqual({
      stdout: "",
      stderr: `error: "eror" is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"\n`,
      exitCode: 2,
    });
  });

  test("the options of a rule that is off are not looked at", async () => {
    const { stderr, exitCode } = await lint({ ...source, ...bunfig({ eqeqeq: ["off", "smrt"] }) }, ["-f", "json"]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("a category", async () => {
    const { stderr, exitCode } = await lint({ ...source, "bunfig.toml": `[lint.categories]\nstyle = "eror"\n` });
    expect(stderr).toBe(
      `2 | style = "eror"\n            ^\nerror: "eror" is not a valid severity for style\n  Expected "off", "warn", or "error"\n    at bunfig.toml:2:9\n`,
    );
    expect(exitCode).toBe(2);
  });
});

describe.concurrent("with a config of ESLint or oxlint nothing changes", () => {
  const source = { "a.js": "export default null;\n" };
  const flat = (rules: unknown) => ({ "eslint.config.mjs": `export default [{ rules: ${JSON.stringify(rules)} }];\n` });

  test("ESLint does not know a plugin that the config does not have", async () => {
    const [inFile, inBunfig] = await Promise.all([
      lint({ ...source, ...flat({ "unicorn/no-null": "error" }) }),
      lint({ ...source, ...flat({}), ...bunfig({ "unicorn/no-null": "error" }) }),
    ]);
    for (const { stdout, stderr, exitCode } of [inFile, inBunfig]) {
      expect(stderr).toContain(`Key "rules": Key "unicorn/no-null": Could not find plugin "unicorn" in configuration.`);
      expect(stdout).toBe("");
      expect(exitCode).toBe(2);
    }
  });

  test("ESLint's words about options, below the name of what has them", async () => {
    const words = `Key "rules": Key "eqeqeq":\n\tValue "smrt" should be equal to one of the allowed values.`;
    const wrong = { eqeqeq: ["error", "smrt"] as Setting };
    const legacy = { root: true, parserOptions: { sourceType: "module" }, rules: wrong };
    const [inFile, inLegacy, inBunfig, byFlag] = await Promise.all([
      lint({ ...source, ...flat(wrong) }),
      lint({ ...source, ".eslintrc.json": JSON.stringify(legacy) }),
      lint({ ...source, ...flat({}), ...bunfig(wrong) }),
      lint({ ...source, ...flat({}) }, ["--rule", JSON.stringify(wrong)]),
    ]);
    expect(inFile.stderr).toStartWith(`error: Invalid config in eslint.config.mjs\n${words}`);
    expect(inLegacy.stderr).toStartWith("error: Invalid config in .eslintrc.json\n");
    expect(inBunfig.stderr).toStartWith(`error: Invalid config in bunfig.toml\n${words}`);
    expect(byFlag.stderr).toStartWith(`error: Invalid config in --rule\n${words}`);
    expect([inFile, inLegacy, inBunfig, byFlag].map(it => [it.stdout, it.exitCode])).toEqual(
      Array.from({ length: 4 }, () => ["", 2]),
    );
  });

  test("oxlint's rules run with its config, under its names", async () => {
    const { stdout, exitCode } = await lint(
      { ...source, ".oxlintrc.json": JSON.stringify({ rules: { "unicorn/no-null": "error" } }) },
      ["-f", "unix"],
    );
    expect(stdout).toContain("[Error/unicorn(no-null)]");
    expect(exitCode).toBe(1);
  });
});
