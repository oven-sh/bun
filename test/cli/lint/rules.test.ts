import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { bun } from "./lint-helpers";

type Report = { line: number; column: number; message: string };
// `eslintTest`: the case is in ESLint's own test of the rule. `differs`: how ESLint's answer, in `eslint`, is another.
type Case = { code: string; jsx?: true; expect: Report[]; differs?: string; eslint?: Report[]; eslintTest?: true };

const rulesDir = join(import.meta.dir, "rules");
// `rules/<rule>.json` holds the cases of one rule.
const rules = [...new Bun.Glob("*.json").scanSync(rulesDir)].map(file => file.slice(0, -".json".length)).sort();

describe("bun --lint rules", () => {
  test.concurrent.each(rules)("%s", async rule => {
    const cases: Case[] = await Bun.file(join(rulesDir, `${rule}.json`)).json();
    // Each case is a file of its own and one run checks them all.
    const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.jsx ? "jsx" : "js"}`);
    using dir = tempDir(`lint-${rule}`, Object.fromEntries(cases.map((c, i) => [names[i], c.code])));
    const { stdout, stderr, exitCode } = await bun(String(dir), ["--lint", ...names]);

    // The plain format writes a line break inside a message as one space.
    const expected = cases.map((c, i) =>
      c.expect.map(r => `${names[i]}(${r.line},${r.column}): error ${rule}: ${r.message.replace(/\r\n?|\n/g, " ")}`),
    );
    const received: string[][] = cases.map(() => []);
    const unexpected: string[] = [];
    for (const line of stderr.split("\n").filter(Boolean)) {
      const [, name, category, code] = /^(c\d+\.jsx?)\(\d+,\d+\): (\w+) ([\w-]+): /.exec(line) ?? [];
      const lines = received[names.indexOf(name)];
      if (!lines) unexpected.push(line);
      else if (code === rule) lines.push(line);
      // Another rule has its own cases, and a warning of the parser is not a report of a rule.
      else if (!rules.includes(code) && !(category === "warning" && code === "syntax")) unexpected.push(line);
    }
    const wrong = cases
      .map((c, i) => ({ code: c.code, expected: expected[i], received: received[i] }))
      .filter(c => !Bun.deepEquals(c.received, c.expected));

    expect({ stdout, unexpected, wrong, exitCode }).toEqual({ stdout: "", unexpected: [], wrong: [], exitCode: 2 });
  });
});
