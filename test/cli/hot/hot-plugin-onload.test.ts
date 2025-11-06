import { spawn } from "bun";
import { beforeEach, expect, it } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, tmpdirSync } from "harness";
import { join } from "path";

const timeout = isDebug ? Infinity : 10_000;

let cwd = "";
beforeEach(() => {
  cwd = tmpdirSync();
});

it(
  "should hot reload imported files when using Bun.plugin onLoad",
  async () => {
    // Create plugin file
    const pluginFile = join(cwd, "plugin.ts");
    writeFileSync(
      pluginFile,
      `
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
    );

    // Create custom file that will be transformed by plugin
    const customFile = join(cwd, "data.custom");
    let counter = 0;
    writeFileSync(customFile, `value-${counter}`);

    // Create entrypoint that imports the custom file
    const entryFile = join(cwd, "index.ts");
    writeFileSync(
      entryFile,
      `
import { value } from "./data.custom";
console.log("[#!root] Value:", value);
`,
    );

    try {
      var runner = spawn({
        cmd: [bunExe(), "--preload", pluginFile, "--hot", entryFile],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      var reloadCounter = 0;
      var finished = false;

      async function onReload() {
        counter++;
        writeFileSync(customFile, `value-${counter}`);
      }

      const timeout = setTimeout(() => {
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
            clearTimeout(timeout);
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

      // Plugin-loaded files should trigger hot reloads when they change
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

it(
  "should hot reload imported files when NOT using Bun.plugin (control test)",
  async () => {
    // Create a normal JS file
    const dataFile = join(cwd, "data.js");
    let counter = 0;
    writeFileSync(dataFile, `export const value = "value-${counter}";`);

    // Create entrypoint that imports the data file
    const entryFile = join(cwd, "index.ts");
    writeFileSync(
      entryFile,
      `
import { value } from "./data.js";
console.log("[#!root] Value:", value);
`,
    );

    try {
      var runner = spawn({
        cmd: [bunExe(), "--hot", entryFile],
        env: bunEnv,
        cwd,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      var reloadCounter = 0;

      async function onReload() {
        counter++;
        writeFileSync(dataFile, `export const value = "value-${counter}";`);
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
