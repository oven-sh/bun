// Tests for rule behavior that the recorded cases from the rules' own test suites can't cover, because it takes a
// project or the command line.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined };

/** Returns `line:column rule message` for each report from a rule whose name starts with `prefix`, file by file. */
async function lint(files: Record<string, string>, prefix: string, args: string[] = ["."]) {
  using dir = tempDir("bun-lint-rules", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", ...args],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!stdout.startsWith("[")) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
  const results: { messages: { ruleId: string | null; line: number; column: number; message: string }[] }[] =
    JSON.parse(stdout);
  return results
    .flatMap(it => it.messages)
    .filter(it => it.ruleId?.startsWith(prefix))
    .map(it => `${it.line}:${it.column} ${it.ruleId} ${it.message}`);
}

describe.concurrent("rules that can use types but don't need them get them when types are on", () => {
  const eslintrc = (rules: object) =>
    JSON.stringify({
      root: true,
      parser: "@typescript-eslint/parser",
      parserOptions: { project: true },
      plugins: ["@typescript-eslint"],
      rules,
    });

  test("naming-convention's `types` option", async () => {
    const options = { selector: "variable", types: ["boolean"], format: ["PascalCase"], prefix: ["is", "has"] };
    const reports = await lint(
      {
        ".eslintrc.json": eslintrc({ "@typescript-eslint/naming-convention": ["error", options] }),
        "tsconfig.json": `{ "compilerOptions": { "strict": true }, "include": ["*.ts"] }`,
        "a.ts": "export const active = true;\nexport const count = 1;\n",
      },
      "@typescript-eslint/",
      ["a.ts"],
    );
    expect(reports).toEqual([
      "1:14 @typescript-eslint/naming-convention Variable name `active` must have one of the following prefixes: is, has",
    ]);
  });

  test("consistent-type-imports reads `emitDecoratorMetadata` from tsconfig.json", async () => {
    const files = (compilerOptions: object) => ({
      ".eslintrc.json": eslintrc({ "@typescript-eslint/consistent-type-imports": "error" }),
      "tsconfig.json": JSON.stringify({ compilerOptions, include: ["*.ts"] }),
      "database.ts": "export class Database {}\n",
      "a.ts": `import { Database } from "./database";\n@Injectable()\nexport class Users {\n  constructor(private database: Database) {}\n}\n`,
    });
    const metadata = { experimentalDecorators: true, emitDecoratorMetadata: true };
    expect(await lint(files(metadata), "@typescript-eslint/", ["a.ts"])).toEqual([]);
    expect(await lint(files({}), "@typescript-eslint/", ["a.ts"])).toEqual([
      "1:1 @typescript-eslint/consistent-type-imports All imports in the declaration are only used as types. Use `import type`.",
    ]);
  });
});

test.concurrent(
  "without types, consistent-type-imports skips files with decorators, because it can't tell if they emit metadata",
  async () => {
    const files = {
      "bunfig.toml": `[lint.rules]\n"@typescript-eslint/consistent-type-imports" = "error"\n`,
      "database.ts": "export class Database {}\n",
      "a.ts": `import { Database } from "./database";\n@Injectable()\nexport class Users {\n  constructor(private database: Database) {}\n}\n`,
      "b.ts": `import { Database } from "./database";\nexport class Users {\n  constructor(private database: Database) {}\n}\n`,
    };
    expect(await lint(files, "@typescript-eslint/consistent", ["a.ts"])).toEqual([]);
    expect(await lint(files, "@typescript-eslint/consistent", ["b.ts"])).toEqual([
      "1:1 @typescript-eslint/consistent-type-imports All imports in the declaration are only used as types. Use `import type`.",
    ]);
  },
);

test.concurrent("`>` and `}` in JSX text are parse errors, worded like espree's", async () => {
  const config = `export default [{ files: ["*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }];\n`;
  using dir = tempDir("bun-lint-rules", {
    "eslint.config.mjs": config,
    "a.jsx": "const a = <p>a > b</p>;\n",
    "b.jsx": "const b = <p>a } b</p>;\n",
  });
  await using proc = spawn({ cmd: [bunExe(), "lint", "-f", "json", "."], env, cwd: String(dir), stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results: { messages: { line: number; column: number; message: string }[] }[] = JSON.parse(stdout);
  expect(results.flatMap(it => it.messages).map(it => `${it.line}:${it.column} ${it.message}`)).toEqual(
    [
      'Parsing error: Unexpected token `>`. Did you mean `&gt;` or `{">"}`?',
      'Parsing error: Unexpected token `}`. Did you mean `&rbrace;` or `{"}"}`?',
    ].map(it => `1:16 ${it}`),
  );
  expect(exitCode).toBe(1);
});

test.concurrent(
  "react/jsx-props-no-spread-multi has a fix without a config file, where it doesn't have to match eslint-plugin-react",
  async () => {
    const code = `export const a = props => <button {...props} type="submit" {...props} {...props} />;\n`;
    using dir = tempDir("bun-lint-rules", {
      "bunfig.toml": `[lint.rules]\n"react/jsx-props-no-spread-multi" = "error"\n`,
      "a.jsx": code,
    });
    await using proc = spawn({ cmd: [bunExe(), "lint", "--fix", "a.jsx"], env, cwd: String(dir), stderr: "pipe" });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(await Bun.file(`${dir}/a.jsx`).text()).toBe(
      `export const a = props => <button  type="submit"  {...props} />;\n`,
    );
    expect(exitCode).toBe(0);
  },
);

describe.concurrent("React Compiler rules only match eslint-plugin-react-hooks with an ESLint config", () => {
  const effect = `import { useEffect } from "react";\nexport function Room({ roomId }) {\n  useEffect(() => {\n    connect(roomId);\n  }, []);\n  return <i />;\n}\n`;
  const calls = `export function Profile({ user }) {\n  const id = [BigInt(user.id), Symbol("a"), Avatar(user)];\n  return <i>{id}</i>;\n}\n`;
  const names = ["exhaustive-effect-dependencies", "capitalized-calls"];
  const briefly = (reports: string[]) => reports.map(it => it.split(" ").slice(0, 2).join(" "));

  test("without a config file", async () => {
    const bunfig = `[lint.rules]\n${names.map(name => `"react-hooks/${name}" = "error"\n`).join("")}`;
    const reports = await lint({ "bunfig.toml": bunfig, "a.jsx": effect, "b.jsx": calls }, "react-hooks/");
    expect(briefly(reports)).toEqual([
      "4:13 react-hooks/exhaustive-effect-dependencies",
      "2:45 react-hooks/capitalized-calls",
    ]);
  });

  test("with an ESLint config, they report what the plugin reports", async () => {
    const eslintrc = JSON.stringify({
      root: true,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
      plugins: ["react-hooks"],
      rules: Object.fromEntries(names.map(name => [`react-hooks/${name}`, "error"])),
    });
    const reports = await lint({ ".eslintrc.json": eslintrc, "a.jsx": effect, "b.jsx": calls }, "react-hooks/", [
      "a.jsx",
      "b.jsx",
    ]);
    expect(briefly(reports)).toEqual([
      "2:15 react-hooks/capitalized-calls",
      "2:32 react-hooks/capitalized-calls",
      "2:45 react-hooks/capitalized-calls",
    ]);
  });
});

describe.concurrent("`import` rules without an ESLint or oxlint config", () => {
  const rules = (...names: string[]) => `[lint.rules]\n${names.map(name => `"import/${name}" = "error"\n`).join("")}`;

  test("modules resolve the way Bun resolves them", async () => {
    const reports = await lint(
      {
        "bunfig.toml": rules("no-unresolved"),
        "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
        "src/user.ts": "export const user = 1;\n",
        "src/card.tsx": "export const Card = () => <div />;\n",
        "src/logo.svg": "<svg />\n",
        "src/a.ts": [
          `import "bun";`,
          `import "bun:test";`,
          `import "bun:sqlite";`,
          `import "node:fs";`,
          `import "./user";`,
          `import "./user.ts";`,
          `import "./user.js";`,
          `import "./card";`,
          `import "@/user";`,
          `import "./logo.svg?url";`,
          `import "./missing";`,
          `import "bun:missing";`,
          "",
        ].join("\n"),
      },
      "import/",
    );
    expect(reports).toEqual([
      "11:8 import/no-unresolved Unable to resolve path to module './missing'.",
      "12:8 import/no-unresolved Unable to resolve path to module 'bun:missing'.",
    ]);
  });

  test("exports are read from TypeScript and JSX files", async () => {
    const reports = await lint(
      {
        "bunfig.toml": rules("default", "named", "namespace", "export"),
        "user.ts": "export const user = 1;\nexport type User = 1;\n",
        "card.jsx": "export const Card = () => <div />;\n",
        "all.ts": `export * from "./user";\nexport const user = 2;\n`,
        "a.ts": [
          `import save from "./user";`,
          `import { user, User, nobody } from "./user";`,
          `import { Card, Deck } from "./card";`,
          `import * as api from "./user";`,
          `export default [save, user, nobody, Card, Deck, api.user, api.nobody] as User[];`,
          "",
        ].join("\n"),
      },
      "import/",
    );
    expect(reports.sort()).toEqual([
      "1:1 import/export Multiple exports of name 'user'.",
      `1:8 import/default No default export found in imported module "./user".`,
      "2:14 import/export Multiple exports of name 'user'.",
      "2:22 import/named nobody not found in './user'",
      "3:16 import/named Deck not found in './card'",
      "5:63 import/namespace 'nobody' not found in imported namespace 'api'.",
    ]);
  });

  test("`bun` and `bun:test` are builtin modules for import/order", async () => {
    const files = (code: string) => ({ "bunfig.toml": rules("order"), "a.ts": code });
    const first = `import { serve } from "bun";\nimport fs from "node:fs";\nimport { test } from "bun:test";\nexport default [serve, fs, test];\n`;
    expect(await lint(files(first), "import/")).toEqual([]);
    const late = `import ms from "ms";\nimport { serve } from "bun";\nexport default [serve, ms];\n`;
    expect(await lint(files(late), "import/")).toEqual([
      "2:1 import/order `bun` import should occur before import of `ms`",
    ]);
  });

  test("import/extensions accepts `ts` in its options", async () => {
    const reports = await lint(
      {
        "bunfig.toml": `[lint.rules]\n"import/extensions" = ["error", "ignorePackages", { ts = "never" }]\n`,
        "user.ts": "export const user = 1;\n",
        "a.ts": `import "./user";\nimport "./user.ts";\n`,
      },
      "import/",
    );
    expect(reports).toEqual([`2:8 import/extensions Unexpected use of file extension "ts" for "./user.ts"`]);
  });

  test("[lint.settings] replaces the built-in settings", async () => {
    const reports = await lint(
      {
        "bunfig.toml": `${rules("no-unresolved")}[lint.settings]\n"import/resolver" = "node"\n`,
        "user.ts": "export const user = 1;\n",
        "a.ts": `import "./user";\n`,
      },
      "import/",
    );
    expect(reports).toEqual(["1:8 import/no-unresolved Unable to resolve path to module './user'."]);
  });
});
