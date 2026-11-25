// One program for each member of `Bun` and of `process`, and one question in it: typeof, `in`, Object.hasOwn, Reflect.has. Beside other looks a fault may not show: what a build keeps goes by all that the
// program holds. The programs are those of ../../fuzz/fuzzilli/write-member-sweep.ts, which writes them for every object of the host; these two hold the members that are made late.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const kept = /^[0-9]+-[a-zA-Z]+--(?:Bun|process)-[A-Za-z0-9_$]*\.mjs$/;

export default async function write(folder: string) {
  const all = mkdtempSync(join(folder, "..", "every-member-"));
  await Bun.spawn(
    [process.execPath, join(import.meta.dir, "..", "..", "fuzz", "fuzzilli", "write-member-sweep.ts"), all],
    { stdout: "ignore", stderr: "inherit" },
  ).exited;
  // The same names are asked for in the two other builds by every-name-of-a-holder.ts, many to a program.
  for (const name of readdirSync(all))
    if (kept.test(name)) writeFileSync(join(folder, name), `// Closed alone\n${readFileSync(join(all, name), "utf8")}`);
  rmSync(all, { recursive: true, force: true });
}
