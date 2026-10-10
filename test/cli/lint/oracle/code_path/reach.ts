// Compares what `Stmt::is_reachable`, `Case::is_end_reachable`, `Func::is_end_reachable` and `File::is_end_reachable`
// find out from the statements alone with what the code path analysis finds, which `trace.ts` compares with ESLint's.
//
//   bun reach.ts --bin <bun-lint> --scratch <dir> [--fixtures <conformance/fixtures>].. [--files <dir>]..
//                [--generated <count> [--seed <first>]] [--jobs N] [--examples N]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { casesFromArguments, option } from "../tokens/corpus";
import { generatedCases } from "./generate";

const args = process.argv.slice(2);
const scratch = option(args, "--scratch") ?? ".";
const jobs = Number(option(args, "--jobs") ?? 16);
const examples = Number(option(args, "--examples") ?? 2);
mkdirSync(scratch, { recursive: true });

const all = casesFromArguments(args);
all.push(...generatedCases(Number(option(args, "--generated") ?? 0), Number(option(args, "--seed") ?? 1)));

const found = new Map<string, string[]>();
let wrong = 0;
await Promise.all(
  Array.from({ length: jobs }, async (_, shard) => {
    const mine = all.filter((_, i) => i % jobs === shard);
    const input = join(scratch, `reach-${shard}.jsonl`);
    writeFileSync(input, mine.map(it => JSON.stringify({ path: it.path, code: it.code }) + "\n").join(""));
    const child = Bun.spawn([option(args, "--bin")!, "code-path", "reach", input], { stdout: "pipe", stderr: "inherit" });
    const lines = (await new Response(child.stdout).text()).split("\n").filter(Boolean);
    if (lines.length !== mine.length) throw new Error(`bun-lint stopped on ${input} after ${lines.length} of ${mine.length}`);
    lines.forEach((line, i) => {
      const differences: string[] = JSON.parse(line).filter(Boolean);
      if (differences.length === 0) return;
      wrong++;
      const [what, , which, at] = differences[0].split(" ");
      const bytes = Buffer.from(mine[i].code);
      const context = bytes.subarray(Math.max(0, Number(at) - 200), Number(at) + 60).toString();
      const list = found.get(`${what} ${which}`) ?? [];
      found.set(`${what} ${which}`, list);
      list.push(`${mine[i].id} @${at}\n      ${JSON.stringify(context)}`);
    });
  }),
);
for (const [kind, list] of [...found].sort((a, b) => a[1].length - b[1].length)) {
  console.log(`${list.length} × ${kind}`);
  for (const it of list.slice(0, examples)) console.log(`    ${it}`);
}
console.log(`${all.length} cases, ${wrong} differ.`);
