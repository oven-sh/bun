import { spawn } from "bun";
import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { join } from "path";

const timeout = isDebug ? Infinity : 10_000;

test.each(["--hot", "--watch"])(
  "should reload imported files when using Bun.plugin onLoad with %s",
  async flag => {
    using dir = tempDir("plugin-onload", {
      "plugin.ts": `
import { plugin } from "bun";

plugin({
  name: "test-plugin",
  setup(build) {
    build.onLoad({ filter: /\\.custom$/ }, (args) => {
      const fs = require("fs");
      const contents = fs.readFileSync(args.path, "utf8");
      return {
        contents: \`export const value = "\${contents.trim()}";\`,
        loader: "ts",
      };
    });
  },
});
`,
      "data.custom": "value-0",
      "index.ts": `
import { value } from "./data.custom";
console.log("[#!root] Value:", value);
`,
    });

    const pluginFile = join(String(dir), "plugin.ts");
    const customFile = join(String(dir), "data.custom");
    const entryFile = join(String(dir), "index.ts");

    try {
      var runner = spawn({
        cmd: [bunExe(), "--preload", pluginFile, flag, entryFile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      var reloadCounter = 0;
      var finished = false;

      async function onReload() {
        writeFileSync(customFile, `value-${reloadCounter}`);
      }

      const killTimeout = setTimeout(() => {
        finished = true;
        runner.kill(9);
      }, 5000);

      var str = "";
      for await (const line of runner.stdout) {
        if (finished) break;
        str += new TextDecoder().decode(line);
        var any = false;
        if (!/\[#!root\] Value:/g.test(str)) continue;

        for (let line of str.split("\n")) {
          if (!line.includes("[#!root]")) continue;
          reloadCounter++;
          str = "";

          if (reloadCounter === 3) {
            clearTimeout(killTimeout);
            runner.unref();
            runner.kill();
            finished = true;
            break;
          }

          expect(line).toContain(`[#!root] Value: value-${reloadCounter - 1}`);
          any = true;
        }

        if (any) await onReload();
      }

      // Plugin-loaded files should trigger reloads when they change
      expect(reloadCounter).toBeGreaterThanOrEqual(3);
    } finally {
      // @ts-ignore
      runner?.unref?.();
      // @ts-ignore
      runner?.kill?.(9);
    }
  },
  timeout,
);

test.each(["--hot", "--watch"])(
  "should reload imported files when NOT using Bun.plugin (control test) with %s",
  async flag => {
    using dir = tempDir("plugin-onload-control", {
      "data.js": `export const value = "value-0";`,
      "index.ts": `
import { value } from "./data.js";
console.log("[#!root] Value:", value);
`,
    });

    const dataFile = join(String(dir), "data.js");
    const entryFile = join(String(dir), "index.ts");

    try {
      var runner = spawn({
        cmd: [bunExe(), flag, entryFile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      var reloadCounter = 0;

      async function onReload() {
        writeFileSync(dataFile, `export const value = "value-${reloadCounter}";`);
      }

      var str = "";
      for await (const line of runner.stdout) {
        str += new TextDecoder().decode(line);
        var any = false;
        if (!/\[#!root\] Value:/g.test(str)) continue;

        for (let line of str.split("\n")) {
          if (!line.includes("[#!root]")) continue;
          reloadCounter++;
          str = "";

          if (reloadCounter === 3) {
            runner.unref();
            runner.kill();
            break;
          }

          expect(line).toContain(`[#!root] Value: value-${reloadCounter - 1}`);
          any = true;
        }

        if (any) await onReload();
      }

      expect(reloadCounter).toBeGreaterThanOrEqual(3);
    } finally {
      // @ts-ignore
      runner?.unref?.();
      // @ts-ignore
      runner?.kill?.(9);
    }
  },
  timeout,
);
