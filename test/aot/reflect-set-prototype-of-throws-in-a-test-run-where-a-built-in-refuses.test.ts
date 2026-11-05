// The link from a built-in to its prototype is read-only in compiled code, in a test run too. There a write that a built-in refuses throws, however the test writes it, so that
// no test goes on with its work half done, and the build says "this assignment throws if it runs". Reflect.setPrototypeOf() answered false instead, and the test went on.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test as oneAtATime } from "./supported";

const test = oneAtATime.concurrent;

const asks = (holder: string) =>
  `let said;\ntry { said = String(Reflect.setPrototypeOf(${holder}, Object.create(Object.getPrototypeOf(${holder})))); } catch (error) { said = error.name + ": " + error.message; }\n`;

describe("Reflect.setPrototypeOf() of a built-in", () => {
  test.each(["Date", "Uint8Array.prototype", "Math"])("throws in a test run, as the build says: %s", async holder => {
    using dir = tempDir("aot-reflect-set-prototype-of", {
      "one.test.js": `import { test } from "bun:test";\n${asks(holder)}test("says", () => console.log(said));\n`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
    expect({ said: stdout.split("\n")[1], exitCode }).toEqual({
      said: expect.stringMatching(
        /^TypeError: Cannot change the prototype of .+ because built-in objects are read-only in /,
      ),
      exitCode: 0,
    });
    expect(stderr).toContain("TS100014: this assignment throws if it runs");
  });

  test("answers false in a test run where the language refuses by itself", async () => {
    const asked = [
      "Reflect.setPrototypeOf(Object.prototype, {})",
      "Reflect.setPrototypeOf(Object.prototype, null)",
      "Reflect.setPrototypeOf(Array.prototype, [])",
      "Reflect.setPrototypeOf(Date, Object.create(Date))",
      "Reflect.setPrototypeOf(Math, Object.create(Object.create(Math)))",
    ];
    using dir = tempDir("aot-reflect-set-prototype-of", {
      "one.test.js": `import { test } from "bun:test";\nconst said = [];\n${asked.map(ask => `try { said.push(${ask}); } catch (error) { said.push(error.name); }\n`).join("")}test("says", () => console.log(said.join()));\n`,
    });
    for (const flags of [[], ["--aot"]]) {
      const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      expect({ flags, said: stdout.split("\n")[1], exitCode }).toEqual({
        flags,
        said: "false,true,false,false,false",
        exitCode: 0,
      });
    }
  });

  test("answers false in an executable, as the build says", async () => {
    using dir = tempDir("aot-reflect-set-prototype-of", { "main.js": `${asks("Math")}console.log(said);\n` });
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "main"],
      String(dir),
      bunEnv,
    );
    expect({
      exitCode: built.exitCode,
      warned: (built.stdout + built.stderr).includes("TS100014: this assignment has no effect"),
    }).toEqual({ exitCode: 0, warned: true });
    expect(await run([join(String(dir), "main")], String(dir), bunEnv)).toEqual({
      stdout: "false\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
