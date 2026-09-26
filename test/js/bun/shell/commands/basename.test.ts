import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("basename", async () => {
  TestBuilder.command`basename`
    .exitCode(1)
    .stdout("")
    .stderr("usage: basename string [suffix]\n")
    .runAsTest("shows usage");

  TestBuilder.command`basename js/bun/shell/commands/basename.test.ts`
    .exitCode(0)
    .stdout("basename.test.ts\n")
    .stderr("")
    .runAsTest("works relative");

  TestBuilder.command`basename /home/tux/example.txt`
    .exitCode(0)
    .stdout("example.txt\n")
    .stderr("")
    .runAsTest("works absolute");

  TestBuilder.command`basename C:/Documents/Newsletters/Summer2018.pdf`
    .exitCode(0)
    .stdout("Summer2018.pdf\n")
    .stderr("")
    .runAsTest("works windows");

  TestBuilder.command`basename /catalog/`.exitCode(0).stdout("catalog\n").stderr("").runAsTest("leading slash");

  TestBuilder.command`basename /catalog`.exitCode(0).stdout("catalog\n").stderr("").runAsTest("at root");

  TestBuilder.command`basename /`.exitCode(0).stdout("/\n").stderr("").runAsTest("root is idempotent");

  // POSIX: `basename string [suffix]`. The second operand is a suffix to
  // strip, not a second name.
  TestBuilder.command`basename /home/tux/example.txt .txt`
    .exitCode(0)
    .stdout("example\n")
    .stderr("")
    .runAsTest("strips suffix");

  TestBuilder.command`basename a.txt/ .txt`
    .exitCode(0)
    .stdout("a\n")
    .stderr("")
    .runAsTest("strips suffix after trailing slash");

  TestBuilder.command`basename foo.txt txt`.exitCode(0).stdout("foo.\n").stderr("").runAsTest("suffix without a dot");

  TestBuilder.command`basename /a/b/.txt .txt`
    .exitCode(0)
    .stdout(".txt\n")
    .stderr("")
    .runAsTest("suffix identical to the name is not stripped");

  TestBuilder.command`basename /home/tux/example.txt .md`
    .exitCode(0)
    .stdout("example.txt\n")
    .stderr("")
    .runAsTest("non-matching suffix is not stripped");

  TestBuilder.command`basename /usr/share/aclocal/pkg.m4 /var/log/bar/file.txt`
    .exitCode(0)
    .stdout("pkg.m4\n")
    .stderr("")
    .runAsTest("second operand is a suffix, not a second name");

  TestBuilder.command`basename a b c`
    .exitCode(1)
    .stdout("")
    .stderr("usage: basename string [suffix]\n")
    .runAsTest("extra operand is an error");
});

describe("basename without stdout", async () => {
  TestBuilder.command`echo $(basename js/bun/shell/commands/basename.test.ts)`
    .exitCode(0)
    .stdout("basename.test.ts\n")
    .stderr("")
    .runAsTest("works relative without stdout");

  TestBuilder.command`echo $(basename /home/tux/example.txt)`
    .exitCode(0)
    .stdout("example.txt\n")
    .stderr("")
    .runAsTest("works absolute without stdout");
});
