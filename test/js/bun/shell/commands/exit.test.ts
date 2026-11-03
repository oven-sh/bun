import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("exit", async () => {
  TestBuilder.command`exit`.exitCode(0).runAsTest("works");

  describe("argument sets exit code", async () => {
    for (const arg of [0, 2, 11]) {
      TestBuilder.command`exit ${arg}`.exitCode(arg).runAsTest(`${arg}`);
    }
  });

  TestBuilder.command`exit 3 5`.exitCode(1).stderr("exit: too many arguments\n").runAsTest("too many arguments");

  TestBuilder.command`exit 62757836`.exitCode(204).runAsTest("exit code wraps u8");

  // prettier-ignore
  TestBuilder.command`exit abc`.exitCode(1).stderr("exit: numeric argument required\n").runAsTest("numeric argument required");

  describe("no argument gives the status of the last command", () => {
    // Each status is the one that `bash -c` and `dash -c` give.
    const rows: [script: string, status: number][] = [
      ["false; exit", 1],
      ["false\nexit", 1],
      ["false || exit", 1],
      ["true && false || exit", 1],
      ["false && true; exit", 1],
      ["(false; exit)", 1],
      ["false; (exit)", 1],
      ["(exit 42); exit", 42],
      ["true | false; exit", 1],
      ["false; true | exit", 1],
      ["if false; then echo a; else exit; fi", 1],
      ["false; $(exit)", 1],
      ["false; exit $UNSET", 1],
      ["false; FOO=bar exit", 1],
      ["false; exit > /dev/null", 1],
      ["exit 3; exit", 3],
      ["false; exit && echo next", 1],
      // The last status is 0, or `exit` has an argument.
      ["true; exit", 0],
      ["false; true; exit", 0],
      ["false; exit 0", 0],
      ["false; exit 3", 3],
      ["false | exit", 0],
      ["false; (true; exit)", 0],
      ["(exit 3); (true); exit", 0],
      ["if false; then echo a; fi; exit", 0],
      ["false; FOO=bar; exit", 0],
      ["false; if true; then exit; fi", 0],
      // The body of `$(\n)` is a statement with no command.
      ["false; $(\n)", 0],
      ["false; $(\n); exit", 0],
    ];
    for (const [script, status] of rows) {
      TestBuilder.command`${{ raw: script }}`.exitCode(status).runAsTest(JSON.stringify(script));
    }

    TestBuilder.command`false; exit`.quiet().exitCode(1).runAsTest("with .quiet()");

    // A `$(...)` does not write its status back: dash gives 1 here, bash gives 0.
    TestBuilder.command`false; exit $(true)`.exitCode(1).runAsTest("after a command substitution in its own words");

    test("the promise rejects with that status", async () => {
      const error = await $`false; exit`
        .quiet()
        .throws(true)
        .catch(error => error);
      expect(error).toMatchObject({ name: "ShellError", exitCode: 1 });
    });
  });
});
