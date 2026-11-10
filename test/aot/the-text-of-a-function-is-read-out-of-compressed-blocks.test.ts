// The text of functions lies in an executable in blocks of 64 KB, each compressed by itself. A block is opened at the first look into it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { test } from "./supported";

const sizeOfBlock = 64 * 1024;
const numberOfFunctions = 4000;

// Functions of many lengths, some with text that is not ASCII, and one that is longer than two blocks: so texts begin and end anywhere in a block, and cross from one into the next.
function writeProgram() {
  const lines = ["const all = [];"];
  for (let at = 0; at < numberOfFunctions; at++) {
    const tail = "word ".repeat(at % 11) + (at % 50 === 0 ? "é€😀" : "");
    lines.push(`all.push(function named${at}(left, right) {\n  return left * ${at} + right + "${tail}";\n});`);
    if (at === numberOfFunctions / 2)
      lines.push(
        `all.push(function long() {\n  return [${Array.from({ length: 50_000 }, (_, item) => (item % 89) + 11).join(", ")}];\n});`,
      );
  }
  lines.push(
    // Whether a character that is not ASCII is printed as it is or escaped is the printer's.
    String.raw`const textOf = each => each.toString().replace(/\\x(..)|\\u(....)/g, (_, two, four) => String.fromCharCode(parseInt(two ?? four, 16)));`,
    `const order = process.argv[2] === "backward" ? all.toReversed() : all;`,
    `const hasher = new Bun.CryptoHasher("sha1");`,
    `let length = 0;`,
    `for (const each of order) {\n  const text = textOf(each);\n  length += text.length;\n  hasher.update(text);\n}`,
    `console.log(all.length, length, hasher.digest("hex"));`,
    `console.log(textOf(order[0]));`,
    `console.log(all[50].toString() === all[50].toString(), textOf(all[50]));`,
  );
  return lines.join("\n") + "\n";
}

test("every function prints its text, in whatever order the blocks are opened, and the text takes a third of its size at most", async () => {
  using dir = tempDir("aot-text-in-blocks", { "program.js": writeProgram() });
  const cwd = String(dir);
  const executable = (name: string) => join(cwd, isWindows ? name + ".exe" : name);
  const ways: Record<string, string[]> = { compiled: [], withoutText: ["--no-compile-function-source"] };
  if (canTrim) ways.trimmed = ["--trim"];
  for (const [name, flags] of Object.entries(ways)) {
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, "program.js", "--outfile", executable(name)],
      cwd,
    );
    expect({ name, stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      name,
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
  }

  let length = 0;
  for (const order of ["forward", "backward"]) {
    const expected = await run([bunExe(), "program.js", order], cwd, bunEnv);
    for (const way of canTrim ? ["compiled", "trimmed"] : ["compiled"])
      expect({ way, order, ...(await run([executable(way), order], cwd, bunEnv)) }).toEqual({
        way,
        order,
        ...expected,
      });
    expect(expected.exitCode).toBe(0);
    length = Number(expected.stdout.split(" ")[1]);
  }
  expect(length).toBeGreaterThan(6 * sizeOfBlock);
  const stored = statSync(executable("compiled")).size - statSync(executable("withoutText")).size;
  expect(stored).toBeGreaterThan(0);
  expect(stored).toBeLessThan(length / 3);
}, 600_000);

test("a context of node:vm gets the text of a function that is handed in", async () => {
  using dir = tempDir("aot-text-asked-for-in-a-context", {
    "program.js": `import vm from "node:vm";
function probe(left, right) {
  return left + right;
}
class Named {
  method() {
    return 1;
  }
}
for (const asked of ["Function.prototype.toString.call(f)", "f.toString()", "String(f)", "\`\${f}\`"])
  for (const f of [probe, Named, Named.prototype.method]) console.log(asked, JSON.stringify(vm.runInNewContext(asked, { f })));
`,
  });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "compiled.exe" : "compiled");
  const build = await run([bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", executable], cwd);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  const expected = await run([bunExe(), "program.js"], cwd, bunEnv);
  expect(expected.stdout).toContain("return left + right;");
  expect(await run([executable], cwd, bunEnv)).toEqual(expected);
}, 240_000);
