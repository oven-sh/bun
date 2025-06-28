import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("true", async () => {
  TestBuilder.command`true`.exitCode(0).runAsTest("works");

  TestBuilder.command`true 3 5`.exitCode(0).runAsTest("works with arguments");

  TestBuilder.command`true --help`.exitCode(0).runAsTest("works with --help");

  TestBuilder.command`true --version`.exitCode(0).runAsTest("works with --version");
});
