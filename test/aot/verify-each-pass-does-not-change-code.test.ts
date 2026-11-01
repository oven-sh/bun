import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

// #parseAST of internal:fs/glob holds allocations that SinkAllocations gives up on in one round and could sink in a later one.
const main = `import { globSync } from "node:fs";
console.log(globSync("*.nothing").length);
`;

function imageOf(executable: Buffer) {
  const magic = Buffer.from("BUNAOT01", "latin1");
  for (let at = executable.indexOf(magic); at >= 0; at = executable.indexOf(magic, at + 1)) {
    if (at + 56 > executable.length) break;
    const size = Number(executable.readBigUInt64LE(at + 32));
    const codeOffset = Number(executable.readBigUInt64LE(at + 40));
    const codeSize = Number(executable.readBigUInt64LE(at + 48));
    if (codeSize > 0 && codeOffset + codeSize <= size && at + size <= executable.length)
      return executable.subarray(at, at + size);
  }
  throw new Error("the executable holds no image of compiled code");
}

test("--aot-check=verify-each-pass generates the image of a build without it", async () => {
  using dir = tempDir("aot-verify-each-pass-same-code", { "main.mjs": main });
  const cwd = String(dir);
  const build = async (folder: string, flags: string[]) => {
    const executable = join(cwd, folder, isWindows ? "main.exe" : "main");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./main.mjs", "--outfile", executable],
      cwd,
      bunEnv,
    );
    expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
      output: "",
      exitCode: 0,
    });
    expect((await run([executable], cwd)).stdout).toBe("0\n");
    return imageOf(readFileSync(executable));
  };
  const [expected, image] = [await build("plain", []), await build("verified", ["--aot-check=verify-each-pass"])];
  let differingBytes = Math.abs(expected.length - image.length);
  for (let at = 0; at < Math.min(expected.length, image.length); at++)
    differingBytes += Number(expected[at] !== image[at]);
  expect({ differingBytes, size: image.length }).toEqual({ differingBytes: 0, size: expected.length });
}, 240_000);

for (const check of ["verify-each-stage", "verify-each-pass"]) {
  test(`--aot-check=${check} takes the steps of the Select stage of a build without it`, async () => {
    using dir = tempDir("aot-verifying-flag-same-select-steps", { "main.mjs": "console.log(1);\n" });
    const cwd = String(dir);
    const stepsOf = async (flags: string[]) => {
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", ...flags, "./main.mjs", "--outfile", join(cwd, "main")],
        cwd,
        { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" },
      );
      expect(built.exitCode).toBe(0);
      return [...(built.stdout + built.stderr).matchAll(/^AOT phase times: Select \| ([^|]+) \|/gm)]
        .map(match => match[1])
        .filter(step => step !== "VerifyProgram");
    };
    const expected = await stepsOf([]);
    expect(expected).toContain("Select");
    expect(await stepsOf([`--aot-check=${check}`])).toEqual(expected);
  }, 240_000);
}
