import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const outOfMemory = "RangeError: Out of memory";

test.each([
  [
    "process.stdout.write() hands the error to its callback and to a listener of 'error'",
    `process.stdout.on("error", say("listener"));
try {
  process.stdout.write("too large", say("callback"));
} catch (error) {
  say("thrown")(error);
}`,
    { messages: ["callback " + outOfMemory, "listener " + outOfMemory], stdout: "before\nafter\nlast\n", code: 0 },
  ],
  [
    "console.log() loses its line",
    `console.log("too large");`,
    { messages: [], stdout: "before\nafter\nlast\n", code: 0 },
  ],
  [
    "without a listener of 'error' the Worker ends with the error",
    `process.stdout.write("too large");`,
    { messages: ["worker error " + outOfMemory], stdout: "before\n", code: 1 },
  ],
])("a Worker's stdout goes on after a chunk that cannot be posted: %s", async (_, write, expected) => {
  using folder = tempDir("worker-stdout-out-of-memory", {
    "main.mjs": `import { Worker } from "node:worker_threads";
const worker = new Worker(new URL("./worker.mjs", import.meta.url), { stdout: true });
const messages = [];
let stdout = "";
let timer;
worker.stdout.setEncoding("utf8").on("data", text => (stdout += text));
worker.on("message", message => {
  if (message !== "started") return messages.push(message);
  timer = setTimeout(() => {
    messages.push("the Worker is still running");
    worker.terminate();
  }, 3000);
});
worker.on("error", error => messages.push("worker error " + error.name + ": " + error.message));
worker.on("exit", code => {
  clearTimeout(timer);
  console.log(JSON.stringify({ messages, stdout, code }));
});
`,
    "worker.mjs": `import { parentPort } from "node:worker_threads";
const from = Buffer.from;
Buffer.from = function (value, encoding) {
  if (typeof value === "string" && value.startsWith("too large")) throw new RangeError("Out of memory");
  return from.call(this, value, encoding);
};
const say = who => error => parentPort.postMessage(who + " " + error.name + ": " + error.message);
parentPort.postMessage("started");
process.stdout.write("before\\n");
setTimeout(() => {
  ${write}
  setTimeout(() => {
    process.stdout.write("after\\n");
    console.log("last");
  }, 10);
}, 10);
`,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(folder),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ result: JSON.parse(stdout), stderr, exitCode }).toEqual({ result: expected, stderr: "", exitCode: 0 });
});
