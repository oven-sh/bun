import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// A worker thread resolves its own entry point. These run the parent in a child process so that the
// specifier is looked up from the child's cwd and so that the whole process, worker thread included,
// is what gets checked.
async function runWorkerFixture(
  files: Record<string, string>,
  env: Record<string, string | undefined> = bunEnv,
  args: string[] = ["main.js"],
) {
  using dir = tempDir("worker-entry-point", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Logs what the worker posted (each fixture worker posts which file it is) or the error event, then lets
// the process exit.
const report = `
  worker.addEventListener("error", event => { console.log("error:", event.message); });
  worker.addEventListener("message", event => { console.log("loaded:", event.data); worker.terminate(); });
`;

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

// A string specifier resolves the way `import()` from the calling file would, and only then as an entry
// point relative to the project root (the cwd), which is what every specifier used to be resolved against.
describe.concurrent("string specifier", () => {
  test("is relative to the calling file, not the cwd the file was launched from", async () => {
    const { stdout, stderr, exitCode } = await runWorkerFixture(
      {
        "w.js": `postMessage("root w.js");`,
        "src/w.js": `postMessage("src/w.js");`,
        "src/main.js": `const worker = new Worker("./w.js"); ${report}`,
      },
      bunEnv,
      ["src/main.js"],
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("loaded: src/w.js\n");
    expect(exitCode).toBe(0);
  });

  test.each([
    ["a directory with a file of the same name", "sub", "sub/w.js"],
    ["an empty directory", "empty", "empty/.keep"],
  ])("process.chdir() into %s before new Worker() does not change which file loads", async (_, to, extra) => {
    const { stdout, stderr, exitCode } = await runWorkerFixture(
      {
        "w.js": `postMessage("w.js next to main.js");`,
        [extra]: `postMessage(${JSON.stringify(extra)});`,
        "main.js": `
          process.chdir(${JSON.stringify(to)});
          const worker = new Worker("./w.js");
          ${report}
        `,
      },
      bunEnv,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("loaded: w.js next to main.js\n");
    expect(exitCode).toBe(0);
  });

  test("preload entries resolve from the calling file too", async () => {
    const { stdout, stderr, exitCode } = await runWorkerFixture(
      {
        "src/setup.js": `globalThis.preloaded = "src/setup.js";`,
        "src/w.js": `postMessage(globalThis.preloaded + " then src/w.js");`,
        "src/main.js": `const worker = new Worker("./w.js", { preload: ["./setup.js"] }); ${report}`,
      },
      bunEnv,
      ["src/main.js"],
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("loaded: src/setup.js then src/w.js\n");
    expect(exitCode).toBe(0);
  });

  test("a bare specifier resolves through the calling file's node_modules", async () => {
    const { stdout, stderr, exitCode } = await runWorkerFixture(
      {
        "src/node_modules/dep/package.json": JSON.stringify({ name: "dep", exports: { "./worker": "./worker.js" } }),
        "src/node_modules/dep/worker.js": `postMessage("dep/worker");`,
        "src/main.js": `const worker = new Worker("dep/worker"); ${report}`,
      },
      bunEnv,
      ["src/main.js"],
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("loaded: dep/worker\n");
    expect(exitCode).toBe(0);
  });

  // What resolved before still resolves: a path relative to the project root, written in a file that is
  // somewhere else (or handed to a library that calls `new Worker()` from node_modules).
  test("still resolves against the project root when the calling file has no such module", async () => {
    const { stdout, stderr, exitCode } = await runWorkerFixture(
      {
        "workers/w.js": `postMessage("workers/w.js");`,
        "node_modules/pool/package.json": JSON.stringify({ name: "pool", main: "index.js" }),
        "node_modules/pool/index.js": `module.exports.spawn = path => new Worker(path);`,
        "src/main.js": `
          for (const worker of [new Worker("./workers/w.js"), require("pool").spawn("./workers/w.js")]) {
            await new Promise(done => {
              worker.addEventListener("error", event => { console.log("error:", event.message); done(); });
              worker.addEventListener("message", event => { console.log("loaded:", event.data); worker.terminate(); done(); });
            });
          }
        `,
      },
      bunEnv,
      ["src/main.js"],
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("loaded: workers/w.js\nloaded: workers/w.js\n");
    expect(exitCode).toBe(0);
  });

  test("from node:worker_threads stays relative to process.cwd(), as in Node.js", async () => {
    const { stdout, stderr, exitCode } = await runWorkerFixture(
      {
        "w.js": `require("worker_threads").parentPort.postMessage("w.js next to main.js");`,
        "sub/w.js": `require("worker_threads").parentPort.postMessage("sub/w.js");`,
        "main.js": `
          const { Worker } = require("worker_threads");
          process.chdir("sub");
          const worker = new Worker("./w.js");
          worker.on("error", error => { console.log("error:", error.message); });
          worker.on("message", message => { console.log("loaded:", message); worker.terminate(); });
        `,
      },
      bunEnv,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("loaded: sub/w.js\n");
    expect(exitCode).toBe(0);
  });
});
