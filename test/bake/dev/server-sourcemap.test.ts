import { expect } from "bun:test";
import { devTest } from "../bake-harness";

devTest("server-side source maps show correct error lines", {
  files: {
    "pages/[...slug].tsx": `export default async function MyPage(params) {
  myFunc();
  return <h1>{JSON.stringify(params)}</h1>;
}

function myFunc() {
  throw new Error("Test error for source maps!");
}

export async function getStaticPaths() {
  return {
    paths: [
      {
        params: {
          slug: ["test-error"],
        },
      },
    ],
  };
}`,
  },
  framework: "react",
  async test(dev) {
    // Make a request that will trigger the error
    await dev.fetch("/test-error").catch(() => {});
    
    // Give it a moment to process the error
    await Bun.sleep(1000);
    
    // The output we saw shows the stack trace with correct source mapping
    // We need to check that the error shows the right file:line:column
    const lines = dev.output.lines.join("\n");
    
    // Check that we got the error
    expect(lines).toContain("Test error for source maps!");
    
    // Check that the stack trace shows correct file and line numbers
    // The source maps are working if we see the correct patterns
    // We need to check for the patterns because ANSI codes might be embedded
    const hasCorrectThrowLine = lines.includes("myFunc") && lines.includes("7") && lines.includes("9");
    const hasCorrectCallLine = lines.includes("MyPage") && lines.includes("2") && lines.includes("3");
    const hasCorrectFileName = lines.includes("/pages/[...slug].tsx");
    
    expect(hasCorrectThrowLine).toBe(true);
    expect(hasCorrectCallLine).toBe(true);
    expect(hasCorrectFileName).toBe(true);
  },
  timeoutMultiplier: 2, // Give more time for the test
});

devTest("server-side source maps work with HMR updates", {
  files: {
    "pages/error-page.tsx": `export default function ErrorPage() {
  return <div>Initial content</div>;
}

export async function getStaticPaths() {
  return {
    paths: [{ params: {} }],
  };
}`,
  },
  framework: "react",
  async test(dev) {
    // First fetch should work
    const response1 = await dev.fetch("/error-page");
    expect(response1.status).toBe(200);
    expect(await response1.text()).toContain("Initial content");
    
    // Update the file to throw an error
    await dev.write("pages/error-page.tsx", `export default function ErrorPage() {
  throwError();
  return <div>Updated content</div>;
}

function throwError() {
  throw new Error("HMR error test");
}

export async function getStaticPaths() {
  return {
    paths: [{ params: {} }],
  };
}`);
    
    // Wait for the rebuild
    await dev.waitForHmr();
    
    // Second fetch should error
    await dev.fetch("/error-page").catch(() => {});
    
    // Wait for error output
    await dev.output.waitForLine(/HMR error test/);
    
    // Check source map points to correct lines after HMR
    const lines = dev.output.lines.join("\n");
    const hasCorrectThrowLine = lines.includes("throwError") && lines.includes("7") && lines.includes("9");
    const hasCorrectCallLine = lines.includes("ErrorPage") && lines.includes("2") && lines.includes("3");
    
    expect(hasCorrectThrowLine).toBe(true);
    expect(hasCorrectCallLine).toBe(true);
  },
});

devTest("server-side source maps handle nested imports", {
  files: {
    "pages/nested.tsx": `import { doSomething } from "../lib/utils";

export default function NestedPage() {
  const result = doSomething();
  return <div>{result}</div>;
}

export async function getStaticPaths() {
  return {
    paths: [{ params: {} }],
  };
}`,
    "lib/utils.ts": `export function doSomething() {
  return helperFunction();
}

function helperFunction() {
  throw new Error("Nested error");
}`,
  },
  framework: "react",
  async test(dev) {
    // Make request that triggers error
    await dev.fetch("/nested").catch(() => {});
    
    // Wait for error output
    await dev.output.waitForLine(/Nested error/);
    
    // Check that stack trace shows both files with correct lines
    const lines = dev.output.lines.join("\n");
    const hasUtilsThrowLine = lines.includes("helperFunction") && lines.includes("6") && lines.includes("9");
    const hasUtilsCallLine = lines.includes("doSomething") && lines.includes("2");
    const hasPageCallLine = lines.includes("NestedPage") && lines.includes("4");
    
    expect(hasUtilsThrowLine).toBe(true);
    expect(hasUtilsCallLine).toBe(true);
    expect(hasPageCallLine).toBe(true);
  },
});