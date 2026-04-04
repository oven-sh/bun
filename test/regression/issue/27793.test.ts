import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("onLoad callback receives namespace and importer for file namespace", async () => {
  using dir = tempDir("issue-27793", {
    "plugin.ts": `
      import { plugin } from "bun";
      import { readFileSync } from "fs";
      plugin({
        name: "test-plugin",
        setup(build) {
          build.onLoad({ filter: /\\.js$/, namespace: "file" }, (args) => {
            console.log(JSON.stringify({
              path: typeof args.path,
              namespace: args.namespace,
              importer: typeof args.importer,
            }));
            const contents = readFileSync(args.path, "utf8");
            return { contents, loader: "js" };
          });
        },
      });
    `,
    "main.js": `
      import "./lib.js";
      console.log("ok");
    `,
    "lib.js": `console.log("lib");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./plugin.ts", "./main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  // The plugin is called for main.js (entry point) and lib.js (imported by main.js)
  const mainOutput = JSON.parse(lines[0]);
  expect(mainOutput.path).toBe("string");
  expect(mainOutput.namespace).toBe("file");
  expect(mainOutput.importer).toBe("string");
  expect(exitCode).toBe(0);
});

test("onLoad callback receives namespace and importer for custom namespace", async () => {
  using dir = tempDir("issue-27793-custom-ns", {
    "plugin.ts": `
      import { plugin } from "bun";
      plugin({
        name: "test-plugin",
        setup(build) {
          build.onResolve({ filter: /.*/, namespace: "custom" }, (args) => {
            return { path: args.path, namespace: "custom" };
          });
          build.onLoad({ filter: /.*/, namespace: "custom" }, (args) => {
            return {
              exports: {
                default: { namespace: args.namespace, path: args.path, importer: args.importer },
              },
              loader: "object",
            };
          });
        },
      });
    `,
    "main.js": `
      import result from "custom:hello";
      console.log(JSON.stringify(result));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./plugin.ts", "./main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.namespace).toBe("custom");
  expect(result.path).toBe("hello");
  expect(typeof result.importer).toBe("string");
  expect(exitCode).toBe(0);
});
