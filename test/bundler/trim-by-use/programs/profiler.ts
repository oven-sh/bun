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
session.post("Profiler.start");
const until = Date.now() + 60;
while (Date.now() < until) work(20000);
session.post("Profiler.stop", (error: unknown, result: any) => {
  console.log(error == null, result.profile.nodes.length > 1, result.profile.samples.length > 0);
});
session.disconnect();
const snapshot: any = Bun.generateHeapSnapshot();
console.log(snapshot.version, snapshot.nodes.length > 1000, snapshot.nodeClassNames.includes("Function"));
const text: string = Bun.generateHeapSnapshot("v8");
console.log(JSON.parse(text).snapshot.meta.node_fields[0]);
console.log(heapStats().objectCount > 100, v8.getHeapStatistics().used_heap_size > 0);
