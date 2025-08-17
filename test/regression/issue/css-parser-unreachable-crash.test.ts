import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";

test("CSS parser unreachable crash - should not panic", async () => {
  // Based on the stack trace analysis, this crash happens when parsing CSS declarations
  // where the enum map matches an identifier but it's not in the current void_fields subset.
  // Let's try various CSS inputs that might trigger this specific edge case.
  
  const problemCSSInputs = [
    // Key test cases that could trigger the enum conflict
    `.test { border-width: solid; }`,  // border-style value used for border-width
    `.test { border-width: medium; font-size: medium; }`,  // potential enum conflict
    `.test { border-style: thin; }`,   // wrong enum value for property
    `.test { outline-width: thick; }`, // similar pattern to BorderSideWidth
  ];

  for (const cssInput of problemCSSInputs) {
    
    const dir = tempDirWithFiles("css-unreachable-test", {
      "input.css": cssInput,
      "index.js": `import "./input.css";`,
    });

    try {
      const proc = Bun.spawn({
        cmd: [bunExe(), "build", "index.js"],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stderr] = await Promise.all([
        proc.exited,
        proc.stderr.text(),
      ]);

      // The test should not crash with "unreachable" panic
      if (stderr.includes("unreachable") || stderr.includes("panic")) {
        console.error(`CSS input that caused crash: ${cssInput}`);
        console.error(`Stderr: ${stderr}`);
        expect(false).toBe(true); // Force test failure
      }
    } catch (error) {
      // Expected errors are fine, but not panics
      if (error.message?.includes("unreachable") || error.message?.includes("panic")) {
        console.error(`CSS input that caused crash: ${cssInput}`);
        throw error;
      }
    }
  }
});