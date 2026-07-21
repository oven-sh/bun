import { $ } from "bun";
import { describe, expect } from "bun:test";
import { join } from "path";
import { createTestBuilder } from "../test_builder";
import { sortedShellOutput } from "../util";
const TestBuilder = createTestBuilder(import.meta.path);

$.nothrow();

describe("mv", async () => {
  TestBuilder.command`echo foo > a; mv a b`.ensureTempDir().fileEquals("b", "foo\n").runAsTest("move file -> file");

  TestBuilder.command`touch a; mkdir foo; mv a foo; ls foo`
    .ensureTempDir()
    .stdout("a\n")
    .doesNotExist("a")
    .runAsTest("move single file into a directory");

  TestBuilder.command`mkdir d; mv a b c d/; ls d/`
    .stdout(str => expect(sortedShellOutput(str)).toEqual(["a", "b", "c"]))
    .ensureTempDir()
    .file("a", "file")
    .file("b", "file")
    .file("c", "file")
    .doesNotExist("a")
    .doesNotExist("b")
    .doesNotExist("c")
    .runAsTest("move multiple files into a directory");

  TestBuilder.command`mv file1.txt file2.txt does_not_exist/`
    .exitCode(1)
    .stderr("mv: does_not_exist/: No such file or directory\n")
    .ensureTempDir()
    .file("file1.txt", "hi")
    .file("file1.txt", "hello")
    .runAsTest("fails if destination folder does not exist");

  TestBuilder.command`mkdir -p foo; mkdir -p bar; echo hi > foo/inside_foo; echo hi > bar/inside_bar; mv foo bar; ls -R bar`
    .ensureTempDir()
    .stdout(str =>
      expect(sortedShellOutput(str)).toEqual(
        sortedShellOutput(["inside_bar", "foo", join("bar", "foo") + ":", "inside_foo"]),
      ),
    )
    .runAsTest("move dir -> dir");

  TestBuilder.command`touch a; mkdir -p foo; mv foo/ a`
    .ensureTempDir()
    .exitCode(20 /* ENOTDIR */)
    .stderr("mv: a: Not a directory\n")
    .runAsTest("move dir -> file fails");

  describe("-n (no-clobber)", () => {
    TestBuilder.command`mv -n src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .file("dst", "OLD\n")
      .exitCode(0)
      .stderr("")
      .fileEquals("dst", "OLD\n")
      .fileEquals("src", "NEW\n")
      .runAsTest("does not overwrite an existing file");

    TestBuilder.command`mv -n src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .exitCode(0)
      .fileEquals("dst", "NEW\n")
      .doesNotExist("src")
      .runAsTest("moves when destination does not exist");

    TestBuilder.command`mkdir d; echo OLD > d/src; mv -n src d/`
      .ensureTempDir()
      .file("src", "NEW\n")
      .exitCode(0)
      .fileEquals("d/src", "OLD\n")
      .fileEquals("src", "NEW\n")
      .runAsTest("does not overwrite an existing file in a directory");

    TestBuilder.command`mkdir d; echo OLD > d/a; mv -n a b d/; ls d`
      .ensureTempDir()
      .file("a", "NEW\n")
      .file("b", "B\n")
      .exitCode(0)
      .stdout(str => expect(sortedShellOutput(str)).toEqual(["a", "b"]))
      .fileEquals("d/a", "OLD\n")
      .fileEquals("d/b", "B\n")
      .fileEquals("a", "NEW\n")
      .doesNotExist("b")
      .runAsTest("skips existing but moves the rest into a directory");

    TestBuilder.command`mv -f -n src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .file("dst", "OLD\n")
      .exitCode(0)
      .fileEquals("dst", "OLD\n")
      .fileEquals("src", "NEW\n")
      .runAsTest("-f -n: last option wins (-n)");

    TestBuilder.command`mv -n -f src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .file("dst", "OLD\n")
      .exitCode(0)
      .fileEquals("dst", "NEW\n")
      .doesNotExist("src")
      .runAsTest("-n -f: last option wins (-f)");
  });

  describe("-i (interactive)", () => {
    TestBuilder.command`mv -i src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .file("dst", "OLD\n")
      .exitCode(0)
      .fileEquals("dst", "OLD\n")
      .fileEquals("src", "NEW\n")
      .runAsTest("does not overwrite without affirmative input");

    TestBuilder.command`mv -i src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .exitCode(0)
      .fileEquals("dst", "NEW\n")
      .doesNotExist("src")
      .runAsTest("moves when destination does not exist");
  });
});
