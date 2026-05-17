import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("tail", async () => {
  TestBuilder.command`echo -e "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12" | tail`
    .exitCode(0)
    .stdout("line3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\n")
    .stderr("")
    .runAsTest("default 10 lines from pipe");

  TestBuilder.command`echo -e "line1\nline2\nline3\nline4\nline5" | tail -n 3`
    .exitCode(0)
    .stdout("line3\nline4\nline5\n")
    .stderr("")
    .runAsTest("-n flag limits lines");

  TestBuilder.command`echo -e "line1\nline2\nline3" | tail -n 10`
    .exitCode(0)
    .stdout("line1\nline2\nline3\n")
    .stderr("")
    .runAsTest("fewer lines than requested");

  TestBuilder.command`echo -e "line1\nline2\nline3" | tail -n 0`
    .exitCode(0)
    .stdout("")
    .stderr("")
    .runAsTest("-n 0 outputs nothing");

  TestBuilder.command`echo -e "line1\nline2\nline3\nline4\nline5" | tail -n 1`
    .exitCode(0)
    .stdout("line5\n")
    .stderr("")
    .runAsTest("-n 1 outputs last line");

  TestBuilder.command`echo -e "line1\nline2\nline3\nline4\nline5" | tail -n2`
    .exitCode(0)
    .stdout("line4\nline5\n")
    .stderr("")
    .runAsTest("-nN combined");
});

describe("tail in command substitution", async () => {
  TestBuilder.command`echo $(echo -e "line1\nline2\nline3" | tail -n 1)`
    .exitCode(0)
    .stdout("line3\n")
    .stderr("")
    .runAsTest("tail in command substitution");
});
