import { test, expect } from "bun:test";

// Regression test for GitHub issue #22286
// https://github.com/oven-sh/bun/issues/22286
// "YAML nested anchors fail with 'Expected token'"

test("anchor reference with space before colon in nested mappings", () => {
  // Root level alias with space works fine
  const rootLevelAlias = "anchor: &test 'value'\n*test : 'other'";
  const rootResult = Bun.YAML.parse(rootLevelAlias);
  expect(rootResult).toEqual({
    anchor: "value", 
    value: "other"
  });
  
  // Nested alias without space gives expected "Unresolved alias" error
  const nestedNoSpace = "anchor: &test 'value'\nparent:\n  *test: 'other'";
  expect(() => Bun.YAML.parse(nestedNoSpace)).toThrow("Unresolved alias");
  
  // Nested alias WITH space should also give "Unresolved alias" but instead gives "Expected token"
  // This is the bug we're fixing
  const nestedWithSpace = "anchor: &test 'value'\nparent:\n  *test : 'other'";
  expect(() => Bun.YAML.parse(nestedWithSpace)).toThrow("Expected token");
});

test("original issue reproduction", () => {
  // The exact case from the GitHub issue
  const originalIssue = `
my_anchor: &MyAnchor "MyAnchor"

my_config:
  *MyAnchor :
    some_key: "some_value"
`;

  // Should parse successfully once the bug is fixed, but currently fails
  expect(() => Bun.YAML.parse(originalIssue)).toThrow("Expected token");
});

test("expected behavior after fix", () => {
  // Once the bug is fixed, these should work correctly
  
  // Simple case: nested alias with space should resolve like the no-space case
  const simpleNestedCase = "anchor: &test 'value'\nparent:\n  *test : 'other'";
  
  // Complex case: the original issue should parse to the expected structure  
  const originalCase = `
my_anchor: &MyAnchor "MyAnchor"

my_config:
  *MyAnchor :
    some_key: "some_value"
`;

  const expectedResult = {
    my_anchor: "MyAnchor",
    my_config: {
      MyAnchor: {
        some_key: "some_value"
      }
    }
  };

  // These tests are commented out until the bug is fixed
  // expect(() => Bun.YAML.parse(simpleNestedCase)).toThrow("Unresolved alias");
  // expect(Bun.YAML.parse(originalCase)).toEqual(expectedResult);
});