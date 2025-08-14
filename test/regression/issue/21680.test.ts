import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";

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
