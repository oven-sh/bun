import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("echo", async () => {
  TestBuilder.command`echo`.exitCode(0).stdout("\n").stderr("").runAsTest("no arguments outputs newline");

  TestBuilder.command`echo hello`.exitCode(0).stdout("hello\n").stderr("").runAsTest("single argument");

  TestBuilder.command`echo hello world`.exitCode(0).stdout("hello world\n").stderr("").runAsTest("multiple arguments");

  TestBuilder.command`echo "hello world"`.exitCode(0).stdout("hello world\n").stderr("").runAsTest("quoted argument");

  TestBuilder.command`echo hello   world`
    .exitCode(0)
    .stdout("hello world\n")
    .stderr("")
    .runAsTest("multiple spaces collapsed");

  TestBuilder.command`echo ""`.exitCode(0).stdout("\n").stderr("").runAsTest("empty string");

  TestBuilder.command`echo one two three four`
    .exitCode(0)
    .stdout("one two three four\n")
    .stderr("")
    .runAsTest("many arguments");
});

describe("echo -n flag", async () => {
  TestBuilder.command`echo -n`.exitCode(0).stdout("").stderr("").runAsTest("no arguments with -n flag");

  TestBuilder.command`echo -n hello`.exitCode(0).stdout("hello").stderr("").runAsTest("single argument with -n flag");

  TestBuilder.command`echo -n hello world`
    .exitCode(0)
    .stdout("hello world")
    .stderr("")
    .runAsTest("multiple arguments with -n flag");

  TestBuilder.command`echo -n "hello world"`
    .exitCode(0)
    .stdout("hello world")
    .stderr("")
    .runAsTest("quoted argument with -n flag");

  TestBuilder.command`echo -n ""`.exitCode(0).stdout("").stderr("").runAsTest("empty string with -n flag");

  TestBuilder.command`echo -n one two three`
    .exitCode(0)
    .stdout("one two three")
    .stderr("")
    .runAsTest("many arguments with -n flag");
});

describe("echo error handling", async () => {
  TestBuilder.command`echo -x`.exitCode(0).stdout("-x\n").runAsTest("invalid flag");

  TestBuilder.command`echo -abc`.exitCode(0).stdout("-abc\n").runAsTest("invalid multi-char flag");

  TestBuilder.command`echo --invalid`.exitCode(0).stdout("--invalid\n").runAsTest("invalid long flag");
});

describe("echo special cases", async () => {
  TestBuilder.command`echo -n -n hello`
    .exitCode(0)
    .stdout("-n hello")
    .stderr("")
    .runAsTest("-n flag with -n as argument");

  TestBuilder.command`echo -- -n hello`
    .exitCode(0)
    .stdout("-- -n hello\n")
    .stderr("")
    .runAsTest("double dash treated as argument");

  TestBuilder.command`echo "\n"`.exitCode(0).stdout("\\n\n").stderr("").runAsTest("literal backslash n");
});
