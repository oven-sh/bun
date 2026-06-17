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

// The selector-expansion cap counts expanded selectors, not the rule structs
// that partitioning materializes in memory. An input can stay under the
// count cap while the partition path (targets without `:is()`) deep-clones a
// large nested subtree at every level, growing the resident rule count
// exponentially. Shape: `partitionLevels` two-selector levels wrapping
// `siblings` single-selector rules whose declarations provide the per-rule
// byte weight. The expanded selector count stays under 65536 while the
// cloned-rule count passes the partition-clone cap.
function partitionArenaBlowup(partitionLevels: number, siblings: number): string {
  let css = "";
  // Safari 13.2 supports `:placeholder-shown` but not unprefixed `:autofill`,
  // so this list is incompatible and (since :is() is unsupported) partitioned.
  for (let i = 0; i < partitionLevels; i++) {
    css += ".foo:placeholder-shown .bar, .foo:-webkit-autofill .baz {\n";
  }
  const decl = Buffer.alloc(192, "x").toString();
  for (let i = 0; i < siblings; i++) {
    css += `.r${i} { --a: ${decl}; --b: ${decl}; color: red; border: 1px solid currentcolor; }\n`;
  }
  css += "}\n".repeat(partitionLevels);
  return css;
}

// Safari 13 does not support `:is()`, so incompatible selector lists are
// partitioned into one cloned rule per selector rather than wrapped.
const SAFARI_13_2 = { safari: (13 << 16) | (2 << 8) };

test("nested partition clones under the selector-count cap still error once too many rules are cloned", () => {
  // 11 partition levels (multiplier 2^11) wrapping 28 sibling rules charges
  // ~61K expanded selectors, under the 65536 count cap, but the
  // partition-clone budget fires well before that. Without it this
  // allocates hundreds of megabytes of cloned rule structs before printing.
  expect(() => prefixTest(partitionArenaBlowup(11, 28), "", SAFARI_13_2)).toThrow(LIMIT_ERROR);
});

test("a small partition-clone subtree under both caps still compiles for targets without :is()", () => {
  // Same shape with a tiny subtree: ~8K expanded selectors and a few MB of
  // cloned rules, well under both caps.
  const out = prefixTest(partitionArenaBlowup(11, 2), "", SAFARI_13_2);
  expect(out).toContain("color: red");
  expect(out.length).toBeLessThan(5_000_000);
});

// The exact shape that found the gap: a 9.5 KB input whose selector count
// charges ~61K (under the cap) but whose partition clones drove peak memory
// past ~250 MB. Run in a child so a regression only balloons the child's
// memory, not the test runner's.
test.concurrent(
  "fuzzed nested partition-clone input errors instead of ballooning memory (safari 13.2)",
  async () => {
    const fixture = `
      const b64 = "H4sIAAAAAAACA+1azW7jNhBurwXyDsQuAliFqZUsWbblWxcIUPTWF2hpibJZU6RK0bGTIEAeZY899t5Diz5K70UfIR1KVmInztqO7MQbWIAtivpmhj+a+Uak7ETKMPvn5jdOIjqSPKYK5yM5FcgeENVEtrmPp3QwZhqTiZYJ49zcu0RX39gvIpxRlWc00uycVlLb2AujEY3GNK7sIjh2auDLVlwd+6xGKCUzzARnguKcXdIQfS8SJpi+wLgq3VYFie8rsfuT4zhP/UQ269cx5HZ9P+j4vtPxOk6v3XYDt31UuYXKo93HoJO38ziY4DGP1E+dKnsDqUzoGUitZRqiSHKpGjHLIS5d4MxDdq/T6gUthG0vaDmdLrK7jt9yAqv/9lSgUipEPBo12o7d63VPkeu1QcJDntddgF7flTISmxhNOBsKnFOeXH3ulhn9Ky2zMCI8amD3W5jvhq9o2uyeTy3rep2sId77OH1bIKOVSHSFMI62rZf8399vzBAUI4FTNmswYcajiTQlHPWOx1s4XmYef94YedpEkkNSZPXBs6qsJ+F0Bn9yGiIlp/e+J8+pMtX4Ivzvjz+RSY6qkIfmDh+iAqCk1KCwdDpFRM40kwLrlIkhTiYi0qAAasJc0yxv3EXYv24SOJpUxAsemUg6G4WIzjISxjQhE65xrhXV0bxWxDTuH+Hbw9egt7+xVXOKDBwzTdMcwh4VmirE6ZBEF3BK9D2wei4HcoalYhuJVGDAhGgEhUspIPSuVhozZd4N4HlEQqp0M5iSExE30p3qPMIOBlbErjIteZTSuMhuI8e63iHozod4RoYUDxQlYzygiVSULrUPVExSseB0JlhPFclCZP4P5MY8KZwn1BDPQ+RmM5QD2cRImSiQyZIU5vyxwBIxXV1b0EvbcdIcqOVz4kvAAgCIRJpIUM5udQIMkjRmk/QD8NG88uOIqEgSvmVpuWJAovGwiBA44ixbL1CVYHlnI9yuSz9sgCuLt3tpw0ZAVs/Iy4i8XKm2psI5R5QNR3oPrZwqcEjI91IZ04Mex3Wl2ip+2Qh3svq2pjONzQgqUsS3gkN218PXGNO1oF/XqAhDkkDut78WlvxVXfcrHjkQGgk5yTWORozHh8soH5/HKD/W1k0ES8FVxDwV2JxgFkZb0YwSXZtxXmU463FsvUhv3APDDAwnJos1CwaKxbQEizqGFuZmwCGfLFjlYBjgdmNti6F8CxL4kkoQcGoqWngFKuL8RnInz2aVr55JK3tloBXcUy2Sm3wNx0SNG+/PvjtrIu/s7MyaX59V10+LFaHNuKtJ/4jCQ0Vis07SOMq8ikxK8nGIJoo3TCm38/Ph+1wTZRVrWugDcgN4dS5V4YvmA2QEFMWphZQxacBbQBf17rg9u+rNHptojJwsWRkCWWFYXITVGU1xudKS1zb996enepit6OH9nliR+OcjEpuFeLcFsOKPk0HDd05RO7AD5PWs/nLLtpZ+uGSTQvAtO/gugUBkiNfOxPCdhVqu3/G7XuB3ke+g4rsIaL+zuJdaS0mdD1z2/1nMU99p5LBOV/TauP2ykxfbmYHdcortzMDuBMgPbM9tWc1yq9OttjlhLhwXzr4FI9SGEfFgP9kMTKuctjyDlvZf0PanurYfa//6Ydcq3Qj8jAkiFq08XFn8H8dTrmx3JQAA";
      const c = require("bun:internal-for-testing").cssInternals;
      const i = Buffer.from(Bun.gunzipSync(Buffer.from(b64, "base64"))).toString("latin1");
      const targets = { safari: (13 << 16) | (2 << 8) };
      for (const fn of [c._test, c.prefixTest]) {
        let threw = false;
        try {
          fn(i, "", targets);
        } catch (e) {
          threw = true;
          if (!String(e.message).includes("Nested CSS rules expand to more than")) {
            console.error("WRONG ERROR:", e.message);
            process.exit(2);
          }
        }
        if (!threw) {
          console.error("DID NOT THROW");
          process.exit(3);
        }
      }
      // minifyTest has no targets, so nothing is expanded and nothing should throw.
      const p = c.minifyTest(i, "");
      if (typeof p !== "string" || p.length === 0) {
        console.error("minifyTest returned", typeof p, p && p.length);
        process.exit(4);
      }
      console.log("OK");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
      // Kill switch: before the fix this allocated hundreds of megabytes in
      // each of `_test` and `prefixTest`. Let the child terminate itself so
      // a regression fails the assertions below instead of hanging the
      // runner.
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr: stderr.trim(), signalCode: proc.signalCode, exitCode }).toEqual({
      stdout: "OK",
      stderr: "",
      signalCode: null,
      exitCode: 0,
    });
  },
);

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
