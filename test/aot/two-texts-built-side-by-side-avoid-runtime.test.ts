import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.ts": `
    declare const process: { argv: string[] };
    declare const console: { log(...values: any[]): void };
    declare const Bun: { gc(force: boolean): void };
    function nest(depth: number): string {
      let text = "";
      try {
        for (let i = 0; i < 3; i++) {
          text += "<";
          if (i === 1 && depth > 1) text += nest(depth - 1);
          text += ">";
        }
      } catch {
        text += "!";
      }
      return text;
    }
    // Both texts are begun, and where only one is wanted the other is given up with nothing in it.
    function sort(items: string[], both: boolean, collects: boolean): string {
      let short = "";
      let long = "";
      try {
        for (const item of items) {
          if (item.length > 3) long += item;
          else if (both) short += item;
          if (collects) Bun.gc(true);
        }
      } catch {
        long += "!";
        short += "!";
      }
      if (both) return short + long;
      return long;
    }
    const items = ["alpha", "be", "gamma", "de", "epsilon"];
    const turns = Number(process.argv[2]);
    const [depth, collects, both, one]: [number, boolean, boolean, boolean] = JSON.parse(process.argv[3]);
    console.log(nest(depth).length, sort(items, both, false), sort(items, one, collects));
    let length = 0;
    for (let turn = 0; turn < turns; turn++) length += sort(items, one, false).length;
    console.log(length === turns * 17);
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("two texts built side by side, of which one stays empty, are built in the same two builders at every turn", async () => {
  using dir = tempDir("aot-two-texts-built-side-by-side", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counted = async (turns: number, depth: number, collects: boolean) => {
    const path = join(String(dir), "counts");
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(
      await run([executable, String(turns), JSON.stringify([depth, collects, true, false])], String(dir), env),
    ).toEqual({
      stdout: `${6 * depth} bedealphagammaepsilon alphagammaepsilon\ntrue\n`,
      stderr: "",
      exitCode: 0,
    });
    const counts = { begun: 0, finished: 0, notPooled: 0 };
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\t");
      if (name === "operation:operationAOTStringBuilderBegin") counts.begun = Number(count);
      if (name === "operation:operationAOTStringBuilderFinish") counts.finished = Number(count);
      if (name === "limit:MaxPooledStringBuilders") counts.notPooled = Number(count);
    }
    return counts;
  };
  // As many builders as the pool holds were open at once before, or one, and a collection has emptied the pool, or none has.
  for (const [depth, collects] of [
    [1, false],
    [1, true],
    [8, false],
    [8, true],
  ] as const) {
    const few = await counted(500, depth, collects);
    const many = await counted(2500, depth, collects);
    // The text that is wanted is finished by the run time at every turn. A renamed operation would count none.
    expect({ depth, collects, finished: many.finished - few.finished }).toEqual({ depth, collects, finished: 2000 });
    // The run time is asked for a builder only where the pool has none: at first, and behind a collection.
    expect({
      depth,
      collects,
      begun: many.begun - few.begun > 200 ? many.begun - few.begun : "level",
      notPooled: many.notPooled,
    }).toEqual({ depth, collects, begun: "level", notPooled: 0 });
  }
}, 240_000);
