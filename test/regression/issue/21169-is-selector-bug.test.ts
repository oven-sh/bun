import { describe, test } from "bun:test";
import { cssTest } from "../../js/bun/css/util";

describe("issue #21169 - :is() selector bug", () => {
  // Test case for the original bug report
  test("should not collapse .foo:is(input:checked) to .fooinput:checked", () => {
    cssTest(
      ".foo:is(input:checked) { color: red; }",
      ".foo:is(input:checked) {\n  color: red;\n}",
    );
  });

  // Additional test cases for similar compound selectors
  test("should handle :is() with input:hover", () => {
    cssTest(
      ".foo:is(input:hover) { color: blue; }",
      ".foo:is(input:hover) {\n  color: #00f;\n}",
    );
  });

  test("should handle :is() with input.checked", () => {
    cssTest(
      ".foo:is(input.checked) { color: purple; }",
      ".foo:is(input.checked) {\n  color: purple;\n}",
    );
  });

  // Test that class-only selectors can still be optimized
  test("should still optimize class-only :is() selectors", () => {
    cssTest(
      ".foo:is(.bar) { color: yellow; }",
      ".foo.bar {\n  color: #ff0;\n}",
    );
  });

  // Test that simple type selectors are preserved
  test("should preserve simple type selectors in :is()", () => {
    cssTest(
      ".foo:is(input) { color: green; }",
      ".foo:is(input) {\n  color: green;\n}",
    );
  });

  // Test multiple selectors in :is() - should work correctly
  test("should handle multiple selectors in :is()", () => {
    cssTest(
      ".foo:is(input:checked, input:valid) { color: orange; }",
      ".foo:is(input:checked, input:valid) {\n  color: orange;\n}",
    );
  });

  // Test :where() - should work correctly (mentioned as workaround)
  test("should handle :where() selector correctly", () => {
    cssTest(
      ".foo:where(input:checked) { color: pink; }",
      ".foo:where(input:checked) {\n  color: pink;\n}",
    );
  });
});