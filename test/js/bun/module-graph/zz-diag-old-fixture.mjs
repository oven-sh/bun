// Diagnostic only, not for merging: disposed-while-building-pages.mjs as it is on main, with a report
// of what keeps the server made in the turn that would have printed "kept", under the callers its collection had.
import { heapStats } from "bun:jsc";
import { copyStack, prepareStack, report } from "./zz-diag-report.mjs";
const [fixtures] = process.argv.slice(2);
prepareStack();
const until = async condition => {
  while (!condition()) await new Promise(resolve => setImmediate(resolve));
};
const servers = () => {
  Bun.gc(true);
  const counts = heapStats().objectTypeCounts;
  return (counts.HTTPServer ?? 0) + (counts.DebugHTTPServer ?? 0);
};
const use = async () => {
  const graph = new Bun.ModuleGraph();
  const app = await graph.import(fixtures + "/serves-html-routes.mjs");
  const server = graph.run(() => app.serve());
  // A request for a page starts its build, which holds a pending request on the server until it is
  // done. That is a later turn's business: the build seen here is still going when dispose() runs.
  // (All of them can be done before a turn here sees one. Such a server shows nothing.)
  const answered = new Set();
  for (const path of app.paths)
    Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        open: socket => void socket.write("GET " + path + " HTTP/1.1\r\nHost: x\r\n\r\n"),
        data() {
          answered.add(path);
        },
        close() {},
        error() {},
      },
    }).catch(() => {});
  await until(() => server.pendingRequests >= 1 || answered.size === app.paths.length);
  const building = server.pendingRequests >= 1;
  graph.dispose();
  if (!building) console.error("every build was done before a turn saw one");
  return building;
};
// (One first, so the class's own cells are there before counting.)
await use();
let none;
await until(() => {
  const before = none;
  return (none = servers()) === before;
});
for (let i = 0; i < 3; ) if (await use()) i++;
// (No more than before, not as many: the first one may have outlived that reading.)
let turns = 0;
// The diagnostic's own, from here on. The loop is the fixture's until its last turn.
const say = line => console.error("DIAG " + line);
const hex = n => "0x" + n.toString(16);
const limit = Number(process.env.DIAG_TURNS ?? 2000);
// "old-floor": not the fixture's baseline, which counts the first server when that one is still being built, but
// what is there with no server at all (the class's prototype).
const floor = String(process.argv[4]).startsWith("old-floor") ? 1 : none;
const started = performance.now();
let count,
  elapsed,
  slots = [],
  watched = [],
  reported,
  seen = [];
await until(() => {
  count = servers();
  if (seen.at(-1)?.[1] !== count && seen.length < 40) seen.push([turns, count]);
  if (reported === undefined) {
    if (count <= floor) return true;
    if (++turns !== limit) return false;
    // The turn that would have printed "kept": first the stack as it is, then the heap.
    elapsed = performance.now() - started;
    const stack = copyStack();
    say(
      `old: baseline ${none}, waiting for ${floor}, count ${count}, ${turns} turns in ${elapsed.toFixed(0)} ms; counts by turn ${JSON.stringify(seen)}`,
    );
    reported = report(["HTTPServer", "DebugHTTPServer"], stack);
    slots = reported.slots ?? [];
    return false;
  }
  // Afterwards: does it go, and what do the words that pointed at it hold when it does?
  turns++;
  if (slots.length) {
    const now = copyStack();
    const words = new BigUint64Array(now.bytes);
    const held = slots.map(address => hex(words[(address - now.low) / 8])).join(" ");
    if (watched.at(-1)?.[1] !== held && watched.length < 40) watched.push([turns, held, count]);
  }
  return count <= floor || performance.now() - started - elapsed > 2500;
});
if (reported === undefined) {
  say(
    `old: baseline ${none}, waiting for ${floor}, count ${count}, ${turns} turns in ${(performance.now() - started).toFixed(0)} ms; counts by turn ${JSON.stringify(seen)}`,
  );
  console.log("collected");
  process.exit(0);
}
say(
  `old: ${count <= floor ? "COLLECTED LATER" : "STILL KEPT"} (count ${count}) at turn ${turns}, ${(performance.now() - started - elapsed).toFixed(0)} ms after the report; counts by turn ${JSON.stringify(seen)}`,
);
say(`old: the words at ${slots.map(hex).join(" ")} by turn: ${JSON.stringify(watched)}`);
console.log("kept " + (reported.cells ? reported.reached + " reached, " + reported.unreached + " not" : "?"));
process.exit(0);
