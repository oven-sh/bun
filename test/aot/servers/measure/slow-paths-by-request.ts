// Which counters of the run time grow with the number of requests, and by how much a request? A cache that hits and a fast path that is taken count nothing here.
//
//   bun slow-paths-by-request.ts --bun <bun with --aot> --server koa      the other options: ./counted-server.ts
import { countServer, printTable, type Count } from "./counted-server";

const { title, short, long, sent, rows, work } = await countServer("--aot-count-arrivals");
const keyed = (counts: Count[]) => { const sums = new Map<string, number>(); for (const { name, what, count } of counts) if (!name.startsWith("arrival:")) sums.set(`${name}\t${what}`, (sums.get(`${name}\t${what}`) ?? 0) + count); return sums; };
const before = keyed(short);
const grown = [...keyed(long)].map(([key, count]) => [key.replace("\t", "  ").slice(0, 160), (count - (before.get(key) ?? 0)) / sent] as [string, number]).filter(([, runs]) => runs >= 0.01);
printTable(`${title}: counters that grow, a request`, grown, rows);
console.log(`\nthe executable and the counts: ${work}`);
