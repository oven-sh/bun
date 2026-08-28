import { describe } from "bun:test";
import { isWindows } from "harness";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("cd", async () => {
  TestBuilder.command`cd a && ls`
    .ensureTempDir()
    .directory("a")
    .file("a/inside.txt", "")
    .stdout("inside.txt\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("changes the working directory");

  TestBuilder.command`cd a && cd - && ls`
    .ensureTempDir()
    .directory("a")
    .file("a/inside.txt", "")
    .stdout("a\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("cd - returns to the previous directory");

  TestBuilder.command`cd a b`
    .ensureTempDir()
    .directory("a")
    .directory("b")
    .stdout("")
    .stderr("cd: too many arguments\n")
    .exitCode(1)
    .runAsTest("too many arguments");

  TestBuilder.command`cd does-not-exist`
    .ensureTempDir()
    .stdout("")
    .stderr("cd: not a directory: does-not-exist\n")
    .exitCode(1)
    .runAsTest("missing directory");

  TestBuilder.command`cd file.txt`
    .ensureTempDir()
    .file("file.txt", "hi")
    .stdout("")
    .stderr(
      isWindows
        ? stderr => {
            if (!stderr.startsWith("cd: ")) throw new Error(`unexpected stderr: ${stderr}`);
          }
        : "cd: not a directory: file.txt\n",
    )
    .exitCode(1)
    .runAsTest("target is a file");

  TestBuilder.command`cd does-not-exist || echo fallback`
    .ensureTempDir()
    .stdout("fallback\n")
    .stderr("cd: not a directory: does-not-exist\n")
    .exitCode(0)
    .runAsTest("failure runs the || branch");
});
