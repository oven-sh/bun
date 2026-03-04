import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("onLoad callback receives namespace property for file namespace", async () => {
  using dir = tempDir("issue-27793", {
    "plugin.ts": `
      import { plugin } from "bun";
      import { readFileSync } from "fs";
      plugin({
        name: "test-plugin",
        setup(build) {
          build.onLoad({ filter: /\\.js$/, namespace: "file" }, (args) => {
            console.log(JSON.stringify({ path: typeof args.path, namespace: args.namespace }));
            const contents = readFileSync(args.path, "utf8");
            return { contents, loader: "js" };
          });
        },
      });
    `,
    "main.js": `console.log("ok");`,
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
  const pluginOutput = JSON.parse(lines[0]);
  expect(pluginOutput.path).toBe("string");
  expect(pluginOutput.namespace).toBe("file");
  expect(lines[1]).toBe("ok");
  expect(exitCode).toBe(0);
});

test("onLoad callback receives namespace property for custom namespace", async () => {
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
                default: { namespace: args.namespace, path: args.path },
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
  expect(exitCode).toBe(0);
});
