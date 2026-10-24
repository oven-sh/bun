// How often does a request arrive at an operation that finds a property by its name, an element by its key or a callee by its value at run time, and with what?
//
//   bun arrivals-by-request.ts --bun <bun with --aot> --server koa      the other options: ./counted-server.ts
//
// --aot-count-arrivals numbers those operations and counts, for each, what arrived there: an object with a layout of the compiler's, one that has left its layout, an ordinary object, a built-in.
import { countServer, printTable, type Count } from "./counted-server";

const { title, short, long, sent, rows, work } = await countServer("--aot-count-arrivals");
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
printTable("arrivals a request, by what arrived", arrivals.map(({ what, runs }) => [what.slice(0, 100), runs]), rows);
printTable("arrivals a request, by operation and what arrived", arrivals.map(({ site, what, runs }) => [`${site}  ${what.slice(0, 100)}`, runs]), rows);
console.log(`\nthe executable and the counts: ${work}`);
