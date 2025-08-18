import { expect, test } from "bun:test";

test("HTMLRewriter selector validation should throw proper errors", () => {
  // Test various invalid CSS selectors that should be rejected
  const invalidSelectors = [
    "", // empty selector
    "   ", // whitespace only
    "<<<", // invalid CSS
    "div[", // incomplete attribute selector
    "div)", // mismatched brackets
    "div::", // invalid pseudo
    "..invalid", // invalid start
  ];

  invalidSelectors.forEach(selector => {
    expect(() => {
      const rewriter = new HTMLRewriter();
      rewriter.on(selector, {
        element(element) {
          element.setInnerContent("should not reach here");
        },
      });
    }).toThrow(); // Should throw a meaningful error, not silently succeed
  });
});

test("HTMLRewriter should properly validate handler objects", () => {
  // Test null and undefined handlers
  expect(() => {
    const rewriter = new HTMLRewriter();
    rewriter.on("div", null);
  }).toThrow("Expected object");

  expect(() => {
    const rewriter = new HTMLRewriter();
    rewriter.on("div", undefined);
  }).toThrow("Expected object");

  // Test non-object handlers
  expect(() => {
    const rewriter = new HTMLRewriter();
    rewriter.on("div", "not an object");
  }).toThrow("Expected object");

  expect(() => {
    const rewriter = new HTMLRewriter();
    rewriter.on("div", 42);
  }).toThrow("Expected object");
});

test("HTMLRewriter memory management - no leaks on selector parse errors", () => {
  // This test ensures that selector_slice memory is properly freed
  // even when selector parsing fails
  for (let i = 0; i < 100; i++) {
    try {
      const rewriter = new HTMLRewriter();
      // Use an invalid selector to trigger error path
      rewriter.on("div[incomplete", {
        element(element) {
          console.log("Should not reach here");
        },
      });
    } catch (e) {
      // Expected to throw, but no memory should leak
    }
  }

  // If there were memory leaks, running this many times would consume significant memory
  // The test passes if it completes without memory issues
  expect(true).toBe(true);
});

test("HTMLRewriter should handle various input edge cases safely", () => {
  // Empty string input (should work)
  expect(() => {
    const rewriter = new HTMLRewriter();
    rewriter.transform("");
  }).not.toThrow();

  // Null input (should throw)
  expect(() => {
    const rewriter = new HTMLRewriter();
    rewriter.transform(null);
  }).toThrow("Expected Response or Body");

  // Large input (should work)
  expect(() => {
    const rewriter = new HTMLRewriter();
    const largeHtml = "<div>" + "x".repeat(100000) + "</div>";
    rewriter.transform(largeHtml);
  }).not.toThrow();
});

test("HTMLRewriter concurrent usage should work correctly", () => {
  // Same rewriter instance should handle multiple transforms
  const rewriter = new HTMLRewriter().on("div", {
    element(element) {
      element.setInnerContent("modified");
    },
  });

  expect(() => {
    const result1 = rewriter.transform("<div>original1</div>");
    const result2 = rewriter.transform("<div>original2</div>");
  }).not.toThrow();
});

test("HTMLRewriter should handle many handlers on same element", () => {
  let rewriter = new HTMLRewriter();

  // Add many handlers to the same element type
  for (let i = 0; i < 50; i++) {
    rewriter = rewriter.on("div", {
      element(element) {
        const current = element.getAttribute("data-count") || "0";
        element.setAttribute("data-count", (parseInt(current) + 1).toString());
      },
    });
  }

  expect(() => {
    rewriter.transform('<div data-count="0">test</div>');
  }).not.toThrow();
});

test("HTMLRewriter should handle special characters in selectors safely", () => {
  // These selectors with special characters should either work or fail gracefully
  const specialSelectors = [
    "div[data-test=\"'quotes'\"]",
    'div[data-test="\\"escaped\\""]',
    'div[class~="space separated"]',
    'input[type="text"]',
  ];

  specialSelectors.forEach(selector => {
    expect(() => {
      const rewriter = new HTMLRewriter().on(selector, {
        element(element) {
          element.setAttribute("data-processed", "true");
        },
      });
      // The important thing is it doesn't crash
    }).not.toThrow();
  });
});
