import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// A worker thread resolves its own entry point. These run the parent in a child process so that the
// specifier is looked up from the child's cwd and so that the whole process, worker thread included,
// is what gets checked.
async function runWorkerFixture(files: Record<string, string>, env: Record<string, string | undefined> = bunEnv) {
  using dir = tempDir("worker-entry-point", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("package.json imports alias as the entry point", () => {
  test("the worker runs and its thread exits without leaking", async () => {
    // Resolving through an "imports" (or "exports") map allocates the resolver's per thread scratch
    // buffers, which were not freed when the worker thread exited. On an ASAN build LeakSanitizer
    // turns that into a report on stderr and a failed exit. A build without ASAN ignores the options
    // and checks the behaviour only.
    const { stdout, stderr, exitCode } = await runWorkerFixture(
      {
        "package.json": JSON.stringify({ name: "app", imports: { "#worker": "./worker.js" } }),
        "worker.js": `postMessage("hi");`,
        "main.js": `
          const worker = new Worker("#worker");
          worker.addEventListener("error", event => console.log("error:", event.message));
          worker.addEventListener("message", event => { console.log("message:", event.data); worker.terminate(); });
          worker.addEventListener("close", () => console.log("closed"));
        `,
      },
      {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS:
          bunEnv.LSAN_OPTIONS ??
          `print_suppressions=0:suppressions=${path.join(import.meta.dir, "..", "..", "..", "leaksan.supp")}`,
      },
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("message: hi\nclosed\n");
    expect(exitCode).toBe(0);
    // LeakSanitizer's check at exit costs 4-5 s of wall time on a debug ASAN build by itself (`bun -e 1`
    // with detect_leaks=1 takes as long), which is the whole default budget.
  }, 30_000);

  test("an alias of a builtin fires the error event", async () => {
    // `new Worker("node:fs")` fails to resolve. An alias of a builtin resolves to the builtin marked
    // external, and that used to start a worker running node:fs as its entry point.
    const { stdout, stderr, exitCode } = await runWorkerFixture({
      "package.json": JSON.stringify({ name: "app", imports: { "#fs": "node:fs" } }),
      "main.js": `
        const worker = new Worker("#fs");
        worker.addEventListener("error", event => console.log("error:", event.message));
        worker.addEventListener("close", () => console.log("closed"));
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(
      'error: BuildMessage: Cannot use "#fs" as an entry point: it resolves to a builtin module\nclosed\n',
    );
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("relative specifier and preload resolve from the cwd at construction", () => {
  // The worker thread resolves the specifier some time after `new Worker()` returns. A process.chdir()
  // in between must not change which file the specifier (or a relative `preload`) names. Several
  // workers are created back to back so that the later threads have not resolved anything yet when
  // chdir runs.
  describe.each(["Worker", "worker_threads.Worker"])("%s", kind => {
    test("process.chdir() right after new Worker()", async () => {
      const post =
        kind === "Worker"
          ? `postMessage(where + " " + globalThis.preloaded);`
          : `require("node:worker_threads").parentPort.postMessage(where + " " + globalThis.preloaded);`;
      const { stdout, stderr, exitCode } = await runWorkerFixture({
        "preload.js": `globalThis.preloaded = "top";`,
        "worker.js": `const where = "top"; ${post}`,
        "other/preload.js": `globalThis.preloaded = "other";`,
        "other/worker.js": `const where = "other"; ${post}`,
        "main.js": `
          const WorkerClass = ${kind === "Worker" ? `globalThis.Worker` : `require("node:worker_threads").Worker`};
          function start() {
            const worker = new WorkerClass("./worker.js", { preload: "./preload.js" });
            return new Promise(resolve => {
              const done = value => { resolve(value); worker.terminate(); };
              if (WorkerClass === globalThis.Worker) {
                worker.onmessage = event => done(event.data);
                worker.onerror = event => done("error: " + event.message);
              } else {
                worker.on("message", done);
                worker.on("error", error => done("error: " + error.message));
              }
            });
          }
          const before = [start(), start(), start(), start()];
          process.chdir("other");
          const after = start();
          Promise.all([...before, after]).then(results => console.log(JSON.stringify(results)));
        `,
      });
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(["top top", "top top", "top top", "top top", "other other"]);
      expect(exitCode).toBe(0);
    });
  });
});
