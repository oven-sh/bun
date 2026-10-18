// Diagnostic only: disposed-while-building-pages.mjs with a report of where it is stuck or what is kept.
import { heapStats } from "bun:jsc";
const [fixtures, reportPath] = process.argv.slice(2);
const t0 = performance.now();
const say = line => console.error("DIAG " + (performance.now() - t0).toFixed(0) + "ms " + line);
const turn = () => new Promise(resolve => setImmediate(resolve));
const until = async (condition, what) => {
  const start = performance.now();
  while (!condition()) {
    await turn();
    if (performance.now() - start > 10000) {
      say("STUCK: " + what());
      console.log("stuck");
      process.exit(0);
    }
  }
};
const servers = () => {
  Bun.gc(true);
  const counts = heapStats().objectTypeCounts;
  return (counts.HTTPServer ?? 0) + (counts.DebugHTTPServer ?? 0);
};
const weak = [],
  sockets = [];
const use = async n => {
  const seen = { open: 0, data: 0, close: 0, error: 0, rejected: 0 };
  sockets.push(seen);
  const graph = new Bun.ModuleGraph();
  const app = await graph.import(fixtures + "/serves-html-routes.mjs");
  const server = graph.run(() => app.serve());
  weak.push(new WeakRef(server));
  if (process.env.DIAG_FORCE === "kept" && n >= 2) (globalThis.held ??= []).push(server);
  for (const path of app.paths)
    Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        open: socket => {
          seen.open++;
          socket.write("GET " + path + " HTTP/1.1\r\nHost: x\r\n\r\n");
        },
        data() {
          seen.data++;
        },
        close() {
          seen.close++;
        },
        error() {
          seen.error++;
        },
      },
    }).catch(() => {
      seen.rejected++;
    });
  let polls = 0;
  await until(
    () => (polls++, server.pendingRequests >= (process.env.DIAG_FORCE === "stuck" && n === 2 ? 99 : 1)),
    () =>
      `use ${n}: waiting for a pending request, pendingRequests ${server.pendingRequests}, polls ${polls}, sockets ${JSON.stringify(seen)}`,
  );
  const pending = server.pendingRequests;
  graph.dispose();
  say(
    `use ${n}: disposed after ${polls} polls with ${pending} pending, then ${server.pendingRequests}; sockets ${JSON.stringify(seen)}`,
  );
};
await use(0);
let none,
  readings = 0;
await until(
  () => {
    const before = none;
    readings++;
    return (none = servers()) === before;
  },
  () => `baseline, reading ${none}`,
);
say(`baseline ${none} after ${readings} readings`);
if (process.env.DIAG_FORCE === "floor") none = 1;
for (let i = 1; i <= 3; i++) await use(i);
let turns = 0;
await until(
  () => servers() <= none || ++turns === 2000,
  () => `the 2000 turns, at ${turns}`,
);
const kept = servers() - none;
say(`after ${turns} turns: kept ${kept}; sockets ${JSON.stringify(sockets)}`);
if (kept <= 0) {
  console.log("collected");
  process.exit(0);
}
(await import(reportPath)).report(["HTTPServer", "DebugHTTPServer"]);
await turn();
say(
  "servers by use: " +
    weak
      .map(ref => {
        const server = ref.deref();
        return server ? "alive, pendingRequests " + server.pendingRequests : "gone";
      })
      .join("; "),
);
await turn();
const start = performance.now();
let more = 0;
while (servers() > none && performance.now() - start < 12000) {
  more++;
  await turn();
}
say(
  `${servers() <= none ? "COLLECTED LATER" : "STILL KEPT"} after ${more} more turns, ${(performance.now() - start).toFixed(0)} ms; sockets ${JSON.stringify(sockets)}`,
);
console.log("kept " + kept);
process.exit(0);
