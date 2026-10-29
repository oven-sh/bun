import { expect } from "bun:test";
import { isASAN } from "harness";
import { devTest, minimalFramework } from "../bake-harness";

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

// The printer writes a string that holds "\n" as a template literal with a
// real line break, so this string puts a line that starts with
// `//# sourceMappingURL=` into the server bundle. It is data, not a comment:
// the frames must still go through the dev server's own map for the bundle.
// The minimal framework keeps React out of the bundle: React's own
// "\n//# sourceMappingURL=" string would come later in the text.
const embeddedMap = {
  version: 3,
  sources: ["EMBEDDED.ts"],
  sourcesContent: ["// embedded\n"],
  names: [],
  // One mapping at column 0 of each of 2000 generated lines, to EMBEDDED.ts line 1000 and up.
  mappings: "AAu+BA" + Buffer.alloc(5 * 1999, ";AACA").toString(),
};
const embeddedWorkerSource =
  "self.onmessage = () => {};\n" +
  "//# sourceMappingURL=data:application/json;base64," +
  Buffer.from(JSON.stringify(embeddedMap)).toString("base64") +
  "\n";

devTest("server-side source maps ignore a sourceMappingURL inside a string", {
  framework: minimalFramework,
  files: {
    "lib/worker-source.ts": `export const workerSource = ${JSON.stringify(embeddedWorkerSource)};\n`,
    "routes/index.ts": `import { workerSource } from "../lib/worker-source";

function thrower(): never {
  throw new Error("Embedded map error");
}

export default function (req, meta) {
  try {
    thrower();
  } catch (e) {
    return new Response(String(e.stack).split("\\n").slice(1, 3).join("\\n") + "\\n" + workerSource.length);
  }
}
`,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const [thrower, route, length] = (await response.text()).split("\n");
    expect({ thrower, route, length }).toEqual({
      thrower: expect.stringMatching(/^\s*at thrower \(.*routes[/\\]index\.ts:\d+:\d+\)$/),
      route: expect.stringMatching(/^\s*at \w+ \(.*routes[/\\]index\.ts:\d+:\d+\)$/),
      length: String(embeddedWorkerSource.length),
    });
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
