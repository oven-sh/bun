import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for exponential selector expansion when compiling CSS
// nesting for browser targets that don't support it.
//
// When nesting has to be compiled away, every nesting level multiplies the
// parent selector list into its nested rules, and selectors the targets don't
// support are additionally split into one cloned rule (including a deep clone
// of all nested rules) per selector. A ~900 byte stylesheet with 23 levels of
// two-selector nested rules therefore expanded into gigabytes of cloned rules
// and output, OOMing the bundler — found by fuzzing, and reachable with a
// plain `bun build` since the default bundler targets predate `:is()` and
// native nesting. The minifier now bounds the expansion and reports an error.

const { minifyTest, prefixTest } = cssInternals;

const LIMIT_ERROR = "Nested CSS rules expand to more than";

// `outer` plain-nested two-selector rules, then `atRule`'s block, then `inner`
// more nested two-selector rules. The blocks are left unclosed (the CSS parser
// closes them at EOF), matching the fuzzer's shape.
//
// The at-rule sits between two nesting levels: the minifier used to descend
// into plain nested style rules but skip the rules nested inside nesting-holding
// at-rules like `@starting-style`, so the selector-expansion cap only counted
// the `outer` levels and never saw the `inner` ones. These at-rules preserve the
// `&`-resolution context at print time, so when compiling nesting away for old
// targets the printer expanded the full `outer + inner` depth — an exponential
// number of selector preludes — without bound.
function nestedAcrossAtRule(atRule: string, selectors: string, outer: number, inner: number): string {
  return `${selectors} {\n`.repeat(outer) + `${atRule} {\n` + `${selectors} {\n`.repeat(inner) + "color: red";
}

function nestedAcrossStartingStyle(selectors: string, outer: number, inner: number): string {
  return nestedAcrossAtRule("@starting-style", selectors, outer, inner);
}

// Every nesting-holding at-rule that preserves the parent-selector context at
// print time (so inner rules multiply against the outer nesting levels) must
// count those inner rules against the cap. `@supports` in particular calls into
// a `minify` that looks active but used to be a no-op that never recursed.
const CONTEXT_PRESERVING_AT_RULES = [
  "@starting-style",
  "@supports (color: red)",
  "@container (width > 1px)",
  "@-moz-document url-prefix()",
];

/** `depth` nested copies of a two-selector rule, innermost holding `color: red`. */
function nestedRules(selectors: string, depth: number): string {
  return `${selectors} {\n`.repeat(depth) + "color: red;\n" + "}\n".repeat(depth);
}

// Targets that support neither `:is()` nor CSS nesting.
const OLD_TARGETS = { chrome: 80 << 16 };
// Targets that support CSS nesting natively, so nothing needs to be expanded.
const MODERN_TARGETS = { chrome: 130 << 16 };

test("deeply nested multi-selector rules error instead of exploding when compiled for old targets", () => {
  const src = nestedRules("co :is(.bar), .bar :is(.baz)", 17);
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(LIMIT_ERROR);
});

test("deeply nested ::part() selector lists error instead of exploding when compiled for old targets", () => {
  // ::part() can never be wrapped in :is(), so each selector is split into its
  // own rule with a clone of every nested rule — the other shape of the same
  // exponential blowup.
  const src = nestedRules("x::part(a), y::part(b)", 17);
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(LIMIT_ERROR);
});

test("nested rules below the expansion limit still compile for old targets", () => {
  const src = nestedRules("co :is(.bar), .bar :is(.baz)", 8);
  const out = minifyTest(src, "", OLD_TARGETS);
  expect(out).toContain("color:red");
  expect(out.length).toBeLessThan(100_000);
});

test("the fuzzer reproduction still minifies when no targets are configured", () => {
  // 924-byte minimized fuzzer input: 23 unclosed nested rules. Without browser
  // targets nothing is expanded, so this stays linear.
  const src = "        co :is(.bar), .bar :is(.baz) {\n".repeat(23) + "        color: red;\n      }";
  const out = minifyTest(src, "");
  expect(out).toContain("color:red");
  expect(out.length).toBeLessThan(10_000);
});

test("deep nesting is preserved as-is for targets that support CSS nesting", () => {
  const src = nestedRules("co :is(.bar), .bar :is(.baz)", 23);
  const out = minifyTest(src, "", MODERN_TARGETS);
  expect(out).toContain("color:red");
  expect(out.length).toBeLessThan(10_000);
});

// `:user-valid` is treated as unsupported for every target, but the lists below
// have no pseudo-elements and equal specificity, so the minifier collapses each
// list into a single `:is(& .a:user-valid, & .b:user-valid)` selector instead
// of splitting it into cloned rules.

test("incompatible selector lists that collapse into :is() don't hit the limit when nesting is preserved", () => {
  // Nothing is cloned and nesting stays native, so the output is linear and no
  // limit applies — even though a per-level multiplier would naively reach 2^20.
  const src = nestedRules(".a:user-valid, .b:user-valid", 20);
  const out = minifyTest(src, "", MODERN_TARGETS);
  expect(out).toContain("color:red");
  expect(out.length).toBeLessThan(100_000);
});

test("collapsed :is() lists still hit the limit when nesting has to be compiled away", () => {
  // The :is() wrap keeps one `&` per original selector, so compiling nesting
  // away still doubles the printed selector per level (~34 MB at this depth).
  const src = nestedRules(".a:user-valid, .b:user-valid", 20);
  expect(() => minifyTest(src, "", { chrome: 100 << 16 })).toThrow(LIMIT_ERROR);
});

test("bun build reports an error instead of exploding on deeply nested multi-selector css", async () => {
  using dir = tempDir("css-nested-selector-expansion", {
    "input.css": nestedRules("co :is(.bar), .bar :is(.baz)", 17),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", "out", "--minify"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this build produced tens of megabytes of
    // output (and at slightly larger depths, gigabytes). Let the child
    // terminate itself so a regression fails the assertions below instead of
    // hanging the runner.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(LIMIT_ERROR);
  expect(exitCode).toBe(1);
  // The build must fail before emitting the (multi-megabyte) expanded output.
  expect(await Bun.file(`${dir}/out/input.css`).exists()).toBe(false);
});

// An at-rule such as `@starting-style` sitting between two nesting levels used
// to hide the inner levels from the selector-expansion cap: the minifier
// descended into plain nested style rules but not into the rules nested inside
// `@starting-style`, so the cap never counted them and the printer expanded the
// full depth exponentially. The minifier now recurses through these at-rules.

test("nested multi-selector rules spanning @starting-style error instead of exploding (minify)", () => {
  // 8 outer + 8 inner = 16 levels: enough that the full depth blows the cap,
  // but only if the minifier counts the inner levels hidden behind the at-rule.
  const src = nestedAcrossStartingStyle('[foo="bar"], .bar', 8, 8);
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(LIMIT_ERROR);
});

test("nested multi-selector rules spanning @starting-style error instead of exploding (prefix)", () => {
  // The exact entrypoint from the fuzzer report: vendor-prefix lowering for old
  // targets over selector lists nested across `@starting-style`.
  const src = nestedAcrossStartingStyle('[foo="bar"], .bar', 8, 8);
  expect(() => prefixTest(src, "", { safari: 11 << 16, firefox: 60 << 16, chrome: 50 << 16 })).toThrow(LIMIT_ERROR);
});

test.each(CONTEXT_PRESERVING_AT_RULES)("nested multi-selector rules spanning %s error instead of exploding", atRule => {
  const src = nestedAcrossAtRule(atRule, '[foo="bar"], .bar', 8, 8);
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(LIMIT_ERROR);
});

test.each(CONTEXT_PRESERVING_AT_RULES)("shallow nesting spanning %s still compiles for old targets", atRule => {
  const src = nestedAcrossAtRule(atRule, ".a, .b", 1, 2);
  const out = minifyTest(src, "", OLD_TARGETS);
  expect(out.length).toBeLessThan(10_000);
  // The inner rules resolve against the outer `.a, .b` chain (cartesian product).
  expect(out).toContain(":is(.a,.b) .b .b");
});

test("shallow nesting spanning @starting-style still compiles for old targets", () => {
  const src = nestedAcrossStartingStyle('[foo="bar"], .bar', 1, 2);
  const out = prefixTest(src, "", { safari: 11 << 16, firefox: 60 << 16, chrome: 50 << 16 });
  // The `&` chain flows through `@starting-style`, so the inner rules expand to
  // the cartesian product of the two-selector lists.
  expect(out).toContain("@starting-style");
  expect(out).toContain(':is([foo="bar"], .bar) .bar .bar');
  expect(out.length).toBeLessThan(10_000);
});

test("declarations nested inside @starting-style are minified", () => {
  // Previously the `@starting-style` minify arm was a no-op, so nested
  // declarations were never minified. Duplicate declarations should collapse.
  const out = minifyTest("@starting-style { .a { color: red; color: red } }", "");
  expect(out).toBe("@starting-style{.a{color:red}}");
});

test("@nest declarations are preserved and do not leak onto the following sibling rule", () => {
  // The `@nest` arm charges the wrapped rule's selectors against the cap and
  // recurses into its nested rules, but deliberately does not run the wrapped
  // rule's declarations through the property handlers: those consume logical
  // properties and only stage physical fallbacks in the shared handler context
  // (which the `@nest` minify port does not yet drain). Running them would both
  // drop the declaration from `&.x` and leak the staged fallback onto the next
  // sibling's selector. The declaration must therefore survive verbatim on
  // `&.x`, and the sibling must be untouched.
  const out = minifyTest(".p { @nest &.x { padding-inline-start: 7px } .sibling { color: #abc } }", "", {
    ie: 11 << 16,
  });
  // The `@nest` rule keeps its own declaration verbatim (not dropped, not lowered).
  expect(out).toContain("padding-inline-start:7px");
  // The sibling keeps only its own declaration — no leaked padding.
  expect(out).toContain(".sibling{color:#abc}");
  expect(out).not.toContain("padding-left");
  expect(out).not.toContain("padding-right");
});

test("deeply nested multi-selector rules spanning @scope error instead of exploding", () => {
  // `@scope` clears the `&`-resolution context at print time, but compiling
  // nesting away still duplicates the whole `@scope` block once per enclosing
  // selector combination — so the output is exponential in the outer depth and
  // the multiplier must be carried through the `@scope` boundary.
  //
  // 10 outer + 10 inner levels, chosen so the outer levels alone stay under the
  // cap (they compile fine on their own, asserted below): the limit can only
  // fire if the multiplier is carried into the rules nested inside `@scope`.
  // Resetting it to 1 across the boundary would instead emit 2^outer copies of
  // the block without ever hitting the cap.
  const outer = 10;
  const inner = 10;
  expect(() => minifyTest(nestedAcrossAtRule("@scope", ".a, .b", outer, inner), "", OLD_TARGETS)).toThrow(LIMIT_ERROR);
  // The outer levels on their own are well under the cap, so the error above is
  // attributable to the inner levels counted through `@scope`, not the outer
  // nesting alone.
  expect(minifyTest(".a, .b {\n".repeat(outer) + "color: red", "", OLD_TARGETS).length).toBeGreaterThan(0);
});

test("shallow nesting spanning @scope still compiles for old targets", () => {
  const src = nestedAcrossAtRule("@scope", ".a, .b", 2, 2);
  const out = minifyTest(src, "", OLD_TARGETS);
  expect(out.length).toBeLessThan(10_000);
  // Inside @scope the inner rules resolve against `:scope`, not the outer chain.
  expect(out).toContain(":scope");
  expect(out).toContain("@scope");
});

// ── selector-split clone weight ──────────────────────────────────────────────
//
// The selector-count cap above bounds how many rules the incompatible-selector
// split can produce, but not their size: each split-off selector deep-clones
// the rule's declarations and entire nested-rule subtree, and under nesting
// the subtree already contains the clones made at deeper levels. A large
// custom-property payload repeated across a dozen two-selector nesting levels
// therefore cloned (and later printed) gigabytes while staying well under
// 65,536 selectors — e.g. 449 KB of input produced a 1.08 GB minified output.
// The minifier now also bounds the cumulative weight of those clones.

const CLONE_LIMIT_ERROR = "duplicates too much CSS";

/** `depth` nested two-selector rules, each carrying a `payload`-sized custom property. */
function nestedPayloadRules(depth: number, payload: number): string {
  const pad = Buffer.alloc(payload, "a").toString();
  return `.a, .b { --p: ${pad};\n`.repeat(depth) + "color: red;\n" + "}".repeat(depth);
}

test("splitting nested rules with large payloads errors instead of cloning gigabytes", () => {
  // 14 levels of two-selector rules with a 2 KB payload each: ~16K selector
  // combinations (well under the selector-count cap) but each split clones the
  // payload-bearing subtree, compounding to ~70 MB of cloned weight (33 MB of
  // output before the fix, gigabytes at slightly larger payloads).
  expect(() => minifyTest(nestedPayloadRules(14, 2048), "", OLD_TARGETS)).toThrow(CLONE_LIMIT_ERROR);
});

test("the mixed vendor-prefix fuzzer shape with large payloads is bounded too", () => {
  // Same shape as the fuzzer's hang input but with a fat custom property per
  // level: mixed-compat selector lists split at every nesting level, cloning
  // the payload into every branch. 97 KB of input produced a 69 MB output
  // before the fix.
  const pad = Buffer.alloc(8192, "a").toString();
  const src =
    `.a:placeholder-shown .x, .b:-webkit-autofill .y { --p: ${pad};\n`.repeat(12) + "color: red" + "}".repeat(12);
  expect(() => minifyTest(src, "", { safari: (13 << 16) | (2 << 8) })).toThrow(CLONE_LIMIT_ERROR);
});

test.each([
  ["dimension-unit", "--p: 1PAD;"],
  ["dashed-ident", "--p: --PAD;"],
  ["var-name", "--p: var(--PAD);"],
  ["env-name", "--p: env(--PAD);"],
  ["function-name", "--p: PAD(x);"],
  ["custom-property-name", "--PAD: 1;"],
  ["unknown-pseudo-class-name", ":PAD { color: red }"],
  ["class-selector", ".PAD { color: red }"],
  ["type-selector", "PAD { color: red }"],
  ["attribute-value", '[d="PAD"] { color: red }'],
  ["view-transition-part-name", "::view-transition-group(PAD) { color: red }"],
  ["cue-selector", '::cue([d="PAD"]) { color: red }'],
  ["unknown-at-rule-name", "@PAD;"],
  ["media-feature-name", "@media (PAD: 1) { color: red }"],
  ["supports-condition", "@supports (PAD: PAD) { color: red }"],
  ["layer-name", "@layer PAD { color: red }"],
  ["scope-selector", "@scope (.PAD) { color: red }"],
  ["container-name", "@container PAD (width > 1px) { color: red }"],
  ["attribute-namespace-prefix", "[PAD|d] { color: red }"],
])("the clone weight counts %s text, not just plain idents", (_name, body) => {
  // Every construct that carries input-sized borrowed text must be charged its
  // text length: raw-token payloads, property names, selector text, wrapped
  // pseudo-element selectors and part names, and the names/preludes/conditions
  // of every at-rule that can nest inside a style rule. If any of them were
  // charged only the flat constant, moving the padding there would bypass the
  // budget and restore the multi-gigabyte amplification (each of these shapes
  // produced a 33+ MB output from ~30 KB of input before it was counted).
  const pad = Buffer.alloc(2048, "a").toString();
  const src = `.a, .b { ${body.replace(/PAD/g, pad)}\n`.repeat(14) + "color: red;\n" + "}".repeat(14);
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(CLONE_LIMIT_ERROR);
});

test("nested rules with payloads below the clone limit still compile byte-for-byte", () => {
  // Two levels below the throwing depth: the split path runs and its output is
  // unchanged by the budget.
  const out = minifyTest(nestedPayloadRules(12, 2048), "", OLD_TARGETS);
  expect(out.length).toBe(8595441);
  expect(out).toContain("color:red");
});

test("shallow incompatible splits still produce the full split output", () => {
  const out = minifyTest(".a, .b { --p: x;\n".repeat(3) + "color: red;\n" + "}".repeat(3), "", OLD_TARGETS);
  expect(out).toBe(
    ".a,.b{--p:x}" +
      ":is(.a,.b) .a{--p:x}" +
      ":is(.a,.b) .a .a{--p:x;color:red}" +
      ":is(.a,.b) .a .b{--p:x;color:red}" +
      ":is(.a,.b) .b{--p:x}" +
      ":is(.a,.b) .b .a{--p:x;color:red}" +
      ":is(.a,.b) .b .b{--p:x;color:red}",
  );
});

test("bun build reports the clone limit instead of writing a multi-megabyte file", async () => {
  using dir = tempDir("css-split-clone-weight", {
    "input.css": nestedPayloadRules(14, 2048),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", "out", "--minify"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this build wrote ~33 MB (gigabytes at larger
    // payloads). Let the child terminate itself so a regression fails the
    // assertions below instead of hanging the runner.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(proc.signalCode).toBeNull();
  expect(stderr).toContain(CLONE_LIMIT_ERROR);
  expect(exitCode).toBe(1);
  expect(await Bun.file(`${dir}/out/input.css`).exists()).toBe(false);
});

test("bun build does not hang on deeply nested multi-selector css spanning @starting-style", async () => {
  using dir = tempDir("css-starting-style-expansion", {
    // The fuzzer's depth (14 outer + 11 inner): without the fix this hangs for
    // 20+ seconds while expanding the inner levels hidden behind the at-rule.
    "input.css": nestedAcrossStartingStyle('[foo="bar"], .bar', 14, 11),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", "out", "--minify"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this hung while expanding the hidden inner
    // nesting levels. Let the child terminate itself so a regression fails the
    // assertions below instead of hanging the runner.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  // Must terminate on its own (reporting the limit error), not be SIGKILLed.
  expect(proc.signalCode).toBeNull();
  expect(stderr).toContain(LIMIT_ERROR);
  expect(exitCode).toBe(1);
  expect(await Bun.file(`${dir}/out/input.css`).exists()).toBe(false);
});

// ── printer indent counter ───────────────────────────────────────────────────

test("pretty-printing 128+ levels of nested rules does not crash", async () => {
  // The printer's indent counter was a u8 incremented by 2 per nesting level,
  // so pretty-printing a valid stylesheet with 128+ nested rules overflowed it
  // (a panic in debug builds). Run in a subprocess so a regression is an exit
  // code, not a dead test runner.
  const script = `
    const { cssInternals } = require("bun:internal-for-testing");
    const css = ".a {\\n".repeat(200) + "color: red;\\n" + "}".repeat(200);
    const out = cssInternals.prefixTest(css, "", { chrome: 130 << 16 });
    console.log(out.length);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    indentedLength: parseInt(stdout, 10) > 1000,
    exitCode,
    stderr: stderr.includes("panic") ? stderr : "",
  }).toEqual({
    indentedLength: true,
    exitCode: 0,
    stderr: "",
  });
});

// ── minimized fuzzer input ───────────────────────────────────────────────────

test("the minimized fuzzer input terminates across minify, nesting-compile, and prefix passes", () => {
  // 11.6 KB fuzzer-generated input combining `>`-combinator token floods inside
  // invalid rules with ~20 levels of unclosed mixed-compat two-selector nesting.
  // Before the expansion bounds, minifying it for old targets cloned and
  // re-serialized the nested subtree once per incompatible selector per level,
  // hanging or OOMing (6+ GB). Every pass must now finish quickly, either
  // returning output or reporting one of the bounded-expansion errors.
  const input = Buffer.from(
    Bun.gunzipSync(
      Buffer.from(
        "H4sIAAAAAAACA+1azW4bNxDu2U9BIBAgFaKwsiXLpoDcc3GB3AL4UO7u7C4hityQ1F8FAXqDvkKP7a1vkCKPkpx76z2dXf04VhzbcSTZVrgCJJMz/GY45HDWnGkkWpMpsRGXwMgrlQgl3KRC+L9/z5Xocye0orEwEDkR8qiX8AjoUFgRComMWlXIBb+ozI5ekls/qRExTXl+OxvTA0d1Qg1XKaw6GwsVHXZuDcgm2vTZYtpVupq2qnVXlgjInqZ0TZOTzxRotFGFgpHlH+Z/SrR7pmUMhtpMjxRphNzUSyBGRxDmYGxeLNIQpstRdw3pCUf5wOlESMmiDKIexAXPb2R6RPDZqoCdA/uRhzVypztw9dy/O9SmkCKUFAqoddw4OhKxyxg5zsfdNZ8egsFzAWikpTaWkSYZclOlFFWq1ckJkTystoPG+flZhTSP2412cEoodnSCzlnN43icr+L8cn+c2fKXZQVenbBERwO7iNsS1tv6e8iJhDEdGZ4zUnx3tyJx7Wehdk5jWGzmY2K1FDEJ0dd73U2+pQv2+bh6HL0dJVqhW4JIM4deWXuwUqEB3qMhYGyG++lfHDnTUnzCOIzIa93njbrlRFlqUUvNLhEzRosJB4x60rMhzZ6UilJYh+FnIoG6SQ43ci59A08QyXMLT8eiv9532FeALg94z3nX2y1pf9Kivrf+95EOZT5HP8Ya+q28T9J/v7979ywmcHSwK7P4j2xcJ0HN78dvJ3mzHDrpn/mXxA/zv3apy0187//YAsjWVHQwdniBGINyfq9siYSZmz22skmegbI3suxZlasWX6Xptgj9GMa93vo4nz+qArNHnr9v7be1vDMzxdXx4n5t21J+3qD95M3/sBZmw5/ATsFDN8VEoB6YCO4alWuBp7OhMMTYb++StS67ULzvl/3LFsPkawpuV4LKShBM6ZbJHOsMuChjmGmrzK4leQgvMtEbqZ5PdFS+o3z2ihJsQpXjYFHk0QyCbyq1CZZKXFXsPHOEgiM1eqBiRiKtRERTw2OBblLljpz75wFPhbSDSlmchBmgQV8VNUp18iIJTuskxWKJ2rKuiCzJZoDJpDKR6tfjUdfDm9+b/8DNz6VIFSY7ZXLrQmwGFnwbxwCKZTE/apz0CHtC+HQXxPSqaLf8S3IHb6rNs1brtNNqBZ2TTnDebjdPm20sQFpLLWtsyQSk1KMumf0PJ9zOf3YtAAA=",
        "base64",
      ),
    ),
  ).toString("latin1");

  const boundedError = /expand|expansion|duplicates too much CSS/;
  expect(() => minifyTest(input, "")).toThrow(boundedError);
  expect(() => minifyTest(input, "", { safari: (13 << 16) | (2 << 8) })).toThrow(boundedError);
  expect(() => prefixTest(input, "", { safari: (13 << 16) | (2 << 8) })).toThrow(boundedError);
});

// ── combinator token floods stay linear ──────────────────────────────────────

test("a '>' combinator flood in an invalid selector minifies in linear time", () => {
  // The fuzzer input floods tens of thousands of `>` delimiter tokens inside
  // invalid rules. Parsing collapses consecutive combinators, so this must
  // complete quickly with a tiny output rather than being cloned or
  // re-serialized per token.
  const flood = Buffer.alloc(80_000, "> ").toString();
  expect(minifyTest(`${flood}.foo { color: red }`, "")).toBe(">>.foo>{color:red}");
});

test("a '>' combinator flood in an unknown declaration value stays linear", () => {
  // Unknown declarations keep their value as a raw token list; a 40K-token
  // flood must round-trip in linear time and size.
  const flood = Buffer.alloc(80_000, "> ").toString();
  const out = minifyTest(`.a { notaprop: ${flood} }`, "");
  expect(out.length).toBeGreaterThan(40_000);
  expect(out.length).toBeLessThan(81_000);
  expect(out).toStartWith(".a{notaprop:>");
});
