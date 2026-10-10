// Runs the whole comparison for one corpus.
//
//   bun run.ts --bin <bun-lint> --work <directory for the intermediate files> --name <corpus>
//     --typescript-estree <package> [--espree <package>] [--mutate <seed> <share>]
//     (--fixtures <conformance/fixtures> | --files <dir> <glob>)..
//
// 1. collect.ts: the inputs. 2. mutate.ts, if asked for: comments between the tokens.
// 3. expected.ts, expected-espree.ts: what the parsers of ESLint make of them. Kept in --work and reused.
// 4. `bun-lint ast estree-batch`, diff.ts: what differs. 5. `bun-lint ast check-batch`: whether `bun_lint::ast` agrees with itself.
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const take = (name: string, count = 1) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, count + 1).slice(1);
};
const bin = take("--bin")![0], work = take("--work")![0], name = take("--name")![0];
const typescript = take("--typescript-estree")![0], espree = take("--espree")?.[0], mutation = take("--mutate", 2);
mkdirSync(work, { recursive: true });
const path = (suffix: string) => join(work, `${name}.${suffix}`);
const script = (file: string, ...rest: string[]) => run([process.execPath, join(import.meta.dir, file), ...rest]);
function run(cmd: string[], stdout?: string) {
  const result = Bun.spawnSync({ cmd, stdout: stdout ? openSync(stdout, "w") : "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) console.log(`${cmd.slice(0, 3).join(" ")} exited with ${result.exitCode}`);
}

let inputs = path("jsonl");
if (!existsSync(inputs)) script("collect.ts", "--out", inputs, ...args);
if (mutation) {
  const mutated = path(`mutated-${mutation[0]}.jsonl`);
  if (!existsSync(mutated)) script("mutate.ts", typescript, inputs, mutated, ...mutation);
  inputs = mutated;
}
const stem = inputs.replace(/\.jsonl$/, "");
for (const [dialect, expected, flags] of [
  ["typescript-estree", "expected.ts", []],
  ["espree", "expected-espree.ts", ["--espree"]],
] as const) {
  const parser = dialect === "espree" ? espree : typescript;
  if (!parser) continue;
  if (!existsSync(`${stem}.${dialect}.jsonl`)) script(expected, parser, inputs, `${stem}.${dialect}.jsonl`);
  run([bin, "ast", "estree-batch", inputs, ...flags], `${stem}.${dialect}.actual.jsonl`);
  console.log(`──── ${dialect}`);
  script("diff.ts", inputs, `${stem}.${dialect}.jsonl`, `${stem}.${dialect}.actual.jsonl`);
}
console.log("──── bun-lint ast check-batch");
run([bin, "ast", "check-batch", inputs]);
