import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26360
// Bun.build called from a macro that runs during another Bun.build used to deadlock.
// Every Bun.build call runs on one singleton bundler thread. The outer build blocks that
// thread while it waits for the macro, and the macro's inner Bun.build waits for the same
// thread. The fix makes Bun.build throw when it is called in macro mode.

// Shared by the two child-process tests. The macro catches the inner Bun.build error and
// returns its message, so the bundled output shows exactly what the macro saw.
const fixture = {
  "browser.ts": `console.log("browser code");
export default "";
`,
  "macro.ts": `import browserCode from "./browser" with { type: "file" };

let errorMessage = "no error";
try {
  await Bun.build({
    entrypoints: [browserCode],
    format: "esm",
  });
} catch (e) {
  errorMessage = "CAUGHT: " + e.message;
}
export const getErrorMessage = (): string => errorMessage;
`,
  "index.ts": `import { getErrorMessage } from "./macro" with { type: "macro" };
console.log("ERROR_MSG:", getErrorMessage());
`,
};

// Debug builds print "[macro] call <name>" to stdout when a macro runs.
function withoutMacroDebugLines(stdout: string) {
  return stdout
    .split("\n")
    .filter(line => !line.startsWith("[macro]"))
    .join("\n");
}

// Kill switch for the child processes: a deadlock hangs the child forever. Kill it so the
// assertions fail with a clear message instead of the whole file hanging.
const killSwitch = { timeout: 60_000, killSignal: "SIGKILL" } as const;
const hungMessage = "the child hung and was killed after 60s";

// The outer Bun.build runs in a child process: before the fix it deadlocked the bundler
// thread, and an in-process deadlock would take the test runner down with it.
test.concurrent("Bun.build from macro during bundling throws instead of hanging", async () => {
  using dir = tempDir("issue-26360", {
    ...fixture,
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
  console.log(await result.outputs[0].text());
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build_script.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    ...killSwitch,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(proc.signalCode, hungMessage).toBeNull();
  expect(normalizeBunSnapshot(withoutMacroDebugLines(stdout), String(dir))).toMatchInlineSnapshot(`
    "BUILD_SUCCESS
    // index.ts
    console.log("ERROR_MSG:", \`CAUGHT: Bun.build cannot be called from within a macro during bundling.

    This would cause a deadlock because the bundler is waiting for the macro to complete,
    but the macro's Bun.build call is waiting for the bundler.

    To bundle code at compile time in a macro, use Bun.spawnSync to invoke the CLI:
      const result = Bun.spawnSync(["bun", "build", entrypoint, "--format=esm"]);\`);"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("CLI bun build with macro that calls Bun.build also throws", async () => {
  using dir = tempDir("issue-26360-cli", fixture);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--target=node"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    ...killSwitch,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(proc.signalCode, hungMessage).toBeNull();
  // With no --outdir the CLI writes the bundle to stdout and prints no summary.
  expect(normalizeBunSnapshot(withoutMacroDebugLines(stdout), String(dir))).toMatchInlineSnapshot(`
    "// index.ts
    console.log("ERROR_MSG:", \`CAUGHT: Bun.build cannot be called from within a macro during bundling.

    This would cause a deadlock because the bundler is waiting for the macro to complete,
    but the macro's Bun.build call is waiting for the bundler.

    To bundle code at compile time in a macro, use Bun.spawnSync to invoke the CLI:
      const result = Bun.spawnSync(["bun", "build", entrypoint, "--format=esm"]);\`);"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("regular Bun.build (not in macro) still works", async () => {
  using dir = tempDir("issue-26360-normal", {
    "entry.ts": `console.log("hello world");
export default "";
`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entry.ts`],
    format: "esm",
  });

  expect({ success: result.success, logs: result.logs, outputs: result.outputs.length }).toEqual({
    success: true,
    logs: [],
    outputs: 1,
  });
  // The "// <path>" comment on the first line is relative to the test runner's cwd, so it
  // changes from machine to machine. The rest of the bundle is exact.
  const text = normalizeBunSnapshot(await result.outputs[0].text()).replace(/^\/\/ .*\/entry\.ts$/m, "// entry.ts");
  expect(text).toMatchInlineSnapshot(`
    "// entry.ts
    console.log("hello world");
    var entry_default = "";
    export {
      entry_default as default
    };"
  `);
});
