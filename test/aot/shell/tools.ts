// What a test needs to start a script of this folder, and where it finds it:
//
//   jsc              $JSC, or `jsc` beside the Bun under test (CI packs the one of the WebKit that Bun was linked with), or
//                    build/release-local/jsc, build/release/jsc. The head of quick.py says how to build it
//   the front end    $SEMA, or the Bun under test: a canary or debug build takes `bun check --aot --aot-out=<file>`. Or
//                    `bun-sema` beside it, or target/release/bun-sema
//   python3
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { unsupported } from "../run-programs";

const repository = join(import.meta.dir, "..", "..", "..");
const besideBun = dirname(bunExe());

function writesTheProgram() {
  using folder = tempDir("aot-front-end", { "one.ts": "console.log(1);\n" });
  Bun.spawnSync({
    cmd: [bunExe(), "check", "one.ts", "--no-builtin-modules", "--aot", "--aot-out=one.bin"],
    cwd: String(folder),
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
  });
  return existsSync(join(String(folder), "one.bin"));
}

export const jsc = process.env.JSC ?? [join(besideBun, "jsc"), join(repository, "build", "release-local", "jsc"), join(repository, "build", "release", "jsc")].find(existsSync);
export const python = Bun.which("python3");
export const sema =
  process.env.SEMA ??
  (!isWindows && !unsupported && jsc && python && writesTheProgram() ? bunExe() : [join(besideBun, "bun-sema"), join(repository, "target", "release", "bun-sema")].find(existsSync));

/** Why no script of this folder can be started here, in words for whoever reads the log. */
export const whyNoScriptRuns = isWindows
  ? "the scripts of test/aot/shell are not tried on Windows"
  : unsupported
    ? unsupported
    : !jsc
      ? `there is no jsc shell: not in $JSC, not beside ${bunExe()}, not in build/release-local or build/release`
      : !python
        ? "python3 is not installed"
        : !sema
          ? "there is no front end: this Bun is a release build, which cannot write the program, and there is no bun-sema in $SEMA, beside it or in target/release"
          : undefined;
