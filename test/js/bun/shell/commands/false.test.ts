import { $ } from "bun";
import { describe, test, expect } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("false", async () => {
  TestBuilder.command`false`.exitCode(1).runAsTest("works");

  TestBuilder.command`false 3 5`.exitCode(1).runAsTest("works with arguments");

  TestBuilder.command`false --help`.exitCode(1).runAsTest("works with --help");

  TestBuilder.command`false --version`.exitCode(1).runAsTest("works with --version");
});
