import { $ } from "bun";
import { describe, test, expect } from "bun:test";
import { TestBuilder } from "../test_builder";

$.nothrow();
describe("true", async () => {
  TestBuilder.command`true`.exitCode(0).runAsTest("works");

  TestBuilder.command`true 3 5`.exitCode(0).runAsTest("works with arguments");

  TestBuilder.command`true --help`.exitCode(0).runAsTest("works with --help");

  TestBuilder.command`true --version`.exitCode(0).runAsTest("works with --version");
});
