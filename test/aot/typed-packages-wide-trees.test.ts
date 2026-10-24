// The full types of public packages under packages/full-types (react-dom, react-reconciler, seroval ..) are compiled
// into large programs and compared with the original packages: packages/full-types/run.py, whose top says what it checks. Beside the
// answers it checks that a typed package is still compiled as typed: a change in the compiler can make one fall back to untyped
// code with every answer right, and nothing else notices.
//
//   AOT_TYPED_PACKAGES=<node_modules> SEMA=<bun-sema> bun test test/aot/typed-packages-wide-trees
//
// It needs a node_modules folder in which npm has installed the packages (each tree whose packages are missing is skipped),
// `bun-sema`, the checker's CLI (BUN_CODEGEN_DIR=$PWD/build/release-local/codegen cargo build --release -p bun_sema_standalone),
// and python3. Without them it is skipped.
import { expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";
import { unsupported } from "./run-programs";
import { python } from "./shell/tools";

const modules = process.env.AOT_TYPED_PACKAGES;
const sema = process.env.SEMA;
const missing =
  unsupported ||
  (!modules && "AOT_TYPED_PACKAGES is not set") ||
  (!sema && "SEMA is not set") ||
  (!python && "python3 is not installed");

if (missing && !unsupported) console.error(`SKIPPED: test/aot/typed-packages-wide-trees.test.ts: ${missing}`);
if (missing) test.skip(missing, () => {});
else {
  test("the typed packages answer as the untouched ones and are compiled as typed", async () => {
    const out = join(String(tempDir("aot-typed-packages", {})), "out");
    const typescript =
      process.env.BUN_SEMA_TS_LIB ?? dirname(Bun.resolveSync("typescript/lib/lib.d.ts", import.meta.dir));
    try {
      for (const step of ["build", "answers"]) {
        await using run = Bun.spawn({
          cmd: [
            python!,
            "-B",
            join(import.meta.dir, "..", "..", "packages", "full-types", "run.py"),
            step,
            bunExe(),
            modules!,
            out,
          ],
          env: { ...bunEnv, SEMA: sema, BUN: bunExe(), BUN_SEMA_TS_LIB: typescript },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
        expect({
          step,
          failures: stdout.split("\n").filter(line => line.startsWith("FAIL")),
          stderr: exitCode ? stderr.slice(-2000) : "",
          exitCode,
        }).toEqual({ step, failures: [], stderr: "", exitCode: 0 });
      }
    } finally {
      rmSync(dirname(out), { recursive: true, force: true });
    }
  }, 1_800_000);
}
