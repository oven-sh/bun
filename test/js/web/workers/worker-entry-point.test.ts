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
        // With the main VM freed at exit, LeakSanitizer has no suppressed leak to symbolize (seconds on a debug build).
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS:
          bunEnv.LSAN_OPTIONS ??
          `print_suppressions=0:suppressions=${path.join(import.meta.dir, "..", "..", "..", "leaksan.supp")}`,
      },
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("message: hi\nclosed\n");
    expect(exitCode).toBe(0);
  });

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

// The resolver reports what is wrong in a tsconfig.json or a package.json to the thread that reads the
// directory first. The parent reads none of the directories below, so that thread is the worker.
// An 'error' event says that the worker failed. A worker that runs fires none for such a report.
describe.concurrent("a diagnostic in the log of the worker", () => {
  const entry = `
    self.addEventListener("error", event => postMessage("error in the worker: " + event.message));
    postMessage("hi");
  `;
  // `specifier` is the source text of the first argument of `new Worker()`.
  const parent = (specifier: string) => `
    const worker = new Worker(${specifier});
    worker.addEventListener("error", event => console.log("error:", event.message));
    worker.addEventListener("message", event => {
      console.log("message:", event.data);
      if (event.data === "ready") worker.postMessage(import.meta.dir);
    });
    worker.addEventListener("close", event => console.log("closed", event.code));
  `;

  test.each([
    ["a file beside a tsconfig.json that does not parse", `"./sub/worker.ts"`, { "sub/tsconfig.json": "{" }],
    [
      "an absolute path beside a tsconfig.json with a warning",
      `import.meta.dir + "/sub/worker.ts"`,
      { "sub/tsconfig.json": JSON.stringify({ compilerOptions: { moduleSuffixes: [".ios"] } }) },
    ],
    [
      "a path with no extension beside a package.json that does not parse",
      `"./sub/worker"`,
      { "sub/package.json": "{" },
    ],
    [
      "a directory with a main, beside a tsconfig.json that does not parse",
      `"./sub"`,
      { "sub/package.json": JSON.stringify({ main: "./worker.ts" }), "sub/tsconfig.json": "{" },
    ],
    [
      "a directory with a package.json that does not parse",
      `"./sub"`,
      { "sub/package.json": "{", "sub/index.ts": entry },
    ],
    [
      "in a package with a package.json that does not parse",
      `"pkg/worker"`,
      { "node_modules/pkg/package.json": "{", "node_modules/pkg/worker.ts": entry },
    ],
    [
      "an alias in imports, to a file beside a tsconfig.json that does not parse",
      `"#worker"`,
      { "package.json": JSON.stringify({ imports: { "#worker": "./sub/worker.ts" } }), "sub/tsconfig.json": "{" },
    ],
    [
      "a blob: URL of a file beside a tsconfig.json that does not parse",
      `URL.createObjectURL(Bun.file(import.meta.dir + "/sub/worker.ts"))`,
      { "sub/tsconfig.json": "{" },
    ],
  ])("no error event when the entry point is %s", async (_, specifier, files) => {
    const result = await runWorkerFixture({ "sub/worker.ts": entry, ...files, "main.js": parent(specifier) });
    expect(result).toEqual({ stdout: "message: hi\nclosed 0\n", stderr: "", exitCode: 0 });
  });

  test("no error event for a define that is not valid", async () => {
    // Each worker applies the defines of the process again. The main thread prints the report.
    const result = await runWorkerFixture({
      "bunfig.toml": `[define]\n"a-b" = "1"\n`,
      "worker.js": entry,
      "main.js": parent(`"./worker.js"`),
    });
    expect(result).toEqual({
      stdout: "message: hi\nclosed 0\n",
      stderr: 'error: define key "a-b" must be a valid identifier\n',
      exitCode: 0,
    });
  });

  test("no error event when the worker exits, for a file that it imports later", async () => {
    // The import of a Bun.file through a blob: URL reads the directory of the file.
    const result = await runWorkerFixture({
      "late/tsconfig.json": "{",
      "late/mod.ts": `export const x = 1;`,
      "worker.js": `
        self.onmessage = async event => {
          self.onmessage = null;
          const mod = await import(URL.createObjectURL(Bun.file(event.data + "/late/mod.ts")));
          postMessage("imported " + mod.x);
        };
        postMessage("ready");
      `,
      "main.js": parent(`"./worker.js"`),
    });
    expect(result).toEqual({ stdout: "message: ready\nmessage: imported 1\nclosed 0\n", stderr: "", exitCode: 0 });
  });

  test("one error event, for what it threw, when the worker throws later", async () => {
    const result = await runWorkerFixture({
      "sub/tsconfig.json": "{",
      "sub/worker.ts": `
        self.onmessage = () => {
          throw "thrown later";
        };
        postMessage("ready");
      `,
      "main.js": parent(`"./sub/worker.ts"`),
    });
    expect(result).toEqual({ stdout: "message: ready\nerror: thrown later\nclosed 1\n", stderr: "", exitCode: 0 });
  });
});
