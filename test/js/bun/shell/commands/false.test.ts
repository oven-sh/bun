import { $ } from "bun";
import { describe, test, expect } from "bun:test";
import { TestBuilder } from "../test_builder";

describe("false", async () => {
  TestBuilder.command`false`.exitCode(1).runAsTest("works");

  TestBuilder.command`false 3 5`.exitCode(1).runAsTest("works with arguments");

  TestBuilder.command`false --help`.exitCode(1).runAsTest("works with --help");

  TestBuilder.command`false --version`.exitCode(1).runAsTest("works with --version");
});
