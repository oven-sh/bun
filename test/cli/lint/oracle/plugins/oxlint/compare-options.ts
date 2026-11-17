// Checks that `bun lint` with an .oxlintrc.json accepts every rule option that oxlint accepts. A rejected config ends
// the run, so this matters.
//
//   BUN_LINT="bun lint" bun compare-options.ts
//   OXLINT_BIN=<oxlint 1.87> bun compare-options.ts --record [--from=<directory with the test cases of the conformance suites>]
//
// options.json lists the options oxlint accepts for each rule that both tools have. `--record` tries each of them on
// oxlint again, one run per option set. With `--from` it also tries every option set in the test cases.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Recorded = Record<string, unknown[][]>;
const path = join(import.meta.dir, "options.json");
const recorded: Recorded = JSON.parse(readFileSync(path, "utf8"));

/** Returns configs that together cover all the accepted options. Config `n` has every rule's `n`-th option set. */
export function configurations(all: Recorded): Record<string, unknown>[] {
  const most = Math.max(...Object.values(all).map(it => it.length));
  return Array.from({ length: most }, (_, index) => ({
    plugins: ["typescript"],
    categories: { correctness: "off" },
    rules: Object.fromEntries(
      Object.entries(all)
        .filter(([, it]) => index < it.length)
        .map(([rule, it]) => [rule, ["error", ...it[index]]]),
    ),
  }));
}

/** Runs the tool with each config in its own directory. Returns its error output if it rejects one of them. */
function rejectionMessage(command: string[], configs: object[]): string | undefined {
  const cwd = mkdtempSync(join(tmpdir(), "oxlint-options-"));
  try {
    writeFileSync(join(cwd, ".oxlintrc.json"), JSON.stringify({ categories: { correctness: "off" } }));
    configs.forEach((config, index) => {
      mkdirSync(join(cwd, String(index)));
      writeFileSync(join(cwd, String(index), ".oxlintrc.json"), JSON.stringify(config));
      writeFileSync(join(cwd, String(index), "a.ts"), "export {};\n");
    });
    const { stdout, stderr } = spawnSync(command[0], [...command.slice(1), "-f", "json", "."], {
      cwd,
      encoding: "utf8",
    });
    return stdout.includes('"number_of_files"') ? undefined : (stderr || stdout).trim();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const one = (rule: string, options: unknown[]) => ({
  plugins: ["typescript"],
  categories: { correctness: "off" },
  rules: { [rule]: ["error", ...options] },
});

if (import.meta.main) {
  if (process.argv.includes("--record")) {
    const from = process.argv.find(it => it.startsWith("--from="))?.slice("--from=".length);
    const next: Recorded = {};
    for (const [rule, accepted] of Object.entries(recorded)) {
      const candidates = new Map(accepted.map(it => [JSON.stringify(it), it]));
      const [directory, name] = rule.includes("/") ? ["typescript-eslint", rule.split("/")[1]] : ["eslint", rule];
      for (const suite of from ? ["", ...readdirSync(join(from, "more")).map(it => `more/${it}`)] : []) {
        const file = join(from!, suite, directory, `${name}.json`);
        if (!existsSync(file)) continue;
        for (const it of JSON.parse(readFileSync(file, "utf8")).cases) {
          if (it.options?.length) candidates.set(JSON.stringify(it.options), it.options);
        }
      }
      next[rule] = [...candidates.values()].filter(
        it => rejectionMessage([process.env.OXLINT_BIN!], [one(rule, it)]) === undefined,
      );
    }
    writeFileSync(path, JSON.stringify(next, null, 1) + "\n");
  } else {
    const ours = (process.env.BUN_LINT ?? "bun lint").split(" ");
    let count = 0;
    if (rejectionMessage(ours, configurations(recorded)) !== undefined) {
      for (const [rule, accepted] of Object.entries(recorded)) {
        for (const options of accepted) {
          const message = rejectionMessage(ours, [one(rule, options)]);
          if (message !== undefined)
            console.log(`${++count}. ${rule} ${JSON.stringify(options)}\n   ${message.replace(/\s+/g, " ")}`);
        }
      }
    }
    const total = Object.values(recorded).reduce((sum, it) => sum + it.length, 0);
    console.log(`${total} options that oxlint accepts, ${count} refused`);
    process.exit(count ? 1 : 0);
  }
}
