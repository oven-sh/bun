import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const { minifyTest } = cssInternals;

// `:nth-child(An+B of <selectors>)` takes a <complex-real-selector-list>, which is
// NOT a forgiving selector list (https://drafts.csswg.org/selectors/#the-nth-child-pseudo):
// one invalid selector must invalidate the whole pseudo-class. It used to be parsed
// with the :is()/:where() forgiving mode instead, so when every selector in the
// of-list was invalid the list was silently emptied and serialized as
// `:nth-child(2n of )`, a syntax error every browser drops.
//
// Separately, `parse_compound_selector` discarded `parse_type_selector`'s boolean
// ("did a type selector get parsed") and its errors, so a selector with no simple
// selectors at all parsed as a valid empty selector. That let `:nth-child(2n of)`,
// ` { color: red }`, and `.a, , .b { }` through as well.

// An unfixed build asserts on the empty of-list in the serializer, so run each
// input through a child process to keep the test runner alive either way.
// Returns the single line the child prints: `ok: <minified>` or `error: <message>`.
async function minifyInChild(css: string): Promise<{ stdout: string; exitCode: number | null }> {
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
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), exitCode };
}

test.concurrent("an of-list made only of a pseudo-element invalidates the rule", async () => {
  expect(await minifyInChild("a:nth-child(2n of ::before) { color: red }")).toEqual({
    stdout: "error: parsing failed: Invalid selector. Token is not allowed in this state",
    exitCode: 0,
  });
});

test.concurrent("an of-list made only of a lexically invalid selector invalidates the rule", async () => {
  expect(await minifyInChild("a:nth-child(2n of %bad) { color: red }")).toEqual({
    stdout: "error: parsing failed: Invalid selector. Empty selector is not allowed",
    exitCode: 0,
  });
});

test.concurrent("an of-list made only of a bad-string token invalidates the rule", async () => {
  expect(await minifyInChild('div:nth-child(2n of [q="x\n]) { color: red }')).toEqual({
    stdout: "error: parsing failed: Invalid selector. Invalid value in attribute selector: x",
    exitCode: 0,
  });
});

// Non-forgiving means one invalid selector invalidates the whole list, even when
// another selector in it is valid on its own.
test.concurrent("a valid selector does not rescue an of-list with an invalid one", async () => {
  expect(await minifyInChild("a:nth-child(2n of .valid, ::before) { color: red }")).toEqual({
    stdout: "error: parsing failed: Invalid selector. Token is not allowed in this state",
    exitCode: 0,
  });
});

test.concurrent(":nth-last-child takes the same of-list grammar", async () => {
  expect(await minifyInChild("a:nth-last-child(2n of ::before) { color: red }")).toEqual({
    stdout: "error: parsing failed: Invalid selector. Token is not allowed in this state",
    exitCode: 0,
  });
});

test.concurrent("an empty of-list invalidates the rule", async () => {
  expect(await minifyInChild("a:nth-child(2n of) { color: red }")).toEqual({
    stdout: "error: parsing failed: Invalid selector. Empty selector is not allowed",
    exitCode: 0,
  });
});

test.concurrent("an empty selector before a comma invalidates the of-list", async () => {
  expect(await minifyInChild("a:nth-child(2n of , .x) { color: red }")).toEqual({
    stdout: "error: parsing failed: Invalid selector. Empty selector is not allowed",
    exitCode: 0,
  });
});

test.concurrent("valid of-lists still parse and minify", async () => {
  expect(await minifyInChild(":nth-child(even of li.important) {width: 20px}")).toEqual({
    stdout: "ok: :nth-child(2n of li.important){width:20px}",
    exitCode: 0,
  });
  expect(await minifyInChild(":nth-last-child(2n of li.important, .other) {width: 20px}")).toEqual({
    stdout: "ok: :nth-last-child(2n of li.important, .other){width:20px}",
    exitCode: 0,
  });
  expect(await minifyInChild("a:nth-child(2n of *) { color: red }")).toEqual({
    stdout: "ok: a:nth-child(2n of *){color:red}",
    exitCode: 0,
  });
});

// `parse_compound_selector` regressions: an empty selector is an error everywhere.
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
