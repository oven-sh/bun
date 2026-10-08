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

  // bash and dash accept a space or a tab around the number. dash accepts a CR too.
  describe("whitespace around the number", () => {
    for (const arg of ["3 ", " 3", "3\t", "3\r"]) {
      TestBuilder.command`exit ${arg}`.exitCode(3).runAsTest(JSON.stringify(arg));
    }

    TestBuilder.command`exit "$(echo '3 ')"`.exitCode(3).runAsTest("from a quoted command substitution");
    TestBuilder.command`CODE=$(echo '3 '); exit $CODE`
      .exitCode(3)
      .runAsTest("from a variable assigned a command substitution");
  });

  // prettier-ignore
  TestBuilder.command`exit abc`.exitCode(1).stderr("exit: numeric argument required\n").runAsTest("numeric argument required");
});
