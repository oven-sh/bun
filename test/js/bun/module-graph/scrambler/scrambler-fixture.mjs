// Fixture of module-graph-scrambler.test.ts. Runs CHAINS chains. A chain is a few hops, each of which gets to the
// next one some way (a timer, a promise, an emitter, ...) through the code of a graph or of the host picked at
// random, or enters a graph's context with run(). It ends with an error nobody handles, made one of many ways.
//
// What is checked:
// - at every hop, Bun.ModuleGraph.current is the graph whose context the chain is in: the one of the innermost
//   run() around it, whoever's code scheduled the hop;
// - the error is heard once, by the handler of the nearest graph that has one for it, from the graph whose
//   context it happened in through the graphs that made it, else by the process; with the origin and the
//   promise a handler of that name is given;
// - a handler runs in the context its graph was made in.
//
//   bun scrambler-fixture.mjs      env: SEED=1 CHAINS=600 DEPTH=6 DEADLINE=4000 (ms to wait for every chain to end)
const SEED = Number(process.env.SEED ?? 1);
const CHAINS = Number(process.env.CHAINS ?? 600);
const DEPTH = Number(process.env.DEPTH ?? 6);
const DEADLINE = Number(process.env.DEADLINE ?? 4_000);

// mulberry32
let seed = SEED >>> 0;
function random(below) {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(seed ^ (seed >>> 15), seed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) % below;
}
const pick = list => list[random(list.length)];

const problems = [];
const problem = message => void (problems.length < 20 && problems.push(message));

// The graphs: which handlers each was given, and who made it (-1: the host).
const specs = [
  { handlers: ["uncaughtException", "unhandledRejection"], maker: -1 },
  { handlers: ["uncaughtException"], maker: -1 },
  { handlers: ["unhandledRejection"], maker: -1 },
  { handlers: [], maker: -1 },
  { handlers: [], maker: 0 },
  { handlers: ["unhandledRejection"], maker: 1 },
  { handlers: ["uncaughtException"], maker: 2 },
];
const HOST = -1;
const nameOf = index => (index === HOST ? "the host" : "graph " + index);
const graphs = [];
const indexOf = graph => (graph === undefined ? HOST : graphs.findIndex(made => made.graph === graph));

const heard = new Map(); // tag -> what heard it
function hear(tag, by, handler, second) {
  if (heard.has(tag)) problem(`${tag} was heard twice: by ${heard.get(tag).by} and by ${nameOf(by)}`);
  heard.set(tag, { by: nameOf(by), handler, second: second instanceof Promise ? "a promise" : String(second) });
}
process.on("uncaughtException", (error, origin) => hear(tagOf(error), HOST, "uncaughtException", origin));
process.on("unhandledRejection", (reason, promise) => hear(tagOf(reason), HOST, "unhandledRejection", promise));

const path = import.meta.dir + "/cell-fixture.mjs";
const hostCell = await import(path);
const { tagOf } = hostCell;
for (const [index, { handlers, maker }] of specs.entries()) {
  const options = {};
  for (const handler of handlers) {
    options[handler] = (error, second) => {
      // A handler is its maker's.
      const current = indexOf(Bun.ModuleGraph.current);
      if (current !== maker)
        problem(`${handler} of graph ${index} ran in the context of ${nameOf(current)}, not of ${nameOf(maker)}`);
      hear(tagOf(error), index, handler, second);
    };
  }
  const graph =
    maker === HOST
      ? new Bun.ModuleGraph(options)
      : graphs[maker].graph.run(() => graphs[maker].cell.makeGraph(options));
  graphs.push({ graph, cell: await graph.import(path) });
}
const cellOf = index => (index === HOST ? hostCell : graphs[index].cell);
const anyone = () => random(graphs.length + 1) - 1;

// Who hears an error that happens in the context of `index`.
function hears(index, kind) {
  for (let at = index; at !== HOST; at = specs[at].maker) {
    const { handlers } = specs[at];
    if (kind === "unhandledRejection" && handlers.includes("unhandledRejection"))
      return { by: nameOf(at), handler: "unhandledRejection", second: "a promise" };
    if (handlers.includes("uncaughtException")) return { by: nameOf(at), handler: "uncaughtException", second: kind };
  }
  return { by: nameOf(HOST), handler: kind, second: kind === "unhandledRejection" ? "a promise" : kind };
}

const hopNames = Object.keys(hostCell.hops);
const expected = new Map(); // tag -> what should hear it
const underWay = new Map(); // id of a chain that has not got to its end -> where it is
let hops = 0;
function chain(id) {
  const steps = [];
  // Two chains in three start in a graph's context.
  if (random(3)) steps.push({ run: random(graphs.length) });
  for (let depth = 1 + random(DEPTH); depth > 0; depth--)
    steps.push(random(4) === 0 ? { run: random(graphs.length) } : { hop: pick(hopNames), code: anyone() });
  const kind = random(3) === 0 ? "uncaughtException" : "unhandledRejection";
  const forms = kind === "uncaughtException" ? hostCell.throws : hostCell.rejects;
  const form = pick(Object.keys(forms));
  const code = anyone();
  const described = () =>
    steps
      .map(step => ("run" in step ? `run() of graph ${step.run}` : `${step.hop} in the code of ${nameOf(step.code)}`))
      .join(", ");

  const at = (step, context) => () => {
    hops++;
    underWay.set(id, { step, described });
    const current = indexOf(Bun.ModuleGraph.current);
    if (current !== context)
      problem(
        `chain ${id} (${described()}): at step ${step} the context is of ${nameOf(current)}, not of ${nameOf(context)}`,
      );
    if (step === steps.length) {
      const tag = `chain ${id}: ${form}, in the code of ${nameOf(code)}, in the context of ${nameOf(context)}, after ${described()}`;
      expected.set(tag, hears(context, kind));
      underWay.delete(id);
      cellOf(code)[kind === "uncaughtException" ? "throws" : "rejects"][form](tag);
      return;
    }
    const next = steps[step];
    if ("run" in next) graphs[next.run].graph.run(at(step + 1, next.run));
    else cellOf(next.code).hops[next.hop](at(step + 1, context));
  };
  at(0, HOST)();
}

for (let id = 0; id < CHAINS; id++) {
  chain(id);
  // Some start while others are under way.
  if (random(8) === 0) await new Promise(resolve => setTimeout(resolve, 0));
}

const deadline = Date.now() + DEADLINE;
while ((expected.size < CHAINS || heard.size < expected.size) && Date.now() < deadline && !problems.length)
  await new Promise(resolve => setImmediate(resolve));

for (const [id, { step, described }] of underWay)
  problem(`chain ${id} (${described()}) got to step ${step} and no further`);

for (const [tag, should] of expected) {
  const was = heard.get(tag);
  if (!was) problem(`nothing heard ${tag}`);
  else if (was.by !== should.by || was.handler !== should.handler || was.second !== should.second)
    problem(
      `${tag}: heard by ${was.handler} of ${was.by} with ${was.second}, not by ${should.handler} of ${should.by} with ${should.second}`,
    );
}
for (const tag of heard.keys()) if (!expected.has(tag)) problem(`heard what no chain made: ${tag}`);
if (indexOf(Bun.ModuleGraph.current) !== HOST)
  problem("the host is left in the context of " + nameOf(indexOf(Bun.ModuleGraph.current)));

const count = (counts, name) => ((counts[name] = (counts[name] ?? 0) + 1), counts);
console.log(
  JSON.stringify({
    seed: SEED,
    chains: expected.size,
    hops,
    heard: heard.size,
    heardBy: [...heard.values()].reduce((counts, { by, handler }) => count(counts, by + ", " + handler), {}),
    problems,
  }),
);
process.exit(problems.length ? 1 : 0);
