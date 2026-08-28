import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { createTestBuilder } from "./test_builder";

const TestBuilder = createTestBuilder(import.meta.path);

// Other shell test files switch the shared `$` to nothrow mode; the ShellError tests below need the default.
$.throws(true);

describe.concurrent("TestBuilder", () => {
  describe("an expectation can only be set once per builder", () => {
    test("stdout", () => {
      expect(() => TestBuilder.command`echo hi`.stdout("hi\n").stdout("hi\n")).toThrow(
        "the stdout expectation was set more than once",
      );
    });

    test("stderr", () => {
      expect(() => TestBuilder.command`echo hi`.stderr("").stderr_contains("")).toThrow(
        "the stderr expectation was set more than once",
      );
    });

    test("exitCode", () => {
      expect(() => TestBuilder.command`echo hi`.exitCode(0).exitCode(0)).toThrow(
        "the exitCode expectation was set more than once",
      );
    });

    test("error", () => {
      expect(() => TestBuilder.command`echo hi`.error("a").error("b")).toThrow(
        "the error expectation was set more than once",
      );
    });

    test("different expectations on one builder are fine", async () => {
      await TestBuilder.command`echo hi`.stdout("hi\n").stderr("").exitCode(0).run();
    });
  });

  describe("expectation callbacks", () => {
    test("assert by calling expect()", async () => {
      await TestBuilder.command`echo hi`
        .stdout(s => expect(s).toBe("hi\n"))
        .stderr(s => {
          expect(s).toBe("");
        })
        .exitCode(c => expect(c).toBe(0))
        .run();
    });

    test("a failing expect() in a callback fails the run", async () => {
      await expect(TestBuilder.command`echo hi`.stdout(s => expect(s).toBe("bye\n")).run()).rejects.toThrow();
    });

    test("stdout callback must not return a value", async () => {
      await expect(TestBuilder.command`echo hi`.stdout(s => s.includes("hi")).run()).rejects.toThrow(
        "the .stdout() callback returned a boolean",
      );
    });

    test("stderr callback must not return a value", async () => {
      await expect(TestBuilder.command`true`.stderr(s => s.length).run()).rejects.toThrow(
        "the .stderr() callback returned a number",
      );
    });

    test("exitCode callback must not return a value", async () => {
      await expect(TestBuilder.command`true`.exitCode(c => c === 0).run()).rejects.toThrow(
        "the .exitCode() callback returned a boolean",
      );
    });
  });

  describe("error()", () => {
    test("passes when the command throws the expected error", async () => {
      await TestBuilder.command`echo hi |`.error("Unexpected EOF").run();
    });

    test("fails when the command does not throw", async () => {
      await expect(TestBuilder.command`echo hi`.error("Unexpected EOF").run()).rejects.toThrow(
        "expected the command to throw, but it completed with exit code 0",
      );
    });
  });

  describe("when the command rejects with a ShellError", () => {
    test("the expectations are checked against its output", async () => {
      await TestBuilder.command`echo out; ls does-not-exist`
        .stdout("out\n")
        .stderr("ls: does-not-exist: No such file or directory\n")
        .exitCode(1)
        .run();
    });

    test("a failing expectation fails the run", async () => {
      await expect(
        TestBuilder.command`echo out; ls does-not-exist`
          .stdout("something else\n")
          .stderr_contains("No such file or directory")
          .exitCode(1)
          .run(),
      ).rejects.toThrow();
    });
  });
});
