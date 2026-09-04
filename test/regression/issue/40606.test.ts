import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/40606
// A plugin onResolve hook that returns undefined (fall through to default
// resolution) resolves import records asynchronously, after the importer's
// parse has completed. The barrel optimization seeded its requested-exports
// bookkeeping only at parse completion, so a sideEffects:false barrel parsed
// after such an importer deferred its re-exports forever and tree-shaking
// dropped a still-referenced declaration.
test("onResolve returning undefined keeps re-exports through a sideEffects:false barrel", async () => {
  using dir = tempDir("issue-40606", {
    "pkg/package.json": JSON.stringify({
      name: "dep-package",
      type: "module",
      sideEffects: false,
    }),
    "pkg/dep.js": `export function _greet() { return "hi"; }`,
    "pkg/barrel.js": `export * from "./dep.js";`,
    "pkg/index.js": `export { _greet as greet } from "./barrel.js";`,
    "entry.js": `import { greet } from "./pkg/index.js";\nconsole.log(greet());`,
    "build.mjs": `
      const result = await Bun.build({
        entrypoints: ["./entry.js"],
        target: "bun",
        outdir: "./out",
        plugins: [
          {
            name: "passthrough",
            setup(build) {
              build.onResolve({ filter: /\\.js$/ }, () => undefined);
            },
          },
        ],
        throw: false,
      });
      if (!result.success) {
        console.error(result.logs.join("\\n"));
        process.exit(1);
      }
    `,
  });

  await using build = Bun.spawn({
    cmd: [bunExe(), "build.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    build.stdout.text(),
    build.stderr.text(),
    build.exited,
  ]);
  expect(buildStdout).toBe("");
  expect(buildStderr).toBe("");
  expect(buildExitCode).toBe(0);

  await using run = Bun.spawn({
    cmd: [bunExe(), "out/entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("hi\n");
  expect(exitCode).toBe(0);
});
