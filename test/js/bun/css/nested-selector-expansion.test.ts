import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Regression test for unbounded memory growth when compiling CSS nesting for
// targets that don't support it (found by CSS fuzzing).
//
// When the browser targets lack native nesting support, every `&` in a nested
// rule's selector is replaced with the parent selector at print time. The
// parent selector itself may contain `&` referring to the grandparent, so a
// selector with multiple `&` references per nesting level expands to
// (references per level)^depth copies of its ancestors. A ~3 KB stylesheet
// with ~20 nesting levels of `&:is(.bar, &.baz)` makes the printer allocate an
// effectively unbounded output buffer: `bun build` (whose default browser
// target predates CSS nesting) and `minifyTest` with explicit targets both
// spin forever while memory grows.
//
// The serializer now budgets the number of `&` substitutions per rule prelude
// and reports "Maximum nesting expansion exceeded" instead of expanding
// without bound. Preserving nesting (no targets) and ordinary nested CSS with
// old targets are unaffected.

/** Deeply nested rules where each level references the parent twice (`&` appears twice per selector). */
function explodingNestedCss(depth: number): string {
  let css = "";
  for (let i = 0; i < depth; i++) {
    css += "&:is(.bar, &.baz) { color: red; }\n";
    css += "&:is(.bar, &.baz) { colo\n"; // unclosed block, same shape as the fuzz input
  }
  css += "&:is(.bar, &.baz) { color: red; }\n";
  css += "}";
  return css;
}

const minifyTestScript = `
  const { cssInternals } = require("bun:internal-for-testing");
  const depth = parseInt(process.env.NESTED_CSS_DEPTH, 10);
  const targets = process.env.NESTED_CSS_TARGETS === "1" ? { safari: 13 << 16 } : undefined;
  let css = "";
  for (let i = 0; i < depth; i++) {
    css += "&:is(.bar, &.baz) { color: red; }\\n";
    css += "&:is(.bar, &.baz) { colo\\n";
  }
  css += "&:is(.bar, &.baz) { color: red; }\\n";
  css += "}";
  try {
    const out = targets ? cssInternals.minifyTest(css, "", targets) : cssInternals.minifyTest(css, "");
    console.log("OK " + out.length);
  } catch (err) {
    console.log("ERR " + err.message);
  }
`;

async function runMinifyTest(depth: number, withTargets: boolean) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", minifyTestScript],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
      NESTED_CSS_DEPTH: String(depth),
      NESTED_CSS_TARGETS: withTargets ? "1" : "0",
    },
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix these spins were unbounded. Let the child be
    // killed so a regression fails the assertions below instead of hanging the
    // test runner and exhausting memory.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent(
  "deeply nested `&` selectors error out instead of expanding without bound when compiling nesting",
  async () => {
    const { stdout, stderr, signalCode, exitCode } = await runMinifyTest(24, true);
    expect(stderr).toBe("");
    expect(signalCode).toBeNull(); // not killed by the kill switch
    expect(stdout).toContain("ERR Maximum nesting expansion exceeded");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("deeply nested `&` selectors still minify when nesting is preserved (no targets)", async () => {
  const { stdout, stderr, signalCode, exitCode } = await runMinifyTest(24, false);
  expect(stderr).toBe("");
  expect(signalCode).toBeNull();
  // Without targets the nesting is preserved, so the output stays small.
  expect(stdout).toStartWith("OK ");
  expect(exitCode).toBe(0);
});

test.concurrent("ordinary nested CSS still compiles for older targets", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { cssInternals } = require("bun:internal-for-testing");
        // 8 levels deep, one parent reference per level: well within the budget.
        let css = ".a { color: red; ";
        for (let i = 0; i < 8; i++) css += "&:hover .b" + i + " { color: blue; ";
        css += "}".repeat(9);
        console.log(cssInternals.minifyTest(css, "", { safari: 13 << 16 }));
      `,
    ],
    env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // The innermost rule's `&` chain is fully expanded.
  expect(stdout).toContain(".a:hover .b0:hover .b1:hover .b2:hover .b3:hover .b4:hover .b5:hover .b6:hover .b7");
  expect(exitCode).toBe(0);
});

// A selector with multiple `&` references per compound chain (e.g. `& > &`)
// is a single entry in its rule's selector list, so the minify-time
// selector-expansion multiplier (which multiplies by the list length) does not
// see it as fan-out. At print time every `&` expands the parent, so each such
// nesting level still fans out by its `&` count. The per-prelude substitution
// counter bounds one rule's prelude but is reset between sibling rules, so
// many sibling leaf rules under a `& > &` chain each stay under the per-prelude
// cap while the total output grows by (leaf count) * 2^depth. A ~7 KB
// stylesheet expanded into ~1.7 GB of output this way (found by CSS fuzzing,
// stack sampled inside `write_fmt` on the growing `Vec<u8>`). The printer now
// also accumulates the bytes emitted by nested-prelude substitution across the
// whole stylesheet and reports the existing "Maximum nesting expansion
// exceeded" error past 64 MB instead of serializing without bound.

const siblingUnderAmpChainScript = `
  const { cssInternals } = require("bun:internal-for-testing");
  const depth = parseInt(process.env.AMP_CHAIN_DEPTH, 10);
  const leaves = parseInt(process.env.AMP_CHAIN_LEAVES, 10);
  const root =
    "." + Buffer.alloc(500, "a").toString() + "::part(x), " +
    "." + Buffer.alloc(500, "b").toString() + "::part(y)";
  let body = "";
  for (let i = 0; i < leaves; i++) body += ".l" + i + " { color: rgb(" + (i % 256) + ", 0, 0) } ";
  let inner = body;
  for (let i = 0; i < depth; i++) inner = "& > & { " + inner + " }";
  const css = root + " { " + inner + " }";
  try {
    const out = cssInternals._test(css, "", { firefox: 100 << 16 });
    console.log("OK " + out.length);
  } catch (err) {
    console.log("ERR " + err.message);
  }
`;

async function runSiblingUnderAmpChain(depth: number, leaves: number) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", siblingUnderAmpChainScript],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
      AMP_CHAIN_DEPTH: String(depth),
      AMP_CHAIN_LEAVES: String(leaves),
    },
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this allocated hundreds of MB to GB of
    // output. Kill the child so a regression fails the assertions below
    // instead of exhausting memory or hanging the runner.
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent("many sibling rules under a `& > &` chain error out instead of serializing gigabytes", async () => {
  // Two `::part()` selectors with 500-byte identifiers at the root, nested
  // 13 levels deep in `& > &` (2^13 = 8192 substitutions per leaf prelude,
  // well under the 65536 per-prelude cap), with 200 sibling leaf rules
  // underneath. Before the fix this serialized ~1.7 GB of output; now the
  // stylesheet-wide byte budget fires after ~64 MB and reports the existing
  // nesting-expansion error.
  const { stdout, stderr, signalCode, exitCode } = await runSiblingUnderAmpChain(13, 200);
  expect(stderr).toBe("");
  expect(signalCode).toBeNull(); // not killed by the kill switch
  expect(stdout).toContain("ERR Maximum nesting expansion exceeded");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "top-level `@scope (...) to (...)` preludes are charged against the nesting-expansion byte budget",
  async () => {
    // `<scope-end>` is serialized with `<scope-start>` as its parent
    // context even when there is no outer style-rule context, so each `&`
    // in `<scope-end>` repeats `<scope-start>`. A 4 KB start identifier with
    // a 2000-`&` end expands one ~8 KB rule into ~8 MB of prelude; nine such
    // sibling rules stay under the 64 MB budget, ten exceed it.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { cssInternals } = require("bun:internal-for-testing");
          const start = "." + Buffer.alloc(4000, "a").toString();
          const end = Array(2000).fill("&").join(" ");
          const rule = "@scope (" + start + ") to (" + end + ") { .x { color: red } }\\n";
          for (const n of [1, 10]) {
            try {
              const out = cssInternals._test(rule.repeat(n), "", { firefox: 100 << 16 });
              console.log("n=" + n + " OK " + out.length);
            } catch (err) {
              console.log("n=" + n + " ERR " + err.message);
            }
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
    expect(stderr).toBe("");
    expect(proc.signalCode).toBeNull();
    const lines = stdout.trim().split("\n");
    // One rule is well under the budget and serializes unchanged.
    expect(lines[0]).toStartWith("n=1 OK ");
    // Ten sibling rules push the accumulated preludes past 64 MB and error.
    expect(lines[1]).toContain("n=10 ERR Maximum nesting expansion exceeded");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("`@scope to (...)` without a scope-start serializes its closing `)`, body, and `}`", async () => {
  // `ScopeRule::to_css` used to early-return after serializing
  // `<scope-end>` when `<scope-start>` was absent, leaving the prelude
  // unclosed and dropping the rule body (and skipping the
  // nesting-expansion byte budget check below). Fall through instead so
  // the rule serializes in full.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
          const { cssInternals } = require("bun:internal-for-testing");
          console.log(cssInternals.minifyTest("@scope to (.a) { .x { color: red } }", ""));
        `,
    ],
    env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(proc.signalCode).toBeNull();
  expect(stdout.trim()).toBe("@scope to (.a){.x{color:red}}");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "sibling `@scope to (& ...)` rules under a `& > &` chain error out instead of serializing gigabytes",
  async () => {
    // `@scope to (...)` without a scope-start serializes `<scope-end>` with
    // the outer parent context, so `&` in it expands the enclosing `& > &`
    // chain. Many such sibling `@scope` rules each stay under the
    // per-prelude substitution cap (reset in `ScopeRule::to_css`) but their
    // preludes are now charged against the stylesheet-wide byte budget, so
    // this shape errors out after ~64 MB instead of serializing ~1.7 GB.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { cssInternals } = require("bun:internal-for-testing");
          const root =
            "." + Buffer.alloc(500, "a").toString() + "::part(x), " +
            "." + Buffer.alloc(500, "b").toString() + "::part(y)";
          let body = "";
          for (let i = 0; i < 200; i++) body += "@scope to (& .l" + i + ") { } ";
          let inner = body;
          for (let i = 0; i < 13; i++) inner = "& > & { " + inner + " }";
          try {
            const out = cssInternals._test(root + " { " + inner + " }", "", { firefox: 100 << 16 });
            console.log("OK " + out.length);
          } catch (err) {
            console.log("ERR " + err.message);
          }
        `,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      stdout: "pipe",
      stderr: "pipe",
      // Kill switch: before the fix this allocated ~1.7 GB of output.
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(proc.signalCode).toBeNull();
    expect(stdout.trim()).toContain("ERR Maximum nesting expansion exceeded");
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "a few sibling rules under a `& > &` chain still serialize without hitting the byte budget",
  async () => {
    // Same shape at a non-pathological scale: 3 sibling leaves under 13
    // levels of `& > &` expand to ~25 MB of preludes, under the 64 MB budget,
    // so output is unchanged.
    const { stdout, stderr, signalCode, exitCode } = await runSiblingUnderAmpChain(13, 3);
    expect(stderr).toBe("");
    expect(signalCode).toBeNull();
    expect(stdout).toStartWith("OK ");
    // Output is the three expanded leaf rules: large but bounded and stable.
    const bytes = parseInt(stdout.slice("OK ".length), 10);
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(bytes).toBeLessThan(64 << 20);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("bun build does not hang on deeply nested `&` selectors with the default browser target", async () => {
  using dir = tempDir("css-nested-selector-expansion", {
    "explode.css": explodingNestedCss(24),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", path.join(String(dir), "explode.css"), "--outdir", path.join(String(dir), "out")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this build spun forever while allocating.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The build must terminate on its own (the printer reports an error for the
  // runaway rule) instead of being killed by the 20s kill switch.
  expect(proc.signalCode).toBeNull();
  expect(exitCode).not.toBeNull();
});
