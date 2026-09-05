// Every expect matcher must bump the test runner's expect-call counter so
// `expect.assertions(n)` / `expect.hasAssertions()` work. Matchers either call
// `increment_expect_call_counter()` directly or route through one of the
// shared prologues that call it.
import { expect, test } from "bun:test";
import path from "node:path";
import { parseRustFragment, pathEndsWith, type Node, type RustFile } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

const MATCHER_DIR = "src/runtime/test_runner/expect/";

// Helpers that call increment_expect_call_counter() internally (verified in
// src/runtime/test_runner/expect.rs and mod.rs). A trailing `!` marks a macro.
const satisfying = [
  "increment_expect_call_counter",
  "matcher_prelude",
  "unary_predicate_matcher!",
  "run_unary_predicate",
  "run_string_affix_matcher",
  "contain_matcher",
  "numeric_ordering_matcher",
  "mock_prologue",
];

// Matchers that delegate to another matcher's implementation.
const excluded = [MATCHER_DIR + "toHaveReturnedTimes.rs"];

const FUNCTIONS = new Set(satisfying.filter(token => !token.endsWith("!")));
const MACROS = satisfying.filter(token => token.endsWith("!")).map(token => token.slice(0, -1));

// A node that names one of the helpers: a path segment (`Expect::increment_expect_call_counter`),
// a method call (`self.matcher_prelude(...)`), or a macro invocation
// (`crate::unary_predicate_matcher!(...)`). Exact names: the text match this replaced accepted
// any identifier containing one as a substring, and prose in comments.
function namesCounterBump(node: Node): boolean {
  switch (node.kind) {
    case "PathSegment":
      return FUNCTIONS.has(node.name);
    case "MethodCall":
      return FUNCTIONS.has(node.method);
    case "Macro":
      return MACROS.some(name => pathEndsWith(node.path, name));
    default:
      return false;
  }
}

function findCounterBumps(file: RustFile): Node[] {
  return file.findAll(namesCounterBump);
}

const matchers = rustSources({ scope: [MATCHER_DIR], exclude: excluded });

test("the query recognizes the spellings it claims to", () => {
  const bumps = (snippet: string) => findCounterBumps(parseRustFragment(snippet)).length > 0;
  const satisfied = [
    "this.increment_expect_call_counter();",
    'self.matcher_prelude(global, frame.this(), "toBe", "<green>expected<r>")?;',
    'crate::unary_predicate_matcher!(to_be_array, "toBeArray", |v| v.js_type().is_array());',
    'let (this, calls, _value) = this.mock_prologue(global, frame.this(), "toHaveBeenCalled", "")?;',
    "Expect::increment_expect_call_counter(this);",
    // rustfmt-wrapped.
    'self.run_string_affix_matcher(\n    g,\n    f,\n    "toStartWith",\n    "start with",\n    strings::starts_with,\n)',
  ];
  const unsatisfied = [
    "// this.increment_expect_call_counter();",
    'log("matcher_prelude");',
    "this.increment_expect_call_counter_later();",
    "self.run_unary_predicates(g, f);",
    "unary_predicate_matcher(to_be_array);",
    "macro_rules! m { () => { this.increment_expect_call_counter(); }; }",
  ];
  expect(satisfied.filter(s => !bumps(s))).toEqual([]);
  expect(unsatisfied.filter(bumps)).toEqual([]);
});

test("every expect matcher increments the expect-call counter", () => {
  expect(matchers.length).toBeGreaterThan(40);

  const missing: string[] = [];
  for (const src of matchers) {
    if (findCounterBumps(src.file).length === 0) missing.push(path.basename(src.path));
  }

  expect(missing).toEqual([]);
});
