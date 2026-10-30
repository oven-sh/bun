import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined, NO_COLOR: "1" };

async function lint(files: Record<string, string>, args: string[]) {
  using dir = tempDir("bun-lint-type-services", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lint", "-f", "unix", ...args],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const errors = [...stdout.matchAll(/^.*?:(\d+:\d+): (.*) \[Error\/.*\]$/gm)].map(it => `${it[1]} ${it[2]}`);
  return { errors, stderr, exitCode };
}

const rule = (...names: string[]) => names.flatMap(name => ["--rule", `@typescript-eslint/${name}: error`]);
const oxlintrc = (...names: string[]) =>
  JSON.stringify({
    plugins: ["typescript"],
    rules: Object.fromEntries(names.map(it => [`typescript/${it}`, "error"])),
  });
const options = { types: [], lib: ["es2022"] };

describe("a file that its project has both among its own files and among those of a project it references", () => {
  const needsTheFlag =
    "1:1 This rule requires the `strictNullChecks` compiler option to be turned on to function correctly.";
  const text =
    "export function f(x: string | null) {\n  if (x == null) return 0;\n  return x.length;\n}\n" +
    "export const shown = (value: { a: string | null }) => `${value}`;\n";
  const names = ["no-unnecessary-condition", "restrict-template-expressions"];
  const projects = (strict: boolean) => ({
    "tsconfig.json": JSON.stringify({
      compilerOptions: { ...options, strict, noEmit: true },
      references: [{ path: "./tsconfig.lib.json" }],
    }),
    "tsconfig.lib.json": JSON.stringify({
      compilerOptions: { ...options, strict: !strict, composite: true, outDir: "out" },
      include: ["lib"],
    }),
    "lib/a.ts": text,
  });

  test.concurrent.each([
    [false, [needsTheFlag, '5:58 Invalid type "{ a: string; }" of template literal expression.']],
    [true, ['5:58 Invalid type "{ a: string | null; }" of template literal expression.']],
  ])("--tsconfig: a rule is told strict: %p, with which the types were computed", async (strict, expected) => {
    const flags = [...rule(...names), "--tsconfig", "tsconfig.json", "lib/a.ts"];
    const { errors, exitCode } = await lint(projects(strict), flags);
    expect(errors).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  test.concurrent.each([
    [false, [needsTheFlag, "5:58 Invalid type used in template literal expression."]],
    [true, ["5:58 Invalid type used in template literal expression."]],
  ])("an oxlint config: a rule is told strict: %p, with which the types were computed", async (strict, expected) => {
    const files = { ...projects(strict), ".oxlintrc.json": oxlintrc(...names) };
    const { errors, exitCode } = await lint(files, ["--type-aware", "lib/a.ts"]);
    expect(errors).toEqual(expected);
    expect(exitCode).toBe(1);
  });
});

test.concurrent("the inner part of a dotted namespace is a namespace whatever its name begins with", async () => {
  const handle = "{ interface Handle { id: number } }";
  const { errors, exitCode } = await lint(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, strict: true, module: "esnext", moduleResolution: "bundler", noEmit: true },
      }),
      "eslint.config.js": `export default [{
        files: ["**/*.ts"],
        plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
        languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
        rules: { "@typescript-eslint/restrict-template-expressions": ["error", { allow: [{ from: "package", package: "pkg", name: "Handle" }] }] },
      }];`,
      "pkg.d.ts":
        `declare module "pkg" {\n  namespace api.units ${handle}\n  namespace api.modules ${handle}\n` +
        `  namespace api.moduleGraph.inner ${handle}\n  namespace modules ${handle}\n` +
        "  export function unit(): api.units.Handle;\n  export function dotted(): api.modules.Handle;\n" +
        "  export function deeper(): api.moduleGraph.inner.Handle;\n  export function plain(): modules.Handle;\n}\n",
      "a.ts":
        'import { deeper, dotted, plain, unit } from "pkg";\n' +
        "export const all = [`${unit()}`, `${dotted()}`, `${deeper()}`, `${plain()}`];\n",
    },
    ["a.ts"],
  );
  expect(errors).toEqual([]);
  expect(exitCode).toBe(0);
});

describe("`export *` from a package that the file also requires, and that has other types for `require`", () => {
  const names = Array.from({ length: 12 }, (_, i) => `dual-${i + 1}`);
  const files = {
    ...Object.fromEntries(
      names.flatMap((name, i) => [
        [
          `node_modules/${name}/package.json`,
          JSON.stringify({
            name,
            version: "1.0.0",
            exports: { ".": { import: { types: "./esm.d.mts" }, require: { types: "./cjs.d.cts" } } },
          }),
        ],
        [`node_modules/${name}/esm.d.mts`, `export interface OnlyAType${i} { a: 1 }\n`],
        [`node_modules/${name}/cjs.d.cts`, "export declare const value: number;\n"],
      ]),
    ),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { ...options, strict: true, module: "nodenext", noEmit: true },
      include: ["*.mts"],
    }),
    "a.mts":
      names.map(name => `export * from "${name}";\n`).join("") +
      names.map((name, i) => `import required${i} = require("${name}");\n`).join("") +
      `export const values = [${names.map((_, i) => `required${i}.value`).join(", ")}];\n`,
  };
  const places = (errors: string[]) => errors.map(it => it.split(" ")[0]);

  test.concurrent("is judged by what `export *` resolves to", async () => {
    const configured = { ...files, ".oxlintrc.json": oxlintrc("consistent-type-exports") };
    const { errors, exitCode } = await lint(configured, ["--type-aware", "a.mts"]);
    expect(places(errors)).toEqual(names.map((_, i) => `${i + 1}:1`));
    expect(exitCode).toBe(1);
  });

  test.concurrent("is judged alike for every name of a package", async () => {
    const { errors } = await lint(files, [...rule("consistent-type-exports"), "a.mts"]);
    expect([0, names.length]).toContain(errors.length);
  });
});
