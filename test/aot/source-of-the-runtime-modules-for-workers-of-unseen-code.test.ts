// A Worker that starts from code which the build has not compiled runs the modules that come with the runtime from their source. An executable holds that source where the program may start such a Worker, and not where the build has compiled the code of every Worker.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, spawned, unsupported, withoutDebugInformation } from "./harness/commands";

function countModulesWithSource(executable: Buffer): number {
  const [magic, headerSize, recordSize] = ["BUNBLTNS", 48, 24] as const;
  for (let start = executable.indexOf(magic); start !== -1; start = executable.indexOf(magic, start + 1)) {
    if (start + headerSize > executable.length) break;
    const field = (index: number) => executable.readUInt32LE(start + magic.length + index * 4);
    const [version, moduleCount, modulesOffset, dataOffset, dataLength] = [0, 2, 3, 6, 7].map(field);
    if (version !== 2 || modulesOffset !== headerSize) continue;
    if (modulesOffset + moduleCount * recordSize > dataOffset) continue;
    if (start + dataOffset + dataLength > executable.length) continue;
    const lengthOf = (index: number) => executable.readUInt32LE(start + modulesOffset + index * recordSize + 20);
    return Array.from({ length: moduleCount }, (_, index) => lengthOf(index)).filter(Boolean).length;
  }
  throw new Error("the executable has no index of the modules of the runtime");
}

const helpers = `
const made = (...parts) => parts.join("");
const heard = worker =>
  new Promise(done => {
    const end = data => (console.log(data), worker.terminate(), done());
    if (worker.on) worker.on("message", end).on("error", () => end("error"));
    else [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
const asksForModule = ["postMessage(require('node:", "path').posix.join('a', 'b'))"];
const asksForModuleOfNode = ["require('node:worker_threads').parentPort.", ...asksForModule];
`;
const files = {
  "w.js": `postMessage("w.js");`,
  "of-node.cjs": `require("node:worker_threads").parentPort.postMessage("of-node.cjs");`,
};

type Case = [what: string, program: string, stdout: string, extension?: string];

const compiled: Case[] = [
  ["no Worker", `console.log("hello");`, "hello\n"],
  ["a data: URL", `await heard(new Worker("data:text/javascript,postMessage(1)"));`, "1\n"],
  ["a URL beside the file", `await heard(new Worker(new URL("./w.js", import.meta.url)));`, "w.js\n"],
  ["a relative path", `await heard(new Worker("./w.js"));`, "w.js\n"],
  [
    "an object URL kept in variables",
    `const blob = new Blob(["postMessage(2)"]); const url = URL.createObjectURL(blob); await heard(new Worker(url));`,
    "2\n",
  ],
  [
    "one of two",
    `await heard(new Worker(process.argv.length > 9 ? "./w.js" : "data:text/javascript,postMessage(3)"));`,
    "3\n",
  ],
  [
    "a parameter of a function that is only called",
    `function start(code) { return new Worker(code); }
     await heard(start("./w.js")); await heard(start("data:text/javascript,postMessage(4)"));`,
    "w.js\n4\n",
  ],
  [
    "the Worker of node:worker_threads imported by name",
    `import { Worker as Thread } from "node:worker_threads";
     await heard(new Thread(new URL("./of-node.cjs", import.meta.url)));`,
    "of-node.cjs\n",
  ],
  [
    "a member of the namespace of node:worker_threads",
    `import * as threads from "node:worker_threads";
     await heard(new threads.Worker(new URL("./of-node.cjs", import.meta.url)));`,
    "of-node.cjs\n",
  ],
  [
    "a name out of what require() answers",
    `const { Worker } = require("node:worker_threads");
     heard(new Worker(require("node:path").join(__dirname, "of-node.cjs")));`,
    "of-node.cjs\n",
    "cjs",
  ],
  [
    "a written text that is evaluated",
    `import { Worker as Thread } from "node:worker_threads";
     await heard(new Thread("require('node:worker_threads').parentPort.postMessage(5)", { eval: true }));`,
    "5\n",
  ],
  [
    "a file that only asks which thread it is on",
    `import { isMainThread, threadId } from "node:worker_threads"; console.log(isMainThread, threadId);`,
    "true 0\n",
  ],
  ["a path that names no file", `await heard(new Worker("./missing.js"));`, "error\n"],
];

const unseen: Case[] = [
  [
    "a text put together at run time",
    `await heard(new Worker(made("data:text/javascript,", ...asksForModule)));`,
    "a/b\n",
  ],
  [
    "the constructor under another name",
    `const Thread = Worker; await heard(new Thread(made("data:text/javascript,", ...asksForModule)));`,
    "a/b\n",
  ],
  [
    "the constructor handed to Reflect.construct",
    `await heard(Reflect.construct(Worker, [made("data:text/javascript,", ...asksForModule)]));`,
    "a/b\n",
  ],
  [
    "a class below the constructor",
    `class Thread extends Worker {} await heard(new Thread(made("data:text/javascript,", ...asksForModule)));`,
    "a/b\n",
  ],
  [
    "what the process is started with",
    `await heard(new Worker(process.argv[2] ?? made("data:text/javascript,", ...asksForModule)));`,
    "a/b\n",
  ],
  [
    "options that are written nowhere",
    `import { Worker as Thread } from "node:worker_threads";
     await heard(new Thread("require('node:worker_threads').parentPort.postMessage(require('node:path').posix.join('a', 'b'))", JSON.parse('{"eval":true}')));`,
    "a/b\n",
  ],
  [
    "node:worker_threads handed to a function",
    `const start = threads => new threads.Worker(made(...asksForModuleOfNode), { eval: true });
     await heard(start(require("node:worker_threads")));`,
    "a/b\n",
  ],
  [
    "a variable that is stored to",
    `let code = "./w.js"; code = made("data:text/javascript,", ...asksForModule); await heard(new Worker(code));`,
    "a/b\n",
  ],
  [
    "a list of parts that grows",
    `const parts = [asksForModule[0]]; parts.push(asksForModule[1]);
     await heard(new Worker(URL.createObjectURL(new Blob(parts))));`,
    "a/b\n",
  ],
  [
    "the constructor under a name made at run time",
    `await heard(new globalThis[made("Wor", "ker")](made("data:text/javascript,", ...asksForModule)));`,
    "a/b\n",
  ],
  [
    "a written text that is no program",
    `await heard(new Worker("data:text/javascript,this is no program"));`,
    "error\n",
  ],
];

if (!canTrim)
  console.error(
    "SKIPPED: source-of-the-runtime-modules-for-workers-of-unseen-code.test.ts: this build of Bun doesn't support --trim",
  );

(canTrim && !unsupported ? describe.concurrent : describe.skip)(
  "an executable of a Bun that can be trimmed, built without --trim",
  () => {
    const all = countModulesWithSource(readFileSync(bunExe()));

    async function build(sources: Record<string, string>, entry: string, flags: string[] = []) {
      const dir = tempDir("source-of-the-runtime-modules", { ...files, ...sources });
      const folder = String(dir);
      const executable = join(folder, isWindows ? "main.exe" : "main");
      built(
        await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...flags,
            ...withoutDebugInformation(),
            entry,
            "--outfile",
            executable,
          ],
          folder,
          bunEnv,
        ),
      );
      return {
        modulesWithSource: countModulesWithSource(readFileSync(executable)),
        run: () => spawned([executable], folder, bunEnv),
        [Symbol.dispose]: () => dir[Symbol.dispose](),
      };
    }

    // Each is a file of one program. The one that waits for nothing comes last.
    test(`holds no source of the modules of the runtime: ${compiled.map(([what]) => what).join(", ")}`, async () => {
      const rows = compiled.toSorted((a, b) => Number(a[3] === "cjs") - Number(b[3] === "cjs"));
      const nameOf = (index: number) => `row-${index}.${rows[index][3] ?? "mjs"}`;
      using main = await build(
        {
          ...Object.fromEntries(rows.map(([, program], index) => [nameOf(index), helpers + program])),
          "main.mjs": rows.map((_, index) => `await import("./${nameOf(index)}");\n`).join(""),
        },
        "main.mjs",
        ["--aot-heat=everything-is-cold"],
      );
      const ran = await main.run();
      expect({ stdout: ran.stdout, exitCode: ran.exitCode, modulesWithSource: main.modulesWithSource }).toEqual({
        stdout: rows.map(([, , stdout]) => stdout).join(""),
        exitCode: 0,
        modulesWithSource: 0,
      });
    }, 600_000);

    // Whether the source is held shows in the file. A build that compiles none of the modules of the runtime takes a tenth of the time, but it finds no node:worker_threads.
    test.each(unseen)(
      "holds the source of the modules of the runtime: %s",
      async (_, program, stdout, extension = "mjs") => {
        const namesModule = program.includes("worker_threads");
        using main = await build({ [`main.${extension}`]: helpers + program }, `main.${extension}`, [
          namesModule ? "--aot-heat=everything-is-cold" : "--no-builtin-modules",
        ]);
        expect(main.modulesWithSource).toBe(all);
        if (namesModule) expect(await main.run()).toMatchObject({ stdout, exitCode: 0 });
      },
      600_000,
    );

    test.each(
      unseen.filter(([what]) =>
        ["a text put together at run time", "a written text that is no program"].includes(what),
      ),
    )(
      "and the Worker runs them: %s",
      async (_, program, stdout, extension = "mjs") => {
        using main = await build({ [`main.${extension}`]: helpers + program }, `main.${extension}`);
        const ran = await main.run();
        expect({ stdout: ran.stdout, exitCode: ran.exitCode, modulesWithSource: main.modulesWithSource }).toEqual({
          stdout,
          exitCode: 0,
          modulesWithSource: all,
        });
      },
      600_000,
    );
  },
);
