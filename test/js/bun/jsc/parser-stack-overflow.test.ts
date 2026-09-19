import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// JavaScriptCore's parser parses some text a second time as another production when the first parse fails: a literal
// as a destructuring pattern, a parenthesized expression as arrow function parameters. It did that after a stack
// overflow too, at every nesting level on the way out, so a literal nested one level past the stack limit never
// finished parsing. oven-sh/WebKit#700 makes the first overflow end the parse.
//
// Without that, a child here never exits and grows by about 250 MB per second. So each child has a short timeout, and
// the tests do not run concurrently.
const childTimeout = 10_000;

// Far past what any stack size allows, so that every platform and build overflows.
const depth = 100_000;

// Buffer.alloc, because "".repeat is very slow in a debug build of JavaScriptCore.
function nest(open: string, inner: string, close: string) {
  return (
    Buffer.alloc(depth * open.length, open).toString() + inner + Buffer.alloc(depth * close.length, close).toString()
  );
}

test("eval and the Function constructor throw a RangeError for nesting past the parser's stack limit", async () => {
  using dir = tempDir("parser-stack-overflow-eval", {
    "programs.json": JSON.stringify({
      "object literal": `var x = ${nest("{v:", "1", "}")};`,
      "array literal": `var x = ${nest("[", "1", "]")};`,
      "array assignment pattern": `var a; ${nest("[", "a", "]")} = [];`,
      "arrow function parameter default": `var x = ${nest("(a = ", "1", ")")};`,
    }),
    "run.js": `
      const results = {};
      for (const [name, program] of Object.entries(require("./programs.json"))) {
        for (const [how, run] of [["eval", () => (0, eval)(program)], ["Function", () => new Function(program)]]) {
          try {
            run();
            results[name + ", " + how] = "no error";
          } catch (e) {
            results[name + ", " + how] = e.name + ": " + e.message;
          }
        }
      }
      console.log(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: childTimeout,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // One assertion, so that a child the timeout killed shows as such: no results, no exit code, a signal.
  const overflow = "RangeError: Maximum call stack size exceeded.";
  expect({ results: stdout && JSON.parse(stdout), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    results: {
      "object literal, eval": overflow,
      "object literal, Function": overflow,
      "array literal, eval": overflow,
      "array literal, Function": overflow,
      "array assignment pattern, eval": overflow,
      "array assignment pattern, Function": overflow,
      "arrow function parameter default, eval": overflow,
      "arrow function parameter default, Function": overflow,
    },
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test("a module with a literal nested past the parser's stack limit fails to load with a RangeError", async () => {
  // The "// @bun" pragma says the file is Bun's own output, so the transpiler passes it through and JavaScriptCore
  // is the only parser that sees the literal.
  using dir = tempDir("parser-stack-overflow-module", {
    "nested.js": `// @bun\nexport const v = ${nest("{v:", "1", "}")};\nconsole.log("loaded");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "nested.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: childTimeout,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "",
    stderr: expect.stringContaining("RangeError: Maximum call stack size exceeded."),
    exitCode: 1,
    signalCode: null,
  });
});
