import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("printenv", async () => {
  TestBuilder.command`FOO=bar printenv FOO`
    .exitCode(0)
    .stdout("bar\n")
    .stderr("")
    .runAsTest("prints specific variable");

  TestBuilder.command`printenv NONEXISTENT_VAR_12345`
    .exitCode(1)
    .stdout("")
    .stderr("")
    .runAsTest("exits 1 for missing variable");

  TestBuilder.command`FOO=hello BAR=world printenv FOO BAR`
    .exitCode(0)
    .stdout("hello\nworld\n")
    .stderr("")
    .runAsTest("prints multiple variables");

  TestBuilder.command`export MY_TEST_VAR=exported; printenv MY_TEST_VAR`
    .exitCode(0)
    .stdout("exported\n")
    .stderr("")
    .runAsTest("prints exported variable");
});

describe("printenv without stdout", async () => {
  TestBuilder.command`FOO=test123 echo $(printenv FOO)`
    .exitCode(0)
    .stdout("test123\n")
    .stderr("")
    .runAsTest("printenv in command substitution");
});
