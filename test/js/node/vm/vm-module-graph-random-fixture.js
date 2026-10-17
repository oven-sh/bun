// Makes a random module graph from a seed, links and evaluates some of its modules, and prints what happened:
// one JSON line per seed. vm-module-graph-evaluation.test.ts compares a list of seeds with what Node.js printed,
// and scripts/vm-module-graph-random.ts compares many seeds with the Node.js on this machine.
//
//   bun vm-module-graph-random-fixture.js <main|context|afterEvaluate> <seed>...
//   node --experimental-vm-modules vm-module-graph-random-fixture.js <main|context|afterEvaluate> <seed>...
//
// The file uses only node:vm, so that Node.js runs it as it is.
const vm = require("node:vm");

function random(seed) {
  let state = ((seed + 1) * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

let unhandled = [];
process.on("unhandledRejection", reason => unhandled.push(String((reason && reason.message) || reason)));

async function runGraph(seed, kind) {
  const next = random(seed);
  const chance = probability => next() < probability;
  const pick = count => Math.floor(next() * count);

  const log = [];
  const host = { log: entry => void log.push(entry) };
  let context;
  if (kind === "main") globalThis.log = host.log;
  else context = vm.createContext(host, kind === "afterEvaluate" ? { microtaskMode: "afterEvaluate" } : {});

  const names = Array.from({ length: 2 + pick(5) }, (_, i) => "m" + i);
  const modules = {};
  const graph = [];
  for (const [i, name] of names.entries()) {
    if (chance(0.2)) {
      const throws = chance(0.3);
      graph.push(`${name}: synthetic${throws ? ", throws" : ""}`);
      modules[name] = new vm.SyntheticModule(
        ["x"],
        function () {
          log.push(name + " steps");
          this.setExport("x", i);
          if (throws) throw new Error("from " + name);
        },
        { context, identifier: name },
      );
      continue;
    }
    // A module can import itself, and any other module: cycles are common.
    const imports = names.filter(() => chance(0.35));
    const awaits = chance(0.35);
    const throws = chance(0.25);
    const throwsAfterAwait = chance(0.5) && awaits;
    let source = imports.map(specifier => `import "${specifier}";\n`).join("");
    source += `log("${name} 1");\n`;
    if (throws && !throwsAfterAwait) source += `throw new Error("from ${name}");\n`;
    if (awaits) source += `await 0;\nlog("${name} 2");\n`;
    if (throws && throwsAfterAwait) source += `throw new Error("from ${name}");\n`;
    graph.push(
      `${name}: imports [${imports}]` +
        (awaits ? ", awaits" : "") +
        (throws ? (throwsAfterAwait ? ", throws after its await" : ", throws") : ""),
    );
    modules[name] = new vm.SourceTextModule(source, { context, identifier: name });
  }

  // In a context with its own microtask queue, evaluate() of this module does nothing but the checkpoint.
  let pump;
  if (kind === "afterEvaluate") {
    pump = new vm.SourceTextModule("", { context, identifier: "pump" });
    await pump.link(() => {});
    await pump.evaluate();
  }

  const steps = [];
  for (let operations = 1 + pick(4); operations > 0; operations--) {
    const name = names[pick(names.length)];
    const module = modules[name];
    const waits = chance(0.5);
    if (module.status === "unlinked") {
      try {
        await module.link(specifier => modules[specifier]);
      } catch (error) {
        steps.push(`link ${name}: ${error.code || error.message}`);
        continue;
      }
    }
    const index = steps.length;
    steps.push(`evaluate ${name}: pending`);
    const settled = module.evaluate().then(
      () => void (steps[index] = `evaluate ${name}: fulfilled`),
      error => void (steps[index] = `evaluate ${name}: rejected, ${(error && error.message) || error}`),
    );
    // What ran before evaluate() returned.
    steps.push(`log has ${log.length}`);
    // A promise of an afterEvaluate context settles only in a checkpoint of the context.
    if (waits && !pump) await settled;
  }
  for (let i = 0; i < 6; i++) {
    await tick();
    if (pump) await pump.evaluate();
  }

  const statuses = names.map(name => modules[name].status);
  const errors = names.map(name =>
    modules[name].status === "errored" ? String(modules[name].error && modules[name].error.message) : "",
  );
  await tick();
  await tick();
  const outcome = { seed, graph: graph.join("; "), steps, log, statuses, errors, unhandled };
  unhandled = [];
  return outcome;
}

if (require.main === module) {
  const [kind, ...seeds] = process.argv.slice(2);
  (async () => {
    for (const seed of seeds) console.log(JSON.stringify(await runGraph(Number(seed), kind)));
  })();
}
