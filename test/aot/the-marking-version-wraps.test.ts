import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runProcess } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

// A heap's marking version goes up by one at each full collection and wraps from the last one to the first. Whatever
// the collector keeps beside a cell to say "marked in this collection" has to differ across the wrap too.
const program = `class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
const kept: any[] = [];
for (let i = 0; i < 200; i++) {
  const o: any = { id: i };
  o["k" + i] = i;
  kept.push(o, new Point(i, i + 1), new Map([[i, o]]), [i, o]);
}
let sum = 0;
for (let round = 0; round < 40; round++) {
  Bun.gc(true);
  const fresh: any = {};
  fresh["r" + round] = round;
  kept.push(fresh);
  for (const v of kept) {
    if (v instanceof Point) sum += v.x + v.y;
    else if (v instanceof Map) sum += v.size;
    else if (Array.isArray(v)) sum += v.length;
    else sum += Object.keys(v).length;
  }
}
console.log(sum);
`;

describe("full collections across the wrap of the marking version", () => {
  const dir = tempDir("the-marking-version-wraps", { "main.ts": program });
  const executable = join(String(dir), "program");

  beforeAll(async () => {
    const built = await runProcess(
      [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
  });

  afterAll(() => dir[Symbol.dispose]());

  const last = 2 ** 32 - 1;
  const versions = [last, last - 1, last - 2, last - 5, last - 15, last - 35];
  test.each(versions)("the heap starts at version %d", async version => {
    const { stdout, exitCode } = await runProcess([executable], String(dir), {
      ...bunEnv,
      BUN_JSC_initialHeapVersion: String(version),
    });
    expect({ stdout, exitCode }).toEqual({ stdout: "1640820\n", exitCode: 0 });
  });
});
