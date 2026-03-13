import { $ } from "bun";
import { describe } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createTestBuilder } from "./util";

const TestBuilder = createTestBuilder(import.meta.path);
const BUN = bunExe();

$.env(bunEnv);
$.nothrow();

describe("pipeline stack edge cases", () => {
  describe("builtin-to-builtin immediate exit", () => {
    // This was the case that caused the use-after-free crash
    TestBuilder.command`true | true`.exitCode(0).stdout("").runAsTest("true | true - both builtins exit immediately");

    TestBuilder.command`false | false`
      .exitCode(1)
      .stdout("")
      .runAsTest("false | false - both builtins fail immediately");

    TestBuilder.command`true | false`.exitCode(1).stdout("").runAsTest("true | false - mixed success/failure");

    TestBuilder.command`false | true`.exitCode(0).stdout("").runAsTest("false | true - failure then success");

    // Chain of immediately-exiting builtins
    TestBuilder.command`true | true | true | true`.exitCode(0).stdout("").runAsTest("chain of true builtins");

    TestBuilder.command`false | false | false | false`.exitCode(1).stdout("").runAsTest("chain of false builtins");

    TestBuilder.command`true | false | true | false`.exitCode(1).stdout("").runAsTest("alternating true/false chain");
  });

  describe("echo builtin pipes", () => {
    // Echo builtins that output and immediately exit
    TestBuilder.command`echo hello | echo world`.stdout("world\n").runAsTest("echo | echo - second echo ignores stdin");

    TestBuilder.command`echo hello | echo world | echo final`.stdout("final\n").runAsTest("echo | echo | echo - chain");

    TestBuilder.command`echo test | true`.exitCode(0).stdout("").runAsTest("echo | true - output discarded");

    TestBuilder.command`echo test | false`
      .exitCode(1)
      .stdout("")
      .runAsTest("echo | false - output discarded with failure");

    TestBuilder.command`echo one | echo two | true | echo three`
      .stdout("three\n")
      .runAsTest("echo chain with true in middle");
  });

  describe("exit builtin in pipelines", () => {
    TestBuilder.command`exit 0 | echo after`
      .exitCode(0)
      .stdout("after\n")
      .runAsTest("exit 0 | echo - pipeline continues");

    TestBuilder.command`exit 42 | echo after`
      .exitCode(0)
      .stdout("after\n")
      .runAsTest("exit 42 | echo - exit code not propagated through pipe");

    TestBuilder.command`echo before | exit 0`.exitCode(0).stdout("").runAsTest("echo | exit 0");

    TestBuilder.command`echo before | exit 99`
      .exitCode(99)
      .stdout("")
      .runAsTest("echo | exit 99 - last command exit code");

    TestBuilder.command`exit 5 | exit 10 | exit 15`
      .exitCode(15)
      .stdout("")
      .runAsTest("chain of exits - last exit code wins");
  });

  describe("cd builtin in pipelines", () => {
    TestBuilder.command`cd / | pwd`
      .stdout(s => s.includes("$TEMP_DIR"))
      .ensureTempDir()
      .runAsTest("cd | pwd - cd doesn't affect next command in pipeline");

    TestBuilder.command`mkdir foo; mkdir foo/bar; cd foo | cd foo/bar | pwd`
      .stdout(s => s.includes("$TEMP_DIR"))
      .ensureTempDir()
      .runAsTest("cd | cd | pwd - multiple cd's don't affect");

    TestBuilder.command`pwd | cd / | pwd`
      .stdout(s => {
        const lines = s.trim().split("\n");
        return lines.length === 2 && lines[0].includes("$TEMP_DIR") && lines[1].includes("$TEMP_DIR");
      })
      .ensureTempDir()
      .runAsTest("pwd | cd | pwd - cd in middle doesn't affect");
  });

  describe("mixed builtin and subprocess pipelines", () => {
    TestBuilder.command`echo hello | ${BUN} -e 'process.stdin.pipe(process.stdout)'`
      .stdout("hello\n")
      .runAsTest("echo builtin | subprocess");

    TestBuilder.command`${BUN} -e 'console.log("hello")' | echo world`
      .stdout("world\n")
      .runAsTest("subprocess | echo builtin");

    TestBuilder.command`true | ${BUN} -e 'process.exit(0)'`
      .exitCode(0)
      .stdout("")
      .runAsTest("true builtin | subprocess exit 0");

    TestBuilder.command`false | ${BUN} -e 'process.exit(0)'`
      .exitCode(0)
      .stdout("")
      .runAsTest("false builtin | subprocess - subprocess exit code wins");

    TestBuilder.command`echo one | true | ${BUN} -e 'process.stdin.pipe(process.stdout)' | false`
      .exitCode(1)
      .stdout("")
      .runAsTest("mixed chain - last command determines exit");
  });

  describe("pipeline stack depth stress tests", () => {
    // Test that the pipeline stack can handle various depths without overflow
    TestBuilder.command`true | true | true | true | true | true | true | true | true | true`
      .exitCode(0)
      .runAsTest("10 true commands");

    TestBuilder.command`echo 1 | echo 2 | echo 3 | echo 4 | echo 5 | echo 6 | echo 7 | echo 8 | echo 9 | echo 10`
      .stdout("10\n")
      .runAsTest("10 echo commands");

    // Very long chain of mixed builtins
    TestBuilder.command`true | false | true | false | true | false | true | false | true | false | true | false | true | false | true | false | true | false | true | false`
      .exitCode(1)
      .runAsTest("20 alternating true/false");

    // Deep nesting with subshells containing pipelines
    TestBuilder.command`(true | true) | (false | false) | (true | true)`
      .exitCode(0)
      .runAsTest("subshells with internal pipelines");

    TestBuilder.command`(echo a | echo b) | (echo c | echo d) | (echo e | echo f)`
      .stdout("f\n")
      .runAsTest("subshells with echo pipelines");
  });

  describe("pipeline drain edge cases", () => {
    // Test cases where pipelines need to be drained properly
    TestBuilder.command`true | true && echo done`.stdout("done\n").runAsTest("pipeline followed by conditional");

    TestBuilder.command`false | false || echo fallback`
      .stdout("fallback\n")
      .runAsTest("failing pipeline with fallback");

    TestBuilder.command`true | true; echo after`.stdout("after\n").runAsTest("pipeline followed by semicolon");

    TestBuilder.command`(true | true); echo after`.stdout("after\n").runAsTest("subshell pipeline followed by command");

    // Multiple pipelines in sequence
    TestBuilder.command`true | true; false | false; echo done`
      .stdout("done\n")
      .runAsTest("multiple pipelines in sequence");

    TestBuilder.command`echo a | echo b && echo c | echo d && echo e | echo f`
      .stdout("b\nd\nf\n")
      .runAsTest("pipelines connected with &&");

    TestBuilder.command`false | false || echo a | echo b || echo c | echo d`
      .stdout("b\n")
      .runAsTest("pipelines connected with ||");
  });

  describe("pipeline with conditionals", () => {
    TestBuilder.command`if true | true; then echo yes; else echo no; fi`
      .stdout("yes\n")
      .runAsTest("pipeline in if condition");

    TestBuilder.command`if false | false; then echo yes; else echo no; fi`
      .stdout("no\n")
      .runAsTest("failing pipeline in if condition");

    TestBuilder.command`if echo test | true; then echo success; fi`
      .stdout("success\n")
      .runAsTest("echo | true in if condition");

    TestBuilder.command`[[ -n "test" ]] | true && echo ok`.stdout("ok\n").runAsTest("test command in pipeline");

    TestBuilder.command`true | [[ -n "test" ]] && echo ok`.stdout("ok\n").runAsTest("pipeline to test command");
  });

  describe("pipeline memory and cleanup", () => {
    // Rapid pipeline creation and destruction
    TestBuilder.command`true | true; true | true; true | true; true | true; true | true; echo done`
      .stdout("done\n")
      .runAsTest("rapid pipeline creation");
  });

  describe("empty and whitespace builtins", () => {
    TestBuilder.command`echo "" | echo ""`.stdout("\n").runAsTest("empty echo pipes");

    TestBuilder.command`echo "   " | echo "   "`.stdout("   \n").runAsTest("whitespace echo pipes");

    // TestBuilder.command`printf "" | printf ""`.stdout("").runAsTest("empty printf pipes");

    TestBuilder.command`echo | echo | echo`.stdout("\n").runAsTest("echo with no args chain");
  });

  describe("builtin error handling in pipelines", () => {
    TestBuilder.command`cd /nonexistent 2>/dev/null | echo after`.stdout("after\n").runAsTest("cd error | echo");

    TestBuilder.command`which nonexistent_command 2>/dev/null | echo after`
      .stdout("after\n")
      .runAsTest("which (not found) | echo");

    TestBuilder.command`basename | echo after 2>/dev/null`
      .stdout("after\n")
      .stderr("usage: basename string\n")
      .runAsTest("basename (no args) | echo");
  });

  describe("complex pipeline nesting", () => {
    // Test deeply nested pipeline structures
    TestBuilder.command`(true | (true | (true | true)))`.exitCode(0).runAsTest("deeply nested pipeline in subshells");

    TestBuilder.command`((echo a | echo b) | (echo c | echo d)) | echo e`
      .stdout("e\n")
      .runAsTest("nested subshell pipelines");

    TestBuilder.command`echo $(true | true | echo nested) | echo outer`
      .stdout("outer\n")
      .runAsTest("command substitution with pipeline");

    TestBuilder.command`true | $(echo echo) result`.stdout("result\n").runAsTest("command substitution in pipeline");

    // Combination of different nesting types
    TestBuilder.command`(true | false) && (echo a | echo b) || (echo c | echo d)`
      .stdout("d\n")
      .runAsTest("conditional subshell pipelines");
  });

  describe("pipeline with variable assignments", () => {
    TestBuilder.command`VAR=test true | echo $VAR`.stdout("\n").runAsTest("variable assignment with true | echo");

    TestBuilder.command`export VAR=test | echo $VAR`.stdout("\n").runAsTest("export in pipeline");
  });

  describe("seq builtin pipelines", () => {
    TestBuilder.command`seq 1 3 | echo done`.stdout("done\n").runAsTest("seq | echo - echo ignores stdin");

    TestBuilder.command`seq 1 5 | true`.exitCode(0).stdout("").runAsTest("seq | true - output discarded");

    TestBuilder.command`seq 1 2 | seq 3 4`.stdout("3\n4\n").runAsTest("seq | seq - second seq ignores stdin");
  });

  describe("yes builtin pipelines", () => {
    TestBuilder.command`yes | head -n 1`.stdout("y\n").runAsTest("yes | head -n 1");

    TestBuilder.command`yes no | head -n 2`.stdout("no\nno\n").runAsTest("yes with arg | head");

    TestBuilder.command`yes | true`.exitCode(0).stdout("").runAsTest("yes | true - yes terminates on EPIPE");

    TestBuilder.command`yes | false`.exitCode(1).stdout("").runAsTest("yes | false");
  });
});
