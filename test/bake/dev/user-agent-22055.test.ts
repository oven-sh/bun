import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

// Test for issue #22055: https://github.com/oven-sh/bun/issues/22055
// Development server should return plain text errors for clients that don't accept HTML
devTest("returns appropriate errors based on Accept header (#22055)", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function (req, meta) {
        // Create a syntax error to trigger the error page
        import('./nonexistent-module.js');
        return new Response('Hello World');
      }
    `,
  },
  async test(dev) {
    // Test with Accept: text/html (should get HTML)
    const htmlResponse = await dev.fetch("/", {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    
    expect(htmlResponse.status).toBe(500);
    const htmlText = await htmlResponse.text();
    expect(htmlResponse.headers.get("content-type")).toContain("text/html");
    expect(htmlText).toContain("<!doctype html>");

    // Test without HTML in Accept header (should get plain text)
    const plainResponse = await dev.fetch("/", {
      headers: {
        "Accept": "application/json, text/plain"
      }
    });
    
    expect(plainResponse.status).toBe(500);
    const plainText = await plainResponse.text();
    expect(plainResponse.headers.get("content-type")).toContain("text/plain");
    expect(plainText).toContain("Build Failed");
    expect(plainText).toContain("Bun development server encountered an error");
    expect(plainText).not.toContain("<!doctype html>");
    expect(plainText).not.toContain("<script>");
  },
});
