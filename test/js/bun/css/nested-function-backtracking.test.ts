import { expect, test } from "bun:test";
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
