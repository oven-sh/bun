import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, type DirectoryTree } from "harness";

const WORKERS = 16;
const ROUNDS = 12;

// The threads of a process share what the resolver knows about each directory. In every round all of them ask at the
// same moment about directories that nobody has read: some that all ask about, some that one asks about.
// An answer taken from a directory that another thread has half read misses its package.json, its tsconfig.json or
// the node_modules above it.
const worker = `
import { relative } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

const { barrier, index, workers, rounds, root } = workerData;
const arrived = new Int32Array(barrier);
const answers = [];
for (let round = 0; round < rounds; round++) {
  Atomics.add(arrived, round, 1);
  Atomics.notify(arrived, round);
  for (let count; (count = Atomics.load(arrived, round)) < workers; ) Atomics.wait(arrived, round, count);

  const base = root + "/round-" + round;
  const resolve = (specifier, from) => {
    try {
      return relative(base, Bun.resolveSync(specifier, from)).replaceAll("\\\\", "/");
    } catch (error) {
      return "error: " + error.message;
    }
  };
  answers.push([
    resolve("./shared/one/two/lib", base),
    resolve("@alias/entry.js", base + "/shared/one/two/src"),
    resolve("dependency", base + "/shared/one/two/src"),
    resolve("./own-" + index + "/one/two/file", base),
    resolve("dependency", base + "/own-" + index + "/one/two"),
  ]);
}
parentPort.postMessage(answers);
`;

const main = `
import { Worker } from "node:worker_threads";

const [workers, rounds] = process.argv.slice(2).map(Number);
const barrier = new SharedArrayBuffer(4 * rounds);
const ask = index =>
  new Promise((resolve, reject) => {
    const workerData = { barrier, index, workers, rounds, root: import.meta.dir };
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), { workerData });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
console.log(JSON.stringify(await Promise.all(Array.from({ length: workers }, (_, index) => ask(index)))));
`;

// Without a package manager the threads read different directories at the same time. With one they take turns.
test.each([
  ["without auto-install", ["--no-install"]],
  ["with auto-install", []],
])("threads that ask about new directories at the same time get whole answers, %s", async (_, flags) => {
  const files: DirectoryTree = { "main.mjs": main, "worker.mjs": worker };
  for (let round = 0; round < ROUNDS; round++) {
    const base = `round-${round}`;
    files[`${base}/node_modules/dependency/package.json`] = JSON.stringify({ name: "dependency", main: "./main.js" });
    files[`${base}/node_modules/dependency/main.js`] = "";
    files[`${base}/node_modules/dependency/index.js`] = "";
    files[`${base}/shared/tsconfig.json`] = JSON.stringify({
      compilerOptions: { paths: { "@alias/*": ["./one/two/lib/*"] } },
    });
    files[`${base}/shared/one/two/lib/package.json`] = JSON.stringify({ main: "./entry.js" });
    files[`${base}/shared/one/two/lib/entry.js`] = "";
    files[`${base}/shared/one/two/lib/index.js`] = "";
    files[`${base}/shared/one/two/src/empty.js`] = "";
    for (let index = 0; index < WORKERS; index++) files[`${base}/own-${index}/one/two/file.js`] = "";
  }
  using dir = tempDir("resolve-from-many-threads", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...flags, "main.mjs", String(WORKERS), String(ROUNDS)],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const expected = Array.from({ length: WORKERS }, (_, index) =>
    Array.from({ length: ROUNDS }, () => [
      "shared/one/two/lib/entry.js",
      "shared/one/two/lib/entry.js",
      "node_modules/dependency/main.js",
      `own-${index}/one/two/file.js`,
      "node_modules/dependency/main.js",
    ]),
  );
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(expected);
  expect(exitCode).toBe(0);
});
