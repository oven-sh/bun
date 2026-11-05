// Where the compiler's own tools are looked for. tools.ts goes by it for the tests, and ../run-parallel.ts, which is no test and has no
// "harness", for the programs that ask the `jsc` shell what compiled code did. The head of tools.ts says what is looked for where.
// CI unpacks the tools for the tests that import this file: ../harness/tests-that-start-tools-of-the-engine.ts. Look for them through it alone.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repository = join(import.meta.dir, "..", "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";

/** `jsc` or `testaot`: beside that Bun, or where this tree builds it. */
export const findTool = (bun: string, name: string) =>
  [dirname(bun), join(repository, "build", "release-local"), join(repository, "build", "release")]
    .map(folder => join(folder, name + suffix))
    .find(existsSync);

/** Whether that Bun is a front end: `bun compile --aot-out=<file>` writes the program. */
export function canWriteProgram(bun: string, env: Record<string, string | undefined>) {
  const folder = mkdtempSync(join(tmpdir(), "aot-front-end-"));
  try {
    writeFileSync(join(folder, "one.ts"), "console.log(1);\n");
    Bun.spawnSync({
      cmd: [bun, "compile", "one.ts", "--no-builtin-modules", "--aot-out=one.bin", "--outfile", "one"],
      cwd: folder,
      env,
      stdout: "ignore",
      stderr: "ignore",
    });
    return existsSync(join(folder, "one.bin"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Why no script of this folder can be started with these, in words for whoever reads the log. `unsupported`: why that Bun has no compiler. */
export const whyNoScriptStarts = (
  bun: string,
  unsupported: string | undefined,
  { jsc, testaot, python, frontEnd }: Record<"jsc" | "testaot" | "python" | "frontEnd", string | null | undefined>,
) =>
  process.platform === "win32"
    ? "the scripts of test/aot/shell are not tried on Windows"
    : unsupported
      ? unsupported
      : !jsc
        ? `there is no jsc shell: not in $JSC, not beside ${bun}, not in build/release-local or build/release`
        : !testaot
          ? `there is no testaot: not in $TESTAOT, not beside ${bun}, not in build/release-local or build/release`
          : !python
            ? "python3 is not installed"
            : !frontEnd
              ? "there is no front end: this Bun does not write the program (bun compile --aot-out=<file>), and $FRONT_END names none"
              : undefined;
