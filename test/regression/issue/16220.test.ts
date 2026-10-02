import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/16220
//
// debug.bun.sh is a bundled copy of WebKit's Web Inspector UI produced by
// packages/bun-inspector-frontend/scripts/build.ts. The inspector installs a
// capture-phase "focus" listener on document (WI._focusChanged) that calls
// event.target.isInsertionCaretInside(), which the inspector defines only on
// Element.prototype. When reloading the page in Firefox while the Console tab
// is selected, the listener receives a focus event whose target is not an
// Element, so the call throws and the UI fails to initialize.
//
// The build script post-processes the minified bundle to guard that call. We
// can't run Firefox in CI, but we can verify the guard is applied and that the
// guarded code survives a focus event whose target lacks the method.

const buildScript = join(import.meta.dir, "../../../packages/bun-inspector-frontend/scripts/build.ts");

// Tail of WI._focusChanged exactly as Bun.build({minify:true}) emits it from
// WebKit's Source/WebInspectorUI/UserInterface/Base/Main.js (and as currently
// deployed at https://debug.bun.sh/manifest-*.js).
const minifiedFocusChanged =
  "var I=window.getSelection();" +
  "if(!I.isCollapsed)return;" +
  "var E=N.target;" +
  "if(E!==WI.currentFocusElement)WI.previousFocusElement=WI.currentFocusElement,WI.currentFocusElement=E;" +
  "if(E.isInsertionCaretInside())return;" +
  "var T=E.ownerDocument.createRange();" +
  "T.setStart(E,0),T.setEnd(E,0),I.removeAllRanges(),I.addRange(T)";

// Simulate the focus target Firefox delivers on reload: it has ownerDocument
// like a Node but does not have the Element.prototype.isInsertionCaretInside
// extension.
function run(body: string) {
  const window = {
    getSelection: () => ({ isCollapsed: true, removeAllRanges() {}, addRange() {} }),
  };
  const WI = { currentFocusElement: null, previousFocusElement: null };
  const N = {
    target: {
      ownerDocument: { createRange: () => ({ setStart() {}, setEnd() {} }) },
      contains: () => false,
    },
  };
  new Function("window", "WI", "N", body)(window, WI, N);
}

describe("debug.bun.sh Firefox reload crash", () => {
  test("unpatched WI._focusChanged throws on a non-Element focus target (sanity)", () => {
    expect(() => run(minifiedFocusChanged)).toThrow(/isInsertionCaretInside is not a function/);
  });

  test("inspector-frontend build script guards the isInsertionCaretInside call", async () => {
    // build.ts exports patchBundleForFirefox and defers its top-level build to
    // import.meta.main. The unfixed script ran its build at import time, so we
    // check the export exists in the source before importing (in a subprocess)
    // to avoid those side effects taking the test runner down on the fail-before
    // path.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const path = ${JSON.stringify(buildScript)};
         const src = await Bun.file(path).text();
         if (!src.includes("export function patchBundleForFirefox")) {
           console.error("build.ts does not export patchBundleForFirefox");
           process.exit(1);
         }
         const { patchBundleForFirefox } = await import(path);
         process.stdout.write(patchBundleForFirefox(${JSON.stringify(minifiedFocusChanged)}));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).not.toBe(minifiedFocusChanged);
    expect(stdout).not.toContain("if(E.isInsertionCaretInside())");
    expect(() => run(stdout)).not.toThrow();
    expect(exitCode).toBe(0);
  });
});
