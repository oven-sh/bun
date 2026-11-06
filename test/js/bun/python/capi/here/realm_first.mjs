// The first interpreter of the process is a ShadowRealm's, and nothing refers to the realm any more.
// argv: the directory of the libraries, how many other realms there are, whether Python begins in the main realm too ("main too"), or a collection comes while the realm is there ("owes").
// The first eight global objects of a VM are swept by the collection that finds them dead. A later one lies in a block, and stays there, dead, until somebody gets to it.
import { dlopen } from "bun:ffi";
import { fullGC, generateHeapSnapshotForDebugging } from "bun:jsc";

const [libraries, numberOfOthers, how] = process.argv.slice(2);
const mainToo = how === "main too";
const c = dlopen(`${libraries}/libeverything.so`, {
  call_everything_with: { args: ["int"], returns: "cstring" },
  leave_a_str_in_the_indicator: {},
}).symbols;
const { is_initialized } = dlopen(`${libraries}/libwithout_gil.so`, { is_initialized: { returns: "int" } }).symbols;
const others = Array.from({ length: Number(numberOfOthers) }, () => new ShadowRealm());
const turn = () => new Promise(resolve => setImmediate(resolve));

// For a run in which the realm stays: by which ways the heap's roots lead to a global object that is no root itself, each way once, with how often it occurs.
function whatLeadsToGlobalObjects() {
  const { nodes, nodeClassNames, edges, roots, labels } = generateHeapSnapshotForDebugging();
  const classOf = new Map();
  for (let i = 0; i < nodes.length; i += 7) classOf.set(nodes[i], nodeClassNames[nodes[i + 2]]);
  const targetsOf = new Map();
  for (let i = 0; i < edges.length; i += 4) {
    if (!targetsOf.has(edges[i])) targetsOf.set(edges[i], []);
    targetsOf.get(edges[i]).push(edges[i + 1]);
  }
  const cameFrom = new Map();
  for (let i = 0; i < roots.length; i += 3) if (!cameFrom.has(roots[i])) cameFrom.set(roots[i], labels[roots[i + 1]]);
  const queue = [...cameFrom.keys()];
  for (const node of queue) {
    for (const target of targetsOf.get(node) ?? []) {
      if (cameFrom.has(target)) continue;
      cameFrom.set(target, node);
      queue.push(target);
    }
  }
  const ways = new Map();
  for (const [node, name] of classOf) {
    if (name != "GlobalObject" || typeof cameFrom.get(node) == "string") continue;
    let way = name;
    let from = cameFrom.get(node);
    for (; typeof from == "number"; from = cameFrom.get(from)) way = `${classOf.get(from)} -> ${way}`;
    way = `${from ? `a root (${from})` : "no root"} -> ${way}`;
    ways.set(way, (ways.get(way) ?? 0) + 1);
  }
  return [...ways].map(([way, times]) => `${times} x ${way}`).join("\n");
}

// What C is told, each answer once.
const told = new Set();
let held;
async function inRealm() {
  const realm = new ShadowRealm();
  if (how === "owes") held = realm;
  const has_the_api = await realm.importValue(new URL("./in_two.py", import.meta.url).pathname, "has_the_api");
  console.log("realm has the API:", String(has_the_api(libraries)));
  told.add(String(c.call_everything_with(0)));
  // While the first is there.
  if (mainToo) return await import("./in_two.py");
}
const main = await inRealm();
if (mainToo) console.log("main has the API:", String(main.has_the_api(libraries)));
// Nobody looks at what C has raised when JS has called it: it stays in the thread's indicator. An exception there would hold the realm, as whatever C owns a reference to does. A str
// belongs to no realm: the pointer is still there when the interpreter has gone and the str has died.
c.leave_a_str_in_the_indicator();
// C is served until a collection finds the realm dead, and refused from then on. These collections sweep no blocks.
for (let turns = 0; turns < 3; turns++) await turn();
// A collection that finds something of the realm's dead while the realm is there leaves calls that its interpreter owes (here: the callbacks of importlib's weak references to the locks of the
// modules). One of the collector's own may end at any time. This is one for sure.
if (held) fullGC();
held = undefined;
// (As a rule the first or the second finds it dead. But code of JS's that the engine has compiled and not yet put in place holds its realm until any function of the VM is next compiled: 28 collections have been seen.)
for (let collections = 0; is_initialized() && collections < 100; collections++) {
  fullGC();
  told.add(String(c.call_everything_with(0)));
  // What its interpreter owes holds the realm until the calls have been made, which is at a turn of the loop. After main's import the realm lives for a turn or two more as well.
  // (There is no turn behind the collection that finds the realm dead.)
  if (is_initialized()) await turn();
}
const hasGone = !is_initialized();
const evidence = hasGone ? "" : whatLeadsToGlobalObjects();
told.add(String(c.call_everything_with(0)));
// Nothing is printed, and the loop does not turn, before the dead realm has been swept: both go through the interpreters of the VM, which is not the subject here.
Bun.gc(true);
console.log("the realm has gone:", hasGone, others.length);
if (evidence) console.log(evidence);
for (const answers of told) console.log("JS calls C:", answers);
if (mainToo) {
  console.log("main has the API:", String(main.has_the_api(libraries)));
  console.log(
    "main, the next call and the next library:",
    String(main.call_something_else()),
    String(main.load_something_else()),
  );
}
