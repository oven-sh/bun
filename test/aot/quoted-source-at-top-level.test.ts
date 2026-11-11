// An error at the top level of a file quotes what failed, so an executable keeps the text of the statements there. It keeps no more than that: no comment between
// statements, no function that nobody enters, no statement that only names data.
import { expect } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { compileCommand } from "./harness/flags";
import { beforeAll, describe, test } from "./supported";

const statementThatFails = `console.log("key" in holder.none)`;
const inBlockAroundIt = "a comment in the block around the statement that fails";
const betweenStatements = "a comment between two statements";
const inFunctionNobodyEnters = "a comment in a function that nobody enters";
const longText = "a long text at the top level of the file";
const inTable = "a text in a table at the top level of the file";

const program = `/** ${betweenStatements} */
const holder: { none: any } = { none: null };
let text = "${longText}";
export const table = [1, { deep: ["${inTable}"] }, null] as const;
function nobodyEnters() { /* ${inFunctionNobodyEnters} */ return holder.none.x; }
try {
  // ${inBlockAroundIt}
  ${statementThatFails};
} catch (error) {
  console.log((error as Error).message);
}
console.log(text, table[1].deep[0]);
`;

function count(bytes: Buffer, text: string) {
  let found = 0;
  for (let at = bytes.indexOf(text); at >= 0; at = bytes.indexOf(text, at + 1)) found++;
  return found;
}

describe("compile/aot/an executable keeps the text at the top level that an error may quote", () => {
  const root = String(tempDir("aot-text-at-the-top-level", {}));
  const path = (name: string) => join(root, isWindows ? name + ".exe" : name);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeAll(async () => {
    writeFileSync(join(root, "main.ts"), program);
    for (const [name, flags] of [
      ["with-text", []],
      ["without-text", ["--no-compile-function-source"]],
    ] as const) {
      const command = [
        bunExe(),
        ...compileCommand,
        ...withoutDebugInformation(),
        ...flags,
        "./main.ts",
        "--outfile",
        path(name),
      ];
      built(await spawned(command, root, bunEnv));
    }
  }, 300_000);

  test("it quotes as bun run does", async () => {
    const plain = await spawned([bunExe(), "./main.ts"], root, bunEnv);
    const run = await spawned([path("with-text")], root, bunEnv);
    expect(plain.stdout).toStartWith(`holder.none is not an Object. (evaluating '"key" in holder.none')\n`);
    expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  // The text that errors quote and the text of functions lie compressed in the file. The printer of stored strings opens them.
  const storedStrings = async (name: string) =>
    Buffer.from((await spawned([bunExe(), "build", "--aot-stored-strings", path(name)], root, bunEnv)).stdout);

  test("its bytes hold the statement that may fail and nothing else of the top level a second time", async () => {
    const file = readFileSync(path("with-text"));
    expect([inBlockAroundIt, betweenStatements, inFunctionNobodyEnters].map(text => count(file, text))).toEqual([
      0, 0, 0,
    ]);
    const bytes = await storedStrings("with-text");
    expect({
      statementThatFails: count(bytes, statementThatFails),
      inBlockAroundIt: count(bytes, inBlockAroundIt),
      betweenStatements: count(bytes, betweenStatements),
      inFunctionNobodyEnters: count(bytes, inFunctionNobodyEnters),
      longText: count(bytes, longText),
      inTable: count(bytes, inTable),
    }).toEqual({
      statementThatFails: 1,
      inBlockAroundIt: 0,
      betweenStatements: 0,
      inFunctionNobodyEnters: 0,
      longText: 1,
      inTable: 1,
    });
  });

  test("built without the text of functions it holds none of it", async () => {
    expect(count(readFileSync(path("without-text")), statementThatFails)).toBe(0);
    expect(count(await storedStrings("without-text"), statementThatFails)).toBe(0);
    const run = await spawned([path("without-text")], root, bunEnv);
    expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({
      stdout: `null is not an Object.\n${longText} ${inTable}\n`,
      exitCode: 0,
    });
  });
});
