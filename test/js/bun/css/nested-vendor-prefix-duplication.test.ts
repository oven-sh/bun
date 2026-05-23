import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Regression test for exponential output when nested rules are re-serialized
// once per vendor prefix.
//
// When CSS nesting is compiled away for older targets, a style rule whose
// selector needs vendor prefixes (e.g. `:fullscreen` -> `:-webkit-full-screen`
// + `:fullscreen`) is serialized once per prefix, and each pass re-serialized
// *all* of its nested rules. A nested rule that has its own vendor prefixes
// overrides the printer's prefix, so those re-serializations were exact
// duplicates — output doubled per nesting level. A ~5 KB stylesheet with a few
// dozen nested `:fullscreen` levels made the printer allocate gigabytes.
//
// Nested rules that carry their own vendor prefixes are now only emitted in
// the final prefix pass of their ancestor, so the output stays linear in
// nesting depth.

const { minifyTest, prefixTest } = cssInternals;

// Safari 8: `:fullscreen` requires the `-webkit-` prefix and CSS nesting is
// unsupported, so nesting gets compiled away and selectors get prefixed.
const safari8 = { safari: 8 << 16 };

function nestedFullscreen(depth: number, innermost: string): string {
  let css = "";
  for (let i = 0; i < depth; i++) {
    css += ":fullscreen {\n";
  }
  css += innermost + "\n";
  css += "}\n".repeat(depth);
  return css;
}

test("prefixed nested rules are not duplicated per ancestor prefix pass", () => {
  const output = minifyTest(nestedFullscreen(3, "color: red;"), "", safari8);
  // One rule per prefix variant — not one per combination of ancestor passes.
  expect(output).toBe(
    ":-webkit-full-screen :-webkit-full-screen :-webkit-full-screen{color:red}" +
      ":fullscreen :fullscreen :fullscreen{color:red}",
  );
});

test("output stays linear in nesting depth with prefixed nested selectors", () => {
  const depth = 16;
  const output = minifyTest(nestedFullscreen(depth, "color: red;"), "", safari8);
  // Before the fix this was ~2^(depth-1) copies of each rule (tens of MB at
  // depth 16, gigabytes at the ~28 levels the fuzzer used). Fixed output is
  // two rules, one per prefix variant.
  expect(output.length).toBeLessThan(10_000);
  expect(output).toBe(
    `${Array(depth).fill(":-webkit-full-screen").join(" ")}{color:red}` +
      `${Array(depth).fill(":fullscreen").join(" ")}{color:red}`,
  );
});

test("unprefixed nested rules still expand once per ancestor prefix pass", () => {
  // A nested rule without its own vendor prefixes depends on the ancestor's
  // current prefix pass (its `&` expansion uses it), so it must still be
  // emitted in every pass.
  const output = minifyTest(":fullscreen { div { color: red } }", "", safari8);
  expect(output).toBe(":-webkit-full-screen div{color:red}:fullscreen div{color:red}");
});

test("pretty-printed output has no dangling separators around skipped passes", () => {
  // Non-minified output: a non-final prefix pass of the outer rule emits
  // nothing (its only nested rule is prefixed and deferred to the final
  // pass), so no blank-line separator may be emitted for it either.
  const output = prefixTest(nestedFullscreen(2, "color: red;"), "", safari8);
  expect(output).toBe(
    ":-webkit-full-screen :-webkit-full-screen {\n  color: red;\n}\n\n:fullscreen :fullscreen {\n  color: red;\n}\n",
  );
});

test("pretty-printed output has no dangling separators when the rule has declarations", () => {
  // The non-final pass prints the rule's own declaration block but defers its
  // prefixed nested rule to the final pass, so the separator between the
  // declarations and the nested rules must not be emitted for that pass.
  const output = prefixTest(":fullscreen { color: green; :fullscreen { color: red } }", "", safari8);
  expect(output).toBe(
    ":-webkit-full-screen {\n  color: green;\n}\n\n" +
      ":fullscreen {\n  color: green;\n}\n\n" +
      ":-webkit-full-screen :-webkit-full-screen {\n  color: red;\n}\n\n" +
      ":fullscreen :fullscreen {\n  color: red;\n}\n",
  );
});

test("bun build --target=browser does not blow up on deeply nested prefixed selectors", async () => {
  // Mirrors the fuzzer input: deeply nested `:fullscreen` blocks. The default
  // browser targets (safari 14) require the `-webkit-` prefix for
  // `:fullscreen` and don't support CSS nesting, so this hits the same path.
  const depth = 16;
  using dir = tempDir("css-nested-vendor-prefix", {
    "app.css": nestedFullscreen(depth, "color: red;"),
  });
  const outdir = path.join(String(dir), "out");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", path.join(String(dir), "app.css"), "--target=browser", "--minify", "--outdir", outdir],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Before the fix this build tried to materialize an exponentially sized
    // stylesheet; make a regression fail the assertions below instead of
    // hanging or OOMing the test runner.
    timeout: 60_000,
    killSignal: "SIGKILL",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect({ exitCode, stderr: stderr.includes("error") ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });

  const output = await Bun.file(path.join(outdir, "app.css")).text();
  // Two rules (one per prefix variant), each `depth` selectors long.
  expect(output.length).toBeLessThan(10_000);
  expect(output).toContain(Array(depth).fill(":-webkit-full-screen").join(" "));
  expect(output).toContain(Array(depth).fill(":fullscreen").join(" "));
});
