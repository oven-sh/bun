// A Worker that starts from the path of a file which is known when the program is built runs code that was compiled ahead of time.
// The text of a data: URL or of a Blob is not compiled: the run time reads it.
// ./parallel/workers has the programs that go through the ways to write such a path. They run where the interpreter is forbidden.
// node:worker_threads brings the streams of Node.js along, so only the programs that are about it import it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned, withoutCoreDump, withoutCrashReport, withoutDebugInformation } from "./harness/commands";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

const timeout = 600_000;

// The executable stops where code is interpreted.
const compiledOnly = { ...bunEnv, [runtimeEnvironment.forbidsInterpreter]: "1" };

const listen = `
  worker.onmessage = event => (console.log("message", event.data), worker.terminate());
  worker.onerror = event => (console.log("error", /^[A-Za-z]*Error: .*|Cannot find module/m.exec(event.message)?.[0]), event.preventDefault());
`;

async function build(folder: string, ...entries: string[]) {
  const executable = join(folder, "program");
  const command = [bunExe(), ...compileCommand, ...withoutDebugInformation(), ...entries, "--outfile", executable];
  return { executable, ...(await spawned(command, folder, bunEnv)) };
}

describe.concurrent("compile/aot/workers from texts that the build knows", () => {
  test.each([
    ["a data: URL", `new Worker(made("data:text/javascript,") + made("postMessage(1)"))`],
    ["an object URL", `new Worker(URL.createObjectURL(new Blob([made("postMessage(2)")])))`],
  ])(
    "%s that the program makes at run time is interpreted",
    (_, start) =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.js": `
            const made = text => Buffer.from(text).toString();
            const worker = ${start};${listen}`,
        });
        const compiled = await build(String(dir), "main.js");
        built(compiled);
        const ran = await spawned([compiled.executable], String(dir), bunEnv);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: expect.stringMatching(/^message [12]\n$/),
          exitCode: 0,
        });
        const stopped = await spawned(withoutCoreDump([compiled.executable]), String(dir), {
          ...compiledOnly,
          ...withoutCrashReport,
        });
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
    "a path that is relative to the folder of the entry point, and the file that a package names",
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
        const plain = await spawned([bunExe(), "run", "main.js"], sources, bunEnv);
        const compiled = await build(sources, "main.js");
        built(compiled);
        expect(plain.stdout).toContain("a package: the worker of a package\n./no-such-file.ts: error\n");
        for (const folder of [sources, join(String(dir), "elsewhere")]) {
          const ran = await spawned([compiled.executable], folder, compiledOnly);
          expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
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
            exports.start = () => new Worker(join(__dirname, "worker.js"));
          `,
          "packages/pool/lib/worker.js": `postMessage("its worker");`,
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
            await report("a URL two folders above", new Worker(new URL("../../workers/job.ts", import.meta.url)));
            await report("a joined path two folders above", new Worker(path.join(import.meta.dir, "../../workers/job.ts")));
            await report("a URL three folders above", new Worker(new URL("../../../top.ts", import.meta.url)));
          `,
          "project/src/app/worker.ts": `postMessage("worker.ts" as string);`,
          "project/src/app/lib/inner.ts": `postMessage("lib/inner.ts" as string);`,
          "project/src/app/lib/starts.ts": `export const start = () => new Worker(new URL("../../beside.ts", import.meta.url));`,
          "project/src/beside.ts": `import { name } from "./name.ts"; postMessage("beside.ts " + name);`,
          "project/src/name.ts": `export const name: string = "and what it imports";`,
          "project/workers/job.ts": `postMessage("workers/job.ts" as string);`,
          "top.ts": `postMessage("top.ts" as string);`,
          "project/node_modules/pool/package.json": `{ "name": "pool", "main": "lib/index.js" }`,
          "project/node_modules/pool/lib/index.js": `postMessage("pool/lib/index.js");`,
          "project/node_modules/pool/lib/job.js": `postMessage("pool/lib/job.js");`,
          "project/node_modules/@scope/tool/package.json": `{ "name": "@scope/tool", "exports": "./main.js" }`,
          "project/node_modules/@scope/tool/main.js": `postMessage("@scope/tool/main.js");`,
        });
        const sources = join(String(dir), "project", "src", "app");
        const plain = await spawned([bunExe(), "run", "main.ts"], sources, bunEnv);
        expect(plain.stdout.split("\n").filter(line => line.endsWith(": error"))).toEqual(["no-such-name: error"]);
        const compiled = await build(sources, "main.ts");
        built(compiled);
        for (const folder of [sources, join(String(dir), "elsewhere")]) {
          const ran = await spawned([compiled.executable], folder, compiledOnly);
          expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
        }
      }),
    timeout,
  );

  test(
    "a file that is named by a path and imports what isn't there fails where the worker starts, and the build says so",
    () =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.js": `const worker = new Worker(new URL("./imports.js", import.meta.url));${listen}`,
          "imports.js": `import "./inner.js"; postMessage("imports.js");`,
          "inner.js": `import "./no-such-file.js";`,
        });
        const plain = await spawned([bunExe(), "run", "main.js"], String(dir), bunEnv);
        expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({
          stdout: "error Cannot find module\n",
          exitCode: 0,
        });
        const compiled = await build(String(dir), "main.js");
        built(compiled);
        expect(compiled.stderr).toContain("warn: TS100150");
        const ran = await spawned([compiled.executable], String(dir), compiledOnly);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
      }),
    timeout,
  );

  test(
    "the same file stops the build where the program imports it too or it is given as an entry point",
    () =>
      slot(async () => {
        const files = {
          "imports.js": `import "./inner.js"; globalThis.postMessage?.("imports.js");`,
          "inner.js": `import "./no-such-file.js";`,
        };
        const start = `new Worker(new URL("./imports.js", import.meta.url));`;
        using imported = tempDir("aot-workers-from-texts", { ...files, "main.js": `import "./imports.js"; ${start}` });
        using given = tempDir("aot-workers-from-texts", { ...files, "main.js": start });
        const builds = [await build(String(imported), "main.js"), await build(String(given), "main.js", "imports.js")];
        for (const compiled of builds) {
          expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
            stderr: expect.stringContaining("error: TS100150"),
            exitCode: 1,
          });
        }
      }),
    timeout,
  );

  test.each([
    ["a syntax error", "postMessage((", "TS100084", "SyntaxError: Unexpected end of file"],
    ["words that are no program", "this is no program", "TS100084", "undefined"],
    // It is a program. It is compiled, and its body throws what the loader says.
    ["an import that is not found", `import "./no-such-file.js"; postMessage(1)`, "TS100150", "Cannot find module"],
  ])(
    "a text with %s is left to the run time, and the build says so",
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
        const ran = await spawned([compiled.executable], String(dir), bunEnv);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: `message sound\nerror ${said}\n`,
          exitCode: 0,
        });
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
                worker.onmessage = event => (console.log("message", event.data), worker.terminate(), done());
                worker.onerror = event => (console.log("error"), event.preventDefault(), done());
                worker.postMessage(20);
              });
            await heard(new Worker(new URL("./self.ts", import.meta.url)));
            await heard(new Worker(new URL("./bare.ts", import.meta.url)));
            await heard(new Worker(new URL("./listener.ts", import.meta.url)));
          `,
          "self.ts": `self.onmessage = (event: MessageEvent) => { self.postMessage(event.data + 1); };`,
          "bare.ts": `onmessage = (event: MessageEvent) => { postMessage(event.data + 2); };`,
          "listener.ts": `
            self.addEventListener("message", (event: MessageEvent) => { postMessage(event.data + 3); });
            self.onerror = null;
            console.log(typeof self.dispatchEvent, typeof dispatchEvent, onerror);
          `,
        });
        const compiled = await build(String(dir), "main.ts");
        built(compiled);
        expect(compiled.stderr).not.toContain("warn:");
        const ran = await spawned([compiled.executable], String(dir), compiledOnly);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: "message 21\nmessage 22\nfunction function null\nmessage 23\n",
          exitCode: 0,
        });
      }),
    timeout,
  );

  test(
    "a type error in a file that is named by a path stops the build, as it does in an entry point",
    () =>
      slot(async () => {
        using dir = tempDir("aot-workers-from-texts", {
          "main.ts": `const worker = new Worker(new URL("./worker.ts", import.meta.url));${listen}`,
          "worker.ts": `let count: number = "text"; postMessage(count);`,
        });
        const compiled = await build(String(dir), "main.ts");
        expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
          stderr: expect.stringContaining("error: TS2322"),
          exitCode: 1,
        });
      }),
    timeout,
  );
});
