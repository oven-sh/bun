import { expect } from "bun:test";
import { devTest } from "../bake-harness";

// The dev error page embeds its payload as JSON (see src/runtime/server/DevErrorPage.rs).
function getFallbackMessageContainer(text: string) {
  const regex = /<script id="__bunfallback" type="application\/json">([^<]*)<\/script>/m;
  return JSON.parse(regex.exec(text)![1]);
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
