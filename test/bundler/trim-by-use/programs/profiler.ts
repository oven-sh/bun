import { Session } from "node:inspector";
import { heapStats } from "bun:jsc";
import v8 from "node:v8";

function work(rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += Math.sqrt(round) % 7;
  return sum;
}
const session = new Session();
session.connect();
session.post("Profiler.enable");
let stopped: { error: unknown; profile: any };
for (let milliseconds = 60; ; milliseconds *= 2) {
  session.post("Profiler.start");
  const until = Date.now() + milliseconds;
  while (Date.now() < until) work(20000);
  stopped = await new Promise(resolve =>
    session.post("Profiler.stop", (error: unknown, result: any) => resolve({ error, profile: result?.profile })),
  );
  if (stopped.error != null || stopped.profile.samples.length > 0 || milliseconds > 30_000) break;
}
console.log(stopped.error == null, stopped.profile.nodes.length > 1, stopped.profile.samples.length > 0);
session.disconnect();
const snapshot: any = Bun.generateHeapSnapshot();
console.log(snapshot.version, snapshot.nodes.length > 1000, snapshot.nodeClassNames.includes("Function"));
const text: string = Bun.generateHeapSnapshot("v8");
console.log(JSON.parse(text).snapshot.meta.node_fields[0]);
console.log(heapStats().objectCount > 100, v8.getHeapStatistics().used_heap_size > 0);
