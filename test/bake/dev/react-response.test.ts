import { expect } from "bun:test";
import { ByteBuffer } from "peechy";
import { decodeFallbackMessageContainer } from "../../../src/api/schema";
import { devTest } from "../bake-harness";

function getFallbackMessageContainer(text: string) {
  const regex = /\s*\<script id="__bunfallback" type="binary\/peechy"\>([^\<]+)\<\/script\>/gm;
  const match = regex.exec(text);

  const encodedData = match![1].trim();
  const binary_string = globalThis.atob(encodedData);

  let len = binary_string.length;
  let bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }

  const fallback_message_container = decodeFallbackMessageContainer(new ByteBuffer(bytes));
  return fallback_message_container;
}

// Test case 1: Simple page which throws an error when streaming = false
devTest("error thrown when streaming = false", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = false;
      export const mode = "ssr";
      
      export default async function IndexPage() {
        throw new Error('LMAO')
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    expect(response.status).toBe(500);
  },
});

// Test case 2: Simple page which throws an error when streaming = true
devTest("error thrown when streaming = true", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = true;
      export const mode = "ssr";

      export default async function IndexPage() {
        throw new Error('LMAO')
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");

    // Streaming might return 200 and then error, or 500
    const text = await response.text();

    const fallback_message_container = getFallbackMessageContainer(text);
    expect(fallback_message_container.problems?.exceptions[0].message).toContain("LMAO");
  },
});

// Test case 3: Using Response.render() with streaming = true (should error)
devTest("Response.render() with streaming = true should error", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = true;
      export const mode = "ssr";

      export default async function IndexPage() {
        return Response.render("/other");
      }
    `,
    "pages/other.tsx": `
      export default function OtherPage() {
        return <h1>Other Page</h1>;
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const text = await response.text();
    // Response.render() is not available during streaming
    expect(text.toLowerCase()).toContain("error");
  },
});

// Test case 4: Using new Response(<jsx />, { ... }) with custom headers
devTest("new Response with JSX and custom headers", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = false;
      export const mode = "ssr";

      export default async function IndexPage() {
        return new Response(<h1>Hello World</h1>, {
          status: 201,
          headers: {
            "X-Custom-Header": "test-value",
            "X-Another-Header": "another-value"
          }
        });
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Custom-Header")).toBe("test-value");
    expect(response.headers.get("X-Another-Header")).toBe("another-value");
    const text = await response.text();
    expect(text).toContain("<h1>Hello World</h1>");
  },
});

// Test case 5: new Response with JSX when streaming = true (should error)
devTest("new Response with JSX when streaming = true should error", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = true;
      export const mode = "ssr";

      export default async function IndexPage() {
        return new Response(<h1>Hello World</h1>, {
          status: 201,
          headers: {
            "X-Custom-Header": "test-value"
          }
        });
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const text = await response.text();
    const fallback_message_container = getFallbackMessageContainer(text);
    expect(fallback_message_container.problems?.exceptions[0].message).toContain(
      '"new Response(<jsx />, { ... })" is not available when `export const streaming = true`',
    );
  },
});

// Test case 6: Response.redirect() - content matching
devTest("Response.redirect() - content matching", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = false;
      export const mode = "ssr";

      export default async function IndexPage() {
        return Response.redirect("/lmao");
      }
    `,
    "pages/lmao.tsx": `
      export default function LmaoPage() {
        return <h1>LMAO Page</h1>;
      }
    `,
  },
  async test(dev) {
    // Test with redirect following (default behavior)
    const response = await dev.fetch("/");
    expect(response.status).toBe(200); // After following redirect
    const text = await response.text();
    expect(text).toContain("<h1>LMAO Page</h1>");
  },
});

// Test case 7: Response.redirect() - HTTP redirect status/headers
devTest("Response.redirect() - HTTP redirect status and headers", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = false;
      export const mode = "ssr";

      export default async function IndexPage() {
        return Response.redirect("/lmao");
      }
    `,
    "pages/lmao.tsx": `
      export default function LmaoPage() {
        return <h1>LMAO Page</h1>;
      }
    `,
  },
  async test(dev) {
    // Test without following redirects
    const response = await dev.fetch("/", { redirect: "manual" });
    expect(response.status).toBe(302); // Default redirect status
    expect(response.headers.get("Location")).toBe("/lmao");
  },
});

// Test case 8: Response.redirect() when streaming = true (should error)
devTest("Response.redirect() when streaming = true should error", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = true;
      export const mode = "ssr";

      export default async function IndexPage() {
        return Response.redirect("/lmao");
      }
    `,
    "pages/lmao.tsx": `
      export default function LmaoPage() {
        return <h1>LMAO Page</h1>;
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const text = await response.text();
    // Response.redirect() during streaming should error
    expect(text.toLowerCase()).toContain("error");
  },
});

// Test case 9: Response.render() acts like Next.js rewrite
devTest("Response.render() works like Next.js rewrite", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = false;
      export const mode = "ssr";

      export default async function IndexPage() {
        return Response.render("/new-route");
      }
    `,
    "pages/new-route.tsx": `
      export default function NewRoutePage() {
        return <h1>New Route Content</h1>;
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("<h1>New Route Content</h1>");

    // Verify it's a rewrite, not a redirect
    expect(response.url).toContain("/"); // URL should remain the original
  },
});

// Test case 10: Response.render() with dynamic route
devTest("Response.render() with dynamic route", {
  framework: "react",
  files: {
    "pages/product.tsx": `
      export const streaming = false;
      export const mode = "ssr";

      export default async function ProductPage() {
        return Response.render("/category/electronics");
      }
    `,
    "pages/category/[slug].tsx": `
      export default function CategoryPage({ params }) {
        return <h1>Category: {params.slug}</h1>;
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/product");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("<h1>Category: <!-- -->electronics</h1>");
  },
});

// Test case 12: Concurrent requests with different Response options (AsyncLocalStorage isolation)
devTest("concurrent requests maintain isolated Response options via AsyncLocalStorage", {
  framework: "react",
  files: {
    "pages/request-a.tsx": `
      export const streaming = false;
      export const mode = "ssr";

      export default async function RequestA() {
        // Simulate some async work to increase chance of overlapping
        await new Promise(resolve => setTimeout(resolve, 10));

        return new Response(<h1>Request A</h1>, {
          status: 201,
          headers: {
            "X-Request-Id": "request-a",
            "X-Custom-A": "value-a"
          }
        });
      }
    `,
    "pages/request-b.tsx": `
      export const streaming = false;
      export const mode = "ssr";

      export default async function RequestB() {
        // Different timing to create overlapping requests
        await new Promise(resolve => setTimeout(resolve, 5));

        return new Response(<h2>Request B</h2>, {
          status: 202,
          headers: {
            "X-Request-Id": "request-b",
            "X-Custom-B": "value-b"
          }
        });
      }
    `,
    "pages/request-c.tsx": `
      export const streaming = false;
      export const mode = "ssr";

      export default async function RequestC() {
        // No delay for this one
        return new Response(<h3>Request C</h3>, {
          status: 203,
          headers: {
            "X-Request-Id": "request-c",
            "X-Custom-C": "value-c"
          }
        });
      }
    `,
  },
  async test(dev) {
    // Launch multiple concurrent requests
    const promises: Promise<any>[] = [];
    const requestCount = 5; // Multiple iterations to increase chance of catching issues

    for (let i = 0; i < requestCount; i++) {
      console.log("Iteration", i);
      // Interleave different request types
      promises.push(
        dev.fetch("/request-a").then(async res => ({
          path: "/request-a",
          status: res.status,
          headers: {
            requestId: res.headers.get("X-Request-Id"),
            customA: res.headers.get("X-Custom-A"),
            customB: res.headers.get("X-Custom-B"),
            customC: res.headers.get("X-Custom-C"),
          },
          text: await res.text(),
        })),
      );

      promises.push(
        dev.fetch("/request-b").then(async res => ({
          path: "/request-b",
          status: res.status,
          headers: {
            requestId: res.headers.get("X-Request-Id"),
            customA: res.headers.get("X-Custom-A"),
            customB: res.headers.get("X-Custom-B"),
            customC: res.headers.get("X-Custom-C"),
          },
          text: await res.text(),
        })),
      );

      promises.push(
        dev.fetch("/request-c").then(async res => ({
          path: "/request-c",
          status: res.status,
          headers: {
            requestId: res.headers.get("X-Request-Id"),
            customA: res.headers.get("X-Custom-A"),
            customB: res.headers.get("X-Custom-B"),
            customC: res.headers.get("X-Custom-C"),
          },
          text: await res.text(),
        })),
      );
    }

    const results = await Promise.all(promises);

    // Verify each request maintained its own isolated Response options
    for (const result of results) {
      if (result.path === "/request-a") {
        expect(result.status).toBe(201);
        expect(result.headers.requestId).toBe("request-a");
        expect(result.headers.customA).toBe("value-a");
        expect(result.headers.customB).toBeNull(); // Should not leak from request-b
        expect(result.headers.customC).toBeNull(); // Should not leak from request-c
        expect(result.text).toContain("<h1>Request A</h1>");
      } else if (result.path === "/request-b") {
        expect(result.status).toBe(202);
        expect(result.headers.requestId).toBe("request-b");
        expect(result.headers.customA).toBeNull(); // Should not leak from request-a
        expect(result.headers.customB).toBe("value-b");
        expect(result.headers.customC).toBeNull(); // Should not leak from request-c
        expect(result.text).toContain("<h2>Request B</h2>");
      } else if (result.path === "/request-c") {
        expect(result.status).toBe(203);
        expect(result.headers.requestId).toBe("request-c");
        expect(result.headers.customA).toBeNull(); // Should not leak from request-a
        expect(result.headers.customB).toBeNull(); // Should not leak from request-b
        expect(result.headers.customC).toBe("value-c");
        expect(result.text).toContain("<h3>Request C</h3>");
      }
    }
  },
});
