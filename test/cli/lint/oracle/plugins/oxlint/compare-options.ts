// The options that oxlint accepts for a rule are accepted by `bun lint` beside an .oxlintrc.json: a configuration that is refused ends the run.
//
//   BUN_LINT="<bun-lint> cli" bun compare-options.ts
//   OXLINT_BIN=<oxlint 1.87> bun compare-options.ts --record [--from=<directory with the test cases of the conformance suites>]
//
// options.json has, for each rule that both have, the options that oxlint accepts and those that it refuses. `--record` asks oxlint about each of
// them again, one run for each, and with `--from` about all options in the test cases too.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Recorded = Record<string, { accepted: unknown[][]; refused: unknown[][] }>;
const path = join(import.meta.dir, "options.json");
const recorded: Recorded = JSON.parse(readFileSync(path, "utf8"));

/** Configurations that have all accepted options between them: the first of each rule, the second of each rule that has two, .. */
export function configurations(all: Recorded): Record<string, unknown>[] {
  const most = Math.max(...Object.values(all).map(it => it.accepted.length));
  return Array.from({ length: most }, (_, index) => ({
    plugins: ["typescript"],
    categories: { correctness: "off" },
    rules: Object.fromEntries(
      Object.entries(all)
        .filter(([, it]) => index < it.accepted.length)
        .map(([rule, it]) => [rule, ["error", ...it.accepted[index]]]),
    ),
  }));
}

/** What the tool says if it refuses one of the configurations, each of which has a directory of its own. */
function refusal(command: string[], configs: object[]): string | undefined {
  const cwd = mkdtempSync(join(tmpdir(), "oxlint-options-"));
  try {
    writeFileSync(join(cwd, ".oxlintrc.json"), JSON.stringify({ categories: { correctness: "off" } }));
    configs.forEach((config, index) => {
      mkdirSync(join(cwd, String(index)));
      writeFileSync(join(cwd, String(index), ".oxlintrc.json"), JSON.stringify(config));
      writeFileSync(join(cwd, String(index), "a.ts"), "export {};\n");
    });
    const { stdout, stderr } = spawnSync(command[0], [...command.slice(1), "-f", "json", "."], { cwd, encoding: "utf8" });
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
    for (const [rule, { accepted, refused }] of Object.entries(recorded)) {
      const candidates = new Map([...accepted, ...refused].map(it => [JSON.stringify(it), it]));
      const [directory, name] = rule.includes("/") ? ["typescript-eslint", rule.split("/")[1]] : ["eslint", rule];
      for (const suite of from ? ["", ...readdirSync(join(from, "more")).map(it => `more/${it}`)] : []) {
        const file = join(from!, suite, directory, `${name}.json`);
        if (!existsSync(file)) continue;
        for (const it of JSON.parse(readFileSync(file, "utf8")).cases) {
          if (it.options?.length) candidates.set(JSON.stringify(it.options), it.options);
        }
      }
      next[rule] = { accepted: [], refused: [] };
      for (const options of candidates.values()) {
        next[rule][refusal([process.env.OXLINT_BIN!], [one(rule, options)]) === undefined ? "accepted" : "refused"].push(options);
      }
    }
    writeFileSync(path, JSON.stringify(next, null, 1) + "\n");
  } else {
    const ours = (process.env.BUN_LINT ?? "bun lint").split(" ");
    let count = 0;
    if (refusal(ours, configurations(recorded)) !== undefined) {
      for (const [rule, { accepted }] of Object.entries(recorded)) {
        for (const options of accepted) {
          const message = refusal(ours, [one(rule, options)]);
          if (message !== undefined) console.log(`${++count}. ${rule} ${JSON.stringify(options)}\n   ${message.replace(/\s+/g, " ")}`);
        }
      }
    }
    const total = Object.values(recorded).reduce((sum, it) => sum + it.accepted.length, 0);
    console.log(`${total} options that oxlint accepts, ${count} refused`);
    process.exit(count ? 1 : 0);
  }
}
