import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Test for https://github.com/oven-sh/bun/issues/26798
// Bun.build crashes on Windows when a plugin's onResolve returns null,
// falling back to the standard resolver, and the resulting path.pretty
// contains Windows backslashes.
test("Bun.build with plugin onResolve returning null should not crash", async () => {
  const dir = tempDirWithFiles("onresolve-null-test", {
    "src/index.ts": `import { foo } from "./foo"; console.log(foo);`,
    "src/foo.ts": `export const foo = "hello";`,
    "build.ts": `
const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  plugins: [
    {
      name: "null-returner",
      setup(build) {
        // Return null to trigger fallback to standard resolver
        build.onResolve({ filter: /.*/ }, (args) => {
          return null;
        });
      },
    },
  ],
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}
console.log("Build succeeded");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "build.ts"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Build succeeded");
  expect(exitCode).toBe(0);
});
