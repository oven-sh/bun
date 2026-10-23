import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { registry } from "./harness/registry";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported-with-counted-calls";

// `export {}` makes the module strict. In sloppy code eval's JSON shortcut answers "1" and nothing is interpreted.
const files = {
  "main.ts": `
    declare const Bun: { gc(force: boolean): void };
    declare const console: { log(...values: unknown[]): void };
    class Point {
      x: number = 1;
      y: number = 2;
    }
    const point = new Point();
    (point as any).x = "wide";
    const squares = new Map<number, number>();
    for (let i = 0; i < 1000; i++) squares.set(i, i * i);
    console.log((point as any).x, point.y, eval("1"), squares.size, squares.get(999));
    Bun.gc(true);
    export {};
  `,
};

async function measure() {
  using dir = tempDir("aot-runtime-counts-file", files);
  const cwd = String(dir);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  built(await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv));

  const run = async (options: Record<string, string>) => {
    const before = new Set(readdirSync(cwd));
    await using proc = Bun.spawn({
      cmd: [executable],
      cwd,
      env: { ...bunEnv, [runtimeEnvironment.countsPath]: undefined, ...options },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 90_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const written = readdirSync(cwd).filter(name => !before.has(name));
    return {
      pid: proc.pid,
      behavior: { stdout, stderr, exitCode, signal: proc.signalCode },
      written,
      text: written.map(name => readFileSync(join(cwd, name), "utf8")).join(""),
    };
  };

  return {
    counting: await run({ [runtimeEnvironment.countsPath]: join(cwd, "counts-%p") }),
    notCounting: await run({}),
  };
}

describe("compile/aot/runtime-counts-file", () => {
  let runs: Awaited<ReturnType<typeof measure>>;
  beforeAll(async () => {
    runs = await measure();
  }, 240_000);

  test("the option writes every runtime counter and the operation counts to one file per process", () => {
    const { pid, written, text } = runs.counting;
    expect(written).toEqual([`counts-${pid}`]);

    const lines = text.split("\n");
    expect(lines.pop()).toBe("");
    const isCount = (line: string) => /^\d+\t(counter|exit|limit|operation|branch):\S+$/.test(line);
    // Behind the counts: what was made and learned, by its description, and the places that allocate.
    const isDescribed = (line: string) =>
      /^\d+\t(structures|plans dropped by collections|keys of plans|pairs of layouts|named):\S.*$/.test(line);
    const isAllocation = (line: string) =>
      /^(allocation|refill|made) \S+ \S+ \S+ \d+ \d+$|^slow-allocation \S+ \d+$/.test(line);
    expect(lines.filter(line => !isCount(line) && !isDescribed(line) && !isAllocation(line))).toEqual([]);

    const entries = lines
      .filter(isCount)
      .map(line => line.split("\t"))
      .map(([count, name]) => ({ name, count: Number(count) }));
    const namesOf = (kind: string) =>
      entries.filter(entry => entry.name.startsWith(kind + ":")).map(entry => entry.name.slice(kind.length + 1));
    const { runtimeCounters, limits } = registry();
    const exits = namesOf("exit");
    expect(exits).not.toEqual([]);
    expect(exits).toEqual(runtimeCounters.filter(name => exits.includes(name)));
    expect(namesOf("counter")).toEqual(runtimeCounters.filter(name => !exits.includes(name)));
    expect(namesOf("limit")).toEqual(
      expect.arrayContaining(limits.filter(limit => limit.stage === "RunTime").map(limit => limit.name)),
    );
    expect(namesOf("branch")).toEqual([]);
    expect(entries.filter(entry => entry.name.startsWith("operation:operationAOT") && entry.count > 0)).not.toEqual([]);

    const counts = new Map(entries.map(entry => [entry.name, entry.count]));
    expect(counts.get("counter:FieldsLeftSlotByStoreOfOtherType")).toBe(1);
    expect(counts.get("counter:InterpretedEvalCode")).toBeGreaterThanOrEqual(1);
    expect(counts.get("limit:PromisesWalkedPerImport")).toBe(0);
  });

  test("nothing is written without the option", () => {
    expect(runs.notCounting.written).toEqual([]);
  });

  test("counting does not change program behavior", () => {
    const expected = { stdout: "wide 2 1 1000 998001\n", stderr: "", exitCode: 0, signal: null };
    expect(runs.counting.behavior).toEqual(expected);
    expect(runs.notCounting.behavior).toEqual(expected);
  });
});
