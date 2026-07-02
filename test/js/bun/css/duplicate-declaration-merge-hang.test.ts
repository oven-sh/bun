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
    "distinct-selectors": [
      Array.from({ length: n }, (_, i) => \`.a\${i}{color:red}\`).join(""),
      { chrome: 80 << 16 },
    ],
  };
  for (const [name, [src, targets]] of Object.entries(floods)) {
    const out = targets === undefined ? c.minifyTest(src, "") : c._test(src, "", targets);
    if (typeof out !== "string" || out.length === 0) throw new Error(name + " produced no output");
    console.log("OK:" + name);
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

// The merge-with-previous cascade pops rules without purging their indices
// from the duplicate-rule table, so a rule pushed into a reused slot could
// match its own stale table entry and erase itself: this input used to
// minify to ".a,.b{color:#00f}", silently dropping .a{color:purple} and
// changing the computed color of .a elements.
test("stale duplicate-rule entries do not erase a later rule", () => {
  expect(
    cssInternals.minifyTest(".a,.b{color:red}.a{color:blue}.b{color:green}.b{color:blue}.a{color:purple}", ""),
  ).toBe(".a,.b{color:#00f}.a{color:purple}");
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
