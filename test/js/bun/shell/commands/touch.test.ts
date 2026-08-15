import { $ } from "bun";
import { describe, expect } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

$.nothrow();

describe.concurrent("bunshell touch", () => {
  describe("unsupported options are reported under the name they were given", () => {
    // option as typed -> how the error names it (--reference's usage suffix predates this table)
    const unsupported = {
      "--no-create": "--no-create",
      "--date": "--date",
      "--reference": "--reference=FILE",
      "--time": "--time",
      // --date, --reference and --time take a value, which GNU touch also accepts as `--option=VALUE`.
      "--date=@0": "--date",
      "--date=": "--date",
      "--reference=other": "--reference=FILE",
      "--time=atime": "--time",
      "-a": "-a",
      "-c": "-c",
      "-d": "-d",
      "-h": "-h",
      "-m": "-m",
      "-r": "-r",
      "-t": "-t",
    };

    for (const [option, reported] of Object.entries(unsupported)) {
      TestBuilder.command`touch ${option} file`
        .ensureTempDir()
        .quiet()
        .stdout("")
        .stderr(`touch: unsupported option, please open a GitHub issue -- ${reported}\n`)
        .exitCode(1)
        .doesNotExist("file")
        .runAsTest(option);
    }
  });

  describe("options that take no value do not accept one", () => {
    // `--no-create` is a plain flag, so `--no-create=VALUE` is not a spelling of it. Which bytes the
    // illegal option message quotes is up to the shared flag parser, so only the classification is pinned.
    TestBuilder.command`touch --no-create=1 file`
      .ensureTempDir()
      .quiet()
      .stdout("")
      .stderr(stderr => expect(stderr).toStartWith("touch: illegal option -- "))
      .exitCode(1)
      .doesNotExist("file")
      .runAsTest("--no-create=1");
  });
});
