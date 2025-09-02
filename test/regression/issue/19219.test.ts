import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/19219
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
