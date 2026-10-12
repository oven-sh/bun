// The line that `pretty` and `agent` print under a report whose message alone does not tell what is wrong and what to do.
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

/** What `pretty` says about `code`: a line for each report, with the rule, the line, and the hint if there is one. */
async function hints(code: string, file = "a.js", others: Record<string, string> = {}) {
  const { stdout } = await lint({ ...others, [file]: code }, "-f", "pretty");
  const reports = stdout.matchAll(/^(?:error|warn): .*  (\S+)\n +at [^\n]*?:(\d+):\d+\n(?:\nnote: (.*)\n)?/gm);
  return Array.from(reports, ([, rule, line, hint]) => `${rule} ${line}${hint === undefined ? "" : ": " + hint}`);
}

describe.concurrent("no-useless-assignment", () => {
  test("every way leads to another assignment", async () => {
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

  test("the next statement assigns", async () => {
    expect(await hints(`export function f(a) {\n  let b = a;\n  b = 2;\n  return b;\n}\n`)).toEqual([
      "no-useless-assignment 2: It is overwritten on line 3 before it is read.",
    ]);
  });

  test("three ways and more", async () => {
    const cases = (count: number) => Array.from({ length: count }, (_, i) => `    case ${i}: b = ${i}; break;\n`);
    const code = (count: number) =>
      `export function f(a) {\n  let b = -1;\n  switch (a) {\n${cases(count).join("")}    default: b = 9;\n  }\n  return b;\n}\n`;
    expect(await Promise.all([hints(code(2)), hints(code(5))])).toEqual([
      ["no-useless-assignment 2: It is overwritten on lines 4, 5 and 6 before it is read."],
      ["no-useless-assignment 2: It is overwritten on lines 4, 5, 6 and 3 more before it is read."],
    ]);
  });

  test("nothing reads the variable again", async () => {
    expect(await hints(`export function f(a) {\n  let b = a;\n  use(b);\n  b = 2;\n}\n`, "a.ts")).toEqual([
      "no-useless-assignment 4: Nothing reads it after this.",
    ]);
  });
});

/** The code, and what is said about it. The code uses what it declares, so that nothing else is reported. */
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
  [`try {\n  f();\n} catch {}`, "no-empty 3: Remove it, or put a comment in it that says why it is empty."],
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
    `use("a" + f() || "b");`,
    "no-constant-binary-expression 1: The left side is always truthy or always falsy. Are parentheses missing?",
  ],
  [
    `use(!f() ?? "b");`,
    "no-constant-binary-expression 1: The left side is never null or undefined, or always is. Are parentheses missing?",
  ],
  [`use(!f() == null);`, "no-constant-binary-expression 1: The result is always the same. Are parentheses missing?"],
  [`use({} === f());`, "no-constant-binary-expression 1"],
  [
    `try {\n  f();\n} catch (e) {\n  throw e;\n}`,
    "no-useless-catch 1: It only throws the error again. The code does the same without try and catch.",
  ],
  [
    `try {\n  f();\n} catch (e) {\n  throw e;\n} finally {\n  g();\n}`,
    "no-useless-catch 3: It only throws the error again. try and finally do the same without it.",
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
  [`use(typeof f() === null);`, "valid-typeof 1: typeof always returns a string."],
  [`use(typeof f() === undefined);`, 'valid-typeof 1: typeof returns the string "undefined".'],
  [
    `try {\n  f();\n} catch (err) {\n  throw new Error("no");\n}`,
    "no-unused-vars 3",
    "preserve-caught-error 4: Pass { cause: err } as the last argument, so that the caught error is not lost.",
  ],
  [
    String.raw`use("\d+");`,
    String.raw`no-useless-escape 1: \d is the same as d. Remove the backslash, or write \\ for a real one.`,
  ],
  [String.raw`use(/a\:b/);`, String.raw`no-useless-escape 1: \: is the same as : here. Remove the backslash.`],
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
];

test.concurrent.each(cases)("%s", async (code, ...reports) => {
  expect(await hints(code + "\n/* global f, g, h, use */\n")).toEqual(reports);
});

test.concurrent("no-octal", async () => {
  expect(await hints(`module.exports = [071, 09];\n`, "a.cjs")).toEqual([
    "no-octal 1: It is octal: 071 is 57. Write 0o71 to make that clear.",
    "no-octal 1: The leading zero does nothing here. Remove it.",
  ]);
});

describe.concurrent("where a hint is shown", () => {
  const files = { "a.js": `export function f(a) {\n  let b = a;\n  b = 2;\n  return b;\n}\n` };
  const hint = "It is overwritten on line 3 before it is read.";
  const message = "The value assigned to 'b' is not used in subsequent statements.";

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
    expect(stdout).toContain(message.slice(0, -1));
    expect(stdout).not.toContain("overwritten");
  });

  test("not with an oxlint config", async () => {
    const config = JSON.stringify({ rules: { "no-useless-assignment": "error" } });
    const { stdout } = await lint({ ...files, ".oxlintrc.json": config }, "-f", "default");
    expect(stdout).toContain("no-useless-assignment");
    expect(stdout).not.toContain("overwritten");
  });
});
