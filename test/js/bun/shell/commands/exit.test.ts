import { describe } from "bun:test";
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

  describe("ends the script", async () => {
    TestBuilder.command`echo start; exit 5; echo never`
      .exitCode(5)
      .stdout("start\n")
      .runAsTest("skips the statements after it");

    TestBuilder.command`exit 1; exit 2`.exitCode(1).runAsTest("the first exit wins");

    // https://github.com/oven-sh/bun/issues/20368
    TestBuilder.command /* sh */ `
echo "Good Bun!"
exit
exit 0
exit 1
echo "Bad Bun!"
`
      .exitCode(0)
      .stdout("Good Bun!\n")
      .runAsTest("a bare exit on its own line");

    // Bare `exit` should report the last command's status. That needs the
    // shell to track it, which it does not do yet, so this exits 0 today.
    TestBuilder.command`false; exit`
      .exitCode(1)
      .todo("the shell does not track the last command's status yet")
      .runAsTest("a bare exit reports the last command's status");

    // Not short-circuiting on a status: `exit 0` ends an && chain and
    // `exit 5` ends an || chain, where the status alone would keep going.
    TestBuilder.command`exit 0 && echo never`.exitCode(0).stdout("").runAsTest("exit 0 ends an && chain");

    TestBuilder.command`exit 5 || echo never`.exitCode(5).stdout("").runAsTest("exit 5 ends an || chain");

    TestBuilder.command`false || exit 3; echo never`.exitCode(3).stdout("").runAsTest("from the right side of ||");

    TestBuilder.command`if true; then exit 7; echo never; fi; echo never2`
      .exitCode(7)
      .stdout("")
      .runAsTest("from an if body");

    TestBuilder.command`if exit 5; then echo t; else echo f; fi`
      .exitCode(5)
      .stdout("")
      .runAsTest("from an if condition");

    // A failed condition would normally pick the else arm, and a failed elif
    // condition the next one. No command in any arm may run after `exit`.
    TestBuilder.command`if exit 5; then echo t1; echo t2; else echo f1; echo f2; fi`
      .exitCode(5)
      .stdout("")
      .runAsTest("from an if condition, with multi-statement arms");

    TestBuilder.command`if exit 5; then echo t; elif echo e; then echo t2; else echo f; fi`
      .exitCode(5)
      .stdout("")
      .runAsTest("from an if condition, skipping the elif condition");

    // A compound command may be followed by another expression in the same
    // statement (`fi` is not a statement terminator).
    TestBuilder.command`if true; then exit 5; fi echo never`
      .exitCode(5)
      .stdout("")
      .runAsTest("from a compound command sharing a statement");

    TestBuilder.command`exit abc; echo never`
      .exitCode(1)
      .stdout("")
      .stderr("exit: numeric argument required\n")
      .runAsTest("on a numeric argument error");

    TestBuilder.command`exit 3 5; echo never`
      .exitCode(1)
      .stdout("")
      .stderr("exit: too many arguments\n")
      .runAsTest("on too many arguments");
  });

  // `exit` ends the execution context that ran it, not the whole interpreter:
  // a subshell, command substitution, or pipeline element is its own context.
  describe("stays inside its execution context", async () => {
    TestBuilder.command`(echo sub; exit 6; echo never); echo after`
      .exitCode(0)
      .stdout("sub\nafter\n")
      .runAsTest("subshell");

    TestBuilder.command`(echo sub; exit 6; echo never) && echo never2`
      .exitCode(6)
      .stdout("sub\n")
      .runAsTest("subshell status reaches the parent");

    TestBuilder.command`echo cs=$(echo sub; exit 4; echo never); echo after`
      .exitCode(0)
      .stdout("cs=sub\nafter\n")
      .runAsTest("command substitution");

    TestBuilder.command`echo a; exit 5 | cat; echo b`.exitCode(0).stdout("a\nb\n").runAsTest("pipeline element");

    // A pipeline spawns an if-clause straight into its own env, with no
    // statement in between, so the status has to come from the if itself.
    TestBuilder.command`echo hi | if exit 5; then echo t; fi`
      .exitCode(5)
      .stdout("")
      .runAsTest("if-clause as a pipeline element");

    TestBuilder.command`echo hi | if false; then echo x; elif exit 5; then echo y; fi`
      .exitCode(5)
      .stdout("")
      .runAsTest("if-clause with an elif as a pipeline element");

    TestBuilder.command`(if true; then exit 2; fi; echo never); echo after`
      .exitCode(0)
      .stdout("after\n")
      .runAsTest("if body nested in a subshell");

    TestBuilder.command`if true; then (exit 2); fi; echo after`
      .exitCode(0)
      .stdout("after\n")
      .runAsTest("subshell nested in an if body");
  });
});
