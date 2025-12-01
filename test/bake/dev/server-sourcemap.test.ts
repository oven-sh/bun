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

    // The output we saw shows the stack trace with correct source mapping
    // We need to check that the error shows the right file:line:column
    const lines = dev.output.lines.join("\n");

    // Check that we got the error
    expect(lines).toContain("Test error for source maps!");

    // Check that the stack trace shows correct file and line numbers
    // The source maps are working if we see the correct patterns
    // We need to check for the patterns because ANSI codes might be embedded
    // Strip ANSI codes for cleaner checking
    const cleanLines = lines.replace(/\x1b\[[0-9;]*m/g, "");

    const hasCorrectThrowLine = cleanLines.includes("myFunc") && cleanLines.includes("6:16");
    // const hasCorrectCallLine = cleanLines.includes("MyPage") && cleanLines.includes("2") && cleanLines.includes("3");
    const hasCorrectFileName = cleanLines.includes("pages/[...slug].tsx");

    expect(hasCorrectThrowLine).toBe(true);
    // TODO: renable this when async stacktraces are enabled?
    // expect(hasCorrectCallLine).toBe(true);
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
    await dev.write(
      "pages/error-page.tsx",
      `export default function ErrorPage() {
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
}`,
    );

    await Promise.all([dev.fetch("/error-page").catch(() => {}), dev.output.waitForLine(/HMR error test/)]);

    // Check source map points to correct lines after HMR
    const lines = dev.output.lines.join("\n");
    // Strip ANSI codes for cleaner checking
    const cleanLines = lines.replace(/\x1b\[[0-9;]*m/g, "");

    const hasCorrectThrowLine = cleanLines.includes("throwError") && cleanLines.includes("6:1");
    const hasCorrectCallLine = cleanLines.includes("ErrorPage") && cleanLines.includes("1:16");

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
    await Promise.all([dev.fetch("/nested").catch(() => {}), dev.output.waitForLine(/Nested error/)]);

    // Check that stack trace shows both files with correct lines
    const lines = dev.output.lines.join("\n");
    // Strip ANSI codes for cleaner checking
    const cleanLines = lines.replace(/\x1b\[[0-9;]*m/g, "");

    const hasUtilsThrowLine = cleanLines.includes("helperFunction") && cleanLines.includes("5:1");
    const hasUtilsCallLine = cleanLines.includes("doSomething2") && cleanLines.includes("1:28");
    const hasPageCallLine = cleanLines.includes("NestedPage") && cleanLines.includes("3:38");

    expect(hasUtilsThrowLine).toBe(true);
    expect(hasUtilsCallLine).toBe(true);
    expect(hasPageCallLine).toBe(true);
  },
});
