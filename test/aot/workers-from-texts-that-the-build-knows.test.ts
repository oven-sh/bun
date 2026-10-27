// A Worker that starts from a text or from the path of a file which is known when the program is built runs code that was compiled ahead of time.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { built, slot, spawned, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const timeout = 600_000;

// The executable stops where code is interpreted.
const compiledOnly = { ...bunEnv, [runtimeEnvironment.forbidsInterpreter]: "1" };

const programs = join(import.meta.dir, "programs", "workers");

const listen = `
  worker.onmessage = event => (console.log("message", event.data), worker.terminate());
  worker.onerror = event => (console.log("error", /^[A-Za-z]*Error: .*|Cannot find module/m.exec(event.message)?.[0]), event.preventDefault());
`;

async function build(folder: string, entry: string) {
  const executable = join(folder, "program");
  const command = [bunExe(), ...compileCommand, ...withoutDebugInformation(), entry, "--outfile", executable];
  return { executable, ...(await spawned(command, folder, bunEnv)) };
}

describe.concurrent("compile/aot/workers from texts that the build knows", () => {
  test.each([
    ["data-urls-that-the-build-knows-start-workers", "main.ts"],
    ["files-named-by-paths-start-workers", "main.ts"],
    ["texts-that-the-build-knows-start-workers.ts", "texts-that-the-build-knows-start-workers.ts"],
    ["what-a-worker-sees-that-started-from-a-data-url.ts", "what-a-worker-sees-that-started-from-a-data-url.ts"],
  ])(
    "%s runs without the interpreter",
    (program, entry) =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {});
        const folder = String(dir);
        cpSync(join(programs, program), program === entry ? join(folder, entry) : folder, { recursive: true });
        const plain = await spawned([bunExe(), "run", entry], folder, bunEnv);
        const compiled = await build(folder, entry);
        built(compiled);
        const ran = await spawned([compiled.executable], folder, compiledOnly);
        expect(plain.stdout).not.toBe("");
        expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
          stdout: plain.stdout,
          stderr: plain.stderr,
          exitCode: 0,
          signal: null,
        });
      }),
    timeout,
  );

  test.each([
    ["a data: URL", `new Worker(made("data:text/javascript,postMessage(1)"))`],
    ["an object URL", `new Worker(URL.createObjectURL(new Blob([made("postMessage(2)")])))`],
    [
      "an object URL of a text that is compiled, with a type that reads it in another way,",
      `new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: made("application/typescript") })))`,
    ],
  ])(
    "%s that the program makes at run time is interpreted",
    (_, start) =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.js": `
            const made = text => Buffer.from(text).toString();
            new Worker(URL.createObjectURL(new Blob(["postMessage(1)"]))).terminate();
            const worker = ${start};${listen}`,
        });
        const compiled = await build(String(dir), "main.js");
        built(compiled);
        const ran = await spawned([compiled.executable], String(dir), bunEnv);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: expect.stringMatching(/^message [12]\n$/),
          exitCode: 0,
        });
        const stopped = await spawned([compiled.executable], String(dir), compiledOnly);
        expect(stopped.stderr).toContain("crashIfInterpreterIsUsed");
      }),
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
            import { Worker as NodeWorker } from "node:worker_threads";
            import { start } from "pool";
            ${report}
            await report("./worker.ts", new Worker("./worker.ts"));
            await report("./worker", new Worker("./worker"));
            await report("./lib/../worker.ts", new Worker("./lib/../worker.ts"));
            await report("./lib/of-node.cjs", new NodeWorker("./lib/of-node.cjs"));
            await report("a package", start());
            await report("./no-such-file.ts", new Worker("./no-such-file.ts"));
          `,
          "project/src/worker.ts": `postMessage("worker.ts" as string);`,
          "project/src/lib/of-node.cjs": `require("node:worker_threads").parentPort.postMessage("of-node.cjs");`,
          "project/node_modules/pool/package.json": `{ "name": "pool", "main": "lib/index.js" }`,
          "project/node_modules/pool/lib/index.js": `
            const { join } = require("path");
            const { Worker } = require("worker_threads");
            exports.start = () => new Worker(join(__dirname, "worker.js"));
          `,
          "project/node_modules/pool/lib/worker.js": `require("worker_threads").parentPort.postMessage("the worker of a package");`,
        });
        const sources = join(String(dir), "project", "src");
        const plain = await spawned([bunExe(), "run", "main.js"], sources, bunEnv);
        const compiled = await build(sources, "main.js");
        built(compiled);
        expect(plain.stdout).toContain("a package: the worker of a package\n./no-such-file.ts: error\n");
        const expected = plain.stdout.replace("a package: the worker of a package", "a package: error");
        for (const folder of [sources, join(String(dir), "elsewhere")]) {
          const ran = await spawned([compiled.executable], folder, compiledOnly);
          expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
        }
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
            const { Worker } = require("worker_threads");
            exports.start = () => new Worker(join(__dirname, "worker.js"));
          `,
          "packages/pool/lib/worker.js": `require("worker_threads").parentPort.postMessage("its worker");`,
        });
        const folder = String(dir);
        symlinkSync(join(folder, "packages", "pool"), join(folder, "node_modules", "pool"), "junction");
        const compiled = await build(folder, "src/main.js");
        built(compiled);
        const ran = await spawned([compiled.executable], folder, compiledOnly);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: "a package of the workspace: its worker\n",
          exitCode: 0,
        });
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
        const alone = await build(folder, "main.js");
        built(alone);
        const command = [bunExe(), ...compileCommand, ...withoutDebugInformation(), "main.js", "worker.js"];
        built(await spawned([...command, "--outfile", join(folder, "listed")], folder, bunEnv));
        for (const executable of [alone.executable, join(folder, "listed")]) {
          const ran = await spawned([executable], folder, compiledOnly);
          expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
            stdout: "listed: worker.js\n",
            exitCode: 0,
          });
        }
        expect(Bun.file(join(folder, "listed")).size).toBe(Bun.file(alone.executable).size);
      }),
    timeout,
  );

  test(
    "a file that is named by a path and does not compile is left out, and the build says so",
    () =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.js": `
            ${report}
            await report("sound", new Worker(new URL("./sound.js", import.meta.url)));
            await report("imports what is not there", new Worker(new URL("./imports.js", import.meta.url)));
          `,
          "sound.js": `postMessage("sound.js");`,
          "imports.js": `import "./inner.js"; postMessage("imports.js");`,
          "inner.js": `import "./no-such-file.js";`,
        });
        const compiled = await build(String(dir), "main.js");
        built(compiled);
        expect(compiled.stderr).toContain("warn: TS100150");
        expect(compiled.stderr).toContain("warn: TS100072");
        const ran = await spawned([compiled.executable], String(dir), compiledOnly);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: "sound: sound.js\nimports what is not there: error\n",
          exitCode: 0,
        });
      }),
    timeout,
  );

  test.each([
    ["a syntax error", "postMessage((", "TS1109", "SyntaxError: Unexpected end of file"],
    ["an import that is not found", `import "./no-such-file.js"; postMessage(1)`, "TS100150", "Cannot find module"],
  ])(
    "a text with %s is left out, and the build says so",
    (_, text, code, said) =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.js": `
            const sound = new Worker("data:text/javascript,postMessage('sound')");
            sound.onmessage = event => {
              console.log("message", event.data);
              sound.terminate();
              const worker = new Worker(${JSON.stringify("data:text/javascript," + text)});${listen}
            };
          `,
        });
        const compiled = await build(String(dir), "main.js");
        built(compiled);
        expect(compiled.stderr).toContain(`warn: ${code}`);
        expect(compiled.stderr).toContain("warn: TS100072");
        const ran = await spawned([compiled.executable], String(dir), bunEnv);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: `message sound\nerror ${said}\n`,
          exitCode: 0,
        });
      }),
    timeout,
  );
});
