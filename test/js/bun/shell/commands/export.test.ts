import { describe, expect } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("export", async () => {
  TestBuilder.command`export FOO=bar && echo $FOO`.stdout("bar\n").stderr("").exitCode(0).runAsTest("sets a variable");

  TestBuilder.command`export FOO=bar BAZ=qux && echo $FOO $BAZ`
    .stdout("bar qux\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("sets several variables");

  TestBuilder.command`export FOO && echo "[$FOO]"`
    .stdout("[]\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("name without a value exports an empty string");

  TestBuilder.command`export FOO=first && export FOO=second && echo $FOO`
    .stdout("second\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("later export replaces the value");

  TestBuilder.command`export ZED=1 ALPHA=2 && export`
    .env({ MIDDLE: "m" })
    .stdout(stdout => {
      const lines = stdout.split("\n").filter(line => !line.startsWith("PWD=") && !line.startsWith("OLDPWD="));
      expect(lines).toEqual(["ALPHA=2", "MIDDLE=m", "ZED=1", ""]);
    })
    .stderr("")
    .exitCode(0)
    .runAsTest("no arguments prints the exported variables sorted");

  TestBuilder.command`export FOO=bar && echo $(export)`
    .env({})
    .stdout(stdout => {
      expect(stdout).toContain("FOO=bar");
    })
    .stderr("")
    .exitCode(0)
    .runAsTest("listing works inside a command substitution");
});
