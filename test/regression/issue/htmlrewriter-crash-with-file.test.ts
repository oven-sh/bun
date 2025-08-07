import { test, expect } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

test("HTMLRewriter should not crash with Bun.file() and element handler error", async () => {
  // Create a temporary HTML file
  const dir = tempDirWithFiles("htmlrewriter-crash", {
    "min.html": "<script></script>",
  });

  const filePath = join(dir, "min.html");
  
  // This should not crash the process. The error handling varies between
  // synchronous and asynchronous processing, but it should never crash.
  let didNotCrash = false;
  try {
    const rewriter = new HTMLRewriter().on("script", {
      element(a) {
        throw new Error("abc");
      },
    });
    const response = rewriter.transform(new Response(Bun.file(filePath)));
    
    // For file inputs, the processing is asynchronous, so errors may not
    // be thrown synchronously but should be handled gracefully
    if (response) {
      try {
        await response.text();
      } catch (error) {
        // Expected to possibly throw an error during async processing
      }
    }
    didNotCrash = true;
  } catch (error) {
    // Any error here is fine as long as it doesn't crash the process
    didNotCrash = true;
  }
  
  // The main assertion is that we reach this point without crashing
  expect(didNotCrash).toBe(true);
});