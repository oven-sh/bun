import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

// An application is built in several flavors from one source: `if (feature("NO_PLUGINS")) throw ..; else runPlugins()`. A flavor is checked by looking into its
// executable for texts that stand only in what the flag rules out. So not only the arm has to go: also the functions, classes, modules, texts and patterns that it alone led to.

const behindTheArm = {
  "live.ts": `export function live(x: number) { return "KEPT_TEXT_" + x; }`,
  "dead.ts": `
    import { deeper, Deepest } from "./deeper";
    function helper(x: number) { return "RULED_OUT_HELPER" + x; }
    export function dead(x: number) { return deeper(x) + new Deepest().say() + helper(x); }
  `,
  "deeper.ts": `
    export function deeper(x: number) { return "RULED_OUT_TEXT" + x + /RULED_OUT_PATTERN/.source + JSON.stringify({ RULED_OUT_KEY: x }); }
    export class Deepest { RULED_OUT_FIELD = 1; say() { return "RULED_OUT_METHOD"; } }
  `,
};

const asks = (header: string, condition: string) => `
  ${header}
  import { live } from "./live";
  import { dead } from "./dead";
  function run(x: number) { if (${condition}) return live(x); else return dead(x); }
  console.log(run(1));
`;

async function textsIn(files: Record<string, string>, flags: string[] = []) {
  using dir = tempDir("aot-ruled-out-by-a-constant", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  await using built = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--no-compile-function-source",
      "--feature=NO_PLUGINS",
      ...flags,
      "./main.ts",
      "--outfile",
      executable,
    ],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  await using ran = Bun.spawn({ cmd: [executable], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout] = await Promise.all([ran.stdout.text(), ran.exited]);
  // The texts of an image stand side by side with nothing between them.
  const written = Object.entries(files).flatMap(([name, text]) => (name + text).match(/(RULED_OUT|KEPT)_[A-Z]+/g) ?? []);
  const bytes = readFileSync(executable);
  return { stdout, found: [...new Set(written)].filter(text => bytes.includes(text)).sort() };
}

const ways: [string, string, string, string[]?][] = [
  ["a flag of the build", `import { feature } from "bun:bundle";`, `feature("NO_PLUGINS")`],
  ["a constant of the file", `const OFF = true;`, `OFF`],
  ["a constant of another file", `import { OFF } from "./constants";`, `OFF`],
  ["--define", `declare const OFF: boolean;`, `OFF`, ["--define", "OFF=true"]],
  ["process.env under --define", ``, `process.env.OFF === "yes"`, ["--define", 'process.env.OFF="yes"']],
  ["a member of an enum", `enum Mode { On = 1, Off }`, `Mode.On === 1`],
  ["a member of a const enum of another file", `import { Mode } from "./constants";`, `Mode.On === 1`],
  ["typeof a built-in", ``, `typeof Bun === "object"`],
];

for (const [way, header, condition, flags] of ways) {
  test(`what only the arm led to that ${way} rules out`, async () => {
    const constants = `export const OFF = true; export const enum Mode { On = 1, Off }`;
    const files = { ...behindTheArm, "constants.ts": constants, "main.ts": asks(header, condition) };
    expect(await textsIn(files, flags)).toEqual({ stdout: "KEPT_TEXT_1\n", found: ["KEPT_TEXT"] });
  });
}

// The arm may be what loads a module. A flag of the build is decided before anything is loaded, so the module is not even read.
// The value of a member of an enum stands in the code that the engine is handed, and the engine passes over the arm.
const loads = [
  ["import()", `const { dead } = await import("./dead"); return dead(x);`],
  ["require()", `const { dead } = require("./dead"); return dead(x);`],
];
for (const [way, header, condition] of [ways[0], ways[5]]) {
  for (const [load, arm] of loads) {
    test(`a module that only ${load} loads, in the arm that ${way} rules out`, async () => {
      const main = `
        ${header}
        import { live } from "./live";
        async function run(x: number) { if (${condition}) return live(x); else { ${arm} } }
        console.log(await run(1));
      `;
      expect(await textsIn({ ...behindTheArm, "main.ts": main })).toEqual({
        stdout: "KEPT_TEXT_1\n",
        found: ["KEPT_TEXT"],
      });
    });
  }
}

// `Host.run()` hands the namespace object to whatever `run` holds as `this`. The build cannot tell by the binding what that is, and still the other members of the barrel are not all reached.
test("a member of a barrel that only the arm names, beside a member that is called and is no function as it is written", async () => {
  const barrel = (...files: string[]) => files.map(file => `export * from "${file}";\n`).join("") + `export * as default from ".";\n`;
  const { stdout, found } = await textsIn({
    "live.ts": behindTheArm["live.ts"],
    "host/index.ts": barrel("./inner/index.js", "./made.js"),
    "host/make-host.ts": `export function makeHost() { let count = 0; return { run: (x: number) => "KEPT_RUN" + (count += x) }; }`,
    "host/made.ts": `import { makeHost } from "./make-host"; export const { run } = makeHost();`,
    "host/inner/index.ts": barrel("./plugins/index.js"),
    "host/inner/plugins/index.ts": barrel("./make-plugins.js"),
    "host/inner/plugins/make-plugins.ts": `export const makePlugins = (x: number) => { console.log("RULED_OUT_MEMBER"); return x; };`,
    "main.ts": `
      import { feature } from "bun:bundle";
      import { live } from "./live";
      import Host from "./host";
      import Plugins from "./host/inner/plugins";
      function ask(x: number) { if (feature("NO_PLUGINS")) return live(x); else return Plugins.makePlugins(x); }
      console.log(Host.run(1), ask(1));
    `,
  });
  expect({ stdout, found }).toEqual({ stdout: "KEPT_RUN1 KEPT_TEXT_1\n", found: ["KEPT_RUN", "KEPT_TEXT"] });
});

// The load takes the file of a Worker for an entry point where it meets the text that names the file, long before anybody knows what is reached.
// A loader that is given a name which the build does not know may be given any path that the program spells: that text too, as long as what holds it can run.
const loadsByUnknownName = `
  export async function loadAny(name: string) { return await import(name); }
  if (process.argv.length > 5) console.log(await loadAny(process.argv[5]));
`;
for (const [beside, more] of [
  ["", ""],
  [", beside a load by a name that the build does not know", loadsByUnknownName],
]) {
  test(`the file of a Worker that only the arm would have started${beside}`, async () => {
    const { stdout, found } = await textsIn({
      "live.ts": behindTheArm["live.ts"],
      "workers/RULED_OUT_FILE.ts": `console.log("RULED_OUT_WORKER");`,
      "workers/KEPT_FILE.ts": `postMessage("KEPT_WORKER");`,
      "spawn.ts": `
        export const urlOfPlugins = () => new URL("./workers/RULED_OUT_FILE.ts", import.meta.url);
        export function spawnPlugins(entry = urlOfPlugins()) { return new Worker(entry); }
        export function spawnKept() { return new Worker(new URL("./workers/KEPT_FILE.ts", import.meta.url)); }
      `,
      "main.ts": `
        import { feature } from "bun:bundle";
        import { live } from "./live";
        import { spawnKept, spawnPlugins } from "./spawn";
        function ask(x: number) { if (feature("NO_PLUGINS")) return live(x); else return spawnPlugins(); }
        const worker = spawnKept();
        worker.onmessage = event => { console.log(event.data, ask(1)); worker.terminate(); };
        ${more}
      `,
    });
    expect({ stdout, found }).toEqual({
      stdout: "KEPT_WORKER KEPT_TEXT_1\n",
      found: ["KEPT_FILE", "KEPT_TEXT", "KEPT_WORKER"],
    });
  });
}

// What a module does when it is evaluated stays: the import is written, and the module runs whether or not anything of it is used.
test("a module that is imported by a statement still runs", async () => {
  const { stdout, found } = await textsIn({
    ...behindTheArm,
    "dead.ts": `console.log("KEPT_EFFECT"); export function dead(x: number) { return "RULED_OUT_TEXT" + x; }`,
    "main.ts": asks(`import { feature } from "bun:bundle";`, `feature("NO_PLUGINS")`),
  });
  expect({ stdout, found }).toEqual({ stdout: "KEPT_EFFECT\nKEPT_TEXT_1\n", found: ["KEPT_EFFECT", "KEPT_TEXT"] });
});
