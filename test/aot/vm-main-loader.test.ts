import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const outcome = `.then(module => "loaded " + Object.keys(module).sort().join(), error => error.code + ": " + error.message)`;

const files: Record<string, string> = {
  "package.json": `{ "name": "project", "type": "module" }`,
  "lib.ts": `
let hidden = 7;
export function used() { return 5; }
export function unused() { return 6; }
export function bump() { return ++hidden; }
`,
  "main.ts": `
import vm from "node:vm";
import { used } from "./lib";
(globalThis as any).shared = { n: 1 };
console.log("used:", used());
const outcome = ${JSON.stringify(outcome)};
const mainLoader = { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER };
const sandbox = () => ({ folder: import.meta.dir });
console.log("by a relative path:", await vm.runInNewContext('import("./lib.ts")' + outcome, sandbox(), mainLoader));
console.log("by its own path:", await vm.runInNewContext('import(folder + "/lib.ts")' + outcome, sandbox(), mainLoader));
console.log("a module of Bun's own:", await vm.runInNewContext('import("node:vm")' + outcome, sandbox(), mainLoader));
console.log("without a callback:", await vm.runInNewContext('import("./lib.ts")' + outcome, sandbox()));
console.log("the outer global:", vm.runInNewContext('this.constructor.constructor("return globalThis.shared.n")()', {}));
console.log("a global of its own:", vm.runInNewContext("typeof shared", {}));
console.log("an Object of its own:", vm.runInNewContext("this.constructor === Object", {}));
`,
};

const lines = (stdout: string) =>
  Object.fromEntries(
    stdout
      .split("\n")
      .filter(Boolean)
      .map(line => line.split(/: (.*)/s)),
  );

async function answers(furtherEntryPoints: string[]) {
  using dir = tempDir("aot-vm-main-loader", files);
  const directory = String(dir);
  const plain = await run([bunExe(), "main.ts"], directory, bunEnv);
  expect(plain.exitCode).toBe(0);
  const program = join(directory, "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", ...furtherEntryPoints, "--outfile", program],
    directory,
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([program], directory, bunEnv);
  expect(compiled.exitCode).toBe(0);
  return { plain: lines(plain.stdout), compiled: lines(compiled.stdout) };
}

const wholeModule = "loaded bump,unused,used";

test("text with the main loader gets no compiled file", async () => {
  const { plain, compiled } = await answers([]);
  expect(plain["by a relative path"]).toBe(wholeModule);
  expect(plain["by its own path"]).toBe(wholeModule);
  expect(compiled["by a relative path"]).toStartWith("ERR_MODULE_NOT_FOUND: Cannot load ");
  expect(compiled["by a relative path"]).toContain("it isn't in this executable");
  expect(compiled["by its own path"]).toStartWith("ERR_MODULE_NOT_FOUND: Cannot load ");
  expect(compiled["by its own path"]).toContain("this executable can't load a module from a dynamic path");
  expect(compiled["used"]).toBe("5");
}, 180_000);

test("it gets a file that is passed as an entry point", async () => {
  const { compiled } = await answers(["lib.ts"]);
  expect(compiled["by its own path"]).toBe(wholeModule);
  expect(compiled["by a relative path"]).toContain("it isn't in this executable");
}, 180_000);

test("text in a context reaches what it reaches under bun run", async () => {
  const { plain, compiled } = await answers([]);
  expect(plain["the outer global"]).toBe("1");
  expect(plain["a global of its own"]).toBe("undefined");
  expect(plain["an Object of its own"]).toBe("false");
  expect(plain["without a callback"]).toStartWith("ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING: ");
  expect(plain["a module of Bun's own"]).toContain("runInNewContext");
  for (const name of [
    "the outer global",
    "a global of its own",
    "an Object of its own",
    "without a callback",
    "a module of Bun's own",
  ])
    expect(compiled[name]).toBe(plain[name]);
}, 180_000);
