import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Regression test for exponential selector expansion in the CSS minifier on
// deeply nested style rules (found by fuzzing).
//
// `bun build` compiles CSS for its default browser targets. Two of those
// compatibility transforms duplicate entire nested-rule subtrees:
//
// * a selector list the targets can't fully represent (`::part()`, `:is()`,
//   `:not(a, b)`, any nested selector list containing `&`, ...) is split into
//   one rule per selector, deep-cloning every nested rule for each copy, and
// * selectors that need vendor prefixes (`:autofill`, `:fullscreen`, ...)
//   re-print the whole rule — nested rules included — once per prefix.
//
// Both multiply at every nesting level, so ~25 levels of nesting in well under
// 1 KB of CSS ballooned into gigabytes of memory/output (or a hang). The
// minifier now budgets these expansions and keeps the modern syntax once the
// budget is spent, so pathological inputs stay bounded while ordinary
// stylesheets are unaffected.

async function buildCSS(name: string, css: string) {
  using dir = tempDir("css-nested-selector-expansion", { [name]: css });
  const outdir = path.join(String(dir), "out");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", path.join(String(dir), name), "--outdir", outdir],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix these builds allocated gigabytes and never
    // finished. Let the child terminate itself so a regression fails the
    // assertions below instead of leaving a runaway `bun build` behind.
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

// Each nesting level has two selectors that can't be wrapped in :is() for the
// default targets, so every level used to double the number of rule clones.
test("deeply nested ::part() selector lists do not explode the minifier", async () => {
  const css = "a::part(header),a::part(body){".repeat(25) + "color:red" + "}".repeat(25);
  const { exitCode, output } = await buildCSS("part.css", css);
  expect(exitCode).toBe(0);
  expect(output.length).toBeGreaterThan(0);
  expect(output.length).toBeLessThan(8_000_000);
});

test("deeply nested :is() selector lists do not explode the minifier", async () => {
  const css = "a:is(.bar),a:is(.baz){".repeat(22) + "color:red" + "}".repeat(22);
  const { exitCode, output } = await buildCSS("is.css", css);
  expect(exitCode).toBe(0);
  expect(output.length).toBeGreaterThan(0);
  expect(output.length).toBeLessThan(8_000_000);
});

test("deeply nested :not() selector lists do not explode the minifier", async () => {
  // Unclosed blocks are implicitly closed at EOF, matching the fuzzer input.
  const css = "t:not(.foo,.bar),u:not(.foo,.bar){".repeat(28) + "color:red";
  const { exitCode, output } = await buildCSS("not.css", css);
  expect(exitCode).toBe(0);
  expect(output.length).toBeGreaterThan(0);
  expect(output.length).toBeLessThan(8_000_000);
});

// :autofill needs a -webkit- fallback for the default targets, and prefixed
// rules are re-printed (nested rules included) once per prefix, so every
// nesting level used to multiply the printed output.
test("deeply nested vendor-prefix fallbacks do not explode the output", async () => {
  const css = "a:placeholder-shown,a:autofill{".repeat(20) + "color:red" + "}".repeat(20);
  const { exitCode, output } = await buildCSS("autofill.css", css);
  expect(exitCode).toBe(0);
  expect(output.length).toBeGreaterThan(0);
  expect(output.length).toBeLessThan(8_000_000);
});

// Ordinary nesting stays far under the expansion budget, so the usual
// downleveling still happens: selector lists that can't use :is() are split
// per selector, and prefixed fallbacks are still emitted.
test("shallow nesting still compiles selectors and prefixes for older targets", async () => {
  const split = await buildCSS("shallow-part.css", "a::part(header),a::part(body){b{color:red}}");
  expect(split.exitCode).toBe(0);
  expect(split.output).toContain("a::part(header) b");
  expect(split.output).toContain("a::part(body) b");

  const prefixed = await buildCSS("shallow-fullscreen.css", "a:fullscreen{b{color:red}}");
  expect(prefixed.exitCode).toBe(0);
  expect(prefixed.output).toContain(":-webkit-full-screen");
  expect(prefixed.output).toContain(":fullscreen");
});
