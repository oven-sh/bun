// Which of the tests in the compiled code does a request fail, and where? Behind a failed test the rest of the function often runs in its generic copy, where every access goes by name.
//
//   bun failed-tests-by-request.ts --bun <bun with --aot> --server koa      the other options: ./counted-server.ts
//
// --aot-count-branches gives each side of each test a counter of its own, and the map of the code says where each test stands and which side the compiler laid out as the less likely one.
// A test fails when it takes that side. A test whose sides are laid out alike is left out.
import { readFileSync } from "node:fs";
import { countServer, printTable, type Count } from "./counted-server";

const { title, short, long, sent, rows, map, work } = await countServer("--aot-count-branches");
const bySide = (counts: Count[]) =>
  new Map(
    counts.filter(({ name }) => name.startsWith("branch:")).map(({ name, count }) => [Number(name.slice(7)), count]),
  );
const [before, after] = [bySide(short), bySide(long)];
const runsOf = (side: number) => ((after.get(side) ?? 0) - (before.get(side) ?? 0)) / sent;
const likelihoods = ["Normal", "Unlikely", "Rare"];

const tests: {
  failures: number;
  kind: string;
  origin: string;
  file: string;
  position: string;
  functionName: string;
}[] = [];
let functionName = "?";
let place: string[] | undefined;
for (const line of readFileSync(map, "utf8").split("\n")) {
  const fields = line.split("\t");
  if (fields[0] === "F") functionName = fields[7] || "(no name)";
  else if (fields[0] === "Q") place = fields;
  else if (fields[0] === "q" && place) {
    const difference = likelihoods.indexOf(fields[3]) - likelihoods.indexOf(fields[4]);
    const failures = difference > 0 ? runsOf(Number(place[1])) : difference < 0 ? runsOf(Number(place[2])) : 0;
    if (failures > 0)
      tests.push({
        failures,
        kind: fields[2],
        origin: (fields[6] === "Operation" ? fields[7] : fields[6]) || "nothing",
        file: place[5].replace(/.*node_modules\//, ""),
        position: place[4],
        functionName,
      });
    place = undefined;
  }
}

console.log(
  `${title}: ${tests.reduce((sum, test) => sum + test.failures, 0).toFixed(1)} failed tests a request at ${tests.length} places`,
);
const table = (by: string, keyOf: (test: (typeof tests)[number]) => string) =>
  printTable(
    `failed tests a request, by ${by}`,
    tests.map(test => [keyOf(test), test.failures]),
    rows,
  );
table("the kind of test", test => test.kind);
table("where the tested value comes from", test => `${test.kind} of ${test.origin}`);
table("function", test => `${test.functionName}  ${test.file}`);
table("place", test => `${test.kind}  ${test.functionName}  ${test.file}@${test.position}`);
console.log(`\nthe executable, its map and the counts: ${work}`);
