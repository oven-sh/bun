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

// Fizz stops writing when `write()` returns falsy and waits for a 'drain' the SSR stream never emits.
devTest("streaming = true flushes every outlined Suspense boundary", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      import { Suspense } from "react";
      export const streaming = true;

      const tick = () => new Promise(resolve => setImmediate(resolve));

      // Larger than Fizz's 2 KB write buffer, so flushing it calls write() mid-boundary.
      async function First() {
        await tick();
        return <p id="first">{"FIRST:" + Buffer.alloc(3000, "a").toString()}</p>;
      }
      // Resolves after First has been flushed.
      async function Second() {
        await tick();
        await tick();
        await tick();
        return <p id="second">SECOND_DONE</p>;
      }

      export default function IndexPage() {
        return (
          <main>
            <Suspense fallback={<p>loading first</p>}><First /></Suspense>
            <Suspense fallback={<p>loading second</p>}><Second /></Suspense>
          </main>
        );
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const text = await response.text();
    expect(text).toContain("FIRST:aaa");
    expect(text).toContain("SECOND_DONE");
    expect(text.trimEnd().endsWith("</body></html>")).toBe(true);
    expect(response.status).toBe(200);
  },
});
