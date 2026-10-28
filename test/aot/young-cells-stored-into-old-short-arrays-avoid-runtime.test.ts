import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  // Every owner is old and is written once, so every store finds its owner black and has to remember it.
  "store.ts": `
    interface Item { id: number }
    const stores = Number(process.argv[2]);
    const first: Item = { id: -1 };
    const byElement: Item[][] = [], byPush: Item[][] = [];
    for (let i = 0; i < 6000; i++) {
      byElement.push([first, first, first, first]);
      const withRoom = [first, first, first, first]; withRoom.pop(); withRoom.pop(); byPush.push(withRoom);
    }
    Bun.gc(true);
    function storeElements(owners: Item[][], count: number): void { for (let i = 0; i < count; i++) owners[i][1] = { id: i }; }
    function pushElements(owners: Item[][], count: number): void { for (let i = 0; i < count; i++) owners[i].push({ id: i }); }
    storeElements(byElement, stores);
    pushElements(byPush, stores);
    Bun.gc(true);
    let sum = 0;
    for (let i = 0; i < stores; i++) sum += byElement[i][1].id - byPush[i][2].id;
    console.log(sum, byPush[0].length);
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

// The stub pushes the owner on the collector's list itself. A segment of the list holds 510 owners, and a full one is the run time's to replace.
// The calls are counted on x64 only.
test.skipIf(process.arch !== "x64")(
  "an old short array that gets a young cell is remembered without a call of the run time",
  async () => {
    using dir = tempDir("aot-young-cells-in-old-short-arrays", files);
    const executable = join(String(dir), "store" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "store.ts", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const counted = async (stores: number) => {
      const path = join(String(dir), "counts" + stores);
      const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
      expect(await run([executable, String(stores)], String(dir), env)).toEqual({
        stdout: "0 3\n",
        stderr: "",
        exitCode: 0,
      });
      let sum = 0;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const [count, name] = line.split("\toperation:");
        if (name === "operationAOTRememberElement") sum += Number(count);
      }
      return sum;
    };
    const few = await counted(500),
      many = await counted(5500);
    // 10,000 more stores may add about 20 calls: one for each full segment.
    expect(many - few).toBeLessThan(200);
  },
  240_000,
);
