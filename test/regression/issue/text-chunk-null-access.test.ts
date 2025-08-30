import { test, expect } from "bun:test";

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
  
  // Try to access properties after transformation is complete
  // This reproduces the original crash: "panic: attempt to use null value"
  const removedValue = textChunkRef.removed;
  const lastInTextNodeValue = textChunkRef.lastInTextNode;
  
  // These should return false when text_chunk is null (after fix)
  expect(typeof removedValue).toBe("boolean");
  expect(typeof lastInTextNodeValue).toBe("boolean");
  expect(removedValue).toBe(false);
  expect(lastInTextNodeValue).toBe(false);
});