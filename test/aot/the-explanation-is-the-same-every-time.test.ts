// What --explain=json prints is a function of the program: the same rows, reasons and places every time, at any number of threads.
// In the functions here a value comes from several places that the compiler knows nothing about at once: parsed text, a callback,
// a global, a caught error, a method of a receiver nobody knows. Which of them a row names may not follow which thread got where first.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { slot, spawned, unsupported } from "./run-programs";

const numberOfModules = 12;
const functionsInModule = 40;

function moduleText(module: number): string {
  let text = `import { registry, text } from "./shared.js";\nimport * as next from "./module${(module + 1) % numberOfModules}.js";\n`;
  for (let index = 0; index < functionsInModule; index++) {
    text += `
export function make${index}(options) { const made = { name: "m${module}f${index}", options, next: null }; registry.push(made); return made; }
export function use${index}(given, callback, depth) {
  let value = depth & 1 ? JSON.parse(text) : callback(given);
  if (depth & 2) value = registry[depth % registry.length];
  if (depth & 4) value = globalThis.hook(given);
  if (depth & 8) { try { given.missing(); } catch (error) { value = error; } }
  if (depth & 32) value = given.slice(1).map(callback)[0];
  if (depth & 64) value = value.name.trim().split(",").sort(callback);
  if (depth > 0 && depth < 40) value.next = next.use${(index * 7 + 3) % functionsInModule}(value, callback, depth - 1);
  return depth & 16 ? make${index}(value.options) : value.name ? value : given;
}
`;
  }
  return text;
}

const sources: Record<string, string> = {
  "shared.js": `export const registry = [{ name: "first", options: null, next: null }];\nexport const text = '{"name":"parsed","options":{}}';\n`,
  "entry.js": `import * as first from "./module0.js";\nglobalThis.hook = given => given;\nglobalThis.all = first;\nconsole.log(first.use0({ name: "given" }, given => given, 3).name);\n`,
};
for (let module = 0; module < numberOfModules; module++) sources[`module${module}.js`] = moduleText(module);

test.skipIf(!!unsupported)(
  "ten explanations of one program are equal",
  async () => {
    using folder = tempDir("aot-same-explanation", sources);
    const explain = (...words: string[]) =>
      slot(async () => {
        const { stdout, stderr, exitCode, signal } = await spawned(
          [bunExe(), "check", "--aot", "--no-pretty", "--explain=json", ...words, "entry.js"],
          String(folder),
          bunEnv,
        );
        expect({ stderr, exitCode, signal, rows: stdout.split("\n").length > 50 }).toEqual({
          stderr: expect.not.stringMatching(/^error\b/m),
          exitCode: 0,
          signal: null,
          rows: true,
        });
        return Bun.hash(stdout).toString(16);
      });
    const words = [[], [], [], [], [], [], ["--threads=1"], ["--threads=2"], ["--threads=8"], ["--threads=32"]];
    const hashes = await Promise.all(words.map(words => explain(...words)));
    expect(hashes).toEqual(hashes.map(() => hashes[0]));
  },
  600_000,
);
