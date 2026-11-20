// The type of a list with objects of more than 1,001 classes is more than the checker computes. A file that is lowered in parts
// and holds such a list is lowered as a whole: each part gave up, and the build did not end.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const numbers = (count: number) => Array.from({ length: count }, (_, i) => i);
function program(count: number, item: (i: number) => string, use: string) {
  const classes = numbers(count).map(
    i => `class Item${i} { constructor() { this.part${i} = ${i}; } take${i}() { return this.part${i} + 2; } }`,
  );
  return `${classes.join("\n")}
function fill() { const items = [];
${numbers(count)
  .map(i => `  items.push(${item(i)});`)
  .join("\n")}
  return items; }
${use}
`;
}
const count = (list: string) => `let total = 0;
for (const item of ${list}) total += Object.keys(item).length;
console.log(total);`;
const object = (i: number) => `new Item${i}()`;
const inAVariable = `const kept = fill();\n${count("kept")}`;
// `prints`: an object of a class and an object literal have one key each, a class has none.
// `staysInParts`: the checker computes the type of the list, so the file is lowered in parts to the end.
const programs: [name: string, file: string, text: string, prints: string, staysInParts: boolean][] = [
  ["1,001 classes", "main.js", program(1001, object, inAVariable), "1001\n", true],
  ["1,002 classes", "main.js", program(1002, object, inAVariable), "1002\n", false],
  ["1,002 classes in a CommonJS file", "main.cjs", program(1002, object, inAVariable), "1002\n", false],
  [
    "in a local variable",
    "main.mjs",
    program(1002, object, `function main() { const kept = fill();\n${count("kept")} }\nmain();`),
    "1002\n",
    false,
  ],
  ["without a variable", "main.js", program(1002, object, count("fill()")), "1002\n", false],
  ["the classes themselves", "main.js", program(1002, i => `Item${i}`, inAVariable), "0\n", false],
  ["object literals", "main.js", program(1002, i => `{ part${i}: ${i} }`, inAVariable), "1002\n", false],
];

// With the variable an executable aborts where it would interpret code.
const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

/** A digest of the bytes of a file. An executable is as large as Bun, so it is read in pieces. */
async function digestOf(path: string) {
  await using file = await open(path);
  const piece = Buffer.allocUnsafe(4 * 1024 * 1024);
  const digest = new Bun.CryptoHasher("sha256");
  for (let at = 0, read = 0; (read = (await file.read(piece, 0, piece.length, at)).bytesRead); at += read)
    digest.update(piece.subarray(0, read));
  return digest.digest("hex");
}

describe("a list of objects of many classes in a file that is lowered in parts", () => {
  test.each(programs)("%s", (_, file, text, prints, staysInParts) =>
    slot(async () => {
      using dir = tempDir("wide-lists-in-parts", { [file]: text });
      const folder = String(dir);
      const executable = join(folder, "main");
      const printed = { stdout: prints, stderr: "", exitCode: 0, signal: null };
      expect(await spawned([bunExe(), "--no-install", file], folder, bunEnv)).toEqual(printed);
      // With the variable a build says when it has joined the parts of a file.
      const env = staysInParts ? { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" } : bunEnv;
      const images: string[] = [];
      for (const threads of [1, 8]) {
        const flags = ["--compile", "--aot", "--aot-testing=LowersInParts", `--aot-threads=${threads}`];
        // A build that does not end is killed at the limit of the harness, and that fails the case.
        const build = await spawned([bunExe(), "build", ...flags, file, "--outfile", executable], folder, env);
        built(build);
        // The build on one thread shows that the flag reaches a file of this shape. Nothing is asked of the other files: of
        // "without a variable" a build says the same, and then throws the parts away.
        if (staysInParts && threads === 1) expect(build.stderr).toContain("AOT file in parts: Lower |");
        images.push(await digestOf(executable));
      }
      expect(images[1]).toBe(images[0]);
      // The two are the same bytes, so one run is the run of both. The file was compiled, whichever way it was lowered.
      expect(await spawned([executable], folder, compiledOnly)).toEqual(printed);
    }),
  );
});
