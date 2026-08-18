import { $ } from "bun";
import { describe } from "bun:test";
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
});
