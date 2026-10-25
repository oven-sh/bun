import { cssInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// Minifying n adjacent rules with equivalent selectors used to re-run the
// property handlers over the whole accumulated declaration list once per
// merged rule. Handlers that emit one output declaration per input
// declaration (custom properties, color-scheme, prefixed background images,
// ...) keep that list O(n) long, so minification was O(n^2) — and O(n^3) for
// color-scheme with targets lacking light-dark() support, whose handler
// re-expands its own output on every pass. A few thousand duplicate
// declarations were enough to hang the minifier for minutes. The same shape
// existed on the selector side: selector merges re-walked every accumulated
// selector per merged rule.
//
// Fuzzer-found. The embedded input below is the minimized fuzzer testcase;
// the synthetic floods pin the general fix for each affected handler family.
// Sizes are chosen so the old super-linear behavior cannot finish within the
// spawn timeout (2000 color-scheme rules took >6 minutes in a release build)
// while the linear implementation finishes in well under a second.

const fuzzerInputGzipBase64 =
  "H4sIAAAAAAAC/92ST4rbMBjF93OKr4uAXKwgxf89hxlkxXZFLcl8lpM0YcA36BW67B26yF3ademmB6inHeIxZAaamaHQJyx+Nu99Aj0vxUGZrnS5bIRuCaU8DcM4CUOWBAnLoojHPNposfMhYgsfOGN3b97t1XKe5P/I9HX4/HonSttYzMf9B1KtdkQZ6LAuaKNMKdAHLNc+FE1fAr9hjD32mIU3m2Zn04Yz4wL2Zz0ZfDoH96JU9p2zOodGFCRkC4jiZQxB5sEbpVuLThh3fc4u/84u/mv77cVFXJyrrIUDuG/DYNscpMjzSmHnaFM6V2IjiVaG0Gy1CoJkxYI4jcIkiVI292W0Ep1jl2hrcU27Vkhl6rOGnx+PR/YCKqwbe2AvLI6l9iHdbH0IR/TgLVDujU2KXHUkb4SpiSg9H+4RH6C84++fht+/Br0q9urBvWcnXm9OKQigk+T8R29gqj+hbhH3WNkJK5yaO+mLv+uH/Q1yfAyq6aRacU8UOBalOHkmS2kMFKbHsiST5sb3k58bHR+lgy2/tk7XHyi271zbCEtrY/s8PeAvBEe7JGUGAAA=";

const script = `
  const c = require("bun:internal-for-testing").cssInternals;

  const input = Buffer.from(
    Bun.gunzipSync(Buffer.from(${JSON.stringify(fuzzerInputGzipBase64)}, "base64")),
  ).toString("latin1");
  let p;
  try { p = c.minifyTest(input, ""); } catch {}
  try { c._test(input, "", { chrome: 80 << 16 }); } catch {}
  try { c.prefixTest(input, "", { chrome: 80 << 16 }); } catch {}
  if (typeof p === "string" && p.length) { try { c.minifyTest(p, ""); } catch {} }
  console.log("OK:fuzzer-input");

  const n = 2000;
  const repeat = rule => Buffer.alloc(n * rule.length, rule).toString();
  const floods = {
    "color-scheme-dark": [repeat(".a{color-scheme:dark}"), { chrome: 80 << 16 }],
    "color-scheme-light-dark": [repeat(".a{color-scheme:light dark}"), undefined],
    "webkit-gradient": [
      repeat(".a{background:-webkit-gradient(linear,left top,left bottom,from(red),to(blue))}"),
      undefined,
    ],
    "clamp": [repeat(".a{inset:clamp(1vmax,50%,100vmax)}"), { chrome: 80 << 16 }],
    "distinct-custom-props": [
      Array.from({ length: n }, (_, i) => \`.a{--x\${i}:\${i}}\`).join(""),
      undefined,
    ],
    "scattered-custom-props": [
      Array.from({ length: n }, (_, i) => \`:root{--x\${i}:\${i}}.q\${i}{z-index:9}\`).join(""),
      undefined,
      // Each rule declares a different custom property, so none is a duplicate.
      out => ":" + (out.split(":root{").length - 1),
    ],
    "distinct-selectors": [
      Array.from({ length: n }, (_, i) => \`.a\${i}{color:red}\`).join(""),
      { chrome: 80 << 16 },
    ],
  };
  for (const [name, [src, targets, count]] of Object.entries(floods)) {
    const out = targets === undefined ? c.minifyTest(src, "") : c._test(src, "", targets);
    if (typeof out !== "string" || out.length === 0) throw new Error(name + " produced no output");
    console.log("OK:" + name + (count ? count(out) : ""));
  }
`;

test("duplicate declarations across merged rules minify in linear time instead of hanging", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Benign debug/ASAN startup noise on stderr is tolerated; real failures
  // (JS errors, Rust panics/asserts, crash banners, ASAN reports) surface in
  // the failure diff.
  expect({ stdout, stderr: /error|panic|assert|crash|abort/i.test(stderr) ? stderr : "", exitCode }).toEqual({
    stdout: [
      "OK:fuzzer-input",
      "OK:color-scheme-dark",
      "OK:color-scheme-light-dark",
      "OK:webkit-gradient",
      "OK:clamp",
      "OK:distinct-custom-props",
      "OK:scattered-custom-props:2000",
      "OK:distinct-selectors",
      "",
    ].join("\n"),
    stderr: "",
    exitCode: 0,
  });
}, 90_000);

// The deferred re-minify must keep producing the same output the per-merge
// re-minify did for merge runs that interact with the handler context or the
// merge-with-previous cascade.
test("deferred merge re-minify keeps per-merge output", () => {
  // The merged-in rule stages dark-mode fallback vars; its re-minify stages
  // them again, and both sets belong in this rule's @media extras. The
  // deferred flush must run before the extras are collected (and must not
  // assert or leak the re-staged entries into a later rule's extras).
  expect(cssInternals._test(".a{color:red}.a{color-scheme:light dark}", "", { chrome: 80 << 16 })).toBe(
    ".a {\n" +
      "  color: red;\n" +
      "  --buncss-light: initial;\n" +
      "  --buncss-dark: ;\n" +
      "  --buncss-light: initial;\n" +
      "  --buncss-dark: ;\n" +
      "  color-scheme: light dark;\n" +
      "}\n" +
      "\n" +
      "@media (prefers-color-scheme: dark) {\n" +
      "  .a {\n" +
      "    --buncss-light: ;\n" +
      "    --buncss-dark: initial;\n" +
      "    --buncss-light: ;\n" +
      "    --buncss-dark: initial;\n" +
      "  }\n" +
      "}\n",
  );

  // A merge run ended by a non-merging style rule still cascades: after the
  // .a rules merge and re-minify to [color:blue], .a collapses into .x.
  expect(cssInternals.minifyTest(".x{color:blue}.a{color:red}.a{color:blue}.b{font-style:italic}", "")).toBe(
    ".x,.a{color:#00f}.b{font-style:italic}",
  );

  // That run-end cascade can itself start a new declaration merge (the
  // selector merge of .b into .a makes the pair's selectors equal .a,.b),
  // which must be settled before the next rule is pushed on top of it.
  expect(
    cssInternals.minifyTest(".a,.b{color:red}.a{color:blue}.b{color:green}.b{color:blue}.c{font-style:italic}", ""),
  ).toBe(".a,.b{color:#00f}.c{font-style:italic}");
});

// The merge-with-previous cascade used to pop rules without purging their
// indices from the duplicate-rule table, so a rule pushed into a reused slot
// could match its own stale table entry and erase itself: this input used to
// minify to ".a,.b{color:#00f}", silently dropping .a{color:purple} and
// changing the computed color of .a elements.
test("stale duplicate-rule entries do not erase a later rule", () => {
  expect(
    cssInternals.minifyTest(".a,.b{color:red}.a{color:blue}.b{color:green}.b{color:blue}.a{color:purple}", ""),
  ).toBe(".a,.b{color:#00f}.a{color:purple}");
});

// A stale entry could also point at a different rule pushed into the reused
// slot. The cascade pops the merged .q rule out of slot 1 (it merges into .a),
// the rule with the nested .n takes slot 1, and the last .q{color:blue}
// matched the stale index: both inputs used to drop ".q .n{color:green}".
test("stale duplicate-rule entries do not erase a rule that has nested rules", () => {
  expect(
    cssInternals.minifyTest(".a{color:red}.q{color:blue}.q{color:red}.q{color:red;.n{color:green}}.q{color:blue}", ""),
  ).toBe(".a,.q{color:red}.q{color:red;& .n{color:green}}.q{color:#00f}");

  // Here .q{font-style:italic} merges into the slot 1 rule after the table
  // recorded it, so the popped rule no longer hashes to its table entry.
  expect(
    cssInternals.minifyTest(
      ".a{color:blue;font-style:italic}.q{color:blue}.q{font-style:italic}.q{color:red;.n{color:green}}.q{color:blue}",
      "",
    ),
  ).toBe(".a,.q{color:#00f;font-style:italic}.q{color:red;& .n{color:green}}.q{color:#00f}");
});

// When target-incompatible selectors are partitioned out of a rule whose
// remaining selectors then declaration-merge into the previous rule, the
// rules built for the incompatible selectors must clone the declarations
// from before the merge drains them. Chrome 60 supports neither :is() nor
// :focus-visible, so the selector list splits; this used to emit only
// ".a { color: #00f }" and silently drop the .b:focus-visible styling.
test("declaration merges do not drop partitioned incompatible selectors", () => {
  expect(cssInternals._test(".a{color:red}.a,.b:focus-visible{color:blue}", "", { chrome: 60 << 16 })).toBe(
    ".a {\n  color: #00f;\n}\n\n.b:focus-visible {\n  color: #00f;\n}\n",
  );
});

// `is_duplicate` compared every custom property as the same property id, so
// a later same-selector rule declaring the same *count* of custom properties
// erased the earlier one and every variable it defined. The rules below are
// separated by an unrelated rule so the adjacent-merge path cannot hide the
// deletion.
test("duplicate-rule detection distinguishes custom property names", () => {
  expect(cssInternals._test(":root{--a:1}.q{z-index:9}:root{--b:2}", "")).toBe(
    ":root {\n  --a: 1;\n}\n\n.q {\n  z-index: 9;\n}\n\n:root {\n  --b: 2;\n}\n",
  );
  expect(cssInternals._test(".card{--pad:4px;--bg:#fff}.x{color:red}.card{--radius:2px;--fg:#000}", "")).toBe(
    ".card {\n  --pad: 4px;\n  --bg: #fff;\n}\n\n" +
      ".x {\n  color: red;\n}\n\n" +
      ".card {\n  --radius: 2px;\n  --fg: #000;\n}\n",
  );
  // The same custom property name with another value: both rules stay.
  expect(cssInternals.minifyTest(":root{--a:1}.q{z-index:9}:root{--a:2}", "")).toBe(
    ":root{--a:1}.q{z-index:9}:root{--a:2}",
  );
  // Unknown (non-dashed) property names must also be distinguished.
  expect(cssInternals.minifyTest(".a{foo:1}.q{z-index:9}.a{bar:2}", "")).toBe(".a{foo:1}.q{z-index:9}.a{bar:2}");
  // https://github.com/oven-sh/bun/issues/44704: Chrome 80 has no `:where()`,
  // so these neighbours do not merge and reach the duplicate check.
  expect(cssInternals.minifyTest(":where(.x){--a:1}:where(.x){--b:2}", "", { chrome: 80 << 16 })).toBe(
    ":where(.x){--a:1}:where(.x){--b:2}",
  );
  expect(cssInternals.minifyTest(":where(.x) .y{--a:1}:where(.x) .y{--b:2}", "", { chrome: 80 << 16 })).toBe(
    ":where(.x) .y{--a:1}:where(.x) .y{--b:2}",
  );
  expect(cssInternals.minifyTest(":where(.x){--a:1}:where(.x){--a:2}", "", { chrome: 80 << 16 })).toBe(
    ":where(.x){--a:1}:where(.x){--a:2}",
  );
  // The same in the `!important` list.
  expect(cssInternals.minifyTest(".z{--a:1 !important}.q{z-index:9}.z{--b:2 !important}", "")).toBe(
    ".z{--a:1!important}.q{z-index:9}.z{--b:2!important}",
  );
});

// `is_duplicate` compared the *total* declaration count but then zipped the
// normal and !important lists separately, so a 1-normal rule matched a
// 1-important rule and the !important winner was deleted, flipping the
// cascade.
test("duplicate-rule detection respects the normal/!important split", () => {
  expect(cssInternals._test(".z{color:red !important}.q{z-index:9}.z{color:blue}", "")).toBe(
    ".z {\n  color: red !important;\n}\n\n.q {\n  z-index: 9;\n}\n\n.z {\n  color: #00f;\n}\n",
  );
  expect(cssInternals.minifyTest(".z{color:red;top:0 !important}.q{z-index:9}.z{color:blue;top:1px}", "")).toBe(
    ".z{color:red;top:0!important}.q{z-index:9}.z{color:#00f;top:1px}",
  );
  // Reversed order: the rules differ in importance, so neither is a duplicate
  // of the other. Both stay, as in lightningcss after 93b9e66.
  expect(cssInternals._test(".z{color:red}.q{z-index:9}.z{color:blue !important}", "")).toBe(
    ".z {\n  color: red;\n}\n\n.q {\n  z-index: 9;\n}\n\n.z {\n  color: #00f !important;\n}\n",
  );
  // Mixed: (normal,important) vs (important,normal) for different properties.
  expect(
    cssInternals.minifyTest(".z{color:red;top:0 !important}.q{z-index:9}.z{top:1px;color:blue !important}", ""),
  ).toBe(".z{color:red;top:0!important}.q{z-index:9}.z{top:1px;color:#00f!important}");
  // The same split and the same properties with another value: both rules stay.
  expect(cssInternals.minifyTest(".z{color:red !important}.q{z-index:9}.z{color:blue !important}", "")).toBe(
    ".z{color:red!important}.q{z-index:9}.z{color:#00f!important}",
  );
  // The lightningcss tests for 93b9e66 (test_duplicate_rules_preserve_importance).
  // The first one passes without the fix: in bun an at-rule between two style
  // rules stops the duplicate check.
  expect(
    cssInternals.minifyTest(".x { --c: first !important } @layer a { .y { --c: middle } } .x { --c: last }", ""),
  ).toBe(".x{--c:first!important}@layer a{.y{--c:middle}}.x{--c:last}");
  expect(cssInternals.minifyTest(".x { color: red !important } .y { color: green } .x { color: blue }", "")).toBe(
    ".x{color:red!important}.y{color:green}.x{color:#00f}",
  );
  // The first one again, with a style rule in place of the at-rule.
  expect(cssInternals.minifyTest(".x{--c:first !important}.y{--c:middle}.x{--c:last}", "")).toBe(
    ".x{--c:first!important}.y{--c:middle}.x{--c:last}",
  );
});

// Ids that differ only in the vendor prefix have the same hash, so these pairs
// reach the comparison of each declaration list.
test("duplicate-rule detection compares the ids of both declaration lists", () => {
  expect(cssInternals.minifyTest(".z{-webkit-transition:opacity 1s}.q{z-index:9}.z{transition:opacity 2s}", "")).toBe(
    ".z{-webkit-transition:opacity 1s}.q{z-index:9}.z{transition:opacity 2s}",
  );
  expect(
    cssInternals.minifyTest(
      ".z{-webkit-transition:opacity 1s !important}.q{z-index:9}.z{transition:opacity 2s !important}",
      "",
    ),
  ).toBe(".z{-webkit-transition:opacity 1s!important}.q{z-index:9}.z{transition:opacity 2s!important}");
  // The same prefix with another value: both rules stay.
  expect(
    cssInternals.minifyTest(".z{-webkit-transition:opacity 1s}.q{z-index:9}.z{-webkit-transition:opacity 2s}", ""),
  ).toBe(".z{-webkit-transition:opacity 1s}.q{z-index:9}.z{-webkit-transition:opacity 2s}");
});

// A later rule erased an earlier rule of the same rule list when both had the
// same selectors and the same property ids. The values and the vendor prefixes
// were not compared, so a rule that holds the value for older browsers was
// lost: ".a{height:100vh}.z{top:0}.a{height:100dvh}" minified to
// ".z{top:0}.a{height:100dvh}". Only a rule that a later rule repeats in full
// is erased now.
describe("a later rule erases an earlier rule only when it repeats that rule", () => {
  const chrome80 = { chrome: 80 << 16 };
  // The targets of `bun build --target=browser`.
  const browser = { chrome: 80 << 16, edge: 80 << 16, firefox: 78 << 16, safari: 14 << 16, opera: 67 << 16 };
  type Targets = typeof chrome80 | typeof browser;
  const minify = (source: string, targets?: Targets) => cssInternals.minifyTest(source, "", targets);
  const minifyAll = (sources: string[], targets?: Targets) =>
    Object.fromEntries(sources.map(source => [source, minify(source, targets)]));

  // Each of these prints as written, with browser targets and with none.
  const printedAsWritten = [
    ".a{height:100vh}.z{top:0}.a{height:100dvh}",
    ".a{display:-webkit-box}.z{top:0}.a{display:flex}",
    ".a{position:-webkit-sticky}.z{top:0}.a{position:sticky}",
    ".a{overflow:hidden}.z{top:0}.a{overflow:clip}",
    ".a{width:10px}.z{top:0}.a{width:10cqw}",
    ".a{border-radius:8px}.z{top:0}.a{border-radius:1dvh 8px}",
    ".a{transition:fill .2s}.z{top:0}.a{transition:fill .3s}",
    ".a{background:url(a.png)}.z{top:0}.a{background:url(b.png)}",
    ".a{foo:1}.z{top:0}.a{foo:2}",
    ".a{--x:1}.z{top:0}.a{--x:2}",
    // The second rule is not the last rule with these properties.
    ".a{color:red}.z{top:0}.a{color:green}.y{top:0}.a{color:red}",
    // Inside at-rules.
    "@media print{.a{height:100vh}.z{top:0}.a{height:100dvh}}",
    "@supports (top:0){.a{height:100vh}.z{top:0}.a{height:100dvh}}",
    "@layer x{.a{height:100vh}.z{top:0}.a{height:100dvh}}",
    "@starting-style{.a{height:100vh}.z{top:0}.a{height:100dvh}}",
    "@-moz-document url-prefix(){.a{height:100vh}.z{top:0}.a{height:100dvh}}",
    // An at-rule between two equal rules is a barrier.
    ".a{color:red}@media print{.z{top:0}}.a{color:red}",
  ];
  const asWritten = Object.fromEntries(printedAsWritten.map(source => [source, source]));

  test("rules with other values stay, with browser targets", () => {
    expect(minifyAll(printedAsWritten, browser)).toEqual(asWritten);
  });

  test("rules with other values stay, with no targets", () => {
    expect(minifyAll(printedAsWritten)).toEqual(asWritten);
  });

  test("in a nested rule list, in merged @media rules and in a container or scope rule", () => {
    const cases = {
      ".p{.a{height:100vh}.z{top:0}.a{height:100dvh}}": ".p{& .a{height:100vh}& .z{top:0}& .a{height:100dvh}}",
      "@media print{.a{height:100vh}.z{top:0}}@media print{.a{height:100dvh}}":
        "@media print{.a{height:100vh}.z{top:0}.a{height:100dvh}}",
      "@container (width>=1px){.a{height:100vh}.z{top:0}.a{height:100dvh}}":
        "@container (width>=1px){.a{height:100vh}.z{top:0}.a{height:100dvh}}",
      "@scope (.s){.a{height:100vh}.z{top:0}.a{height:100dvh}}":
        "@scope(.s){.a{height:100vh}.z{top:0}.a{height:100dvh}}",
    };
    expect(minifyAll(Object.keys(cases))).toEqual(cases);
  });

  // Chrome 80 has no `:where()`, so these adjacent rules do not merge.
  test("when the targets do not support the selector", () => {
    const cases = {
      ":where(.a){height:100vh}:where(.a){height:100dvh}": ":where(.a){height:100vh}:where(.a){height:100dvh}",
      ".p{.a{height:100vh}.z{top:0}.a{height:100dvh}}": ".p .a{height:100vh}.p .z{top:0}.p .a{height:100dvh}",
    };
    expect(minifyAll(Object.keys(cases), chrome80)).toEqual(cases);
  });

  // A rule prints once for each of its vendor prefixes. `.a::-moz-selection`
  // and `.a::selection` merge into one rule with two prefixes, or with one
  // when no target needs `-moz-`.
  test("a rule stays when the later rule does not print each of its vendor prefixes", () => {
    const prefixedFirst = ".a::-moz-selection{color:red}.z{top:0}.a::-moz-selection{color:red}.a::selection{color:red}";
    const prefixedLast = ".a::-moz-selection{color:red}.a::selection{color:red}.z{top:0}.a::-moz-selection{color:red}";
    const any =
      ".a:-webkit-any(.b,.c){color:red}.a:-moz-any(.b,.c){color:red}.z{top:0}" +
      ".a:-webkit-any(.b,.c){color:red}.a:-moz-any(.b,.c){color:red}.a:is(.b,.c){color:red}";
    expect({
      none: minifyAll([prefixedFirst, prefixedLast]),
      chrome80: minifyAll([prefixedFirst, prefixedLast, any], chrome80),
      browser: minifyAll([any], browser),
    }).toEqual({
      none: {
        // The later rule prints `::-moz-selection` and `::selection`.
        [prefixedFirst]: ".z{top:0}.a::-moz-selection{color:red}.a::selection{color:red}",
        [prefixedLast]: prefixedLast,
      },
      chrome80: {
        // The later rule prints only `::selection`, and only `-webkit-any` and `:is`.
        [prefixedFirst]: ".a::-moz-selection{color:red}.z{top:0}.a::selection{color:red}",
        [prefixedLast]: ".a::selection{color:red}.z{top:0}.a::-moz-selection{color:red}",
        [any]:
          ".a:-webkit-any(.b,.c){color:red}.a:-moz-any(.b,.c){color:red}.z{top:0}" +
          ".a:-webkit-any(.b,.c){color:red}.a:is(.b,.c){color:red}",
      },
      browser: {
        // The later rule prints `-webkit-any`, `-moz-any` and `:is`.
        [any]: ".z{top:0}.a:-webkit-any(.b,.c){color:red}.a:-moz-any(.b,.c){color:red}.a:is(.b,.c){color:red}",
      },
    });
  });

  test("a rule that a later rule repeats is still erased", () => {
    const cases = {
      ".a{color:red}.z{top:0}.a{color:red}": ".z{top:0}.a{color:red}",
      ".a{color:red}.z{top:0}.a{color:red}.y{top:0}.a{color:red}": ".z{top:0}.y{top:0}.a{color:red}",
      ".a{color:red;top:0!important}.z{top:0}.a{color:red;top:0!important}": ".z{top:0}.a{color:red;top:0!important}",
      ".a{border-radius:1dvh 8px}.z{top:0}.a{border-radius:1dvh 8px}": ".z{top:0}.a{border-radius:1dvh 8px}",
      ".a{background:url(a.png)}.z{top:0}.a{background:url(a.png)}": ".z{top:0}.a{background:url(a.png)}",
      ".a{--i:url(a.png)}.z{top:0}.a{--i:url(a.png)}": ".z{top:0}.a{--i:url(a.png)}",
      ".a{--c:oklch(98.5% 0 none)}.z{top:0}.a{--c:oklch(98.5% 0 none)}": ".z{top:0}.a{--c:oklch(98.5% 0 none)}",
      ":where(.a){color:red}:where(.a){color:red}": ":where(.a){color:red}",
      "@media print{.a{color:red}.b{top:0}}@media print{.a{color:red}.b{top:0}}":
        "@media print{.a{color:red}.b{top:0}}",
      // Chrome 80 needs `.c:focus-visible` and `.a:focus-visible` in rules of their own.
      ".a:focus-visible,.b{top:0}.c:focus-visible,.b{top:0}": ".a:focus-visible{top:0}.b{top:0}.c:focus-visible{top:0}",
    };
    expect(minifyAll(Object.keys(cases), chrome80)).toEqual(cases);
  });

  // The rules are compared when no later rule can merge into them, so in the
  // form that is printed.
  test("a rule is compared after the rules that follow it have merged into it", () => {
    expect({
      // The two last rules merge into a copy of the first rule.
      mergedCopy: minify(".a{color:red;top:0}.z{left:0}.a{color:red}.a{top:0}"),
      // The two last rules merge into `.a{gap:1dvh}`. The first rule is not a copy of that.
      mergedOther: minify(".a{gap:1vh}.z{top:0}.a{gap:1vh}.a{gap:1dvh}"),
      // Safari 14 needs `:-webkit-full-screen` in a rule of its own. The rules
      // for it are not in the list when `.z` is compared.
      splitSelectors: minify(".a:fullscreen,.z{color:red}.a:fullscreen,.z{color:red}", browser),
    }).toEqual({
      mergedCopy: ".z{left:0}.a{color:red;top:0}",
      mergedOther: ".a{gap:1vh}.z{top:0}.a{gap:1dvh}",
      splitSelectors: ".z{color:red}.a:-webkit-full-screen{color:red}.a:fullscreen{color:red}",
    });
  });

  // Nested rules are not compared, so a rule that has them stays.
  test("two equal rules with nested rules both stay", () => {
    const source = ".p{color:red;.a{color:red}}.z{top:0}.p{color:red;.a{color:red}}";
    expect({ none: minify(source), chrome80: minify(source, chrome80) }).toEqual({
      none: ".p{color:red;& .a{color:red}}.z{top:0}.p{color:red;& .a{color:red}}",
      chrome80: ".p{color:red}.p .a{color:red}.z{top:0}.p{color:red}.p .a{color:red}",
    });
  });

  // Each row is a property and two values. A rule with the first value is
  // equal to its copy. It is not equal to a rule with the second value,
  // unless the targets make the two values print the same.
  test("equal values make equal rules, and other values do not", () => {
    const rows: [property: string, value: string, other: string][] = [
      ["height", "100vh", "100dvh"],
      ["width", "calc(100% - 1px)", "calc(100% - 2px)"],
      ["margin", "1px 2px", "2px 1px"],
      ["inset", "1px 2px 3px 4px", "1px 2px 3px 5px"],
      ["border-radius", "1dvh 8px", "8px 1dvh"],
      ["border-top-left-radius", "1px 2px", "2px 1px"],
      ["border-spacing", "1px 2px", "2px 1px"],
      ["background-size", "1px 2px", "2px 1px"],
      ["background-position", "1px 2px", "2px 1px"],
      ["color", "red", "green"],
      ["color", "lab(none 0 0)", "lab(0 0 0)"],
      ["color", "oklch(98.5% 0 none)", "oklch(98.5% 0 0)"],
      ["background-color", "color(srgb none 0 0)", "color(srgb 0 0 0)"],
      ["border", "1px solid hsl(none 50% 50%)", "1px solid hsl(1 50% 50%)"],
      ["box-shadow", "0 0 0 1px lch(50% 10 none)", "0 0 0 1px lch(50% 10 0)"],
      ["background", "url(a.png)", "url(b.png)"],
      ["background-image", 'image-set("a.png" 1x,"b.png" 2x)', 'image-set("a.png" 1x,"c.png" 2x)'],
      ["background-image", "linear-gradient(red,green)", "linear-gradient(red,blue)"],
      ["border-image", "url(a.png) 30", "url(b.png) 30"],
      ["mask", "url(a.svg#m)", "url(b.svg#m)"],
      ["list-style", "url(a.png)", "url(b.png)"],
      ["cursor", "url(a.cur),auto", "url(b.cur),auto"],
      ["content", "url(a.png)", "url(b.png)"],
      ["content", '"a"', '"b"'],
      ["filter", "url(#a)", "url(#b)"],
      ["font-family", "Arial", "Helvetica"],
      ["transition", "opacity 1s", "opacity 2s"],
      ["transition-property", "fill", "stroke"],
      ["animation", "a 1s", "b 1s"],
      ["transform", "translate(1px)", "translate(2px)"],
      ["rotate", "90deg", "91deg"],
      ["grid-template-columns", "repeat(2,1fr)", "repeat(3,1fr)"],
      ["display", "-webkit-box", "flex"],
      ["position", "-webkit-sticky", "sticky"],
      ["z-index", "1", "2"],
      ["--x", "1", "2"],
      ["--x", "url(a.png)", "url(b.png)"],
      ["--x", "oklch(98.5% 0 none)", "oklch(98.5% 0 0)"],
      ["--x", "var(--a,1px)", "var(--b,1px)"],
      ["foo", "1", "2"],
      ["-webkit-foo", "a b", "a c"],
    ];
    const failures: string[] = [];
    for (const targets of [undefined, browser]) {
      const between = minify(".z{--s:0}", targets);
      for (const [property, value, other] of rows) {
        const first = minify(`.a{${property}:${value}}`, targets);
        const second = minify(`.a{${property}:${other}}`, targets);
        const check = (source: string, expected: string) => {
          const received = minify(source, targets);
          if (received !== expected) failures.push(`${source} (${targets ? "browser" : "none"}): ${received}`);
        };
        check(`.a{${property}:${value}}.z{--s:0}.a{${property}:${value}}`, between + first);
        check(`.a{${property}:${value}}.b{${property}:${value}}`, ".a,.b" + first.slice(2));
        if (first === second) continue;
        check(`.a{${property}:${value}}.z{--s:0}.a{${property}:${other}}`, first + between + second);
        check(`.a{${property}:${value}}.b{${property}:${other}}`, first + ".b" + second.slice(2));
      }
    }
    expect(failures).toEqual([]);
  });

  // The targets need more than one rule for these selectors, and the next
  // build lowers its own output again. The duplicate check keeps the copies
  // from piling up: the output does not change after the third build.
  test("the output is stable when it is minified again", () => {
    const sources = [
      ".a:not(.b,.c){color:red}",
      ".a:not(.b,.c){background:url(a.png)}",
      ".a:not(.b,.c){color:lab(none 0 0)}",
      ".a:not(.b,.c){border-radius:1dvh 8px}",
      ".a:is(.b,.c){background:url(a.png)}",
      ".a:autofill:not(.b,.c){color:red}",
      ".a:autofill:not(.b,.c){--c:oklch(98.5% 0 none)}",
      ".a:lang(en,fr),.z{color:red}",
      ".a:fullscreen,.z{color:red}.a:fullscreen,.z{color:red}",
    ];
    const unstable: string[] = [];
    for (const targets of [chrome80, browser]) {
      for (const source of sources) {
        const builds = [source];
        for (let i = 0; i < 5; i++) builds.push(minify(builds[i], targets));
        if (builds[3] !== builds[4] || builds[4] !== builds[5]) {
          unstable.push(`${source}: ${builds.slice(1).map(css => css.split("{").length - 1)} rules`);
        }
      }
    }
    expect(unstable).toEqual([]);
  });

  test("every rule of a long list stays", () => {
    const n = 2000;
    const list = (rule: (i: number) => string) => Array.from({ length: n }, (_, i) => rule(i)).join("");
    const count = (source: string, needle: string) => minify(source).split(needle).length - 1;
    expect({
      values: count(
        list(i => `.a{height:${i}px}.q${i}{z-index:9}`),
        ".a{",
      ),
      mergedRules: count(
        list(i => `.a{height:${i}px}.a{width:1px}.q${i}{z-index:9}`),
        ".a{",
      ),
      atRules: count(list(i => `.s${i}{top:${i}px}`) + list(i => `@media (min-width:${i}px){.m{top:0}}`), ".s"),
    }).toEqual({ values: n, mergedRules: n, atRules: n });
  });

  // The duplicate check takes time in proportion to the number of rules.
  // Each at-rule ends a run of style rules, and the check once cleared its
  // table of all earlier rules at each at-rule.
  test("a long list of at-rules after a long list of style rules takes linear time", async () => {
    const script = `
      const c = require("bun:internal-for-testing").cssInternals;
      const n = ${isDebug || isASAN ? 16_000 : 40_000};
      const styleRules = Array.from({ length: n }, (_, i) => ".s" + i + "{top:" + i + "px}").join("");
      const atRules = Buffer.alloc(n * 24, "@font-face{font-family:x}").toString();
      const time = source => {
        const before = process.cpuUsage();
        c.minifyTest(source, "");
        const { user, system } = process.cpuUsage(before);
        return user + system;
      };
      time(styleRules);
      console.log(time(styleRules + atRules) / (time(styleRules) + time(atRules)));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(Number(stdout)).toBeLessThan(4);
    expect(exitCode).toBe(0);
  }, 90_000);

  // `bun build` minifies with the browser targets above. `bun build --no-bundle`
  // minifies through the transpiler, with no targets.
  test.each([
    ["bun build", ["--minify", "--outdir", "out"], browser],
    ["bun build --no-bundle", ["--no-bundle", "--minify", "--outdir", "out"], undefined],
  ])("with %s", async (_, args, targets) => {
    const sheets = {
      "fallback.css": ".a{height:100vh}.z{top:0}.a{height:100dvh}",
      "copy.css": ".a{height:100vh}.z{top:0}.a{height:100vh}",
      "selectors.css": ".a:is(.b,.c){color:red}",
    };
    using dir = tempDir("css-same-selector-rules", sheets);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...Object.keys(sheets), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const outputs = Object.fromEntries(
      await Promise.all(
        Object.keys(sheets).map(async name => [name, (await Bun.file(`${dir}/out/${name}`).text()).trim()]),
      ),
    );

    expect({ stderr, outputs }).toEqual({
      stderr: "",
      outputs: {
        "fallback.css": ".a{height:100vh}.z{top:0}.a{height:100dvh}",
        "copy.css": ".z{top:0}.a{height:100vh}",
        "selectors.css": minify(sheets["selectors.css"], targets),
      },
    });
    expect(exitCode).toBe(0);
  });
});
