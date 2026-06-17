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

// Regression for a CSS-minifier output bomb found by fuzzing: a ~10 KB input
// drove the CSS printer to ~200 MB of output (peak ~1.6 GB RSS including the
// returned JS string and intermediate buffers) when compiling nesting for
// Safari 13, without tripping any existing limit.
//
// When the targets don't support nesting, every nested rule's selector
// prelude inlines the full parent chain (one ancestor's selector per nesting
// level). Minify's selector-expansion cap bounds how many rules the nesting
// expands into, but each of those rules still prints a prelude proportional
// to the nesting depth (the parser permits up to 512 levels). By stacking the
// multi-selector rules at the *bottom* of a long single-selector chain, the
// selector-expansion total stays under 65,536 rules while each of those rules
// prints a hundreds-of-levels-long prelude. The printer now bounds the total
// selector-prelude bytes emitted under a compiled-nesting context and errors
// out instead.

const NESTING_LIMIT_ERROR = "Maximum nesting expansion exceeded";

/** `pad` single-selector levels followed by `fork` levels of two incompatible
 * (custom-pseudo) selectors that must be partitioned into separate rules when
 * compiled for old targets. With the pad levels first the selector-expansion
 * multiplier stays 1 across them, so they contribute nothing to the
 * rule-count cap while still lengthening every printed prelude. */
function deepPadThenFork(pad: number, fork: number): string {
  return ".padding-selector {\n".repeat(pad) + ".a:-webkitx .a, .b:-webkitx .b {\n".repeat(fork) + "color: red;";
}

test.concurrent(
  "deep padding before the multi-selector split errors instead of emitting huge output",
  async () => {
    // 15 fork levels × 2 selectors = under 65,536 rules, so the rule-count cap
    // never fires; but each rule prints a ~7 KB prelude (400 single-selector
    // levels × ~17 bytes, plus the fork levels) — 32768 × ~7 KB ≈ 230 MB of
    // output before the fix.
    //
    // Runs in a subprocess: before the fix the printer emits the full ~230 MB
    // (tens of seconds in a debug build), so a regression is SIGKILL'd by the
    // kill switch below instead of hanging the runner.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { cssInternals } = require("bun:internal-for-testing");
        const css = ${JSON.stringify(deepPadThenFork(400, 15))};
        try {
          const r = cssInternals._test(css, "", { safari: (13 << 16) | (2 << 8) });
          console.log("OK " + r.length);
        } catch (e) {
          console.log("ERR " + e.message);
        }
      `,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout: stdout.trim(),
      exitCode,
      signalCode: proc.signalCode,
      panicked: stderr.includes("panic"),
    }).toEqual({
      stdout: "ERR " + NESTING_LIMIT_ERROR + " when compiling CSS nesting for the configured targets",
      exitCode: 0,
      signalCode: null,
      panicked: false,
    });
  },
  90_000,
);

test("the padded-then-forked reproduction still minifies with no targets", () => {
  // Without targets nesting is preserved, so the output stays linear.
  const out = minifyTest(deepPadThenFork(100, 15), "");
  expect(out).toContain("color:red");
  expect(out.length).toBeLessThan(20_000);
});

test("shallow padded-then-forked nesting still compiles for old targets", () => {
  // Well under the byte budget.
  const out = minifyTest(deepPadThenFork(20, 5), "", { safari: (13 << 16) | (2 << 8) });
  expect(out).toContain("color:red");
  expect(out.length).toBeLessThan(100_000);
});

test.concurrent(
  "deep padding before an @scope prelude errors instead of emitting huge output",
  async () => {
    // Same shape as the style-rule case above, but the leaf is an `@scope`
    // rule whose prelude contains `&`: `ScopeRule::to_css` serializes its
    // prelude with the enclosing `StyleContext`, so the `&` inlines the
    // full ~414-level ancestor chain per cloned `@scope` (2^14 clones from
    // the fork levels). The `@scope` prelude is charged against the same
    // byte budget as style-rule preludes.
    const css =
      ".padding-selector {\n".repeat(400) +
      ".a:-webkitx .a, .b:-webkitx .b {\n".repeat(14) +
      "@scope (& .x) { .y { color: red } }";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { cssInternals } = require("bun:internal-for-testing");
        const css = ${JSON.stringify(css)};
        try {
          const r = cssInternals._test(css, "", { safari: (13 << 16) | (2 << 8) });
          console.log("OK " + r.length);
        } catch (e) {
          console.log("ERR " + e.message);
        }
      `,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout: stdout.trim(),
      exitCode,
      signalCode: proc.signalCode,
      panicked: stderr.includes("panic"),
    }).toEqual({
      stdout: "ERR " + NESTING_LIMIT_ERROR + " when compiling CSS nesting for the configured targets",
      exitCode: 0,
      signalCode: null,
      panicked: false,
    });
  },
  90_000,
);

test("shallow @scope preludes under compiled nesting still serialize", () => {
  // A `&` in a `@scope` prelude under a few levels of compiled nesting
  // inlines the parent chain but stays well under the byte budget.
  const src = ".a { .b { @scope (& .x) to (& .y) { .z { color: red } } } }";
  const out = cssInternals._test(src, "", { safari: (13 << 16) | (2 << 8) });
  expect(out).toContain("@scope");
  expect(out).toContain(".a .b .x");
  expect(out).toContain("color: red");
});

test("a large realistic nested stylesheet does not trip the nesting byte bound", () => {
  // Many top-level rules, each with a few levels of single-selector nesting:
  // the total prelude bytes under a compiled-nesting context are linear in
  // the input size. This must not throw.
  let src = "";
  for (let i = 0; i < 4000; i++) {
    src += `.a${i} { .b${i} { .c${i} { --v${i}: 1 } } }\n`;
  }
  const out = minifyTest(src, "", OLD_TARGETS);
  expect(out.length).toBeGreaterThan(0);
  expect(out).toContain(".a3999 .b3999 .c3999");
});

// With no browser targets (or targets that support CSS nesting), nesting is
// preserved and the printer indents by 2 per level. The parser permits up to
// 512 levels of nesting, so the indentation counter overflowed its 8-bit
// storage at depth 128 — a panic in debug builds and wrong indentation in
// release builds.
test.concurrent(
  "indentation at the full permitted nesting depth does not overflow",
  async () => {
    // Runs in a subprocess: before the fix this panics the process in debug
    // builds ("attempt to add with overflow").
    const depth = 500;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { cssInternals } = require("bun:internal-for-testing");
        const depth = ${depth};
        const src = ".a {\\n".repeat(depth) + "color: red;\\n" + "}".repeat(depth);
        const out = cssInternals._test(src, "", undefined);
        // The innermost declaration is indented at 2 * depth spaces.
        const needle = "\\n" + Buffer.alloc(2 * depth, " ").toString() + "color: red";
        console.log(out.includes(needle) ? "OK" : "BAD-INDENT " + out.length);
      `,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, panicked: stderr.includes("overflow") }).toEqual({
      stdout: "OK",
      exitCode: 0,
      panicked: false,
    });
  },
  30_000,
);

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
