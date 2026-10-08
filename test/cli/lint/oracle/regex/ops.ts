// Compares `bun-lint regex ops` with the methods of `RegExp` and `String` of the Bun, or the Node.js, that runs this script: `test`, `search`,
// `match`, `matchAll`, `replace` and `split`.
//
//   bun|node test/cli/lint/oracle/regex/ops.ts <bun-lint> <source>.. [--seed=n]
//
// The sources and `--failures` are those of exec.ts.

import { appendFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { type Case, casesOf, pick, setSeed } from "./cases.ts";
import { ask, hex } from "./common.ts";

const [binary, ...rest] = process.argv.slice(2);
const sources = rest.filter(a => !a.startsWith("--"));
setSeed(Number(rest.find(a => a.startsWith("--seed="))?.slice(7) ?? 1));
const failures = rest.find(a => a.startsWith("--failures="))?.slice(11);
if (failures) writeFileSync(failures, "");

const REPLACEMENTS = ["", "x", "$&", "[$1]", "$2$1", "$$", "$`|$'", "$<n0>", "$<", "$10", "$01", "$0", "$", "a$", "$<nope>!", "$9"];
type Request = [op: string, pattern: string, flags: string, text: string, replacement: string];

function expected([op, pattern, flags, text, replacement]: Request): unknown {
  const regex = new RegExp(pattern, flags);
  const all = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
  switch (op) {
    case "test":
      return regex.test(text);
    case "toString":
      return String(regex);
    case "search":
      return text.search(regex);
    case "match":
      return text.match(all) ?? [];
    case "matchAll":
      return [...text.matchAll(new RegExp(all, `${all.flags.replace("d", "")}d`))].map((m: any) => [...m.indices].map(r => r ?? null));
    case "replace":
      return text.replace(regex, replacement);
    default:
      return text.split(regex).map(part => part ?? "");
  }
}

let total = 0;
let failed = 0;

function check(batch: Request[]) {
  const answers = ask(
    binary,
    "ops",
    batch.map(([op, ...strings]) => [op, ...strings.map(hex)]),
  );
  batch.forEach((it, i) => {
    if (answers[i]?.error || answers[i] === "limit") return;
    const wanted = expected(it);
    // Half of a surrogate pair on its own cannot be told from the bytes.
    if (JSON.stringify(wanted) !== JSON.stringify(wanted, (_, v) => (typeof v === "string" ? v.toWellFormed() : v))) return;
    total++;
    if (isDeepStrictEqual(answers[i], wanted)) return;
    if (failures) appendFileSync(failures, `${JSON.stringify([it[1], it[2], it[3], 0])}\n`);
    if (++failed > 40) return;
    console.log(`${it[0]} /${it[1]}/${it[2]} on ${JSON.stringify(it[3])} with ${JSON.stringify(it[4])}`);
    console.log(`  actual   ${JSON.stringify(answers[i])}`);
    console.log(`  expected ${JSON.stringify(wanted)}`);
  });
}

for (const source of sources) {
  let batch: Request[] = [];
  for await (const [pattern, flags, text] of casesOf(source) as AsyncIterable<Case>) {
    try {
      new RegExp(pattern, flags);
    } catch {
      continue;
    }
    // JavaScriptCore escapes the source in another way than V8, which is what ESLint prints.
    for (const op of ["test", "search", "match", "matchAll", "replace", "split", ...(process.versions.bun ? [] : ["toString"])]) {
      batch.push([op, pattern, flags, text, op === "replace" ? pick(REPLACEMENTS) : ""]);
    }
    if (batch.length >= 60000) check(batch.splice(0));
  }
  check(batch);
  console.log(`${source.slice(0, 60)}: ${total - failed} of ${total} as JavaScript so far`);
}
process.exit(failed ? 1 : 0);
