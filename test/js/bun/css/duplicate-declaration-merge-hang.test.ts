import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
  // Same custom property name in both rules: the earlier one *is* dead.
  expect(cssInternals.minifyTest(":root{--a:1}.q{z-index:9}:root{--a:2}", "")).toBe(".q{z-index:9}:root{--a:2}");
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
    ":where(.x){--a:2}",
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
  // Same split, same properties: the earlier rule *is* dead.
  expect(cssInternals.minifyTest(".z{color:red !important}.q{z-index:9}.z{color:blue !important}", "")).toBe(
    ".q{z-index:9}.z{color:#00f!important}",
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
// reach the id comparison of each declaration list in `is_duplicate`.
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
  // The same prefix: the earlier rule *is* dead.
  expect(
    cssInternals.minifyTest(".z{-webkit-transition:opacity 1s}.q{z-index:9}.z{-webkit-transition:opacity 2s}", ""),
  ).toBe(".q{z-index:9}.z{-webkit-transition:opacity 2s}");
});
