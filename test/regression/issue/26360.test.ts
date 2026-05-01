import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26360
// Bug: Bun.build API hangs indefinitely when called from within a macro that is
// evaluated during another Bun.build call. The CLI `bun build` works correctly.
//
// Root cause: The bundler uses a singleton thread for processing Bun.build calls.
// When a macro is evaluated during bundling and that macro calls Bun.build:
// 1. The singleton bundler thread is processing the outer Bun.build
// 2. The macro runs on the bundler thread and calls Bun.build
// 3. The inner Bun.build tries to enqueue to the same singleton thread
// 4. The singleton thread is blocked waiting for the macro to complete -> deadlock
//
// Fix: Detect when Bun.build is called from within macro mode and throw a clear error.

test("Bun.build from macro during bundling throws instead of hanging", async () => {
  using dir = tempDir("issue-26360", {
    // A simple file that will be bundled by the macro
    "browser.ts": `console.log("browser code");
export default "";
`,

    // A macro that calls Bun.build and catches the error
    // The error should indicate that Bun.build cannot be called from macro context
    "macro.ts": `import browserCode from "./browser" with { type: "file" };

let errorMessage = "no error";
try {
  const built = await Bun.build({
    entrypoints: [browserCode],
    format: "esm",
  });
} catch (e) {
  errorMessage = "CAUGHT: " + e.message;
}
export const getErrorMessage = (): string => errorMessage;
`,

    // File that imports from the macro
    "index.ts": `import { getErrorMessage } from "./macro" with { type: "macro" };
console.log("ERROR_MSG:", getErrorMessage());
`,

    // Build script that uses Bun.build API (this would hang before the fix)
    "build_script.ts": `const result = await Bun.build({
  entrypoints: ["./index.ts"],
});

if (!result.success) {
  console.log("BUILD_ERROR");
  for (const log of result.logs) {
    console.log(log.message);
  }
} else {
  console.log("BUILD_SUCCESS");
  // Print the output to verify the macro caught the error
  const text = await result.outputs[0].text();
  console.log(text);
}
`,
  });

  // Run the build script - should complete (not hang) and the macro should have caught the error
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build_script.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The build should succeed (the macro catches the error)
  expect(stdout).toContain("BUILD_SUCCESS");
  // The macro should have received the error message about Bun.build not being allowed
  expect(stdout).toContain("Bun.build cannot be called from within a macro");
});

test("CLI bun build with macro that calls Bun.build also throws", async () => {
  using dir = tempDir("issue-26360-cli", {
    "browser.ts": `console.log("browser code");
export default "";
`,

    // A macro that calls Bun.build and catches the error
    "macro.ts": `import browserCode from "./browser" with { type: "file" };

let errorMessage = "";
try {
  const built = await Bun.build({
    entrypoints: [browserCode],
    format: "esm",
  });
} catch (e) {
  errorMessage = e.message;
}
export const getErrorMessage = (): string => errorMessage;
`,

    "index.ts": `import { getErrorMessage } from "./macro" with { type: "macro" };
console.log("ERROR_MSG:", getErrorMessage());
`,
  });

  // Run via CLI
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--target=node"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The CLI build should also work and show the error message was caught
  expect(stdout).toContain("Bun.build cannot be called from within a macro");
});

test("regular Bun.build (not in macro) still works", async () => {
  using dir = tempDir("issue-26360-normal", {
    "entry.ts": `
      console.log("hello world");
      export default "";
    `,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entry.ts`],
    format: "esm",
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBeGreaterThan(0);
  const text = await result.outputs[0].text();
  expect(text).toContain("hello world");
});
