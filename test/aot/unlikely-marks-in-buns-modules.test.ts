import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = { "main.mjs": readFileSync(join(import.meta.dir, "unlikely-marks-in-buns-modules.fixture.mjs"), "utf8") };

async function build(dir: string, name: string, flags: string[]) {
  const executable = join(dir, name + (isWindows ? ".exe" : ""));
  const map = join(dir, name + ".map");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "main.mjs", "--outfile", executable],
    dir,
    { ...bunEnv, BUN_JSC_aotMapFilePath: map },
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const unlikelyInBunsModules = readFileSync(map, "utf8")
    .split("\n")
    .filter(
      line => line.startsWith("W\t") && line.endsWith("\tUnlikely") && /^W\t(node:|internal\/)/.test(line),
    ).length;
  return { executable, unlikelyInBunsModules };
}

test("the marks of unlikely arms in Bun's own modules change no answer", async () => {
  using dir = tempDir("aot-unlikely-marks", files);
  const honored = await build(String(dir), "honored", []);
  const ignored = await build(String(dir), "ignored", ["--aot-testing=ignore-branch-hints"]);
  expect(honored.unlikelyInBunsModules).toBeGreaterThan(0);
  expect(ignored.unlikelyInBunsModules).toBe(0);

  const plain = await run([bunExe(), "run", "main.mjs"], String(dir), bunEnv);
  expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  for (const { executable } of [honored, ignored]) {
    const compiled = await run([executable], String(dir), bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }
}, 480_000);
