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

  // bash accepts a space or a tab around the number, and no other byte after it.
  describe("blanks around the number", () => {
    for (const arg of ["3 ", " 3", "3\t"]) {
      TestBuilder.command`exit ${arg}`.exitCode(3).runAsTest(`accepts ${JSON.stringify(arg)}`);
    }

    for (const arg of ["3\r", "3\n", "3\f"]) {
      TestBuilder.command`exit ${arg}`
        .exitCode(1)
        .stderr("exit: numeric argument required\n")
        .runAsTest(`rejects ${JSON.stringify(arg)}`);
    }

    // A quoted substitution keeps its trailing space, so the status reaches exit with it.
    TestBuilder.command`exit "$(echo '3 ')"`.exitCode(3).runAsTest("accepts a quoted command substitution");
  });

  // prettier-ignore
  TestBuilder.command`exit abc`.exitCode(1).stderr("exit: numeric argument required\n").runAsTest("numeric argument required");
});
