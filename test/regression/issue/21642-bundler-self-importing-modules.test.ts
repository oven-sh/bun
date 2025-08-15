import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// TODO: This test currently fails due to issue #21642
// The bundler generates circular async dependencies where init functions
// are called before they are defined, causing "undefined is not an object" errors
// 
// The fix requires implementing the TODO comment in LinkerContext.zig:1162-1164:
// "This should be changed to store a promise and await all stored promises 
// after all imports but before any code."
test.todo("issue 21642: bundler should not emit self importing modules", async () => {
  const dir = tempDirWithFiles("issue-21642-repro", {
    "e0.ts": `
function export_e3() {}
function export_e4() {}
function export_e5() {}
import { export_e8 } from "./e2";
const { export_e6 } = await import("./e1");
export { export_e3, export_e4, export_e5, export_e8, export_e6 };
    `,
    "e1.ts": `
function export_e6() {}
export { export_e6 };
    `,
    "e2.ts": `
function export_e7() {}
function export_e8() {}
const { export_e6, export_e4 } = await import("./e0");
export_e6();
export_e4();
export { export_e7, export_e8, export_e6 };
    `,
  });

  // Build with e0.ts and e1.ts as entrypoints (as described in the issue)
  const result = await Bun.build({
    entrypoints: [join(dir, "e0.ts"), join(dir, "e1.ts")],
    outdir: join(dir, "dist"),
    format: "esm",
    target: "browser",
    sourcemap: false,
    minify: false,
  });

  expect(result.success).toBe(true);

  // Read the generated e0.js output
  const e0Output = await Bun.file(join(dir, "dist", "e0.js")).text();
  
  // Test that the generated code actually works (should not crash with undefined)
  const runResult = await Bun.spawn({
    cmd: [bunExe(), join(dir, "dist", "e0.js")],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(runResult.stdout).text(),
    new Response(runResult.stderr).text(),
    runResult.exited,
  ]);

  // Should not have runtime errors about undefined functions
  expect(stderr).not.toContain("undefined is not an object");
  expect(stderr).not.toContain("TypeError");
  expect(exitCode).toBe(0);

  // Verify that no init function calls an undefined init function
  // The pattern to avoid: init_e2 calls init_e0() before init_e0 is defined
  const initFunctionRegex = /var\s+(init_\w+)\s*=\s*__esm/g;
  const initCalls: Array<{ name: string; position: number }> = [];
  const initDefinitions: Array<{ name: string; position: number }> = [];
  
  let match;
  while ((match = initFunctionRegex.exec(e0Output)) !== null) {
    initDefinitions.push({
      name: match[1],
      position: match.index,
    });
  }
  
  // Find all calls to init functions
  const initCallRegex = /(init_\w+)\(\)/g;
  while ((match = initCallRegex.exec(e0Output)) !== null) {
    initCalls.push({
      name: match[1],
      position: match.index,
    });
  }
  
  // Check that all init function calls come after their definitions
  for (const call of initCalls) {
    const definition = initDefinitions.find(def => def.name === call.name);
    if (definition && definition.position > call.position) {
      throw new Error(
        `Init function ${call.name} is called at position ${call.position} ` +
        `but defined at position ${definition.position}. ` +
        `This causes the "undefined is not an object" error.`
      );
    }
  }
});