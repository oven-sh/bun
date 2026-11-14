import { expect } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { delimiter, join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const main = `
  import { writeFileSync } from "node:fs";
  if (process.argv[2]) writeFileSync(process.argv[2], "ran");
  console.log("hello");
`;
const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const started = { stdout: "hello\n", stderr: "", exitCode: 0 };

async function build(directory: string, ...flags: string[]) {
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "./main.ts", "--outfile", executable],
    directory,
  );
  expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return executable;
}

test.skipIf(isWindows)(
  "an executable starts through a symbolic link, by a relative path and by a search of PATH",
  async () => {
    using dir = tempDir("aot-ways-to-start", { "main.ts": main });
    const directory = String(dir);
    const executable = await build(directory);
    const elsewhere = join(directory, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync("../program", join(elsewhere, "relative-link"));
    symlinkSync(executable, join(elsewhere, "absolute-link"));
    const ways: [string, string[], typeof env?][] = [
      ["a link to a relative path", [join(elsewhere, "relative-link")]],
      ["a link to an absolute path", [join(elsewhere, "absolute-link")]],
      ["a link, by a relative path", ["sh", "-c", "exec ./relative-link"]],
      ["a relative path", ["sh", "-c", "exec ../program"]],
      ["a search of PATH", ["sh", "-c", "exec program"], { ...env, PATH: directory + delimiter + env.PATH }],
    ];
    for (const [way, cmd, itsEnv = env] of ways) {
      expect({ way, ...(await run(cmd, elsewhere, itsEnv)) }).toEqual({ way, ...started });
    }
  },
  120_000,
);

test.skipIf(!isMacOS || !Bun.which("codesign"))(
  "an executable that codesign has signed anew starts",
  async () => {
    using dir = tempDir("aot-signed-anew", { "main.ts": main });
    const executable = await build(String(dir));
    expect((await run(["codesign", "--force", "--sign", "-", executable])).exitCode).toBe(0);
    expect(await run([executable], String(dir), env)).toEqual(started);
  },
  120_000,
);

test.skipIf(!isWindows)(
  "an executable with an icon starts",
  async () => {
    using dir = tempDir("aot-with-an-icon", {
      "main.ts": main,
      "icon.ico": Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0x68, 1, 0, 0, 0x16, 0, 0, 0]),
    });
    const executable = await build(String(dir), "--windows-icon", join(String(dir), "icon.ico"));
    expect(await run([executable], String(dir), env)).toEqual(started);
  },
  120_000,
);

test.skipIf(!isWindows)(
  "an executable without a console starts",
  async () => {
    using dir = tempDir("aot-without-a-console", { "main.ts": main });
    const executable = await build(String(dir), "--windows-hide-console");
    const marker = join(String(dir), "marker.txt");
    expect((await run([executable, marker], String(dir), env)).exitCode).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran");
  },
  120_000,
);
