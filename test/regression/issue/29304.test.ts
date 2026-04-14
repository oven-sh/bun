import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29304
// webpack-cli@7 reads its internal CLIPlugin via:
//   const { default: CLIPlugin } = (await import("./plugins/cli-plugin.js")).default;
// This expects Node's CJS→ESM interop where (await import(cjs)).default is the
// whole module.exports object (which itself carries __esModule + default).
// Bun previously unwrapped .default to exports.default directly, so
// `.default.default` was undefined and `new CLIPlugin(...)` threw
// "undefined is not a constructor".

test("webpack-cli style: (await import(cjs)).default.default resolves the class", async () => {
  using dir = tempDir("issue-29304", {
    "node_modules/webpack-cli/lib/plugins/cli-plugin.js": `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      class CLIPlugin {
        constructor(options) {
          this.options = options;
        }
      }
      exports.default = CLIPlugin;
    `,
    "node_modules/webpack-cli/package.json": JSON.stringify({
      name: "webpack-cli",
      version: "7.0.2",
      main: "lib/plugins/cli-plugin.js",
    }),
    "build.mjs": `
      const { default: CLIPlugin } = (await import("webpack-cli/lib/plugins/cli-plugin.js")).default;
      if (typeof CLIPlugin !== "function") {
        console.error("FAIL: CLIPlugin is", typeof CLIPlugin);
        process.exit(1);
      }
      const instance = new CLIPlugin({ progress: true });
      console.log(JSON.stringify({
        type: typeof CLIPlugin,
        name: CLIPlugin.name,
        optionsProgress: instance.options.progress,
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(JSON.parse(stdout.trim())).toEqual({
    type: "function",
    name: "CLIPlugin",
    optionsProgress: true,
  });
  expect(exitCode).toBe(0);
});
