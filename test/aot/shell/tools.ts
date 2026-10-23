// The compiler's own tools that a test needs, and where each is looked for, in order. The head of toolchain.py says how to
// build them.
//
//   jsc             $JSC, or `jsc` beside the Bun under test (CI packs the one built from the WebKit that Bun was linked with),
//                   or in build/release-local, or in build/release
//   testaot         $TESTAOT, or `testaot` in the same three folders
//   front end       $FRONT_END, or the Bun under test if `bun compile --aot-out=<file>` writes the program
//   engine tests    the folder of the engine's IR text tests: $AOT_ENGINE_TESTS, or `aot-tests` beside the Bun under test, or
//                   Source/JavaScriptCore/aot/tests in $BUN_WEBKIT_PATH, or in vendor/WebKit. No script in this folder needs it
//   python3         on $PATH
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { unsupported } from "../run-programs";

const repository = join(import.meta.dir, "..", "..", "..");
const bunDirectory = dirname(bunExe());
const suffix = isWindows ? ".exe" : "";

const findTool = (name: string) =>
  [bunDirectory, join(repository, "build", "release-local"), join(repository, "build", "release")].map(folder => join(folder, name + suffix)).find(existsSync);

function canWriteProgram() {
  using folder = tempDir("aot-front-end", { "one.ts": "console.log(1);\n" });
  Bun.spawnSync({
    cmd: [bunExe(), "compile", "one.ts", "--no-builtin-modules", "--aot-out=one.bin", "--outfile", "one"],
    cwd: String(folder),
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
  });
  return existsSync(join(String(folder), "one.bin"));
}

export const jsc = process.env.JSC ?? findTool("jsc");
export const testaot = process.env.TESTAOT ?? findTool("testaot");
export const python = Bun.which("python3");
export const frontEnd =
  process.env.FRONT_END ??
  (!isWindows && !unsupported && jsc && testaot && python && canWriteProgram() ? bunExe() : undefined);
export const engineTests =
  process.env.AOT_ENGINE_TESTS ??
  [
    join(bunDirectory, "aot-tests"),
    ...[process.env.BUN_WEBKIT_PATH, join(repository, "vendor", "WebKit")].filter(path => path !== undefined).map(path => join(path, "Source", "JavaScriptCore", "aot", "tests")),
  ].find(existsSync);

/** For testaot and jsc, which exit without destroying their VM: LeakSanitizer would report that. The rule of shell_environment in toolchain.py. */
export const toolEnv = bunEnv.ASAN_OPTIONS ? { ...bunEnv, ASAN_OPTIONS: `${bunEnv.ASAN_OPTIONS}:detect_leaks=0` } : bunEnv;

/** Why no script of this folder can be started here, in words for whoever reads the log. */
export const scriptSkipReason = isWindows
  ? "the scripts of test/aot/shell are not tried on Windows"
  : unsupported
    ? unsupported
    : !jsc
      ? `there is no jsc shell: not in $JSC, not beside ${bunExe()}, not in build/release-local or build/release`
      : !testaot
        ? `there is no testaot: not in $TESTAOT, not beside ${bunExe()}, not in build/release-local or build/release`
        : !python
          ? "python3 is not installed"
          : !frontEnd
            ? "there is no front end: this Bun does not write the program (bun compile --aot-out=<file>), and $FRONT_END names none"
            : undefined;

/** What toolchain.py reads. Call it only where scriptSkipReason is undefined. */
export function scriptEnvironment(): Record<string, string | undefined> {
  return { ...bunEnv, JSC: jsc, TESTAOT: testaot, FRONT_END: frontEnd, PLAIN: bunExe() };
}
