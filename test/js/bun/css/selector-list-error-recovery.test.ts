import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const { minifyTest } = cssInternals;

// Three selector-list parsing bugs with the same symptom: a pseudo-class that
// takes a non-forgiving selector list was parsed with the forgiving recovery
// mode reserved for :is()/:where(), so an all-invalid argument produced an
// empty list that serializes as invalid CSS every browser drops.
//
// 1. `:nth-child(An+B of <selectors>)` takes a <complex-real-selector-list>
//    (https://drafts.csswg.org/selectors/#the-nth-child-pseudo) but was parsed
//    forgivingly, emitting `:nth-child(2n of )`.
// 2. `:has()` takes a <relative-selector-list>, non-forgiving since
//    https://github.com/w3c/csswg-drafts/issues/7676, but was parsed
//    forgivingly, emitting `:has()`.
// 3. `parse_compound_selector` discarded `parse_type_selector`'s boolean ("did
//    a type selector get parsed") and its errors, so a selector with no simple
//    selectors at all parsed as a valid empty selector. That let
//    `:nth-child(2n of)`, ` { color: red }`, and `.a, , .b { }` through too.

// An unfixed build asserts on the empty of-list in the serializer, so run each
// input through a child process to keep the test runner alive either way.
// Returns the single line the child prints, `ok: <minified>` or `error: <message>`,
// plus stderr filtered to real diagnostics so a crash shows up in the failure diff.
async function minifyInChild(css: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { minifyTest } = require("bun:internal-for-testing").cssInternals;
try {
  console.log("ok: " + minifyTest(${JSON.stringify(css)}, ""));
} catch (e) {
  console.log("error: " + e.message);
}`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: stdout.trim(),
    stderr: stderr.includes("error") || stderr.includes("panic") ? stderr.trim() : "",
    exitCode,
  };
}

function rejected(message: string) {
  return { stdout: `error: parsing failed: ${message}`, stderr: "", exitCode: 0 };
}

function minified(output: string) {
  return { stdout: `ok: ${output}`, stderr: "", exitCode: 0 };
}

// --- :nth-child(An+B of <selectors>) ---

test.concurrent("an of-list made only of a pseudo-element invalidates the rule", async () => {
  expect(await minifyInChild("a:nth-child(2n of ::before) { color: red }")).toEqual(
    rejected("Invalid selector. Token is not allowed in this state"),
  );
});

test.concurrent("an of-list made only of a lexically invalid selector invalidates the rule", async () => {
  expect(await minifyInChild("a:nth-child(2n of %bad) { color: red }")).toEqual(
    rejected("Invalid selector. Empty selector is not allowed"),
  );
});

test.concurrent("an of-list made only of a bad-string token invalidates the rule", async () => {
  expect(await minifyInChild('div:nth-child(2n of [q="x\n]) { color: red }')).toEqual(
    rejected("Invalid selector. Invalid value in attribute selector: x"),
  );
});

// Non-forgiving means one invalid selector invalidates the whole list, even when
// another selector in it is valid on its own.
test.concurrent("a valid selector does not rescue an of-list with an invalid one", async () => {
  expect(await minifyInChild("a:nth-child(2n of .valid, ::before) { color: red }")).toEqual(
    rejected("Invalid selector. Token is not allowed in this state"),
  );
});

test.concurrent(":nth-last-child takes the same of-list grammar", async () => {
  expect(await minifyInChild("a:nth-last-child(2n of ::before) { color: red }")).toEqual(
    rejected("Invalid selector. Token is not allowed in this state"),
  );
});

test.concurrent("an empty of-list invalidates the rule", async () => {
  expect(await minifyInChild("a:nth-child(2n of) { color: red }")).toEqual(
    rejected("Invalid selector. Empty selector is not allowed"),
  );
});

test.concurrent("an empty selector before a comma invalidates the of-list", async () => {
  expect(await minifyInChild("a:nth-child(2n of , .x) { color: red }")).toEqual(
    rejected("Invalid selector. Empty selector is not allowed"),
  );
});

test.concurrent("valid of-lists still parse and minify", async () => {
  expect(await minifyInChild(":nth-child(even of li.important) {width: 20px}")).toEqual(
    minified(":nth-child(2n of li.important){width:20px}"),
  );
  expect(await minifyInChild(":nth-last-child(2n of li.important, .other) {width: 20px}")).toEqual(
    minified(":nth-last-child(2n of li.important, .other){width:20px}"),
  );
  expect(await minifyInChild("a:nth-child(2n of *) { color: red }")).toEqual(
    minified("a:nth-child(2n of *){color:red}"),
  );
});

// --- :has(<relative-selector-list>) ---

test.concurrent("a :has() list made only of a lexically invalid selector invalidates the rule", async () => {
  expect(await minifyInChild("a:has(%bad) { color: red }")).toEqual(
    rejected("Invalid selector. Empty selector is not allowed"),
  );
});

test.concurrent("a lone comma in :has() invalidates the rule", async () => {
  expect(await minifyInChild("a:has(,) { color: red }")).toEqual(rejected("Unexpected end of input"));
});

test.concurrent("a valid selector does not rescue a :has() list with an invalid one", async () => {
  expect(await minifyInChild("a:has(> .x, %bad) { color: red }")).toEqual(
    rejected("Invalid selector. Empty selector is not allowed"),
  );
});

test.concurrent("valid :has() lists still parse and minify", async () => {
  expect(await minifyInChild("a:has(.x) { color: red }")).toEqual(minified("a:has(.x){color:red}"));
  expect(await minifyInChild("a:has(> .x, ~ .y) { color: red }")).toEqual(minified("a:has(>.x,~.y){color:red}"));
});

// --- empty selectors ---

test("an empty selector in a style rule prelude is rejected", () => {
  expect(() => minifyTest(" { color: red }", "")).toThrow("Invalid selector. Empty selector is not allowed");
  expect(() => minifyTest(".a, , .b { color: red }", "")).toThrow("Invalid selector. Empty selector is not allowed");
  expect(() => minifyTest(".a, { color: red }", "")).toThrow("Invalid selector. Empty selector is not allowed");
});

test("a forgiving list drops an empty selector instead of keeping it", () => {
  // Used to serialize as `a:is(,.x)`, which is a syntax error browsers drop.
  expect(minifyTest("a:is(, .x) { color: red }", "a.x{color:red}")).toBe("a.x{color:red}");
  // `a:is()` matches nothing; it must not be reduced to `a` (which matches everything).
  expect(minifyTest("a:is() { color: red }", "a:is(){color:red}")).toBe("a:is(){color:red}");
});
