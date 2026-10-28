// The ways to write a `require` of a file of the program. For each: is the file compiled into the executable? The sources are moved away before
// the executable runs, so a file that is not in it cannot be found. `bun build --compile --aot` sees every spelling `bun build --compile` sees,
// and a few more: there its executable prints what `bun run` prints. The executable built with --aot is run with
// BUN_JSC_crashIfInterpreterIsUsed=1, which crashes it if any of its code is interpreted.
import { describe, expect, test } from "bun:test";
import { renameSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

const inTheExecutable: [string, string][] = [
  [`console.log(require("./data/one.cjs").n);`, "1"],
  [`console.log(require(true ? "./data/one.cjs" : "./data/two.cjs").n);`, "1"],
  [`console.log(require(process.argv.length > 99 ? "./data/one.cjs" : "./data/two.cjs").n);`, "2"],
  ["console.log(require(`./data/two.cjs`).n);", "2"],
  [`console.log((require)("./data/one.cjs").n);`, "1"],
  [`console.log(require?.("./data/two.cjs").n);`, "2"],
  [`console.log(module.require("./data/two.cjs").n);`, "2"],
  [`console.log(require("./data/" + "one.cjs").n);`, "1"],
  [
    `function load(require) { return require("./data/one.cjs"); } console.log(load(() => ({ n: "shadowed" })).n);`,
    "shadowed",
  ],
  [
    `function load(module) { return module.require("./data/one.cjs"); } console.log(load({ require: () => ({ n: "shadowed" }) }).n);`,
    "shadowed",
  ],
  [`console.log(typeof require === "function" && require("./data/one.cjs").n);`, "1"],
  [`try { console.log(require("./data/one.cjs").n); } catch { console.log("caught"); }`, "1"],
  [`console.log([1].map(() => require("./data/two.cjs").n)[0]);`, "2"],
  [`import("./data/one.cjs").then(m => console.log(m.default.n));`, "1"],
  [`console.log(require("./data/one").n);`, "1"],
  [`console.log(require("./data/../data/one.cjs").n);`, "1"],
];

const inTheCompiledExecutableOnly: [string, string][] = [
  [`const name = "one"; console.log(require("./data/" + name + ".cjs").n);`, "1"],
  ['const name = "two"; console.log(require(`./data/${name}.cjs`).n);', "2"],
  [`const name = process.argv.length > 99 ? "one" : "two"; console.log(require("./data/" + name + ".cjs").n);`, "2"],
  [`console.log(require("./data/one.cjs", "extra").n);`, "1"],
  [`console.log(import.meta.require("./data/one.cjs").n);`, "1"],
  [`const r = require; console.log(r("./data/one.cjs").n);`, "1"],
  [`console.log(require.call(null, "./data/one.cjs").n);`, "1"],
  [`console.log(require.apply(null, ["./data/one.cjs"]).n);`, "1"],
  [`console.log(require(__dirname + "/data/one.cjs").n);`, "1"],
  ["console.log(require(`${__dirname}/data/two.cjs`).n);", "2"],
  [`console.log(require(require("node:path").join(__dirname, "data", "one.cjs")).n);`, "1"],
  [`console.log(require("./data/" + ["o", "n", "e"].sort(() => 0).join("") + ".cjs").n);`, "1"],
];

const leftToTheRunTime: string[] = [
  `console.log(require(Buffer.from("2e2f646174612f6f6e652e636a73", "hex").toString()).n);`,
];

async function answers(row: string) {
  using dir = tempDir("aot-spellings-of-require", {
    "src/main.cjs": row + "\n",
    "src/data/one.cjs": "exports.n = 1;\n",
    "src/data/two.cjs": "exports.n = 2;\n",
    "away/empty": "",
  });
  const folder = String(dir);
  const executables = ["bundle", "aot"].map(how => join(folder, "away", how + (isWindows ? ".exe" : "")));
  for (const [index, flags] of [[], ["--aot"]].entries()) {
    const built = await spawned(
      [bunExe(), "build", "--compile", ...flags, "main.cjs", "--outfile", executables[index]],
      join(folder, "src"),
      bunEnv,
    );
    expect({ row, flags, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      row,
      flags,
      stderr: expect.any(String),
      exitCode: 0,
    });
  }
  renameSync(join(folder, "src"), join(folder, "moved"));
  const bundle = await spawned([executables[0]], join(folder, "away"), bunEnv);
  const aot = await spawned([executables[1]], join(folder, "away"), {
    ...bunEnv,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
  });
  const told = (run: typeof bundle) =>
    run.signal ? `signal ${run.signal}` : run.exitCode ? `exit code ${run.exitCode}` : run.stdout.trim();
  return { bundle: told(bundle), aot: told(aot) };
}

describe.concurrent("compile/aot/spellings of require", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const [row, prints] of inTheExecutable)
    test(row, () => slot(async () => expect(await answers(row)).toEqual({ bundle: prints, aot: prints })), 600_000);
  for (const [row, prints] of inTheCompiledExecutableOnly)
    test(
      "seen by --aot: " + row,
      () => slot(async () => expect(await answers(row)).toEqual({ bundle: "exit code 1", aot: prints })),
      600_000,
    );
  for (const row of leftToTheRunTime)
    test(
      "not seen: " + row,
      () => slot(async () => expect(await answers(row)).toEqual({ bundle: "exit code 1", aot: "exit code 1" })),
      600_000,
    );
});
