// Each file of the program makes a Worker from text and prints what the Worker reports.
import { expect, test } from "bun:test";
import { canTrim } from "../bundler/compile-trim-features";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

const text = `postMessage("ran")`;
const listen = (name: string) => `
worker.onmessage = event => {
  console.log(${JSON.stringify(name)}, "message", event.data);
  worker.terminate();
};
worker.onerror = event => console.log(${JSON.stringify(name)}, "error", event.message.replace(/blob:[-0-9a-f]+/, "blob:"));
`;

const files = {
  "program.js": `import "./data-url.js";\nimport "./blob-url.js";\nimport "./evaluated.js";\n`,
  "data-url.js": `const worker = new Worker("data:application/javascript," + encodeURIComponent(${JSON.stringify(text)}));${listen("a data: URL")}`,
  "blob-url.js": `const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(text)}], { type: "application/javascript" })));${listen("a blob: URL")}`,
  "evaluated.js": `import { Worker } from "node:worker_threads";
const worker = new Worker("require('node:worker_threads').parentPort.postMessage('ran')", { eval: true });
worker.on("message", message => {
  console.log("eval: true of node:worker_threads", "message", message);
  worker.terminate();
});
worker.on("error", error => console.log("eval: true of node:worker_threads", "error", error.message.replace(/blob:[-0-9a-f]+/, "blob:")));
`,
};

const { folder, build } = sharedBuilds("worker-of-text", files);

if (!canTrim)
  console.error("SKIPPED: worker-of-text-in-a-trimmed-executable.test.ts: this build of Bun doesn't support --trim");

test.skipIf(!canTrim || !!unsupported)(
  "a trimmed executable reports the same for a Worker made from text as one that is not trimmed",
  async () => {
    const [whole, trimmed] = await Promise.all([build("program.js", "--aot"), build("program.js", "--aot", "--trim")]);
    const reported = async (executable: string) => {
      const { stdout, exitCode } = await run([executable], folder);
      return { lines: stdout.split("\n").sort(), exitCode };
    };
    const byWhole = await reported(whole.executable);
    expect(byWhole.lines.length).toBe(4);
    expect(await reported(trimmed.executable)).toEqual(byWhole);
  },
);
