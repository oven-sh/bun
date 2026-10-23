import { spawn } from "bun";
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "../aot/supported";

setDefaultTimeout(60_000);

const files = {
  "app.ts": `
declare const Bun: { gc(force: boolean): void; generateHeapSnapshot(): any; generateHeapSnapshot(format: "v8"): string };
class Order {
  constructor(public id: number, public customer: string, public lines: number[], public previous: Order | null) {}
}
interface Settings {
  hostName: string;
  labels: string[];
  newest: Order;
}
const orders: Order[] = [];
for (let i = 0; i < 100; i++) orders.push(new Order(i, "customer " + i, [i, i + 1], orders[i - 1] ?? null));
const settings: Settings = { hostName: "host " + orders.length, labels: ["label " + orders.length], newest: orders[99]! };
// The compiler gives no room to a field that nothing reads, and a snapshot shows what is there.
let read = settings.hostName.length + settings.labels.length + settings.newest.id;
for (const order of orders) read += order.customer.length + order.lines.length + (order.previous ? 1 : 0);
function makeCounter() {
  let count = 0;
  return function counter(): number {
    return ++count;
  };
}
async function later(): Promise<number> {
  await null;
  return 1;
}
(globalThis as unknown as Record<string, unknown>).kept = [orders, settings, makeCounter(), later];
Bun.gc(true);

const snapshot = Bun.generateHeapSnapshot();
const classOf = new Map<number, string>();
for (let i = 0; i < snapshot.nodes.length; i += 4) classOf.set(snapshot.nodes[i], snapshot.nodeClassNames[snapshot.nodes[i + 2]]);
const edgesOf = new Map<number, string[]>();
for (let i = 0; i < snapshot.edges.length; i += 4) {
  const kind: string = snapshot.edgeTypes[snapshot.edges[i + 2]];
  if (kind !== "Property") continue;
  const edges = edgesOf.get(snapshot.edges[i]) ?? [];
  edges.push(snapshot.edgeNames[snapshot.edges[i + 3]] + " -> " + classOf.get(snapshot.edges[i + 1]));
  edgesOf.set(snapshot.edges[i], edges);
}
const seen = new Map<string, number>();
for (const [node, edges] of edgesOf) {
  const key = classOf.get(node) + ": " + edges.sort().join(", ");
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
const v8 = JSON.parse(Bun.generateHeapSnapshot("v8"));
const strings = new Set<string>(v8.strings);
const fields: string[] = v8.snapshot.meta.node_fields;
const closures = new Set<string>();
for (let i = 0; i < v8.nodes.length; i += fields.length) {
  if (v8.snapshot.meta.node_types[0][v8.nodes[i + fields.indexOf("type")]] === "closure")
    closures.add(v8.strings[v8.nodes[i + fields.indexOf("name")]]);
}
console.log(
  JSON.stringify({
    read,
    first: seen.get("Order: customer -> string, lines -> Array"),
    others: seen.get("Order: customer -> string, lines -> Array, previous -> Order"),
    settings: seen.get("Object: hostName -> string, labels -> Array, newest -> Order"),
    v8: ["Order", "customer", "lines", "previous", "hostName", "labels", "newest"].filter(name => !strings.has(name)),
    closures: ["counter", "later"].filter(name => !closures.has(name)),
  }),
);
`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext", "dom"],
    },
  }),
};

test.each([[["--aot"]], [[]]])(
  "a heap snapshot names the properties that hold objects: bun build --compile %p",
  async flags => {
    using folder = tempDir("compile-aot-heap-snapshot", files);
    const dir = String(folder);
    await using build = spawn({
      cmd: [bunExe(), "build", "--compile", ...flags, "app.ts", "--outfile", "app"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect(buildErrors).not.toContain("error");
    expect(buildExitCode).toBe(0);
    await using run = spawn({ cmd: [join(dir, "app")], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ read: 1497, first: 1, others: 99, settings: 1, v8: [], closures: [] });
    expect(exitCode).toBe(0);
  },
);

const manyShapes = {
  "app.ts": `
declare const Bun: { isMainThread: boolean; generateHeapSnapshot(format: "v8"): string };
const lines = "${"\\n".repeat(6000)}";
const kept: object[] = [];
${Array.from({ length: 400 }, (_, i) => `kept.push({ field_${i}_of_a_literal: [${i}], another_${i}: "text ${i}" });`).join("\n")}
const text = Bun.generateHeapSnapshot("v8");
const said = [lines.length, kept.length, text.includes("field_399_of_a_literal")];
if (Bun.isMainThread) {
  const worker = new Worker(import.meta.url);
  worker.onmessage = event => {
    console.log(JSON.stringify({ main: said, worker: event.data }));
    worker.terminate();
  };
} else {
  postMessage(said);
}
`,
  "tsconfig.json": files["tsconfig.json"],
};

test.each([[["--aot"]], [[]]])(
  "a heap snapshot of a program with many shapes, in a Worker too: bun build --compile %p",
  async flags => {
    using folder = tempDir("compile-aot-heap-snapshot", manyShapes);
    const dir = String(folder);
    await using build = spawn({
      cmd: [bunExe(), "build", "--compile", ...flags, "app.ts", "--outfile", "app"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect(buildErrors).not.toContain("error");
    expect(buildExitCode).toBe(0);
    await using run = spawn({ cmd: [join(dir, "app")], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ main: [6000, 400, true], worker: [6000, 400, true] });
    expect(exitCode).toBe(0);
  },
);
