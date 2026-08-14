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

function rejected(message: string) {
  return `error: parsing failed: ${message}`;
}

function minified(output: string) {
  return `ok: ${output}`;
}

const cases: [css: string, expected: string][] = [
  // --- :nth-child(An+B of <selectors>) ---

  // An of-list made only of invalid selectors invalidates the rule: a
  // pseudo-element, a lexically invalid selector, a bad-string token.
  ["a:nth-child(2n of ::before) { color: red }", rejected("Invalid selector. Token is not allowed in this state")],
  ["a:nth-child(2n of %bad) { color: red }", rejected("Invalid selector. Empty selector is not allowed")],
  [
    'div:nth-child(2n of [q="x\n]) { color: red }',
    rejected("Invalid selector. Invalid value in attribute selector: x"),
  ],
  // Non-forgiving means one invalid selector invalidates the whole list, even
  // when another selector in it is valid on its own.
  [
    "a:nth-child(2n of .valid, ::before) { color: red }",
    rejected("Invalid selector. Token is not allowed in this state"),
  ],
  // :nth-last-child takes the same of-list grammar.
  ["a:nth-last-child(2n of ::before) { color: red }", rejected("Invalid selector. Token is not allowed in this state")],
  // An empty of-list, or an empty selector before a comma in one.
  ["a:nth-child(2n of) { color: red }", rejected("Invalid selector. Empty selector is not allowed")],
  ["a:nth-child(2n of , .x) { color: red }", rejected("Invalid selector. Empty selector is not allowed")],
  // Valid of-lists still parse and minify.
  [":nth-child(even of li.important) {width: 20px}", minified(":nth-child(2n of li.important){width:20px}")],
  [
    ":nth-last-child(2n of li.important, .other) {width: 20px}",
    minified(":nth-last-child(2n of li.important, .other){width:20px}"),
  ],
  ["a:nth-child(2n of *) { color: red }", minified("a:nth-child(2n of *){color:red}")],

  // --- :has(<relative-selector-list>) ---

  // A list made only of a lexically invalid selector, or of a lone comma,
  // invalidates the rule.
  ["a:has(%bad) { color: red }", rejected("Invalid selector. Empty selector is not allowed")],
  ["a:has(,) { color: red }", rejected("Unexpected end of input")],
  // A valid selector does not rescue a list with an invalid one.
  ["a:has(> .x, %bad) { color: red }", rejected("Invalid selector. Empty selector is not allowed")],
  // Valid lists still parse and minify.
  ["a:has(.x) { color: red }", minified("a:has(.x){color:red}")],
  ["a:has(> .x, ~ .y) { color: red }", minified("a:has(>.x,~.y){color:red}")],
];

// An unfixed build asserts on the empty of-list in the serializer, so the inputs
// run in a child process to keep the test runner alive either way. One child for
// all of them: a debug build takes a couple of seconds to start, so a child per
// input does not fit in the per-test timeout. The child prints a `[css, result]`
// line per input, so if it crashes the diff still shows how far it got.
test("of-lists and :has() lists are parsed non-forgivingly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { minifyTest } = require("bun:internal-for-testing").cssInternals;
for (const css of ${JSON.stringify(cases.map(([css]) => css))}) {
  let result;
  try {
    result = "ok: " + minifyTest(css, "");
  } catch (e) {
    result = "error: " + e.message;
  }
  console.log(JSON.stringify([css, result]));
}`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results = stdout
    .split("\n")
    .filter(line => line !== "")
    .map(line => JSON.parse(line));

  expect({ results, stderr, exitCode }).toEqual({ results: cases, stderr: "", exitCode: 0 });
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
