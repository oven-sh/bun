import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/default-timeout";

// Compiled code counts on console.log() and its kin to run no code but that of their operands, whichever copy of the module has the subscriber:
// the one compiled with the program, or one made of the library's text for code from disk.
const subscribes = `
  const heard = [];
  for (const name of ["console.log", "console.error", "tracing:module.require:start", "tracing:module.import:start"])
    subscribe(name, () => heard.push(name));
  module.exports = heard;`;
const files = {
  "compiled.cjs": `const { subscribe } = require("node:diagnostics_channel");` + subscribes,
  "from-disk.cjs": `const { subscribe } = require("node:diagnostics_channel");` + subscribes,
  "body.cjs": `
    module.exports = async heard => {
      console.log("text");
      console.log(1, {});
      console.count();
      new console.Console(process.stdout).error("of a Console");
      require("node:os");
      await import("node:path");
      process.emitWarning("warned");
      await new Promise(resolve => setImmediate(resolve));
      process.stdout.write(heard.join() + "\\n");
    };`,
  "holds-the-module.cjs": `const body = require("./body.cjs"); body(require("./compiled.cjs"));`,
  "loads-it-from-disk.cjs": `const body = require("./body.cjs"); body(require(process.argv[2]));`,
};
const printed = ["text", "1 {}", "default: 1", "of a Console"];

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { lines: stdout.split("\n").filter(Boolean), stderr, exitCode };
}

for (const [entry, ...flags] of [["holds-the-module.cjs"], ["loads-it-from-disk.cjs", "--aot-allow-code-from-disk"]]) {
  test(
    entry,
    async () => {
      using dir = tempDir("console-channels", files);
      const cwd = String(dir);
      const [fromDisk, executable] = [join(cwd, "from-disk.cjs"), join(cwd, "program")];
      expect(await run([bunExe(), "run", entry, fromDisk], cwd)).toMatchObject({
        lines: [
          ...printed,
          "console.log,console.log,console.log,console.error,tracing:module.require:start,tracing:module.import:start,console.error",
        ],
        exitCode: 0,
      });
      const build = [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", executable];
      expect(await run(build, cwd)).toMatchObject({ exitCode: 0 });
      expect(await run([executable, fromDisk], cwd)).toMatchObject({
        lines: [...printed, "console.error"],
        exitCode: 0,
      });
    },
    240_000,
  );
}
