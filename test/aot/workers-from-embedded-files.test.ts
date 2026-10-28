import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const timeout = 600_000;

// The executable stops where code of the build is interpreted.
const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

const answer = String.raw`"worker " + import.meta.path.split(/[\\/]/).pop().replace(/-[a-z0-9]+\.js$/, "-<hash>.js") + " answers " + double(event.data + 1)`;

const files = {
  "main.js": String.raw`
    import path from "./worker.js" with { type: "file" };
    console.log("the copy holds its text: " + (await Bun.file(path).text()).includes("postMessage"));
    const worker = new Worker(path);
    worker.onmessage = event => {
      console.log(event.data);
      worker.terminate();
    };
    worker.onerror = event => console.log("error: " + event.message.split("\n")[0]);
    worker.postMessage(20);
  `,
  "worker.js": `
    import { double } from "./shared.js";
    self.onmessage = event => postMessage(${answer});
  `,
  "shared.js": `export const double = value => value * 2;`,
};

const inOneFile = {
  ...files,
  "worker.js": `
    const double = value => value * 2;
    self.onmessage = event => postMessage(${answer});
  `,
};

const report = String.raw`
  function report(workers) {
    const lines = [];
    for (const worker of workers) {
      worker.onmessage = event => {
        worker.terminate();
        if (lines.push(event.data) === workers.length) console.log(lines.sort().join("\n"));
      };
      worker.onerror = event => console.log("error: " + event.message.split("\n")[0]);
    }
  }
`;

const waysToTheConstructor = {
  "main.js": `
    import direct from "./a.js" with { type: "file" };
    import { chosen } from "./paths.ts";
    import { Worker as NodeWorker } from "node:worker_threads";
    import ofNode from "./d.js" with { type: "file" };
    ${report}
    const held = direct;
    const begin = path => new Worker(path);
    const { default: awaited } = await import("./c.ts", { with: { type: "file" } });
    report([begin(held), new Worker(chosen), new Worker(awaited)]);
    new NodeWorker(ofNode).on("message", text => console.log(text));
  `,
  "paths.ts": `
    import b from "./b.ts" with { type: "file" };
    export const chosen = process.env.ANOTHER_WORKER ?? b;
  `,
  "a.js": `postMessage("a: through a variable and a parameter");`,
  "b.ts": `import { name } from "./shared.ts"; postMessage("b: through an export, with " + name);`,
  "c.ts": `const text: string = "c: out of import()"; postMessage(text);`,
  "d.js": `require("node:worker_threads").parentPort.postMessage("d: a Worker of node:worker_threads");`,
  "shared.ts": `export const name: string = "a file that it imports";`,
};

// How a library that supports several runtimes does it: no single file shows that the imported path reaches the constructor.
const throughALibrary = {
  "main.js": `
    import { Client } from "./library/index.js";
    console.log(await new Client().ask("text"));
  `,
  "library/assets.js": `
    import { dirname, isAbsolute, resolve } from "node:path";
    import { fileURLToPath } from "node:url";
    const host = globalThis;
    function findConstructor() {
      if (typeof host.Worker === "function") return host.Worker;
      throw new Error("this runtime has no Worker");
    }
    export const Worker = findConstructor();
    function normalize(loaded, base) {
      if (loaded.startsWith("file:")) return fileURLToPath(loaded);
      if (isAbsolute(loaded)) return loaded;
      return resolve(dirname(fileURLToPath(base)), loaded);
    }
    export async function pathOfBundledFile(load, fallback, base) {
      const loaded = (await load()).default;
      if (typeof loaded !== "string") return fileURLToPath(new URL(fallback, base));
      return normalize(loaded, base);
    }
    const bundledWorker = await pathOfBundledFile(
      () => import("./parser.worker.js", { with: { type: "file" } }),
      "./parser.worker.js",
      import.meta.url,
    );
    export const grammar = await pathOfBundledFile(
      () => import("./grammar.scm", { with: { type: "file" } }),
      "./grammar.scm",
      import.meta.url,
    );
    function choose(fallback) {
      const value = typeof fallback === "function" ? fallback() : fallback;
      return value instanceof URL ? fileURLToPath(value) : value;
    }
    export const defaultWorkerPath = () => choose(bundledWorker);
  `,
  "library/index.js": String.raw`
    import { Worker, defaultWorkerPath, grammar } from "./assets.js";
    export class Client {
      constructor(options = {}) {
        this.options = options;
      }
      resolveWorkerPath() {
        if (this.options.workerPath) return this.options.workerPath;
        if (process.env.PARSER_WORKER_PATH) return process.env.PARSER_WORKER_PATH;
        if (typeof PARSER_WORKER_PATH !== "undefined") return PARSER_WORKER_PATH;
        return defaultWorkerPath();
      }
      ask(text) {
        const path = this.resolveWorkerPath();
        const worker = new Worker(path);
        return new Promise((resolve, reject) => {
          worker.onmessage = event => {
            worker.terminate();
            resolve(event.data);
          };
          worker.onerror = event => reject(new Error(event.message.split("\n")[0]));
          worker.postMessage({ text, grammar });
        });
      }
    }
  `,
  "library/grammar.scm": `(identifier) @variable`,
  "library/parser.worker.js": `
    import { readFileSync } from "node:fs";
    self.onmessage = event => postMessage(event.data.text + " parsed by " + readFileSync(event.data.grammar, "utf8"));
  `,
};

// The object that starts the Worker is read from the global object, so the receiver of its methods is unknown. The path of the page is passed to native code, like the path of the worker.
const throughAnUnknownReceiver = {
  ...throughALibrary,
  "main.js": `
    import page from "./page.js" with { type: "file" };
    import { Client } from "./library/index.js";
    console.log((await Bun.file(page).text()).trim());
    const singletons = (globalThis[Symbol.for("singletons")] ??= {});
    singletons.client ??= new Client();
    console.log(await singletons.client.ask("text"));
  `,
  "page.js": `import "./a-file-that-only-the-browser-finds.js";`,
};

const embeddedForAnotherUse = {
  "main.js": `
    import page from "./page.js" with { type: "file" };
    import path from "./worker.js" with { type: "file" };
    ${report}
    console.log((await Bun.file(page).text()).trim());
    report([new Worker(path)]);
  `,
  "page.js": `import "./a-file-that-only-the-browser-finds.js";`,
  "worker.js": `postMessage("from the worker");`,
};

// No Worker starts from the two scripts: the program only reads them. Its one Worker gets a path from a method of an unknown receiver, so the compiler tries the scripts too.
const scriptsThatNoWorkerStarts = {
  ...throughALibrary,
  "main.js": `
    import first from "./vendor/first.min.js" with { type: "file" };
    import { second, secondAgain } from "./more.js";
    import { Client } from "./library/index.js";
    for (const path of [first, second]) console.log((await Bun.file(path).text()).trim());
    console.log(second === secondAgain);
    const singletons = (globalThis[Symbol.for("singletons")] ??= {});
    singletons.client ??= new Client();
    console.log(await singletons.client.ask("text"));
  `,
  "more.js": `
    import second from "./vendor/second.min.js" with { type: "file" };
    export { second };
    export { secondAgain } from "./again.js";
  `,
  "again.js": `
    import secondAgain from "./vendor/second.min.js" with { type: "file" };
    export { secondAgain };
  `,
  "vendor/first.min.js": `!function(){globalThis.first=1}();`,
  "vendor/second.min.js": `!function(){globalThis.second=2}();`,
};

// The paths of the pages and the path of the worker pass through one helper, so the compiler can't tell them apart. The pages are written for a browser.
const pageNames = ["a", "b", "c", "d", "e"];
const pagesBesideAWorker = {
  "main.js": `
    ${pageNames.map(name => `import ${name} from "./pages/${name}.js" with { type: "file" };`).join("\n    ")}
    import worker from "./worker.js" with { type: "file" };
    const later = value => new Promise(resolve => setTimeout(resolve, 0, value));
    for (const page of [${pageNames.join(", ")}]) console.log((await Bun.file(await later(page)).text()).trim());
    if (process.env.STARTS_WORKER) new Worker(await later(worker));
  `,
  ...Object.fromEntries(
    pageNames.map(name => [`pages/${name}.js`, `import "./${name}-that-only-the-browser-finds.js";`]),
  ),
  "worker.js": `postMessage("from the worker");`,
};

const preload = `, { preload: ["./job.js"] }`;

// A server that embeds the scripts of its pages and reads them by name. The paths of the pages and the path of the Worker pass through one helper.
function serverWithPages(count: number, workerOptions: string) {
  const pages = Array.from({ length: count }, (_, index) => `page-${index + 1}`);
  return {
    "main.ts": `
      import table from "./table.ts";
      const settings: any = JSON.parse(process.env.SETTINGS ?? "{}");
      function later<T>(value: T): Promise<T> { return new Promise(resolve => setTimeout(() => resolve(value), 0)); }
      console.log((await Bun.file(await later(table[settings.page ?? "page-1"]!)).text()).trim());
      const job = await later(settings.job ?? new URL("./job.js", import.meta.url));
      if (settings.job) new Worker(job${workerOptions});
    `,
    "table.ts": `
      ${pages.map((name, index) => `import page${index} from "./site/${name}.js" with { type: "file" };`).join("\n      ")}
      export default { ${pages.map((name, index) => `"${name}": page${index}`).join(", ")} } as Record<string, string>;
    `,
    "job.js": `postMessage("from the job");`,
    ...Object.fromEntries(pages.map(name => [`site/${name}.js`, `document.title = "${name}";`])),
  };
}

// The server starts its Worker with the import itself, and nothing mixes its path with those of the pages.
function serverWithPagesAndItsOwnWorker(count: number) {
  return {
    ...serverWithPages(count, ""),
    "main.ts": `
      import table from "./table.ts";
      import job from "./job.js" with { type: "file" };
      const settings: any = JSON.parse(process.env.SETTINGS ?? "{}");
      console.log((await Bun.file(table[settings.page ?? "page-1"]!).text()).trim());
      const worker = new Worker(job);
      worker.onmessage = event => { console.log(event.data); worker.terminate(); };
    `,
  };
}

// What a build did: the files of untyped code that it compiled, in all its programs, how often it ran the engine, and which embedded files it says it left out, and where.
async function countCompiled(folder: string, entryPoint: string) {
  const executable = join(folder, isWindows ? "server.exe" : "server");
  const flags = ["--aot", "--explain=statistics"];
  const build = await spawned(
    [bunExe(), "build", "--compile", ...flags, entryPoint, "--outfile", executable],
    folder,
    bunEnv,
  );
  built(build);
  const ran = await spawned([executable], folder, compiledOnly);
  return {
    untypedFiles: Number(/^SourceFilesInferred (\d+)$/m.exec(build.stderr)?.[1]),
    engineRuns: Number(/^EngineRuns (\d+)$/m.exec(build.stderr)?.[1]),
    leftOut: /TS100071: .* fails to load: (.*)\. Add the file/.exec(build.stderr)?.[1].replace(/"[^"]*[\\/]/g, '"'),
    leftOutAt: /TS100071: .*\n\s+at .*[\\/](.+:\d+:\d+)/.exec(build.stderr)?.[1],
    stdout: ran.stdout,
    exitCode: ran.exitCode,
  };
}

async function compileAndRun(folder: string, flags: string[], entryPoints: string[], env = bunEnv) {
  const executable = join(folder, "program" + flags.join("") + entryPoints.length + (isWindows ? ".exe" : ""));
  const build = await spawned(
    [bunExe(), "build", "--compile", ...flags, ...entryPoints, "--outfile", executable],
    folder,
    bunEnv,
  );
  built(build);
  return spawned([executable], folder, env);
}

describe.concurrent("a Worker started by the path of a file that is embedded with the file loader", () => {
  test(
    "runs the compiled program where the file is an entry point too",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", files);
        const ran = await compileAndRun(String(dir), ["--aot"], ["./main.js", "./worker.js"], compiledOnly);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: "the copy holds its text: true\nworker worker.js answers 42\n",
          exitCode: 0,
        });
      }),
    timeout,
  );

  test("runs under bun run", async () => {
    using dir = tempDir("aot-worker-from-embedded-file", files);
    const { stdout, exitCode } = await spawned([bunExe(), "run", "main.js"], String(dir), bunEnv);
    expect({ stdout, exitCode }).toEqual({
      stdout: "the copy holds its text: true\nworker worker.js answers 42\n",
      exitCode: 0,
    });
  });

  test(
    "runs the copy where the file is no entry point: bun build --compile",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", inOneFile);
        const { stdout, exitCode } = await compileAndRun(String(dir), [], ["./main.js"]);
        expect({ stdout, exitCode }).toEqual({
          stdout: "the copy holds its text: true\nworker worker-<hash>.js answers 42\n",
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "is compiled under the path of the copy where the file is no entry point: bun build --compile --aot",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", inOneFile);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot"], ["./main.js"], compiledOnly);
        expect({ stdout, exitCode }).toEqual({
          stdout: "the copy holds its text: true\nworker worker-<hash>.js answers 42\n",
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "is compiled with what it imports",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", files);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot"], ["./main.js"], compiledOnly);
        expect({ stdout, exitCode }).toEqual({
          stdout: "the copy holds its text: true\nworker worker-<hash>.js answers 42\n",
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "is compiled in an executable that runs in place",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", files);
        const flags = ["--aot", "--compile-in-place"];
        const { stdout, exitCode } = await compileAndRun(String(dir), flags, ["./main.js"], compiledOnly);
        expect({ stdout, exitCode }).toEqual({
          stdout: "the copy holds its text: true\nworker worker.js answers 42\n",
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "is compiled whichever way the path comes to the constructor",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", waysToTheConstructor);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot"], ["./main.js"], compiledOnly);
        expect({ lines: stdout.trim().split("\n").sort(), exitCode }).toEqual({
          lines: [
            "a: through a variable and a parameter",
            "b: through an export, with a file that it imports",
            "c: out of import()",
            "d: a Worker of node:worker_threads",
          ],
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "is compiled when the path reaches the constructor through several files",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", throughALibrary);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot"], ["./main.js"], compiledOnly);
        expect({ stdout, exitCode }).toEqual({ stdout: "text parsed by (identifier) @variable\n", exitCode: 0 });
      }),
    timeout,
  );

  test(
    "is compiled when the path comes from a method of an unknown receiver, and an embedded browser file is left alone",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", throughAnUnknownReceiver);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot"], ["./main.js"], compiledOnly);
        expect({ stdout, exitCode }).toEqual({
          stdout: 'import "./a-file-that-only-the-browser-finds.js";\ntext parsed by (identifier) @variable\n',
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "leaves a file alone that is embedded for another use",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", embeddedForAnotherUse);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot"], ["./main.js"], compiledOnly);
        expect({ stdout, exitCode }).toEqual({
          stdout: 'import "./a-file-that-only-the-browser-finds.js";\nfrom the worker\n',
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "leaves many embedded pages alone whose paths share a helper with the path of a worker",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", pagesBesideAWorker);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot"], ["./main.js"], compiledOnly);
        expect({ stdout, exitCode }).toEqual({
          stdout: pageNames.map(name => `import "./${name}-that-only-the-browser-finds.js";\n`).join(""),
          exitCode: 0,
        });
      }),
    timeout,
  );

  test.each([
    [100, "", { untypedFiles: 0, engineRuns: 1, leftOut: '"page-1.js", "page-10.js", "page-100.js" and 97 more' }],
    [100, preload, { untypedFiles: 0, engineRuns: 1, leftOut: '"page-1.js", "page-10.js", "page-100.js" and 97 more' }],
    [5, "", { untypedFiles: 0, engineRuns: 1, leftOut: '"page-1.js", "page-2.js", "page-3.js" and 2 more' }],
    // Few enough to try: each is a program of its own, and both numbers see it.
    [4, "", { untypedFiles: 4, engineRuns: 5, leftOut: undefined }],
    // Not worth a second build of the whole program.
    [4, preload, { untypedFiles: 0, engineRuns: 1, leftOut: '"page-1.js", "page-2.js", "page-3.js" and 1 more' }],
  ])(
    "compiles none of many embedded pages that the program reads: %d pages, new Worker(path%s)",
    (pages, workerOptions, counts) =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", serverWithPages(pages, workerOptions));
        expect(await countCompiled(String(dir), "./main.ts")).toEqual({
          ...counts,
          leftOutAt: counts.leftOut && "main.ts:7:29",
          stdout: 'document.title = "page-1";\n',
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "compiles the one file that starts a Worker beside many embedded pages, and warns about nothing",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", serverWithPagesAndItsOwnWorker(100));
        expect(await countCompiled(String(dir), "./main.ts")).toEqual({
          untypedFiles: 1,
          engineRuns: 2,
          leftOut: undefined,
          leftOutAt: undefined,
          stdout: 'document.title = "page-1";\nfrom the job\n',
          exitCode: 0,
        });
      }),
    timeout,
  );

  test.each([[[]], [["--asset-naming=[name].[ext]"]]])(
    "keeps the bytes of scripts that no Worker starts, imported once and twice %j",
    flags =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", scriptsThatNoWorkerStarts);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot", ...flags], ["./main.js"], compiledOnly);
        expect({ stdout, exitCode }).toEqual({
          stdout:
            "!function(){globalThis.first=1}();\n!function(){globalThis.second=2}();\ntrue\ntext parsed by (identifier) @variable\n",
          exitCode: 0,
        });
      }),
    timeout,
  );
});
