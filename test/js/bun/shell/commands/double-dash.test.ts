// POSIX Utility Syntax Guideline 10: `--` ends option parsing; any following
// arguments are operands even if they begin with `-`.
import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { createTestBuilder } from "../test_builder";
import { sortedShellOutput } from "../util";
const TestBuilder = createTestBuilder(import.meta.path);

$.nothrow();

describe("-- end-of-options delimiter", () => {
  describe("rm", () => {
    TestBuilder.command`touch a; rm -- a`
      .ensureTempDir()
      .stderr("")
      .exitCode(0)
      .doesNotExist("a")
      .runAsTest("rm -- file");

    TestBuilder.command`touch a; rm -v -- a`
      .ensureTempDir()
      .stdout("a\n")
      .stderr("")
      .exitCode(0)
      .doesNotExist("a")
      .runAsTest("rm -v -- file applies flag before --");

    TestBuilder.command`touch ./-f; rm -- -f`
      .ensureTempDir()
      .stderr("")
      .exitCode(0)
      .doesNotExist("-f")
      .runAsTest("rm -- -f treats -f as an operand");

    TestBuilder.command`rm --`
      .ensureTempDir()
      .stderr("usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n")
      .exitCode(1)
      .runAsTest("rm -- with no operands shows usage");
  });

  describe("mv", () => {
    TestBuilder.command`echo hi > a; mv -- a b`
      .ensureTempDir()
      .stderr("")
      .exitCode(0)
      .doesNotExist("a")
      .fileEquals("b", "hi\n")
      .runAsTest("mv -- src dst");

    TestBuilder.command`echo hi > ./-n; mv -- -n out`
      .ensureTempDir()
      .stderr("")
      .exitCode(0)
      .doesNotExist("-n")
      .fileEquals("out", "hi\n")
      .runAsTest("mv -- -n out treats -n as an operand");

    TestBuilder.command`mv -- a`
      .ensureTempDir()
      .stderr("usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n")
      .exitCode(1)
      .runAsTest("mv -- with one operand shows usage");
  });

  describe("mkdir", () => {
    TestBuilder.command`mkdir -- d; ls`.ensureTempDir().stdout("d\n").stderr("").exitCode(0).runAsTest("mkdir -- dir");

    TestBuilder.command`mkdir -p -- a/b; ls a`
      .ensureTempDir()
      .stdout("b\n")
      .stderr("")
      .exitCode(0)
      .runAsTest("mkdir -p -- nested applies flag before --");

    TestBuilder.command`mkdir -- -p; ls`
      .ensureTempDir()
      .stdout("-p\n")
      .stderr("")
      .exitCode(0)
      .runAsTest("mkdir -- -p treats -p as an operand");
  });

  describe("touch", () => {
    TestBuilder.command`touch -- t; ls`.ensureTempDir().stdout("t\n").stderr("").exitCode(0).runAsTest("touch -- file");

    TestBuilder.command`touch -- -a; ls`
      .ensureTempDir()
      .stdout("-a\n")
      .stderr("")
      .exitCode(0)
      .runAsTest("touch -- -a treats -a as an operand");
  });

  describe("ls", () => {
    TestBuilder.command`touch x; ls --`
      .ensureTempDir()
      .stdout("x\n")
      .stderr("")
      .exitCode(0)
      .runAsTest("ls -- with no operands lists cwd");

    TestBuilder.command`touch a b; ls -- a b`
      .ensureTempDir()
      .stdout(str => expect(sortedShellOutput(str)).toEqual(["a", "b"]))
      .stderr("")
      .exitCode(0)
      .runAsTest("ls -- file file");

    TestBuilder.command`touch ./-a; ls -- -a`
      .ensureTempDir()
      .stdout("-a\n")
      .stderr("")
      .exitCode(0)
      .runAsTest("ls -- -a treats -a as an operand");
  });

  describe("seq", () => {
    TestBuilder.command`seq -- 2`.stdout("1\n2\n").stderr("").exitCode(0).runAsTest("seq -- 2");

    TestBuilder.command`seq -s , -- 3`.stdout("1,2,3,").stderr("").exitCode(0).runAsTest("seq -s , -- 3");

    TestBuilder.command`seq --`
      .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
      .exitCode(1)
      .runAsTest("seq -- with no operands shows usage");
  });

  describe("cd", () => {
    TestBuilder.command`mkdir sub; cd -- sub && echo ok`
      .ensureTempDir()
      .stdout("ok\n")
      .stderr("")
      .exitCode(0)
      .runAsTest("cd -- dir");

    TestBuilder.command`mkdir ./-sub; cd -- -sub && echo ok`
      .ensureTempDir()
      .stdout("ok\n")
      .stderr("")
      .exitCode(0)
      .runAsTest("cd -- -sub treats -sub as an operand");

    TestBuilder.command`cd -- && echo ok`.stdout("ok\n").stderr("").exitCode(0).runAsTest("cd -- with no operand");
  });

  describe("basename", () => {
    TestBuilder.command`basename -- /a/b`.stdout("b\n").stderr("").exitCode(0).runAsTest("basename -- path");

    TestBuilder.command`basename -- -name`.stdout("-name\n").stderr("").exitCode(0).runAsTest("basename -- -name");

    TestBuilder.command`basename --`
      .stderr("usage: basename string\n")
      .exitCode(1)
      .runAsTest("basename -- with no operand shows usage");
  });

  describe("dirname", () => {
    TestBuilder.command`dirname -- /a/b`.stdout("/a\n").stderr("").exitCode(0).runAsTest("dirname -- path");

    TestBuilder.command`dirname -- -dir/x`.stdout("-dir\n").stderr("").exitCode(0).runAsTest("dirname -- -dir/x");

    TestBuilder.command`dirname --`
      .stderr("usage: dirname string\n")
      .exitCode(1)
      .runAsTest("dirname -- with no operand shows usage");
  });

  describe("which", () => {
    TestBuilder.command`which -- bun_nope_not_a_thing`
      .stdout(str => {
        expect(str).not.toContain("--");
        expect(str).toContain("bun_nope_not_a_thing not found\n");
      })
      .stderr("")
      .exitCode(1)
      .runAsTest("which -- name does not treat -- as an operand");

    TestBuilder.command`which -- -nope`
      .stdout(str => {
        expect(str).not.toContain("-- not found");
        expect(str).toContain("-nope not found\n");
      })
      .stderr("")
      .exitCode(1)
      .runAsTest("which -- -nope treats -nope as an operand");
  });

  describe("yes", () => {
    test("yes -- outputs 'y'", async () => {
      const buffer = Buffer.alloc(6);
      await $`yes -- > ${buffer}`;
      expect(buffer.toString()).toEqual("y\ny\ny\n");
    });

    test("yes -- -n outputs '-n'", async () => {
      const buffer = Buffer.alloc(6);
      await $`yes -- -n > ${buffer}`;
      expect(buffer.toString()).toEqual("-n\n-n\n");
    });
  });

  describe("pwd", () => {
    TestBuilder.command`pwd --`
      .ensureTempDir()
      .stdout("$TEMP_DIR\n")
      .stderr("")
      .exitCode(0)
      .runAsTest("pwd -- prints cwd");
  });

  describe("exit", () => {
    TestBuilder.command`exit -- 5`.stderr("").exitCode(5).runAsTest("exit -- 5");

    TestBuilder.command`exit --`.stderr("").exitCode(0).runAsTest("exit -- with no operand exits 0");
  });

  describe("export", () => {
    TestBuilder.command`export -- FOO=bar && export --`
      .stdout(str => {
        expect(str).toContain("FOO=bar\n");
        expect(str).not.toContain("--=");
      })
      .stderr("")
      .exitCode(0)
      .runAsTest("export -- name=value skips -- and does not create a var named --");
  });
});
