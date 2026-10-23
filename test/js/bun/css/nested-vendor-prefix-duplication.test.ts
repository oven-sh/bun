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

// Regression for a CSS-minifier output bomb found by fuzzing: a ~1.5 KB input
// minified to ~884 MB (≈577,000× amplification), a DoS vector.
//
// A rule whose selector list mixes an explicitly prefixed pseudo-class
// (`:-webkit-autofill`) with an unprefixed one (`:placeholder-shown`) used to
// be printed once per prefix: `get_prefix` set two prefix bits, and the second
// pass rewrote `:-webkit-autofill` to an `:autofill` the source never had. With
// no targets (or nesting-capable targets) nesting is preserved, every pass
// re-serialized the nested rules too, and nesting such rules grew the output by
// 2^depth. An explicitly prefixed component is now printed as written and adds
// no pass of its own, so these rules print once per level.

// `depth` nested copies of a rule whose selector list mixes a prefixed pseudo
// (`:-webkit-autofill`) with an unprefixed one (`:placeholder-shown`),
// innermost holding `color: red`.
function nestedMixedPrefix(depth: number): string {
  return ".a:placeholder-shown .x, .b:-webkit-autofill .y {\n".repeat(depth) + "color: red;\n" + "}\n".repeat(depth);
}

// The minified `nestedMixedPrefix(depth)`: each level once, nested levels with
// an explicit `&`. `wrap` wraps each selector list in `:is()`, which the
// minifier does for targets that support `:is()` but not every selector in the
// list (`:-webkit-autofill` counts as unsupported).
function nestedMixedPrefixOutput(depth: number, wrap = (list: string) => list): string {
  const outer = wrap(".a:placeholder-shown .x,.b:-webkit-autofill .y") + "{";
  const nested = wrap("& .a:placeholder-shown .x,& .b:-webkit-autofill .y") + "{";
  return outer + nested.repeat(depth - 1) + "color:red" + "}".repeat(depth);
}

test("nested rules that mix a prefixed and an unprefixed pseudo-class print once per level", () => {
  expect(minifyTest(nestedMixedPrefix(2), "")).toBe(
    ".a:placeholder-shown .x,.b:-webkit-autofill .y{& .a:placeholder-shown .x,& .b:-webkit-autofill .y{color:red}}",
  );
  // ~2^20 copies of the leaf before the fix (bounded by an error since #31642).
  expect(minifyTest(nestedMixedPrefix(20), "")).toBe(nestedMixedPrefixOutput(20));
});

test("the fuzzer reproduction shape prints once per level", () => {
  // The fuzzer's shape: unclosed nested rules (the CSS parser closes them at
  // EOF). 884 MB of output on the original 1.5 KB input.
  const src = ".a:placeholder-shown .x, .b:-webkit-autofill .y {\n".repeat(20) + "color: red;";
  expect(minifyTest(src, "")).toBe(nestedMixedPrefixOutput(20));
});

test("nesting-capable targets print mixed-prefix nested rules once per level", () => {
  // Modern targets preserve nesting (no de-nesting) and need no prefixes here.
  expect(minifyTest(nestedMixedPrefix(20), "", { chrome: 130 << 16 })).toBe(
    nestedMixedPrefixOutput(20, list => `:is(${list})`),
  );
});

test("deeply nested single-prefix rules stay linear", () => {
  // A single selector with one explicit vendor prefix is serialized once per
  // level.
  const src = ".b:-webkit-autofill .y {\n".repeat(40) + "color: red;\n" + "}\n".repeat(40);
  const output = minifyTest(src, "");
  expect(output).toBe(
    ".b:-webkit-autofill .y{" + "& .b:-webkit-autofill .y{".repeat(39) + "color:red" + "}".repeat(40),
  );
});

test("a large flat stylesheet of fanning-out rules does not trip the bound", () => {
  // A fanning-out rule with no nested rules re-serializes only its own prelude
  // and declarations on each prefix pass — flat fan-out, linear in input size
  // and bounded by the prefix count (at most 5). Its duplicate passes do charge
  // the byte budget, but only a few dozen bytes per rule, so the total stays
  // far under the cap without nesting to compound it. Old targets downlevel a
  // single `::placeholder` into four prefix variants (`-webkit-input-`,
  // `-moz-`, `-ms-input-`, unprefixed); 10_000 such rules charge ~3 duplicate
  // passes of a tiny declaration each (~1.3 MB total), well under the 64 MB
  // byte limit. Distinct declarations keep the rules from being merged. This
  // stays linear instead of throwing. (10_000 keeps a debug build under the
  // default per-test timeout.)
  const oldTargets = { safari: 8 << 16, firefox: 20 << 16, chrome: 30 << 16, edge: 12 << 16 };
  const count = 10_000;
  let src = "";
  for (let i = 0; i < count; i++) src += `input.c${i}::placeholder{--v${i}:1}`;
  const output = minifyTest(src, "", oldTargets);
  // Four prefix variants per input rule emitted (one unprefixed), not a throw.
  expect(output.split("::placeholder").length - 1).toBe(count);
  expect(output.split("::-webkit-input-placeholder").length - 1).toBe(count);
});

test("the body of a nested mixed-prefix rule is printed once per level", () => {
  // Sibling leaf rules and declarations under each level were re-serialized
  // once per ancestor prefix pass too: ~1.4 KB and ~1.8 KB of input printed
  // 9 MB and tens of MB.
  const level = ".a:placeholder-shown,.b:-webkit-autofill{";
  const nestedLevel = "& .a:placeholder-shown,& .b:-webkit-autofill{";

  const depth = 15;
  const leaf = ".x0:placeholder-shown,.y0:-webkit-autofill{--v0:1}";
  const nestedLeaf = "& .x0:placeholder-shown,& .y0:-webkit-autofill{--v0:1}";
  expect(minifyTest((level + leaf).repeat(depth) + "}".repeat(depth), "")).toBe(
    level + (nestedLeaf + nestedLevel).repeat(depth - 1) + nestedLeaf + "}".repeat(depth),
  );

  const payload = `--p:${Buffer.alloc(64, "a").toString()}`;
  expect(minifyTest((level + payload + ";").repeat(depth) + "}".repeat(depth), "")).toBe(
    level + (payload + ";" + nestedLevel).repeat(depth - 1) + payload + "}".repeat(depth),
  );
});
