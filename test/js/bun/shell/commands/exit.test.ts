import { describe } from "bun:test";
import { bunExe, createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);
const BUN = bunExe();

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
  TestBuilder.command`exit abc`.exitCode(2).stderr("exit: numeric argument required\n").runAsTest("numeric argument required");

  describe("no argument propagates the last command's status", async () => {
    TestBuilder.command`false; exit`.exitCode(1).runAsTest("false; exit");
    TestBuilder.command`true; exit`.exitCode(0).runAsTest("true; exit");
    TestBuilder.command`false || exit`.exitCode(1).runAsTest("false || exit");
    TestBuilder.command`true | false; exit`.exitCode(1).runAsTest("pipeline; exit");
    TestBuilder.command`${{ raw: "(exit 42); exit" }}`.exitCode(42).runAsTest("subshell; exit");
    TestBuilder.command`${{ raw: "false; (exit)" }}`.exitCode(1).runAsTest("inherited by subshell");
    TestBuilder.command`${BUN} -e ${"process.exit(7)"}; exit`.exitCode(7).runAsTest("subprocess; exit");
    TestBuilder.command`${{ raw: "false\nexit" }}`.exitCode(1).runAsTest("across statements");
    TestBuilder.command`false; exit 3`.exitCode(3).runAsTest("explicit arg wins");
  });

  describe("negative argument wraps mod 256", async () => {
    TestBuilder.command`exit -1`.exitCode(255).runAsTest("-1");
    TestBuilder.command`exit -300`.exitCode(212).runAsTest("-300");
  });
});
