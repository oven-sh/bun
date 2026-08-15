// completions/bun-cli.json is the parsed --help output of every command, written by
// misctools/generate-cli-completions.ts. It is checked in, so it is only as current as
// its last regeneration: this fails when the --help text of the build under test no
// longer matches the file.
import { crash_handler } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunExe } from "harness";
import { readFileSync } from "node:fs";
import { generateCompletionData, OUTPUT_PATH, parseFlag } from "../../misctools/generate-cli-completions.ts";

// The file documents a canary, which is what `bun bd` and CI build. A release build
// prints different `bun upgrade` examples and has no `bun build --app` debugging flags.
const isCanary = crash_handler.getFeatureData().is_canary;

test.skipIf(!isCanary)(
  "completions/bun-cli.json is up to date (regenerate it with: bun bd misctools/generate-cli-completions.ts)",
  async () => {
    const generated = JSON.stringify(await generateCompletionData(bunExe()), null, 2) + "\n";
    expect(generated).toBe(readFileSync(OUTPUT_PATH, "utf8"));
  },
);

// The build under test only exercises one side of each of these rewrites: a release build
// has no debug flags to drop, and a macOS build already prints the recorded --backend text.
describe("parseFlag canonicalizes help text that differs between builds", () => {
  test("drops flags that only debug builds have", () => {
    expect(
      parseFlag("      --breakpoint-resolve=<val>      DEBUG MODE: breakpoint when resolving a string"),
    ).toBeNull();
    expect(parseFlag("      --verbose-error-trace           DEBUG MODE: dump error return traces")).toBeNull();
    expect(
      parseFlag("      --smol                          Use less memory, but run garbage collection more often"),
    ).toEqual({
      name: "smol",
      description: "Use less memory, but run garbage collection more often",
      hasValue: false,
      required: false,
      multiple: false,
    });
  });

  test("records the --backend description of macOS on every platform", () => {
    const prefix = "Platform-specific optimizations for installing dependencies. ";
    const macos = `${prefix}Possible values: "clonefile" (default), "hardlink", "symlink", "copyfile"`;
    const elsewhere = `${prefix}Possible values: "hardlink" (default), "symlink", "copyfile"`;
    expect(parseFlag(`      --backend=<val>       ${elsewhere}`)?.description).toBe(macos);
    expect(parseFlag(`      --backend=<val>       ${macos}`)?.description).toBe(macos);
  });
});
