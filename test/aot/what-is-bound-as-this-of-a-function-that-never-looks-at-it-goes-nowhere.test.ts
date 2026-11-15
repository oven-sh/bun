// `fetch.bind(globalThis)`, `console.log.bind(console)`, `setTimeout.bind(globalThis)`: what libraries write to keep a function of the platform.
// Each once let the global object go, and with it everything that hangs on it: the executable kept every feature, and eval and new Function counted as reachable.
// Nobody takes what is bound out of a bound function, and these functions never look at their `this`. A function that does look, or hands it back, lets it go as before.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const reachedThroughTheGlobalObjectAlone = [
  "eval, new Function and the JavaScript interpreter (interpreter)",
  "Bun.FileSystemRouter (fs-router)",
  "HTMLRewriter (html-rewriter)",
  "WeakRef and FinalizationRegistry",
  "DataView",
  "Float16Array",
];

const boundAndKept = {
  "fetch, called where it is bound": `const get = fetch.bind(globalThis);\nget("http://localhost:1").catch(() => console.log("refused"));\n`,
  "fetch, called in another function": `const get = fetch.bind(globalThis);\nfunction ask() {\n  return get("http://localhost:1");\n}\nask().catch(() => console.log("refused"));\n`,
  "fetch, held by an object of a class": `class Client {\n  get = fetch.bind(globalThis);\n  ask() {\n    return this.get("http://localhost:1");\n  }\n}\nnew Client().ask().catch(() => console.log("refused"));\n`,
  "fetch, handed to a function": `function ask(how) {\n  return how("http://localhost:1");\n}\nask(fetch.bind(globalThis)).catch(() => console.log("refused"));\n`,
  "fetch, bound twice": `const get = fetch.bind(globalThis).bind(null);\nget("http://localhost:1").catch(() => console.log("refused"));\n`,
  "console.log": `const say = console.log.bind(console);\nsay("refused");\n`,
  "console.log with a first argument": `const say = console.log.bind(console, "refused");\nsay();\n`,
  "console.log, handed to then": `Promise.resolve("refused").then(console.log.bind(console));\n`,
  "queueMicrotask": `const soon = queueMicrotask.bind(globalThis);\nsoon(() => console.log("refused"));\n`,
};

const boundAndLetGo = {
  "a function that hands its receiver back": `const whole = Object.prototype.valueOf.bind(globalThis);\nconsole.log(typeof whole()[process.argv[2] ?? "eval"]);\n`,
  "a function of the program": `const whole = function () {\n  return this;\n}.bind(globalThis);\nconsole.log(typeof whole()[process.argv[2] ?? "eval"]);\n`,
  "a function that keeps its receiver for its listeners": `const listen = addEventListener.bind(globalThis);\nlisten("cargo", event => console.log(typeof event.currentTarget[process.argv[2] ?? "eval"]));\ndispatchEvent(new Event("cargo"));\n`,
  "one of two functions": `const either = (process.argv[2] ? Object.prototype.valueOf : fetch).bind(globalThis);\nconsole.log(typeof either);\n`,
};

async function reportOn(text: string) {
  using dir = tempDir("aot-bound-functions", { "main.mjs": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return {
    kept: [...stderr.matchAll(/^aot: trim: kept (.+): used/gm)].map(line => line[1]),
    blocked: [...stderr.matchAll(/blocked by/g)].length,
  };
}

async function answerOfExecutable(text: string) {
  using dir = tempDir("aot-bound-functions-run", { "main.mjs": text });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "main"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [complaints, built] = await Promise.all([build.stderr.text(), build.exited]);
  if (built) return complaints;
  await using proc = Bun.spawn({ cmd: [`${dir}/main`], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return stdout + stderr;
}

for (const [title, text] of Object.entries(boundAndKept)) {
  test.concurrent(
    `${title}: the global object goes nowhere`,
    async () => {
      const [report, answer] = await Promise.all([reportOn(text), answerOfExecutable(text)]);
      expect(answer).toBe("refused\n");
      expect(report.kept).not.toBeEmpty();
      expect(report.kept.filter(feature => reachedThroughTheGlobalObjectAlone.includes(feature))).toEqual([]);
      expect(report.blocked).toBe(0);
    },
    600_000,
  );
}

for (const [title, text] of Object.entries(boundAndLetGo)) {
  test.concurrent(
    `${title}: what is bound as its \`this\` is let go`,
    async () => {
      const [report, answer] = await Promise.all([reportOn(text), answerOfExecutable(text)]);
      expect(answer).toBe("function\n");
      expect(report.kept).toEqual(expect.arrayContaining(reachedThroughTheGlobalObjectAlone));
      expect(report.blocked).toBeGreaterThan(0);
    },
    600_000,
  );
}
