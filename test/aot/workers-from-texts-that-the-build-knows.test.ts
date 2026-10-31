// A Worker that starts from a text or from the path of a file which is known when the program is built runs code that was compiled ahead of time.
// ./parallel/workers has the programs that go through the ways to write such a text or path. They run where the interpreter is forbidden.
// node:worker_threads brings the streams of Node.js along, so only the programs that are about it import it.
// console.log brings the code that formats any value along where the build cannot tell that it is handed texts, so the other programs hand it one text.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { built, slot, spawned, withoutCoreDump, withoutCrashReport, withoutDebugInformation } from "./harness/commands";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

const timeout = 600_000;

// The executable stops where code is interpreted.
const compiledOnly = { ...bunEnv, [runtimeEnvironment.forbidsInterpreter]: "1" };

const listen = `
  worker.onmessage = event => (console.log("message " + event.data), worker.terminate());
  worker.onerror = event => (console.log("error " + /^[A-Za-z]*Error: .*|Cannot find module/m.exec(event.message)?.[0]), event.preventDefault());
`;

/** `file`: the executable on disk. */
async function build(folder: string, entries: string[], name = "program") {
  const executable = join(folder, name);
  const report = join(folder, `${name}.report.json`);
  const flags = [`--aot-report=${report}`, ...withoutDebugInformation()];
  const command = [bunExe(), ...compileCommand, ...flags, ...entries, "--outfile", executable];
  const file = executable + (isWindows ? ".exe" : "");
  return { executable, file, report, ...(await spawned(command, folder, bunEnv)) };
}

/** How many programs the build has compiled, also those that it then threw away. */
const programsCompiled = (report: string): number => JSON.parse(readFileSync(report, "utf8")).statistics.EngineRuns;

/** What a command comes to that printed `stdout`, said nothing else and ended by itself. */
const ended = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signal: null });

/** The warnings and the errors of a build, each as its kind, its code and the place that it names: a file without its folder, a text whole. */
const said = (stderr: string) =>
  Array.from(
    stderr.matchAll(/^(warn|error): (TS\d+): .*\r?\n +at (.*?)\r?$/gm),
    ([, kind, code, place]) => `${kind} ${code} at ${place.startsWith("data:") ? place : basename(place)}`,
  );

/** The line and the column at which `part` begins in `text`, as a build writes them. */
function placeOf(text: string, part: string) {
  const at = text.indexOf(part);
  if (at === -1) throw new Error(`the text does not hold ${part}`);
  const before = text.slice(0, at).split("\n");
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

/** The build ended well, and `warnings` is all that it said. */
function builtSaying(compiled: { stderr: string; exitCode: number }, warnings: string[] = []) {
  built(compiled);
  expect(said(compiled.stderr)).toEqual(warnings);
}

describe.concurrent("compile/aot/workers from texts that the build knows", () => {
  const speaks = `import { parentPort } from "node:worker_threads";\nparentPort!.postMessage("spoken");\n`;
  const startsBoth = `import { Worker } from "node:worker_threads";
new Worker(new URL("./first.ts", import.meta.url)).on("exit", code => console.log("exit", code));
new Worker(new URL("./second.ts", import.meta.url)).on("message", message => console.log("message", message));
`;
  test.each([
    ["that starts no Worker", { "main.ts": `console.log(1 + 1);\n` }, ["main.ts"], 1],
    [
      "with a Worker file that does not import node:worker_threads",
      { "first.ts": `console.log("quiet");\n` },
      ["main.ts"],
      1,
    ],
  ])(
    "the build compiles nothing twice for a program %s",
    (_, files, entries, programsOfExecutable) =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", { "main.ts": startsBoth, "second.ts": speaks, ...files });
        const compiled = await build(String(dir), entries);
        builtSaying(compiled);
        expect(programsCompiled(compiled.report)).toBe(programsOfExecutable);
      }),
    timeout,
  );

  // What each of these hands to the Worker is made while the program runs, so the build knows none of it. The text that the
  // second line of the program starts a Worker from is the only one that the executable holds.
  const madeAtRunTime = [
    [
      "a data: URL",
      `new Worker(made("data:text/javascript,postMessage(1)"))`,
      "message 1\n",
      /^crashIfInterpreterIsUsed: Worker data:text\/javascript,postMessage\(1\)$/m,
    ],
    [
      "an object URL",
      `new Worker(URL.createObjectURL(new Blob([made("postMessage(2)")])))`,
      "message 2\n",
      /^crashIfInterpreterIsUsed: Worker blob:[-0-9a-f]+$/m,
    ],
    [
      "an object URL of a text that is compiled, with a type that reads it in another way,",
      `new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: made("application/typescript") })))`,
      "message 1\n",
      /^crashIfInterpreterIsUsed: Worker blob:[-0-9a-f]+$/m,
    ],
  ] as const;

  // One program holds the three, and the first argument of a run says which of them it takes: one build and one new executable
  // to start, not three. None of the three tells the build what another hands over.
  let folderOfWays: ReturnType<typeof tempDir> | undefined;
  let programOfWays: Promise<{ folder: string; executable: string }> | undefined;
  afterAll(() => folderOfWays?.[Symbol.dispose]());
  const builtWithEveryWay = () =>
    (programOfWays ??= slot(async () => {
      folderOfWays = tempDir("aot-workers-from-texts", {
        "main.js": `
          const made = text => Buffer.from(text).toString();
          new Worker(URL.createObjectURL(new Blob(["postMessage(1)"]))).terminate();
          const ways = [
            ${madeAtRunTime.map(([, start]) => `() => ${start},`).join("\n            ")}
            () => new Worker(URL.createObjectURL(new Blob(["postMessage(1)"]))),
          ];
          const worker = ways[process.argv[2]]();${listen}`,
      });
      const folder = String(folderOfWays);
      const compiled = await build(folder, ["main.js"]);
      builtSaying(compiled);
      // The last way is the text of the second line again. It runs where the interpreter is forbidden, so the executable
      // holds that text, and a run that stops there has stopped at the Worker of its own way.
      const known = await spawned([compiled.executable, String(madeAtRunTime.length)], folder, compiledOnly);
      expect(known).toEqual(ended("message 1\n"));
      return { folder, executable: compiled.executable };
    }));

  test.each(madeAtRunTime.map(([title, , printed, stopsAt], way) => [title, String(way), printed, stopsAt] as const))(
    "%s that the program makes at run time is interpreted",
    async (_, way, printed, stopsAt) => {
      const { folder, executable } = await builtWithEveryWay();
      await slot(async () => {
        expect(await spawned([executable, way], folder, bunEnv)).toEqual(ended(printed));
        const stopped = await spawned(withoutCoreDump([executable, way]), folder, {
          ...compiledOnly,
          ...withoutCrashReport,
        });
        // It names the Worker whose code is not in the executable, before anything of that code has run.
        expect(stopped.stderr).toMatch(stopsAt);
        expect({ stdout: stopped.stdout, endedWithZero: stopped.exitCode === 0 }).toEqual({
          stdout: "",
          endedWithZero: false,
        });
      });
    },
    timeout,
  );

  const report = `
    const report = (how, worker) =>
      new Promise(done => {
        const end = text => (console.log(how + ": " + text), worker.terminate(), done());
        if (worker.on) worker.on("message", end).on("error", error => end("error"));
        else [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
      });
  `;

  test(
    "a path that is relative to the folder of the entry point, and not the file that a package names",
    () =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "elsewhere/empty.txt": "",
          "project/src/main.js": `
            import { start } from "pool";
            ${report}
            await report("./worker.ts", new Worker("./worker.ts"));
            await report("./worker", new Worker("./worker"));
            await report("./lib/../worker.ts", new Worker("./lib/../worker.ts"));
            await report("a package", start());
            await report("./no-such-file.ts", new Worker("./no-such-file.ts"));
          `,
          "project/src/worker.ts": `postMessage("worker.ts" as string);`,
          "project/node_modules/pool/package.json": `{ "name": "pool", "main": "lib/index.js" }`,
          "project/node_modules/pool/lib/index.js": `
            const { join } = require("path");
            exports.start = () => new Worker(join(__dirname, "worker.js"));
          `,
          "project/node_modules/pool/lib/worker.js": `postMessage("the worker of a package");`,
        });
        const sources = join(String(dir), "project", "src");
        const printed = (ofThePackage: string) =>
          ended(
            [
              "./worker.ts: worker.ts",
              "./worker: worker.ts",
              "./lib/../worker.ts: worker.ts",
              `a package: ${ofThePackage}`,
              "./no-such-file.ts: error",
              "",
            ].join("\n"),
          );
        expect(await spawned([bunExe(), "run", "main.js"], sources, bunEnv)).toEqual(
          printed("the worker of a package"),
        );
        const compiled = await build(sources, ["main.js"]);
        builtSaying(compiled);
        for (const folder of [sources, join(String(dir), "elsewhere")])
          expect(await spawned([compiled.executable], folder, compiledOnly)).toEqual(printed("error"));
      }),
    timeout,
  );

  test(
    "the file that a package of the workspace names, which is linked into node_modules",
    () =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "package.json": `{ "name": "project", "workspaces": ["packages/*"] }`,
          "node_modules/empty.txt": "",
          "src/main.js": `
            import { start } from "pool";
            ${report}
            await report("a package of the workspace", start());
          `,
          "packages/pool/package.json": `{ "name": "pool", "main": "lib/index.js" }`,
          "packages/pool/lib/index.js": `
            const { join } = require("path");
            exports.start = () => new Worker(join(__dirname, "worker.js"));
          `,
          "packages/pool/lib/worker.js": `postMessage("its worker");`,
        });
        const folder = String(dir);
        symlinkSync(join(folder, "packages", "pool"), join(folder, "node_modules", "pool"), "junction");
        const compiled = await build(folder, ["src/main.js"]);
        builtSaying(compiled);
        expect(await spawned([compiled.executable], folder, compiledOnly)).toEqual(
          ended("a package of the workspace: its worker\n"),
        );
      }),
    timeout,
  );

  test(
    "a file that is named by a path and listed as an entry point is compiled once",
    () =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.js": `${report} await report("listed", new Worker(new URL("./worker.js", import.meta.url)));`,
          "worker.js": `postMessage("worker.js");`,
        });
        const folder = String(dir);
        const alone = await build(folder, ["main.js"]);
        builtSaying(alone);
        const listed = await build(folder, ["main.js", "worker.js"], "listed");
        builtSaying(listed);
        for (const { executable } of [alone, listed])
          expect(await spawned([executable], folder, compiledOnly)).toEqual(ended("listed: worker.js\n"));
        expect({ programs: programsCompiled(listed.report), bytes: statSync(listed.file).size }).toEqual({
          programs: programsCompiled(alone.report),
          bytes: statSync(alone.file).size,
        });
      }),
    timeout,
  );

  test(
    "a name without ./ in front, the name of a package, and a file above the folder of the entry point",
    () =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "elsewhere/empty.txt": "",
          "project/src/app/main.ts": `
            import path from "node:path";
            import { start } from "./lib/starts.ts";
            ${report.replace("(how, worker)", "(how: string, worker: any)").replaceAll(/(done|text|error|event) =>/g, "($1: any) =>")}
            await report("worker.ts", new Worker("worker.ts"));
            await report("worker", new Worker("worker"));
            await report("lib/inner.ts", new Worker("lib/inner.ts"));
            await report("pool", new Worker("pool"));
            await report("pool/lib/job.js", new Worker("pool/lib/job.js"));
            await report("pool/lib/job", new Worker("pool/lib/job"));
            await report("@scope/tool", new Worker("@scope/tool"));
            await report("no-such-name", new Worker("no-such-name"));
            await report("../beside.ts", new Worker("../beside.ts"));
            await report("../../workers/job.ts", new Worker("../../workers/job.ts"));
            await report("a URL one folder above", new Worker(new URL("../beside.ts", import.meta.url)));
            await report("its href", new Worker(new URL("../beside.ts", import.meta.url).href));
            await report("a joined path one folder above", new Worker(path.join(import.meta.dir, "../beside.ts")));
            await report("a URL from a folder below", start());
          `,
          "project/src/app/worker.ts": `postMessage("worker.ts" as string);`,
          "project/src/app/lib/inner.ts": `postMessage("lib/inner.ts" as string);`,
          "project/src/app/lib/starts.ts": `export const start = () => new Worker(new URL("../../beside.ts", import.meta.url));`,
          "project/src/beside.ts": `import { name } from "./name.ts"; postMessage("beside.ts " + name);`,
          "project/src/name.ts": `export const name: string = "and what it imports";`,
          "project/workers/job.ts": `postMessage("workers/job.ts" as string);`,
          "project/node_modules/pool/package.json": `{ "name": "pool", "main": "lib/index.js" }`,
          "project/node_modules/pool/lib/index.js": `postMessage("pool/lib/index.js");`,
          "project/node_modules/pool/lib/job.js": `postMessage("pool/lib/job.js");`,
          "project/node_modules/@scope/tool/package.json": `{ "name": "@scope/tool", "exports": "./main.js" }`,
          "project/node_modules/@scope/tool/main.js": `postMessage("@scope/tool/main.js");`,
        });
        const sources = join(String(dir), "project", "src", "app");
        // Plain Bun and the executable find the same file for each of them.
        const printed = ended(
          [
            "worker.ts: worker.ts",
            "worker: worker.ts",
            "lib/inner.ts: lib/inner.ts",
            "pool: pool/lib/index.js",
            "pool/lib/job.js: pool/lib/job.js",
            "pool/lib/job: pool/lib/job.js",
            "@scope/tool: @scope/tool/main.js",
            "no-such-name: error",
            "../beside.ts: beside.ts and what it imports",
            "../../workers/job.ts: workers/job.ts",
            "a URL one folder above: beside.ts and what it imports",
            "its href: beside.ts and what it imports",
            "a joined path one folder above: beside.ts and what it imports",
            "a URL from a folder below: beside.ts and what it imports",
            "",
          ].join("\n"),
        );
        expect(await spawned([bunExe(), "run", "main.ts"], sources, bunEnv)).toEqual(printed);
        const compiled = await build(sources, ["main.ts"]);
        builtSaying(compiled);
        for (const folder of [sources, join(String(dir), "elsewhere")])
          expect(await spawned([compiled.executable], folder, compiledOnly)).toEqual(printed);
      }),
    timeout,
  );

  test(
    "a file that is named by a path and does not compile is left out, and the build says so",
    () =>
      slot(async () => {
        const start = `new Worker(new URL("./imports.js", import.meta.url))`;
        const main = `
            ${report}
            await report("sound", new Worker(new URL("./sound.js", import.meta.url)));
            await report("imports what is not there", ${start});
          `;
        using dir = tempDir("aot-workers-from-texts", {
          "main.js": main,
          "sound.js": `postMessage("sound.js");`,
          "imports.js": `import "./inner.js"; postMessage("imports.js");`,
          "inner.js": `import "./no-such-file.js";`,
        });
        const compiled = await build(String(dir), ["main.js"]);
        // What is wrong, in the file that is wrong, and then the Worker that starts from what imports it.
        builtSaying(compiled, ["warn TS100150 at inner.js:1:1", `warn TS100072 at main.js:${placeOf(main, start)}`]);
        expect(await spawned([compiled.executable], String(dir), compiledOnly)).toEqual(
          ended("sound: sound.js\nimports what is not there: error\n"),
        );
      }),
    timeout,
  );

  test.each([
    ["a syntax error", "postMessage((", "TS1109", "1:14", "SyntaxError: Unexpected end of file"],
    ["words that are no program", "this is no program", "TS1005", "1:6", "undefined"],
    [
      "an import that is not found",
      `import "./no-such-file.js"; postMessage(1)`,
      "TS100150",
      "1:1",
      "Cannot find module",
    ],
  ])(
    "a text with %s is left out, and the build says so",
    (_, text, code, place, heard) =>
      slot(async () => {
        const url = "data:text/javascript," + text;
        const start = `new Worker(${JSON.stringify(url)})`;
        const main = `
            const sound = new Worker("data:text/javascript,postMessage('sound')");
            sound.onmessage = event => {
              console.log("message " + event.data);
              sound.terminate();
              const worker = ${start};${listen}
            };
          `;
        using dir = tempDir("aot-workers-from-texts", { "main.js": main });
        const compiled = await build(String(dir), ["main.js"]);
        built(compiled);
        // First what is wrong with the text, where it is wrong. Whatever else the build says is about that text too, but for
        // one warning: the Worker that starts from it.
        const warnings = said(compiled.stderr);
        expect(warnings[0]).toBe(`warn ${code} at ${url}:${place}`);
        expect(warnings.filter(warning => !warning.includes(` at ${url}:`))).toEqual([
          `warn TS100072 at main.js:${placeOf(main, start)}`,
        ]);
        expect(await spawned([compiled.executable], String(dir), bunEnv)).toEqual(
          ended(`message sound\nerror ${heard}\n`),
        );
      }),
    timeout,
  );

  test(
    "code in TypeScript that names the globals of a Worker is compiled where no typings are installed",
    () =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.ts": `
            const heard = (worker: Worker) =>
              new Promise<void>(done => {
                worker.onmessage = event => (console.log("message " + event.data), worker.terminate(), done());
                worker.onerror = event => (console.log("error"), event.preventDefault(), done());
                worker.postMessage(20);
              });
            await heard(new Worker(new URL("./self.ts", import.meta.url)));
            await heard(new Worker(new URL("./bare.ts", import.meta.url)));
            await heard(new Worker(new URL("./listener.ts", import.meta.url)));
            await heard(new Worker("data:text/javascript,self.onmessage = event => self.postMessage(event.data %2B 4)"));
            await heard(
              new Worker(
                URL.createObjectURL(
                  new Blob(["self.onmessage = (event: MessageEvent) => self.postMessage(event.data + 5)"], {
                    type: "application/typescript",
                  }),
                ),
              ),
            );
          `,
          "self.ts": `self.onmessage = (event: MessageEvent) => { self.postMessage(event.data + 1); };`,
          "bare.ts": `onmessage = (event: MessageEvent) => { postMessage(event.data + 2); };`,
          "listener.ts": `
            self.addEventListener("message", (event: MessageEvent) => { postMessage(event.data + 3); });
            self.onerror = null;
            console.log(typeof self.dispatchEvent + " " + typeof dispatchEvent + " " + onerror);
          `,
        });
        const compiled = await build(String(dir), ["main.ts"]);
        builtSaying(compiled);
        expect(compiled.stderr).not.toContain("warn:");
        expect(await spawned([compiled.executable], String(dir), compiledOnly)).toEqual(
          ended("message 21\nmessage 22\nfunction function null\nmessage 23\nmessage 24\nmessage 25\n"),
        );
      }),
    timeout,
  );

  test.each([
    ["a file that is named by a path", `new URL("./worker.ts", import.meta.url)`, /^error TS2322 at worker\.ts:1:5$/],
    [
      "a text",
      JSON.stringify(`data:text/javascript,let count: number = "text"; postMessage(count)`),
      /^error TS2322 at .+:1:5$/,
    ],
  ])(
    "a type error in %s stops the build, as it does in an entry point",
    (_, code, error) =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.ts": `const worker = new Worker(${code});${listen}`,
          "worker.ts": `let count: number = "text"; postMessage(count);`,
        });
        const compiled = await build(String(dir), ["main.ts"]);
        // The error is all that the build says: it stops, and leaves nothing out.
        expect({
          said: said(compiled.stderr),
          exitCode: compiled.exitCode,
          signal: compiled.signal,
          hasWrittenAnExecutable: existsSync(compiled.file),
        }).toEqual({
          said: [expect.stringMatching(error)],
          exitCode: 1,
          signal: null,
          hasWrittenAnExecutable: false,
        });
      }),
    timeout,
  );
});
