import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const reportOrigin = `process.on("uncaughtException", (error, origin) => parentPort.postMessage(error.message + ": " + origin));`;

const files = {
  "start.mjs": `import { Worker } from "node:worker_threads";
const firstMessage = entry => new Promise(resolve => new Worker(entry).once("message", resolve));
console.log(await firstMessage("./commonjs-entry.cjs"));
console.log(await firstMessage("./module-entry.mjs"));
`,
  "commonjs-entry.cjs": `const { parentPort } = require("node:worker_threads");
${reportOrigin}
throw new Error("CommonJS entry");
`,
  "module-entry.mjs": `import { parentPort } from "node:worker_threads";
${reportOrigin}
throw new Error("ES module entry");
`,
};

const buildFlags: Record<string, string[]> = {
  "an executable": [],
  "an in-place executable": ["--compile-in-place"],
};

test.each(Object.keys(buildFlags))(
  "a Worker entry that throws at top level reports the same origin in %s as under bun run",
  async kind => {
    using dir = tempDir("aot-worker-entry-throw-origin", files);
    const folder = String(dir);
    const plain = await run([bunExe(), "run", "./start.mjs"], folder, bunEnv);
    expect(plain).toEqual({
      stdout: "CommonJS entry: uncaughtException\nES module entry: unhandledRejection\n",
      stderr: "",
      exitCode: 0,
    });
    const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
    const built = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        ...buildFlags[kind],
        "./start.mjs",
        "./commonjs-entry.cjs",
        "./module-entry.mjs",
        "--outfile",
        executable,
      ],
      folder,
      bunEnv,
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(plain);
  },
  120_000,
);
