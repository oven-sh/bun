import { describe, expect, it } from "bun:test";

describe("HTMLRewriter", () => {
  // When transforming a string or ArrayBuffer, lol-html may invoke the text
  // handler from end() for the final lastInTextNode chunk. If that handler
  // returns a rejected promise, the output Response is still owned by its JS
  // wrapper and must not be destroyed directly — previously this caused a
  // use-after-free when the wrapper was later garbage collected.
  it("does not crash when a document text handler rejects during end() on an ArrayBuffer input", () => {
    for (let i = 0; i < 50; i++) {
      const rewriter = new HTMLRewriter();
      rewriter.onDocument({
        text(chunk) {
          if (chunk.lastInTextNode) {
            return Promise.reject(new Error("boom"));
          }
        },
      });
      expect(() => rewriter.transform(new Uint8Array([97, 98, 99]).buffer)).toThrow();
      Bun.gc(true);
    }
  });

  it("does not crash when a document text handler rejects during end() on a string input", () => {
    for (let i = 0; i < 50; i++) {
      const rewriter = new HTMLRewriter();
      rewriter.onDocument({
        text(chunk) {
          if (chunk.lastInTextNode) {
            return Promise.reject(new Error("boom"));
          }
        },
      });
      expect(() => rewriter.transform("abc")).toThrow();
      Bun.gc(true);
    }
  });
});
