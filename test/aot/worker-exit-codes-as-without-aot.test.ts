// Workers that end on their own, by process.exit(), by an error or by a rejection that nobody handles, at top level, in a
// module they import and in a callback. The parent prints what it hears of each: the messages, the error and the exit code,
// from a web Worker and from a Worker of node:worker_threads. An executable built with --aot prints what an executable built
// without it prints, in every mode of --unhandled-rejections.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

setDefaultTimeout(240_000);

const modules = {
  "rejects.js": `Promise.reject(new Error("rejected in rejects.js")); postMessage("rejects.js ran");`,
  "throws.js": `postMessage("throws.js runs"); throw new Error("thrown in throws.js");`,
  "rejects.cjs": `Promise.reject(new Error("rejected in rejects.cjs")); postMessage("rejects.cjs ran");`,
  "throws.cjs": `postMessage("throws.cjs runs"); throw new Error("thrown in throws.cjs");`,
  "rejects-with-a-function.js": `new Promise((resolve, reject) => { throw reject; }); postMessage("rejects-with-a-function.js ran");`,
  "exits.js": `postMessage("exits.js runs"); process.exit(3);`,
  "fine.js": `postMessage("fine.js ran"); export const fine = 1;`,
  "data.json": `{ "a": 1 }`,
};

const printExitCode = (name: string) =>
  `process.on("exit", code => console.log("${name}: exit listener", code, process.exitCode));`;

const entries = {
  "ends.js": `await import("./fine.js"); postMessage("after import");`,
  "never-settles.js": `postMessage("entry runs"); await new Promise(() => {});`,
  "never-settles-after-import.js": `await import("./fine.js"); postMessage("after import"); await new Promise(() => {});`,
  "never-settles-after-rejection.js": `await import("./rejects.js"); postMessage("after import"); await new Promise(() => {});`,

  "rejects-at-top-level.js": `Promise.reject(new Error("top level")); postMessage("end of entry");`,
  "rejects-after-await.js": `await 0; Promise.reject(new Error("after await")); postMessage("end of entry");`,
  "rejects-in-microtask.js": `queueMicrotask(() => { Promise.reject(new Error("microtask")); }); postMessage("end of entry");`,
  "rejects-in-next-tick.js": `process.nextTick(() => { Promise.reject(new Error("next tick")); }); postMessage("end of entry");`,
  "rejects-in-timer.js": `setTimeout(() => { Promise.reject(new Error("timer")); }, 5); postMessage("end of entry");`,
  "rejects-in-immediate.js": `setImmediate(() => { Promise.reject(new Error("immediate")); }); postMessage("end of entry");`,
  "rejects-after-timer.js": `await new Promise(resolve => setTimeout(resolve, 5)); Promise.reject(new Error("after timer")); postMessage("end of entry");`,
  "rejects-twice.js": `await import("./fine.js"); Promise.reject(new Error("first")); Promise.reject(new Error("second"));`,
  "rejects-with-symbol.js": `await import("./fine.js"); Promise.reject(Symbol("reason"));`,
  "rejects-with-undefined.js": `await import("./fine.js"); Promise.reject();`,
  "catches-late.js": `const promise = Promise.reject(new Error("caught late")); setTimeout(() => promise.catch(error => postMessage("caught " + error.message)), 5); postMessage("end of entry");`,

  "throws-at-top-level.js": `postMessage("entry runs"); throw new Error("top level");`,
  "throws-in-timer.js": `setTimeout(() => { throw new Error("timer"); }, 5); postMessage("end of entry");`,
  "throws-after-timer.js": `await new Promise(resolve => setTimeout(resolve, 5)); throw new Error("after timer");`,

  "static-import-rejects.js": `import "./rejects.js"; postMessage("end of entry");`,
  "static-import-throws.js": `import "./throws.js"; postMessage("end of entry");`,
  "require-rejects.cjs": `require("./rejects.cjs"); postMessage("end of entry");`,
  "require-throws.cjs": `require("./throws.cjs"); postMessage("end of entry");`,

  "import-rejects.js": `await import("./rejects.js"); postMessage("after import");`,
  "import-rejects-not-awaited.js": `import("./rejects.js"); postMessage("end of entry");`,
  "import-rejects-commonjs.js": `await import("./rejects.cjs"); postMessage("after import");`,
  "import-rejects-with-a-function.js": `await import("./rejects-with-a-function.js");`,
  "import-of-import-rejects.js": `await import("./import-rejects.js"); postMessage("after the outer import");`,
  "import-throws.js": `await import("./throws.js"); postMessage("after import");`,
  "import-throws-not-awaited.js": `import("./throws.js"); postMessage("end of entry");`,
  "import-throws-commonjs.js": `await import("./throws.cjs"); postMessage("after import");`,
  "import-throws-caught.js": `try { await import("./throws.js"); } catch (error) { postMessage("caught " + error.message); }`,
  "import-exits.js": `await import("./exits.js"); postMessage("after import");`,
  "exits-after-import-rejects.js": `await import("./rejects.js"); process.exit(4);`,

  "rejects-after-import.js": `await import("./fine.js"); Promise.reject(new Error("after import")); postMessage("end of entry");`,
  "rejects-after-import-of-loaded-module.js": `import "./fine.js"; await import("./fine.js"); Promise.reject(new Error("after import")); postMessage("end of entry");`,
  "rejects-after-import-of-built-in.js": `await import("node:fs"); Promise.reject(new Error("after import")); postMessage("end of entry");`,
  "rejects-after-import-of-json.js": `await import("./data.json"); Promise.reject(new Error("after import")); postMessage("end of entry");`,
  "throws-after-import.js": `await import("./fine.js"); throw new Error("after import");`,

  "unhandled-rejection-listener.js": `process.on("unhandledRejection", reason => postMessage("listener: " + reason.message)); Promise.reject(new Error("top level")); postMessage("end of entry");`,
  "unhandled-rejection-listener-import.js": `process.on("unhandledRejection", reason => postMessage("listener: " + reason.message)); await import("./rejects.js"); postMessage("after import");`,
  "uncaught-exception-listener-import.js": `process.on("uncaughtException", (error, origin) => postMessage("listener: " + error.message + ", " + origin)); await import("./rejects.js"); postMessage("after import");`,
  "global-listeners-import.js": `addEventListener("unhandledrejection", () => postMessage("unhandledrejection event")); addEventListener("error", () => postMessage("error event")); await import("./rejects.js"); postMessage("after import");`,

  "exit-listener.js": `${printExitCode("exit-listener.js")} Promise.reject(new Error("top level")); postMessage("end of entry");`,
  "exit-listener-import.js": `${printExitCode("exit-listener-import.js")} await import("./rejects.js"); postMessage("after import");`,
  "exit-listener-timer.js": `${printExitCode("exit-listener-timer.js")} setTimeout(() => { Promise.reject(new Error("timer")); }, 5);`,
  "exit-code.js": `process.exitCode = 5; Promise.reject(new Error("top level"));`,
  "exit-code-import.js": `process.exitCode = 5; await import("./rejects.js"); postMessage("after import");`,
  "exit-code-timer.js": `process.exitCode = 5; setTimeout(() => { Promise.reject(new Error("timer")); }, 5);`,

  "starts-worker.js": `const worker = new Worker(new URL("./import-rejects.js", import.meta.url).href);
const heard = [];
worker.addEventListener("message", event => heard.push(event.data));
worker.addEventListener("error", event => heard.push(String(event.message).match(/^error: .*$/m)[0]));
worker.addEventListener("close", event => postMessage("inner worker: " + [...heard, "close " + event.code].join(", ")));`,
};

const start = `import { Worker as NodeWorker } from "node:worker_threads";
const summarize = text => (String(text).match(/^\\w*[eE]rror: .*$/m) ?? [String(text).split("\\n")[0]])[0];
function runWebWorker(name) {
  const { promise, resolve } = Promise.withResolvers();
  const heard = ["web " + name];
  const worker = new Worker(new URL("./" + name, import.meta.url).href);
  worker.addEventListener("open", () => heard.push("open"));
  worker.addEventListener("message", event => heard.push(event.data));
  worker.addEventListener("messageerror", () => heard.push("messageerror"));
  worker.addEventListener("error", event => heard.push(summarize(event.message)));
  worker.addEventListener("close", event => resolve([...heard, "close " + event.code].join(" | ")));
  return promise;
}
function runNodeWorker(name) {
  const { promise, resolve } = Promise.withResolvers();
  const heard = ["node " + name];
  const worker = new NodeWorker(new URL("./" + name, import.meta.url));
  worker.on("online", () => heard.push("online"));
  worker.on("message", message => heard.push(message));
  worker.on("messageerror", () => heard.push("messageerror"));
  worker.on("error", error => heard.push("error: " + (error instanceof Error ? error.message : String(error))));
  worker.on("exit", code => resolve([...heard, "exit " + code].join(" | ")));
  return promise;
}
for (const name of ${JSON.stringify(Object.keys(entries))}) {
  console.log(await runWebWorker(name));
  console.log(await runNodeWorker(name));
}
`;

const named = (name: string) => (isWindows ? name + ".exe" : name);

describe("what a parent hears of its workers", () => {
  let dir: ReturnType<typeof tempDir>;
  let cwd: string;
  beforeAll(async () => {
    dir = tempDir("aot-worker-exit-codes", { ...modules, ...entries, "start.js": start });
    cwd = String(dir);
    const entryPoints = ["start.js", ...Object.keys(entries)].map(name => "./" + name);
    for (const [outfile, flags] of [
      ["without", []],
      ["with", ["--aot"]],
    ] as const) {
      const built = await run(
        [bunExe(), "build", "--compile", ...flags, ...entryPoints, "--outfile", named(outfile)],
        cwd,
      );
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
    }
  });

  const modes = ["none", "warn", "warn-with-error-code", "strict", "throw"];
  test.each(["", ...modes.map(mode => "--unhandled-rejections=" + mode)])(
    "is the same with and without --aot (BUN_OPTIONS=%j)",
    async options => {
      const env = { ...bunEnv, NO_COLOR: "1", BUN_OPTIONS: options };
      const [without, withAot] = await Promise.all(
        ["without", "with"].map(async outfile => {
          const { stdout, exitCode } = await run([join(cwd, named(outfile))], cwd, env);
          return { lines: stdout.split("\n").sort(), exitCode };
        }),
      );
      expect(without.lines.length).toBeGreaterThan(2 * Object.keys(entries).length);
      expect(withAot).toEqual(without);
    },
  );
});
