import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

// An executable runs in one realm, so an object that has passed the test of its layout is an object of that realm. A test run ends the realm of a file before it
// makes the next one, so the same holds in the layer that the test files stand on, and its functions are the executable's: no comparison of realms behind the test.
// The layers are built as `bun test --aot` builds them, one after the other, and the compiler's map says which operations a function is made of.
const files = {
  "task.ts": `
    export class Task {
      count = 1;
      run() { return this.count + 1; }
    }
    export function runs(task: Task) { return task.run() + task.count; }
    export function isTask(value: unknown) { return value instanceof Task; }
    export interface Ask { kind: string; word: string; size: number }
    export function makeAsk(word: string): Ask { return { kind: "ask", word, size: word.length }; }
    export function sizeOf(ask: Ask | undefined) { return ask ? ask.size : 0; }
    const asks: Ask[] = [];
    export function keep(ask: Ask) { asks.push(ask); return asks.length; }
    export function total() { let sum = 0; for (const ask of asks) sum += ask.size; return sum; }`,
  "a.test.ts": `
    import { expect, test } from "bun:test";
    import { Task, isTask, keep, makeAsk, runs, sizeOf, total } from "./task.ts";
    test("a", () => {
      expect(runs(new Task())).toBe(3);
      expect(isTask(new Task())).toBe(true);
      expect(isTask({ count: 1 })).toBe(false);
      expect(sizeOf(makeAsk("four"))).toBe(4);
      keep(makeAsk("ab"));
      keep({ kind: "x", word: "y", size: 7 });
      expect(total()).toBe(9);
    });`,
  "b.test.ts": `
    import { expect, test } from "bun:test";
    import { Task, keep, makeAsk, runs, total } from "./task.ts";
    test("b", () => {
      const task = new Task();
      task.count = 5;
      expect(runs(task)).toBe(11);
      keep(makeAsk("abc"));
      expect(total()).toBe(3);
    });`,
};
const env = {
  ...bunEnv,
  BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1",
};

test("a function of the layer tests the layout of what a test file hands it, and not its realm", async () => {
  using dir = tempDir("aot-the-layer-asks-no-object-for-its-realm", files);
  const at = (name: string) => join(String(dir), name);
  const build = async (graph: string, part: string, below: number[], more: Record<string, string>) => {
    writeFileSync(at(graph), at("a.test.ts") + "\0" + at("b.test.ts") + "\0");
    const descriptor = openSync(at(graph), "r+");
    try {
      await using builder = Bun.spawn({
        cmd: [bunExe(), "test", "--aot", "--isolate", `--aot-build-test-part=${part}`],
        cwd: String(dir),
        env: { ...env, ...more },
        stdio: ["ignore", "pipe", "pipe", descriptor, ...below],
      });
      const [stderr, exitCode] = await Promise.all([builder.stderr.text(), builder.exited]);
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    } finally {
      closeSync(descriptor);
    }
  };
  await build("packages", "3,shared,packages", [], {});
  const packages = openSync(at("packages"), "r");
  try {
    await build("shared", "3,shared,below:4", [packages], { BUN_JSC_aotMapFilePath: at("map") });
  } finally {
    closeSync(packages);
  }
  const lines = readFileSync(at("map"), "utf8").split("\n");
  const operationsOf = (wanted?: string) => {
    const found: string[] = [];
    lines.forEach((line, index) => {
      const [kind, , , , , , , name] = line.split("\t");
      if (kind === "F" && line.includes("task.ts") && (wanted === undefined || name === wanted))
        found.push(...lines[index + 1].split("\t"));
    });
    return found;
  };
  for (const name of ["runs", "sizeOf", "total"])
    expect(operationsOf(name).filter(word => word.startsWith("TypeTest"))).not.toEqual([]);
  expect(operationsOf().filter(word => word.startsWith("BelongsToInstance"))).toEqual([]);
}, 120_000);

test("the files of such a run pass, each in a realm of its own", async () => {
  using dir = tempDir("aot-the-layer-asks-no-object-for-its-realm-run", files);
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", "--aot", "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
}, 120_000);
