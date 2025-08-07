import { test, expect } from "bun:test";

// Issue #21680: HTMLRewriter crashes when calling before() without arguments
// LOCAL REPRODUCTION FOUND: Partially consumed responses trigger crash

test("HTMLRewriter crashes with partially consumed responses - LOCAL REPRO", async () => {
  // This reproduces a crash locally without external dependencies!
  // The crash occurs when:
  // 1. Response stream is partially consumed
  // 2. HTMLRewriter element method called without arguments
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <script>console.log("test");</script>
    </head>
    </html>
  `;
  
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(html, {
        headers: { "content-type": "text/html; charset=UTF-8" }
      });
    }
  });
  
  // Fetch response
  const response = await fetch(`http://localhost:${server.port}/`);
  
  // KEY: Partially consume the response stream
  const reader = response.body!.getReader();
  await reader.read(); // Read some data
  reader.releaseLock();
  
  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      // This crashes with "panic: reached unreachable code" instead of throwing proper error
      element.before();
    },
  });
  
  // This should throw an error, not crash Bun with SIGTRAP
  expect(() => {
    rewriter.transform(response);
  }).toThrow("Missing argument");
});

test("HTMLRewriter original external URL crash - EXACT REPRO", async () => {
  // This is the exact reproduction from GitHub issue #21680
  // Skip by default to avoid external dependencies and crashes
  return; // Remove this line to test actual crash
  
  const response = await fetch("https://loja.navesa.com.br/lateral-interna-do-paralama-dianteiro-esquerdo-para-renault-sandero-2014-ate-2023-cod-638313232r?_pid=xsbbc");
  
  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      // This crashes with "ASSERTION FAILED" + SIGABRT
      element.before();
    },
  });
  
  // This should throw error, not crash
  expect(() => {
    rewriter.transform(response);
  }).toThrow("Missing argument");
});

test("HTMLRewriter should handle normal responses correctly", () => {
  // This demonstrates correct behavior with normal (non-consumed) responses
  const html = `<script>console.log("test");</script>`;
  const response = new Response(html, {
    headers: { "content-type": "text/html; charset=UTF-8" }
  });
  
  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      element.before(); // Should throw proper error
    },
  });

  // This correctly throws TypeError instead of crashing
  expect(() => {
    rewriter.transform(response);
  }).toThrow("Missing argument");
});

test("HTMLRewriter all element methods should handle missing arguments properly", () => {
  // Test all methods that should throw proper errors, not crash
  const html = `<div>test</div><script>test</script>`;
  
  const methods = [
    { name: 'before', selector: 'div', test: (el) => el.before() },
    { name: 'after', selector: 'div', test: (el) => el.after() },
    { name: 'replace', selector: 'div', test: (el) => el.replace() },
    { name: 'prepend', selector: 'div', test: (el) => el.prepend() },
    { name: 'append', selector: 'div', test: (el) => el.append() },
    { name: 'setInnerContent', selector: 'script', test: (el) => el.setInnerContent() },
  ];
  
  methods.forEach(({ name, selector, test }) => {
    const rewriter = new HTMLRewriter().on(selector, {
      element: test
    });
    
    // All should throw proper errors, not crash the process
    expect(() => {
      rewriter.transform(new Response(html));
    }).toThrow("Missing argument");
  });
});

test("HTMLRewriter methods work correctly with proper arguments", async () => {
  // Verify methods work when called correctly
  const html = `<div>test</div>`;
  const response = new Response(html);
  
  const rewriter = new HTMLRewriter().on("div", {
    element(element) {
      element.before("<!-- before -->");
      element.after("<!-- after -->");
      element.prepend("<!-- prepend -->");
      element.append("<!-- append -->");
    },
  });

  const result = rewriter.transform(response);
  const text = await result.text();
  
  // All modifications should be applied correctly
  expect(text).toMatch(/(?:<!-- before -->|&lt;!-- before --&gt;)/);
  expect(text).toMatch(/(?:<!-- after -->|&lt;!-- after --&gt;)/);
  expect(text).toMatch(/(?:<!-- prepend -->|&lt;!-- prepend --&gt;)/);
  expect(text).toMatch(/(?:<!-- append -->|&lt;!-- append --&gt;)/);
});