// Rewrites what the tests store of the engine's output, after an engine change or a merge of upstream WebKit, and lists the files it changed.
//
//   <the Bun you built> test/aot/tools/update-expectations.ts        needs testaot: $TESTAOT, or beside that Bun
//
// 1. src/codegen/builtins/data/own-properties.txt and module-exports.txt, from the objects and modules of that Bun.
//    The table of built-ins is generated from them, so if one changed: build Bun again, then run this again.
// 2. test/aot/engine-tests, and aot/tests of the engine where $BUN_WEBKIT_PATH or vendor/WebKit has its sources: the IR of each test that
//    holds its source, the listings below `# -- generated:`, and the numbers in a check line that fails by its numbers alone
//    (./update-ir-tests.ts --counts, which prints each such line before and after).
// 3. test/aot/ir: the check lines below `GENERATED:` (AOT_IR_UPDATE=1 cargo test -p bun_aot --test ir_tests).
//
// It touches no bound in a .test.ts file and no budget. Read the diff: more instructions or a longer listing is a regression until it is explained.
import { bunEnv, bunExe } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { engineTests, testaot } from "../shell/tools";

const repository = join(import.meta.dir, "../../..");
const data = "src/codegen/builtins/data";
const rewritten = [data, "test/aot/engine-tests", "test/aot/ir"].map(folder => join(repository, folder));
// Beside a prebuilt engine lies a copy of its tests, which nobody commits.
if (engineTests?.includes("JavaScriptCore")) rewritten.push(engineTests);

function hashFiles() {
  const hashes = new Map<string, number | bigint>();
  for (const folder of rewritten) {
    for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      hashes.set(path, Bun.hash(readFileSync(path)));
    }
  }
  return hashes;
}

function run(command: string[], env: Record<string, string> = {}) {
  console.log(`$ ${command.join(" ")}`);
  const { exitCode } = Bun.spawnSync(command, {
    cwd: repository,
    env: { ...bunEnv, TESTAOT: testaot, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (exitCode !== 0) process.exitCode = 1;
}

function changedSince(before: Map<string, number | bigint>) {
  return [...hashFiles()].filter(([path, hash]) => before.get(path) !== hash).map(([path]) => path);
}

if (!testaot) {
  console.error("there is no testaot: set $TESTAOT, or put it beside the Bun that runs this");
  process.exit(2);
}
const before = hashFiles();
run(
  [
    bunExe(),
    "--expose-internals",
    "test",
    "test/aot/builtins/own-properties.test.ts",
    "test/aot/builtins/module-exports.test.ts",
  ],
  { AOT_BUILTINS_UPDATE: "1" },
);
const changedData = changedSince(before);
if (changedData.length > 0) {
  console.log(
    `\nchanged:\n${changedData.join("\n")}\n\nThe table of built-ins is generated from these. Build Bun again, then run this again.`,
  );
  process.exit(process.exitCode ?? 0);
}
run([
  bunExe(),
  "test/aot/tools/update-ir-tests.ts",
  "--counts",
  ...rewritten.slice(1).filter(folder => !folder.endsWith("ir")),
]);
run(["cargo", "test", "-p", "bun_aot", "--test", "ir_tests"], { AOT_IR_UPDATE: "1" });
const changed = changedSince(before);
console.log(changed.length > 0 ? `\nchanged:\n${changed.join("\n")}` : "\nnothing changed");
