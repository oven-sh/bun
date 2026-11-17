import { test as base, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, normalizeBunSnapshot, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26360
// Bun.build called from a macro that runs during another Bun.build used to deadlock.
// Every Bun.build call runs on one singleton bundler thread. The outer build blocks that
// thread while it waits for the macro, and the macro's inner Bun.build waits for the same
// thread. The fix makes Bun.build throw when it is called in macro mode.

// A test made by `extend()` receives the test context. Its `signal` aborts when the test
// times out. The runner does not kill the children of a concurrent test that times out, so
// `run()` gives the signal to its child.
const test = base.extend({});

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

// What index.ts bundles to: the macro call is replaced by the message that the macro caught.
const bundle = `// index.ts
console.log("ERROR_MSG:", \`CAUGHT: Bun.build cannot be called from within a macro during bundling.

This would cause a deadlock because the bundler is waiting for the macro to complete,
but the macro's Bun.build call is waiting for the bundler.

To bundle code at compile time in a macro, use Bun.spawnSync to invoke the CLI:
  const result = Bun.spawnSync(["bun", "build", entrypoint, "--format=esm"]);\`);`;

// Runs bun in `cwd` and returns its output with how it ended, for one combined assertion.
async function run(signal: AbortSignal, cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    // The bundler's macro VM is never destroyed, so on the ASAN lane LeakSanitizer reports
    // the native box that the macro's `file` import owns in that VM and aborts the child.
    env: isASAN
      ? { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") }
      : bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // A deadlock hangs the child forever. `signal` kills the child when the test times out.
    // Where the test timeout is longer than 60 s (CI), the spawn timeout kills it first and
    // the result shows a signalCode of "SIGKILL".
    signal,
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Debug builds print "[macro] call <name>" to stdout when a macro runs.
  const lines = stdout.split("\n").filter(line => !line.startsWith("[macro]"));
  return { stdout: normalizeBunSnapshot(lines.join("\n"), cwd), stderr, exitCode, signalCode: proc.signalCode };
}

// The outer Bun.build runs in a child process: before the fix it deadlocked the singleton
// bundler thread, and an in-process test cannot recover from that.
test.concurrent("Bun.build from macro during bundling throws instead of hanging", async ({ signal }) => {
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

  expect(await run(signal, String(dir), "build_script.ts")).toEqual({
    stdout: `BUILD_SUCCESS\n${bundle}`,
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("CLI bun build with macro that calls Bun.build also throws", async ({ signal }) => {
  using dir = tempDir("issue-26360-cli", fixture);

  // With no --outdir the CLI writes the bundle to stdout and prints no summary.
  expect(await run(signal, String(dir), "build", "index.ts", "--target=node")).toEqual({
    stdout: bundle,
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
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
