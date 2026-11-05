import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { unsupported } from "../../aot/harness/commands";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const files = {
  "wrong.ts": `export const port: number = "3000";\n`,
  "build.ts": `const result = await Bun.build({
  entrypoints: ["./wrong.ts"],
  target: "bun",
  check: process.argv[2] === "check",
  compile: { outfile: "./wrong", aot: true },
  throw: false,
});
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
`,
};

async function built(...command: string[]) {
  using dir = tempDir("compile-with-check", files);
  await using proc = spawn({
    timeout: longLimit,
    cmd: [bunExe(), ...command],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    errors: (stdout + stderr).match(/\bTS\d+: .*/g),
    exitCode,
    hasExecutable: existsSync(join(String(dir), isWindows ? "wrong.exe" : "wrong")),
  };
}

const stopped = {
  errors: ["TS2322: Type 'string' is not assignable to type 'number'."],
  exitCode: 1,
  hasExecutable: false,
};

// A compile never hands its files to the bundler, where `--check` is otherwise looked at.
describe.skipIf(!!unsupported)("a compile that is asked to check the types stops at a type error", () => {
  test.concurrent.each([
    ["bun compile", ["compile", "./wrong.ts", "--outfile", "wrong"], "--check"],
    ["bun build --compile --aot", ["build", "--compile", "--aot", "./wrong.ts", "--outfile", "wrong"], "--check"],
    ["Bun.build", ["run", "./build.ts"], "check"],
  ])(
    "%s",
    async (_, command, flag) => {
      expect(await built(...command, flag)).toEqual(stopped);
      expect(await built(...command)).toEqual({ errors: null, exitCode: 0, hasExecutable: true });
    },
    2 * longLimit,
  );
});
