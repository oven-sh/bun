// Each file of the program makes a Worker from text and prints what the Worker reports.
import { expect } from "bun:test";
import { featureNamed, model } from "../bundler/compile-trim-features";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { sharedBuilds, type Build } from "./harness/shared-builds";
import { describe, test } from "./supported";
import { readRemovedFeatures } from "./trimmed-against-whole/removed-features";

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

// One build of each program writes the executable without --trim and the one with it, and serves every test. The tests run beside
// one another, so both programs are built at once and their four executables start at once.
const { folder, buildWholeAndTrimmed } = sharedBuilds("worker-of-text", { ...files, ...filesWithTextMadeAtRunTime });
const wholeAndTrimmed = (entry: string) => buildWholeAndTrimmed(entry, "--explain=trim");

/** What both executables of a program print. Its Workers report in any order, so the lines are sorted. */
async function reportedBy(entry: string) {
  const [whole, trimmed] = await wholeAndTrimmed(entry);
  const reported = async ({ executable }: Build) => {
    const { stdout, stderr, exitCode } = await run([executable], folder);
    return { lines: stdout.split("\n").sort(), stderr, exitCode };
  };
  const [byWhole, byTrimmed] = await Promise.all([reported(whole), reported(trimmed)]);
  return { whole: byWhole, trimmed: byTrimmed };
}

/** Each Worker sent its message and none failed. The empty line is what follows the last line break. */
const everyWorkerRan = (...lines: string[]) => ({ lines: ["", ...lines], stderr: "", exitCode: 0 });

function removedFrom(built: Build) {
  const indexes = readRemovedFeatures(built.file);
  expect(indexes).toBeDefined();
  return model.features.filter(feature => indexes!.includes(feature.index)).map(feature => feature.name);
}

describe.skipIf(!!without("a Bun that trims")).concurrent("a Worker made from text in a trimmed executable", () => {
  test("a trimmed executable reports the same for a Worker made from text as one that is not trimmed", async () => {
    const ran = everyWorkerRan(
      "a blob: URL message ran",
      "a data: URL message ran",
      "eval: true of node:worker_threads message ran",
    );
    expect(await reportedBy("program.js")).toEqual({ whole: ran, trimmed: ran });
  });

  test("a trimmed executable runs a Worker made from text that the build has not seen", async () => {
    const ran = everyWorkerRan("a blob: URL message ran", "eval: true of node:worker_threads message ran");
    expect(await reportedBy("made-at-run-time.js")).toEqual({ whole: ran, trimmed: ran });
  });

  test("a program that starts a Worker from text keeps the transpiler, and the build says why", async () => {
    const report = async (entry: string) => {
      const [whole, trimmed] = await wholeAndTrimmed(entry);
      const [, saidOfTheTranspiler] =
        /^aot: trim: (kept|removed) Bun\.Transpiler and the transpiler for code loaded at run time\b/m.exec(
          trimmed.stderr,
        ) ?? [];
      const removed = removedFrom(trimmed);
      const removedFromWhole = removedFrom(whole);
      return {
        saidOfTheTranspiler,
        saysWhy:
          /^aot: trim: blocked by dynamic-import: the program starts a Worker from code that isn't in the executable\b/m.test(
            trimmed.stderr,
          ),
        // What the executables themselves record: the trimmed one lacks all that the whole one lacks and more, and the
        // transpiler is none of it.
        lacksTheTranspiler: removed.includes(featureNamed("RuntimeTranspiler")),
        hasWhatTheWholeOneLacks: removedFromWhole.filter(name => !removed.includes(name)),
        lacksMoreThanTheWholeOne: removed.length > removedFromWhole.length,
      };
    };
    const keepsItAndSaysWhy = {
      saidOfTheTranspiler: "kept",
      saysWhy: true,
      lacksTheTranspiler: false,
      hasWhatTheWholeOneLacks: [],
      lacksMoreThanTheWholeOne: true,
    };
    expect(await report("made-at-run-time.js")).toEqual(keepsItAndSaysWhy);
    expect(await report("program.js")).toEqual(keepsItAndSaysWhy);
  });
});
