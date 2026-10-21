// Tests for rule behavior that the recorded cases from the rules' own test suites can't cover, because it takes a
// project or the command line.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync, statSync, utimesSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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

  test("without a config file, they report a missing effect dependency and allow BigInt() and Symbol()", async () => {
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

  // Listing a directory takes time proportional to its entry count, and a project can be in a directory with tens of
  // thousands of entries, like `$TMPDIR`.
  describe.skipIf(!isLinux)("the project's parent directory is never listed", () => {
    const files: Record<string, string> = {
      "above/project/bunfig.toml": rules("default"),
      "above/project/package.json": `{ "name": "project", "type": "module" }`,
      "above/project/tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "types": [] }, "include": ["src"] }`,
    };
    // Enough files for every thread to search all the parent directories for packages and config files.
    for (let i = 0; i < 40; i++) {
      files[`above/project/src/a${i}.ts`] =
        `import b from "./b${i}";\nimport c from "not-installed-${i % 5}";\nexport const a = [b, c];\n`;
      files[`above/project/src/b${i}.ts`] = "export const b = 1;\n";
    }
    /** Sets the access time to before the modification time, so that listing the directory updates it (`relatime`). */
    const resetAccessTime = (directory: string) => {
      utimesSync(directory, new Date(Date.now() - 3 * 86_400_000), statSync(directory).mtime);
      return statSync(directory).atimeMs;
    };

    test.each(["lint -f unix .", "lint -f unix --type-aware .", "check"])("by bun %s", async command => {
      using dir = tempDir("bun-lint-rules", files);
      const above = join(String(dir), "above");
      let before = resetAccessTime(above);
      readdirSync(above);
      // The file system is mounted with `noatime`, so there's no way to tell if the directory was listed.
      if (statSync(above).atimeMs === before) return;
      before = resetAccessTime(above);
      await using proc = spawn({
        cmd: [bunExe(), ...command.split(" "), "--threads", "8"],
        env,
        cwd: join(above, "project"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const found = (stdout + stderr).split("\n").filter(it => /import\/default|TS2613/.test(it)).length;
      expect({ found, exitCode }).toEqual({ found: 40, exitCode: 1 });
      expect(statSync(above).atimeMs).toBe(before);
    });
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

describe.concurrent("rules that sort", () => {
  /**
   * Runs `bun lint -f json` with an oxlint config and returns `file rule` for each report. That format includes each
   * report's fix, so every fix is computed.
   */
  async function reports(cwd: string, args: string[], exitCode = 0) {
    const cmd = [bunExe(), "lint", "-f", "json", ...args];
    await using proc = spawn({
      // Don't write a core file if it crashes.
      cmd: isWindows ? cmd : ["sh", "-c", 'ulimit -c 0; exec "$0" "$@"', ...cmd],
      env,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exited !== exitCode) throw new Error(`exit code ${exited}, signal ${proc.signalCode}\n${stdout}\n${stderr}`);
    const { diagnostics }: { diagnostics: { filename: string; code: string }[] } = JSON.parse(stdout);
    return { found: diagnostics.map(it => `${it.filename} ${it.code}`).sort(), stderr };
  }

  /** Returns eight items of each kind, numbered 0 to 7, reordered by stepping through them with `stride`. */
  function deal<T>(kinds: ((digit: number) => T)[], stride: number) {
    const all = kinds.flatMap(kind => Array.from({ length: 8 }, (_, digit) => kind(digit)));
    return all.map((_, i) => all[(i * stride) % all.length]);
  }

  // oxlint's `natural` comparison isn't a total order: a10 < a1b < a2 < a10.
  describe("sort-keys with `natural` and an oxlint config, when key comparisons form a cycle", () => {
    const oxlintrc = JSON.stringify({ rules: { "sort-keys": ["warn", "asc", { natural: true }] } });

    test.each<[string, string[]]>([
      [
        "a table keyed by hexadecimal code points",
        "1f600 2764 1f44d 263a 231a 1f525 25b6 2b50 23e9 1f602 2049 26a1 203c 1f308 2600 25c0 1f004 231b 270c 23f0 1f923 2744 2601 1f0cf 1f4a7 2614 260e 1f91e 2328 23cf 24c2 25aa 2611 1f609".split(
          " ",
        ),
      ],
      ...[
        ["a10", "a1b", "a2"],
        ["15", "1e", "2a"],
        ["231a", "23e9", "25b6"],
      ].map((cycle): [string, string[]] => {
        const all = cycle.flatMap(key => [..."qrstuvwxyz"].map(end => `${key}_${end}`));
        return [
          `many keys that start with ${cycle.join(", ")}`,
          [...new Set(all.map((_, i) => all[(i * 19 + (i >> 2)) % all.length]))],
        ];
      }),
    ])("--fix terminates and keeps every key: %s", async (_, keys) => {
      expect(keys.length).toBeGreaterThan(21);
      const before = `export const table = {\n${keys.map((key, i) => `  "${key}": ${i}, // ${key}\n`).join("")}};\n`;
      using dir = tempDir("bun-lint-rules", {
        ".oxlintrc.json": oxlintrc,
        "table.js": before,
        "other.js": "export const other = { b: 1, a: 2 };\n",
      });
      const read = () => readFileSync(join(String(dir), "table.js"), "utf8");
      expect((await reports(String(dir), ["table.js", "other.js"])).found).toEqual([
        "other.js eslint(sort-keys)",
        "table.js eslint(sort-keys)",
      ]);
      expect(read()).toBe(before);

      expect((await reports(String(dir), ["--fix", "table.js"])).found).toEqual([]);
      const fixed = read();
      expect(fixed).not.toBe(before);
      // Each key keeps its value and its comment.
      expect(fixed.split("\n").sort()).toEqual(before.split("\n").sort());
      expect((await reports(String(dir), ["table.js"])).found).toEqual([]);
      expect((await reports(String(dir), ["--fix", "table.js"])).found).toEqual([]);
      expect(read()).toBe(fixed);
    });

    // Same output as oxlint 1.87. With more than 20 keys, oxlint's output varies, or it panics.
    test("with up to 20 keys, the fix matches oxlint's", async () => {
      using dir = tempDir("bun-lint-rules", {
        ".oxlintrc.json": oxlintrc,
        "a.js": `export const versions = { a20: 1, v1beta1: 2, a12: 3, v2: 4, v10: 5 };
export const names = { a2b: 1, a1b: 2, v10: 3, a1: 4, a20: 5, a12: 6 };
export const more = { a1: 1, a2: 2, v10: 3, v2: 4, v1: 5, a1x: 6, a12: 7 };
export const numbers = { "2a": 1, "1e": 2, 15: 3 };
`,
      });
      expect((await reports(String(dir), ["--fix", "a.js"])).found).toEqual([]);
      expect(readFileSync(join(String(dir), "a.js"), "utf8"))
        .toBe(`export const versions = { a12: 3, a20: 1, v1beta1: 2, v2: 4, v10: 5 };
export const names = { a1: 4, a1b: 2, a20: 5, a2b: 1, a12: 6, v10: 3 };
export const more = { a1: 1, a1x: 6, a2: 2, a12: 7, v1: 5, v2: 4, v10: 3 };
export const numbers = { "1e": 2, "2a": 1, 15: 3 };
`);
    });
  });

  // JavaScript decodes the file before comparing anything, and a truncated character decodes to a single U+FFFD.
  test("sort-type-constituents sorts text that isn't valid UTF-8 consistently", async () => {
    const kinds: ((digit: number) => [written: string, read: string])[] = [
      digit => [`\xF0\x9F\x98b${digit}`, `\uFFFDb${digit}`],
      digit => [`\xEF\xBF\xBDc${digit}`, `\uFFFDc${digit}`],
      digit => [`\xEF\xBF\xBD\xEF\xBF\xBD\xED\xA0\x80${digit}`, `\uFFFD\uFFFD\uD800${digit}`],
    ];
    const text = (names: [written: string, read: string][]) =>
      Buffer.from(`export type T = ${names.map(it => `"${it[0]}"`).join(" | ")};\n`, "latin1");
    const { compare } = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const sorted = text(deal(kinds, 1).sort((a, b) => compare(a[1], b[1])));
    for (const stride of [11, 7]) {
      using dir = tempDir("bun-lint-rules", {
        ".oxlintrc.json": `{ "plugins": ["typescript"], "rules": { "typescript/sort-type-constituents": "warn" } }`,
        "a.ts": text(deal(kinds, stride)),
      });
      for (const _ of ["fixes", "has nothing to fix"]) {
        expect((await reports(String(dir), ["--fix", "a.ts"])).found).toEqual([]);
        expect(readFileSync(join(String(dir), "a.ts")).toString("latin1")).toBe(sorted.toString("latin1"));
      }
    }
  });

  // eslint-plugin-react compares the lowercased names by code unit, where `1` sorts before `_`, but its fix sorts them
  // with `localeCompare`, where `_` sorts before `1`. So the fix writes the text that's already there.
  test("still reports a problem whose fix doesn't change the text", async () => {
    const text = `import PropTypes from "prop-types";
export function C() {
  return null;
}
C.propTypes = {
  item_1: PropTypes.any,
  item1: PropTypes.any,
};
`;
    using dir = tempDir("bun-lint-rules", {
      ".oxlintrc.json": `{ "plugins": ["react"], "rules": { "react/sort-prop-types": ["error", { "ignoreCase": true }] } }`,
      "a.jsx": text,
    });
    for (const args of [["a.jsx"], ["--fix", "a.jsx"], ["a.jsx"]]) {
      const { found, stderr } = await reports(String(dir), args, 1);
      expect({ found, stderr }).toEqual({ found: ["a.jsx react(sort-prop-types)"], stderr: "" });
      expect(readFileSync(join(String(dir), "a.jsx"), "utf8")).toBe(text);
    }
  });
});

// Most of the paths tried while resolving an import don't exist: `./b.tsx`, `./b.d.ts`, `./b/package.json`.
test("looking up a missing file doesn't get slower as the directory gets larger", async () => {
  const count = 6_000;
  async function cpu(pathOf: (i: number) => string) {
    // oxlint tries `.js` and other extensions before `.ts`.
    const files: Record<string, string> = {
      ".oxlintrc.json": `{ "plugins": ["import"], "categories": { "correctness": "off" }, "rules": { "import/default": "error" } }`,
    };
    for (let i = 0; i < count; i++) {
      const other = relative(dirname(pathOf(i)), pathOf((i * 7 + 3) % count));
      files[`${pathOf(i)}.ts`] = `import a from "./${other.replaceAll("\\", "/")}";\nexport default a;\n`;
    }
    using dir = tempDir("bun-lint-rules", files);
    await using proc = spawn({ cmd: [bunExe(), "lint", "."], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ output: (stdout + stderr).trim().replace(/ \[.*/, ""), exitCode }).toEqual({
      output: `✓ No problems in ${count} files`,
      exitCode: 0,
    });
    return Number(proc.resourceUsage()!.cpuTime.user);
  }
  const [together, apart] = [await cpu(i => `module${i}`), await cpu(i => `${i % 50}/module${i}`)];
  expect(together / apart).toBeLessThan(3);
});
