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
// When a rule's selector list mixes a vendor-prefixed pseudo-class
// (`:-webkit-autofill`) with an unprefixed one (`:placeholder-shown`),
// `get_prefix` sets two prefix bits and `StyleRule::to_css` serializes the
// whole rule once per bit. Each pass re-serializes the rule's nested rules, so
// nesting such rules repeats the inner subtree once per prefix at every level
// — (prefix count)^depth. The earlier fix (PR #31270) deduplicated this only
// when nesting was compiled away for browser targets; with no targets (or
// nesting-capable targets) nesting is preserved, `&` is printed literally, and
// every ancestor prefix pass genuinely needs its own copy of the body, so the
// output cannot be collapsed. The minifier now bounds the total number of
// per-prefix rule copies and errors out instead of allocating gigabytes.

const VENDOR_PREFIX_LIMIT_ERROR = "Maximum vendor-prefix expansion exceeded";

// `depth` nested copies of a rule whose selector list mixes a prefixed pseudo
// (`:-webkit-autofill`, prefix bit) with an unprefixed one
// (`:placeholder-shown`, NONE bit), innermost holding `color: red`.
function nestedMixedPrefix(depth: number): string {
  return ".a:placeholder-shown .x, .b:-webkit-autofill .y {\n".repeat(depth) + "color: red;\n" + "}\n".repeat(depth);
}

test("deeply nested mixed vendor-prefix rules error instead of exploding with no targets", () => {
  // Each level doubles the number of printed rule copies, so without a bound
  // this is ~2^depth copies of the leaf — hundreds of MB by the mid-teens.
  // The bound turns it into a thrown error.
  expect(() => minifyTest(nestedMixedPrefix(16), "")).toThrow(VENDOR_PREFIX_LIMIT_ERROR);
});

test("the fuzzer reproduction shape errors instead of amplifying", () => {
  // The fuzzer's shape: unclosed nested rules (the CSS parser closes them at
  // EOF). 884 MB of output on the original 1.5 KB input; now a thrown error.
  const src = ".a:placeholder-shown .x, .b:-webkit-autofill .y {\n".repeat(16) + "color: red;";
  expect(() => minifyTest(src, "")).toThrow(VENDOR_PREFIX_LIMIT_ERROR);
});

test("nesting-capable targets also bound the mixed vendor-prefix expansion", () => {
  // Modern targets preserve nesting (no de-nesting), so the same per-prefix
  // re-serialization of the body applies and must be bounded too.
  expect(() => minifyTest(nestedMixedPrefix(16), "", { chrome: 130 << 16 })).toThrow(VENDOR_PREFIX_LIMIT_ERROR);
});

test("shallow mixed vendor-prefix nesting still minifies with both prefix variants", () => {
  // Below the limit, the rule is still emitted once per prefix variant — the
  // expansion is correct and necessary, just bounded.
  const output = minifyTest(nestedMixedPrefix(2), "");
  expect(output).toContain(":-webkit-autofill");
  expect(output).toContain(":autofill");
  expect(output).toContain("color:red");
  expect(output.length).toBeLessThan(10_000);
});

test("deeply nested single-prefix rules stay linear and do not trip the bound", () => {
  // A single selector with one vendor prefix (no mixing with an unprefixed
  // selector) sets one prefix bit, so the rule is serialized once per level —
  // linear, not multiplicative. This must not hit the bound.
  const src = ".b:-webkit-autofill .y {\n".repeat(40) + "color: red;\n" + "}\n".repeat(40);
  const output = minifyTest(src, "");
  expect(output).toContain("color:red");
  expect(output.length).toBeLessThan(10_000);
});

test("a large flat stylesheet of single-prefix rules does not trip the bound", () => {
  // `get_prefix` returns a single (non-empty) prefix bit for a selector like
  // `:not(...)`, `:where(...)`, or `::placeholder`, so such a rule enters the
  // per-prefix loop but is serialized exactly once — no fan-out. The bound must
  // only count rules that actually fan out (more than one prefix bit), not
  // every single-prefix rule; otherwise a flat, non-nested bundle of such rules
  // — linear, non-amplifying output — would falsely error once enough of them
  // accumulate against the never-reset counter. More rules than the limit
  // (`MAX_PREFIX_EXPANSIONS` = 65_536), each with a distinct declaration so
  // they are not merged into one rule.
  const count = 70_000;
  let src = "";
  for (let i = 0; i < count; i++) src += `.c${i}:not(.x){--v${i}:1}`;
  const output = minifyTest(src, "");
  // Linear in input: one emitted rule per input rule, not a thrown error.
  expect(output.split(":not(.x)").length - 1).toBe(count);
}, 30_000);
