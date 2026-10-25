// A program under ./programs is held against plain Bun, run on the spot. A <program>.expected.txt takes plain Bun's place: it says "here --aot differs on purpose", and the files together are the whole
// list of such differences. A stored output that is what plain Bun prints says nothing, hides the day on which the two part, and makes the list longer than it is: it fails here. Delete the file.
import { expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { generators } from "./generate";
import { pathOfWrittenProgram, slot, spawned, told, withoutCoreDump, withoutCrashReport } from "./run-programs";
import { describe, test } from "./supported";

const root = join(import.meta.dir, "programs");
const extensions = ["ts", "tsx", "mts", "cts", "js", "mjs", "cjs"];

/** Where plain Bun's own answer is not one answer. */
const plainBunVaries: Record<string, string> = {
  "arrays/sort-write-back-after-mutation":
    "plain Bun prints one of several outputs from run to run, the stored one among them: what its sort does with an array that changed under it goes by the tier that runs it",
  "calls/deep-tail-recursion":
    "a call in a catch block a million deep ends or overflows with the limit of the stack in the shell that runs it",
  "calls/stack-across-vm-entries":
    "plain Bun prints one of four outputs from run to run, the stored one among them: once its optimizing compilers have taken String.prototype.replace in, the stack has no frame for it. Without them it prints the stored output every time",
  "commonjs/wrapper-variables-in-loops":
    "plain Bun begins the five CommonJS files that the entry point imports in one of many orders from run to run; the stored output has them in the order of the import statements, which is what the executable always prints",
  "memory-of-many-objects/records-made-by-a-callback-for-each-element":
    "it asks whether the process grew by less than 320 MB: plain Bun grows by 340 MB on Linux, and on macOS by a little less than the bound in some runs",
  "objects/copies-of-an-object-with-very-many-names-take-time-in-proportion":
    "each line has a bound of 10 s: plain Bun is under it on a fast machine, and a debug or sanitizer build on a busy one may not be",
  "modules/commonjs-requires-es-modules-of-the-graph-being-linked":
    "plain Bun prints the lines of the stored output in one of several orders from run to run: which CommonJS file begins first is not one answer there; the stored order is what the executable always prints",
  "static-modules/cycles/the-second-of-two-commonjs-imports-requires-the-importer":
    "plain Bun begins the second file before the first in about one run of ten on a busy machine; the stored output is what it prints in the other nine, and what the executable always prints",
  "static-modules/earlier-cases/names-imported-by-es-modules-against-later-stores":
    "plain Bun prints another first line in about one run of eight; the stored output is what it prints in the other seven, and what the executable always prints",
  "untyped-speed/names-read-a-hundred-times-off-each-new-shape-are-not-four-times-as-slow-as-off-one-shape":
    "it compares two times: plain Bun is under the bound on some machines and over it on others",
};

// A script that writes programs may write what they are to print too (generate.ts).
const filesOfScripts = Object.entries(generators).flatMap(([topic, generator]) =>
  generator()
    .programs()
    .flatMap(program => Object.keys(program.files).map(file => `${topic}/${file}`)),
);
const stored = [
  ...new Set([
    ...(readdirSync(root, { recursive: true }) as string[]).map(file => file.replaceAll("\\", "/")),
    ...filesOfScripts,
  ]),
]
  .filter(file => file.endsWith(".expected.txt"))
  .map(file => file.slice(0, -".expected.txt".length))
  .filter(name => !existsSync(join(root, name + ".todo.txt")) && !plainBunVaries[name])
  .sort();
const topics = [...new Set(stored.map(name => name.split("/")[0]))];
const isKept = (name: string) =>
  extensions.some(
    extension => existsSync(join(root, `${name}.${extension}`)) || existsSync(join(root, name, `main.${extension}`)),
  );
// A script writes the program. What is stored for it lies beside it where it is written.
const written = new Map(stored.filter(name => !isKept(name)).map(name => [name, pathOfWrittenProgram(name)]));

async function saysNothing(name: string): Promise<boolean> {
  const beside = written.get(name)?.replace(/([\\/]main)?\.[a-z]+$/, "") ?? join(root, name);
  const path = [
    ...extensions.map(extension => `${beside}.${extension}`),
    ...extensions.map(extension => join(beside, `main.${extension}`)),
  ].find(existsSync);
  if (!path) return false;
  const options = existsSync(beside + ".json") ? JSON.parse(readFileSync(beside + ".json", "utf8")) : {};
  // There the reference is an executable without --aot, which a build has to make: the runner of the folder compares with it.
  if (options.reference === "compiled") return false;
  // Some of these environments hold BUN_JSC_crashIfInterpreterIsUsed=1, which is meant for the executable: plain Bun ends at its first function.
  const plain = told(
    await spawned(withoutCoreDump([bunExe(), "run", path]), dirname(path), {
      ...bunEnv,
      ...withoutCrashReport,
      ...options.env,
    }),
  );
  const text = plain.stdout + (plain.exitCode ? `exit code ${plain.exitCode}\n${plain.stderr}\n` : plain.stderr);
  return text === readFileSync(beside + ".expected.txt", "utf8");
}

describe("compile/aot/stored outputs say something", () => {
  test.concurrent.each(topics)(
    "%s",
    async topic => {
      const names = stored.filter(name => name.startsWith(topic + "/"));
      const answers = await Promise.all(names.map(name => slot(() => saysNothing(name))));
      expect(names.filter((_, index) => answers[index])).toEqual([]);
    },
    900_000,
  );
});
