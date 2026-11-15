// A function of a sloppy CommonJS file that starts with "use strict" is strict mode code, as in Node. `bun run` drops the directive.
// ./fixed/strict-functions.txt has the programs: each prints what the function with the directive answers and then what its neighbor without one answers.
// fixed.test.ts holds them as executables. Here they are the test files of one run, and what the language forbids behind the directive stops a build.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const parts = new Map(
  readFileSync(join(import.meta.dir, "fixed", "strict-functions.txt"), "utf8")
    .replaceAll("\r\n", "\n")
    .split(/^#### /m)
    .slice(1)
    .map(part => [part.slice(0, part.indexOf("\n")), part.slice(part.indexOf("\n") + 1)]),
);
const programs = [...parts.keys()].filter(name => !name.endsWith(" prints"));

describe.concurrent('a function\'s own "use strict"', () => {
  let ran: Promise<{ sections: string[]; exitCode: number }> | undefined;
  /** What each program printed as a test file of the one run. */
  const inOneTestRun = () =>
    (ran ??= (async () => {
      using dir = tempDir(
        "aot-strict-functions",
        Object.fromEntries(
          programs.map(name => [
            name.replace(".", ".test."),
            `console.log("| ${name}");\n${parts.get(name)}require("bun:test").test("ran", () => {});\n`,
          ]),
        ),
      );
      const { stdout, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
      return { sections: stdout.split(/^\| /m), exitCode };
    })());

  test.each(programs)("%s, in a test run", async name => {
    const { sections, exitCode } = await inOneTestRun();
    expect({ printed: sections.filter(section => section.startsWith(name + "\n")), exitCode }).toEqual({
      printed: [name + "\n" + parts.get(name + " prints")],
      exitCode: 0,
    });
  });

  test.each([
    ["a default parameter", `function f(a = 1) { "use strict"; return a; }`],
    ["two parameters of one name", `function f(a, a) { "use strict"; return a; }`],
    ["with", `function f(o) { "use strict"; with (o) { return x; } }`],
    ["delete of a name", `function f() { "use strict"; var x = 1; return delete x; }`],
    ["a store to eval", `function f() { "use strict"; eval = 1; }`],
    ["a reserved word", `function f() { "use strict"; var let = 1; return let; }`],
  ])("%s is refused behind the directive", async (_, source) => {
    using dir = tempDir("aot-strict-functions", { "a.cjs": `${source}\nconsole.log(typeof f);\n` });
    const executable = join(String(dir), isWindows ? "a.exe" : "a");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "a.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.stringContaining("error"),
      exitCode: 1,
    });
  });
});
