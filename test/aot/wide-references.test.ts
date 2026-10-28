// A program compiled by --aot keeps most references in 32 bits: its objects have to lie in 32 GB of reserved address space. One that outgrows
// that says so and names the option that lifts the limit. The limit is lowered to 64 MB here, so that a small program reaches it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { test } from "./supported";

const program = `
class Item { constructor(public n: number, public before: Item | null, public far: Item | null, public label: string) {} }
const rows: Item[][] = [];
let before: Item | null = null;
for (let m = 0; m < 20; m++) {
  const row: Item[] = [];
  for (let k = 0; k < 100000; k++) {
    const i = m * 100000 + k;
    before = new Item(i, before, m > 0 ? rows[(i * 7) % m][k] : null, "label " + (i & 63)); // the labels are made anew: two million strings beside two million objects
    row.push(before);
  }
  rows.push(row);
}
let sum = 0, fars = 0, letters = 0, chain = 0;
for (const row of rows) for (const item of row) { sum += item.n; if (item.far !== null) fars += item.far.n % 1000; letters += item.label.length; }
for (let item: Item | null = before; item !== null; item = item.before) chain++;
console.log(sum, fars, letters, chain);
`;

test("a program that outgrows the range of 32-bit references says which option lifts the limit, and built with it runs on", async () => {
  using dir = tempDir("aot-wide-references", { "main.ts": program });
  const cwd = String(dir);
  const narrow = join(cwd, isWindows ? "narrow.exe" : "narrow");
  const wide = join(cwd, isWindows ? "wide.exe" : "wide");
  expect(
    (await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", narrow], cwd, bunEnv)).exitCode,
  ).toBe(0);
  expect(
    (await run([bunExe(), "build", "--compile", "--aot", "--aot-huge-heap", "main.ts", "--outfile", wide], cwd, bunEnv))
      .exitCode,
  ).toBe(0);
  const plain = await run([bunExe(), "run", "main.ts"], cwd, bunEnv);
  expect(plain.exitCode).toBe(0);

  expect(await run([narrow], cwd, bunEnv)).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
  const full = await run(withoutCoreDump([narrow]), cwd, { ...bunEnv, BUN_JSC_markedBlockCageSizeInMB: "64" });
  expect(full.exitCode).not.toBe(0);
  expect(full.stdout).not.toContain(plain.stdout);
  expect(full.stderr).toContain("Build with --aot-huge-heap to remove the limit.");
  const none = await run(withoutCoreDump([narrow]), cwd, { ...bunEnv, BUN_JSC_markedBlockCageSizeInMB: "0" });
  expect(none.exitCode).not.toBe(0);
  expect(none.stderr).toContain("Build it with --aot-huge-heap to run it without a heap limit.");

  for (const reserved of [undefined, "64", "1", "0"])
    expect(await run([wide], cwd, { ...bunEnv, BUN_JSC_markedBlockCageSizeInMB: reserved })).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
    });
}, 120_000);
