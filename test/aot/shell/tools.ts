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
import { bunEnv, bunExe, isCI, isWindows } from "harness";
import { dirname, join } from "path";
import { declare } from "../harness/capabilities";
import { unsupported } from "../harness/commands";
import { canWriteProgram, findTool, whyNoScriptStarts } from "./find-tools";

const repository = join(import.meta.dir, "..", "..", "..");
const bunDirectory = dirname(bunExe());

export const jsc = process.env.JSC ?? findTool(bunExe(), "jsc");
export const testaot = process.env.TESTAOT ?? findTool(bunExe(), "testaot");
// CI packs both wherever Bun has the compiler, and unpacks them in a shard that has one of the tests that start them.
if (isCI && !isWindows && !unsupported && !(jsc && testaot))
  throw new Error(
    `There is no jsc or no testaot beside ${bunExe()}: does ../harness/tests-that-start-tools-of-the-engine.ts see how ${Bun.main} imports this file?`,
  );
export const python = Bun.which("python3");
export const frontEnd =
  process.env.FRONT_END ??
  (!isWindows && !unsupported && jsc && testaot && python && canWriteProgram(bunExe(), bunEnv) ? bunExe() : undefined);
export const engineTests =
  process.env.AOT_ENGINE_TESTS ??
  [
    join(bunDirectory, "aot-tests"),
    ...[process.env.BUN_WEBKIT_PATH, join(repository, "vendor", "WebKit")]
      .filter(path => path !== undefined)
      .map(path => join(path, "Source", "JavaScriptCore", "aot", "tests")),
  ].find(existsSync);

/** For testaot and jsc, which exit without destroying their VM: LeakSanitizer would report that. The rule of shell_environment in toolchain.py. */
export const toolEnv = bunEnv.ASAN_OPTIONS
  ? { ...bunEnv, ASAN_OPTIONS: `${bunEnv.ASAN_OPTIONS}:detect_leaks=0` }
  : bunEnv;

/** Why no script of this folder can be started here, in words for whoever reads the log. */
export const scriptSkipReason = whyNoScriptStarts(bunExe(), unsupported, { jsc, testaot, python, frontEnd });

/** What toolchain.py reads. Call it only where scriptSkipReason is undefined. */
export function scriptEnvironment(): Record<string, string | undefined> {
  return { ...bunEnv, JSC: jsc, TESTAOT: testaot, FRONT_END: frontEnd, PLAIN: bunExe() };
}

declare("jsc", () =>
  jsc
    ? undefined
    : "there is no jsc: not in $JSC, not beside the Bun under test, not in build/release-local or build/release",
);
declare("the scripts of the shell", () => scriptSkipReason);
