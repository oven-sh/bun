// What `bun lint` does in a project that has no configuration of ESLint or oxlint.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

type Result = { filePath: string; messages: { line: number; column: number; severity: number; ruleId: string }[] };

/** `reports`: `a.js:1:1 error no-debugger` for each problem. `texts`: the files when the command has run. */
async function lint(files: Record<string, string>, args: string[], stdin?: string) {
  using dir = tempDir("bun-lint-defaults", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", ...args],
    env,
    cwd: String(dir),
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const json = JSON.parse(stdout || "null");
  const nameOf = (path: string) => normalizeBunSnapshot(path, String(dir)).slice("<dir>/".length);
  const reports = (Array.isArray(json) ? (json as Result[]) : []).flatMap(({ filePath, messages }) =>
    messages.map(
      it => `${nameOf(filePath)}:${it.line}:${it.column} ${it.severity === 2 ? "error" : "warning"} ${it.ruleId}`,
    ),
  );
  const texts = Object.fromEntries(
    Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]),
  );
  return { json, reports, texts, stderr, exitCode };
}

describe.concurrent("severities", () => {
  const files = {
    "a.js": "debugger;\nif (Bun) {\n}\nlet unused;\n",
    "b.ts": "export let a: any = 1;\nexport const b = 1 as unknown as Number;\n",
  };

  test("a default rule about a problem is an error, one about code that does nothing and every other one a warning", async () => {
    const { reports, exitCode } = await lint(files, []);
    expect(reports).toEqual([
      "a.js:1:1 error no-debugger",
      "a.js:2:10 warning no-empty",
      "a.js:4:5 warning no-unused-vars",
      "b.ts:1:12 warning prefer-const",
      "b.ts:1:15 warning @typescript-eslint/no-explicit-any",
      "b.ts:2:34 error @typescript-eslint/no-wrapper-object-types",
    ]);
    expect(exitCode).toBe(1);
  });

  test("with --type-aware too", async () => {
    const { reports, exitCode } = await lint(
      {
        "tsconfig.json": "{}",
        "a.ts": "export async function f() {\n  return 1;\n}\nf();\nawait 1;\n",
      },
      ["--type-aware"],
    );
    expect(reports).toEqual([
      "a.ts:1:8 warning @typescript-eslint/require-await",
      "a.ts:4:1 error @typescript-eslint/no-floating-promises",
      "a.ts:5:1 warning @typescript-eslint/await-thenable",
    ]);
    expect(exitCode).toBe(1);
  });

  test("warnings do not fail the run, --max-warnings does, --quiet hides them", async () => {
    const warned = { "a.js": files["a.js"].replace("debugger;", "") };
    const [plain, limited, quiet] = await Promise.all([
      lint(warned, []),
      lint(warned, ["--max-warnings", "0"]),
      lint(files, ["--quiet"]),
    ]);
    expect(plain.reports).toEqual(["a.js:2:10 warning no-empty", "a.js:4:5 warning no-unused-vars"]);
    expect(limited.reports).toEqual(plain.reports);
    expect(limited.stderr).toContain("Found too many warnings (maximum: 0).");
    expect(quiet.reports).toEqual([
      "a.js:1:1 error no-debugger",
      "b.ts:2:34 error @typescript-eslint/no-wrapper-object-types",
    ]);
    expect([plain.exitCode, limited.exitCode, quiet.exitCode]).toEqual([0, 1, 1]);
  });

  test("what bunfig.toml and --rule set stays as it is set", async () => {
    const bunfig = `[lint.rules]\n"no-empty" = "error"\n"no-debugger" = "warn"\n"no-var" = "error"\n`;
    const [byFile, byFlag] = await Promise.all([
      lint({ ...files, "bunfig.toml": bunfig, "c.js": "var c = 1;\nexport { c };\n" }, []),
      lint(files, ["--rule", "prefer-const: error", "--rule", "no-debugger: off"]),
    ]);
    expect(byFile.reports).toEqual([
      "a.js:1:1 warning no-debugger",
      "a.js:2:10 error no-empty",
      "a.js:4:5 warning no-unused-vars",
      "b.ts:1:12 warning prefer-const",
      "b.ts:1:15 warning @typescript-eslint/no-explicit-any",
      "b.ts:2:34 error @typescript-eslint/no-wrapper-object-types",
      "c.js:1:1 error no-var",
    ]);
    expect(byFlag.reports).toEqual([
      "a.js:2:10 warning no-empty",
      "a.js:4:5 warning no-unused-vars",
      "b.ts:1:12 error prefer-const",
      "b.ts:1:15 warning @typescript-eslint/no-explicit-any",
      "b.ts:2:34 error @typescript-eslint/no-wrapper-object-types",
    ]);
  });

  test("the same configurations are all errors in an eslint.config.js", async () => {
    const config = `export default [
      { files: ["**/*.{js,ts}"], extends: ["eslint:recommended"], languageOptions: { globals: { Bun: "readonly" } } },
      { files: ["**/*.ts"], extends: ["typescript-eslint/recommended"] },
    ];\n`;
    const { reports } = await lint({ ...files, "eslint.config.js": config }, ["a.js", "b.ts"]);
    expect(reports).toEqual([
      "a.js:1:1 error no-debugger",
      "a.js:2:10 error no-empty",
      "a.js:4:5 error no-unused-vars",
      "b.ts:1:12 error prefer-const",
      "b.ts:1:15 error @typescript-eslint/no-explicit-any",
      "b.ts:2:34 error @typescript-eslint/no-wrapper-object-types",
    ]);
  });

  test("bun:test/no-disabled-tests is a warning, the other rules for tests are errors", async () => {
    const code = `import { expect, test } from "bun:test";\ntest.skip("a", () => {});\ntest.only("b", () => {\n  expect(1);\n});\n`;
    const { reports } = await lint({ "a.test.ts": code }, []);
    expect(reports).toEqual([
      "a.test.ts:2:1 warning bun:test/no-disabled-tests",
      "a.test.ts:3:6 error bun:test/no-focused-tests",
      "a.test.ts:4:3 error bun:test/valid-expect",
    ]);
  });

  test("--print-config", async () => {
    const { json } = await lint(files, ["--print-config", "b.ts"]);
    const { rules } = json;
    const unusedOnPurpose = {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
      ignoreRestSiblings: true,
    };
    expect({
      "no-debugger": rules["no-debugger"],
      "no-empty": rules["no-empty"],
      "prefer-const": rules["prefer-const"],
      "@typescript-eslint/no-explicit-any": rules["@typescript-eslint/no-explicit-any"],
      "@typescript-eslint/no-unused-vars": rules["@typescript-eslint/no-unused-vars"],
      "no-unused-vars": rules["no-unused-vars"],
    }).toEqual({
      "no-debugger": [2],
      "no-empty": [1],
      "prefer-const": [1],
      "@typescript-eslint/no-explicit-any": [1],
      "@typescript-eslint/no-unused-vars": [1, unusedOnPurpose],
      "no-unused-vars": [0, unusedOnPurpose],
    });
  });
});

describe.concurrent("declaration files", () => {
  const code = `declare var a: any;
declare const b: Number;
declare const d: {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const c: any;
`;

  test.each(["types.d.ts", "types.d.mts", "types.d.cts", "types.d.css.ts"])(
    "%s: the default rules that are errors run, those that are warnings do not",
    async name => {
      const { reports, exitCode } = await lint({ [name]: code }, []);
      expect(reports).toEqual([`${name}:2:18 error @typescript-eslint/no-wrapper-object-types`]);
      expect(exitCode).toBe(1);
    },
  );

  test("other files that are called alike have the warnings", async () => {
    const { reports } = await lint({ "d.ts": "export const a: any = 1;\n", "a.d.js": "let a;\n" }, []);
    expect(reports).toEqual([
      "a.d.js:1:5 warning no-unused-vars",
      "d.ts:1:17 warning @typescript-eslint/no-explicit-any",
    ]);
  });

  test("what bunfig.toml and --rule set is for them too", async () => {
    const bunfig = `[lint.rules]\n"@typescript-eslint/no-explicit-any" = "warn"\n"no-var" = "error"\n`;
    const expected = [
      "types.d.ts:1:1 error no-var",
      "types.d.ts:1:16 warning @typescript-eslint/no-explicit-any",
      "types.d.ts:2:18 error @typescript-eslint/no-wrapper-object-types",
    ];
    const [byFile, byFlag] = await Promise.all([
      lint({ "types.d.ts": code, "bunfig.toml": bunfig }, []),
      lint({ "types.d.ts": code }, ["--rule", "@typescript-eslint/no-explicit-any: warn", "--rule", "no-var: error"]),
    ]);
    expect(byFile.reports).toEqual(expected);
    expect(byFlag.reports).toEqual(expected);
  });

  test("with an eslint.config.js they are files like any other", async () => {
    const config = `export default [{ files: ["**/*.ts"], extends: ["typescript-eslint/recommended"] }];\n`;
    const { reports } = await lint({ "types.d.ts": code, "eslint.config.js": config }, ["types.d.ts"]);
    expect(reports).toEqual([
      "types.d.ts:1:1 error no-var",
      "types.d.ts:1:16 error @typescript-eslint/no-explicit-any",
      "types.d.ts:2:18 error @typescript-eslint/no-wrapper-object-types",
      "types.d.ts:3:18 error @typescript-eslint/no-empty-object-type",
    ]);
  });
});

describe.concurrent("a name that starts with _ is unused on purpose", () => {
  const code = `const _a = 1;
export function f(_b, c) {}
try {
  f();
} catch (_e) {
  f();
}
const [_d, e] = [1, 2];
const { g, ...rest } = Bun;
console.log(e, rest);
const h = 1;
`;
  const all = ["1:7", "2:19", "2:23", "5:10", "8:8", "9:9", "11:7"];

  test.each([
    ["a.js", "no-unused-vars"],
    ["a.ts", "@typescript-eslint/no-unused-vars"],
  ])("%s", async (name, rule) => {
    const set = (setting: string) => ({ [name]: code, "bunfig.toml": `[lint.rules]\n"${rule}" = ${setting}\n` });
    const [plain, severity, options] = await Promise.all([
      lint({ [name]: code }, []),
      lint(set(`"error"`), []),
      lint(set(`["warn", { args = "all" }]`), []),
    ]);
    expect(plain.reports).toEqual([`${name}:2:23 warning ${rule}`, `${name}:11:7 warning ${rule}`]);
    expect(plain.json[0].messages.map((it: { message: string }) => it.message)).toEqual([
      "'c' is defined but never used.",
      "'h' is assigned a value but never used.",
    ]);
    // As in ESLint, a severity alone leaves the options as they are, and options replace them.
    expect(severity.reports).toEqual([`${name}:2:23 error ${rule}`, `${name}:11:7 error ${rule}`]);
    expect(options.reports).toEqual(all.map(at => `${name}:${at} warning ${rule}`));
  });

  test("not with an eslint.config.js", async () => {
    const config = `export default [{ rules: { "no-unused-vars": "error" } }];\n`;
    const { reports } = await lint({ "eslint.config.js": config, "a.js": code }, ["a.js"]);
    expect(reports).toEqual(all.map(at => `a.js:${at} error no-unused-vars`));
  });
});

describe.concurrent("comments that disable rules", () => {
  const code = `// eslint-disable-next-line no-console
console.log(1);
// eslint-disable-next-line no-debugger
console.log(2);
// eslint-disable-next-line some-plugin/some-rule, not-a-rule
console.log(3);
// eslint-disable-next-line
console.log(4);
/* eslint-disable unicorn/no-null, no-empty */
console.log(5);
`;
  const unused = (line: number) => `a.js:${line}:1 warning null`;

  test("one for a rule that is off, or that does not exist, is left alone", async () => {
    const [reported, fixed] = await Promise.all([lint({ "a.js": code }, []), lint({ "a.js": code }, ["--fix"])]);
    expect(reported.reports).toEqual([unused(3), unused(7), unused(9)]);
    expect(reported.json[0].messages.map((it: { message: string }) => it.message)).toEqual([
      "Unused eslint-disable directive (no problems were reported from 'no-debugger').",
      "Unused eslint-disable directive (no problems were reported).",
      "Unused eslint-disable directive (no problems were reported from 'no-empty').",
    ]);
    expect(reported.exitCode).toBe(0);
    expect(fixed.texts["a.js"]).toBe(
      code
        .replace("// eslint-disable-next-line no-debugger", " ")
        .replace("// eslint-disable-next-line\n", " \n")
        .replace("unicorn/no-null, no-empty", "unicorn/no-null"),
    );
  });

  test("a rule that the project or a comment turns on is on", async () => {
    const bunfig = `[lint.rules]\n"no-alert" = "warn"\n`;
    const text = `/* eslint no-eval: error */\n// eslint-disable-next-line no-alert, no-eval, no-console\nconsole.log(1);\n`;
    const { json } = await lint({ "bunfig.toml": bunfig, "a.js": text }, []);
    expect(json[0].messages.map((it: { message: string }) => it.message)).toEqual([
      "Unused eslint-disable directive (no problems were reported from 'no-alert').",
      "Unused eslint-disable directive (no problems were reported from 'no-eval').",
    ]);
  });

  test("with an eslint.config.js they are reported, as by ESLint", async () => {
    const config = `export default [{ rules: { "no-debugger": "error" } }];\n`;
    const { reports } = await lint({ "eslint.config.js": config, "a.js": code }, ["a.js"]);
    expect(reports).toEqual([
      unused(1),
      unused(3),
      "a.js:5:1 error some-plugin/some-rule",
      "a.js:5:1 error not-a-rule",
      unused(7),
      "a.js:9:1 error unicorn/no-null",
      unused(9),
    ]);
  });
});

describe.concurrent("React", () => {
  const component = `import { useEffect, useState } from "react";
export function App({ items, on }) {
  if (on) {
    useState(0);
  }
  useEffect(() => {
    console.log(items);
  }, []);
  return (
    <ul>
      {items.map(it => (
        <li>{it}</li>
      ))}
    </ul>
  );
}
`;
  const hook = `import { useEffect } from "react";
export function useThing(a, on) {
  if (on) {
    useEffect(() => {
      console.log(a);
    }, []);
  }
}
`;
  const foundInHook = (name: string) => [
    `${name}:4:5 error react-hooks/rules-of-hooks`,
    `${name}:6:8 warning react-hooks/exhaustive-deps`,
  ];
  const found = (name: string) => [
    `${name}:4:5 error react-hooks/rules-of-hooks`,
    `${name}:8:6 warning react-hooks/exhaustive-deps`,
    `${name}:12:9 error react/jsx-key`,
  ];
  const dependingOn = (field: string, name = "react") =>
    JSON.stringify({ name: "app", [field]: { [name]: "^19.0.0" } });

  test.each(["dependencies", "devDependencies", "peerDependencies"])(
    "a file with JSX beside a package.json with react in %s",
    async field => {
      const files = { "package.json": dependingOn(field), "src/App.jsx": component, "src/App.tsx": component };
      const { reports, exitCode } = await lint(files, []);
      expect(reports).toEqual([...found("src/App.jsx"), ...found("src/App.tsx")]);
      expect(exitCode).toBe(1);
    },
  );

  test("every file of the project, with JSX or without", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "App.js": component,
      "useThing.js": hook,
      "useThing.ts": hook,
    };
    const { reports } = await lint(files, []);
    expect(reports).toEqual([...found("App.js"), ...foundInHook("useThing.js"), ...foundInHook("useThing.ts")]);
  });

  test.each([
    ["no package.json", {}],
    ["a package.json without react", { "package.json": dependingOn("dependencies", "preact") }],
    ["react in optionalDependencies", { "package.json": dependingOn("optionalDependencies") }],
  ])("%s: nothing", async (_, more) => {
    const { reports, exitCode } = await lint({ ...more, "App.jsx": component, "useThing.js": hook }, []);
    expect(reports).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("the closest package.json decides", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "App.jsx": component,
      "deep/er/App.jsx": component,
      "mail/package.json": dependingOn("dependencies", "preact"),
      "mail/src/App.jsx": component,
      "mail/web/package.json": dependingOn("peerDependencies"),
      "mail/web/App.jsx": component,
    };
    const { reports } = await lint(files, []);
    expect(reports).toEqual([...found("App.jsx"), ...found("deep/er/App.jsx"), ...found("mail/web/App.jsx")]);
  });

  test.each([
    ["only has other fields", `{ "type": "module" }`],
    ["is empty", "{}"],
    ["is not an object", "[]"],
  ])("a nested package.json that %s falls back to the one above it", async (_, nested) => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "src/package.json": nested,
      "src/App.jsx": component,
      "src/deep/App.jsx": component,
    };
    const [searched, named, piped, printed] = await Promise.all([
      lint(files, []),
      lint(files, ["src/App.jsx", "src/deep/App.jsx"]),
      lint(files, ["--stdin", "--stdin-filename", "src/Other.jsx"], component),
      lint(files, ["--print-config", "src/App.jsx"]),
    ]);
    expect(searched.reports).toEqual([...found("src/App.jsx"), ...found("src/deep/App.jsx")]);
    expect(named.reports).toEqual(searched.reports);
    expect(piped.reports).toEqual(found("src/Other.jsx"));
    expect(printed.json.rules["react-hooks/rules-of-hooks"]).toEqual([2]);
  });

  test("a nested package.json with empty dependencies turns the React rules off", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "server/package.json": `{ "dependencies": {} }`,
      "server/App.jsx": component,
    };
    const [searched, named] = await Promise.all([lint(files, []), lint(files, ["server/App.jsx"])]);
    expect(searched.reports).toEqual([]);
    expect(named.reports).toEqual([]);
  });

  test("a file that is named, and standard input", async () => {
    const files = { "package.json": dependingOn("dependencies"), "src/App.jsx": component };
    const [named, piped] = await Promise.all([
      lint(files, ["src/App.jsx"]),
      lint(files, ["--stdin", "--stdin-filename", "src/Other.jsx"], component),
    ]);
    expect(named.reports).toEqual(found("src/App.jsx"));
    expect(piped.reports).toEqual(found("src/Other.jsx"));
  });

  test("with --type-aware", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "preserve", noImplicitAny: false } }),
      "App.tsx": component,
      "useThing.ts": hook,
    };
    const { reports } = await lint(files, ["--type-aware"]);
    expect(reports.filter(it => it.includes("react"))).toEqual([...found("App.tsx"), ...foundInHook("useThing.ts")]);
  });

  test("what is set for them stays as it is set, with react in package.json or without", async () => {
    const bunfig = `[lint.rules]\n"react-hooks/rules-of-hooks" = "warn"\n"react-hooks/exhaustive-deps" = "error"\n"react/jsx-key" = "off"\n`;
    const files = { "bunfig.toml": bunfig, "App.jsx": component, "useThing.js": hook };
    const expected = [
      "App.jsx:4:5 warning react-hooks/rules-of-hooks",
      "App.jsx:8:6 error react-hooks/exhaustive-deps",
      "useThing.js:4:5 warning react-hooks/rules-of-hooks",
      "useThing.js:6:8 error react-hooks/exhaustive-deps",
    ];
    const [withReact, without] = await Promise.all([
      lint({ ...files, "package.json": dependingOn("dependencies") }, []),
      lint(files, []),
    ]);
    expect(withReact.reports).toEqual(expected);
    expect(without.reports).toEqual(expected);
  });

  test("comments disable them", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "App.jsx": component
        .replace("    useState(0);", "    // eslint-disable-next-line react-hooks/rules-of-hooks\n    useState(0);")
        .replace("  }, []);", "    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);")
        .replace("        <li>", "        // eslint-disable-next-line react/jsx-key\n        <li>"),
    };
    const { reports, exitCode } = await lint(files, []);
    expect(reports).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("--print-config has them where package.json has react", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "mail/package.json": dependingOn("dependencies", "preact"),
    };
    const [withReact, without] = await Promise.all([
      lint(files, ["--print-config", "App.jsx"]),
      lint(files, ["--print-config", "mail/App.jsx"]),
    ]);
    const ofReact = (printed: { rules: object }) =>
      Object.entries(printed.rules).filter(([name]) => name.startsWith("react"));
    expect(ofReact(withReact.json)).toEqual([
      ["react-hooks/rules-of-hooks", [2]],
      ["react-hooks/exhaustive-deps", [1]],
      ["react/jsx-key", [2]],
    ]);
    expect(ofReact(without.json)).toEqual([]);
  });

  test("not with a configuration of ESLint or oxlint", async () => {
    const files = { "package.json": dependingOn("dependencies"), "App.jsx": component };
    const ofEslint = `export default [{ files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }];\n`;
    const [eslint, oxlint] = await Promise.all([
      lint({ ...files, "eslint.config.js": ofEslint }, ["App.jsx"]),
      lint({ ...files, ".oxlintrc.json": "{}" }, ["App.jsx"]),
    ]);
    expect(eslint.json).toEqual([expect.objectContaining({ messages: [] })]);
    expect(oxlint.json.diagnostics).toEqual([]);
    expect([eslint.exitCode, oxlint.exitCode]).toEqual([0, 0]);
  });
});
