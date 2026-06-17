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

// ─── byte-based expansion cap (MAX_NESTING_COMPILED_BYTES) ──────────────────
//
// MAX_SELECTOR_EXPANSION caps how many rule *copies* the incompatible-selector
// split may produce, but each copy carries the rule's full declaration block.
// A leaf with a multi-kilobyte unparsed value cloned a few thousand times
// stays well under the selector-count cap while expanding a few kilobytes of
// input into hundreds of megabytes of output. Fuzzer signature sampled during
// the resulting serialization: `dtoa_short_impl | CSSNumberFns::to_css`.

const BYTES_LIMIT_ERROR = "Maximum nesting expansion exceeded";

// Safari 13.2 doesn't support native nesting or `:is()`, so nested selector
// lists containing an implicit `&` are split into one cloned rule per selector.
const SAFARI_13_2 = { safari: (13 << 16) | (2 << 8) };

function nestedWithBigLeaf(depth: number, bigBytes: number): string {
  let src = "";
  for (let i = 0; i < depth; i++) src += "o::part(header), .foo::part(body) {\n";
  src += ".leaf { border-right-color: lab(40% 56.6 39); --big: " + Buffer.alloc(bigBytes, "x").toString() + "; }\n";
  return src;
}

test(
  "nested rules with a large declaration block error instead of exploding when compiled for old targets",
  () => {
    // 14 levels of 2-selector ::part() lists = 8192 leaf copies (under the
    // 65536 selector cap) × ~10 KB declaration block each ≈ 85 MB output.
    // Before the byte cap this returned the full 85 MB string.
    const src = nestedWithBigLeaf(14, 10_000);
    expect(() => minifyTest(src, "", SAFARI_13_2)).toThrow(BYTES_LIMIT_ERROR);
  },
  // Serializing up to the 64 MB byte cap (or the full 85 MB on a regression)
  // takes ~3-4 s under a debug+ASAN build.
  30_000,
);

test(
  "all css test-internals entry points bound the nesting-compiled byte output",
  async () => {
    // Cover `_test` and `prefixTest` in a subprocess so a regression fails the
    // assertions below instead of stalling the runner while each endpoint
    // serializes ~85 MB.
    const script = `
      const c = require("bun:internal-for-testing").cssInternals;
      let input = "";
      for (let i = 0; i < 14; i++) input += "o::part(header), .foo::part(body) {\\n";
      input += ".leaf { border-right-color: lab(40% 56.6 39); --big: " + Buffer.alloc(10000, "x").toString() + "; }\\n";
      for (const fn of ["_test", "prefixTest"]) {
        try {
          const out = c[fn](input, "", { safari: (13 << 16) | (2 << 8) });
          console.log(fn, "length", out.length);
        } catch (e) {
          console.log(fn, "threw", e.message);
        }
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, signalCode: proc.signalCode }).toMatchObject({ signalCode: null });
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line).toContain("threw");
      expect(line).toContain(BYTES_LIMIT_ERROR);
    }
    expect(exitCode).toBe(0);
  },
  90_000,
);

test("nested rules with a large declaration block stay below the byte cap at moderate depth", () => {
  // 10 levels × 2 selectors = 512 leaf copies × ~10 KB ≈ 5 MB output; fine.
  const src = nestedWithBigLeaf(10, 10_000);
  const out = minifyTest(src, "", SAFARI_13_2);
  expect(out).toContain("--big:");
  expect(out.length).toBeLessThan(10_000_000);
});

test("deeply nested rules with small declarations stay below the byte cap", () => {
  // 14 levels × 2 selectors = 8192 leaf copies with a tiny declaration; a few
  // MB of output, well under the byte cap (and still under the selector cap).
  const src = nestedWithBigLeaf(14, 100);
  const out = minifyTest(src, "", SAFARI_13_2);
  expect(out).toContain("--big:");
  expect(out.length).toBeLessThan(10_000_000);
});

test("large declarations are not bounded when nesting is preserved", () => {
  // Without targets nothing is compiled away, so the output stays linear and
  // the byte cap doesn't apply.
  const src = nestedWithBigLeaf(14, 100_000);
  const out = minifyTest(src, "");
  expect(out).toContain("--big:");
  expect(out.length).toBeLessThan(200_000);
});

test(
  "bun build does not write gigabyte output for nested rules with large declarations",
  async () => {
    using dir = tempDir("css-nesting-big-decl", {
      // 50 KB input → ~825 MB bundled output before the byte cap.
      "input.css": nestedWithBigLeaf(14, 50_000),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "input.css", "--outdir", "out", "--minify"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      // Kill switch: before the byte cap this wrote ~825 MB; let the child
      // terminate itself so a regression fails below instead of filling the
      // disk.
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Must terminate on its own, not be SIGKILLed by the timeout.
    expect({ stderr, stdout, signalCode: proc.signalCode }).toMatchObject({ signalCode: null });
    // The printer bails once the byte cap is exceeded; the bundler may not
    // surface the PrinterError message, but it must not write the runaway
    // output. Assert the output file (if any) is bounded well below what a
    // single unbounded level would produce.
    const outFile = Bun.file(`${dir}/out/input.css`);
    const size = (await outFile.exists()) ? outFile.size : 0;
    expect(size).toBeLessThan(70_000_000);
    void exitCode;
  },
  90_000,
);

test("fuzzer reproduction does not hang the css printer", async () => {
  // 15 813-byte fuzzer input that expanded to ~145 MB of output under `_test`
  // with Safari 13.2 targets (sampled inside `CSSNumberFns::to_css` during
  // serialization). Run it in a subprocess so a regression fails the timeout
  // assertion instead of hanging the runner.
  const blob =
    "H4sIAAAAAAACA+2bT2/bNhTAd+2AfIGeHjAEsAszlSz/aWSshyYxkK0zmnRZMaAXSqJkLjQpULRlxwiQb7Cv0GP7GXYIsI/Se9HL7hklRU2TzqkzJ0PsUTxQId/jj+Z75iPix6fw1JSlK7O7Xi88wl2q3lVhNFEoURNGEB3giHwpcj+ss6rlw5uTpZv0g+Ve87P/EBaLhCoquNlt70ogZGSMIinSxWYaCp7tg5Iov3+l7883Jm4uXNZuc7CRoD5BIR5QNrn3k/3XZW1OwYhwIqmP8lXREZ2EKsUySABAuG6Mpar0CQ6IrNZgIxRZm0+4IjLr8UQwqcL029my+MuW+fQupP76/fT0kiQw8KE/v/x9lsyaYZpvIC5wIQeYldUuDymnapIQhTwm/EO9w2h1F1DZE487egD3LBT+8EEixNQTUtNQSgPVd22CnLoDFtjx+Pg6uSeNRqvdaFhtp21tNpt2y25+Xcu6kUj+IXESE18hiXVMc6GZTa8Bj8EBPFQCVknMw/6hjipDHmhrpcQ7pFqHxESr8QgxygmWOuzggOqvUmVCGBMp2FY8roHHhgSa+rW65Cvy/uTtJ8nbcaLVE8lWUG8WxVM6iifGKDuXuGB3LjoH4mhWT5I3ouK0OCKXe88HLQ8636SXuj+df/JWY6iFbDmVQmFFXC44mUvpzkLP+5N3tzzsTc8fM3xbkbE+KNMjgnDw2zDJYx4nnfKrUFajAeXF9uILJqQLW5DVaEDHFcqBDPqpB0zwiEhY6w9J7cXeQffF851eNtdnewc/tfcPuts/03FPt/ee7/yyfbATJS+t7rP9I7W93+3u7dL0x62XPwx/fWUzf7Lb2u2qYItb38Ojxwa/3Pjcx8SIyFBH1f/l4rsizv5tgJnxQYM3eIM3+PuIPzOrb/DX4V8Pp7Zt6efYmMHgDd7gb47/+MepnsGsd2MXgzd4gzd4gzf4RfHL9XmmxpwGb/AGb/DLgp+a1Tf4lcTnP9oGxBd5IhEvLhUYixi8wRv8QviLH1GMGQze4OfFg26oWOOweGKqr7YUr1GW2utY69Cw1quFmONYAYkgb4T1apa6XGb+DXA9ohxRnmU9I51aGFJ9WzAhTGcNa7w3xFxfHcxjfkAYnkRK6QtP08/05bn+P2pfkS7TvlAqcXyhWqA7X1G+Kj8Lhl2G9b1Hv09ZQJS+CjEtllSS4HjmYA/zwdbKtGklYhd8zPyKtkulh3uSDGrn6dOjtAYN/XcVHgGyP8sDXymleVNDS7nzFFpJo75e+8KHv/P0DYe6UwjF/qW+vKoE1BWcTQpjJbF2MBQ7sNFqaJd9Ahv2Zr3RbOq61W7b9er1NIa9ivZ5aLY2WuBsVjt/A6/0pDbFPQAA";
  const script = `
    const c = require("bun:internal-for-testing").cssInternals;
    const i = Buffer.from(Bun.gunzipSync(Buffer.from(${JSON.stringify(blob)}, "base64"))).toString("latin1");
    if (i.length !== 15813) throw new Error("bad blob decode: " + i.length);
    let p;
    try { p = c.minifyTest(i, "") } catch {}
    try { c._test(i, "", { safari: (13 << 16) | (2 << 8) }) } catch {}
    try { c.prefixTest(i, "", { safari: (13 << 16) | (2 << 8) }) } catch {}
    try { if (typeof p === "string" && p.length) c.minifyTest(p, "") } catch {}
    console.log("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "0" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, signalCode: proc.signalCode }).toMatchObject({
    stdout: "ok\n",
    signalCode: null,
  });
  expect(exitCode).toBe(0);
}, 90_000);
