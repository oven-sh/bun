import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const mine = `() => name => console.log("mine", name)`;
const refusal = (what: string, how = "assign to") =>
  `TypeError: Cannot ${how} ${what} because built-in objects are read-only in a compiled executable`;
const stopsTheBuild = "error: TS100014: this assignment always throws";

const replaced: [entryPoint: string, text: string, plain: string, compiled: string][] = [
  [
    "main.cjs",
    `const M = require("node:module"); M.createRequire = ${mine}; M.createRequire(__filename)("./next.cjs");`,
    "mine ./next.cjs\n",
    refusal("node:module.createRequire"),
  ],
  [
    "main.cjs",
    `require("module").createRequire = ${mine}; require("node:module").createRequire(__filename)("./next.cjs");`,
    "mine ./next.cjs\n",
    refusal("node:module.createRequire"),
  ],
  [
    "main.cjs",
    `const key = ["create", "Require"].join(""); require("node:module")[key] = ${mine}; require("node:module").createRequire(__filename)("./next.cjs");`,
    "mine ./next.cjs\n",
    refusal("node:module.createRequire"),
  ],
  [
    "main.cjs",
    `Object.assign(require("node:module"), { createRequire: ${mine} }); require("node:module").createRequire(__filename)("./next.cjs");`,
    "mine ./next.cjs\n",
    refusal("node:module.createRequire"),
  ],
  [
    "main.cjs",
    `function change(object) { object.createRequire = ${mine}; } const M = require("node:module"); change(M); M.createRequire(__filename)("./next.cjs");`,
    "mine ./next.cjs\n",
    refusal("node:module.createRequire"),
  ],
  [
    "main.cjs",
    `delete require("node:module").createRequire; console.log(typeof require("node:module").createRequire);`,
    "undefined\n",
    refusal("node:module.createRequire", "delete"),
  ],
  [
    "main.cjs",
    `Object.defineProperty(require("node:module"), "createRequire", { value: ${mine} }); require("node:module").createRequire(__filename)("./next.cjs");`,
    "mine ./next.cjs\n",
    stopsTheBuild,
  ],
  [
    "main.mjs",
    `import M from "node:module"; M.createRequire = ${mine}; M.createRequire(import.meta.url)("./next.cjs");`,
    "mine ./next.cjs\n",
    stopsTheBuild,
  ],
  [
    "main.mjs",
    `import * as ns from "node:module"; ns.default.createRequire = ${mine}; ns.createRequire(import.meta.url)("./next.cjs");`,
    "mine ./next.cjs\n",
    stopsTheBuild,
  ],
  [
    "main.mjs",
    `const ns = await import("node:module"); ns.default.createRequire = ${mine}; ns.default.createRequire(import.meta.url)("./next.cjs");`,
    "mine ./next.cjs\n",
    refusal("node:module.createRequire"),
  ],
  [
    "main.mjs",
    `process.getBuiltinModule("module").createRequire = ${mine}; process.getBuiltinModule("node:module").createRequire(import.meta.url)("./next.cjs");`,
    "mine ./next.cjs\n",
    stopsTheBuild,
  ],
  [
    "main.mjs",
    `import.meta.require("node:module").createRequire = ${mine}; import.meta.require("node:module").createRequire(import.meta.url)("./next.cjs");`,
    "mine ./next.cjs\n",
    stopsTheBuild,
  ],
  [
    "main.cjs",
    `const M = require("node:module"); M.Module = { createRequire: ${mine} }; M.Module.createRequire(__filename)("./next.cjs");`,
    "mine ./next.cjs\n",
    refusal("node:module.Module"),
  ],
  [
    "main.mjs",
    `import M from "node:module"; M.Module = { createRequire: ${mine} }; M.Module.createRequire(import.meta.url)("./next.cjs");`,
    "mine ./next.cjs\n",
    stopsTheBuild,
  ],
  [
    "main.cjs",
    `process.getBuiltinModule = () => ({ createRequire: ${mine} }); process.getBuiltinModule("node:module").createRequire(__filename)("./next.cjs");`,
    "mine ./next.cjs\n",
    refusal("process.getBuiltinModule"),
  ],
  [
    "main.cjs",
    `process.getBuiltinModule = () => "mine"; console.log(process.getBuiltinModule("node:path"));`,
    "mine\n",
    refusal("process.getBuiltinModule"),
  ],
  [
    "main.cjs",
    `const host = process; host.getBuiltinModule = () => "mine"; console.log(host.getBuiltinModule(["node", "path"].join(":")));`,
    "mine\n",
    refusal("process.getBuiltinModule"),
  ],
  [
    "main.cjs",
    `delete process.getBuiltinModule; console.log(typeof process.getBuiltinModule);`,
    "undefined\n",
    refusal("process.getBuiltinModule", "delete"),
  ],
  [
    "main.mjs",
    `process.getBuiltinModule = () => ({ createRequire: ${mine} }); const load = process.getBuiltinModule("node:module").createRequire(import.meta.url); load("./next.cjs");`,
    "mine ./next.cjs\n",
    stopsTheBuild,
  ],
  [
    "main.mjs",
    `import process from "node:process"; process.getBuiltinModule = () => ({ createRequire: ${mine} }); process.getBuiltinModule("node:module").createRequire(import.meta.url)("./next.cjs");`,
    "mine ./next.cjs\n",
    stopsTheBuild,
  ],
];

const executableIn = (folder: string, name: string) => join(folder, name + (isWindows ? ".exe" : ""));

async function build(folder: string, entryPoint: string, name: string, ...flags: string[]) {
  const executable = executableIn(folder, name);
  const built = await spawned(
    [bunExe(), "build", "--compile", ...flags, entryPoint, "--outfile", executable],
    folder,
    bunEnv,
  );
  return { built, run: () => spawned([executable], folder, bunEnv) };
}

const firstError = (stderr: string) => stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line)) ?? "";

describe.concurrent("a store to createRequire, Module or getBuiltinModule", () => {
  for (const [entryPoint, text, plain, compiled] of replaced) {
    test(
      text,
      () =>
        slot(async () => {
          using dir = tempDir("aot-replaced-loaders", {
            [entryPoint]: text,
            "next.cjs": `console.log("the next file");`,
          });
          const folder = String(dir);
          const ran = await spawned([bunExe(), entryPoint], folder, bunEnv);
          expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain, exitCode: 0 });
          const bundled = await build(folder, entryPoint, "bundled");
          expect(bundled.built.exitCode).toBe(0);
          const ranBundled = await bundled.run();
          expect({ stdout: ranBundled.stdout, exitCode: ranBundled.exitCode }).toEqual({ stdout: plain, exitCode: 0 });

          const ahead = await build(folder, entryPoint, "ahead", "--aot");
          if (compiled === stopsTheBuild) {
            expect({
              error: firstError(ahead.built.stderr).slice(0, compiled.length),
              exitCode: ahead.built.exitCode,
            }).toEqual({
              error: compiled,
              exitCode: 1,
            });
            return;
          }
          expect(ahead.built.exitCode).toBe(0);
          const ranAhead = await ahead.run();
          expect({
            stdout: ranAhead.stdout,
            error: firstError(ranAhead.stderr).split(" (bun compile")[0],
            exitCode: ranAhead.exitCode,
          }).toEqual({ stdout: "", error: compiled, exitCode: 1 });
        }),
      600_000,
    );
  }
});

const roads: [entryPoint: string, object: string][] = [
  ["main.cjs", `require("node:module")`],
  ["main.cjs", `require("module")`],
  ["main.cjs", `module.require("node:module")`],
  ["main.cjs", `process.getBuiltinModule("node:module")`],
  ["main.cjs", `process.getBuiltinModule("module")`],
  ["main.cjs", `require("node:module").Module`],
  ["main.cjs", `require("node:module").createRequire(__filename)("node:module")`],
  ["main.cjs", `require(["node", "module"].join(":"))`],
  ["main.cjs", `[require("node:module")].map(it => it)[0]`],
  ["main.cjs", `JSON.parse("[0]", () => require("node:module"))`],
  ["main.mjs", `(await import("node:module")).default`],
  ["main.mjs", `import.meta.require("node:module")`],
];

const attempts = (name: string) => `
attempt(() => { M.${name} = mine; });
attempt(() => { M[key(${JSON.stringify(name)})] = mine; });
attempt(() => { Object.defineProperty(M, ${JSON.stringify(name)}, { value: mine }); });
attempt(() => { Object.defineProperties(M, { ${name}: { get: mine } }); });
attempt(() => { Object.assign(M, { ${name}: mine }); });
attempt(() => { [M.${name}] = [mine]; });
attempt(() => { M.${name} &&= mine; });
attempt(() => { for (M.${name} of [mine]); });
attempt(() => delete M.${name});
attempt(() => Reflect.set(M, ${JSON.stringify(name)}, mine));
attempt(() => Reflect.defineProperty(M, ${JSON.stringify(name)}, { value: mine }));
attempt(() => Reflect.deleteProperty(M, ${JSON.stringify(name)}));
attempt(() => Reflect.set(new Proxy(M, {}), ${JSON.stringify(name)}, mine));
attempt(() => Reflect.deleteProperty(new Proxy(M, {}), ${JSON.stringify(name)}));
attempt(() => { M.${name} ||= mine; });
attempt(() => { Object.defineProperty(M, ${JSON.stringify(name)}, { value: M.${name} }); });
`;
const answers = (what: string) => [
  ...Array(8).fill(refusal(what)),
  refusal(what, "delete"),
  ...Array(5).fill("false"),
  "undefined",
  "undefined",
];

describe.concurrent("every way to the object of node:module", () => {
  for (const [entryPoint, object] of roads) {
    test(
      object,
      () =>
        slot(async () => {
          using dir = tempDir("aot-replaced-loaders", {
            [entryPoint]: `
const M = ${object};
const mine = ${mine};
const key = name => name.slice(0, 3) + name.slice(3);
const { createRequire, Module } = M;
function attempt(change) {
  try { console.log(String(change())); } catch (error) { console.log(String(error).split(" (bun compile")[0]); }
}
${attempts("createRequire")}${attempts("Module")}
M.mine = 1;
console.log(M.mine, M.createRequire === createRequire, M.Module === Module);
process.getBuiltinModule("node:module").createRequire(${entryPoint.endsWith(".cjs") ? "__filename" : "import.meta.url"})("./next.cjs");
`,
            "next.cjs": `console.log("the next file");`,
          });
          const ahead = await build(String(dir), entryPoint, "ahead", "--aot");
          expect({ error: firstError(ahead.built.stderr), exitCode: ahead.built.exitCode }).toEqual({
            error: "",
            exitCode: 0,
          });
          const ran = await ahead.run();
          expect(ran.stdout.split("\n")).toEqual([
            ...answers("node:module.createRequire"),
            ...answers("node:module.Module"),
            "1 true true",
            "the next file",
            "",
          ]);
          expect(ran.exitCode).toBe(0);
        }),
      600_000,
    );
  }

  test(
    "process.getBuiltinModule",
    () =>
      slot(async () => {
        using dir = tempDir("aot-replaced-loaders", {
          "main.cjs": `
const M = process;
const mine = () => "mine";
const key = name => name.slice(0, 3) + name.slice(3);
const { getBuiltinModule } = M;
function attempt(change) {
  try { console.log(String(change())); } catch (error) { console.log(String(error).split(" (bun compile")[0]); }
}
${attempts("getBuiltinModule")}
process.mine = 1; process.title = "mine";
console.log(process.mine, process.getBuiltinModule === getBuiltinModule, typeof process.getBuiltinModule("node:path").sep);
`,
        });
        const ahead = await build(String(dir), "main.cjs", "ahead", "--aot");
        expect({ error: firstError(ahead.built.stderr), exitCode: ahead.built.exitCode }).toEqual({
          error: "",
          exitCode: 0,
        });
        const ran = await ahead.run();
        expect(ran.stdout.split("\n")).toEqual([...answers("process.getBuiltinModule"), "1 true string", ""]);
        expect(ran.exitCode).toBe(0);
      }),
    600_000,
  );

  test(
    "a Worker has an object of its own",
    () =>
      slot(async () => {
        using dir = tempDir("aot-replaced-loaders", {
          "main.mjs": `
import M from "node:module";
import { Worker, isMainThread } from "node:worker_threads";
if (isMainThread) new Worker(import.meta.filename);
else {
  for (const change of [() => { M.createRequire = ${mine}; }, () => { M.Module = {}; }, () => { process.getBuiltinModule = () => M; }]) {
    try { change(); console.log("done"); } catch (error) { console.log(String(error).split(" (bun compile")[0]); }
  }
  M.createRequire(import.meta.url)("./next.cjs");
}
`,
          "next.cjs": `console.log("the next file");`,
        });
        const ahead = await build(String(dir), "main.mjs", "ahead", "--aot");
        expect({ error: firstError(ahead.built.stderr), exitCode: ahead.built.exitCode }).toEqual({
          error: "",
          exitCode: 0,
        });
        const ran = await ahead.run();
        expect(ran.stdout.split("\n")).toEqual([
          refusal("node:module.createRequire"),
          refusal("node:module.Module"),
          refusal("process.getBuiltinModule"),
          "the next file",
          "",
        ]);
        expect(ran.exitCode).toBe(0);
      }),
    600_000,
  );
});
