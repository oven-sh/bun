import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { BundlerTestInput, expectBundled, itBundled } from "./expectBundled";

// `api` paths and `outputPaths` resolve from the test root, which is also where `files` are
// written, so a test naming an input file where it means an output would silently check its own
// fixture. expectBundled rejects such paths. Every case here bundles the same input to /out/entry.js.
const bundle = {
  files: {
    "/entry.js": /* js */ `
      import { greeting } from "./lib/greeting";
      console.log(greeting);
    `,
    "lib/greeting.js": `export const greeting = "hi";`,
  },
  outdir: "/out",
} satisfies BundlerTestInput;

function refersToInput(what: string, writtenTo = "/out") {
  return `${what} refers to one of the test's input files, not to bundle output. Paths resolve from the test root; the bundle is written to ${JSON.stringify(writtenTo)}.`;
}

const rejected: Record<string, { opts: Partial<BundlerTestInput>; error: string }> = {
  OutputPaths: {
    opts: { outputPaths: ["/out/entry.js", "/entry.js"] },
    error: refersToInput('outputPaths entry "/entry.js"'),
  },
  ExpectFile: {
    opts: { onAfterBundle: api => api.expectFile("/entry.js") },
    error: refersToInput('api.expectFile("/entry.js")'),
  },
  // The remaining cases spell the path differently from the `files` key; they resolve to the same file.
  ReadFile: {
    opts: { onAfterBundle: api => api.readFile("entry.js") },
    error: refersToInput('api.readFile("entry.js")'),
  },
  AssertFileExists: {
    opts: { onAfterBundle: api => api.assertFileExists("./lib/greeting.js") },
    error: refersToInput('api.assertFileExists("./lib/greeting.js")'),
  },
  CaptureFile: {
    opts: { onAfterBundle: api => api.captureFile("/lib/greeting.js") },
    error: refersToInput('api.captureFile("/lib/greeting.js")'),
  },
  Outfile: {
    opts: { outdir: undefined, outfile: "/bundle.js", onAfterBundle: api => api.readFile("/entry.js") },
    error: refersToInput('api.readFile("/entry.js")', "/bundle.js"),
  },
};

describe("bundler", () => {
  itBundled("harness/InputFilesOutputsStayReadable", {
    ...bundle,
    outputPaths: ["/out/entry.js"],
    // runtimeFiles are written into the root after bundling; they are not inputs.
    runtimeFiles: { "/run.js": `import "./out/entry.js";` },
    onAfterBundle(api) {
      api.assertFileExists("/out/entry.js");
      api.expectFile("/out/entry.js").toContain('"hi"');
      expect(api.readFile("out/entry.js")).toBe(api.readFile("/out/entry.js"));
      expect(api.readFile("/run.js")).toBe(`import "./out/entry.js";`);
    },
  });

  // On Windows, expectBundled's `stack.includes("test/bundler/")` check fails on the backslash paths
  // and throws before any of this runs (itBundled swallows that throw, so the case above is dropped
  // there too).
  describe.skipIf(isWindows)("rejects paths that name an input file", () => {
    for (const [name, { opts, error }] of Object.entries(rejected)) {
      const id = `harness/InputFiles${name}`;
      test(id, async () => {
        let message = "<expectBundled() passed>";
        try {
          // ignoreFilter: an ambient BUN_BUNDLER_TEST_FILTER must not turn these into no-ops.
          await expectBundled(id, { ...bundle, ...opts }, false, true);
        } catch (e: any) {
          message = e.message;
        }
        expect(message).toBe(error);
      });
    }
  });
});
