import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

// Test for issue #22055: https://github.com/oven-sh/bun/issues/22055
// Development server should return plain text errors for non-browser User-Agents
devTest("returns plain text errors for non-browser User-Agent (#22055)", {
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
    // Test with browser User-Agent (should get HTML)
    const browserResponse = await dev.fetch("/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });
    
    expect(browserResponse.status).toBe(500);
    const browserText = await browserResponse.text();
    expect(browserResponse.headers.get("content-type")).toContain("text/html");
    expect(browserText).toContain("<!doctype html>");

    // Test with non-browser User-Agent (should get plain text)
    const fetchResponse = await dev.fetch("/", {
      headers: {
        "User-Agent": "fetch/1.0"
      }
    });
    
    expect(fetchResponse.status).toBe(500);
    const fetchText = await fetchResponse.text();
    expect(fetchResponse.headers.get("content-type")).toContain("text/plain");
    expect(fetchText).toContain("Build Failed");
    expect(fetchText).toContain("Bun development server encountered an error");
    expect(fetchText).not.toContain("<!doctype html>");
    expect(fetchText).not.toContain("<script>");
  },
});