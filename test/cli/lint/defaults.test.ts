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

type Result = {
  filePath: string;
  messages: { line: number; column: number; severity: number; ruleId: string; message: string }[];
};

/**
 * Runs `bun lint -f json` on `files`. `reports` lists each problem as `a.js:1:1 error no-debugger`, `problems` lists
 * each as `a.js:1:1 Unexpected 'debugger' statement.`, and `texts` maps each file name to its contents after the run.
 */
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
  const problems = (Array.isArray(json) ? (json as Result[]) : []).flatMap(({ filePath, messages }) =>
    messages.map(it => `${nameOf(filePath)}:${it.line}:${it.column} ${it.message}`),
  );
  const texts = Object.fromEntries(
    Object.keys(files).map(name => [name, readFileSync(join(String(dir), name), "utf8")]),
  );
  return { json, reports, problems, texts, stderr, exitCode };
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

  // Checks which names `**/*{.,_,-}{test,spec,e2e,cy}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}` matches. In a test file,
  // assigning to a test runner's global is reported by no-global-assign. In any other file the global is undefined,
  // which is only reported in JavaScript.
  test("a file is a test file if its name ends with a test suffix", async () => {
    const [stems, separators] = [
      ["a", "", "a.b", "test"],
      [".", "_", "-", "", "+"],
    ];
    const words = ["test", "spec", "e2e", "cy", "tes", "tests", "Test", "atest"];
    const extensions = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"];
    // On Windows and macOS, `a.Test.js` and `a.test.js` are the same file.
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

  test("test folders are matched relative to the closest package.json, even when run from inside one", async () => {
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

  describe("no-var and a var that only declares a type", () => {
    const files = {
      "a.ts": `declare var top: number;
// eslint-disable-next-line no-var
declare var disabled: number;
export declare var exported: number;
declare namespace ns { var inNamespace: number; }
declare module "m" { var inModule: number; }
declare global { var inGlobal: number; }
declare global { export var exportedInGlobal: number; }
declare global { namespace inner { var nestedInGlobal: number; } }
namespace real { declare var inReal: number; }
var plain = 1;
`,
    };
    const eslint = {
      ...files,
      "eslint.config.mjs": `export default [{ files: ["**/*.ts"], extends: ["typescript-eslint/base"], rules: { "no-var": "error" } }];\n`,
    };
    const oxlint = {
      ...files,
      ".oxlintrc.json": `{ "categories": { "correctness": "off" }, "rules": { "no-var": "error" } }`,
    };
    const at = (...places: string[]) => places.map(place => `a.ts:${place} error no-var`);

    test("is reported with an ESLint config, so the comment that disables it isn't unused, and not without a config", async () => {
      const [withEslint, native] = await Promise.all([lint(eslint, ["a.ts"]), lint(files, [])]);
      expect(withEslint.reports).toEqual(at("1:1", "4:8", "5:24", "6:22", "8:25", "9:36", "10:18", "11:1"));
      expect(native.reports.filter(it => it.endsWith(" no-var"))).toEqual(["a.ts:11:1 warning no-var"]);
    });

    test("with an ESLint config, --fix changes what ESLint changes", async () => {
      const { texts } = await lint(eslint, ["--fix", "a.ts"]);
      expect(texts["a.ts"]).toBe(`declare let top: number;
// eslint-disable-next-line no-var
declare var disabled: number;
export declare var exported: number;
declare namespace ns { let inNamespace: number; }
declare module "m" { let inModule: number; }
declare global { var inGlobal: number; }
declare global { export var exportedInGlobal: number; }
declare global { namespace inner { let nestedInGlobal: number; } }
namespace real { declare let inReal: number; }
let plain = 1;
`);
    });

    test("with an ESLint 8 config, a var in declare global is reported too, and --fix changes none in a block", async () => {
      const eslintrc = `{ "root": true, "parser": "@typescript-eslint/parser", "parserOptions": { "sourceType": "module" }, "rules": { "no-var": "error" } }`;
      const eslint8 = { ...files, ".eslintrc.json": eslintrc };
      const [{ reports }, { texts }] = await Promise.all([
        lint(eslint8, ["--report-unused-disable-directives", "a.ts"]),
        lint(eslint8, ["--fix", "a.ts"]),
      ]);
      expect(reports).toEqual(at("1:1", "4:8", "5:24", "6:22", "7:18", "8:25", "9:36", "10:18", "11:1"));
      expect(texts["a.ts"]).toBe(
        files["a.ts"].replace("declare var top", "declare let top").replace("var plain", "let plain"),
      );
    });

    test("with an oxlint config, only a var in an ambient block isn't reported", async () => {
      const { json } = await lint(oxlint, ["--report-unused-disable-directives", "a.ts"]);
      const reports = json.diagnostics.map(
        (it: any) => `${it.labels[0].span.line}:${it.labels[0].span.column} ${it.code}`,
      );
      expect(reports).toEqual(["1:9", "4:16", "10:26", "11:1"].map(place => `${place} eslint(no-var)`));
    });
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

  describe("with --type-aware, URL in a template literal", () => {
    const rule = "@typescript-eslint/restrict-template-expressions";
    const tsconfig = (lib: string[]) =>
      JSON.stringify({ compilerOptions: { strict: true, lib, types: [], moduleDetection: "force" } });
    const code = `declare const server: { url: URL };
export const texts = [
  \`\${server.url}api\`,
  \`\${new URL("/x", server.url)}\`,
  \`\${server.url.searchParams}\`,
  \`\${{ a: 1 }}\`,
];
`;
    // Same shape as @types/node: the global URL extends node:url's interface.
    const node = `declare module "node:url" {
  interface URLSearchParams { toString(): string }
  interface URL { href: string; searchParams: URLSearchParams; toString(): string }
  var URL: { prototype: URL; new (url: string, base?: string | URL): URL };
}
`;
    const globalsOfNode = `import * as url from "node:url";
declare global {
  interface URL extends url.URL {}
  var URL: typeof url.URL;
}
`;

    test("isn't reported when a types package declares the global, like in a `bun init` project", async () => {
      const files = {
        "tsconfig.json": tsconfig(["ESNext"]),
        "url.d.ts": node,
        "globals.d.ts": globalsOfNode,
        "a.ts": code,
      };
      const { native, eslint } = await inBothModes(files, [rule], ["--type-aware"]);
      expect(native).toEqual([`a.ts:6:6 error ${rule}`]);
      expect(eslint).toEqual([3, 4, 5, 6].map(line => `a.ts:${line}:6 error ${rule}`));
    });

    test("isn't reported when a script declares the global", async () => {
      const declared = `declare class URLSearchParams { toString(): string }
declare class URL { constructor(url: string, base?: string | URL); searchParams: URLSearchParams; toString(): string }
`;
      const files = { "tsconfig.json": tsconfig(["ESNext"]), "globals.d.ts": declared, "a.ts": code };
      expect((await inBothModes(files, [rule], ["--type-aware"])).native).toEqual([`a.ts:6:6 error ${rule}`]);
    });

    test("isn't reported when it's imported from node:url", async () => {
      const imported = `import { URL } from "node:url";\nexport const text = \`\${new URL("https://bun.com")}\`;\n`;
      const files = { "tsconfig.json": tsconfig(["ESNext"]), "url.d.ts": node, "a.ts": imported };
      expect((await inBothModes(files, [rule], ["--type-aware"])).native).toEqual([]);
    });

    test("isn't reported with the DOM lib", async () => {
      const files = { "tsconfig.json": tsconfig(["ESNext", "DOM"]), "a.ts": code };
      const { native, eslint } = await inBothModes(files, [rule], ["--type-aware"]);
      expect(native).toEqual([`a.ts:6:6 error ${rule}`]);
      expect(eslint).toEqual(native);
    });

    test("is reported when URL is the project's own class", async () => {
      const files = {
        "tsconfig.json": tsconfig(["ESNext", "DOM"]),
        "url.ts": 'export class URL {\n  href = "";\n}\n',
        "a.ts": `import { URL } from "./url";\nexport const text = \`\${new URL()}\`;\n`,
        "b.ts": `class URL {\n  href = "";\n}\nexport const text = \`\${new URL()}\`;\n`,
      };
      const { native } = await inBothModes(files, [rule], ["--type-aware"]);
      expect(native).toEqual([`a.ts:2:24 error ${rule}`, `b.ts:4:24 error ${rule}`]);
    });

    test("is reported when the allow list only allows URL from lib and the lib doesn't declare it", async () => {
      const files = {
        "tsconfig.json": tsconfig(["ESNext"]),
        "url.d.ts": node,
        "globals.d.ts": globalsOfNode,
        "a.ts": code,
        "bunfig.toml": `[lint.rules]\n"${rule}" = ["error", { allow = [{ from = "lib", name = ["URL", "URLSearchParams"] }] }]\n`,
      };
      const { reports } = await lint(files, ["--type-aware"]);
      expect(reports.filter(it => it.endsWith(rule))).toEqual([3, 4, 5, 6].map(line => `a.ts:${line}:6 error ${rule}`));
    });
  });

  test("with --type-aware, no-implied-eval ignores a setTimeout argument of type any", async () => {
    const rule = "@typescript-eslint/no-implied-eval";
    const files = {
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "lib": ["esnext", "dom"], "types": [] } }`,
      "a.ts": `import { stub } from "not-installed";
export function later(callback: any, code: string, options: { done: any }) {
  setTimeout(callback, 1);
  setTimeout(options.done, 1);
  setTimeout(stub, 1);
  setTimeout(JSON.parse(code), 1);
  setTimeout(code, 1);
}
`,
    };
    const { native, eslint } = await inBothModes(files, [rule], ["--type-aware"]);
    expect(native).toEqual([`a.ts:7:14 warning ${rule}`]);
    expect(eslint).toEqual([3, 4, 5, 6, 7].map(line => `a.ts:${line}:14 error ${rule}`));
  });

  describe("with --type-aware, awaiting a bun:test promise matcher", () => {
    const rule = "@typescript-eslint/await-thenable";
    const tsconfig = `{ "compilerOptions": { "strict": true, "lib": ["esnext"], "types": [] } }`;
    // The relevant declarations from bun-types.
    const matchers = `interface Matchers<T> {
    not: Matchers<unknown>;
    resolves: Matchers<Awaited<T>>;
    rejects: Matchers<unknown>;
    toBe(expected: T): void;
    toThrow(expected?: unknown): void;
  }
  export function expect<T>(actual: T): Matchers<T>;`;
    const code = (source: string) => `import { expect } from "${source}";
declare const promise: Promise<number>;
await expect(promise).resolves.toBe(1);
await expect(promise).rejects.toThrow();
await expect(promise).resolves.not.toBe(2);
await expect(1).toBe(1);
`;

    test("isn't reported", async () => {
      const files = {
        "tsconfig.json": tsconfig,
        "bun-test.d.ts": `declare module "bun:test" {\n  ${matchers}\n}\n`,
        "a.ts": code("bun:test"),
      };
      const { native, eslint } = await inBothModes(files, [rule], ["--type-aware"]);
      expect(native).toEqual([`a.ts:6:1 warning ${rule}`]);
      expect(eslint).toEqual([`a.ts:6:1 error ${rule}`]);
    });

    test("is reported when expect doesn't come from bun:test", async () => {
      const files = {
        "tsconfig.json": tsconfig,
        "mine.ts": `export ${matchers.replace("export function", "export declare function")}\n`,
        "a.ts": code("./mine"),
      };
      const { native } = await inBothModes(files, [rule], ["--type-aware"]);
      expect(native).toEqual([3, 4, 5, 6].map(line => `a.ts:${line}:1 warning ${rule}`));
    });
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
    const at = (positions: string[]) => positions.map(position => `a.jsx:${position} error ${rule}`);
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
    const at = (positions: string[]) => positions.map(position => `${name}:${position} error ${rule}`);
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
    expect(eslint).toEqual(["2:39", "2:51", "3:44", "3:57"].map(position => `a.js:${position} error no-undef`));
    const strict = { "bunfig.toml": `[lint.rules]\n"no-undef" = ["error", { typeof = true }]\n` };
    expect((await inBothModes({ ...files, ...strict }, ["no-undef"])).native).toEqual(
      ["2:14", "2:39", "2:51", "3:17", "3:44", "3:57"].map(position => `a.js:${position} error no-undef`),
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

    test("an override's options replace the ones from [lint.rules], not the defaults", async () => {
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

  test.each(["a.jsx", "a.tsx"])("the function named in a @jsx comment isn't unused in %s", async name => {
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
      "keeps a line that has something else on it",
      "const a = 1; // why\nconst b = 2; export {};\n",
      "// why\nexport {};\n",
    ],
    ["leaves no trailing space", "g(); const a = 1;\nexport {};\n", "g();\nexport {};\n"],
    [
      "leaves no double space",
      'import { a, used } from "./b.js";\nused();\n',
      'import { used } from "./b.js";\nused();\n',
    ],
    [
      "leaves no empty first line in a block",
      "export function f() {\n  const a = 1;\n\n  return 1;\n}\n",
      "export function f() {\n  return 1;\n}\n",
    ],
    [
      "leaves no empty last line in a block",
      "export function f() {\n  g();\n\n  const a = 1;\n}\n",
      "export function f() {\n  g();\n}\n",
    ],
    [
      "leaves no two empty lines in a row",
      'import x from "./x.js";\n\nconst a = 1;\n\nexport const y = x;\n',
      'import x from "./x.js";\n\nexport const y = x;\n',
    ],
    ["leaves no empty line at the start of the file", "const a = 1;\n\nexport {};\n", "export {};\n"],
    ["leaves no empty line at the end of the file", "export {};\n\nconst a = 1;\n", "export {};\n"],
    [
      "keeps an empty line between two statements",
      "g();\nconst a = 1;\n\nh();\nexport {};\n",
      "g();\n\nh();\nexport {};\n",
    ],
    [
      "handles \\r\\n the same way",
      "export function f() {\r\n  const a = 1;\r\n\r\n  return 1;\r\n}\r\n",
      "export function f() {\r\n  return 1;\r\n}\r\n",
    ],
  ])("removing a declaration %s", async (_, code, expected) => {
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

  // ESLint's --fix applies all of these. The project type checks before those fixes and fails after them.
  test("--fix skips fixes that would cause type errors", async () => {
    const kept = {
      // TS2339 on `globalThis.BUILD_ID`, and TS2451 if another file declares it too
      "global.ts": "declare var BUILD_ID: string;\nconsole.log(globalThis.BUILD_ID);\n",
      "ambient.ts": "declare namespace Legacy {\n  var version: string;\n}\nconsole.log(Legacy.version);\n",
      // TS2540
      "namespace.ts":
        "export namespace Config {\n  export let verbose = false;\n}\nConfig.verbose = true;\nconsole.log(Config.verbose);\n",
      // TS2322, TS2345
      "object.ts":
        'export const a: Object = 1;\nexport function f(x: Object) {\n  return x;\n}\nconsole.log(f("s"));\n',
      // TS2774
      "cast.ts":
        'declare function cb(): void;\nif (!!cb) console.log("has cb");\nexport const b = Boolean(cb) ? 1 : 2;\n',
    };
    const fixed = {
      "fixed.ts":
        'export let n = 1;\nlet m = 2;\nvar k = 3;\nexport const s: String = "x";\nconst v = 0;\nif (!!v) console.log(k, m, n);\nexport const g = (name: string) => (!!name ? 1 : 2);\nexport const h = (cb: () => void) => !Boolean(cb);\nexport const i = (value: unknown) => (!!value ? 1 : 2);\n',
      "fixed.js": "export function call(cb) {\n  if (!!cb) cb();\n}\n",
    };
    const rules = /(no-var|prefer-const|no-wrapper-object-types|no-extra-boolean-cast)$/;
    const reportsOf = (result: { reports: string[] }) =>
      result.reports
        .filter(it => rules.test(it))
        .map(it => it.replace(/:\d+:\d+ warning/, ""))
        .sort();
    const [safe, dangerous] = await Promise.all([
      lint({ ...kept, ...fixed }, ["--fix"]),
      lint({ ...kept, ...fixed }, ["--fix-dangerously"]),
    ]);
    expect(safe.texts).toEqual({
      ...kept,
      "fixed.ts":
        'export const n = 1;\nconst m = 2;\nconst k = 3;\nexport const s: string = "x";\nconst v = 0;\nif (v) console.log(k, m, n);\nexport const g = (name: string) => (name ? 1 : 2);\nexport const h = (cb: () => void) => !cb;\nexport const i = (value: unknown) => (value ? 1 : 2);\n',
      "fixed.js": "export function call(cb) {\n  if (cb) cb();\n}\n",
    });
    expect(reportsOf(safe)).toEqual([
      "cast.ts no-extra-boolean-cast",
      "cast.ts no-extra-boolean-cast",
      "namespace.ts prefer-const",
      "object.ts @typescript-eslint/no-wrapper-object-types",
      "object.ts @typescript-eslint/no-wrapper-object-types",
    ]);
    // `declare var` isn't reported at all, so no flag rewrites it.
    expect(dangerous.texts["global.ts"]).toBe(kept["global.ts"]);
    expect(dangerous.texts["ambient.ts"]).toBe(kept["ambient.ts"]);
    expect(dangerous.texts["namespace.ts"]).toContain("export const verbose = false;");
    expect(dangerous.texts["object.ts"]).toContain("a: object = 1");
    expect(dangerous.texts["object.ts"]).toContain("f(x: object)");
    expect(dangerous.texts["cast.ts"]).toContain("if (cb) console.log");
    expect(dangerous.texts["cast.ts"]).toContain("b = cb ? 1 : 2");
    expect(reportsOf(dangerous)).toEqual([]);
  });

  test("skips suggestions that would change working code or break the type check", async () => {
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
    const bunfig = `[lint.rules]\n"@typescript-eslint/no-explicit-any" = "warn"\n"@typescript-eslint/no-empty-object-type" = "error"\n`;
    const expected = [
      "types.d.ts:1:16 warning @typescript-eslint/no-explicit-any",
      "types.d.ts:2:19 error @typescript-eslint/no-misused-new",
      "types.d.ts:3:18 error @typescript-eslint/no-empty-object-type",
    ];
    const [byFile, byFlag] = await Promise.all([
      lint({ "types.d.ts": code, "bunfig.toml": bunfig }, []),
      lint({ "types.d.ts": code }, [
        "--rule",
        "@typescript-eslint/no-explicit-any: warn",
        "--rule",
        "@typescript-eslint/no-empty-object-type: error",
      ]),
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
  ])("in %s", async (name, rule) => {
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
    const [searched, explicit, piped, printed] = await Promise.all([
      lint(files, []),
      lint(files, ["src/App.jsx", "src/deep/App.jsx"]),
      lint(files, ["--stdin", "--stdin-filename", "src/Other.jsx"], component),
      lint(files, ["--print-config", "src/App.jsx"]),
    ]);
    expect(searched.reports).toEqual([...found("src/App.jsx"), ...found("src/deep/App.jsx")]);
    expect(explicit.reports).toEqual(searched.reports);
    expect(piped.reports).toEqual(found("src/Other.jsx"));
    expect(printed.json.rules["react-hooks/rules-of-hooks"]).toEqual([2]);
  });

  test("a nested package.json with empty dependencies turns the React rules off", async () => {
    const files = {
      "package.json": dependingOn("dependencies"),
      "server/package.json": `{ "dependencies": {} }`,
      "server/App.jsx": component,
    };
    const [searched, explicit] = await Promise.all([lint(files, []), lint(files, ["server/App.jsx"])]);
    expect(searched.reports).toEqual([]);
    expect(explicit.reports).toEqual([]);
  });

  test("they also run on files passed by name and on stdin", async () => {
    const files = { "package.json": dependingOn("dependencies"), "src/App.jsx": component };
    const [explicit, piped] = await Promise.all([
      lint(files, ["src/App.jsx"]),
      lint(files, ["--stdin", "--stdin-filename", "src/Other.jsx"], component),
    ]);
    expect(explicit.reports).toEqual(found("src/App.jsx"));
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
    const reactRules = (printed: { rules: object }) =>
      Object.fromEntries(Object.entries(printed.rules).filter(([name]) => name.startsWith("react")));
    expect(reactRules(withReact.json)).toEqual({
      "react-hooks/rules-of-hooks": [2],
      "react-hooks/exhaustive-deps": [1],
      "react/jsx-key": [2, { checkArraysOutsideJSX: false }],
      "react/jsx-uses-react": [2],
    });
    // `react/jsx-uses-react` reports nothing. It's also for Preact's `h`, so it doesn't depend on React.
    expect(reactRules(without.json)).toEqual({
      "react/jsx-key": [0, { checkArraysOutsideJSX: false }],
      "react/jsx-uses-react": [2],
    });
  });

  test("they stay off with an ESLint or oxlint config", async () => {
    const files = { "package.json": dependingOn("dependencies"), "App.jsx": component };
    const eslintConfig = `export default [{ files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }];\n`;
    const [eslint, oxlint] = await Promise.all([
      lint({ ...files, "eslint.config.js": eslintConfig }, ["App.jsx"]),
      lint({ ...files, ".oxlintrc.json": "{}" }, ["App.jsx"]),
    ]);
    expect(eslint.json).toEqual([expect.objectContaining({ messages: [] })]);
    expect(oxlint.json.diagnostics).toEqual([]);
    expect([eslint.exitCode, oxlint.exitCode]).toEqual([0, 0]);
  });
});

describe.concurrent("ES modules and CommonJS", () => {
  const early = `const os = require("os");
if (os.platform() === "never") {
  return;
}
module.exports = os.platform();
`;
  const returnOutside = "Parsing error: 'return' outside of function";
  const esmPackage = { "package.json": `{ "type": "module" }` };

  test.each([
    ["no package.json", {}],
    ["a package.json without a type", { "package.json": `{ "name": "a" }` }],
    [`"type": "commonjs"`, { "package.json": `{ "type": "commonjs" }` }],
  ])("allows a top-level return with %s", async (_, files) => {
    const { problems, exitCode } = await lint({ ...files, "early.js": early }, []);
    expect(problems).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("runs rules on a file with a top-level return", async () => {
    const { reports } = await lint({ "early.js": `${early}debugger;\n` }, []);
    expect(reports).toEqual(["early.js:6:1 error no-debugger"]);
  });

  test(`reports a top-level return with "type": "module"`, async () => {
    const { problems, exitCode } = await lint({ ...esmPackage, "early.js": early }, []);
    expect(problems).toEqual([`early.js:3:3 ${returnOutside}`]);
    expect(exitCode).toBe(1);
  });

  test("uses the type from the nearest package.json", async () => {
    const files = {
      ...esmPackage,
      "early.js": early,
      "src/early.js": early,
      "legacy/package.json": "{}",
      "legacy/early.js": early,
      "legacy/esm/package.json": esmPackage["package.json"],
      "legacy/esm/early.js": early,
    };
    const expected = ["early.js", "legacy/esm/early.js", "src/early.js"].map(it => `${it}:3:3 ${returnOutside}`);
    const names = Object.keys(files).filter(it => it.endsWith(".js"));
    const [all, explicit] = await Promise.all([lint(files, []), lint(files, names)]);
    expect(all.problems.sort()).toEqual(expected);
    expect(explicit.problems.sort()).toEqual(expected);
  });

  test.each([
    ["import", `import "./b.js";`],
    ["export", "export {};"],
    ["import.meta", "console.log(import.meta.url);"],
    ["a top-level await", "await 1;"],
    ["a top-level for await", "for await (const a of []) console.log(a);"],
  ])("%s makes a file a module", async (_, code) => {
    const files = { "a.js": `${code}\nreturn;\n`, "b.js": "" };
    const [withoutPackageJson, inCommonJs] = await Promise.all([
      lint(files, ["a.js"]),
      lint({ ...files, "package.json": `{ "type": "commonjs" }` }, ["a.js"]),
    ]);
    expect(withoutPackageJson.problems).toEqual([`a.js:2:1 ${returnOutside}`]);
    expect(inCommonJs.problems).toEqual([`a.js:2:1 ${returnOutside}`]);
  });

  test.each([
    ["import()", `import("./b.js").then(console.log);`],
    ["an await in a function", "(async () => { await 1; })();"],
    ["a keyword inside a string", `console.log("import.meta, export, await");`],
  ])("%s doesn't make a file a module", async (_, code) => {
    const { problems } = await lint({ "a.js": `${code}\nreturn;\n`, "b.js": "" }, ["a.js"]);
    expect(problems).toEqual([]);
  });

  test(`allows an import with "type": "commonjs", like Bun and TypeScript`, async () => {
    const files = {
      "package.json": `{ "type": "commonjs" }`,
      "a.js": `import os from "os";\nexport default os.platform();\n`,
      "b.ts": `import os from "os";\nexport default os.platform();\n`,
    };
    const { problems, exitCode } = await lint(files, []);
    expect(problems).toEqual([]);
    expect(exitCode).toBe(0);
  });

  const sloppy: [name: string, code: string, inStrictMode: string][] = [
    ["with", "with (Math) console.log(PI);", "'with' in strict mode"],
    ["deleting a variable", "var a = 1;\ndelete a;", "Deleting local variable in strict mode"],
    ["a strict-mode reserved word", "var public = 1;\nconsole.log(public);", "The keyword 'public' is reserved"],
    ["an octal literal", "console.log(010);", ""],
    ["duplicate parameter names", "console.log(function (a, a) {});", ""],
    ["await as an identifier", "var await = 1;\nconsole.log(await);", ""],
    ["an HTML comment", "<!-- hidden from old browsers\nconsole.log(1);\n--> the end", ""],
  ];

  test.each(sloppy)("parses a CommonJS file in sloppy mode: %s", async (_, code, inStrictMode) => {
    const line = code.split("\n").length + 1;
    const files = { "a.js": `${code}\ndebugger;\n` };
    const [commonJs, esm] = await Promise.all([lint(files, []), lint({ ...esmPackage, ...files }, [])]);
    expect(commonJs.problems.filter(it => it.includes("Parsing error"))).toEqual([]);
    expect(commonJs.reports).toContain(`a.js:${line}:1 error no-debugger`);
    expect(esm.problems).toEqual([expect.stringContaining(`Parsing error: ${inStrictMode}`)]);
  });

  test(`"use strict" makes a CommonJS file strict`, async () => {
    const { problems } = await lint({ "a.js": `"use strict";\nwith (Math) console.log(PI);\n` }, []);
    expect(problems).toEqual(["a.js:2:1 Parsing error: 'with' in strict mode"]);
  });

  test("the file extension overrides package.json", async () => {
    const files = { "a.mjs": early, "a.cjs": early };
    const [inCommonJs, inModule] = await Promise.all([
      lint({ ...files, "package.json": `{ "type": "commonjs" }` }, []),
      lint({ ...files, ...esmPackage }, []),
    ]);
    expect(inCommonJs.problems).toEqual([`a.mjs:3:3 ${returnOutside}`]);
    expect(inModule.problems).toEqual([`a.mjs:3:3 ${returnOutside}`]);
  });

  describe("sourceType and globalReturn", () => {
    const ways = (toml: string, ...flags: string[]): [string, Record<string, string>, string[]][] => [
      [flags.join(" "), {}, flags.flatMap(it => ["--parser-options", it])],
      [toml.replaceAll("\n", " "), { "bunfig.toml": `[lint.parserOptions]\n${toml}\n` }, []],
    ];

    test.each([
      ...ways(`sourceType = "commonjs"`, "sourceType:commonjs"),
      ...ways("ecmaFeatures = { globalReturn = true }", "ecmaFeatures:{globalReturn:true}"),
      ...ways(
        `sourceType = "script"\necmaFeatures = { globalReturn = true }`,
        "sourceType:script",
        "ecmaFeatures:{globalReturn:true}",
      ),
    ])(`%s allows a top-level return with "type": "module"`, async (_, files, flags) => {
      const { problems, exitCode } = await lint({ ...esmPackage, ...files, "early.js": early }, flags);
      expect(problems).toEqual([]);
      expect(exitCode).toBe(0);
    });

    test.each([
      ...ways(`sourceType = "module"`, "sourceType:module"),
      ...ways(`sourceType = "script"`, "sourceType:script"),
    ])("%s rejects a top-level return", async (_, files, flags) => {
      const { problems, exitCode } = await lint({ ...files, "early.js": early }, flags);
      expect(problems).toEqual([`early.js:3:3 ${returnOutside}`]);
      expect(exitCode).toBe(1);
    });

    test("ignores globalReturn in a file with an import, like ESLint", async () => {
      const flags = ["--parser-options", "ecmaFeatures:{globalReturn:true}", "a.js"];
      const { problems } = await lint({ "a.js": `import "./b.js";\nreturn;\n`, "b.js": "" }, flags);
      expect(problems).toEqual([`a.js:2:1 ${returnOutside}`]);
    });

    test("parses a script in sloppy mode and rejects an import", async () => {
      const files = { "a.js": "with (Math) console.log(PI);\ndebugger;\n", "b.js": `import "./a.js";\n` };
      const { problems, reports } = await lint(files, ["--parser-options", "sourceType:script"]);
      expect(reports).toContain("a.js:2:1 error no-debugger");
      expect(problems).toContain(
        "b.js:1:1 Parsing error: 'import' and 'export' may appear only with 'sourceType: module'",
      );
    });

    test("top-level declarations are global in a script but not in a CommonJS file", async () => {
      const files = { "a.js": "var a = 1;\nconsole.log(a);\n" };
      const rule = ["--rule", "no-implicit-globals: error"];
      const [commonJs, script] = await Promise.all([
        lint(files, rule),
        lint(files, [...rule, "--parser-options", "sourceType:script"]),
      ]);
      expect(commonJs.reports).toEqual([]);
      expect(script.reports).toEqual(["a.js:1:5 error no-implicit-globals"]);
    });

    test.each(ways(`sourceType = "esm"`, "sourceType:esm"))("%s is an error", async (_, files, flags) => {
      const { stderr, exitCode } = await lint({ ...files, "a.js": "" }, flags);
      expect(stderr).toContain(`Key "sourceType": Expected "script", "module", or "commonjs".`);
      expect(exitCode).toBe(2);
    });

    test("--print-config prints the sourceType", async () => {
      const files = { "esm/package.json": esmPackage["package.json"] };
      const sourceType = async (...args: string[]) =>
        (await lint(files, ["--print-config", ...args])).json.languageOptions.sourceType;
      expect(
        await Promise.all([
          sourceType("a.js"),
          sourceType("a.ts"),
          sourceType("a.mjs"),
          sourceType("a.cjs"),
          sourceType("a.cts"),
          sourceType("esm/a.js"),
          sourceType("a.js", "--parser-options", "sourceType:script"),
        ]),
      ).toEqual(["unambiguous", "unambiguous", "module", "commonjs", "commonjs", "module", "script"]);
    });
  });

  describe("strict", () => {
    const bunfig = { "bunfig.toml": `[lint.rules]\nstrict = "error"\n` };
    const strict = `"use strict";
module.exports = (function () {
  return this === undefined;
})();
`;
    const unnecessary = "'use strict' is unnecessary inside of modules.";

    test.each([{}, { "package.json": `{ "type": "commonjs" }` }])(
      `--fix keeps "use strict" in a CommonJS file: %j`,
      async files => {
        const { problems, texts } = await lint({ ...bunfig, ...files, "strict.js": strict }, ["--fix"]);
        expect(problems).toEqual([]);
        expect(texts["strict.js"]).toBe(strict);
      },
    );

    test(`reports a CommonJS file without "use strict"`, async () => {
      const { problems } = await lint({ ...bunfig, "a.js": "module.exports = 1;\n" }, []);
      expect(problems).toEqual(["a.js:1:1 Use the global form of 'use strict'."]);
    });

    test(`--fix removes "use strict" from a module`, async () => {
      const files = {
        ...bunfig,
        "a.js": `"use strict";\nexport default 1;\n`,
        "esm/package.json": esmPackage["package.json"],
      };
      const { problems, texts } = await lint({ ...files, "esm/strict.js": strict }, ["--fix"]);
      expect(problems).toEqual([]);
      expect(texts["a.js"]).not.toContain("use strict");
      expect(texts["esm/strict.js"]).not.toContain("use strict");
    });

    test.each([
      ["a.js", false],
      ["a.jsx", false],
      ["a.ts", false],
      ["a.tsx", false],
      ["a.cjs", false],
      ["a.cts", false],
      ["a.mjs", true],
      ["a.mts", true],
    ])("%s without an import or an export is a module: %p", async (name, isModule) => {
      const { problems } = await lint({ ...bunfig, [name]: `"use strict";\nconsole.log(1);\n` }, []);
      expect(problems).toEqual(isModule ? [`${name}:1:1 ${unnecessary}`] : []);
    });
  });

  test("no-undef allows the CommonJS globals in a CommonJS file", async () => {
    const code = "module.exports = exports.a = [require, __filename, __dirname];\n";
    const { reports } = await lint({ "a.js": code, "b.cjs": code }, ["--rule", "no-undef: error"]);
    expect(reports).toEqual([]);
  });

  test("no-inner-declarations reports a function inside a block in a CommonJS file", async () => {
    const code = "if (process.env.DEBUG) {\n  function log() {}\n  log();\n}\n";
    const files = { "a.js": code, "b.js": `${code}export {};\n` };
    const { reports } = await lint(files, ["--rule", "no-inner-declarations: error"]);
    expect(reports).toEqual(["a.js:2:3 error no-inner-declarations"]);
  });

  test("a JavaScript plugin sees the file's sourceType", async () => {
    const files = {
      "bunfig.toml": `[lint]\nplugins = ["./plugin.mjs"]\n\n[lint.rules]\n"local/kind" = "error"\n`,
      "plugin.mjs": `
        const kind = {
          create(context) {
            return {
              Program(node) {
                const scopes = context.sourceCode.scopeManager;
                const message = [context.languageOptions.sourceType, node.sourceType, scopes.isGlobalReturn(), scopes.scopes[1].type];
                context.report({ node, message: message.join(" ") });
              },
            };
          },
        };
        export default { meta: { name: "local" }, rules: { kind } };`,
      "src/commonjs.js": "module.exports = 1;\n",
      "src/module.js": "export default 1;\n",
    };
    const { problems } = await lint(files, ["src"]);
    expect(problems.sort()).toEqual([
      "src/commonjs.js:1:1 commonjs commonjs true function",
      "src/module.js:1:1 module module false module",
    ]);
  });

  describe("with an eslint.config.js, ESLint's defaults apply", () => {
    const config = (languageOptions = "{}", rules = "{}") => ({
      "package.json": `{ "type": "commonjs" }`,
      "eslint.config.mjs": `export default [{ languageOptions: ${languageOptions}, rules: ${rules} }];\n`,
    });

    test(".js and .mjs are modules and .cjs is CommonJS, regardless of package.json", async () => {
      const files = { ...config(), "a.js": early, "a.mjs": early, "a.cjs": early };
      const { problems, exitCode } = await lint(files, ["a.js", "a.mjs", "a.cjs"]);
      expect(problems.sort()).toEqual([`a.js:3:3 ${returnOutside}`, `a.mjs:3:3 ${returnOutside}`]);
      expect(exitCode).toBe(1);
    });

    test.each([
      `{ sourceType: "commonjs" }`,
      `{ sourceType: "script", parserOptions: { ecmaFeatures: { globalReturn: true } } }`,
    ])("languageOptions: %s allows a top-level return", async languageOptions => {
      const { problems, exitCode } = await lint({ ...config(languageOptions), "a.js": early }, ["a.js"]);
      expect(problems).toEqual([]);
      expect(exitCode).toBe(0);
    });

    test.each([
      `{ sourceType: "script" }`,
      `{ parserOptions: { ecmaFeatures: { globalReturn: true } } }`,
      // ESLint overwrites it with `languageOptions.sourceType` before it calls espree.
      `{ parserOptions: { sourceType: "commonjs" } }`,
    ])("languageOptions: %s rejects a top-level return", async languageOptions => {
      const { problems } = await lint({ ...config(languageOptions), "a.js": early }, ["a.js"]);
      expect(problems).toEqual([`a.js:3:3 ${returnOutside}`]);
    });

    test("no-undef allows require and module only in CommonJS", async () => {
      const code = "module.exports = require;\n";
      const rules = `{ "no-undef": "error" }`;
      const [byDefault, commonJs] = await Promise.all([
        lint({ ...config("{}", rules), "a.js": code, "a.cjs": code }, ["a.js", "a.cjs"]),
        lint({ ...config(`{ sourceType: "commonjs" }`, rules), "a.js": code }, ["a.js"]),
      ]);
      expect(byDefault.reports).toEqual(["a.js:1:1 error no-undef", "a.js:1:18 error no-undef"]);
      expect(commonJs.reports).toEqual([]);
    });

    test(`strict reports "use strict" in a .js file`, async () => {
      const files = { ...config("{}", `{ strict: "error" }`), "a.js": `"use strict";\nmodule.exports = 1;\n` };
      const { problems } = await lint(files, ["a.js"]);
      expect(problems).toEqual(["a.js:1:1 'use strict' is unnecessary inside of modules."]);
    });
  });

  test("with an .oxlintrc.json, allows a top-level return in a file without imports or exports", async () => {
    const { json, exitCode } = await lint({ ...esmPackage, ".oxlintrc.json": "{}", "early.js": early }, ["early.js"]);
    expect(json.diagnostics).toEqual([]);
    expect(exitCode).toBe(0);
  });
});

// Each rule's original linter applies all of these fixes with --fix.
describe.concurrent("--fix preserves behavior and comments", () => {
  type Case = {
    rule: string;
    /** Code that is reported but that --fix doesn't change. */
    kept: string;
    /** `kept` after --fix-dangerously. If omitted, --fix-dangerously doesn't change `kept` either. */
    dangerous?: string;
    /** Code where the fix is safe, before and after --fix. */
    fixed?: [string, string];
    extension?: string;
  };
  const cases: Case[] = [
    {
      rule: "unicorn/prefer-single-call",
      // The second argument of `Readable#push` is the encoding. `nextId()` depends on the first `push`.
      kept: 'import { Readable } from "node:stream";\nexport const readable = new Readable({ read() {} });\nreadable.push("a");\nreadable.push("b");\nexport const rows = [];\nconst nextId = () => rows.length + 1;\nrows.push(nextId());\nrows.push(nextId());\n',
      dangerous:
        'import { Readable } from "node:stream";\nexport const readable = new Readable({ read() {} });\nreadable.push("a", "b");\nexport const rows = [];\nconst nextId = () => rows.length + 1;\nrows.push(nextId(), nextId());\n',
      fixed: ["export const list = [];\nlist.push(1);\nlist.push(2);\n", "export const list = [];\nlist.push(1, 2);\n"],
    },
    {
      rule: "unicorn/prefer-string-raw",
      kept: 'export const dir = "C:\\\\café\\\\menu";\n',
      fixed: ['export const dir = "C:\\\\cafe\\\\menu";\n', "export const dir = String.raw`C:\\cafe\\menu`;\n"],
    },
    {
      rule: "unicorn/text-encoding-identifier-case",
      kept: 'export const isUtf8 = new TextDecoder().encoding === "utf-8";\n',
      dangerous: 'export const isUtf8 = new TextDecoder().encoding === "utf8";\n',
      fixed: [
        'import fs from "node:fs";\nexport const text = fs.readFileSync("a.txt", "utf-8");\n',
        'import fs from "node:fs";\nexport const text = fs.readFileSync("a.txt", "utf8");\n',
      ],
    },
    {
      rule: "unicorn/prefer-regexp-test",
      // `pattern` can be a string or have the `g` flag, and `database` isn't a regular expression.
      kept: "export const has = (text, pattern) => (text.match(pattern) ? 1 : 2);\nexport const ran = (database, sql) => (database.exec(sql) ? 1 : 2);\n",
      dangerous:
        "export const has = (text, pattern) => (pattern.test(text) ? 1 : 2);\nexport const ran = (database, sql) => (database.test(sql) ? 1 : 2);\n",
      fixed: [
        "const pattern = /b/g;\nexport const has = text => (pattern.exec(text) ? 1 : 2);\nexport const starts = text => (`${text}`.match(/^b/) ? 1 : 2);\n",
        "const pattern = /b/g;\nexport const has = text => (pattern.test(text) ? 1 : 2);\nexport const starts = text => (/^b/.test(`${text}`) ? 1 : 2);\n",
      ],
    },
    {
      rule: "unicorn/no-useless-undefined",
      kept: "export const text = String(undefined);\nfor (const i of [1, 2]) {\n  var seen = undefined;\n  console.log(seen);\n  seen = i;\n}\nexport function f(a = undefined, b) {\n  return [a, b];\n}\n",
      dangerous:
        "export const text = String();\nfor (const i of [1, 2]) {\n  var seen;\n  console.log(seen);\n  seen = i;\n}\nexport function f(a, b) {\n  return [a, b];\n}\n",
      fixed: [
        "export function g() {\n  return undefined;\n}\nexport let x = undefined;\nx = g();\n",
        "export function g() {\n  return;\n}\nexport let x;\nx = g();\n",
      ],
    },
    {
      rule: "unicorn/no-useless-undefined",
      // `g` would return `void`, and `x` would lose its inferred type.
      kept: "export function g() {\n  return undefined;\n}\nexport let x = undefined;\nx = g();\n",
      dangerous: "export function g() {\n  return;\n}\nexport let x;\nx = g();\n",
      fixed: [
        "export function* h() {\n  yield undefined;\n}\nexport const { a = undefined } = { a: 1 };\n",
        "export function* h() {\n  yield;\n}\nexport const { a } = { a: 1 };\n",
      ],
      extension: "ts",
    },
    {
      rule: "unicorn/prefer-spread",
      kept: "export const copy = buffer1 => buffer1.slice();\nexport const list = arrayLike => Array.from(arrayLike);\n",
      dangerous: "export const copy = buffer1 => [...buffer1];\nexport const list = arrayLike => [...arrayLike];\n",
      fixed: [
        "const set = new Set([1, 2]);\nexport const list = Array.from(set);\n",
        "const set = new Set([1, 2]);\nexport const list = [...set];\n",
      ],
    },
    {
      rule: "unicorn/prefer-string-starts-ends-with",
      kept: "export const isA = x => /^a/.test(x);\n",
      dangerous: "export const isA = x => x.startsWith('a');\n",
      fixed: ["export const isA = x => /^a/.test(`${x}`);\n", "export const isA = x => `${x}`.startsWith('a');\n"],
    },
    {
      rule: "unicorn/no-useless-spread",
      kept: 'export const ranges = [\n  ...["<x", ">x"],\n  // the same after a wildcard\n  ...["<x.1", ">x.1"],\n];\n',
      fixed: ["export const a = [...[1, 2]]; // beside it\n", "export const a = [1, 2]; // beside it\n"],
    },
    {
      rule: "no-implicit-coercion",
      kept: "export const isOn = a =>\n  !!(\n    a // not b\n  );\n",
      fixed: ["export const isOn = a => !!a; // beside it\n", "export const isOn = a => Boolean(a); // beside it\n"],
    },
    {
      rule: "@typescript-eslint/method-signature-style",
      kept: "export interface Hot {\n  /** Accepts this module. */\n  accept(): void;\n  /** Accepts a dependency. */\n  accept(specifier: string): void;\n}\n",
      fixed: [
        "export interface Hot {\n  /** Accepts this module. */\n  accept(): void;\n}\n",
        "export interface Hot {\n  /** Accepts this module. */\n  accept: () => void;\n}\n",
      ],
      extension: "ts",
    },
    // A type alias can't be declared twice, so a merged interface has no fix. Two properties with the same name parse
    // but don't type check, so that fix needs --fix-dangerously.
    {
      rule: "@typescript-eslint/no-empty-interface",
      kept: "export interface Base { a: number }\nexport interface Thing extends Base {}\nexport interface Thing { b: string }\n",
      fixed: [
        "export interface Base { a: number }\nexport interface Alone extends Base {}\n",
        "export interface Base { a: number }\nexport type Alone = Base\n",
      ],
      extension: "ts",
    },
    {
      rule: "@typescript-eslint/method-signature-style",
      kept: "export interface Api { get(id: number): string }\nexport interface Api { get(id: string): number }\n",
      dangerous:
        "export interface Api { get: (id: number) => string }\nexport interface Api { get: (id: string) => number }\n",
      fixed: [
        "export interface Api { get(id: number): string }\n",
        "export interface Api { get: (id: number) => string }\n",
      ],
      extension: "ts",
    },
    {
      rule: "@typescript-eslint/prefer-function-type",
      kept: "export interface Handler { (event: string): void }\nexport interface Handler { once?: boolean }\n",
      fixed: [
        "export interface Handler { (event: string): void }\n",
        "export type Handler = (event: string) => void\n",
      ],
      extension: "ts",
    },
    {
      rule: "@typescript-eslint/consistent-indexed-object-style",
      kept: "export interface Env { [key: string]: string | undefined }\nexport interface Env { HOME: string }\n",
      fixed: ["export interface Env { [key: string]: string }\n", "export type Env = Record<string, string>;\n"],
      extension: "ts",
    },
    {
      // Other files can merge with an interface in `declare global`. A single top-level interface in a script is fixed.
      rule: "@typescript-eslint/prefer-function-type",
      kept: "export {};\ndeclare global {\n  interface Handler { (event: string): void }\n}\n",
      dangerous: "export {};\ndeclare global {\n  type Handler = (event: string) => void\n}\n",
      fixed: [
        'interface Handler { (event: string): void }\nconst handler: Handler = () => {};\nhandler("a");\n',
        'type Handler = (event: string) => void\nconst handler: Handler = () => {};\nhandler("a");\n',
      ],
      extension: "ts",
    },
    {
      rule: "unicorn/require-module-specifiers",
      kept: 'const name = "one";\nconsole.log(name);\nexport {};\n',
      dangerous: 'const name = "one";\nconsole.log(name);\n\n',
      fixed: ["export const a = 1;\nexport {};\n", "export const a = 1;\n\n"],
      extension: "ts",
    },
    {
      rule: "unicorn/prefer-dom-node-append",
      kept: 'export const add = (list, item) => {\n  list.appendChild(item);\n};\nexport const li = document.body.appendChild(document.createElement("li"));\n',
      dangerous:
        'export const add = (list, item) => {\n  list.append(item);\n};\nexport const li = document.body.append(document.createElement("li"));\n',
      fixed: [
        'document.body.appendChild(document.createElement("p"));\n',
        'document.body.append(document.createElement("p"));\n',
      ],
    },
    {
      rule: "unicorn/prefer-dom-node-dataset",
      kept: 'new HTMLRewriter().on("div", {\n  element(element) {\n    element.setAttribute("data-count", "1");\n  },\n});\nexport const count = document.body.getAttribute("data-count");\n',
      dangerous:
        'new HTMLRewriter().on("div", {\n  element(element) {\n    element.dataset.count = "1";\n  },\n});\nexport const count = document.body.dataset.count;\n',
      fixed: ['document.body.setAttribute("data-count", "1");\n', 'document.body.dataset.count = "1";\n'],
    },
    {
      rule: "unicorn/prefer-query-selector",
      kept: 'export const a = document.getElementById("user.name");\nexport const b = document.getElementsByClassName("item");\n',
      dangerous:
        'export const a = document.querySelector("#user.name");\nexport const b = document.querySelectorAll(".item");\n',
      fixed: [
        'export const main = document.getElementById("main");\n',
        'export const main = document.querySelector("#main");\n',
      ],
    },
    {
      rule: "unicorn/prefer-dom-node-text-content",
      kept: "export const text = node => node.innerText;\n",
      dangerous: "export const text = node => node.textContent;\n",
    },
    {
      rule: "unicorn/prefer-keyboard-event-key",
      kept: 'window.addEventListener("keydown", event => {\n  if (event.keyCode === 65) save();\n});\n',
      dangerous: "window.addEventListener(\"keydown\", event => {\n  if (event.key === 'A') save();\n});\n",
      fixed: [
        'window.addEventListener("keydown", event => {\n  if (event.keyCode === 27) close();\n});\n',
        "window.addEventListener(\"keydown\", event => {\n  if (event.key === 'Escape') close();\n});\n",
      ],
    },
    {
      rule: "prefer-destructuring",
      kept: "export function f(o: { x?: number }) {\n  let x: number | null | undefined = o.x;\n  x ??= null;\n  return x;\n}\n",
      fixed: [
        "export function f(o: { x: number }) {\n  const x = o.x;\n  return x;\n}\n",
        "export function f(o: { x: number }) {\n  const {x} = o;\n  return x;\n}\n",
      ],
      extension: "ts",
    },
    {
      rule: "import/order",
      kept: 'import { b } from "./b";\n// @ts-expect-error there are no types for this one\nimport { a } from "a-package";\nconsole.log(a, b);\n',
      fixed: [
        'import { b } from "./b";\nimport { a } from "a-package";\nconsole.log(a, b);\n',
        'import { a } from "a-package";\nimport { b } from "./b";\nconsole.log(a, b);\n',
      ],
      extension: "ts",
    },
    {
      rule: "import/order",
      // The `@type` comment would apply to `a`.
      kept: '/** @type {{ b: number }} */\nconst b = require("./b");\nconst a = require("a-package");\nconsole.log(a, b);\n',
      fixed: [
        '// the two letters\nconst b = require("./b");\nconst a = require("a-package");\nconsole.log(a, b);\n',
        '// the two letters\nconst a = require("a-package");\nconst b = require("./b");\nconsole.log(a, b);\n',
      ],
    },
    {
      rule: "import/order",
      // The doc comment would end up above `console.log`. A license followed by an empty line stays at the top.
      kept: 'import { b } from "./b";\n/** The package. */\nimport { a } from "a-package";\nconsole.log(a, b);\n',
      fixed: [
        '/**\n * Copyright 2024 Foo\n */\n\nimport { b } from "./b";\nimport { a } from "a-package";\nconsole.log(a, b);\n',
        '/**\n * Copyright 2024 Foo\n */\n\nimport { a } from "a-package";\nimport { b } from "./b";\nconsole.log(a, b);\n',
      ],
    },
    {
      rule: "import/order",
      // A header doesn't hide the directive below it.
      kept: '/** @fileoverview Prints two letters. */\n// @ts-expect-error there are no types for this one\nimport { b } from "./b";\nimport { a } from "a-package";\nconsole.log(a, b);\n',
      fixed: [
        '/** @fileoverview Prints two letters. */\nimport { b } from "./b";\nimport { a } from "a-package";\nconsole.log(a, b);\n',
        '/** @fileoverview Prints two letters. */\nimport { a } from "a-package";\nimport { b } from "./b";\nconsole.log(a, b);\n',
      ],
      extension: "ts",
    },
    {
      rule: "import/order",
      // Here the first import is the one that moves.
      kept: '/** The local one. */\nimport { b } from "./b";\nimport { a } from "a-package";\nimport { c } from "c-package";\nconsole.log(a, b, c);\n',
      fixed: [
        '/** @fileoverview Prints three letters. */\nimport { b } from "./b";\nimport { a } from "a-package";\nimport { c } from "c-package";\nconsole.log(a, b, c);\n',
        '/** @fileoverview Prints three letters. */\nimport { a } from "a-package";\nimport { c } from "c-package";\nimport { b } from "./b";\nconsole.log(a, b, c);\n',
      ],
    },
    {
      rule: "import/order",
      // `require("./b")` and `[a, b]` would parse as one expression.
      kept: 'const b = require("./b")\nconst a = require("a-package")\n;[a, b].forEach(console.log)\n',
      fixed: [
        'const b = require("./b");\nconst a = require("a-package")\n;[a, b].forEach(console.log)\n',
        'const a = require("a-package")\n;\nconst b = require("./b");\n[a, b].forEach(console.log)\n',
      ],
    },
  ];

  test.each(cases)("$rule", async ({ rule, kept, dangerous = kept, fixed, extension = "js" }) => {
    const [keptName, fixedName] = [`kept.${extension}`, `fixed.${extension}`];
    const [before, after] = fixed ? [{ [fixedName]: fixed[0] }, { [fixedName]: fixed[1] }] : [{}, {}];
    const files = { [keptName]: kept, ...before };
    const [safe, all] = await Promise.all([
      lint(files, ["--fix", "--rule", `${rule}: warn`]),
      lint(files, ["--fix-dangerously", "--rule", `${rule}: warn`]),
    ]);
    const filesWithReports = (result: { reports: string[] }) => [
      ...new Set(result.reports.filter(it => it.endsWith(` ${rule}`)).map(it => it.slice(0, it.indexOf(":")))),
    ];
    expect(safe.texts).toEqual({ [keptName]: kept, ...after });
    expect(filesWithReports(safe)).toEqual([keptName]);
    expect(all.texts).toEqual({ [keptName]: dangerous, ...after });
    expect(filesWithReports(all)).toEqual(dangerous === kept ? [keptName] : []);
  });

  describe("@typescript-eslint/prefer-function-type", () => {
    const rule = "@typescript-eslint/prefer-function-type";
    const use = "export const handler: Handler = () => {};\n";
    const alias = "type Handler = (event: string) => void;";
    /** Code before and after --fix. */
    type Cases = Record<string, [string, string]>;
    // typescript-eslint 8.71.1 moves a line comment that follows the signature in front of the declaration, which
    // comments the declaration out. It also reverses the comments' order and drops comments before the `{`.
    // oxlint 1.87.0 duplicates a comment inside the signature and drops every comment in an interface with type
    // parameters or in a type literal.
    const comments: Cases = {
      "after-the-signature.ts": [
        `interface Handler {\n  (event: string): void; // called once\n}\n${use}`,
        `// called once\n${alias}\n${use}`,
      ],
      "above-the-signature.ts": [
        `interface Handler {\n  // called once\n  (event: string): void;\n}\n${use}`,
        `// called once\n${alias}\n${use}`,
      ],
      "below-the-signature.ts": [
        `interface Handler {\n  (event: string): void;\n  // called once\n}\n${use}`,
        `// called once\n${alias}\n${use}`,
      ],
      "after-the-opening-brace.ts": [
        `interface Handler { // called once\n  (event: string): void;\n}\n${use}`,
        `// called once\n${alias}\n${use}`,
      ],
      "after-the-closing-brace.ts": [
        `interface Handler {\n  (event: string): void;\n} // called once\n${use}`,
        `${alias} // called once\n${use}`,
      ],
      "code-after-the-closing-brace.ts": [
        `interface Handler {\n  (event: string): void; // called once\n} ${use}`,
        `// called once\n${alias} ${use}`,
      ],
      "everywhere.ts": [
        `interface /* one */ Handler /* two */ { // three\n  // four\n  /* five */ (event: string /* six */): void /* seven */; // eight\n  /** nine */\n} // ten\n${use}`,
        `/* one */\n/* two */\n// three\n// four\n/* five */ // eight\n/** nine */\ntype Handler = (event: string /* six */) => void /* seven */; // ten\n${use}`,
      ],
      "block-comments-on-the-line.ts": [
        `interface Handler {\n  /* called */ (event: string): void; /* once */\n}\n${use}`,
        `/* called */ /* once */ ${alias}\n${use}`,
      ],
      "jsdoc.ts": [
        `interface Handler {\n  /**\n   * Called once.\n   */\n  (event: string): void;\n}\n${use}`,
        `/**\n   * Called once.\n   */\n${alias}\n${use}`,
      ],
      "in-the-signature.ts": [
        `interface Handler {\n  (\n    event: string, // the name\n  ): void;\n}\n${use}`,
        `type Handler = (\n    event: string, // the name\n  ) => void;\n${use}`,
      ],
      "comma.ts": [
        `interface Handler {\n  (event: string): void, // called once\n}\n${use}`,
        `// called once\n${alias}\n${use}`,
      ],
      "crlf.ts": [
        `interface Handler {\r\n  (event: string): void; // called once\r\n}\r\n${use}`,
        `// called once\n${alias}\r\n${use}`,
      ],
      "export.ts": [
        "export interface Handler {\n  /* called */ (event: string): void; // once\n}\n",
        `/* called */\n// once\nexport ${alias}\n`,
      ],
      "export-declare.ts": [
        "export declare interface Handler {\n  (event: string): void; // called once\n}\n",
        `// called once\nexport ${alias}\n`,
      ],
      "declare.ts": [
        `declare interface Handler {\n  (event: string): void; // called once\n}\n${use}`,
        `// called once\n${alias}\n${use}`,
      ],
      "type-parameters.ts": [
        "export interface Handler<T /* the event */> /* generic */ {\n  (event: T): void; // called once\n}\n",
        "/* generic */\n// called once\nexport type Handler<T /* the event */> = (event: T) => void;\n",
      ],
      "construct-signature.ts": [
        "export interface Maker {\n  new (name: string): object; // called once\n}\n",
        "// called once\nexport type Maker = new (name: string) => object;\n",
      ],
      "directive.ts": [
        "export interface Handler {\n  // @ts-expect-error Missing is not declared\n  (event: Missing): void;\n}\n",
        "// @ts-expect-error Missing is not declared\nexport type Handler = (event: Missing) => void;\n",
      ],
      "type-literal.ts": [
        "export type Handler = {\n  (event: string): void; // called once\n};\n",
        "export type Handler = // called once\n(event: string) => void;\n",
      ],
      "type-literal-above.ts": [
        "export type Handler = {\n  // called once\n  (event: string): void;\n};\n",
        "export type Handler = // called once\n(event: string) => void;\n",
      ],
      "type-literal-comma.ts": [
        "export type Handler = { (event: string): void, };\n",
        "export type Handler = (event: string) => void;\n",
      ],
      "union.ts": [
        "export type Handler = {\n  (event: string): void; // called once\n} | undefined;\n",
        "export type Handler = // called once\n((event: string) => void) | undefined;\n",
      ],
      "union-on-one-line.ts": [
        "export type Handler = { /* called */ (event: string): void /* once */ } | undefined;\n",
        "export type Handler = /* called */ /* once */ ((event: string) => void) | undefined;\n",
      ],
      "parameter.ts": [
        'export function call(handler: {\n  (event: string): void; // called once\n}) {\n  handler("a");\n}\n',
        'export function call(handler: // called once\n(event: string) => void) {\n  handler("a");\n}\n',
      ],
    };
    // oxlint doesn't report these. typescript-eslint only adds parentheses for the array. Without them,
    // `() => void["length"]` and `() => void extends object ? 1 : 2` are function types.
    const parentheses: Cases = {
      "array.ts": [
        "export type Handlers = {\n  (event: string): void; // called once\n}[];\n",
        "export type Handlers = // called once\n((event: string) => void)[];\n",
      ],
      "keyof.ts": ["export type Keys = keyof { (): void };\n", "export type Keys = keyof (() => void);\n"],
      "indexed-access.ts": [
        'export type Length = { (): void }["length"];\n',
        'export type Length = (() => void)["length"];\n',
      ],
      "conditional.ts": [
        "export type One = { (): void } extends object ? 1 : 2;\nexport type IsCallable<T> = T extends { (): void } ? { (): true } : { (): false };\n",
        "export type One = (() => void) extends object ? 1 : 2;\nexport type IsCallable<T> = T extends (() => void) ? () => true : () => false;\n",
      ],
      "tuple.ts": [
        "export type Optional = [{ (): void }?];\nexport type Named = [handler?: { (): void }];\n",
        "export type Optional = [(() => void)?];\nexport type Named = [handler?: () => void];\n",
      ],
      "type-argument.ts": [
        "export const handlers: Array<{ (): void }> = [];\n",
        "export const handlers: Array<() => void> = [];\n",
      ],
    };
    // `export default type` doesn't exist. In the other two files, a block comment would end up between the directive
    // and its line.
    const kept = {
      "export-default.ts": "export default interface Handler {\n  (event: string): void; // called once\n}\n",
      "directive-above.ts":
        "// @ts-expect-error Missing is not declared\nexport interface Handler<T extends Missing> {\n  /* called once */\n  (event: T): void;\n}\n",
      "directive-and-a-comment-below.ts":
        "export interface Handler {\n  // @ts-expect-error Missing is not declared\n  (event: Missing): void;\n  /* called once */\n}\n",
    };
    const inNamespace: Cases = {
      "namespace.ts": [
        `export namespace Events {\n  interface Handler {\n    (event: string): void; // called once\n  }\n  ${use}}\n`,
        `export namespace Events {\n  // called once\n${alias}\n  ${use}}\n`,
      ],
      "exported-from-namespace.ts": [
        "export namespace Events {\n  export interface Handler {\n    (event: string): void; // called once\n  }\n}\n",
        `export namespace Events {\n  // called once\nexport ${alias}\n}\n`,
      ],
    };
    const pick = (cases: Cases, index: 0 | 1) =>
      Object.fromEntries(Object.entries(cases).map(([name, texts]) => [name, texts[index]]));
    const filesWithReports = (result: { reports: string[] }) =>
      [...new Set(result.reports.filter(it => it.endsWith(` ${rule}`)).map(it => it.slice(0, it.indexOf(":"))))].sort();
    const turnedOn = ["--rule", `${rule}: warn`];
    const oxlintrc = '{ "plugins": ["typescript"], "rules": { "typescript/prefer-function-type": "warn" } }\n';

    test.each([
      ["no config", {}, turnedOn, { ...comments, ...parentheses }],
      [".oxlintrc.json", { ".oxlintrc.json": oxlintrc }, [], comments],
    ])("--fix keeps every comment exactly once and never comments out code: %s", async (_, config, args, cases) => {
      const expected = { ...config, ...pick(cases, 1), ...kept };
      const first = await lint({ ...config, ...pick(cases, 0), ...kept }, ["--fix", ...args]);
      expect(first.texts).toEqual(expected);
      const second = await lint(first.texts, ["--fix", ...args]);
      expect(second.texts).toEqual(expected);
    });

    test("still reports code it can't fix", async () => {
      const result = await lint({ ...pick(comments, 0), ...kept }, ["--fix-dangerously", ...turnedOn]);
      expect(result.texts).toEqual({ ...pick(comments, 1), ...kept });
      expect(filesWithReports(result)).toEqual(Object.keys(kept).sort());
    });

    test("only --fix-dangerously fixes an interface in a namespace", async () => {
      const [safe, first] = await Promise.all([
        lint(pick(inNamespace, 0), ["--fix", ...turnedOn]),
        lint(pick(inNamespace, 0), ["--fix-dangerously", ...turnedOn]),
      ]);
      expect(safe.texts).toEqual(pick(inNamespace, 0));
      expect(filesWithReports(safe)).toEqual(Object.keys(inNamespace).sort());
      expect(first.texts).toEqual(pick(inNamespace, 1));
      const second = await lint(first.texts, ["--fix-dangerously", ...turnedOn]);
      expect(second.texts).toEqual(pick(inNamespace, 1));
      expect(filesWithReports(second)).toEqual([]);
    });
  });

  test("--fix inserts an import below the hashbang, directives and file-level comments", async () => {
    const body = 'test("a", () => {\n  expect(1).toBe(1);\n});\n';
    const heads = ["// @ts-nocheck\n", '/// <reference types="node" />\n', '"use strict";\n', "#!/usr/bin/env bun\n"];
    const files = Object.fromEntries(heads.map((head, i) => [`${i}.test.ts`, head + body]));
    const [vitest, jest, first] = await Promise.all([
      lint(files, ["--fix", "--rule", "vitest/prefer-importing-vitest-globals: warn"]),
      lint(files, ["--fix", "--rule", "jest/prefer-importing-jest-globals: warn"]),
      lint({ "a.ts": '"use client";\nconst started = 1;\nimport { b } from "./b";\nconsole.log(started, b);\n' }, [
        "--fix",
        "--rule",
        "import/first: warn",
      ]),
    ]);
    for (const [i, head] of heads.entries()) {
      expect(vitest.texts[`${i}.test.ts`]).toBe(`${head}import { expect, test } from 'vitest';\n${body}`);
      expect(jest.texts[`${i}.test.ts`]).toStartWith(head);
      expect(jest.texts[`${i}.test.ts`]).toContain("@jest/globals");
    }
    expect(first.texts["a.ts"]).toBe(
      '"use client";\nimport { b } from "./b";\nconst started = 1;\nconsole.log(started, b);\n',
    );
  });

  describe("an import that becomes the first statement", () => {
    type Cases = Record<string, [before: string, after: string]>;
    const license = "// Copyright 2026 Someone\n// Use of this file is governed by the MIT license.\n";
    const moduleDoc = "/**\n * Counts.\n * @module\n */\n\n";
    const suppressed = "// @ts-expect-error a string is no number\n";
    const filesWithReports = (result: { reports: string[] }, rule: string) =>
      [...new Set(result.reports.filter(it => it.endsWith(` ${rule}`)).map(it => it.slice(0, it.indexOf(":"))))].sort();

    /** Expects `--fix` to turn each `before` into its `after` and report nothing, and a second run to be a no-op. */
    async function expectFixed(rule: string, cases: Cases) {
      const pick = (index: 0 | 1) => Object.fromEntries(Object.entries(cases).map(([name, it]) => [name, it[index]]));
      const args = ["--fix", "--rule", `${rule}: warn`];
      const first = await lint(pick(0), args);
      expect(first.texts).toEqual(pick(1));
      expect(filesWithReports(first, rule)).toEqual([]);
      const second = await lint(first.texts, args);
      expect(second.texts).toEqual(pick(1));
    }

    /** Expects `--fix` to leave the files unchanged without attempting a broken fix, and to still report each file. */
    async function expectKept(rule: string, files: Record<string, string>) {
      const result = await lint(files, ["--fix", "--rule", `${rule}: warn`]);
      expect(result.texts).toEqual(files);
      expect(result.stderr).not.toContain("not applied");
      expect(filesWithReports(result, rule)).toEqual(Object.keys(files).sort());
    }

    // Each entry is the header that must stay first, then the first statement with its own comments.
    const heads: Record<string, [head: string, first: string]> = {
      "directive.ts": ["", `${suppressed}console.log(Math.abs("1"));\n`],
      "doc.ts": ["", "/** Adds one. */\nfunction increment(n: number) {\n  return n + 1;\n}\n"],
      "use-client.ts": ['"use client";\n', `${suppressed}console.log(Math.abs("1"));\n`],
      "use-strict.ts": ['"use strict";\n', "/** Starts at one. */\nconst count = 1;\n"],
      "comment-beside-use-client.ts": ['"use client"; // for the router\n', "// starts at one\nconst count = 1;\n"],
      "nocheck.ts": ["// @ts-nocheck\n", "// starts at one\nconst count = 1;\n"],
      "reference.ts": ['/// <reference lib="dom" />\n', "// starts at one\nconst count = 1;\n"],
      "hashbang.ts": ["#!/usr/bin/env bun\n", "// starts at one\nconst count = 1;\n"],
      "license.ts": [`${license}\n`, "// starts at one\nconst count = 1;\n"],
      "license-without-an-empty-line.ts": [license, "const count = 1;\n"],
      "license-in-two-paragraphs.ts": [
        `${license}\n// IT IS PROVIDED "AS IS".\n\n`,
        "// starts at one\nconst count = 1;\n",
      ],
      "license-and-directive.ts": [license, `${suppressed}console.log(Math.abs("1"));\n`],
      "directive-above-license.ts": ["", `${suppressed}// Copyright 2026 Someone\nconsole.log(Math.abs("1"));\n`],
      "module-doc.ts": [moduleDoc, "/** Starts at one. */\nconst count = 1;\n"],
      "jest-environment.ts": ["/**\n * @jest-environment jsdom\n */\n", "// starts at one\nconst count = 1;\n"],
      "doc-above-nocheck.ts": ["/** Counts. */\n// @ts-nocheck\n", "// starts at one\nconst count = 1;\n"],
      "doc-above-reference.ts": ['/** Counts. */\n/// <reference lib="dom" />\n', "const count = 1;\n"],
      "doc-above-license.ts": [`/** Counts. */\n${license}\n`, "/** Starts at one. */\nconst count = 1;\n"],
      "byte-order-mark.ts": ["\ufeff", "// starts at one\nconst count = 1;\n"],
      // An empty line separates file-level comments from the first statement's comments.
      "header.ts": ["// Counts things.\n// Nothing else.\n\n", "const count = 1;\n"],
      "header-in-a-block.ts": ["/**\n * Counts things.\n */\n\n", "// starts at one\nconst count = 1;\n"],
      "header-and-doc.ts": ["// Counts things.\n\n", "/** Starts at one. */\nconst count = 1;\n"],
      "header-in-two-parts.ts": ["// Counts things.\n\n// Nothing else.\n\n", "// starts at one\nconst count = 1;\n"],
      "header-without-an-empty-line.ts": ["", "// Counts things.\n// Nothing else.\nconst count = 1;\n"],
      "header-below-use-strict.ts": ['"use strict";\n// Counts things.\n\n', "// starts at one\nconst count = 1;\n"],
      "header-below-hashbang.ts": ["#!/usr/bin/env bun\n// Counts things.\n\n", "// starts at one\nconst count = 1;\n"],
      "header-and-directive.ts": ["// Counts things.\n\n", `${suppressed}console.log(Math.abs("1"));\n`],
      "disable-in-the-middle.ts": [
        "// Counts things.\n/* eslint-disable @typescript-eslint/no-unused-vars */\n",
        "// starts at one\nconst count = 1;\n",
      ],
      // A next-line directive applies across an empty line, so it and the comments below it stay with the statement.
      "directive-and-empty-line.ts": ["", `${suppressed}\nconsole.log(Math.abs("1"));\n`],
      "directive-above-header.ts": ["", `${suppressed}// Counts things.\n\nconsole.log(Math.abs("1"));\n`],
      "triple-slash-directive.ts": ["", `/${suppressed}\nconsole.log(Math.abs("1"));\n`],
      "directive-above-reference.ts": [
        '// deno-lint-ignore triple-slash-reference\n/// <reference lib="dom" />\n',
        "const count = 1;\n",
      ],
      "ignore-above-license.ts": ["", `// prettier-ignore\n${license}const count   = 1;\n`],
      "directive-for-the-file.ts": [license, '// @ts-ignore-file\nconsole.log(Math.abs("1"));\n'],
      "directive-with-a-suffix.ts": [license, '// @ts-expect-error-next-line\nconsole.log(Math.abs("1"));\n'],
      "coverage.ts": ["", "/* v8 ignore next -- @preserve */\n\nconst count = 1;\n"],
      "no-side-effects.ts": ["", "/* @__NO_SIDE_EFFECTS__ */\n\nfunction one() {\n  return 1;\n}\n"],
      "deno.ts": ["// deno-lint-ignore-file no-console\n", "// deno-lint-ignore no-unused-vars\n\nconst count = 1;\n"],
    };
    // Repeat a few with CRLF line endings.
    for (const name of ["directive.ts", "use-strict.ts", "license.ts", "header.ts", "header-in-two-parts.ts"]) {
      heads[`crlf-${name}`] = heads[name];
    }
    const withLineBreaksOf = (name: string, text: string) =>
      name.startsWith("crlf-") ? text.replaceAll("\n", "\r\n") : text;

    test("import/first: moves the import below the file header, above the first statement's comments", async () => {
      const a = 'import { a } from "./a";\n';
      const cases = Object.entries(heads).map(([name, [head, first]]) => [
        name,
        [`${head}${first}${a}console.log(a);\n`, `${head}${a}${first}console.log(a);\n`].map(it =>
          withLineBreaksOf(name, it),
        ),
      ]);
      await expectFixed("import/first", {
        ...Object.fromEntries(cases),
        "directive-beside-use-client.ts": [
          `"use client"; ${suppressed}console.log(Math.abs("1"));\n${a}console.log(a);\n`,
          `"use client"; ${a}${suppressed}console.log(Math.abs("1"));\nconsole.log(a);\n`,
        ],
        "indented.ts": [
          `  // starts at one\n  const count = 1;\n  ${a}  console.log(a, count);\n`,
          `  ${a}  // starts at one\n  const count = 1;\n  console.log(a, count);\n`,
        ],
      });
    });

    test.each([
      ["vitest/prefer-importing-vitest-globals", "import { test } from 'vitest';\n"],
      ["jest/prefer-importing-jest-globals", "const { test } = require('@jest/globals');\n"],
    ])("%s: adds the import below the file header, above the first statement's comments", async (rule, statement) => {
      const cases = Object.entries(heads).map(([name, [head, first]]) => [
        name.replace(".ts", ".test.ts"),
        [`${head}${first}test("a", () => {});\n`, `${head}${statement}${first}test("a", () => {});\n`].map(it =>
          withLineBreaksOf(name, it),
        ),
      ]);
      await expectFixed(rule, Object.fromEntries(cases));
    });

    test.each([
      ["vitest/prefer-importing-vitest-globals", "import { test } from 'vitest';\n"],
      ["jest/prefer-importing-jest-globals", "import { test } from '@jest/globals';\n"],
    ])("%s: adds the import in a file that starts with comments and imports", async (rule, statement) => {
      const rest = 'import { a } from "./a";\ntest("a", () => a);\n';
      await expectFixed(rule, {
        "header.test.ts": [`// Tests a.\n\n${rest}`, `// Tests a.\n\n${statement}${rest}`],
        "header-without-an-empty-line.test.ts": [`// Tests a.\n${rest}`, `${statement}// Tests a.\n${rest}`],
      });
    });

    test("import/first: keeps a trailing comment with its statement", async () => {
      const [a, b] = ['import { a } from "./a";', 'import { b } from "./b";'];
      await expectFixed("import/first", {
        "the-statement-before.ts": [
          `const count = 1; // starts at one\n${a}\nconsole.log(a, count);\n`,
          `${a}\nconst count = 1; // starts at one\nconsole.log(a, count);\n`,
        ],
        "the-import.ts": [
          `const count = 1;\n${a} // the first letter\nconsole.log(a, count);\n`,
          `${a} // the first letter\nconst count = 1;\nconsole.log(a, count);\n`,
        ],
        "two-imports.ts": [
          `const count = 1;\n${a} // the first letter\n${b} // the second letter\nconsole.log(a, b, count);\n`,
          `${a} // the first letter\n${b} // the second letter\nconst count = 1;\nconsole.log(a, b, count);\n`,
        ],
        "the-last-import-on-top.ts": [
          `${b} // the second letter\nconst count = 1;\n${a}\nconsole.log(a, b, count);\n`,
          `${b} // the second letter\n${a}\nconst count = 1;\nconsole.log(a, b, count);\n`,
        ],
        "an-import-behind-a-statement.ts": [
          `const count = 1;\n${a} // the first letter\nconsole.log(count); ${b}\nconsole.log(a, b);\n`,
          `${a} // the first letter\n${b}\nconst count = 1;\nconsole.log(count);\nconsole.log(a, b);\n`,
        ],
        // These two comments apply to the next line.
        "directive-for-the-import.ts": [
          'const count = 1; // @ts-expect-error there is no c\nimport { c } from "./a";\nconsole.log(c, count);\n',
          '// @ts-expect-error there is no c\nimport { c } from "./a";\nconst count = 1;\nconsole.log(c, count);\n',
        ],
        "directive-beside-the-import.ts": [
          `const count = 1;\n${a} ${suppressed}console.log(Math.abs("1"));\nconsole.log(a, count);\n`,
          `${a}\nconst count = 1; ${suppressed}console.log(Math.abs("1"));\nconsole.log(a, count);\n`,
        ],
      });
      // The second `run()` would end up inside the comment.
      await expectKept("import/first", { "code-behind-the-import.js": 'run(); // once\nimport "./side"; run();\n' });
    });

    describe("import/first: in code without semicolons", () => {
      // Each of these continues the previous line's statement unless that line ends with a `;`.
      const starts = {
        bracket: "[1, 2].forEach(run)",
        parenthesis: "(function () {})()",
        template: "`a`.trim()",
        plus: "+run()",
        minus: "-run()",
        regex: "/a/.test(run())",
        jsx: "<div />",
      };
      const each = <T>(make: (name: string, start: string) => [string, T][]) =>
        Object.fromEntries(Object.entries(starts).flatMap(([name, start]) => make(name, start)));

      test("keeps a leading `;` on its line", async () => {
        await expectFixed("import/first", {
          ...each<[string, string]>((name, start) => [
            [`${name}.js`, [`run()\nimport "./side"\n;${start}\n`, `import "./side"\nrun()\n;${start}\n`]],
            [`closed-${name}.js`, [`run();\nimport "./side"\n${start}\n`, `import "./side"\nrun();\n${start}\n`]],
          ]),
          "two-imports.js": [
            'run()\nimport "./side"\nimport "./other"\n;[1, 2].forEach(run)\n',
            'import "./side"\nimport "./other"\nrun()\n;[1, 2].forEach(run)\n',
          ],
          "comment-beside-the-import.js": [
            'run()\nimport "./side" // first\n;[1, 2].forEach(run)\n',
            'import "./side" // first\nrun()\n;[1, 2].forEach(run)\n',
          ],
          "below-the-last-import-on-top.js": [
            'import "./first"\n;[1, 2].forEach(run)\nimport "./side"\n',
            'import "./first"\nimport "./side"\n;[1, 2].forEach(run)\n',
          ],
        });
      });

      test("moves an import without a `;` onto its own line", async () => {
        await expectFixed("import/first", {
          "behind-a-statement.js": ['run(); import "./side"\nrun()\n', 'import "./side"\nrun();\nrun()\n'],
          "behind-a-statement-with-an-import-on-top.js": [
            'import "./first"\nrun(); import "./side"\nrun()\n',
            'import "./first"\nimport "./side"\nrun();\nrun()\n',
          ],
          "behind-a-block.js": [
            'if (run()) {} import "./side"\n[1, 2].forEach(run)\n',
            'import "./side"\nif (run()) {}\n[1, 2].forEach(run)\n',
          ],
        });
      });

      test("fixes the import when the next line can't continue the previous statement", async () => {
        await expectFixed("import/first", {
          "word.js": ['run()\nimport "./side"\nrun()\n', 'import "./side"\nrun()\nrun()\n'],
          "increment.js": ['let n = run()\nimport "./side"\n++n\n', 'import "./side"\nlet n = run()\n++n\n'],
          "function.js": [
            'function f() {}\nimport "./side"\n[1, 2].forEach(f)\n',
            'import "./side"\nfunction f() {}\n[1, 2].forEach(f)\n',
          ],
          "same-line.js": ['run();\nimport "./side"; run()\n', 'import "./side";\nrun(); run()\n'],
          "parenthesis-after-increment.js": [
            'let n = 1\nn++\nimport "./side"\n(run)(n)\n',
            'import "./side"\nlet n = 1\nn++\n(run)(n)\n',
          ],
          "parenthesis-after-type.ts": [
            'const n = run() as number\nimport "./side"\n(run)(n)\n',
            'import "./side"\nconst n = run() as number\n(run)(n)\n',
          ],
        });
      });

      test("doesn't fix the import when two statements would merge", async () => {
        await expectKept("import/first", {
          ...each<string>((name, start) => [
            [`${name}.js`, `run()\nimport "./side"\n${start}\n`],
            [`semicolon-${name}.js`, `run()\nimport "./side";\n${start}\n`],
          ]),
          "object.js": 'const o = {}\nimport "./side"\n[1, 2].forEach(run)\n',
          "two-imports.js": 'run()\nimport "./side"\nimport "./other"\n[1, 2].forEach(run)\n',
          "same-line.js": 'run()\nimport "./side"; run()\n',
          "same-line-parenthesis.js": 'run()\nimport "./side"; (run)()\n',
          "plus-after-increment.js": 'let n = 1\nn++\nimport "./side"\n+run(n)\n',
          "minus-after-type.ts": 'const n = run() as number\nimport "./side"\n-run(n)\n',
          "minus-after-type-in-braces.ts": 'const o = {} satisfies { a?: 1 }\nimport "./side"\n-run(o)\n',
        });
      });
    });

    test("import/first: keeps an import below an `export .. from` so the modules run in the same order", async () => {
      await expectKept("import/first", {
        "all.js": 'export * from "./first";\nimport "./side";\n',
        "names.js": 'export { a } from "./first";\nimport "./side";\n',
      });
      await expectFixed("import/first", {
        "own-names.js": [
          'const a = 1;\nexport { a };\nimport "./side";\n',
          'import "./side";\nconst a = 1;\nexport { a };\n',
        ],
      });
    });
  });

  test("with --type-aware, fixes still type check and keep string coercions", async () => {
    const files = {
      "tsconfig.json": '{ "compilerOptions": { "strict": true, "types": [], "lib": ["esnext"] }, "include": ["*.ts"] }',
      // `readonly #limit = 0` has type `0`, so the constructor couldn't assign a number to it.
      "readonly.ts":
        "export class Pool {\n  #limit = 0;\n  constructor(limit: number) {\n    this.#limit = limit;\n  }\n  get limit() {\n    return this.#limit;\n  }\n}\n",
      // An untyped caller can pass a number.
      "coerce.ts": 'export function time(label = "default") {\n  label = `${label}`;\n  return label;\n}\n',
      "plain.ts": "declare const name: string;\nexport const text = `${name}`;\n",
    };
    const rules = ["prefer-readonly", "no-unnecessary-template-expression"].flatMap(rule => [
      "--rule",
      `@typescript-eslint/${rule}: warn`,
    ]);
    const [safe, all] = await Promise.all([
      lint(files, ["--fix", "--type-aware", ...rules]),
      lint(files, ["--fix-dangerously", "--type-aware", ...rules]),
    ]);
    expect(safe.texts["readonly.ts"]).toBe(files["readonly.ts"].replace("#limit = 0", "readonly #limit: number = 0"));
    expect(safe.texts["coerce.ts"]).toBe(files["coerce.ts"]);
    expect(safe.reports.filter(it => it.endsWith("no-unnecessary-template-expression"))).toEqual([
      expect.stringMatching(/^coerce\.ts:2:/),
    ]);
    expect(safe.texts["plain.ts"]).toBe("declare const name: string;\nexport const text = name;\n");
    expect(all.texts["coerce.ts"]).toBe(files["coerce.ts"].replace("`${label}`", "label"));
  });
});
