import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for an out-of-bounds read in the CSS An+B parser.
//
// `:nth-child()` (and the other :nth-* pseudo-classes) compare an ident
// argument against the keywords "even", "odd", "n", "-n", "n-" and "-n-"
// with a length-agnostic case-insensitive compare that hands the *ident's*
// length to strncasecmp. When the ident is longer than the keyword it is
// being compared against — e.g. `:nth-child(Nn` — the comparison walked past
// the end of the keyword literal. AddressSanitizer reports that as a
// global-buffer-overflow and aborts the whole process, taking down
// `Bun.build` from its parse worker thread.
//
// An ident longer than the keyword is now treated as a mismatch, so these
// stylesheets produce an ordinary parse error instead of crashing, and valid
// An+B keywords keep parsing.

async function buildCSS(css: string) {
  using dir = tempDir("css-nth-ident", {
    "e.css": css,
    "build.ts": `
      const result = await Bun.build({
        entrypoints: ["./e.css"],
        target: "browser",
        throw: false,
      });
      console.log(
        JSON.stringify({
          success: result.success,
          logs: result.logs.map(log => String(log.message ?? log)),
          outputs: await Promise.all(result.outputs.map(output => output.text())),
        }),
      );
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // If the child died (e.g. the pre-fix abort inside the CSS parser), surface its stderr.
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
  return JSON.parse(stdout) as { success: boolean; logs: string[]; outputs: string[] };
}

// Each ident matches the keyword it is compared against for the keyword's
// whole length and then keeps going, which is exactly the shape that read out
// of bounds before the fix.
test.each([
  [":nth-child(Nn", "Unexpected end of input"], // fuzzer-minimized input; overruns "n", then hits EOF
  [".a:nth-child(nx) {color: red}", "Unexpected token: nx"], // overruns "n"
  [".a:nth-child(-nx) {color: red}", "Unexpected token: -nx"], // overruns "-n"
  [".a:nth-child(n-x) {color: red}", "Unexpected token: n-x"], // overruns "n-"
  [".a:nth-child(-n-x) {color: red}", "Unexpected token: -n-x"], // overruns "-n-"
  [".a:nth-child(evenly) {color: red}", "Unexpected token: evenly"], // overruns "even"
  [".a:nth-child(oddity) {color: red}", "Unexpected token: oddity"], // overruns "odd"
  [".a:nth-last-child(ODDS) {color: red}", "Unexpected token: ODDS"], // same An+B parser via :nth-last-child
])("invalid An+B ident is a parse error, not a crash: %s", async (css, message) => {
  expect(await buildCSS(css)).toEqual({
    success: false,
    logs: [message],
    outputs: [],
  });
});

test("valid An+B keywords still parse", async () => {
  const result = await buildCSS(
    "li:nth-child(even) {color: red}\n" +
      "li:nth-child(ODD) {color: green}\n" +
      "li:nth-child(n) {color: blue}\n" +
      "li:nth-child(-n+3) {color: cyan}\n" +
      "li:nth-last-child(2n+1) {color: yellow}\n",
  );
  expect(result.success).toBe(true);
  expect(result.logs).toEqual([]);
  expect(result.outputs.length).toBe(1);
  // `even` and `2n+1` are normalized to `2n` and `odd` by the printer.
  expect(result.outputs[0]).toContain("li:nth-child(2n)");
  expect(result.outputs[0]).toContain("li:nth-child(odd)");
  expect(result.outputs[0]).toContain("li:nth-child(n)");
  expect(result.outputs[0]).toContain("li:nth-child(-n+3)");
  expect(result.outputs[0]).toContain("li:nth-last-child(odd)");
});
