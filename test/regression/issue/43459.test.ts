// https://github.com/oven-sh/bun/issues/43459
//
// A worker of node:worker_threads had the Web Worker globals (`self`, `postMessage`,
// `addEventListener` and four more). Since 1.4.0 only `parentPort` receives what the parent
// posts, so a library that tells a Web Worker by those globals (workerpool, the pthread glue
// of Emscripten) took its browser path in such a worker and waited for a message that never
// came. Node defines none of the names there, and the same code takes its `parentPort` path.
//
// Every program runs in a child with a spawn timeout. A worker that waits is killed, and the
// test fails on `signalCode` with the output it had so far.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

async function run(files: Record<string, string>, entry: string) {
  using dir = tempDir("issue-43459", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: isDebug ? 60_000 : 10_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, error: stderr.match(/^\w*Error: .*$/m)?.[0], exitCode, signalCode: proc.signalCode };
}

// The parent of the report: it answers "ready" with one message and ends the worker at the echo.
const parent = (worker: string) => `
const { Worker } = require("node:worker_threads");
const worker = ${worker};
worker.on("message", message => {
  console.log(JSON.stringify(message));
  if (message.ready) worker.postMessage({ a: 1 });
  else worker.terminate();
});
`;

// How workerpool 10.0.3 picks its channel (src/worker.js). The first message names the pick.
const detecting = (parentPort: string) => `
const isWebWorker = typeof self !== "undefined" && typeof postMessage === "function" && typeof addEventListener === "function";
const listen = isWebWorker
  ? callback => addEventListener("message", event => callback(event.data))
  : callback => ${parentPort}.on("message", callback);
const send = isWebWorker ? message => postMessage(message) : message => ${parentPort}.postMessage(message);
listen(request => send({ echo: request }));
send({ ready: isWebWorker ? "browser" : "worker_threads" });
`;

const answersOnParentPort = {
  stdout: `{"ready":"worker_threads"}\n{"echo":{"a":1}}\n`,
  error: undefined,
  exitCode: 0,
  signalCode: null,
};

test("a worker that detects a Web Worker by its globals uses parentPort: ES module", async () => {
  const result = await run(
    {
      "main.cjs": parent(`new Worker(require("node:path").join(__dirname, "worker.mjs"))`),
      "worker.mjs": `import { parentPort } from "node:worker_threads";\n` + detecting("parentPort"),
    },
    "main.cjs",
  );
  expect(result).toEqual(answersOnParentPort);
});

test("a worker that detects a Web Worker by its globals uses parentPort: CommonJS", async () => {
  const result = await run(
    {
      "main.cjs": parent(`new Worker(require("node:path").join(__dirname, "worker.cjs"))`),
      "worker.cjs": detecting(`require("node:worker_threads").parentPort`),
    },
    "main.cjs",
  );
  expect(result).toEqual(answersOnParentPort);
});

test("a worker that detects a Web Worker by its globals uses parentPort: eval", async () => {
  const text = detecting(`require("node:worker_threads").parentPort`);
  const result = await run({ "main.cjs": parent(`new Worker(${JSON.stringify(text)}, { eval: true })`) }, "main.cjs");
  expect(result).toEqual(answersOnParentPort);
});

// The two files of the report. Node 26.3.0 prints nothing and fails with this error.
test("the worker of the report fails as in Node, it does not wait", async () => {
  const result = await run(
    {
      "main.mjs": `import { Worker } from "node:worker_threads";
const w = new Worker(new URL("./worker.mjs", import.meta.url));
w.on("message", m => {
  console.log("parent got", JSON.stringify(m));
  if (m === "ready") w.postMessage({ a: 1 });
  else w.terminate();
});
`,
      "worker.mjs": `postMessage("ready");
addEventListener("message", e => postMessage("echo:" + JSON.stringify(e.data)));
`,
    },
    "main.mjs",
  );
  expect(result).toEqual({
    stdout: "",
    error: "ReferenceError: postMessage is not defined",
    exitCode: 1,
    signalCode: null,
  });
});
