// The flow analysis says what `this`, the parameters, `new.target` and the number of operands of a function can be, and what a call gives back, and compiled code
// relies on it without a test.
// ./ways-to-enter-a-function.ts lists the ways in which a function gets to run. One program enters a function of its own in each of them, as strict and as sloppy
// code. Plain Bun runs it and tells what each function was entered with: every value that was seen has room in the type that the analysis gives its place.
// The executable, built so that it checks at run time what the compiler took for proven, sees the same values.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { admits, claimsOf, fileOf } from "./harness/flow-claims";
import { describe, printIR, test, writesProgramInto } from "./harness/printed-ir";
import { ways } from "./ways-to-enter-a-function";

const places = [
  "this",
  "the first parameter",
  "the second parameter",
  "new.target",
  "the number of operands",
  "what the expression gives",
];
const seenIn = (stdout: string): Record<string, string[][]> =>
  Object.assign(
    {},
    ...stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line)),
  );

describe("however a function is entered", () => {
  test("what it is entered with has room in what the flow analysis says", async () => {
    const strict = fileOf(ways, "strict");
    const sloppy = fileOf(ways, "sloppy");
    const names = new Map([...strict.names, ...sloppy.names]);
    using dir = tempDir("aot-ways-to-enter-a-function", {
      "strict.cjs": strict.text,
      "sloppy.cjs": sloppy.text,
      "main.cjs": `require("./strict.cjs");\nrequire("./sloppy.cjs");\n`,
    });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    const executable = join(folder, isWindows ? "main.exe" : "main");

    const plain = await spawned([bunExe(), "main.cjs"], folder, env);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const seen = seenIn(plain.stdout);
    expect([...names].filter(([name]) => !seen[name]).map(([, way]) => way)).toEqual([]);

    built(
      await spawned(
        [
          bunExe(),
          ...compileCommand,
          "--aot-testing=CheckProofsAtRunTime",
          writesProgramInto(folder),
          "main.cjs",
          "--outfile",
          executable,
        ],
        folder,
        env,
      ),
    );
    const claims = claimsOf(
      await printIR(folder, {
        until: "ApplyFlowResults",
        functionName: [...names.keys()].flatMap(name => [`k_${name}`, `r_${name}`]).join("|"),
      }),
    );
    const withoutRoom: string[] = [];
    for (const [name, way] of names) {
      seen[name].forEach((values, place) => {
        const type = claims.get(name)?.[place] ?? "nothing";
        for (const value of values)
          if (!admits(type, value))
            withoutRoom.push(`${way}: ${places[place]} was ${value}, the analysis says ${type}`);
      });
    }
    expect(withoutRoom).toEqual([]);

    const compiled = await spawned([executable], folder, env);
    expect({ stderr: compiled.stderr, exitCode: compiled.exitCode, signal: compiled.signal }).toEqual({
      stderr: "",
      exitCode: 0,
      signal: null,
    });
    const seenCompiled = seenIn(compiled.stdout);
    expect(
      [...names]
        .filter(([name]) => !Bun.deepEquals(seenCompiled[name], seen[name]))
        .map(([name, way]) => ({ way, plain: seen[name], compiled: seenCompiled[name] })),
    ).toEqual([]);
  }, 240_000);
});
