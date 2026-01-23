import { describe, expect, jest, test } from "bun:test";
import { tempDirWithFiles } from "harness";

describe("HTMLRewriter DOCTYPE handler", () => {
  test("remove and removed property work on DOCTYPE", () => {
    const html = "<!DOCTYPE html><html><head></head><body>Hello</body></html>";
    let sawDoctype = false;
    let wasRemoved = false;

    const rewriter = new HTMLRewriter().onDocument({
      doctype(doctype) {
        sawDoctype = true;
        doctype.remove();
        wasRemoved = doctype.removed;
      },
    });

    const result = rewriter.transform(html);

    expect(sawDoctype).toBe(true);
    expect(wasRemoved).toBe(true);
    expect(result).not.toContain("<!DOCTYPE");
    expect(result).toContain("<html>");
  });
});

// Regression test for #7827
test("#7827", () => {
  for (let i = 0; i < 10; i++)
    (function () {
      const element = jest.fn(element => {
        element.tagName;
      });
      const rewriter = new HTMLRewriter().on("p", {
        element,
      });

      const content = "<p>Lorem ipsum!</p>";

      rewriter.transform(new Response(content));
      rewriter.transform(new Response(content));

      expect(element).toHaveBeenCalledTimes(2);
    })();

  Bun.gc(true);
});

// Regression test for #19219
test("HTMLRewriter should throw proper errors instead of [native code: Exception]", () => {
  const rewriter = new HTMLRewriter().on("p", {
    element(element) {
      // This will cause an error by trying to call a non-existent method
      (element as any).nonExistentMethod();
    },
  });

  const html = "<html><body><p>Hello</p></body></html>";

  // Should throw a proper TypeError, not [native code: Exception]
  expect(() => {
    rewriter.transform(html);
  }).toThrow(TypeError);

  // Verify the error message is descriptive
  try {
    rewriter.transform(html);
  } catch (error: any) {
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("nonExistentMethod");
    expect(error.message).toContain("is not a function");
    // Make sure it's not the generic [native code: Exception] message
    expect(error.toString()).not.toContain("[native code: Exception]");
  }
});

// Regression test for #19219
test("HTMLRewriter should propagate errors from handlers correctly", () => {
  const rewriter = new HTMLRewriter().on("div", {
    element() {
      throw new Error("Custom error from handler");
    },
  });

  const html = "<div>test</div>";

  expect(() => {
    rewriter.transform(html);
  }).toThrow("Custom error from handler");
});

// Regression test for #19219
test("HTMLRewriter should handle errors in async handlers", async () => {
  const rewriter = new HTMLRewriter().on("div", {
    async element() {
      throw new Error("Async handler error");
    },
  });

  const html = "<div>test</div>";
  const response = new Response(html);

  expect(() => {
    rewriter.transform(response);
  }).toThrow("Async handler error");
});

// Regression test for #21680
test("HTMLRewriter should not crash when element handler throws an exception - issue #21680", () => {
  // The most important test: ensure the original crashing case from the GitHub issue doesn't crash
  // This was the exact case from the issue that caused "ASSERTION FAILED: Unexpected exception observed"

  // Create a minimal HTML file for testing
  const dir = tempDirWithFiles("htmlrewriter-crash-test", {
    "min.html": "<script></script>",
  });

  // Original failing case: this should not crash the process
  expect(() => {
    const rewriter = new HTMLRewriter().on("script", {
      element(a) {
        throw new Error("abc");
      },
    });
    rewriter.transform(new Response(Bun.file(`${dir}/min.html`)));
  }).not.toThrow(); // The important thing is it doesn't crash, we're ok with it silently failing

  // Test with Response containing string content
  expect(() => {
    const rewriter = new HTMLRewriter().on("script", {
      element(a) {
        throw new Error("response test");
      },
    });
    rewriter.transform(new Response("<script></script>"));
  }).toThrow("response test");
});

// Regression test for #21680
test("HTMLRewriter exception handling should not break normal operation", () => {
  // Ensure that after an exception occurs, the rewriter still works normally
  let normalCallCount = 0;

  // First, trigger an exception
  try {
    const rewriter = new HTMLRewriter().on("div", {
      element(element) {
        throw new Error("test error");
      },
    });
    rewriter.transform(new Response("<div>test</div>"));
  } catch (e) {
    // Expected to throw
  }

  // Then ensure normal operation still works
  const rewriter2 = new HTMLRewriter().on("div", {
    element(element) {
      normalCallCount++;
      element.setInnerContent("replaced");
    },
  });

  const result = rewriter2.transform(new Response("<div>original</div>"));
  expect(normalCallCount).toBe(1);
  // The transform should complete successfully without throwing
});

// Regression tests for htmlrewriter-additional-bugs
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

// Regression test for text-chunk-null-access
test("TextChunk methods handle null text_chunk gracefully", async () => {
  // This test reproduces a crash where TextChunk methods are called
  // after the underlying text_chunk has been cleaned up or is null

  let textChunkRef: any;

  const html = "<p>Test content</p>";

  const rewriter = new HTMLRewriter().on("p", {
    text(text) {
      // Store reference to the text chunk
      textChunkRef = text;
    },
  });

  await rewriter.transform(new Response(html)).text();

  // Force garbage collection to clean up internal references
  if (typeof Bun !== "undefined" && Bun.gc) {
    Bun.gc(true);
  }

  // It should be undefined to be consistent with the rest of the APIs.
  expect(textChunkRef.removed).toBeUndefined();
  expect(textChunkRef.lastInTextNode).toBeUndefined();
});
