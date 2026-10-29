// Node sizes the libuv pool from a UV_THREADPOOL_SIZE that `--env-file` sets
// (test/node-api/test_uv_threadpool_size/node-options.js).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { readFileSync } from "node:fs";
import path from "node:path";

const cores = 4;
const files = {
  "probe.mjs": readFileSync(path.join(import.meta.dir, "thread-pool-size-fixture.mjs"), "utf8"),
  "main.cjs": `require("./probe.mjs").print();`,
  "main.mjs": `import { print } from "./probe.mjs";\nawait print();`,
  "pool.test.js": `require("bun:test").test("pool", () => require("./probe.mjs").print());`,
  "worker.cjs": `new Worker(require.resolve("./main.cjs"), { env: { ...process.env, UV_THREADPOOL_SIZE: "2" } });`,
  "empty.env": "UV_THREADPOOL_SIZE=\n",
  "three.env": "UV_THREADPOOL_SIZE=3\n",
  "six.env": "UV_THREADPOOL_SIZE=6\n",
};
type Run = { args: string[]; env?: Record<string, string>; argv0?: string; stdin?: string; dotenv?: string };

/** What the fixture prints once `busy` threads of the pool are busy. */
async function pool(busy: number, { args, env, argv0, stdin, dotenv }: Run) {
  using dir = tempDir("thread-pool-size", dotenv ? { ...files, ".env": dotenv } : files);
  // One more than the most threads that a pool here has.
  for (let i = 0; i < 6; i++) mkfifo(path.join(String(dir), `fifo${i}`));
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    argv0,
    cwd: String(dir),
    env: {
      ...bunEnv,
      UV_THREADPOOL_SIZE: undefined,
      GOMAXPROCS: undefined,
      WTF_numberOfProcessorCores: String(cores),
      BUSY_THREADS: String(busy),
      // Where the REPL keeps its history.
      HOME: String(dir),
      ...env,
    },
    stdin: stdin ? Buffer.from(stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // `bun test` and the REPL print more than the fixture does.
  const printed = stdout.split("\n").find(line => line.startsWith("{"));
  if (!printed) throw new Error(`the fixture printed nothing: ${JSON.stringify({ stdout, stderr, exitCode })}`);
  return { ...JSON.parse(printed), exitCode };
}

const three = files["three.env"];
const threeInFile = ["--env-file=three.env", "main.cjs"];

// The fixture counts the threads of the pool by name, which takes /proc.
// Not concurrent: twelve debug builds of bun that start at once can take longer than the time limit of a test.
describe.skipIf(!isLinux)("UV_THREADPOOL_SIZE from an env file sizes the thread pool", () => {
  test.each<[title: string, run: Run, size: string, threads: number]>([
    ["--env-file", { args: threeInFile }, "3", 3],
    // The imported file is transpiled on the pool, before the first statement of the entry point.
    [".env, and an entry point with a static import", { args: ["main.mjs"], dotenv: three }, "3", 3],
    ["bun run <file>", { args: ["run", "main.cjs"], dotenv: three }, "3", 3],
    ["-e", { args: ["--env-file=three.env", "-e", `require("./probe.mjs").print()`] }, "3", 3],
    ["the later of two --env-file", { args: ["--env-file=six.env", ...threeInFile] }, "3", 3],
    ["bun as node", { args: threeInFile, argv0: "node" }, "3", 3],
    ["bun test", { args: ["test", "./pool.test.js"], dotenv: three }, "3", 3],
    ["bun repl", { args: ["repl"], stdin: `await require("./probe.mjs").print()\n`, dotenv: three }, "3", 3],
    ["GOMAXPROCS in the environment does not win", { args: threeInFile, env: { GOMAXPROCS: "8" } }, "3", 3],
    ["UV_THREADPOOL_SIZE in the environment wins", { args: threeInFile, env: { UV_THREADPOOL_SIZE: "5" } }, "5", 5],
    ["an empty value is no size", { args: ["--env-file=empty.env", "main.cjs"] }, "", cores],
    ["the env option of a Worker does not size the pool of the process", { args: ["worker.cjs"] }, "2", cores],
  ])("%s", async (_, run, size, threads) => {
    expect(await pool(threads, run)).toEqual({ UV_THREADPOOL_SIZE: size, threads, exitCode: 0 });
  });
});
