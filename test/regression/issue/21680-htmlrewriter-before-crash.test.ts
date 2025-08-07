import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Issue #21680: HTMLRewriter crashes when calling before() without arguments
// When used with fetch() responses, causes "ASSERTION FAILED" and crashes Bun with SIGABRT

test("HTMLRewriter element.before() crashes Bun when called without arguments on fetch response", async () => {
  // CONFIRMED CRASH: This reproduces the exact issue from GitHub #21680
  // v1.2.19: "panic(main thread): unreachable" 
  // Current: "ASSERTION FAILED" + SIGABRT
  // The exact URL from the original issue is needed to trigger the crash
  
  const testScript = `
    // Exact reproduction from GitHub issue #21680
    const a = await fetch("https://loja.navesa.com.br/lateral-interna-do-paralama-dianteiro-esquerdo-para-renault-sandero-2014-ate-2023-cod-638313232r?_pid=xsbbc")
    const rewriter = new HTMLRewriter().on("script", {
        element(a) {
            console.log(a.before())
        },
    });
    rewriter.transform(a)
  `;

  const dir = tempDirWithFiles("htmlrewriter-crash-test", {
    "crash-test.js": testScript,
  });

  // Run the test script in a separate Bun process to capture the crash
  await using proc = Bun.spawn({
    cmd: [bunExe(), "crash-test.js"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  
  // This SHOULD crash - the issue is still present
  // v1.2.19: "panic(main thread): unreachable" 
  // Current: "ASSERTION FAILED" + SIGABRT
  expect(exitCode).not.toBe(0);
  expect(stderr).toMatch(/ASSERTION FAILED|panic.*unreachable|SIGABRT|Aborted/);
});

test("HTMLRewriter element.before() throws with local Response (current behavior)", () => {
  // This demonstrates the current behavior with local Response objects
  const html = `<script>console.log("test");</script>`;
  const response = new Response(html, {
    headers: { "content-type": "text/html" }
  });
  
  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      // With local Response, this throws TypeError instead of crashing
      element.before();
    },
  });

  // Should throw TypeError with "Missing argument", not crash
  expect(() => {
    rewriter.transform(response);
  }).toThrow("Missing argument");
});

test("HTMLRewriter element content methods all have same issue", () => {
  // Test that all content methods have the same parameter validation issue
  const html = `<div>test</div>`;
  const response = new Response(html);
  
  // All these methods should throw proper errors, not crash
  const rewriter1 = new HTMLRewriter().on("div", { element(el) { el.after(); } });
  const rewriter2 = new HTMLRewriter().on("div", { element(el) { el.replace(); } });
  const rewriter3 = new HTMLRewriter().on("div", { element(el) { el.prepend(); } });
  const rewriter4 = new HTMLRewriter().on("div", { element(el) { el.append(); } });
  const rewriter5 = new HTMLRewriter().on("div", { element(el) { el.setInnerContent(); } });
  
  expect(() => rewriter1.transform(new Response(html))).toThrow("Missing argument");
  expect(() => rewriter2.transform(new Response(html))).toThrow("Missing argument");
  expect(() => rewriter3.transform(new Response(html))).toThrow("Missing argument");
  expect(() => rewriter4.transform(new Response(html))).toThrow("Missing argument");
  expect(() => rewriter5.transform(new Response(html))).toThrow("Missing argument");
});

test("HTMLRewriter element methods work correctly with arguments", async () => {
  // Verify methods work correctly when called with proper arguments
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
  expect(result).toBeDefined();
  expect(result.constructor.name).toBe("Response");
  
  // Verify the content was actually modified
  const text = await result.text();
  // Content may be HTML-encoded
  expect(text).toMatch(/(?:<!-- before -->|&lt;!-- before --&gt;)/);
  expect(text).toMatch(/(?:<!-- after -->|&lt;!-- after --&gt;)/);
  expect(text).toMatch(/(?:<!-- prepend -->|&lt;!-- prepend --&gt;)/);
  expect(text).toMatch(/(?:<!-- append -->|&lt;!-- append --&gt;)/);
});