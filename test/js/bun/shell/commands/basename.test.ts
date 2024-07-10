import { $ } from "bun";
import { describe, test, expect } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("basename", async () => {
  TestBuilder.command`basename`.exitCode(1).stdout("").stderr("usage: basename string\n").runAsTest("shows usage");

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

  TestBuilder.command`basename /usr/share/aclocal/pkg.m4 /var/log/bar/file.txt`
    .exitCode(0)
    .stdout("pkg.m4\nfile.txt\n")
    .stderr("")
    .runAsTest("works multiple");

  TestBuilder.command`basename C:/Documents/Newsletters/Summer2018.pdf`
    .exitCode(0)
    .stdout("Summer2018.pdf\n")
    .stderr("")
    .runAsTest("works windows");

  TestBuilder.command`basename /catalog/`.exitCode(0).stdout("catalog\n").stderr("").runAsTest("leading slash");

  TestBuilder.command`basename /catalog`.exitCode(0).stdout("catalog\n").stderr("").runAsTest("at root");

  TestBuilder.command`basename /`.exitCode(0).stdout("/\n").stderr("").runAsTest("root is idempotent");
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
