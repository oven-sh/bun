import { describe } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("dirname", async () => {
  TestBuilder.command`dirname`.exitCode(1).stdout("").stderr("usage: dirname string\n").runAsTest("shows usage");

  TestBuilder.command`dirname js/bun/shell/commands/dirname.test.ts`
    .exitCode(0)
    .stdout("js/bun/shell/commands\n")
    .stderr("")
    .runAsTest("works relative");

  TestBuilder.command`dirname /home/tux/example.txt`
    .exitCode(0)
    .stdout("/home/tux\n")
    .stderr("")
    .runAsTest("works absolute");

  TestBuilder.command`dirname /usr/share/aclocal/pkg.m4 /var/log/bar/file.txt`
    .exitCode(0)
    .stdout("/usr/share/aclocal\n/var/log/bar\n")
    .stderr("")
    .runAsTest("works multiple");

  TestBuilder.command`dirname C:/Documents/Newsletters/Summer2018.pdf`
    .exitCode(0)
    .stdout("C:/Documents/Newsletters\n")
    .stderr("")
    .runAsTest("works windows");

  TestBuilder.command`dirname /catalog/`.exitCode(0).stdout("/\n").stderr("").runAsTest("leading slash");

  TestBuilder.command`dirname /catalog`.exitCode(0).stdout("/\n").stderr("").runAsTest("at root");

  TestBuilder.command`dirname /`.exitCode(0).stdout("/\n").stderr("").runAsTest("root is idempotent");

  TestBuilder.command`dirname //`.exitCode(0).stdout("/\n").stderr("").runAsTest("only slashes");

  TestBuilder.command`dirname //a`.exitCode(0).stdout("/\n").stderr("").runAsTest("repeated leading slashes");

  TestBuilder.command`dirname a`.exitCode(0).stdout(".\n").stderr("").runAsTest("no slash");

  TestBuilder.command`dirname a/`.exitCode(0).stdout(".\n").stderr("").runAsTest("no slash before trailing slash");

  TestBuilder.command`dirname ""`.exitCode(0).stdout(".\n").stderr("").runAsTest("empty string");

  TestBuilder.command`dirname . .. ./a ../a ./`
    .exitCode(0)
    .stdout(".\n.\n.\n..\n.\n")
    .stderr("")
    .runAsTest("dot components");

  // POSIX dirname step 7: strip every trailing slash of the remaining prefix (issue #48111).
  TestBuilder.command`dirname a//b /a//b a///b a//b/ a//b// ///a///b///`
    .exitCode(0)
    .stdout("a\n/a\na\na\na\n///a\n")
    .stderr("")
    .runAsTest("strips the run of slashes before the last component");
});

describe("dirname without stdout", async () => {
  TestBuilder.command`echo $(dirname js/bun/shell/commands/dirname.test.ts)`
    .exitCode(0)
    .stdout("js/bun/shell/commands\n")
    .stderr("")
    .runAsTest("works relative without stdout");

  TestBuilder.command`echo $(dirname /home/tux/example.txt)`
    .exitCode(0)
    .stdout("/home/tux\n")
    .stderr("")
    .runAsTest("works absolute without stdout");
});
