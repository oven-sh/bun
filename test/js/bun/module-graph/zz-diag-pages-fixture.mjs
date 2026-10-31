// Diagnostic only, not for merging. Adapted from the fixture of oven-sh/bun#45816.
//   weak:        disposed-while-building-pages.mjs with a WeakRef to every server and counts of what its sockets
//                heard, so that a server that is kept can be asked for its pending requests.
//   time-plain:  the servers are held on purpose; says when each one's builds were done.
//   time-gc:     the same, with the collection and the count of the fixture's last loop in every turn.
import { heapStats } from "bun:jsc";
import { copyStack, prepareStack, report } from "./zz-diag-report.mjs";
const [fixtures, , mode] = process.argv.slice(2);
prepareStack();
const t0 = performance.now();
const say = line => console.error("DIAG " + (performance.now() - t0).toFixed(0) + "ms " + line);
const turn = () => new Promise(resolve => setImmediate(resolve));
const until = async (condition, what) => {
  const start = performance.now();
  while (!condition()) {
    await turn();
    if (performance.now() - start > 20000) {
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
  held = [],
  sockets = [];
const use = async n => {
  const seen = { open: 0, data: 0, close: 0, error: 0, rejected: 0 };
  sockets.push(seen);
  const graph = new Bun.ModuleGraph();
  const app = await graph.import(fixtures + "/serves-html-routes.mjs");
  const server = graph.run(() => app.serve());
  if (mode === "weak") weak.push(new WeakRef(server));
  else held.push({ server, seen, log: [] });
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
    () => (polls++, server.pendingRequests >= 1 || seen.data === app.paths.length),
    () =>
      `use ${n}: waiting for a pending request, pendingRequests ${server.pendingRequests}, polls ${polls}, sockets ${JSON.stringify(seen)}`,
  );
  const pending = server.pendingRequests;
  graph.dispose();
  if (held.length) held.at(-1).log.push([+(performance.now() - t0).toFixed(0), server.pendingRequests]);
  say(
    `use ${n}: disposed after ${polls} polls with ${pending} pending, then ${server.pendingRequests}; sockets ${JSON.stringify(seen)}`,
  );
};

if (mode !== "weak") {
  // How long do the builds of the four disposed servers take here, in time and in turns?
  for (let i = 0; i < 4; i++) await use(i);
  const start = performance.now();
  let turns = 0;
  await until(
    () => {
      turns++;
      if (mode === "time-gc") servers();
      let done = true;
      for (const { server, seen, log } of held) {
        const pending = server.pendingRequests;
        if (log.at(-1)[1] !== pending) log.push([+(performance.now() - t0).toFixed(0), pending]);
        if (pending !== 0 || seen.close + seen.rejected + seen.error < 6) done = false;
      }
      return done;
    },
    () => `${mode}: builds or sockets, ${JSON.stringify(held.map(({ seen, log }) => ({ seen, log })))}`,
  );
  say(
    `${mode}: every build done and every socket closed after ${turns} turns, ${(performance.now() - start).toFixed(0)} ms; pending requests by server over time: ${JSON.stringify(held.map(({ log }) => log))}; sockets ${JSON.stringify(sockets)}`,
  );
  console.log("timed");
  process.exit(0);
}

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
say(
  `baseline ${none} after ${readings} readings; first server ${weak[0].deref() ? "alive, pendingRequests " + weak[0].deref().pendingRequests : "gone"}`,
);
await turn();
for (let i = 1; i <= 3; i++) await use(i);
let turns = 0;
const limit = Number(process.env.DIAG_TURNS ?? 2000);
const started = performance.now();
let count, reported, elapsed;
await until(
  () => {
    count = servers();
    if (reported === undefined) {
      if (count <= none) return true;
      if (++turns !== limit) return false;
      // The turn that would have printed "kept": first the stack as it is, then the heap.
      elapsed = performance.now() - started;
      const stack = copyStack();
      say(
        `weak: baseline ${none}, count ${count}, ${turns} turns in ${elapsed.toFixed(0)} ms; sockets ${JSON.stringify(sockets)}`,
      );
      reported = report(["HTTPServer", "DebugHTTPServer"], stack);
      say(
        "weak: servers by use: " +
          weak
            .map(ref => {
              const server = ref.deref();
              return server ? "alive, pendingRequests " + server.pendingRequests : "gone";
            })
            .join("; "),
      );
      return false;
    }
    turns++;
    return count <= none || performance.now() - started - elapsed > 2500;
  },
  () => `the 2000 turns, at ${turns}`,
);
if (reported === undefined) {
  say(
    `weak: baseline ${none}, count ${count}, ${turns} turns in ${(performance.now() - started).toFixed(0)} ms; sockets ${JSON.stringify(sockets)}`,
  );
  console.log("collected");
  process.exit(0);
}
say(
  `weak: ${count <= none ? "COLLECTED LATER" : "STILL KEPT"} (count ${count}) at turn ${turns}, ${(performance.now() - started - elapsed).toFixed(0)} ms after the report; sockets ${JSON.stringify(sockets)}`,
);
console.log("kept " + reported.reached + " reached, " + reported.unreached + " not");
process.exit(0);
