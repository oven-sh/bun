// A full collection starts from its roots and goes on beside the program. The variables of a module are among the roots of the first
// round: found a round later, all that they hold waits for the program to be stopped once more, and the collection lasts twice as long.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

// The collection is asked for from a timer, where no frame of the program names a list.
const program = `interface Link {
  next: Link | null;
  value: number;
}
const lists: (Link | null)[] = [];
function fill(count: number): void {
  for (let list = 0; list < 64; list++) {
    let head: Link | null = null;
    for (let i = 0; i < count; i++) head = { next: head, value: i };
    lists.push(head);
  }
}
function sum(): number {
  let result = 0;
  for (const head of lists) for (let link = head; link; link = link.next) result += link.value;
  return result;
}
fill(4_000);
setTimeout(() => {
  Bun.gc(true);
  console.log(sum());
}, 1);
`;

describe("compile/aot/full collections", () => {
  test("what the variables of a module hold is visited before the second round", () =>
    slot(async () => {
      using dir = tempDir("aot-variables-of-a-module-in-a-full-collection", { "main.ts": program });
      const folder = String(dir);
      const executable = join(folder, "main" + (isWindows ? ".exe" : ""));
      const env = { ...bunEnv, NO_COLOR: "1" };
      built(await spawned([bunExe(), ...compileCommand, "main.ts", "--outfile", executable], folder, env));
      const logged = await spawned([executable], folder, { ...env, BUN_JSC_logGC: "1" });
      expect(logged.exitCode).toBe(0);
      expect(logged.stdout).toContain("511872000");
      const collection = /=> FullCollection[^]*?cycle [0-9.]+ms END/.exec(logged.stdout + logged.stderr)![0];
      const visitedBeforeSecondRound = Number(/ v=(\d+)kb \([^)]*\) o=\d+ b=\d+ i#2:/.exec(collection)![1]);
      const visited = Number(/=> (\d+)kb, p=/.exec(collection)![1]);
      expect(visited).toBeGreaterThan(8_000);
      expect(visitedBeforeSecondRound).toBeGreaterThan(visited / 2);
    }));
});
