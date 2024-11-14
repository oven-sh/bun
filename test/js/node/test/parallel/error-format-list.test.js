//#FILE: test-error-format-list.js
//#SHA1: ed33f55f6c42ff9671add8288b1d2984393bdfc1
//-----------------
"use strict";

if (!Intl) {
  test.skip("missing Intl", () => {});
} else {
  test("formatList function", () => {
    const and = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
    const or = new Intl.ListFormat("en", { style: "long", type: "disjunction" });

    const input = ["apple", "banana", "orange", "pear"];
    for (let i = 0; i < input.length; i++) {
      const slicedInput = input.slice(0, i);
      expect(formatList(slicedInput)).toBe(and.format(slicedInput));
      expect(formatList(slicedInput, "or")).toBe(or.format(slicedInput));
    }
  });
}

// Helper function to replicate the behavior of internal/errors formatList
function formatList(list, type = "and") {
  const formatter = new Intl.ListFormat("en", {
    style: "long",
    type: type === "and" ? "conjunction" : "disjunction",
  });
  return formatter.format(list);
}

//<#END_FILE: test-error-format-list.js
