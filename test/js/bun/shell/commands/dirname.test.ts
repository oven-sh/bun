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
