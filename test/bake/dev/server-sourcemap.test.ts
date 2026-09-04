import { expect } from "bun:test";
import { isASAN } from "harness";
import { Dev, devTest } from "../bake-harness";

/**
 * Matches a remapped stack frame such as `at myFunc (/abs/pages/a.tsx:7:13)`,
 * with `line`/`column` being 1-based positions in the fixture source. `\w*`
 * tolerates the bundler renaming a symbol (`doSomething` prints as
 * `doSomething2`).
 */
function frame(fn: string, file: string, line: number, column: number) {
  const path = file
    .split("/")
    .map(RegExp.escape)
    .join(String.raw`[/\\]`);
  return new RegExp(String.raw`\bat ${fn}\w* \(.*${path}:${line}:${column}\)`);
}

/** Dev server output so far, without the ANSI codes interleaved in stack frames. */
function output(dev: Dev) {
  return dev.output.lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

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
    await Promise.all([
      dev.fetch("/test-error").catch(() => {}),
      dev.output.waitForLine(/Test error for source maps!/),
    ]);

    const out = output(dev);
    // Line 7 is `  throw new Error(...)`. The async component rejects and React
    // reads `error.stack` before the error is printed; that rendering puts
    // construct frames at the callee (`Error`), whereas the sync pages below
    // are printed at the `new` keyword.
    expect(out).toMatch(frame("myFunc", "pages/[...slug].tsx", 7, 13));
    // Line 2 is `  myFunc();`.
    expect(out).toMatch(frame("MyPage", "pages/[...slug].tsx", 2, 3));
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

    const out = output(dev);
    // Line 7 is `  throw new Error(...)`, reported at the `new` keyword.
    expect(out).toMatch(frame("throwError", "pages/error-page.tsx", 7, 9));
    // Line 2 is `  throwError();`.
    expect(out).toMatch(frame("ErrorPage", "pages/error-page.tsx", 2, 3));
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

    const out = output(dev);
    // lib/utils.ts line 6 is `  throw new Error(...)`, reported at the `new` keyword.
    expect(out).toMatch(frame("helperFunction", "lib/utils.ts", 6, 9));
    // lib/utils.ts line 2 is `  return helperFunction();`.
    expect(out).toMatch(frame("doSomething", "lib/utils.ts", 2, 10));
    // pages/nested.tsx line 4 is `  const result = doSomething();`.
    expect(out).toMatch(frame("NestedPage", "pages/nested.tsx", 4, 18));
  },
});

// Each round re-registers the file's source provider over the previous one
// and re-materializes the parsed map from it, so stack remapping must stay
// correct through repeated provider replacement, not just the first install.
// `filler` comment lines shift the throwing function down one line per round,
// so a stale map from an earlier round would remap the frame to the wrong
// line and fail that round's assertion.
function churnPage(name: string, filler: number) {
  const fillerLines = Array.from({ length: filler }, (_, n) => `// filler ${n}\n`).join("");
  return `export default function ChurnPage() {
  churn${name}();
  return <div>churn ${name}</div>;
}

${fillerLines}function churn${name}() {
  throw new Error("Churn error ${name}");
}

export async function getStaticPaths() {
  return {
    paths: [{ params: {} }],
  };
}`;
}

devTest("server-side source maps stay correct across repeated reloads", {
  files: {
    "pages/churn.tsx": churnPage("Alpha", 0),
  },
  framework: "react",
  async test(dev) {
    const rounds = ["Alpha", "Bravo", "Charlie", "Delta"];
    for (let i = 0; i < rounds.length; i++) {
      const name = rounds[i];
      if (i > 0) {
        await dev.write("pages/churn.tsx", churnPage(name, i));
      }
      await Promise.all([
        dev.fetch("/churn").catch(() => {}),
        dev.output.waitForLine(new RegExp(`Churn error ${name}`)),
      ]);

      // Round i's version of the file has its `  throw new Error(...)` on
      // line 7 + i.
      expect(output(dev)).toMatch(frame(`churn${name}`, "pages/churn.tsx", 7 + i, 9));
    }
  },
  timeoutMultiplier: 2,
});

// ~DevServerSourceProvider ran after the Zig::GlobalObject cell was swept.
// BUN_DESTRUCT_VM_ON_EXIT=1 triggers that teardown; Malloc=1 puts JSC cells
// under system malloc so ASAN poisons the freed cell and the UAF is deterministic.
if (isASAN) {
  devTest("DevServerSourceProvider destructor does not touch the swept global object on process exit", {
    framework: "react",
    files: {
      "pages/index.tsx": `
        export const mode = "ssr";
        export const streaming = false;
        export default function IndexPage() {
          return <div>alive</div>;
        }
      `,
    },
    env: {
      Malloc: "1",
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      // The test is about the use-after-free, not LSan; keep it hermetic
      // against whatever ASAN_OPTIONS the outer runner chose.
      ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=0",
    },
    async test(dev) {
      const response = await dev.fetch("/");
      const html = await response.text();
      expect(html).toContain("alive");
      // The harness calls gracefulExit() after this, which sends the dev
      // server through server.stop(true) + Bun.gc(true) + process.exit(0).
      // The teardown that follows is what this test is about.
    },
  });
}
