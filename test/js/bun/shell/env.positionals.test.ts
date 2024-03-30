import { $ } from "bun";
import { describe, test, expect } from "bun:test";
import { TestBuilder } from "./test_builder";

describe("$ argv", async () => {
  for (let i = 0; i < process.argv.length; i++) {
    const element = process.argv[i];
    TestBuilder.command`echo $${i}`
      .exitCode(0)
      .stdout(process.argv[i] + "\n")
      .runAsTest(`$${i} should equal process.argv[${i}]`);
  }
});
