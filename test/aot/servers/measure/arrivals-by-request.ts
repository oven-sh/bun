// How often does a request arrive at an operation that finds a property by its name, an element by its key or a callee by its value at run time, and with what?
//
//   bun arrivals-by-request.ts --bun <bun with --aot> --server koa      the other options: ./counted-server.ts
//
// --aot-count-arrivals numbers those operations and counts, for each, what arrived there: an object with a layout of the compiler's, one that has left its layout, an ordinary object, a built-in.
// The map of the code says where each operation stands, what the compiler expected there and which names each layout has.
import { readFileSync } from "node:fs";
import { countServer, printTable, type Count } from "./counted-server";

const { title, short, long, sent, rows, map, work } = await countServer("--aot-count-arrivals");
const placeOf = new Map<string, string>();
const layoutOf = new Map<string, string>();
for (const line of readFileSync(map, "utf8").split("\n")) {
  const [tag, number, ...fields] = line.split("\t");
  if (tag === "L") layoutOf.set(number, `${number} ${fields[1] || fields[0]}{${fields[3]}}`);
  if (tag !== "S") continue;
  const [operation, , level, cause, , path, lineNumber, column, functionName, expected] = fields;
  placeOf.set(number, `${path.replace(/.*node_modules\//, "")}:${lineNumber}:${column} ${functionName || "(no name)"} ${operation} ${level}${cause === "Unknown" ? "" : " " + cause}${expected ? " expects " + expected : ""}`);
}
const named = (what: string) => what.replace(/^layout:(\d+)/, (whole, number) => `layout:${layoutOf.get(number) ?? number}`);
const keyed = (counts: Count[]) => new Map(counts.filter(({ name }) => name.startsWith("arrival:")).map(({ name, what, count }) => [`${name}\t${what}`, count]));
const before = keyed(short);
const arrivals = [...keyed(long)].map(([key, count]) => ({ site: key.split("\t")[0].slice(8), what: key.split("\t")[1], runs: (count - (before.get(key) ?? 0)) / sent })).filter(({ runs }) => runs > 0);

function familyOf(what: string) {
  if (what.startsWith("layout:")) return what.includes("+changed") ? "an object that has left its layout" : "an object with a layout";
  if (what.startsWith("object{")) return "an ordinary object";
  if (what.startsWith("class:")) return `built-in ${what.slice(6)}`;
  if (what.startsWith("function:")) return "a function";
  return what.split(":")[0];
}
console.log(`${title}: ${arrivals.reduce((sum, { runs }) => sum + runs, 0).toFixed(1)} arrivals a request at ${new Set(arrivals.map(({ site }) => site)).size} operations`);
printTable("arrivals a request, by the kind of thing that arrived", arrivals.map(({ what, runs }) => [familyOf(what), runs]), rows);
printTable("arrivals a request, by what arrived", arrivals.map(({ what, runs }) => [named(what).slice(0, 160), runs]), rows);
printTable("arrivals a request, by operation and what arrived", arrivals.map(({ site, what, runs }) => [`${placeOf.get(site) ?? site}  <-  ${named(what).slice(0, 160)}`, runs]), rows);
console.log(`\nthe executable and the counts: ${work}`);
