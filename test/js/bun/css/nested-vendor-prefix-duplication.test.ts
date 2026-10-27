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
// output cannot be collapsed. The minifier now bounds the total bytes emitted
// by those duplicate prefix passes and errors out instead of allocating
// gigabytes.

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
  expect(() => minifyTest(nestedMixedPrefix(20), "")).toThrow(VENDOR_PREFIX_LIMIT_ERROR);
});

test("the fuzzer reproduction shape errors instead of amplifying", () => {
  // The fuzzer's shape: unclosed nested rules (the CSS parser closes them at
  // EOF). 884 MB of output on the original 1.5 KB input; now a thrown error.
  const src = ".a:placeholder-shown .x, .b:-webkit-autofill .y {\n".repeat(20) + "color: red;";
  expect(() => minifyTest(src, "")).toThrow(VENDOR_PREFIX_LIMIT_ERROR);
});

test("nesting-capable targets also bound the mixed vendor-prefix expansion", () => {
  // Modern targets preserve nesting (no de-nesting), so the same per-prefix
  // re-serialization of the body applies and must be bounded too.
  expect(() => minifyTest(nestedMixedPrefix(20), "", { chrome: 130 << 16 })).toThrow(VENDOR_PREFIX_LIMIT_ERROR);
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

test("a large flat stylesheet of fanning-out rules does not trip the bound", () => {
  // A fanning-out rule with no nested rules re-serializes only its own prelude
  // and declarations on each prefix pass — flat fan-out, linear in input size
  // and bounded by the prefix count (at most 5). Its duplicate passes do charge
  // the byte budget, but only a few dozen bytes per rule, so the total stays
  // far under the cap without nesting to compound it. Old targets downlevel a
  // single `::placeholder` into four prefix variants (`-webkit-input-`,
  // `-moz-`, `-ms-input-`, unprefixed); 20_000 such rules charge ~3 duplicate
  // passes of a tiny declaration each (a few MB total), well under the 64 MB
  // byte limit. Distinct declarations keep the rules from being merged. This
  // stays linear instead of throwing.
  const oldTargets = { safari: 8 << 16, firefox: 20 << 16, chrome: 30 << 16, edge: 12 << 16 };
  const count = 20_000;
  let src = "";
  for (let i = 0; i < count; i++) src += `input.c${i}::placeholder{--v${i}:1}`;
  const output = minifyTest(src, "", oldTargets);
  // Four prefix variants per input rule emitted (one unprefixed), not a throw.
  expect(output.split("::placeholder").length - 1).toBe(count);
  expect(output.split("::-webkit-input-placeholder").length - 1).toBe(count);
});

test("leaf rules nested under a fanning-out ancestor are bounded", () => {
  // The amplification is driven by the whole nested body re-serialized once per
  // ancestor prefix, so it must be bounded by the *output* emitted under a
  // fan-out — not by whether each nested rule fans out on its own. Each nesting
  // level is a two-prefix rule holding K plain leaf siblings plus one recursive
  // child; the leaves never fan out themselves but are duplicated
  // (prefix count)^depth times. A ~1.4 KB input expands past 9 MB here unless
  // those duplicated leaves count against the bound; it becomes a thrown error.
  const K = 1;
  const depth = 15;
  const leaves = Array.from(
    { length: K },
    (_, i) => `.x${i}:placeholder-shown,.y${i}:-webkit-autofill{--v${i}:1}`,
  ).join("");
  const level = ".a:placeholder-shown,.b:-webkit-autofill{";
  const src = (level + leaves).repeat(depth) + "}".repeat(depth);
  expect(() => minifyTest(src, "")).toThrow(VENDOR_PREFIX_LIMIT_ERROR);
});

test("a large declaration block under a fanning-out ancestor is bounded", () => {
  // The duplicated payload need not be nested rules: a fan-out pass also
  // re-serializes the rule's own declarations. Each nesting level is a
  // two-prefix rule whose body is one large custom-property declaration plus a
  // recursive child, so the declaration bytes are duplicated (prefix count)^depth
  // times — ~1.8 KB of input emits tens of MB. Counting only nested rules would
  // miss this (the declaration is not a rule); bounding the emitted bytes of
  // each duplicate pass catches it.
  const depth = 16;
  const payload = `--p:${Buffer.alloc(64, "a").toString()};`;
  const level = ".a:placeholder-shown,.b:-webkit-autofill{";
  const src = (level + payload).repeat(depth) + "}".repeat(depth);
  expect(() => minifyTest(src, "")).toThrow(VENDOR_PREFIX_LIMIT_ERROR);
});
