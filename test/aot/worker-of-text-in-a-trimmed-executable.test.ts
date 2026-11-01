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

// The build cannot know these texts, so it compiles none of them.
const made = `Buffer.from(${JSON.stringify(text)}).toString()`;
const filesWithTextMadeAtRunTime = {
  "made-at-run-time.js": `import "./made-blob-url.js";\nimport "./made-evaluated.js";\n`,
  "made-blob-url.js": `const worker = new Worker(URL.createObjectURL(new Blob([${made}], { type: "application/javascript" })));${listen("a blob: URL")}`,
  "made-evaluated.js": `import { Worker } from "node:worker_threads";
const worker = new Worker(Buffer.from("require('node:worker_threads').parentPort.postMessage('ran')").toString(), { eval: true });
worker.on("message", message => {
  console.log("eval: true of node:worker_threads", "message", message);
  worker.terminate();
});
worker.on("error", error => console.log("eval: true of node:worker_threads", "error", error.message.replace(/blob:[-0-9a-f]+/, "blob:")));
`,
};

// One build of each program serves every test.
const trimmedWithReport = ["--aot", "--trim", "--explain=trim"];
const { folder, build } = sharedBuilds("worker-of-text", { ...files, ...filesWithTextMadeAtRunTime });

if (!canTrim)
  console.error("SKIPPED: worker-of-text-in-a-trimmed-executable.test.ts: this build of Bun doesn't support --trim");

test.skipIf(!canTrim || !!unsupported)(
  "a trimmed executable reports the same for a Worker made from text as one that is not trimmed",
  async () => {
    const [whole, trimmed] = await Promise.all([
      build("program.js", "--aot"),
      build("program.js", ...trimmedWithReport),
    ]);
    const reported = async (executable: string) => {
      const { stdout, exitCode } = await run([executable], folder);
      return { lines: stdout.split("\n").sort(), exitCode };
    };
    const byWhole = await reported(whole.executable);
    expect(byWhole.lines.length).toBe(4);
    expect(await reported(trimmed.executable)).toEqual(byWhole);
  },
);

test.skipIf(!canTrim || !!unsupported)(
  "a trimmed executable runs a Worker made from text that the build has not seen",
  async () => {
    const [whole, trimmed] = await Promise.all([
      build("made-at-run-time.js", "--aot"),
      build("made-at-run-time.js", ...trimmedWithReport),
    ]);
    const linesOf = async (executable: string) =>
      (await run([executable], folder)).stdout
        .split("\n")
        .filter(line => / (message|error) /.test(line))
        .sort();
    expect(await linesOf(whole.executable)).toEqual([
      "a blob: URL message ran",
      "eval: true of node:worker_threads message ran",
    ]);
    expect(await linesOf(trimmed.executable)).toEqual(await linesOf(whole.executable));
  },
);

test.skipIf(!canTrim || !!unsupported)(
  "only a program that may start a Worker from text that the build has not seen keeps the transpiler",
  async () => {
    const report = async (entry: string) => {
      const { stdout, stderr } = await build(entry, ...trimmedWithReport);
      const lines = (stdout + stderr).split("\n");
      return {
        keepsTranspiler: lines.some(line => line.includes("trim: kept Bun.Transpiler and the transpiler")),
        saysWhy: lines.some(line => line.includes("starts a Worker from code that isn't in the executable")),
      };
    };
    expect(await report("made-at-run-time.js")).toEqual({ keepsTranspiler: true, saysWhy: true });
    expect(await report("program.js")).toEqual({ keepsTranspiler: false, saysWhy: false });
  },
);
