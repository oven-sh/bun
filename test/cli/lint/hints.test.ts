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

describe.concurrent("no-useless-assignment", () => {
  test("every branch assigns again", async () => {
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
    expect(await hints(code)).toEqual([
      "no-useless-assignment 3: It is overwritten on line 5 and line 7 before it is read.",
    ]);
  });

  test("the next statement assigns again", async () => {
    expect(await hints(`export function f(a) {\n  let b = a;\n  b = 2;\n  return b;\n}\n`)).toEqual([
      "no-useless-assignment 2: It is overwritten on line 3 before it is read.",
    ]);
  });

  test("three or more branches assign again", async () => {
    const cases = (count: number) => Array.from({ length: count }, (_, i) => `    case ${i}: b = ${i}; break;\n`);
    const code = (count: number) =>
      `export function f(a) {\n  let b = -1;\n  switch (a) {\n${cases(count).join("")}    default: b = 9;\n  }\n  return b;\n}\n`;
    expect(await Promise.all([hints(code(2)), hints(code(5))])).toEqual([
      ["no-useless-assignment 2: It is overwritten on lines 4, 5 and 6 before it is read."],
      ["no-useless-assignment 2: It is overwritten on lines 4, 5, 6 and 3 more before it is read."],
    ]);
  });

  test("the variable is never read again", async () => {
    expect(await hints(`export function f(a) {\n  let b = a;\n  use(b);\n  b = 2;\n}\n`, "a.ts")).toEqual([
      "no-useless-assignment 4: Nothing reads it after this.",
    ]);
  });
});

/** Code and its expected reports. The code uses everything it declares, so nothing else gets reported. */
const cases: [code: string, ...reports: string[]][] = [
  [
    `let a;\nif (a = f()) use(a);`,
    "no-cond-assign 2: Did you mean ===? To keep the assignment, wrap it in another pair of parentheses.",
  ],
  [
    `let a = 1;\nwhile (a -= 1) use(a);`,
    "no-cond-assign 2: To keep the assignment, wrap it in another pair of parentheses.",
  ],
  [`let a;\nuse(a = f() ? 1 : 2, a);`],
  [`let a;\nuse((a = f()) ? 1 : 2, a);`, "no-cond-assign 2: Did you mean ===?"],
  [
    `switch (f()) {\n  case 1:\n    const a = 1;\n    use(a);\n}`,
    "no-case-declarations 3: Every case of the switch can see it. Wrap this case in { }.",
  ],
  [
    `switch (f()) {\n  case 1:\n    use(1);\n  case 2:\n    use(2);\n}`,
    "no-fallthrough 4: Add break, or the comment // falls through if this is meant.",
  ],
  [`use(f() === -0);`, "no-compare-neg-zero 1: -0 and 0 compare as equal. Use Object.is(x, -0) to tell them apart."],
  [`if (f()) {\n}`, "no-empty 1: Remove it, or put a comment in it that says why it is empty."],
  [
    `try {\n  f();\n} catch {}`,
    "no-empty 3: Handle the error, or put a comment in it that says why the error is ignored.",
  ],
  [`use(/a[]/);`, "no-empty-character-class 1: [] in a regular expression matches nothing."],
  [
    `export function g() {\n  try {\n    return f();\n  } finally {\n    return 2;\n  }\n}`,
    "no-unsafe-finally 5: It replaces whatever try and catch return or throw.",
  ],
  [`use(!f() in g());`, "no-unsafe-negation 1: !a in b means (!a) in b. Did you mean !(a in b)?"],
  [
    `use(!f() instanceof Map);`,
    "no-unsafe-negation 1: !a instanceof b means (!a) instanceof b. Did you mean !(a instanceof b)?",
  ],
  [
    `const a = f\n(g || h).call();\nuse(a);`,
    "no-unexpected-multiline 2: This line continues the one before. End that one with a semicolon.",
  ],
  [`use(f().hasOwnProperty("a"));`, "no-prototype-builtins 1: Use Object.hasOwn(object, key) instead."],
  [
    `use(f().isPrototypeOf(g()));`,
    "no-prototype-builtins 1: Use Object.prototype.isPrototypeOf.call(object, value) instead.",
  ],
  [
    `use(new Promise(async resolve => resolve(await f())));`,
    "no-async-promise-executor 1: If it throws, the promise never settles. Await outside of new Promise().",
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
  [
    `try {\n  f();\n} catch (e) {\n  throw e;\n}`,
    "no-useless-catch 1: It only throws the error again. Without try and catch, the code does the same.",
  ],
  [
    `try {\n  f();\n} catch (e) {\n  throw e;\n} finally {\n  g();\n}`,
    "no-useless-catch 3: It only throws the error again. Without it, try and finally do the same.",
  ],
  [`use([1, , 2]);`, "no-sparse-arrays 1: It leaves a hole in the array. Remove the comma, or write undefined."],
  [`const {} = f();`, "no-empty-pattern 1: It declares no variables."],
  [
    `const { a: {} } = f();`,
    "no-empty-pattern 1: It declares no variables. For a default value, write = {} instead of : {}.",
  ],
  [
    `const { a: [] } = f();`,
    "no-empty-pattern 1: It declares no variables. For a default value, write = [] instead of : [].",
  ],
  [`class A {}\nA = f();\nuse(A);`, "no-class-assign 2: This assignment replaces the class declared on line 1."],
  [
    `function a() {}\n\na = f();\nuse(a);`,
    "no-func-assign 3: This assignment replaces the function declared on line 1.",
  ],
  [
    `const a = 1;\nif (f()) a = 2;\nuse(a);`,
    "no-const-assign 2: It is declared with const on line 1. Use let if it has to change.",
  ],
  [`var a = 1;\nuse(a);\nvar a = 2;\nuse(a);`, "no-redeclare 3: It is first declared on line 1."],
  [
    `switch (f()) {\n  case 1:\n    break;\n  case 2:\n    break;\n  case 1:\n    break;\n}`,
    "no-duplicate-case 6: Only the first case with this label runs. It is on line 2.",
  ],
  [`use({\n  a: 1,\n  b: 2,\n  a: 3,\n});`, "no-dupe-keys 4: Only the last one counts. The first is on line 2."],
  [`use(class {\n  a() {}\n  a() {}\n});`, "no-dupe-class-members 3: Only the last one counts."],
  [`use(9007199254740993);`, "no-loss-of-precision 1: At runtime it is 9007199254740992."],
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
    "preserve-caught-error 4: Pass { cause: err } as the last argument, so that the caught error is not lost.",
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
  [
    `while (true) {\n  f();\n}\nuse(1);`,
    "no-unreachable 4: The loop on line 1 runs forever, or leaves by return or throw.",
  ],
  [
    `export function a() {\n  if (f()) {\n    return 1;\n  } else {\n    throw g();\n  }\n  use(1);\n}`,
    "no-unreachable 7: Every path through the if on line 2 ends in return, throw, break or continue.",
  ],
  [`const userName = f();\nuse(usrName, userName);`, 'no-undef 2: Did you mean "userName"?'],
  [`consle.log(1);`, 'no-undef 1: Did you mean "console"?'],
  [`use(new Promse(f));`, 'no-undef 1: Did you mean "Promise"?'],
  [`describe("a", f);`, 'no-undef 1: With bun test, import it from "bun:test".'],
  [`jQuery("a");`, "no-undef 1: If it is a global variable, declare it in [lint.globals] in bunfig.toml."],
  [
    `try {\n  f();\n} catch (e) {\n  g();\n}`,
    "no-unused-vars 3: A catch needs no parameter. Remove it and its parentheses.",
  ],
  [
    `try {\n  f();\n} catch ({ a, b }) {\n  g(a);\n}`,
    "no-unused-vars 3: Remove it, or start its name with _ to keep it.",
  ],
  [`const a = f();`, "no-unused-vars 1: Remove it, or start its name with _ to keep it."],
  [`export function a(b) {}`, "no-unused-vars 1: Remove it, or start its name with _ to keep it."],
  [`import a from "a";`, "no-unused-vars 1"],
  [
    `use(1,\u00a02);`,
    "no-irregular-whitespace 1: It is the character U+00A0. Replace it with a plain space or a line break.",
  ],
  [`use(f() === NaN);`, "use-isnan 1: Nothing is equal to NaN, not even NaN itself."],
  [
    `use(/[👍🏽]/u);`,
    "no-misleading-character-class 1: What looks like one character is several, and the class matches each of them alone.",
  ],
];

const globals = { "bunfig.toml": `[lint.globals]\nf = "readonly"\ng = "readonly"\nh = "readonly"\nuse = "readonly"\n` };

test.concurrent.each(cases)("%s", async (code, ...reports) => {
  expect(await hints(code + "\n", "a.js", globals)).toEqual(reports);
});

test.concurrent("@typescript-eslint/no-unused-vars", async () => {
  const code = `try {\n  f();\n} catch (e) {\n  f();\n}\nconst { a, ...others } = f();\nconst b = f(others);\ndeclare function f(a?: unknown): any;\n`;
  expect(await hints(code, "a.ts")).toEqual([
    "@typescript-eslint/no-unused-vars 3: A catch needs no parameter. Remove it and its parentheses.",
    "@typescript-eslint/no-unused-vars 7: Remove it, or start its name with _ to keep it.",
    "@typescript-eslint/no-explicit-any 8: unknown is the safe choice where the type is not known.",
  ]);
});

test.concurrent.each(["a.js", "a.ts"])("no-unused-vars with options from bunfig.toml, in %s", async file => {
  const rule = file === "a.js" ? "no-unused-vars" : "@typescript-eslint/no-unused-vars";
  const bunfig = `[lint.rules]\n"${rule}" = ["warn", { ignoreRestSiblings = false, varsIgnorePattern = "^x" }]\n`;
  const code = `const { a, ...others } = Bun;\nconsole.log(others);\nconst _b = 1;\n`;
  expect(await hints(code, file, { "bunfig.toml": bunfig })).toEqual([
    `${rule} 1: To leave a property out this way, turn on the option ignoreRestSiblings.`,
    `${rule} 3`,
  ]);
});

test.concurrent("typescript-eslint rules", async () => {
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
    "@typescript-eslint/no-unused-expressions 3: Nothing uses the value. Did you mean to call it, with ()?",
    "@typescript-eslint/no-unused-expressions 4: Nothing uses the result of the comparison. Did you mean to assign, with =?",
    "@typescript-eslint/no-unused-expressions 5: Nothing uses the value, so the statement does nothing.",
    "@typescript-eslint/no-this-alias 7: Use an arrow function instead. It has the this of the code around it.",
    "@typescript-eslint/no-unsafe-declaration-merging 10: TypeScript does not check that the class sets what the interface declares.",
    "@typescript-eslint/no-unsafe-declaration-merging 11: TypeScript does not check that the class sets what the interface declares.",
    "@typescript-eslint/no-explicit-any 14: unknown is the safe choice where the type is not known.",
    "@typescript-eslint/no-require-imports 15: Use an import declaration, or await import() to load it later.",
    "@typescript-eslint/no-require-imports 16: Use an import declaration.",
  ]);
});

test.concurrent("react-hooks/rules-of-hooks", async () => {
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
    "react-hooks/rules-of-hooks 8: The return on line 6 can end the render before it is called.",
    "react-hooks/rules-of-hooks 10: Whether it is called depends on the condition on line 9.",
    "react-hooks/rules-of-hooks 12: Whether it is called depends on the condition on line 12.",
  ]);
});

test.concurrent("bun:test/valid-expect", async () => {
  const code = `import { expect, test } from "bun:test";\ntest("a", async () => {\n  expect(Promise.resolve(1)).resolves.toBe(1);\n});\n`;
  expect(await hints(code, "a.test.ts")).toEqual(["bun:test/valid-expect 3: Add await, or return the promise."]);
});

test.concurrent("no-octal", async () => {
  expect(await hints(`module.exports = [071, 09];\n`, "a.cjs")).toEqual([
    "no-octal 1: The leading 0 makes it octal, so 071 is 57. Write 0o71 to make that clear.",
    "no-octal 1: The leading zero does nothing here. Remove it.",
  ]);
});

describe.concurrent("formats that show a hint", () => {
  const files = { "a.js": `export function f(a) {\n  let b = a;\n  b = 2;\n  return b;\n}\n` };
  const hint = "It is overwritten on line 3 before it is read.";

  test("agent", async () => {
    const { stdout } = await lint(files, "-f", "agent");
    expect(stdout).toContain(`<help>${hint}</help>`);
  });

  test("pretty with --all", async () => {
    const { stdout } = await lint(files, "-f", "pretty", "--all");
    expect(stdout).toContain(`note: ${hint}`);
  });

  test.each(["stylish", "json", "unix", "github", "junit", "checkstyle", "gitlab", "sarif"])("not %s", async format => {
    const { stdout } = await lint(files, "-f", format);
    expect(stdout).toContain("is not used in subsequent statements");
    expect(stdout).not.toContain("overwritten");
  });

  test("not with an oxlint config", async () => {
    const config = JSON.stringify({ rules: { "no-useless-assignment": "error" } });
    const { stdout } = await lint({ ...files, ".oxlintrc.json": config }, "-f", "default");
    expect(stdout).toContain("no-useless-assignment");
    expect(stdout).not.toContain("overwritten");
  });
});
