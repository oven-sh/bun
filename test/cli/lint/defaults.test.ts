// Tests for what `bun lint` does in a project without an ESLint or oxlint config.
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

/** `reports` has one `a.js:1:1 error no-debugger` string per problem. `texts` has the files' contents after the run. */
async function lint(files: Record<string, string>, args: string[], stdin?: string, cwd = ".") {
  using dir = tempDir("bun-lint-defaults", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", ...args],
    env,
    cwd: join(String(dir), cwd),
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

describe.concurrent("globals", () => {
  test("every global that Bun has is defined", async () => {
    // `bun -e` also makes `fs`, `path` and other built-in modules global, so ask a file.
    using dir = tempDir("bun-lint-defaults-globals", {
      "names.js": "console.log(JSON.stringify(Object.getOwnPropertyNames(globalThis)));",
    });
    await using proc = spawn({ cmd: [bunExe(), "names.js"], env, cwd: String(dir), stdout: "pipe", stderr: "inherit" });
    const names = (JSON.parse(await proc.stdout.text()) as string[]).filter(name => /^[A-Za-z_$][\w$]*$/.test(name));
    expect(names).toContain("HTMLRewriter");
    const { reports } = await lint({ "a.js": `console.log(\n${names.join(",\n")},\n);\n` }, []);
    expect(reports).toEqual([]);
  });

  const tests = `
    describe("a", () => {
      before(() => {});
      beforeAll(() => {});
      beforeEach(() => {});
      it("b", () => expect(1).toBe(1));
      test("c", () => expectTypeOf(jest.fn()).toBeFunction());
      fit("d", () => vi.fn());
      xit("e", () => {});
      afterEach(() => {});
      afterAll(() => {});
      after(() => {});
    });
    fdescribe("f", () => {});
    xdescribe("g", () => {});
  `;

  test.each([
    "a.test.js",
    "a.spec.mjs",
    "a_test.cjs",
    "a_spec.jsx",
    "__tests__/a.js",
    "src/__tests__/deep/a.js",
    "test/a.js",
    "packages/x/test/a.mjs",
    "tests/a.js",
    "spec/a.js",
    "a-test.js",
    "a.e2e.js",
    "e2e/a.js",
    "__mocks__/fs.js",
    "jest.setup.js",
    "jest-setup.cjs",
    "vitest.setup.mjs",
    "src/setupTests.js",
    "config/setup-jest.js",
    "testSetup.js",
  ])("the test runners' globals are defined in %s", async name => {
    const { reports, exitCode } = await lint({ [name]: tests }, []);
    expect(reports).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test.each(["cypress/e2e/login.cy.js", "cypress/support/commands.js", "src/login.cy.js"])(
    "Cypress's globals are defined in %s",
    async name => {
      const code = 'describe("a", () => it("b", () => cy.get("a").then(() => assert.ok(expect(Cypress.env("c"))))));\n';
      const { reports, exitCode } = await lint({ [name]: code }, []);
      expect(reports).toEqual([]);
      expect(exitCode).toBe(0);
    },
  );

  test.each([
    "a.js",
    "src/a.js",
    "testing/a.js",
    "latest/a.js",
    "src/test.js",
    "setup.js",
    "src/contest.js",
    "src/cy.js",
  ])("the test runners' globals are not defined in %s", async name => {
    const { reports, exitCode } = await lint({ [name]: 'describe("a", () => {});\n' }, []);
    expect(reports).toEqual([`${name}:1:1 error no-undef`]);
    expect(exitCode).toBe(1);
  });

  // Which names `**/*{.,_,-}{test,spec,e2e,cy}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}` is for. A global of a test runner can't be
  // assigned to. In another file nothing defines it, which is only reported in JavaScript.
  test("a file is a test by what its name ends with", async () => {
    const [stems, separators] = [
      ["a", "", "a.b", "test"],
      [".", "_", "-", "", "+"],
    ];
    const words = ["test", "spec", "e2e", "cy", "tes", "tests", "Test", "atest"];
    const extensions = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"];
    // To Windows and macOS `a.Test.js` is the file `a.test.js`.
    const folderOf = (word: string) => (word === "Test" ? "cased/" : "");
    const names = stems.flatMap(stem =>
      separators.flatMap(separator =>
        words.flatMap(word => extensions.map(extension => `${folderOf(word)}${stem}${separator}${word}.${extension}`)),
      ),
    );
    names.push("a.test.js.js", "a.test.jsx.ts", "a.test.d.ts", "a.test..js", "a.spec.ts.mts");
    names.push("src/deep/a_e2e.cts", "src/a.cy/b.js", "src/a.test.js/b.ts");
    const expected = [...new Set(names)].flatMap(name => {
      if (/[._-](test|spec|e2e|cy)\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/.test(name)) return [`${name} no-global-assign`];
      return /\.[mc]?jsx?$/.test(name) ? [`${name} no-undef`] : [];
    });
    const { reports } = await lint(Object.fromEntries(names.map(name => [name, "describe = 1;\n"])), []);
    expect(reports.map(it => it.replace(/:1:1 \w+ /, " ")).sort()).toEqual(expected.sort());
  });

  test("an eslint-env comment defines its globals, and is only an error with an ESLint config", async () => {
    const files = { "a.js": '/* eslint-env mocha, nonsense */\ndescribe("a", () => {});\njQuery("a");\n' };
    const config = { "eslint.config.mjs": `export default [{ rules: { "no-undef": "error" } }];\n` };
    const [native, eslint] = await Promise.all([lint(files, []), lint({ ...files, ...config }, ["a.js"])]);
    expect(native.reports).toEqual(["a.js:3:1 error no-undef"]);
    expect(eslint.reports).toEqual(["a.js:1:1 error null", "a.js:2:1 error no-undef", "a.js:3:1 error no-undef"]);
  });

  test("a service worker's globals are defined", async () => {
    const code = `self.addEventListener("install", event => event.waitUntil(skipWaiting()));
self.addEventListener("activate", () => clients.claim());
self.addEventListener("push", event => registration.showNotification(event.data.text()));
importScripts("./lib.js");
skipWaitng();
`;
    const { reports } = await lint({ "public/sw.js": code }, []);
    expect(reports).toEqual(["public/sw.js:5:1 error no-undef"]);
  });

  test.each(["test", "tests", "spec", "__tests__"])(
    "a project inside a folder named %s isn't all tests",
    async folder => {
      const files = {
        [`${folder}/app/package.json`]: "{}",
        [`${folder}/app/src/a.js`]: 'describe("a", () => {});\n',
        [`${folder}/app/test/b.js`]: 'describe("b", () => {});\n',
      };
      for (const cwd of [`${folder}/app`, `${folder}/app/src`]) {
        const { reports } = await lint(files, [], undefined, cwd);
        expect({ cwd, reports }).toEqual({ cwd, reports: [`${folder}/app/src/a.js:1:1 error no-undef`] });
      }
    },
  );

  test("in a repository, a test folder with its own package.json gives the same result from every directory", async () => {
    const files = {
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": "{}",
      "src/a.js": 'describe("a", () => {});\n',
      "test/package.json": "{}",
      "test/b.js": 'describe("b", () => {});\n',
      "test/unit/c.js": 'describe("c", () => {});\n',
    };
    for (const cwd of ["test", "test/unit"]) {
      const { reports, exitCode } = await lint(files, [], undefined, cwd);
      expect({ cwd, reports, exitCode }).toEqual({ cwd, reports: [], exitCode: 0 });
    }
    expect((await lint(files, [])).reports).toEqual(["src/a.js:1:1 error no-undef"]);
  });

  test("a repository inside a folder named test isn't all tests, with or without a package.json", async () => {
    for (const extra of [{}, { "test/app/package.json": "{}" }]) {
      const files = {
        "test/app/.git/HEAD": "ref: refs/heads/main\n",
        "test/app/src/a.js": 'describe("a", () => {});\n',
        "test/app/test/b.js": 'describe("b", () => {});\n',
        ...extra,
      };
      for (const cwd of ["test/app", "test/app/src"]) {
        const { reports } = await lint(files, [], undefined, cwd);
        expect({ cwd, reports }).toEqual({ cwd, reports: ["test/app/src/a.js:1:1 error no-undef"] });
      }
    }
  });

  test("the test folders count from the closest package.json, also when run from inside one", async () => {
    const files = {
      "package.json": "{}",
      "test/a.js": 'describe("a", () => {});\n',
      "test/unit/b.js": 'describe("b", () => {});\n',
      "packages/x/package.json": "{}",
      "packages/x/test/c.js": 'describe("c", () => {});\n',
    };
    for (const cwd of [".", "test", "test/unit", "packages/x", "packages/x/test"]) {
      const { reports, exitCode } = await lint(files, [], undefined, cwd);
      expect({ cwd, reports, exitCode }).toEqual({ cwd, reports: [], exitCode: 0 });
    }
  });
});

describe.concurrent("severities", () => {
  test("code that's often written on purpose is a warning, not an error", async () => {
    const { reports, exitCode } = await lint(
      {
        "a.js": `export const strip = text => text.replace(/\\x1b\\[[0-9;]*m/g, "");
export function words(text, re, object) {
  let match;
  while (match = re.exec(text)) console.log(match[0]);
  try {
    return object.hasOwnProperty(text);
  } catch (error) {
    error = new Error(String(error));
    throw error;
  }
}
`,
        "b.ts": `export type Keep<T> = T extends Function ? T : never;
// @ts-ignore
export const name: String = "a";
export enum Level { Off = 0, None = 0 }
export interface Emitter { on(): void }
export class Emitter {}
export const text = document.querySelector("h1")?.textContent!;
`,
        "c.test.ts": `import { expect, test } from "bun:test";
export const fixture = 1;
test("a", () => {
  expect(fixture).toBe(1);
});
`,
      },
      [],
    );
    expect(reports).toEqual([
      "a.js:1:43 warning no-control-regex",
      "a.js:4:10 warning no-cond-assign",
      "a.js:6:19 warning no-prototype-builtins",
      "a.js:8:5 warning no-ex-assign",
      "b.ts:1:33 warning @typescript-eslint/no-unsafe-function-type",
      "b.ts:2:1 warning @typescript-eslint/ban-ts-comment",
      "b.ts:3:20 warning @typescript-eslint/no-wrapper-object-types",
      "b.ts:4:30 warning @typescript-eslint/no-duplicate-enum-values",
      "b.ts:5:18 warning @typescript-eslint/no-unsafe-declaration-merging",
      "b.ts:6:14 warning @typescript-eslint/no-unsafe-declaration-merging",
      "b.ts:7:21 warning @typescript-eslint/no-non-null-asserted-optional-chain",
      "c.test.ts:2:14 warning bun:test/no-export",
    ]);
    expect(exitCode).toBe(0);
  });

  test("require() in a TypeScript file isn't reported", async () => {
    const code = `import path = require("node:path");
export default { path, plugins: [require("tailwindcss-animate")] };
`;
    const on = `[lint.rules]\n"@typescript-eslint/no-require-imports" = "error"\n`;
    const [plain, turnedOn] = await Promise.all([
      lint({ "tailwind.config.ts": code }, []),
      lint({ "tailwind.config.ts": code, "bunfig.toml": on }, []),
    ]);
    expect(plain.reports).toEqual([]);
    expect(turnedOn.reports).toEqual([
      "tailwind.config.ts:1:15 error @typescript-eslint/no-require-imports",
      "tailwind.config.ts:2:34 error @typescript-eslint/no-require-imports",
    ]);
  });

  const files = {
    "a.js": "debugger;\nif (Bun) {\n}\nlet unused;\n",
    "b.ts": "export let a: any = 1;\nexport interface B {\n  constructor(): void;\n}\n",
  };

  test("default rules that catch bugs are errors, and the rest are warnings", async () => {
    const { reports, exitCode } = await lint(files, []);
    expect(reports).toEqual([
      "a.js:1:1 error no-debugger",
      "a.js:2:10 warning no-empty",
      "a.js:4:5 warning no-unused-vars",
      "b.ts:1:12 warning prefer-const",
      "b.ts:1:15 warning @typescript-eslint/no-explicit-any",
      "b.ts:3:3 error @typescript-eslint/no-misused-new",
    ]);
    expect(exitCode).toBe(1);
  });

  test("the rules that --type-aware adds are split the same way", async () => {
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

  test("with --type-aware, using a value of type any is a warning", async () => {
    const { reports, exitCode } = await lint(
      {
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "lib": ["esnext", "dom"], "types": [] } }`,
        "a.ts": `export async function load(url: string, log: (text: string) => void) {
  const body = await (await fetch(url)).json();
  log(body);
  body.run();
  return body;
}
`,
      },
      ["--type-aware"],
    );
    expect(reports).toEqual([
      "a.ts:2:9 warning @typescript-eslint/no-unsafe-assignment",
      "a.ts:3:7 warning @typescript-eslint/no-unsafe-argument",
      "a.ts:4:3 warning @typescript-eslint/no-unsafe-call",
      "a.ts:4:8 warning @typescript-eslint/no-unsafe-member-access",
      "a.ts:5:3 warning @typescript-eslint/no-unsafe-return",
    ]);
    expect(exitCode).toBe(0);
  });

  test("warnings don't fail the run unless --max-warnings is exceeded, and --quiet hides them", async () => {
    const warned = { "a.js": files["a.js"].replace("debugger;", "") };
    const [plain, limited, quiet] = await Promise.all([
      lint(warned, []),
      lint(warned, ["--max-warnings", "0"]),
      lint(files, ["--quiet"]),
    ]);
    expect(plain.reports).toEqual(["a.js:2:10 warning no-empty", "a.js:4:5 warning no-unused-vars"]);
    expect(limited.reports).toEqual(plain.reports);
    expect(limited.stderr).toContain("Found too many warnings (maximum: 0).");
    expect(quiet.reports).toEqual(["a.js:1:1 error no-debugger", "b.ts:3:3 error @typescript-eslint/no-misused-new"]);
    expect([plain.exitCode, limited.exitCode, quiet.exitCode]).toEqual([0, 1, 1]);
  });

  test("severities from bunfig.toml and --rule are kept as written", async () => {
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
      "b.ts:3:3 error @typescript-eslint/no-misused-new",
      "c.js:1:1 error no-var",
    ]);
    expect(byFlag.reports).toEqual([
      "a.js:2:10 warning no-empty",
      "a.js:4:5 warning no-unused-vars",
      "b.ts:1:12 error prefer-const",
      "b.ts:1:15 warning @typescript-eslint/no-explicit-any",
      "b.ts:3:3 error @typescript-eslint/no-misused-new",
    ]);
  });

  test("the same presets are all errors in an eslint.config.js", async () => {
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
      "b.ts:3:3 error @typescript-eslint/no-misused-new",
    ]);
  });

  test("bun:test rules that catch a broken test are errors", async () => {
    const code = `import { expect, test } from "bun:test";\ntest.skip("a", () => {});\ntest.only("b", () => {\n  expect(1);\n});\n`;
    const { reports } = await lint({ "a.test.ts": code }, []);
    expect(reports).toEqual([
      "a.test.ts:2:1 warning bun:test/no-disabled-tests",
      "a.test.ts:3:6 error bun:test/no-focused-tests",
      "a.test.ts:4:3 error bun:test/valid-expect",
    ]);
  });

  test("--print-config shows the default severities and options", async () => {
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

describe.concurrent("defaults that differ from ESLint's", () => {
  /** Returns the reports of `rules`, with no config and with the same rules turned on in an eslint.config.mjs. */
  async function inBothModes(files: Record<string, string>, rules: string[], args: string[] = []) {
    const on = JSON.stringify(Object.fromEntries(rules.map(rule => [rule, "error"])));
    const config = `const plugin = name => ({ meta: { name: "eslint-plugin-" + name }, rules: {} });
export default [
  { plugins: { "react-hooks": plugin("react-hooks"), react: plugin("react") } },
  { files: ["**/*.{js,jsx}"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
  {
    files: ["**/*.{ts,tsx}"],
    extends: ["typescript-eslint/base"],
    languageOptions: { parserOptions: { projectService: true } },
  },
  { rules: ${on} },
];
`;
    const names = Object.keys(files).filter(name => /\.[jt]sx?$/.test(name));
    const [native, eslint] = await Promise.all([
      lint(files, args),
      lint({ ...files, "eslint.config.mjs": config }, names),
    ]);
    const own = (reports: string[]) => reports.filter(it => rules.some(rule => it.endsWith(` ${rule}`)));
    return { native: own(native.reports), eslint: own(eslint.reports) };
  }

  test("no-irregular-whitespace checks code, not text", async () => {
    const files = {
      "a.jsx": `// At most 10\u00a0kg, コメント\u3000全角
export const price = <p>Prix\u00a0: 10\u00a0€</p>;
export const name = \`名前\u3000太郎\`;
export const pattern = /10\u00a0kg/;
export const total\u00a0= 1;
`,
    };
    const { native, eslint } = await inBothModes(files, ["no-irregular-whitespace"]);
    expect(native).toEqual(["a.jsx:5:19 error no-irregular-whitespace"]);
    expect(eslint).toEqual([
      "a.jsx:1:14 error no-irregular-whitespace",
      "a.jsx:1:23 error no-irregular-whitespace",
      "a.jsx:2:29 error no-irregular-whitespace",
      "a.jsx:2:34 error no-irregular-whitespace",
      "a.jsx:3:24 error no-irregular-whitespace",
      "a.jsx:4:27 error no-irregular-whitespace",
      "a.jsx:5:19 error no-irregular-whitespace",
    ]);
  });

  test("a short circuit or a ternary that calls something is a fine statement", async () => {
    const code = `export function f(done, a, b) {
  done && done();
  done ? a() : b();
  done && a;
  done ? a : b;
}
`;
    const rule = "no-unused-expressions";
    const bunfig = { "bunfig.toml": `[lint.rules]\n"${rule}" = "warn"\n` };
    const files = { "a.js": code, "b.ts": code };
    const [plain, turnedOn] = await Promise.all([lint(files, []), lint({ ...files, ...bunfig }, [])]);
    const own = (reports: string[]) => reports.filter(it => it.endsWith(rule));
    // The core rule is off by default. It gets the same options when it's turned on.
    expect(own(plain.reports)).toEqual([
      `b.ts:4:3 warning @typescript-eslint/${rule}`,
      `b.ts:5:3 warning @typescript-eslint/${rule}`,
    ]);
    expect(own(turnedOn.reports)).toEqual([
      `a.js:4:3 warning ${rule}`,
      `a.js:5:3 warning ${rule}`,
      `b.ts:4:3 warning @typescript-eslint/${rule}`,
      `b.ts:5:3 warning @typescript-eslint/${rule}`,
    ]);
    const { eslint } = await inBothModes({ "a.js": code }, [rule]);
    expect(eslint).toEqual([2, 3, 4, 5].map(line => `a.js:${line}:3 error ${rule}`));
  });

  test("an async function as a JSX event handler isn't a misused promise", async () => {
    const files = {
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "jsx": "preserve", "types": [] } }`,
      "a.tsx": `declare global {
  namespace JSX {
    interface IntrinsicElements {
      form: { onSubmit?: () => void };
    }
  }
}
declare function save(): Promise<void>;
export const form = <form onSubmit={save} />;
[1].forEach(save);
if (save()) save().catch(console.error);
`,
    };
    const rule = "@typescript-eslint/no-misused-promises";
    const { native, eslint } = await inBothModes(files, [rule], ["--type-aware"]);
    expect(native).toEqual([`a.tsx:10:13 error ${rule}`, `a.tsx:11:5 error ${rule}`]);
    expect(eslint).toEqual([`a.tsx:9:36 error ${rule}`, `a.tsx:10:13 error ${rule}`, `a.tsx:11:5 error ${rule}`]);
  });

  test("no-fallthrough accepts the usual ways to write the comment", async () => {
    const comments = [
      "// falls through",
      "/* intentional fall-through */",
      "// FALLTHROUGH",
      "// no break",
      "// and the next",
    ];
    const cases = comments.map((comment, i) => `    case ${i}:\n      console.log(${i});\n    ${comment}\n`);
    const files = { "a.js": `export function f(a) {\n  switch (a) {\n${cases.join("")}    default:\n  }\n}\n` };
    const { native, eslint } = await inBothModes(files, ["no-fallthrough"]);
    expect(native).toEqual(["a.js:18:5 error no-fallthrough"]);
    expect(eslint).toEqual([9, 15, 18].map(line => `a.js:${line}:5 error no-fallthrough`));
  });

  test("a namespace inside declare global is allowed", async () => {
    const files = {
      "a.ts": `declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_URL: string;
    }
  }
}
export namespace Shapes {
  export const unit = 1;
}
`,
    };
    const rule = "@typescript-eslint/no-namespace";
    const { native, eslint } = await inBothModes(files, [rule]);
    expect(native).toEqual([`a.ts:8:8 warning ${rule}`]);
    expect(eslint).toEqual([`a.ts:2:3 error ${rule}`, `a.ts:8:8 error ${rule}`]);
  });

  const react = { "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }) };

  test("a parameter named use isn't React's hook", async () => {
    const files = {
      ...react,
      "e2e/fixtures.ts": `import { test as base } from "@playwright/test";
export const test = base.extend<{ user: string }>({
  user: async ({}, use) => {
    await use("alice");
  },
});
`,
      "src/imported.ts": `import { use } from "react";
export function load(promise: Promise<string>) {
  return use(promise);
}
`,
      "src/global.js": `export function load(promise) {
  return use(promise);
}
`,
    };
    const rule = "react-hooks/rules-of-hooks";
    const { native, eslint } = await inBothModes(files, [rule]);
    const real = [`src/global.js:2:10 error ${rule}`, `src/imported.ts:3:10 error ${rule}`];
    expect(native).toEqual(real);
    expect(eslint).toEqual([`e2e/fixtures.ts:4:11 error ${rule}`, ...real]);
  });

  test("a story's render function can call hooks", async () => {
    const files = {
      ...react,
      "src/Button.stories.tsx": `import { useState } from "react";
export const Controlled = {
  render: (args: object) => {
    const [on] = useState(false);
    return <button {...args} disabled={on} />;
  },
};
export const Broken = {
  render(args: { on: boolean }) {
    if (args.on) useState(false);
    return <button />;
  },
};
`,
      "src/Button.tsx": `import { useState } from "react";
export const story = {
  render: () => {
    const [on] = useState(false);
    return <button disabled={on} />;
  },
};
`,
    };
    const rule = "react-hooks/rules-of-hooks";
    const { native, eslint } = await inBothModes(files, [rule]);
    const real = [`src/Button.stories.tsx:10:18 error ${rule}`, `src/Button.tsx:4:18 error ${rule}`];
    expect(native).toEqual(real);
    expect(eslint).toEqual([`src/Button.stories.tsx:4:18 error ${rule}`, ...real]);
  });

  test("process.exit() ends a case", async () => {
    const files = {
      "a.js": `export function run(command, usage, fail) {
  switch (command) {
    case "help":
      usage();
      process.exit(0);
    case "crash":
      process.abort();
    case "check":
      if (usage) {
        process.exit(1);
      } else {
        return 1;
      }
    case "maybe":
      if (usage) process.exit(1);
    case "fail":
      fail("never returns");
    default:
      return 0;
  }
}
`,
    };
    const { native, eslint } = await inBothModes(files, ["no-fallthrough"]);
    expect(native).toEqual([16, 18].map(line => `a.js:${line}:5 error no-fallthrough`));
    expect(eslint).toEqual([6, 8, 14, 16, 18].map(line => `a.js:${line}:5 error no-fallthrough`));
  });

  test("with --type-aware, a call that returns never ends a case", async () => {
    const files = {
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
      "a.ts": `declare function fail(message: string): never;
export function run(command: string) {
  switch (command) {
    case "fail":
      fail("stop");
    case "log":
      console.log(command);
    default:
      return 0;
  }
}
`,
    };
    const { native, eslint } = await inBothModes(files, ["no-fallthrough"], ["--type-aware"]);
    expect(native).toEqual(["a.ts:8:5 error no-fallthrough"]);
    expect(eslint).toEqual(["a.ts:6:5 error no-fallthrough", "a.ts:8:5 error no-fallthrough"]);
  });

  test("an array of elements needs keys only where React renders it as a list", async () => {
    const files = {
      ...react,
      "a.jsx": `export function Wizard({ step }) {
  const steps = [<StepOne />, <StepTwo />];
  return steps[step];
}
export const ICONS = [<Home />, <User />];
export const Actions = () => <Card actions={[<a href="#e">edit</a>, <a href="#m">more</a>]} />;
export const List = () => <ul>{[<li>a</li>, <li>b</li>]}</ul>;
export const Maybe = ({ on }) => <ul>{on && [<li>a</li>]}</ul>;
export function Returned() {
  return [<li>a</li>, <li>b</li>];
}
export const Arrow = () => [<li>a</li>];
export const Mapped = ({ items }) => items.map(item => <li>{item}</li>);
`,
    };
    const rule = "react/jsx-key";
    const { native, eslint } = await inBothModes(files, [rule]);
    const at = (places: string[]) => places.map(place => `a.jsx:${place} error ${rule}`);
    const rendered = ["7:33", "7:45", "8:46", "10:11", "10:23", "12:29", "13:56"];
    expect(native).toEqual(at(rendered));
    expect(eslint).toEqual(at(["2:18", "2:31", "5:23", "5:33", "6:46", "6:69", ...rendered]));
    const all = { "bunfig.toml": `[lint.rules]\n"${rule}" = ["error", { checkArraysOutsideJSX = true }]\n` };
    expect((await inBothModes({ ...files, ...all }, [rule])).native).toEqual(eslint);
  });

  test("true, false, 0 and 1 can switch code off and on", async () => {
    const files = {
      "a.jsx": `export const Flags = ({ a }) => (
  <div>
    {false && <Debug />}
    {true || <User />}
    {0 && <Home />}
    {1 && a}
    {null && a}
    {"" || a}
    {2 && a}
    {[] && a}
  </div>
);
`,
    };
    const rule = "no-constant-binary-expression";
    const { native, eslint } = await inBothModes(files, [rule]);
    expect(native).toEqual([7, 8, 9, 10].map(line => `a.jsx:${line}:6 error ${rule}`));
    expect(eslint).toEqual([3, 4, 5, 6, 7, 8, 9, 10].map(line => `a.jsx:${line}:6 error ${rule}`));
  });

  test.each(["a.js", "a.ts"])("%s: an integer that loses precision is an error, a decimal is fine", async name => {
    const files = {
      [name]: `export const PI = 3.14159265358979323846;
export const LAT = 52.520006599999997;
export const ID = 9007199254740993;
export const BIG = 1234567890123456789;
export const HEX = 0xffffffffffffffff;
export const TINY = 1e-400;
export const HUGE = 1e400;
export const HALF = 9007199254740993.5;
`,
    };
    const rule = "no-loss-of-precision";
    const { native, eslint } = await inBothModes(files, [rule]);
    const at = (places: string[]) => places.map(place => `${name}:${place} error ${rule}`);
    const integers = ["3:19", "4:20", "5:20", "6:21", "7:21", "8:21"];
    expect(native).toEqual(at(integers));
    expect(eslint).toEqual(at(["1:19", "2:20", ...integers]));
  });

  test("the options that only bun lint has are invalid with an ESLint config", async () => {
    const config = `export default [{ rules: { "no-loss-of-precision": ["error", { ignoreDecimals: true }] } }];\n`;
    const { stderr, exitCode } = await lint({ "a.js": "export {};\n", "eslint.config.mjs": config }, ["a.js"]);
    expect(stderr).toContain(`Key "rules": Key "no-loss-of-precision":`);
    expect(exitCode).toBe(2);
  });

  test("an empty object pattern is fine as a parameter", async () => {
    const files = { "a.js": "export const a = ({}, use) => use();\nconst {} = a;\n" };
    const { native, eslint } = await inBothModes(files, ["no-empty-pattern"]);
    expect(native).toEqual(["a.js:2:7 warning no-empty-pattern"]);
    expect(eslint).toEqual(["a.js:1:19 error no-empty-pattern", "a.js:2:7 error no-empty-pattern"]);
  });

  test("a global that the file tests with typeof may be used", async () => {
    const files = {
      "a.js": `export function umd(factory) {
  if (typeof define === "function" && define.amd) define(factory);
  return typeof myGlobal !== "undefined" ? myGlobal.x : missing.x;
}
`,
    };
    const { native, eslint } = await inBothModes(files, ["no-undef"]);
    expect(native).toEqual(["a.js:3:57 error no-undef"]);
    expect(eslint).toEqual(["2:39", "2:51", "3:44", "3:57"].map(place => `a.js:${place} error no-undef`));
    const strict = { "bunfig.toml": `[lint.rules]\n"no-undef" = ["error", { typeof = true }]\n` };
    expect((await inBothModes({ ...files, ...strict }, ["no-undef"])).native).toEqual(
      ["2:14", "2:39", "2:51", "3:17", "3:44", "3:57"].map(place => `a.js:${place} error no-undef`),
    );
  });

  describe("an option you don't set keeps its default", () => {
    const files = {
      "a.js": "const _skip = 1;\nexport function f(unused) {}\n",
      "b.jsx": "export const b = <i>{false && <b />}</i>;\nexport const c = 1 > 2;\n",
      "c.js": "// 10\u00a0kg\nexport const weight = `10\u00a0kg`;\nexport const pattern = /10\u00a0kg/;\n",
    };
    const settings = [
      [`"no-unused-vars"`, `["warn", { args = "none" }]`],
      [`"no-constant-binary-expression"`, `["error", { checkRelationalComparisons = true }]`],
      [`"no-irregular-whitespace"`, `["error", { skipRegExps = false }]`],
    ];
    const expected = ["b.jsx:2:18 error no-constant-binary-expression", "c.js:3:27 error no-irregular-whitespace"];

    test("without options", async () => {
      expect((await lint(files, [])).reports).toEqual(["a.js:2:19 warning no-unused-vars"]);
    });

    test("[lint.rules]", async () => {
      const bunfig = `[lint.rules]\n${settings.map(it => it.join(" = ")).join("\n")}\n`;
      expect((await lint({ ...files, "bunfig.toml": bunfig }, [])).reports).toEqual(expected);
    });

    test("[[lint.overrides]]", async () => {
      const bunfig = `[[lint.overrides]]\nfiles = ["*"]\nrules = { ${settings.map(it => it.join(" = ")).join(", ")} }\n`;
      expect((await lint({ ...files, "bunfig.toml": bunfig }, [])).reports).toEqual(expected);
    });

    test("--rule", async () => {
      const rules = [
        "no-unused-vars: [warn, { args: none }]",
        "no-constant-binary-expression: [error, { checkRelationalComparisons: true }]",
        "no-irregular-whitespace: [error, { skipRegExps: false }]",
      ];
      expect(
        (
          await lint(
            files,
            rules.flatMap(rule => ["--rule", rule]),
          )
        ).reports,
      ).toEqual(expected);
    });

    test("a comment in the file", async () => {
      const commented = {
        "a.js": `${files["a.js"]}/* eslint no-unused-vars: ["warn", { "args": "none" }] */\n`,
        "b.jsx": `${files["b.jsx"]}/* eslint no-constant-binary-expression: ["error", { "checkRelationalComparisons": true }] */\n`,
        "c.js": `${files["c.js"]}/* eslint no-irregular-whitespace: ["error", { "skipRegExps": false }] */\n`,
      };
      expect((await lint(commented, [])).reports).toEqual(expected);
    });

    test("the options of an override replace those of [lint.rules], not the defaults", async () => {
      const bunfig = `[lint.rules]
"no-irregular-whitespace" = ["error", { skipComments = false }]
[[lint.overrides]]
files = ["c.js"]
rules = { "no-irregular-whitespace" = ["error", { skipTemplates = false }] }
`;
      const { reports } = await lint({ "c.js": files["c.js"], "d.js": files["c.js"], "bunfig.toml": bunfig }, []);
      expect(reports).toEqual(["c.js:2:26 error no-irregular-whitespace", "d.js:1:6 error no-irregular-whitespace"]);
    });

    test("objects merge key by key, anything else replaces", async () => {
      const bunfig = `[lint.rules]
"@typescript-eslint/no-misused-promises" = ["off", { checksVoidReturn = { arguments = false } }]
"no-unused-vars" = ["warn", "local"]
`;
      const { json } = await lint({ "a.js": "", "bunfig.toml": bunfig }, ["--print-config", "a.js"]);
      expect(json.rules["@typescript-eslint/no-misused-promises"]).toEqual([
        0,
        {
          checksVoidReturn: {
            arguments: false,
            attributes: false,
            inheritedMethods: true,
            properties: true,
            returns: true,
            variables: true,
          },
        },
      ]);
      expect(json.rules["no-unused-vars"]).toEqual([1, "local"]);
    });

    test("with an ESLint config, options replace options as in ESLint", async () => {
      const config = `export default [
  { rules: { "no-irregular-whitespace": ["error", { skipComments: true, skipTemplates: true }] } },
  { rules: { "no-irregular-whitespace": ["error", { skipRegExps: true }] } },
];\n`;
      const { reports } = await lint({ "c.js": files["c.js"], "eslint.config.mjs": config }, ["c.js"]);
      expect(reports).toEqual(["c.js:1:6 error no-irregular-whitespace", "c.js:2:26 error no-irregular-whitespace"]);
    });
  });
});

describe.concurrent("JSX uses the function it compiles to", () => {
  const react = `import React from "react";\nexport const A = () => <p>a</p>;\n`;
  const preact = `/** @jsx h */\nimport { h, Fragment } from "preact";\nexport const A = () => (\n  <>\n    <p>a</p>\n  </>\n);\n`;

  test.each(["a.js", "a.jsx", "a.tsx"])("React isn't unused in %s", async name => {
    const { reports } = await lint({ [name]: react }, []);
    expect(reports).toEqual([]);
  });

  test.each(["a.jsx", "a.tsx"])("the function that a @jsx comment names isn't unused in %s", async name => {
    const { reports } = await lint({ [name]: preact }, []);
    expect(reports).toEqual([]);
  });

  test("React is unused in a file without JSX", async () => {
    const code = `import React from "react";\nexport const a = 1;\n`;
    const { reports } = await lint({ "a.js": code, "b.ts": code }, []);
    expect(reports).toEqual(["a.js:1:8 warning no-unused-vars", "b.ts:1:8 warning @typescript-eslint/no-unused-vars"]);
  });

  test("with the automatic runtime, turn react/jsx-uses-react off to find leftover imports", async () => {
    const bunfig = `[lint.rules]\n"react/jsx-uses-react" = "off"\n`;
    const { reports } = await lint({ "a.jsx": react, "bunfig.toml": bunfig }, []);
    expect(reports).toEqual(["a.jsx:1:8 warning no-unused-vars"]);
  });

  test("--quiet doesn't bring the report back", async () => {
    const bunfig = `[lint.rules]\n"no-unused-vars" = "error"\n`;
    const { reports } = await lint({ "a.jsx": react, "bunfig.toml": bunfig }, ["--quiet"]);
    expect(reports).toEqual([]);
  });

  test("with an ESLint config, only the rule from eslint-plugin-react does that", async () => {
    const config = `export default [{
  files: ["**/*.jsx"],
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: { "no-unused-vars": "error" },
}];\n`;
    const { reports } = await lint({ "a.jsx": react, "eslint.config.mjs": config }, ["a.jsx"]);
    expect(reports).toEqual(["a.jsx:1:8 error no-unused-vars"]);
  });
});

describe.concurrent("--fix-suggestions never deletes code that does something", () => {
  test("an unused variable stays if its initializer can have side effects", async () => {
    const code = `const sent = sendEmail(user);
const last = queue.pop();
const saved = await db.save(user);
const plain = 1;
import unused from "x";
export {};
`;
    for (const flag of ["--fix-suggestions", "--fix-dangerously"]) {
      const { texts, reports } = await lint({ "a.mjs": code }, [flag]);
      expect(texts["a.mjs"]).toBe(`const sent = sendEmail(user);
const last = queue.pop();
const saved = await db.save(user);
import "x";
export {};
`);
      expect(reports.filter(it => it.endsWith("no-unused-vars"))).toEqual([
        "a.mjs:1:7 warning no-unused-vars",
        "a.mjs:2:7 warning no-unused-vars",
        "a.mjs:3:7 warning no-unused-vars",
      ]);
    }
  });

  const removed = [
    "const a = 1;",
    'const b = "text";',
    "const c = -1 + 2 * 3;",
    "const d = [1, [2], { e: 3, f() {}, get g() {} }];",
    "const h = () => call();",
    "const i = async function* () {};",
    "const j = class extends Base { static k = 1; l = call(); };",
    "const m = `text`;",
    'const n = typeof value === "string" ? null : !value;',
    "const o = /a/u;",
    "let p;",
    "function q() { call(); }",
    "class r { s = call(); }",
  ];
  const kept = [
    "const a = call();",
    "const b = new Thing();",
    "const c = object.property;",
    "const d = object[0];",
    "const e = object?.property;",
    "const f = [...list];",
    "const g = { ...object };",
    "const h = { [key]: 1 };",
    "const i = tag`text`;",
    "const j = `${value}`;",
    "const k = (count = 1);",
    "const l = count++;",
    "const m = delete object.property;",
    'const n = import("x");',
    "const o = class { static { call(); } };",
    "const p = class { static q = call(); };",
    "const r = class extends mixin() {};",
    "const s = class { [key]() {} };",
    'const t = "property" in object;',
    "const u = value instanceof Thing;",
    "const v = [1, { w: [call()] }];",
    "const x = true && (false || call());",
    "const { y } = object;",
    "const [z] = list;",
    "class A { static B = call(); }",
    "class C extends mixin() {}",
  ];

  test("declarations that only define something are removed, with their lines", async () => {
    const { texts } = await lint({ "a.mjs": [...removed, "export {};", ""].join("\n") }, ["--fix-suggestions"]);
    expect(texts["a.mjs"]).toBe("export {};\n");
  });

  test.each([
    [
      "a line that has something else on it stays",
      "const a = 1; // why\nconst b = 2; export {};\n",
      "// why\nexport {};\n",
    ],
    ["no space stays at the end of a line", "g(); const a = 1;\nexport {};\n", "g();\nexport {};\n"],
    [
      "no doubled space stays",
      'import { a, used } from "./b.js";\nused();\n',
      'import { used } from "./b.js";\nused();\n',
    ],
    [
      "no empty first line in a block",
      "export function f() {\n  const a = 1;\n\n  return 1;\n}\n",
      "export function f() {\n  return 1;\n}\n",
    ],
    [
      "no empty last line in a block",
      "export function f() {\n  g();\n\n  const a = 1;\n}\n",
      "export function f() {\n  g();\n}\n",
    ],
    [
      "no two empty lines in a row",
      'import x from "./x.js";\n\nconst a = 1;\n\nexport const y = x;\n',
      'import x from "./x.js";\n\nexport const y = x;\n',
    ],
    ["no empty line at the start of the file", "const a = 1;\n\nexport {};\n", "export {};\n"],
    ["no empty line at the end of the file", "export {};\n\nconst a = 1;\n", "export {};\n"],
    [
      "an empty line between two statements stays",
      "g();\nconst a = 1;\n\nh();\nexport {};\n",
      "g();\n\nh();\nexport {};\n",
    ],
    [
      "the same with \\r\\n",
      "export function f() {\r\n  const a = 1;\r\n\r\n  return 1;\r\n}\r\n",
      "export function f() {\r\n  return 1;\r\n}\r\n",
    ],
  ])("%s", async (_, code, expected) => {
    const { texts } = await lint({ "a.mjs": code }, ["--fix-suggestions"]);
    expect(texts["a.mjs"]).toBe(expected);
  });

  test("declarations that run other code stay", async () => {
    const code = [...kept, "export {};", ""].join("\n");
    const { texts, reports } = await lint({ "a.mjs": code }, ["--fix-suggestions"]);
    expect(texts["a.mjs"]).toBe(code);
    expect(reports.filter(it => it.endsWith("no-unused-vars")).length).toBe(kept.length);
  });

  test("a parameter stays, because the number of parameters can matter", async () => {
    const code = "app.use((error, request, response, next) => {\n  response.end(String(error));\n});\nexport {};\n";
    const bunfig = { "bunfig.toml": `[lint.rules]\n"no-unused-vars" = ["warn", { args = "all" }]\n` };
    const { texts, reports } = await lint({ "a.mjs": code, ...bunfig }, ["--fix-suggestions"]);
    expect(texts["a.mjs"]).toBe(code);
    expect(reports.filter(it => it.endsWith("no-unused-vars"))).toEqual([
      "a.mjs:1:17 warning no-unused-vars",
      "a.mjs:1:36 warning no-unused-vars",
    ]);
  });

  test("the top level of a classic script stays, because the page can use it", async () => {
    const code = "function onClick() {}\nconst settings = { a: 1 };\n(function () {\n  const inner = 1;\n})();\n";
    const { texts } = await lint({ "public/app.js": code, "lib.cjs": `${code}module.exports = {};\n` }, [
      "--fix-suggestions",
    ]);
    expect(texts["public/app.js"]).toBe("function onClick() {}\nconst settings = { a: 1 };\n(function () {\n})();\n");
    expect(texts["lib.cjs"]).toBe("(function () {\n})();\nmodule.exports = {};\n");
  });

  test("only --fix-dangerously turns any into unknown or rewrites a dependency array", async () => {
    const files = {
      "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "a.ts": "export const then = (value: any) => value.then;\n",
      "b.jsx": `import { useEffect } from "react";
export function Timer({ ms, cb }) {
  useEffect(() => {
    setTimeout(cb, ms);
  }, [ms]);
  return null;
}
`,
    };
    const [careful, dangerous] = await Promise.all([
      lint(files, ["--fix-suggestions"]),
      lint(files, ["--fix-dangerously"]),
    ]);
    expect(careful.texts).toEqual(files);
    expect(careful.reports).toEqual([
      "a.ts:1:29 warning @typescript-eslint/no-explicit-any",
      "b.jsx:5:6 warning react-hooks/exhaustive-deps",
    ]);
    expect(dangerous.texts["a.ts"]).toBe(files["a.ts"].replace("any", "unknown"));
    expect(dangerous.texts["b.jsx"]).toBe(files["b.jsx"].replace("[ms]", "[cb, ms]"));
  });

  test("it leaves alone what would change working code or break the type check", async () => {
    const files = {
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "lib": ["esnext", "dom"], "types": [] } }`,
      "a.ts": `// @ts-ignore
export const a: number = 1;
export interface Empty {}
export type Nothing = {};
export const value = (map: Map<string, { v: number }>) => map.get("a")?.v!;
export async function later(list: number[]) {
  await null;
  delete list[0];
}
export async function one() {
  return 1;
}
export function start() {
  one();
}
`,
      "b.js": `export function f(a, b) {
  switch (a) {
    case 1:
      let x = b;
      return x;
  }
}
export class C {
  #sent = sendEmail();
  #plain = 1;
  #method() {}
}
`,
    };
    const { texts } = await lint(files, ["--fix-suggestions", "--type-aware"]);
    expect(texts["a.ts"]).toBe(files["a.ts"]);
    expect(texts["b.js"]).toBe(files["b.js"].replace("  #plain = 1;\n  #method() {}\n", ""));
  });

  test("adding await and removing async don't collide", async () => {
    const files = {
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "types": [] } }`,
      "a.test.ts": `import { expect, test } from "bun:test";
test("a", async () => {
  expect(Promise.resolve(1)).resolves.toBe(1);
});
`,
    };
    const { texts } = await lint(files, ["--fix-suggestions", "--type-aware"]);
    expect(texts["a.test.ts"]).toBe(files["a.test.ts"].replace("  expect(", "  await expect("));
  });

  // Not `Object.hasOwn`, which is ES2022: it's a type error with an older `target`, and it throws in older browsers.
  test("the fix for hasOwnProperty works everywhere", async () => {
    const files = { "a.mjs": "export const has = (o, k) => [o.hasOwnProperty(k), o.isPrototypeOf(k)];\n" };
    const { texts } = await lint(files, ["--fix-suggestions"]);
    expect(texts["a.mjs"]).toBe(
      "export const has = (o, k) => [Object.prototype.hasOwnProperty.call(o, k), Object.prototype.isPrototypeOf.call(o, k)];\n",
    );
  });

  test("with an ESLint config the suggestion is ESLint's", async () => {
    const files = {
      "a.mjs": "const sent = sendEmail();\n",
      "eslint.config.mjs": `export default [{ rules: { "no-unused-vars": "error" } }];\n`,
    };
    const { json } = await lint(files, ["a.mjs"]);
    expect(json[0].messages[0].suggestions).toEqual([
      {
        messageId: "removeVar",
        data: { varName: "sent" },
        fix: { range: [0, 25], text: "" },
        desc: "Remove unused variable 'sent'.",
      },
    ]);
  });
});

describe.concurrent("declaration files", () => {
  const code = `declare var a: any;
declare class B { new(): B; }
declare const d: {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const c: any;
`;

  test.each(["types.d.ts", "types.d.mts", "types.d.cts", "types.d.css.ts"])(
    "%s: default rules run if they're errors, and are skipped if they're warnings",
    async name => {
      const { reports, exitCode } = await lint({ [name]: code }, []);
      expect(reports).toEqual([`${name}:2:19 error @typescript-eslint/no-misused-new`]);
      expect(exitCode).toBe(1);
    },
  );

  test("files with similar names still get the warnings", async () => {
    const { reports } = await lint({ "d.ts": "export const a: any = 1;\n", "a.d.js": "let a;\n" }, []);
    expect(reports).toEqual([
      "a.d.js:1:5 warning no-unused-vars",
      "d.ts:1:17 warning @typescript-eslint/no-explicit-any",
    ]);
  });

  test("rules set in bunfig.toml or with --rule apply to them too", async () => {
    const bunfig = `[lint.rules]\n"@typescript-eslint/no-explicit-any" = "warn"\n"no-var" = "error"\n`;
    const expected = [
      "types.d.ts:1:1 error no-var",
      "types.d.ts:1:16 warning @typescript-eslint/no-explicit-any",
      "types.d.ts:2:19 error @typescript-eslint/no-misused-new",
    ];
    const [byFile, byFlag] = await Promise.all([
      lint({ "types.d.ts": code, "bunfig.toml": bunfig }, []),
      lint({ "types.d.ts": code }, ["--rule", "@typescript-eslint/no-explicit-any: warn", "--rule", "no-var: error"]),
    ]);
    expect(byFile.reports).toEqual(expected);
    expect(byFlag.reports).toEqual(expected);
  });

  test("with an eslint.config.js they're linted like any other file", async () => {
    const config = `export default [{ files: ["**/*.ts"], extends: ["typescript-eslint/recommended"] }];\n`;
    const { reports } = await lint({ "types.d.ts": code, "eslint.config.js": config }, ["types.d.ts"]);
    expect(reports).toEqual([
      "types.d.ts:1:1 error no-var",
      "types.d.ts:1:16 error @typescript-eslint/no-explicit-any",
      "types.d.ts:2:19 error @typescript-eslint/no-misused-new",
      "types.d.ts:3:18 error @typescript-eslint/no-empty-object-type",
    ]);
  });
});

describe.concurrent("names that start with _ are allowed to be unused", () => {
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
      lint(set(`["warn", { varsIgnorePattern = "^x" }]`), []),
    ]);
    expect(plain.reports).toEqual([`${name}:2:23 warning ${rule}`, `${name}:11:7 warning ${rule}`]);
    expect(plain.json[0].messages.map((it: { message: string }) => it.message)).toEqual([
      "'c' is defined but never used.",
      "'h' is assigned a value but never used.",
    ]);
    // A severity on its own keeps the default options. An option that's set only changes that option.
    expect(severity.reports).toEqual([`${name}:2:23 error ${rule}`, `${name}:11:7 error ${rule}`]);
    expect(options.reports).toEqual(["1:7", "2:23", "11:7"].map(at => `${name}:${at} warning ${rule}`));
  });

  test("doesn't apply with an eslint.config.js", async () => {
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

  test("a comment for a rule that's off or doesn't exist isn't reported as unused", async () => {
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
        .replace("// eslint-disable-next-line no-debugger\n", "")
        .replace("// eslint-disable-next-line\n", "")
        .replace("unicorn/no-null, no-empty", "unicorn/no-null"),
    );
  });

  test("--fix removes an unused comment without leaving spaces behind", async () => {
    const text = `function f() {
  // eslint-disable-next-line no-debugger
  g();
  g(); // eslint-disable-line no-debugger
  g(/* eslint-disable-line no-debugger */ 1);
\t/* eslint-disable-next-line no-debugger */\t\r
  g();
}
f();
// eslint-disable-line no-debugger`;
    const config = { "eslint.config.mjs": `export default [{ rules: { "no-debugger": "error" } }];\n` };
    const [native, eslint] = await Promise.all([
      lint({ "a.cjs": text }, ["--fix"]),
      lint({ "a.cjs": text, ...config }, ["--fix", "a.cjs"]),
    ]);
    expect(native.texts["a.cjs"]).toBe("function f() {\n  g();\n  g();\n  g(  1);\n  g();\n}\nf();\n");
    // ESLint puts a space where the comment was.
    expect(eslint.texts["a.cjs"]).toBe("function f() {\n   \n  g();\n  g();  \n  g(  1);\n\t \t\r\n  g();\n}\nf();\n ");
  });

  test("a rule turned on by bunfig.toml or a comment counts as on", async () => {
    const bunfig = `[lint.rules]\n"no-alert" = "warn"\n`;
    const text = `/* eslint no-eval: error */\n// eslint-disable-next-line no-alert, no-eval, no-console\nconsole.log(1);\n`;
    const { json } = await lint({ "bunfig.toml": bunfig, "a.js": text }, []);
    expect(json[0].messages.map((it: { message: string }) => it.message)).toEqual([
      "Unused eslint-disable directive (no problems were reported from 'no-alert').",
      "Unused eslint-disable directive (no problems were reported from 'no-eval').",
    ]);
  });

  test("with an eslint.config.js they're reported, like in ESLint", async () => {
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
    "the React rules are on if package.json has react in %s",
    async field => {
      const files = { "package.json": dependingOn(field), "src/App.jsx": component, "src/App.tsx": component };
      const { reports, exitCode } = await lint(files, []);
      expect(reports).toEqual([...found("src/App.jsx"), ...found("src/App.tsx")]);
      expect(exitCode).toBe(1);
    },
  );

  test("they run on every file in the project, with or without JSX", async () => {
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
  ])("%s: the React rules stay off", async (_, more) => {
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

  test("they also run on files passed by name and on stdin", async () => {
    const files = { "package.json": dependingOn("dependencies"), "src/App.jsx": component };
    const [named, piped] = await Promise.all([
      lint(files, ["src/App.jsx"]),
      lint(files, ["--stdin", "--stdin-filename", "src/Other.jsx"], component),
    ]);
    expect(named.reports).toEqual(found("src/App.jsx"));
    expect(piped.reports).toEqual(found("src/Other.jsx"));
  });

  test("they also run with --type-aware", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "preserve", noImplicitAny: false } }),
      "App.tsx": component,
      "useThing.ts": hook,
    };
    const { reports } = await lint(files, ["--type-aware"]);
    expect(reports.filter(it => it.includes("react"))).toEqual([...found("App.tsx"), ...foundInHook("useThing.ts")]);
  });

  test("bunfig.toml settings for them apply with or without react in package.json", async () => {
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

  test("--print-config lists them only if package.json has react", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "mail/package.json": dependingOn("dependencies", "preact"),
    };
    const [withReact, without] = await Promise.all([
      lint(files, ["--print-config", "App.jsx"]),
      lint(files, ["--print-config", "mail/App.jsx"]),
    ]);
    const ofReact = (printed: { rules: object }) =>
      Object.fromEntries(Object.entries(printed.rules).filter(([name]) => name.startsWith("react")));
    expect(ofReact(withReact.json)).toEqual({
      "react-hooks/rules-of-hooks": [2],
      "react-hooks/exhaustive-deps": [1],
      "react/jsx-key": [2, { checkArraysOutsideJSX: false }],
      "react/jsx-uses-react": [2],
    });
    // `react/jsx-uses-react` reports nothing. It's also for Preact's `h`, so it doesn't depend on React.
    expect(ofReact(without.json)).toEqual({
      "react/jsx-key": [0, { checkArraysOutsideJSX: false }],
      "react/jsx-uses-react": [2],
    });
  });

  test("they stay off with an ESLint or oxlint config", async () => {
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
