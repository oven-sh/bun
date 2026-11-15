// `"unlikely";` as the first statement of an arm of an `if` is read in Bun's own modules alone (src/js/README.md): the block of the arm says
// frequency=Unlikely in the program that the front end writes, and the engine lays it behind the usual way. The same string in a file of a
// program is an expression statement like any other: no block of the program's own functions says anything.
//
// Here a Bun that has the engine writes its program with --aot-out, and `testaot print` prints it. What the engine makes of the word is held
// by its own test, machine/arm-that-says-unlikely-is-laid-behind-the-usual-way.ir.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { built, spawned } from "./harness/commands";
import { buildFlags, compileCommand, withProgramOutput } from "./harness/flags";
import { test } from "./supported";

const program = `
import { EventEmitter } from "node:events";
function written(flag: boolean, log: string[]) {
  if (flag) {
    "unlikely";
    log.push("then");
  } else {
    ("unlikely");
    log.push("else");
  }
  return log;
}
const emitter = new EventEmitter();
emitter.on("told", (flag: boolean) => console.log(written(flag, []).join()));
emitter.emit("told", true);
emitter.emit("told", false);
`;

const declared = without("testaot") ? test.skip : test;

declared("an arm that begins with the word is unlikely in a module of Bun and as written in a program", async () => {
  using folder = tempDir("aot-the-word-unlikely", { "main.ts": program });
  const file = join(String(folder), "program.aot");
  const flags = [withProgramOutput(file), buildFlags.withoutExecutable];
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.ts"], String(folder), bunEnv));
  const { lines, stderr, exitCode } = await run("print", file);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });

  const roleOfFunctionAt = (index: number) => {
    let head = index;
    while (head >= 0 && !lines[head].startsWith("function ")) head--;
    return head < 0 ? "?" : (/ role=(\w+)/.exec(lines[head])?.[1] ?? "Program");
  };
  const marked = lines.flatMap((line, index) =>
    /^ {2}b\d+\(.*\) .*frequency=Unlikely/.test(line) ? [roleOfFunctionAt(index)] : [],
  );
  expect(marked.length).toBeGreaterThan(0);
  expect([...new Set(marked)]).toEqual(["Library"]);

  const head = lines.findIndex(line => line.startsWith("function ") && line.includes(` name="written"`));
  expect(head).toBeGreaterThanOrEqual(0);
  const blocks = lines.slice(head + 1, lines.indexOf("}", head)).filter(line => /^ {2}b\d+\(/.test(line));
  expect(blocks.length).toBeGreaterThan(2);
  expect(blocks.filter(line => line.includes("frequency="))).toEqual([]);
});
