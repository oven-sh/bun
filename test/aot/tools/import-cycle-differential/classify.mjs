// Usage: bun classify.mjs <results of one build>.json <results of another build>.json
import { readFileSync } from "node:fs";
const [baseFile, fixFile, show] = process.argv.slice(2);
const base = new Map(JSON.parse(readFileSync(baseFile, "utf8")).map(r => [r.name, r]));
const fix = JSON.parse(readFileSync(fixFile, "utf8"));
const tally = {};
const kinds = {};
for (const r of fix) {
  const key = base.get(r.name).state + " -> " + r.state;
  tally[key] = (tally[key] ?? 0) + 1;
  if (r.state !== "different") continue;
  const p = r.plain.split("\n"), a = r.aot.split("\n");
  let at = 0;
  while (at < Math.max(p.length, a.length) && p[at] === a[at]) at++;
  // Which states differ on the first different line.
  const states = line => new Map((line ?? "").replace(/^[^:]*: /, "").split(", ").map(part => part.split(" = ")));
  let kind;
  if (/^(behind step|at the end)/.test(p[at] ?? "") && /^(behind step|at the end)/.test(a[at] ?? "")) {
    const ps = (p[at] ?? "").replace(/^[^:]*: /, "").split(", "), as = (a[at] ?? "").replace(/^[^:]*: /, "").split(", ");
    const found = new Set();
    for (let i = 0; i < ps.length; i++) if (ps[i] !== as[i]) found.add(`${(ps[i] ?? "").split(" = ")[1]?.replace(/ by .*/, "")} => ${(as[i] ?? "").split(" = ")[1]?.replace(/ by .*/, "")}`);
    kind = "promise: " + [...found].sort().join(" | ");
  } else kind = "line: " + (p[at] ?? "<none>").replace(/m\d/g, "mN").slice(0, 60) + " => " + (a[at] ?? "<none>").replace(/m\d/g, "mN").slice(0, 60);
  (kinds[kind] ??= []).push(r.name + (base.get(r.name).state === "same" ? "(REGRESSION)" : ""));
}
console.log(tally);
for (const [kind, names] of Object.entries(kinds).sort((x, y) => y[1].length - x[1].length)) console.log(names.length, kind, "\n    ", names.slice(0, 12).join(" "));
