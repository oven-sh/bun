// Compares `bun-lint regex exec` with the `RegExp` of the Bun, or the Node.js, that runs this script.
//
//   bun|node test/cli/lint/oracle/regex/exec.ts <bun-lint> <source>.. [--seed=n] [--verbose]
//
// A source of (pattern, flags, text, lastIndex) is one of
//   literals:<typescript module>:<dir>,<dir>..   the regular expressions in the JavaScript and TypeScript files of the directories,
//                                                on text made from each and on lines of the files
//   fixtures:<test/cli/lint/conformance/fixtures>  the patterns in the options of the test cases, on pieces of their code
//   test262:<test262 checkout>                   what the tests of RegExp and of the methods of String execute
//   fuzz:<count>                                 random patterns on random text
//   file:<path>                                  what `--failures=<path>` wrote
//
// JavaScriptCore and V8 each have bugs of their own. What differs from one is to be checked with the other:
//   bun exec.ts <bun-lint> fuzz:100000 --failures=failures; node exec.ts <bun-lint> file:failures

import { appendFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { type Case, casesOf, setSeed } from "./cases.ts";
import { ask, hex } from "./common.ts";

const [binary, ...rest] = process.argv.slice(2);
const sources = rest.filter(a => !a.startsWith("--"));
const verbose = rest.includes("--verbose");
setSeed(Number(rest.find(a => a.startsWith("--seed="))?.slice(7) ?? 1));
const failures = rest.find(a => a.startsWith("--failures="))?.slice(11);
if (failures) writeFileSync(failures, "");

// == the comparison ==

function expected([pattern, flags, text, lastIndex]: Case): unknown {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags.includes("d") ? flags : `${flags}d`);
  } catch {
    return "error";
  }
  regex.lastIndex = lastIndex;
  const match = regex.exec(text) as any;
  if (!match) return null;
  return {
    indices: [...match.indices].map(range => range ?? null),
    groups: Object.fromEntries(Object.entries(match.indices.groups ?? {}).map(([name, range]) => [name, range ?? null])),
  };
}

let total = 0;
let failed = 0;
let limits = 0;
let unsupported = 0;

function check(batch: Case[]) {
  const answers = ask(
    binary,
    "exec",
    batch.map(([pattern, flags, text, lastIndex]) => [hex(pattern), hex(flags), hex(text), String(lastIndex)]),
  );
  batch.forEach((it, i) => {
    let actual = answers[i];
    if (actual === "limit") return void limits++;
    if (actual?.error?.message.includes("not supported")) return void unsupported++;
    if (actual?.error) actual = "error";
    const wanted = expected(it);
    total++;
    if (isDeepStrictEqual(actual, wanted)) return;
    if (failures) appendFileSync(failures, `${JSON.stringify(it)}\n`);
    if (++failed > 40 && !verbose) return;
    console.log(`/${it[0]}/${it[1]} on ${JSON.stringify(it[2])} from ${it[3]}`);
    console.log(`  actual   ${JSON.stringify(answers[i])}`);
    console.log(`  expected ${JSON.stringify(wanted)}`);
  });
}

for (const source of sources) {
  const cases = casesOf(source);
  let batch: Case[] = [];
  for await (const it of cases) {
    batch.push(it);
    if (batch.length >= 50000) check(batch.splice(0));
  }
  check(batch);
  console.log(`${source.slice(0, 60)}: ${total - failed} of ${total} as RegExp so far (${limits} over the limit, ${unsupported} not supported)`);
}
process.exit(failed ? 1 : 0);
