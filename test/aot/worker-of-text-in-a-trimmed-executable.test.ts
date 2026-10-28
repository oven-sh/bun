// Each program makes a Worker from text and prints what the Worker reports.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./run-programs";

const text = `postMessage("ran")`;
const listen = `
worker.onmessage = event => {
  console.log("message", event.data);
  worker.terminate();
};
worker.onerror = event => console.log("error", event.message.replace(/blob:[-0-9a-f]+/, "blob:"));
`;

const programs = {
  "a data: URL": `const worker = new Worker("data:application/javascript," + encodeURIComponent(${JSON.stringify(text)}));${listen}`,
  "a blob: URL": `const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(text)}], { type: "application/javascript" })));${listen}`,
  "eval: true of node:worker_threads": `import { Worker } from "node:worker_threads";
const worker = new Worker("require('node:worker_threads').parentPort.postMessage('ran')", { eval: true });
worker.on("message", message => {
  console.log("message", message);
  worker.terminate();
});
worker.on("error", error => console.log("error", error.message.replace(/blob:[-0-9a-f]+/, "blob:")));
`,
};

if (!canTrim)
  console.error("SKIPPED: worker-of-text-in-a-trimmed-executable.test.ts: this build of Bun doesn't support --trim");

(canTrim && !unsupported && !isWindows ? describe.concurrent : describe.skip)(
  "a trimmed executable reports the same for a Worker made from text as one that is not trimmed",
  () => {
    test.each(Object.entries(programs))(
      "%s",
      (_, program) =>
        slot(async () => {
          using dir = tempDir("worker-of-text", { "program.js": program });
          const folder = String(dir);
          const build = [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile"];
          built(await spawned([...build, "whole"], folder, bunEnv));
          built(await spawned([...build, "trimmed", "--trim"], folder, bunEnv));
          const whole = await spawned([join(folder, "whole")], folder, bunEnv);
          const trimmed = await spawned([join(folder, "trimmed")], folder, bunEnv);
          expect(whole.stdout).not.toBe("");
          expect({ stdout: trimmed.stdout, exitCode: trimmed.exitCode }).toEqual({
            stdout: whole.stdout,
            exitCode: whole.exitCode,
          });
        }),
      600_000,
    );
  },
);
