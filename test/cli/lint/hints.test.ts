// Tests for the hint line that `pretty` and `agent` print when a message alone doesn't explain the problem or the fix.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

async function lint(files: Record<string, string>, ...args: string[]) {
  using dir = tempDir("bun-lint-hints", files);
  await using proc = spawn({ cmd: [bunExe(), "lint", ...args], env: bunEnv, cwd: String(dir), stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** Lints `code` with `-f pretty`. Returns one string per report: the rule, the line, and the hint if there is one. */
async function hints(code: string, file = "a.js", others: Record<string, string> = {}) {
  const { stdout } = await lint({ ...others, [file]: code }, "-f", "pretty");
  const reports = stdout.matchAll(/^(?:error|warn): .*  (\S+)\n +at [^\n]*?:(\d+):\d+\n(?:\nnote: (.*)\n)?/gm);
  return Array.from(reports, ([, rule, line, hint]) => `${rule} ${line}${hint === undefined ? "" : ": " + hint}`);
}

describe.concurrent("the no-useless-assignment hint", () => {
  test("lists both lines when both branches overwrite the value", async () => {
    const code = `
export function rename(kind) {
  let name = "honeypot";
  if (kind === "a") {
    name = "x";
  } else {
    name = "y";
  }
  return name;
}
`;
    expect(await hints(code)).toEqual(["no-useless-assignment 3: Reassigned on lines 5 and 7 before it's read."]);
  });

  test("has the line of the next statement when it overwrites the value", async () => {
    expect(await hints(`export function f(a) {\n  let b = a;\n  b = 2;\n  return b;\n}\n`)).toEqual([
      "no-useless-assignment 2: Reassigned on line 3 before it's read.",
    ]);
  });

  test("lists at most three lines when more branches overwrite the value", async () => {
    const cases = (count: number) => Array.from({ length: count }, (_, i) => `    case ${i}: b = ${i}; break;\n`);
    const code = (count: number) =>
      `export function f(a) {\n  let b = -1;\n  switch (a) {\n${cases(count).join("")}    default: b = 9;\n  }\n  return b;\n}\n`;
    expect(await Promise.all([hints(code(2)), hints(code(5))])).toEqual([
      ["no-useless-assignment 2: Reassigned on lines 4, 5 and 6 before it's read."],
      ["no-useless-assignment 2: Reassigned on lines 4, 5, 6 and 3 more before it's read."],
    ]);
  });

  test("is different when the variable is never read again", async () => {
    expect(await hints(`export function f(a) {\n  let b = a;\n  use(b);\n  b = 2;\n}\n`, "a.ts")).toEqual([
      "no-useless-assignment 4: Never read after this.",
    ]);
  });

  test("an assignment in parentheses is not a pattern", async () => {
    const f = `export function f(a: number, b: number) {\n  (a = b) = a;\n}\n`;
    const g = `export function g(a: number, b: number) {\n  (a = b) += a;\n}\n`;
    const { stdout, exitCode } = await lint({ "a.ts": f + g }, "-f", "unix");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });
});

/** Code and its expected reports. The code uses everything it declares, so nothing else gets reported. */
const cases: [code: string, ...reports: string[]][] = [
  [
    `let a;\nif (a = f()) use(a);`,
    "no-cond-assign 2: Did you mean ===? To keep the assignment, wrap it in parentheses.",
  ],
  [`let a = 1;\nwhile (a -= 1) use(a);`, "no-cond-assign 2: To keep the assignment, wrap it in parentheses."],
  [`let a;\nuse(a = f() ? 1 : 2, a);`],
  [`let a;\nuse((a = f()) ? 1 : 2, a);`, "no-cond-assign 2: Did you mean ===?"],
  [
    `switch (f()) {\n  case 1:\n    const a = 1;\n    use(a);\n}`,
    "no-case-declarations 3: Every case can see it. Wrap this case in { }.",
  ],
  [
    `switch (f()) {\n  case 1:\n    use(1);\n  case 2:\n    use(2);\n}`,
    "no-fallthrough 4: Add break, or a // falls through comment.",
  ],
  [`use(f() === -0);`, "no-compare-neg-zero 1: -0 === 0 is true. Use Object.is(x, -0)."],
  [`use(f() !== -0);`, "no-compare-neg-zero 1: -0 === 0 is true. Use !Object.is(x, -0)."],
  [`use(f() < -0);`, "no-compare-neg-zero 1: -0 compares like 0. Write 0."],
  [`if (f()) {\n}`, "no-empty 1: Remove it, or add a comment saying why it's empty."],
  [`try {\n  f();\n} catch {}`, "no-empty 3: Handle the error, or add a comment saying why it's ignored."],
  [`use(/a[]/);`, "no-empty-character-class 1: [] matches nothing."],
  [
    `export function g() {\n  try {\n    return f();\n  } finally {\n    return 2;\n  }\n}`,
    "no-unsafe-finally 5: Overrides what try and catch return or throw.",
  ],
  [`use(!f() in g());`, "no-unsafe-negation 1: !a in b means (!a) in b. Did you mean !(a in b)?"],
  [
    `use(!f() instanceof Map);`,
    "no-unsafe-negation 1: !a instanceof b means (!a) instanceof b. Did you mean !(a instanceof b)?",
  ],
  [
    `const a = f\n(g || h).call();\nuse(a);`,
    "no-unexpected-multiline 2: Parsed as part of the previous line. Add a semicolon there.",
  ],
  [`use(f().hasOwnProperty("a"));`, "no-prototype-builtins 1: Use Object.hasOwn(object, key)."],
  [`use(f().isPrototypeOf(g()));`, "no-prototype-builtins 1: Use Object.prototype.isPrototypeOf.call(object, value)."],
  [
    `use(new Promise(async resolve => resolve(await f())));`,
    "no-async-promise-executor 1: If it throws, the promise never settles. Await outside new Promise().",
  ],
  [
    `use(typeof f() || "b");`,
    "no-constant-binary-expression 1: The left side is always truthy or always falsy. Are parentheses missing?",
  ],
  [
    `use("a" || f());`,
    "no-constant-binary-expression 1: The left side is always truthy, so the right side is never used.",
  ],
  [
    `use("" || f());`,
    "no-constant-binary-expression 1: The left side is always falsy, so the result is always the right side.",
  ],
  [
    `use({} && f());`,
    "no-constant-binary-expression 1: The left side is always truthy, so the result is always the right side.",
  ],
  [
    `use(null && f());`,
    "no-constant-binary-expression 1: The left side is always falsy, so the right side is never used.",
  ],
  [
    `use(!f() ?? "b");`,
    "no-constant-binary-expression 1: The left side is never null or undefined, so the right side is never used.",
  ],
  [
    `use(undefined ?? "b");`,
    "no-constant-binary-expression 1: The left side is always null or undefined, so the result is always the right side.",
  ],
  [`use(!f() == null);`, "no-constant-binary-expression 1: The result is always the same. Are parentheses missing?"],
  [`use({} === f());`, "no-constant-binary-expression 1"],
  [`try {\n  f();\n} catch (e) {\n  throw e;\n}`, "no-useless-catch 1: It only rethrows. Remove the try and catch."],
  [
    `try {\n  f();\n} catch (e) {\n  throw e;\n} finally {\n  g();\n}`,
    "no-useless-catch 3: It only rethrows. Remove the catch.",
  ],
  [`use([1, , 2]);`, "no-sparse-arrays 1: The extra comma leaves a hole. Remove it, or write undefined."],
  [`const {} = f();`, "no-empty-pattern 1: Declares no variables."],
  [`const { a: {} } = f();`, "no-empty-pattern 1: Declares no variables. For a default value, write = {}, not : {}."],
  [`const { a: [] } = f();`, "no-empty-pattern 1: Declares no variables. For a default value, write = [], not : []."],
  [`class A {}\nA = f();\nuse(A);`, "no-class-assign 2: Replaces the class declared on line 1."],
  [`function a() {}\n\na = f();\nuse(a);`, "no-func-assign 3: Replaces the function declared on line 1."],
  [
    `const a = 1;\nif (f()) a = 2;\nuse(a);`,
    "no-const-assign 2: Declared with const on line 1. Use let if it changes.",
  ],
  [
    `using a = f();\nif (g()) a = f();\nuse(a);`,
    "no-const-assign 2: Declared with using on line 1, so it can't change.",
  ],
  [`var a = 1;\nuse(a);\nvar a = 2;\nuse(a);`, "no-redeclare 3: First declared on line 1."],
  [
    `switch (f()) {\n  case 1:\n    break;\n  case 2:\n    break;\n  case 1:\n    break;\n}`,
    "no-duplicate-case 6: Only the first one runs, on line 2.",
  ],
  [`use({\n  a: 1,\n  b: 2,\n  a: 3,\n});`, "no-dupe-keys 4: The last one wins. The first is on line 2."],
  [`use(class {\n  a() {}\n  a() {}\n});`, "no-dupe-class-members 3: The last one wins."],
  [`use(9007199254740993);`, "no-loss-of-precision 1: At runtime it's 9007199254740992."],
  [`use(typeof f() === "strnig");`, 'valid-typeof 1: Did you mean "string"?'],
  [`use(typeof f() === "array");`, "valid-typeof 1: typeof never returns this string."],
  [
    `use(typeof f() === null);`,
    "no-constant-binary-expression 1: The result is always the same. Are parentheses missing?",
    "valid-typeof 1: typeof always returns a string.",
  ],
  [
    `use(typeof f() === undefined);`,
    "no-constant-binary-expression 1: The result is always the same. Are parentheses missing?",
    'valid-typeof 1: typeof returns the string "undefined".',
  ],
  [
    `try {\n  f();\n} catch (err) {\n  throw new Error("no");\n}`,
    "no-unused-vars 3",
    "preserve-caught-error 4: Pass { cause: err } as the last argument to keep the caught error.",
  ],
  [
    String.raw`use("\d+");`,
    String.raw`no-useless-escape 1: "\d" is the same as "d". Remove the backslash, or write \\ for a real one.`,
  ],
  [String.raw`use(/[\$&&a]/v);`, String.raw`no-useless-escape 1: "\$" is the same as "$" here. Remove the backslash.`],
  [
    `export function a() {\n  return 1;\n  function b() {}\n  use(b);\n}`,
    "no-unreachable 4: Nothing runs after the return on line 2.",
  ],
  [`while (true) {\n  f();\n}\nuse(1);`, "no-unreachable 4: The loop on line 1 only exits by return or throw."],
  [
    `export function a() {\n  if (f()) {\n    return 1;\n  } else {\n    throw g();\n  }\n  use(1);\n}`,
    "no-unreachable 7: Every path through the if on line 2 ends in return, throw, break or continue.",
  ],
  [`const userName = f();\nuse(usrName, userName);`, 'no-undef 2: Did you mean "userName"?'],
  [`consle.log(1);`, 'no-undef 1: Did you mean "console"?'],
  [`use(new Promse(f));`, 'no-undef 1: Did you mean "Promise"?'],
  [`describe("a", f);`, 'no-undef 1: With bun test, import it from "bun:test".'],
  [`jQuery("a");`, "no-undef 1: If it's a global, declare it in [lint.globals] in bunfig.toml."],
  [`try {\n  f();\n} catch (e) {\n  g();\n}`, "no-unused-vars 3: The parameter is optional. Write catch { }."],
  [`try {\n  f();\n} catch ({ a, b }) {\n  g(a);\n}`, "no-unused-vars 3: Remove it, or prefix it with _."],
  [`const a = f();`, "no-unused-vars 1: Remove it, or prefix it with _."],
  [`export function a(b) {}`, "no-unused-vars 1: Remove it, or prefix it with _."],
  [`import a from "a";`, "no-unused-vars 1"],
  [`use(1,\u00a02);`, "no-irregular-whitespace 1: This is U+00A0. Use a plain space or a line break."],
  [`use(f() === NaN);`, "use-isnan 1: Nothing equals NaN, not even NaN."],
  [
    `use(/[👍🏽]/u);`,
    "no-misleading-character-class 1: This is several code points, and the class matches each one separately.",
  ],
];

const globals = { "bunfig.toml": `[lint.globals]\nf = "readonly"\ng = "readonly"\nh = "readonly"\nuse = "readonly"\n` };

test.concurrent.each(cases)("hints for %s", async (code, ...reports) => {
  expect(await hints(code + "\n", "a.js", globals)).toEqual(reports);
});

test.concurrent("hints for @typescript-eslint/no-unused-vars", async () => {
  const code = `try {\n  f();\n} catch (e) {\n  f();\n}\nconst { a, ...others } = f();\nconst b = f(others);\ndeclare function f(a?: unknown): any;\n`;
  expect(await hints(code, "a.ts")).toEqual([
    "@typescript-eslint/no-unused-vars 3: The parameter is optional. Write catch { }.",
    "@typescript-eslint/no-unused-vars 7: Remove it, or prefix it with _.",
    "@typescript-eslint/no-explicit-any 8: Use unknown if the type isn't known.",
  ]);
});

test.concurrent.each(["a.js", "a.ts"])(
  "the no-unused-vars hints respect options from bunfig.toml, in %s",
  async file => {
    const rule = file === "a.js" ? "no-unused-vars" : "@typescript-eslint/no-unused-vars";
    const bunfig = `[lint.rules]\n"${rule}" = ["warn", { ignoreRestSiblings = false, varsIgnorePattern = "^x" }]\n`;
    const code = `const { a, ...others } = Bun;\nconsole.log(others);\nconst _b = 1;\n`;
    expect(await hints(code, file, { "bunfig.toml": bunfig })).toEqual([
      `${rule} 1: To omit a property this way, turn on ignoreRestSiblings.`,
      `${rule} 3`,
    ]);
  },
);

test.concurrent("hints for other typescript-eslint rules", async () => {
  const code = `
declare const list: number[];
list.pop;
list.length === 0;
list.length + 1;
export function later(this: object) {
  const self = this;
  return () => self;
}
export class A {}
export interface A {
  a: number;
}
export let b: any;
export const fs = require("fs");
import path = require("path");
export { path };
`;
  const bunfig = { "bunfig.toml": `[lint.rules]\n"@typescript-eslint/no-require-imports" = "warn"\n` };
  expect(await hints(code, "a.ts", bunfig)).toEqual([
    "@typescript-eslint/no-unused-expressions 3: The value is unused. Did you mean to call it?",
    "@typescript-eslint/no-unused-expressions 4: The result is unused. Did you mean =?",
    "@typescript-eslint/no-unused-expressions 5: The value is unused, so this does nothing.",
    "@typescript-eslint/no-this-alias 7: Use an arrow function. It keeps the outer this.",
    "@typescript-eslint/no-unsafe-declaration-merging 10: TypeScript doesn't check that the class sets the interface's properties.",
    "@typescript-eslint/no-unsafe-declaration-merging 11: TypeScript doesn't check that the class sets the interface's properties.",
    "@typescript-eslint/no-explicit-any 14: Use unknown if the type isn't known.",
    "@typescript-eslint/no-require-imports 15: Use import, or await import() to load it later.",
    "@typescript-eslint/no-require-imports 16: Use import.",
  ]);
});

test.concurrent("hints for react-hooks/rules-of-hooks", async () => {
  const code = `
import { useEffect, useState } from "react";

export function List({ items, open }) {
  if (!open) {
    return null;
  }
  const [count] = useState(0);
  if (count > 1) {
    useEffect(() => {});
  }
  const first = items.length > 0 && useState(items[0]);
  return <ul>{first}</ul>;
}
`;
  const project = { "package.json": JSON.stringify({ dependencies: { react: "19.0.0" } }) };
  expect(await hints(code, "a.jsx", project)).toEqual([
    "react-hooks/rules-of-hooks 8: The return on line 6 can skip this hook.",
    "react-hooks/rules-of-hooks 10: Depends on the condition on line 9.",
    "react-hooks/rules-of-hooks 12: Depends on the condition on line 12.",
  ]);
});

test.concurrent("hints for bun:test/valid-expect", async () => {
  const code = `import { expect, test } from "bun:test";\ntest("a", async () => {\n  expect(Promise.resolve(1)).resolves.toBe(1);\n});\n`;
  expect(await hints(code, "a.test.ts")).toEqual(["bun:test/valid-expect 3: Add await, or return the promise."]);
});

test.concurrent("hints for no-octal", async () => {
  expect(await hints(`module.exports = [071, 09];\n`, "a.cjs")).toEqual([
    "no-octal 1: The leading 0 makes it octal: 071 is 57. Write 0o71.",
    "no-octal 1: The leading 0 does nothing. Remove it.",
  ]);
});

describe.concurrent("which formats print hints", () => {
  const files = { "a.js": `export function f(a) {\n  let b = a;\n  b = 2;\n  return b;\n}\n` };
  const hint = "Reassigned on line 3 before it's read.";

  test("-f agent prints the hint", async () => {
    const { stdout } = await lint(files, "-f", "agent");
    expect(stdout).toContain(`<help>${hint}</help>`);
  });

  test("-f pretty --all prints the hint", async () => {
    const { stdout } = await lint(files, "-f", "pretty", "--all");
    expect(stdout).toContain(`note: ${hint}`);
  });

  test.each(["stylish", "json", "unix", "github", "junit", "checkstyle", "gitlab", "sarif"])(
    "-f %s doesn't print the hint",
    async format => {
      const { stdout } = await lint(files, "-f", format);
      expect(stdout).toContain("is not used in subsequent statements");
      expect(stdout).not.toContain("Reassigned");
    },
  );

  test("nothing prints the hint with an oxlint config", async () => {
    const config = JSON.stringify({ rules: { "no-useless-assignment": "error" } });
    const { stdout } = await lint({ ...files, ".oxlintrc.json": config }, "-f", "default");
    expect(stdout).toContain("no-useless-assignment");
    expect(stdout).not.toContain("Reassigned");
  });
});
