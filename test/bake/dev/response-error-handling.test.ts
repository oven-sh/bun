import { decodeFallbackMessageContainer } from "../../../src/api/schema";
import { devTest } from "../bake-harness";
import { expect } from "bun:test";
import { ByteBuffer } from "peechy";

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
