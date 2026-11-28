import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ANSWER_BUDGET_MS } from "../../../scripts/build/tools.ts";

// Configure asks a program a question (its version, a directory, the commit) through `ask()` in
// scripts/build/probe.ts, which throws when the program gives no answer: it ran out of time, or a signal killed it.
// A spawn written by hand decides that case for itself, and the ones that were here decided it wrongly. A
// `clang --version` that missed its 30 seconds on a busy machine was "not this clang", tool discovery took
// `clang-23`, and the new compiler path in build.ninja recompiled every C file and every Rust crate.
//
// So the modules that resolve the toolchain and the config do not start a process themselves. These two tables are
// all that they start: the calls that are still direct, each with what a failure does there, and the questions,
// each with how long it may take. A new question is an `ask()`, or gets a line that says why it is not.
const build = path.resolve(import.meta.dir, "..", "..", "..", "scripts", "build");
const files = ["tools.ts", "config.ts", "configure.ts", "ninja-release.ts"];
const code = (file: string) => readFileSync(path.join(build, file), "utf8").replace(/^\s*(?:\/\/|\/?\*).*$/gm, "");
const oneLine = (text: string) => text.replace(/\s+/g, " ");

test("the modules that resolve the toolchain and the config start a process only through ask()", () => {
  const direct = new Map([
    [
      `tools.ts: spawnSync(rustup, ["-q", "toolchain", "install", channel, "--no-self-update", "--profile", "minimal", "--component", "rust-src"])`,
      "An install, not a question: the two asks of rustc after it read what it left.",
    ],
    ['config.ts: execSync(`"${cc}" -print-resource-dir`)', "No timer. A failure fails configure."],
    [`config.ts: execSync("xcode-select -p")`, "No timer. A failure fails configure."],
    [`config.ts: execSync("xcrun --sdk macosx --show-sdk-path")`, "No timer. A failure fails configure."],
    [`config.ts: execSync("xcrun --sdk macosx --show-sdk-version")`, "No timer. A failure fails configure."],
    [
      `configure.ts: spawnSync(ninja, ["-C", cfg.buildDir, "-t", "restat", "build.ninja"])`,
      "A command, not a question.",
    ],
    [
      `ninja-release.ts: spawnSync(ninja, ["--version"])`,
      "No timer. The one question that is not an ask(): whatever stops the pinned ninja from running, a kill too, " +
        "selects the ninja on PATH, because ninja-release.ts takes each for a machine that refuses the program. " +
        "Both callers say so.",
    ],
  ]);

  const found: string[] = [];
  for (const file of files) {
    // The program, and its arguments when they are a list.
    for (const [, spawn, program, args] of code(file).matchAll(
      /\b((?:spawn|exec|execFile)Sync)\(\s*([^,)]+)(?:,\s*(\[[^\]]*\]))?/g,
    )) {
      found.push(oneLine(`${file}: ${spawn}(${[program, args].filter(Boolean).join(", ")})`));
    }
  }
  expect(found.sort()).toEqual([...direct.keys()].sort());
  // The calls above are all there is: nothing else of child_process is in reach, and nothing of Bun's.
  const imported = (file: string) => /import \{([^}]*)\} from "node:child_process"/.exec(code(file))?.[1]?.trim();
  expect(files.map(imported)).toEqual(["spawnSync", "execSync", "spawnSync", "spawnSync"]);
  expect(files.filter(file => /\bBun\s*\.\s*(?:spawn|\$)/.test(code(file)))).toEqual([]);
  // The one door. It also shows that `build` is the directory of the build scripts.
  expect(code("probe.ts").match(/\bspawnSync\(/g)).toHaveLength(1);
});

test("an ask waits minutes for its answer, or has no timer where there was none", () => {
  const asks: string[] = [];
  let calls = 0;
  for (const file of files) {
    calls += code(file).match(/\bask\(/g)?.length ?? 0;
    for (const [, program, args, budget] of code(file).matchAll(
      /\bask\(\s*([^,)]+),\s*(\[[^\]]*\]|\w+),\s*\{\s*budgetMs: ([^,}]+?)\s*[,}]/g,
    )) {
      asks.push(oneLine(`${file}: ask(${program}, ${args}) in ${budget}`));
    }
  }
  expect(asks).toEqual([
    `tools.ts: ask(exe, ["--version"]) in ANSWER_BUDGET_MS`,
    `tools.ts: ask("brew", ["--prefix"]) in ANSWER_BUDGET_MS`,
    `tools.ts: ask(ccResult!.path, ["-print-resource-dir"]) in ANSWER_BUDGET_MS`,
    `tools.ts: ask(rustc, args) in ANSWER_BUDGET_MS`,
    // These two had no timer, and a timer is not what they were missing.
    `config.ts: ask("getconf", ["GNU_LIBC_VERSION"]) in null`,
    `config.ts: ask("git", ["rev-parse", "HEAD"]) in null`,
  ]);
  expect(calls).toBe(asks.length);
  // An ask that runs out fails configure, so the budget is for a program that hangs, not for a slow one. 30 seconds
  // is what let a busy machine pick another clang.
  expect(ANSWER_BUDGET_MS).toBeGreaterThanOrEqual(300_000);
});
