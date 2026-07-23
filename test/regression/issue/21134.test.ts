// https://github.com/oven-sh/bun/issues/21134
// TypeError thrown while obtaining the iterator for `for-of`, `for-await-of`,
// array destructuring, `yield*`, and array spread over a null/undefined
// subject was attributed to the *previous* statement because JavaScriptCore's
// bytecode generator did not emit expression info before the
// `[Symbol.iterator]` property read (or the spread op).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function errorInfo(code: string) {
  // Use eval so Bun's transpiler leaves the source alone; we are testing
  // JavaScriptCore's bytecode generator.
  return `try { eval(${JSON.stringify(code)}) } catch (e) { console.log(JSON.stringify({ line: e.line, column: e.column, message: e.message, stack: e.stack })); }`;
}

describe.concurrent("error location for iterator protocol on null/undefined", () => {
  test("for-of", async () => {
    const source = `console.log("sentinel-before");\nfor (const b of null) {}\n`;
    const { stdout, exitCode } = await run(errorInfo(source));
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("sentinel-before");
    const info = JSON.parse(lines[1]);
    expect(info.message).not.toContain("sentinel-before");
    expect(info.line).toBe(2);
    expect(exitCode).toBe(0);
  });

  test("for-await-of", async () => {
    const source = `(async () => {\n  console.log("sentinel-before");\n  for await (const b of null) {}\n})().catch(e => console.log(JSON.stringify({ line: e.line, column: e.column, message: e.message })));`;
    const { stdout, exitCode } = await run(source);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("sentinel-before");
    const info = JSON.parse(lines[1]);
    expect(info.message).not.toContain("sentinel-before");
    expect(info.line).toBe(3);
    expect(exitCode).toBe(0);
  });

  test("array destructuring", async () => {
    const source = `console.log("sentinel-before");\nconst [b] = null;\n`;
    const { stdout, exitCode } = await run(errorInfo(source));
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("sentinel-before");
    const info = JSON.parse(lines[1]);
    expect(info.message).not.toContain("sentinel-before");
    expect(info.line).toBe(2);
    expect(exitCode).toBe(0);
  });

  test("yield*", async () => {
    const source = `function* g() {\n  console.log("sentinel-before");\n  yield* null;\n}\ng().next();\n`;
    const { stdout, exitCode } = await run(errorInfo(source));
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("sentinel-before");
    const info = JSON.parse(lines[1]);
    expect(info.message).not.toContain("sentinel-before");
    expect(info.line).toBe(3);
    expect(exitCode).toBe(0);
  });

  test("array spread", async () => {
    const source = `console.log("sentinel-before");\nconst x = [...null];\n`;
    const { stdout, exitCode } = await run(errorInfo(source));
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("sentinel-before");
    const info = JSON.parse(lines[1]);
    // Spread throws from the performIteration builtin, which debug builds
    // include in the stack; look at the first user-code frame instead of
    // e.line (which is the topmost frame, builtin or not).
    const userFrame = info.stack.split("\n").find((l: string) => l.includes("[eval]") || l.includes("%5Beval%5D"));
    expect(userFrame).toMatch(/eval(%5D|\]):2:/);
    expect(info.message).not.toContain("sentinel-before");
    expect(exitCode).toBe(0);
  });

  // The exact scenario from the issue: Bun's transpiler inlines the const
  // so the for-of subject becomes the `undefined` literal.
  test("for-of over inlined const undefined (original issue)", async () => {
    const source = `const a = undefined;\n\nconsole.log("sentinel-before");\nfor (const b of a) {\n  console.log("unreachable");\n}\n`;
    const { stdout, stderr, exitCode } = await run(source);
    expect(stdout.trim()).toBe("sentinel-before");
    // The error should point at the for-of on line 4, not the console.log on
    // line 3, and must not claim to be evaluating the previous statement.
    expect(stderr).not.toContain(`evaluating 'console.log`);
    expect(stderr).toMatch(/\[eval\]:4:/);
    expect(stderr).not.toMatch(/\[eval\]:3:/);
    expect(exitCode).toBe(1);
  });
});
