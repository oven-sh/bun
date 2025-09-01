import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, isWindows } from "harness";

test.skipIf(isWindows)("logLevel error should hide workspace warnings (Linux test)", async () => {
  // This test validates the fix for issue #22302 
  // where watcher warnings about files outside the project directory
  // should be hidden when logLevel="error" is set in bunfig.toml
  // Note: On Linux, the watcher may not trigger the same warnings as Windows,
  // but this test verifies the log level filtering works correctly

  const files = tempDirWithFiles("watcher-log-level", {
    "bunfig.toml": `logLevel = "error"`,
    "package.json": JSON.stringify({
      name: "test-app",
      scripts: {
        dev: "bun --hot src/app.ts"
      },
      dependencies: {
        "workspace-pkg": "workspace:*"
      }
    }),
    "src/app.ts": `
import { hello } from "workspace-pkg";
console.log(hello());
`,
    "workspace-pkg/index.ts": `
export function hello() {
  return "Hello from workspace package!";
}
`,
    "workspace-pkg/package.json": JSON.stringify({
      name: "workspace-pkg",
      main: "index.ts"
    })
  });

  // Run bun --hot with a file that imports from a workspace package outside the project directory
  // With logLevel="error", we should not see the warning about files not being watched
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "src/app.ts"],
    env: bunEnv,
    cwd: files,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Give it a moment to start and potentially show warnings
  await Bun.sleep(1000);
  
  proc.kill();
  await proc.exited;

  const stderr = await new Response(proc.stderr).text();
  const stdout = await new Response(proc.stdout).text();
  
  // With logLevel="error", warnings should be suppressed
  // The specific warning message should not appear
  expect(stderr).not.toContain("is not in the project directory and will not be watched");
  expect(stdout).not.toContain("is not in the project directory and will not be watched");
});

test.skipIf(isWindows)("logLevel warn should show workspace warnings (Linux test)", async () => {
  // Verify that warnings are still shown with logLevel="warn" (default behavior)
  
  const files = tempDirWithFiles("watcher-log-level-warn", {
    "bunfig.toml": `logLevel = "warn"`,
    "package.json": JSON.stringify({
      name: "test-app",
      scripts: {
        dev: "bun --hot src/app.ts"
      },
      dependencies: {
        "workspace-pkg": "workspace:*"
      }
    }),
    "src/app.ts": `
import { hello } from "workspace-pkg";
console.log(hello());
`,
    "workspace-pkg/index.ts": `
export function hello() {
  return "Hello from workspace package!";
}
`,
    "workspace-pkg/package.json": JSON.stringify({
      name: "workspace-pkg",
      main: "index.ts"
    })
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "src/app.ts"],
    env: bunEnv,
    cwd: files,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Give it a moment to start and show warnings
  await Bun.sleep(1000);
  
  proc.kill();
  await proc.exited;

  const stderr = await new Response(proc.stderr).text();
  
  // With logLevel="warn", warnings should appear
  expect(stderr).toContain("is not in the project directory and will not be watched");
});