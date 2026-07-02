import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression tests for exponential backtracking when parsing nested function
// values in raw token lists (fuzzer-found OOM/DoS).
//
// `TokenList::parse_into` tries `UnresolvedColor::parse` for rgb()/hsl()/
// light-dark() and falls back to parsing the arguments as a plain function
// when that attempt fails. The attempt buffers token-list arguments (the
// rgb()/hsl() alpha, the light-dark() halves), so when it failed *after*
// consuming them — a missing light-dark() comma, or a bad token inside the
// alpha — the fallback re-parsed the same range. With such functions nested,
// every level re-buffered the remaining input once per alternative:
// O(2^depth) time and allocation churn. The earlier unclosed-block-at-EOF
// short-circuit only covered truncated inputs, not balanced ones.
//
// Now a token-list parse failure inside the attempt propagates instead of
// falling through (those tokens fail identically under every alternative),
// and light-dark() checks for its top-level comma with a raw scan before
// buffering anything.

const { minifyTest, prefixTest, _test } = cssInternals;

function spawnMinify(css: string) {
  return Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const c = require("bun:internal-for-testing").cssInternals;
       const css = ${JSON.stringify(css)};
       const rssBefore = process.memoryUsage.rss();
       let threw = false;
       try { c.minifyTest(css, ""); } catch { threw = true; }
       const deltaMB = (process.memoryUsage.rss() - rssBefore) / 1024 / 1024;
       if (deltaMB > 256) throw new Error("memory grew by " + deltaMB.toFixed(0) + "MB");
       console.log("done threw=" + threw);`,
    ],
    env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
    stdout: "pipe",
    stderr: "pipe",
    // Backstop: the unfixed parser blocks inside a single native call for
    // hours at this depth, so kill the child rather than hanging the runner.
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
}

async function expectBounded(css: string, expectedThrew: boolean) {
  await using proc = spawnMinify(css);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode, stderr: stderr.includes("error") ? stderr : "" }).toEqual({
    stdout: `done threw=${expectedThrew}\n`,
    exitCode: 0,
    stderr: "",
  });
}

const filler = Buffer.alloc(4000, "0 ").toString();

test.concurrent("deeply nested light-dark() without a top-level comma parses in bounded time", async () => {
  // The attempt consumed the whole argument range before failing on the
  // missing comma, then the fallback re-parsed it: 2^depth. Depth 16 already
  // took ~15s before the fix; depth 96 did not finish.
  const depth = 96;
  const css = ".a{--x:" + "light-dark(".repeat(depth) + filler + ")".repeat(depth) + "}";
  await expectBounded(css, false);
});

test.concurrent("deeply nested rgb() with a bad-string token in the alpha parses in bounded time", async () => {
  // The alpha token list fails on the unterminated string; that range fails
  // identically when re-parsed as a plain function, once per nesting level.
  const depth = 96;
  const css = ".a{--x:" + "rgb(1 1 1/ ".repeat(depth) + filler + "' \n" + ")".repeat(depth) + "}";
  await expectBounded(css, true);
});

test.concurrent("deeply nested rgb() with an invalid var() in the alpha parses in bounded time", async () => {
  // Same shape, but the doomed token is an inner var() with an invalid name
  // rather than a tokenizer-level error token.
  const depth = 96;
  const css = ".a{--x:" + "rgb(1 1 1/ ".repeat(depth) + filler + "var(0)" + ")".repeat(depth) + "}";
  await expectBounded(css, true);
});

test("original fuzzer input parses in bounded time and memory", () => {
  // Minimized fuzzer testcase: thousands of unclosed `{` blocks, unterminated
  // strings, and a trailing run of `}`.
  //
  // The input's very first byte is `{`, so its whole depth is a chain of
  // empty-prelude rules. Now that empty selectors are rejected, parsing stops
  // on the first byte instead of reading to EOF; the bounded-time property
  // this test guards still holds, the targeted deep-nesting tests above keep
  // covering the backtracking path, and the error just arrives sooner.
  const input = Buffer.from(
    Bun.gunzipSync(
      Buffer.from(
        "H4sIAAAAAAACA+3QoQqAMBSF4e5T3Ga6MquvYlKZIFMWpoiMvYuPajBYrc7/Kz+ceGIEACAvBxcAAPBT7TvV6L3E4k4pYehm25y1pC9N8tDd9m5ademCa2RTNZX5oAQAAAAAQBYuJSDTGYIfAAA=",
        "base64",
      ),
    ),
  ).toString("latin1");
  expect(() => minifyTest(input, "")).toThrow("Empty selector is not allowed");
  expect(() => _test(input, "", { chrome: 80 << 16 })).toThrow("Empty selector is not allowed");
  expect(() => prefixTest(input, "", { chrome: 80 << 16 })).toThrow("Empty selector is not allowed");
});

test("valid and recovered color function values are unchanged", () => {
  const cases: [string, string][] = [
    [".a{--x: light-dark(red, blue)}", ".a{--x:light-dark(red,#00f)}"],
    // No top-level comma: still recovered as a plain function.
    [".a{--x: light-dark(red blue)}", ".a{--x:light-dark(red blue)}"],
    [".a{--x: light-dark(rgb(1 2 3), #fff)}", ".a{--x:light-dark(#010203,#fff)}"],
    [".a{--x: light-dark(light-dark(red, blue), green)}", ".a{--x:light-dark(red,green)}"],
    [".a{--x: light-dark(var(--l), var(--d))}", ".a{--x:light-dark(var(--l),var(--d))}"],
    [".a{--x: rgb(1 1 1/var(--a))}", ".a{--x:rgb(1 1 1/var(--a))}"],
    [".a{--x: hsl(120deg 50% 50%/var(--o, 0.5))}", ".a{--x:hsl(120 50% 50%/var(--o,.5))}"],
    [".a{--x: rgb(var(--r) 0 0/1)}", ".a{--x:rgb(var(--r)0 0/1)}"],
    [".a{--x: f(light-dark(red))}", ".a{--x:f(light-dark(red))}"],
    [".a{--x: var(--a, light-dark(x y))}", ".a{--x:var(--a,light-dark(x y))}"],
    [".a{--x: env(safe-area-inset-top, light-dark(a, b))}", ".a{--x:env(safe-area-inset-top,light-dark(a,b))}"],
  ];
  for (const [css, expected] of cases) {
    expect(minifyTest(css, "")).toBe(expected);
  }
});

test("bad tokens inside color function arguments still fail the declaration", () => {
  expect(() => minifyTest(".a{--x: rgb(1 1 1/ ] )}", "")).toThrow("Unexpected token");
  expect(() => minifyTest(".a{--x: light-dark(a, ] )}", "")).toThrow("Unexpected token");
  expect(() => minifyTest(".a{--x: light-dark( ] , b)}", "")).toThrow("Unexpected token");
});
