import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const Builder = createTestBuilder(import.meta.path);

describe("sleep", async () => {
  Builder.command`sleep`.exitCode(1).stdout("").stderr("usage: sleep seconds\n").runAsTest("prints usage");
  Builder.command`sleep -1`
    .exitCode(1)
    .stdout("")
    .stderr("sleep: invalid time interval\n")
    .runAsTest("errors on negative values");
  Builder.command`sleep j`
    .exitCode(1)
    .stdout("")
    .stderr("sleep: invalid time interval\n")
    .runAsTest("errors on non-numeric values");
  Builder.command`sleep 1 j`
    .exitCode(1)
    .stdout("")
    .stderr("sleep: invalid time interval\n")
    .runAsTest("errors on any invalid values");

  Builder.command`sleep 1`.exitCode(0).stdout("").stderr("").duration(1000).runAsTest("sleep works");

  Builder.command`sleep ' 0.5'`.exitCode(0).stdout("").stderr("").duration(500).runAsTest("trims leading spaces");
  Builder.command`sleep '.5 '`
    .exitCode(1)
    .stdout("")
    .stderr("sleep: invalid time interval\n")
    .runAsTest("does not trim trailing spaces");

  Builder.command`sleep .5 .5`
    .exitCode(0)
    .stdout("")
    .stderr("")
    .duration(1000)
    .runAsTest("sleeps for sum of arguments");

  Builder.command`sleep 1s`.exitCode(0).stdout("").stderr("").duration(1000).runAsTest("sleeps for seconds");
  Builder.command`sleep 0.0167m`.exitCode(0).stdout("").stderr("").duration(1000).runAsTest("sleeps for minutes");
  Builder.command`sleep 0.00028h`.exitCode(0).stdout("").stderr("").duration(1000).runAsTest("sleeps for hours");
  Builder.command`sleep 0.0000116d`.exitCode(0).stdout("").stderr("").duration(1000).runAsTest("sleeps for days");
});
