import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const numbersOf = (log: string, head: string) => {
  const line = log.split("\n").find(line => line.startsWith(head + ":"));
  const cells = (line ?? "").split(" | ").slice(1);
  return Object.fromEntries(cells.map(cell => [cell.replace(/ \d+$/, ""), Number(cell.match(/\d+$/)?.[0])]));
};
const sum = (numbers: Record<string, number>) => Object.values(numbers).reduce((all, one) => all + one, 0);

test("the phase log says what the tables of an image are made of", async () => {
  using dir = tempDir("aot-table-sizes-log", {
    "main.ts": `class A { x = 1; f() { return this.x; } }\nconsole.log(new A().f(), /a+/.test("aa"));\n`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "out"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(exitCode).toBe(0);
  const image = numbersOf(stderr, "AOT size of the image");
  const sections = numbersOf(stderr, "AOT size of the tables");
  const groups = numbersOf(stderr, "AOT size of the program tables");
  expect(sum(sections)).toBe(image["table bytes"]);
  expect(sections["program tables"]).toBe(image["program table bytes"]);
  expect(groups.functions).toBeGreaterThan(0);
  expect(Math.abs(sum(groups) - image["program table bytes"])).toBeLessThan(image["program table bytes"] / 50);
}, 120_000);
