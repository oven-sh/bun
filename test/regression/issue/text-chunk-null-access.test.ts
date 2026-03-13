import { expect, test } from "bun:test";

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
