import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Regression test for exponential backtracking in the CSS parser on deeply
// nested function values.
//
// For every nested `calc(`/`rgb(`/... level, the value parser tried one
// alternative that descended into the block and failed, then another
// alternative that descended into the very same block again (`Calc::parse`
// followed by `V::parse`, or the token-list color fallbacks). Each unclosed or
// invalid nesting level therefore doubled the work: 50 nested unclosed
// `calc(` levels — a 661-byte stylesheet — kept `bun build` spinning forever
// while allocating unboundedly.
//
// The parser now remembers when a nested block failed to parse and turned out
// to be unclosed at the end of input (re-parsing the truncated suffix can only
// fail again), and a math function whose arguments failed to parse is no
// longer re-parsed through the value fallback, so these inputs are rejected
// (or parsed) in linear time.

async function buildCSS(name: string, css: string) {
  using dir = tempDir("css-nested-function-backtracking", { [name]: css });
  const outdir = path.join(String(dir), "out");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", path.join(String(dir), name), "--outdir", outdir],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix these builds spun forever. Let the child
    // terminate itself so a regression fails the assertions below instead of
    // leaving a runaway `bun build` process behind.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let output = "";
  try {
    output = await Bun.file(path.join(outdir, name)).text();
  } catch {}
  return { stdout, stderr, exitCode, output };
}

test("unclosed nested calc() values error out instead of hanging", async () => {
  const { stderr, exitCode } = await buildCSS("unclosed-calc.css", ".b{height:" + "calc(100vh - ".repeat(50) + "}");
  expect(stderr).toContain("Unexpected end of input");
  expect(exitCode).toBe(1);
});

test("unclosed nested color function values error out instead of hanging", async () => {
  const { stderr, exitCode } = await buildCSS("unclosed-rgb.css", ".b{color:" + "rgb(1 2 3 / ".repeat(50) + "}");
  expect(stderr).toContain("Unexpected end of input");
  expect(exitCode).toBe(1);
});

test("deeply nested balanced-but-invalid calc() is handled without hanging", async () => {
  // Balanced parentheses, but the innermost value is not valid in calc(), so
  // the math-function parse fails at every nesting level. This exercises the
  // non-EOF half of the fix: the failed math function must not be re-parsed
  // through the value fallback at each level.
  const { stderr, exitCode, output } = await buildCSS(
    "balanced-invalid-calc.css",
    ".b{height:" + "calc(1px + ".repeat(50) + "@" + ")".repeat(50) + "}",
  );
  // The declaration is preserved as an unparsed value, same as before.
  expect(output).toContain("calc(");
  expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
});

test("deeply nested valid calc() still parses and folds", async () => {
  const { stderr, exitCode, output } = await buildCSS(
    "balanced-valid-calc.css",
    ".b{height:" + "calc(1px + ".repeat(50) + "2px" + ")".repeat(50) + "}",
  );
  expect(output).toContain("height: 52px");
  expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
});

test("stylesheets truncated inside an otherwise-valid value still parse", async () => {
  // Blocks left open at the end of input are implicitly closed when their
  // contents parse fine; that behavior must survive the fast-fail path.
  const { stderr, exitCode, output } = await buildCSS("truncated-valid.css", ".a{color:red;width:calc(100% - 5px");
  expect(output).toContain("color: red");
  expect(output).toContain("calc(100% - 5px)");
  expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
});

// The parser refuses blocks nested more than 512 levels deep, but a nesting
// level costs several times more stack in debug and sanitizer builds than in
// release builds, and the bundler parses CSS on worker threads with 4 MB
// stacks. Input nested a few hundred levels deep, below the depth limit,
// overflowed those stacks (a segfault on the worker thread) before the limit
// was reached. The parser now also checks the remaining stack at every nested
// block and reports the nesting error once it runs low. Whether a given input
// parses or is rejected therefore depends on the build's frame sizes, so the
// tests below accept either outcome; what they check is that the build
// finishes and reports something sensible.
describe("deeply nested input below the nesting limit", () => {
  const NESTING_LIMIT_ERROR = "Maximum CSS nesting depth exceeded";
  // Below the parser's 512-level limit, above what fits on a 4 MB worker
  // stack in a debug or sanitizer build.
  const depth = 500;

  async function bundleInChild(css: string): Promise<{ success: boolean; logs: string[] }> {
    using dir = tempDir("css-deep-nesting", { "deep.css": css });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const result = await Bun.build({ entrypoints: ["./deep.css"], minify: true, throw: false });
console.log(JSON.stringify({ success: result.success, logs: result.logs.map(log => log.message) }));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A crashed child prints nothing; stderr and the exit status are part of
    // the comparison so the failure shows what happened to it.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
      stdout: expect.stringMatching(/^\{/),
      exitCode: 0,
    });
    return JSON.parse(stdout);
  }

  test.concurrent("nested :is() selectors", async () => {
    // :is() takes a forgiving selector list: a rejected argument empties the
    // innermost :is() that still fit, and the stylesheet as a whole parses.
    const result = await bundleInChild(":is(".repeat(depth) + "a" + ")".repeat(depth) + "{c:d}");
    expect(result).toEqual({ success: true, logs: [] });
  });

  test.concurrent.each([
    ["nested :has() selectors", ":has(".repeat(depth) + "a" + ")".repeat(depth) + "{c:d}", NESTING_LIMIT_ERROR],
    ["nested @supports blocks", "@supports (c:d){".repeat(depth) + "a{c:d}" + "}".repeat(depth), NESTING_LIMIT_ERROR],
    [
      "nested @media blocks",
      "@media (min-width:1px){".repeat(depth) + "a{c:d}" + "}".repeat(depth),
      NESTING_LIMIT_ERROR,
    ],
    [
      "nested calc() values",
      "a{width:" + "calc(1px + ".repeat(depth) + "2px" + ")".repeat(depth) + "}",
      NESTING_LIMIT_ERROR,
    ],
    [
      "nested blocks in a custom property value",
      "a{--x:" + "(".repeat(depth) + "1" + ")".repeat(depth) + "}",
      NESTING_LIMIT_ERROR,
    ],
    // A rule body first tries `a{` as a declaration and only then as a nested
    // rule; when the nested rule is rejected too, the declaration attempt's
    // error is the one reported.
    ["nested style rules", "a{".repeat(depth) + "c:d" + "}".repeat(depth), "Unexpected token: {"],
  ])("%s", async (_name, css, errorWhenRejected) => {
    const result = await bundleInChild(css);
    if (!result.success) {
      expect(result.logs).toContain(errorWhenRejected);
    }
  });

  test.concurrent("input nested past the limit is still rejected", async () => {
    const result = await bundleInChild("@supports (c:d){".repeat(600) + "a{c:d}" + "}".repeat(600));
    expect(result).toEqual({ success: false, logs: [NESTING_LIMIT_ERROR] });
  });
});
