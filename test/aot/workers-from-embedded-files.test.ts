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
});
