// Which of the tests in the compiled code does a request run, and which of them has only ever gone one way?
//
//   bun tests-by-request.ts --bun <bun with --aot> --server koa      the other options: ./counted-server.ts
//
// --aot-count-branches gives each side of each test a counter of its own, and the map of the code says where each test stands.
// A test that has never gone the other way in the whole longer run, start included, is printed as one-sided: the compiler could not prove what held every time.
import { readFileSync } from "node:fs";
import { countServer, printTable, type Count } from "./counted-server";

const { title, short, long, sent, rows, map, work } = await countServer("--aot-count-branches");
const bySide = (counts: Count[]) => new Map(counts.filter(({ name }) => name.startsWith("branch:")).map(({ name, count }) => [Number(name.slice(7)), count]));
const [before, after] = [bySide(short), bySide(long)];

const tests: { runs: number; isOneSided: boolean; kind: string; origin: string; file: string; position: string; functionName: string }[] = [];
let functionName = "?";
let place: string[] | undefined;
for (const line of readFileSync(map, "utf8").split("\n")) {
  const fields = line.split("\t");
  if (fields[0] === "F") functionName = fields[7] || "(no name)";
  else if (fields[0] === "Q") place = fields;
  else if (fields[0] === "q" && place) {
    const sides = [Number(place[1]), Number(place[2])];
    const runs = sides.reduce((sum, side) => sum + (after.get(side) ?? 0) - (before.get(side) ?? 0), 0) / sent;
    if (runs > 0) tests.push({ runs, isOneSided: sides.some(side => !after.get(side)), kind: fields[2], origin: (fields[6] === "Operation" ? fields[7] : fields[6]) || "nothing", file: place[5].replace(/.*node_modules\//, ""), position: place[4], functionName });
    place = undefined;
  }
}

const sumOf = (list: typeof tests) => list.reduce((sum, test) => sum + test.runs, 0).toFixed(1);
const oneSided = tests.filter(test => test.isOneSided);
console.log(`${title}: ${sumOf(tests)} tests a request at ${tests.length} places; one-sided ${sumOf(oneSided)} at ${oneSided.length} places`);
const table = (by: string, keyOf: (test: (typeof tests)[number]) => string) => printTable(`one-sided tests a request, by ${by}`, oneSided.map(test => [keyOf(test), test.runs]), rows);
table("the kind of test", test => test.kind);
table("where the tested value comes from", test => `${test.kind} of ${test.origin}`);
table("function", test => `${test.functionName}  ${test.file}`);
table("place", test => `${test.kind}  ${test.functionName}  ${test.file}@${test.position}`);
console.log(`\nthe executable, its map and the counts: ${work}`);
