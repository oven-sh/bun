import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("head", async () => {
  TestBuilder.command`echo -e "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12" | head`
    .exitCode(0)
    .stdout("line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n")
    .stderr("")
    .runAsTest("default 10 lines from pipe");

  TestBuilder.command`echo -e "line1\nline2\nline3\nline4\nline5" | head -n 3`
    .exitCode(0)
    .stdout("line1\nline2\nline3\n")
    .stderr("")
    .runAsTest("-n flag limits lines");

  TestBuilder.command`echo -e "line1\nline2\nline3" | head -n 10`
    .exitCode(0)
    .stdout("line1\nline2\nline3\n")
    .stderr("")
    .runAsTest("fewer lines than requested");

  TestBuilder.command`echo -e "line1\nline2\nline3" | head -n 0`
    .exitCode(0)
    .stdout("")
    .stderr("")
    .runAsTest("-n 0 outputs nothing");

  TestBuilder.command`echo -e "line1\nline2\nline3\nline4\nline5" | head -3`
    .exitCode(0)
    .stdout("line1\nline2\nline3\n")
    .stderr("")
    .runAsTest("-N shorthand");

  TestBuilder.command`echo -e "line1\nline2\nline3\nline4\nline5" | head -n2`
    .exitCode(0)
    .stdout("line1\nline2\n")
    .stderr("")
    .runAsTest("-nN combined");
});

describe("head without stdout", async () => {
  TestBuilder.command`echo $(echo -e "line1\nline2\nline3" | head -n 1)`
    .exitCode(0)
    .stdout("line1\n")
    .stderr("")
    .runAsTest("head in command substitution");
});
