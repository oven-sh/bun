import { expect } from "bun:test";
import { isASAN } from "harness";
import path from "node:path";
import { Dev, devTest, minimalFramework } from "../bake-harness";

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
    // react-server-dom was loaded by the initial bundle and is not part of the
    // update, so its frame still has to remap through the initial bundle's map.
    expect(cleanLines).toMatch(
      /at react-stack-bottom-frame \(.*react-server-dom-webpack-server\.node\.unbundled\.development\.js:\d+:\d+\)/,
    );
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

// Each round evaluates a new server patch, which registers its own source
// provider next to the ones of the earlier rounds, so the frame must be
// remapped through the map of the round that actually loaded the code.
// `filler` comment lines shift the throwing function down one line per round,
// so remapping through any earlier round's map would report the wrong line
// and fail that round's assertion.
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

      // Strip ANSI codes; they interleave within stack-frame lines.
      const cleanLines = dev.output.lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
      // The throwing function is declared on line 6 + i of round i's version
      // of the source file; frames remap to the declaration position (see the
      // `helperFunction`/`5:1` expectation above). `\w*` tolerates bundler
      // symbol renaming (see `doSomething2` above).
      expect(cleanLines).toMatch(new RegExp(`at churn${name}\\w* \\(.*pages[/\\\\]churn\\.tsx:${6 + i}:1\\)`));
    }
  },
  timeoutMultiplier: 2,
});

function withFillerLines(source: string, count: number) {
  return Array.from({ length: count }, (_, n) => `// filler ${n}\n`).join("") + source;
}

const throwingLib = `export function boom() {
  throw new Error("boom");
}`;

const throwingRoute = `import { boom } from "../lib/boom";
export default function (req, meta) {
  boom();
  return new Response("unreachable");
}`;

// Requests "/" and returns the three synchronous user frames of its error
// (lib/boom.ts, routes/index.ts, the framework's minimal.server.ts) from the
// JSON payload of the dev error page, reduced to the file (last two path
// segments) and line. A frame that did not remap keeps its raw `bake://` URL.
async function fetchErrorFrames(dev: Dev): Promise<{ file: string; line: number }[]> {
  const response = await dev.fetch("/");
  expect(response.status).toBe(500);
  const html = await response.text();
  const payload = JSON.parse(/<script id="__bunfallback" type="application\/json">([^<]*)<\/script>/.exec(html)![1]);
  const { message, stack } = payload.problems.exceptions[0];
  expect(message).toBe("boom");
  return stack.frames.slice(0, 3).map(({ file, position }: any) => ({
    file: path.isAbsolute(file) ? file.split(/[\\/]/).slice(-2).join("/") : file,
    line: position.line,
  }));
}

// Each server hot update is evaluated as one patch whose source map only covers
// the files in that update. Files that are not part of an update keep running
// the code of the patch that loaded them, so their frames must still remap
// through that patch's map once newer patches have been loaded. Lines are
// compared relative to the first round: prepending filler lines to a file
// moves its frame by exactly that many lines, but only when the frame is
// remapped through the map of the patch that loaded the file's current code.
devTest("server-side source maps keep working for modules loaded by an earlier patch", {
  framework: minimalFramework,
  files: {
    "lib/boom.ts": throwingLib,
    "routes/index.ts": throwingRoute,
  },
  async test(dev) {
    const [lib, route, framework] = await fetchErrorFrames(dev);
    expect([lib.file, route.file, framework.file]).toEqual([
      "lib/boom.ts",
      "routes/index.ts",
      "bake/minimal.server.ts",
    ]);

    // Re-bundles only the route; lib/boom.ts and minimal.server.ts stay in the
    // initial patch.
    await dev.write("routes/index.ts", withFillerLines(throwingRoute, 3));
    const routeAfterUpdate = { file: route.file, line: route.line + 3 };
    expect(await fetchErrorFrames(dev)).toEqual([lib, routeAfterUpdate, framework]);

    // Re-bundles only the lib; the route keeps running the previous patch.
    await dev.write("lib/boom.ts", withFillerLines(throwingLib, 2));
    expect(await fetchErrorFrames(dev)).toEqual([{ file: lib.file, line: lib.line + 2 }, routeAfterUpdate, framework]);
  },
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
