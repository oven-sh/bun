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

const { minifyTest, prefixTest, _test } = cssInternals;

const LIMIT_ERROR = "Nested CSS rules expand to more than";
const TOKEN_LIMIT_ERROR = "raw property tokens when compiled for the configured browser targets";

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

// Regression test for unbounded token-list cloning when compiling CSS nesting
// for browser targets that don't support it.
//
// The selector-expansion cap counts the number of rules the expansion
// produces, but each split rule also deep-clones its declarations. An
// unparsed property value (any value the property-specific parser couldn't
// read) is stored as a raw TokenList and copied in full for every clone, so
// a few thousand tokens under ten ::part()-selector nesting levels expanded
// into gigabytes of in-memory tokens while the selector count stayed well
// under its 65,536 cap. Found by fuzzing. The minifier now bounds the total
// cloned-token count and reports an error.

/** `depth` nested ::part() rules with a large unparsed `color:` value at the
 * bottom. `::part()` is a pseudo-element so the selector list can never be
 * collapsed into `:is()`; each level is split into one cloned rule per
 * selector, and the clone carries a full copy of the inner value. */
function nestedWithLargeUnparsedValue(depth: number, tokens: number): string {
  // `x ` parses to two tokens (ident + whitespace); the unknown function
  // `f(...)` around it keeps the whole thing one raw TokenList.
  const payload = Buffer.alloc(tokens * 2, "x ").toString();
  return (
    "x::part(a), y::part(b) {\n".repeat(depth) + ".inner { color: f(" + payload + "var(--x)) }\n" + "}\n".repeat(depth)
  );
}

test("nested selector splits with a large unparsed value error instead of exploding (minify)", () => {
  // 8 two-selector levels = 256 copies of a ~6000-token value = ~1.5M tokens,
  // past the 1M cap. Before the fix this emitted ~800 KB of output (and at
  // slightly larger depths allocated gigabytes before the selector cap was
  // reached).
  const src = nestedWithLargeUnparsedValue(8, 3000);
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(TOKEN_LIMIT_ERROR);
});

test("nested selector splits with a large unparsed value error instead of exploding (prefix)", () => {
  const src = nestedWithLargeUnparsedValue(8, 3000);
  expect(() => prefixTest(src, "", OLD_TARGETS)).toThrow(TOKEN_LIMIT_ERROR);
});

test("nested selector splits with a large unparsed value error instead of exploding (_test)", () => {
  // The fuzzer entrypoint.
  const src = nestedWithLargeUnparsedValue(8, 3000);
  expect(() => _test(src, "", OLD_TARGETS)).toThrow(TOKEN_LIMIT_ERROR);
});

test("nested selector splits with a large unparsed value below the token limit still compile for old targets", () => {
  // 6 levels = 64 copies of ~6000 tokens = ~384K tokens, under the 1M cap.
  const src = nestedWithLargeUnparsedValue(6, 3000);
  const out = minifyTest(src, "", OLD_TARGETS);
  expect(out).toContain("var(--x)");
  expect(out.length).toBeLessThan(1_000_000);
});

test("unparsed-value output below the token limit is unchanged by the cap", () => {
  // Shallow enough that neither cap applies: the cap must not affect what
  // valid expansions emit.
  const src = nestedWithLargeUnparsedValue(2, 20);
  expect(minifyTest(src, "", OLD_TARGETS)).toMatchInlineSnapshot(
    `":is(x::part(a),y::part(b)) x::part(a) .inner{color:f(x x x x x x x x x x x x x x x x x x x x var(--x))}:is(x::part(a),y::part(b)) y::part(b) .inner{color:f(x x x x x x x x x x x x x x x x x x x x var(--x))}"`,
  );
});

test("large unparsed values are preserved as-is for targets that support CSS nesting", () => {
  // No split, no clone: the input passes through with native nesting intact
  // regardless of value size.
  const src = nestedWithLargeUnparsedValue(12, 3000);
  const out = minifyTest(src, "", MODERN_TARGETS);
  expect(out).toContain("var(--x)");
  expect(out.length).toBeLessThan(20_000);
});

test("large unparsed values are preserved as-is when no targets are configured", () => {
  const src = nestedWithLargeUnparsedValue(12, 3000);
  const out = minifyTest(src, "");
  expect(out).toContain("var(--x)");
  expect(out.length).toBeLessThan(20_000);
});

test("token limit still applies when the large unparsed value sits inside a context-preserving at-rule", () => {
  // Same `@starting-style` hiding mechanism as the selector-cap tests above:
  // the token charge must follow the multiplier through the at-rule.
  const payload = Buffer.alloc(6000, "x ").toString();
  const src =
    "x::part(a), y::part(b) {\n".repeat(4) +
    "@starting-style {\n" +
    "x::part(a), y::part(b) {\n".repeat(4) +
    ".inner { color: f(" +
    payload +
    "var(--x)) }";
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(TOKEN_LIMIT_ERROR);
});

test("token limit covers nested unknown at-rule bodies", () => {
  // An unknown at-rule nested inside a style rule stores its block as a raw
  // TokenList and is deep-cloned by the same per-selector split, so its
  // tokens must count against the cap too (not just declaration values).
  const payload = Buffer.alloc(6000, "x ").toString();
  const src = "x::part(a), y::part(b) {\n".repeat(8) + "@foo { " + payload + "}";
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(TOKEN_LIMIT_ERROR);
});

test("token limit covers nested unknown at-rule preludes", () => {
  // Same as above with the payload in the prelude instead of the block.
  const payload = Buffer.alloc(6000, "x ").toString();
  const src = "x::part(a), y::part(b) {\n".repeat(8) + "@foo " + payload + ";";
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(TOKEN_LIMIT_ERROR);
});

test("small nested unknown at-rules below the token limit still compile for old targets", () => {
  const src = "x::part(a), y::part(b) {\n".repeat(2) + "@foo a b c { x y z }";
  expect(minifyTest(src, "", OLD_TARGETS)).toMatchInlineSnapshot(`"@foo a b c{x y z}@foo a b c{x y z}"`);
});

test("token limit covers env() index lists", () => {
  // `env(name i i i ...)` parses an unbounded Vec<i32> of indices that every
  // deep_clone reallocates; with the list uncounted the cap could be undershot
  // while the cloned Vec<i32> still reached gigabytes. 60,000 indices under
  // 8 two-selector levels charges 256 x 60,001 = ~15M > 1M.
  const indices = Buffer.alloc(120000, " 1").toString();
  const src = "x::part(a), y::part(b) {\n".repeat(8) + ".inner { --foo: env(x" + indices + ") }";
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(TOKEN_LIMIT_ERROR);
});

test("token limit covers a flat top-level rule split into many incompatible selectors", () => {
  // No nesting (multiplier == 1), but an N-selector list the targets can't
  // collapse into `:is()` is still partitioned into N rules that each
  // deep-clone the declaration block. Charged as copies = N x W.
  // :user-valid is unsupported everywhere; chrome 80 lacks :is(), so no
  // collapse. 2000 selectors x ~10,000 tokens = ~20M > 1M.
  const sels = Array.from({ length: 2000 }, (_, i) => `.s${i}:user-valid`).join(", ");
  const payload = Buffer.alloc(10000, "x ").toString();
  const src = sels + " { --foo: f(" + payload + "var(--x)) }";
  expect(() => minifyTest(src, "", OLD_TARGETS)).toThrow(TOKEN_LIMIT_ERROR);
});

test("a flat top-level single-selector rule with a large unparsed value is not charged", () => {
  // copies == 1: nothing is cloned, so nothing is charged regardless of W.
  const payload = Buffer.alloc(10000, "x ").toString();
  const src = ".s:user-valid { --foo: f(" + payload + "var(--x)) }";
  const out = minifyTest(src, "", OLD_TARGETS);
  expect(out).toContain("var(--x)");
});

test("a flat multi-selector rule with a large unparsed value is not charged when no targets are configured", () => {
  // No targets: `should_compile_selectors()` is false, `minify_style_arm`
  // never partitions, so nothing is cloned and nothing should be charged.
  const sels = Array.from({ length: 2000 }, (_, i) => `.s${i}`).join(", ");
  const payload = Buffer.alloc(10000, "x ").toString();
  const src = sels + " { --foo: f(" + payload + "var(--x)) }";
  const out = minifyTest(src, "");
  expect(out).toContain("var(--x)");
  expect(out.length).toBeLessThan(src.length + 100);
});

test("bun build reports an error instead of OOMing on deeply nested selectors with a large unparsed value", async () => {
  using dir = tempDir("css-token-expansion", {
    // 12 levels and a ~6000-token value: before the fix this allocated on the
    // order of a gigabyte of cloned TokenOrValue before reaching the selector
    // cap.
    "input.css": nestedWithLargeUnparsedValue(12, 3000),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", "out", "--minify"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch for a regression: before the fix this allocated past the
    // container's memory budget, so let the child terminate itself instead of
    // hanging the runner.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Must terminate on its own (reporting the token-expansion error), not be
  // SIGKILLed by the timeout or OOM-killed by the OS.
  expect({ signalCode: proc.signalCode, stderr, stdout, exitCode }).toMatchObject({
    signalCode: null,
    stderr: expect.stringContaining(TOKEN_LIMIT_ERROR),
    exitCode: 1,
  });
  expect(await Bun.file(`${dir}/out/input.css`).exists()).toBe(false);
});
