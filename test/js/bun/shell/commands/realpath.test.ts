import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("realpath", async () => {
  TestBuilder.command`realpath .`
    .exitCode(0)
    .stdout((stdout) => {
      // Should output an absolute path ending with newline
      const trimmed = stdout.trim();
      if (trimmed.length === 0) throw new Error("Expected non-empty output");
      if (process.platform === "win32") {
        // Windows absolute paths start with a drive letter
        if (!/^[A-Za-z]:/.test(trimmed)) throw new Error("Expected absolute path on Windows");
      } else {
        if (!trimmed.startsWith("/")) throw new Error("Expected absolute path");
      }
    })
    .stderr("")
    .runAsTest("resolves current directory");

  TestBuilder.command`realpath`
    .exitCode(1)
    .stdout("")
    .runAsTest("shows usage with no args");

  TestBuilder.command`realpath /nonexistent_path_12345`
    .exitCode(1)
    .stdout("")
    .runAsTest("errors on nonexistent path");
});

describe("realpath without stdout", async () => {
  TestBuilder.command`echo $(realpath .)`
    .exitCode(0)
    .stdout((stdout) => {
      const trimmed = stdout.trim();
      if (trimmed.length === 0) throw new Error("Expected non-empty output");
    })
    .stderr("")
    .runAsTest("realpath in command substitution");
});
