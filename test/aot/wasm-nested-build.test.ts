// A process that runs compiled code finds a WebAssembly module's code in its own image and does not keep the module's function bodies.
// When such a process builds a program that imports the same module, the build needs the bodies all the same.
import { describe, expect } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";

const sources = {
  "program.js": `
import path from "./module.wasm" with { type: "file" };
const e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()))).exports;
console.log("program", e.dense(3), e.machine(1000));
`,
  "builder.js": `
import path from "./module.wasm" with { type: "file" };
const e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()))).exports;
console.log("builder", e.dense(3), e.machine(1000));
export async function buildProgram(outfile) {
  const result = await Bun.build({ entrypoints: [process.cwd() + "/program.js"], compile: { outfile, aot: true, aotExplain: "statistics" }, throw: false });
  const said = result.logs.map(log => String(log.message)).join("\\n");
  console.log("build", result.success ? "succeeds" : "fails", "WasmFunctionsCompiled", /WasmFunctionsCompiled\\D+(\\d+)/.exec(said)?.[1]);
  for (const log of result.logs) if (log.level === "error") console.log(String(log.message));
}
if (import.meta.main) await buildProgram(process.argv[2]);
`,
  "builder.test.js": `
import { test } from "bun:test";
import { buildProgram } from "./builder.js";
test("builds", () => buildProgram(process.env.OUTFILE), 300000);
`,
};

describe.skipIf(!!unsupported)("compile/aot/wasm-nested-build", () => {
  const folder = String(tempDir("aot-wasm-nested-build", sources));
  copyFileSync(
    join(import.meta.dir, "parallel", "webassembly", "branch-tables", "module.wasm"),
    join(folder, "module.wasm"),
  );
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const executableNamed = (name: string) => join(folder, isWindows ? name + ".exe" : name);

  async function expectImageCode(executable: string) {
    const counts = join(folder, "counts-" + Bun.hash(executable).toString(16));
    mkdirSync(counts);
    const ran = await spawned([executable], folder, { ...bunEnv, BUN_JSC_aotCountsPath: join(counts, "%p.txt") });
    expect(ran.stdout).toBe(expected);
    const counted = readdirSync(counts)
      .map(file => readFileSync(join(counts, file), "utf8"))
      .join("");
    expect(/(\d+)\tcounter:WasmInstancesUsingImageCode/.exec(counted)?.[1]).toBe("1");
    expect(/(\d+)\tcounter:WasmInstancesInterpreted/.exec(counted)?.[1]).toBe("0");
  }
  let expected = "";

  test("plain Bun says what the program prints", async () => {
    expected = (await spawned([bunExe(), "--no-install", "./program.js"], folder, bunEnv)).stdout;
    expect(expected).toMatch(/^program -?\d+ -?\d+\n$/);
  }, 120_000);

  test("a test run whose image holds the module builds a program that imports it", async () => {
    await slot(async () => {
      const executable = executableNamed("by-test-run");
      const run = await spawned([bunExe(), "test", "--aot", "./builder.test.js"], folder, {
        ...bunEnv,
        OUTFILE: executable,
      });
      expect(run.stdout + run.stderr).toContain("build succeeds WasmFunctionsCompiled 4");
      expect(run.exitCode).toBe(0);
      await expectImageCode(executable);
    });
  }, 600_000);

  test("an executable whose image holds the module builds a program that imports it", async () => {
    await slot(async () => {
      const builder = executableNamed("builder");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "./builder.js", "--outfile", builder], folder, bunEnv),
      );
      const executable = executableNamed("by-executable");
      const run = await spawned([builder, executable], folder, bunEnv);
      expect(run.stdout).toContain("build succeeds WasmFunctionsCompiled 4");
      expect(run.exitCode).toBe(0);
      await expectImageCode(executable);
    });
  }, 600_000);
});
