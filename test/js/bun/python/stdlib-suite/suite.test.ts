// The translator of CPython's tests (README.md), tried on a file of its own: fixture/test_sample.py. The file is translated by
// translate.py under bun as python3, and then the translation and the original are run, each test by the same runner.
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { copyFileSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

if (isDebug || isASAN) setDefaultTimeout(120_000);

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function outcomes(path: string) {
  const records = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)); // prettier-ignore
  return Object.fromEntries(records.filter(record => record.t === "end").map(record => [record.id, record.status === "ok" ? "ok" : [record.status, record.detail?.[1]]])); // prettier-ignore
}

const modes: [string, string[], Record<string, string>][] = [
  ["as it is by default", [], {}],
  ["with the classes and the operators of JavaScript", ["--native-classes"], { STDLIB_SUITE_NATIVE: "1", STDLIB_SUITE_NATIVE_LEFT: "0" }], // prettier-ignore
];

test.concurrent.each(modes)("a translated file does what the original does, %s", async (_, options, env) => {
  using dir = tempDir("python-stdlib-suite", {});
  const cwd = String(dir);
  const python = join(cwd, "python3");
  symlinkSync(bunExe(), python);
  for (const name of ["support.ts", "support.py"]) copyFileSync(join(import.meta.dir, name), join(cwd, name));
  const fixture = join(import.meta.dir, "fixture");

  const translated = await run(
    [python, join(import.meta.dir, "translate.py"), ...options, join(fixture, "test_sample.py"), "test_sample", join(cwd, "test_sample.test.ts")],
    cwd,
  ); // prettier-ignore
  expect(translated).toEqual({ stdout: "test_sample: 28 of 29 test methods\n", stderr: "", exitCode: 0 });
  const manifest = JSON.parse(readFileSync(join(cwd, "test_sample.json"), "utf8"));
  expect(Object.entries(manifest.tests).filter(([, reason]) => reason !== "ok")).toEqual([
    ["LanguageTest.test_left_out", "frames"],
  ]);

  const [original, translation] = await Promise.all([
    run([python, join(cwd, "support.py"), "test_sample", join(cwd, "original.jsonl")], cwd, { PYTHONPATH: fixture }),
    run([bunExe(), "test", "./test_sample.test.ts"], cwd, { PYTHONPATH: fixture, STDLIB_SUITE_LOG: join(cwd, "translation.jsonl"), ...env }),
  ]); // prettier-ignore
  expect(original.stderr).toBe("");
  const expected = outcomes(join(cwd, "original.jsonl"));
  expect(Object.keys(expected)).toHaveLength(31);
  expect(outcomes(join(cwd, "translation.jsonl"))).toEqual({
    ...expected,
    "LanguageTest.test_left_out": ["untranslated", "LanguageTest.test_left_out: frames"],
  });
  expect(translation.exitCode).toBe(0);
});
