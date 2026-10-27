// Run by bun and by node: what a Worker's 'online', 'error' and 'exit' listeners get for each uncaught value.
const { Worker } = require("node:worker_threads");

const inspectCustom = `Symbol.for("nodejs.util.inspect.custom")`;
const unprintable = `[${inspectCustom}]() { throw new Error("x"); }`;
const rows = {
  "null": `throw null;`,
  // Neither a structured clone nor a render. The object's own `code` does not reach the parent.
  "an object": `throw { code: "E_X", ${unprintable}, fn() {} };`,
  "an object whose render throws null": `throw { [${inspectCustom}]() { throw null; }, fn() {} };`,
  // Bun's render of this one wrote "{ a: 1, b: " before it threw.
  "an object that holds an unprintable object": `throw { a: 1, b: { ${unprintable} }, fn() {} };`,
  "an object whose clone throws": `throw { ${unprintable}, get a() { throw new Error("g"); } };`,
  // Bun's error printer swallows what the nested inspector throws and returns with it pending.
  "an Error whose stack and whose nested render throw": `const e = Object.assign(new Error("boom"), { p: new Proxy({ ${unprintable} }, {}) });
    Object.defineProperty(e, "stack", { get() { throw new Error("s"); } });
    throw e;`,
  "an object thrown from a callback": `setImmediate(() => { throw { ${unprintable}, fn() {} }; });`,
  // The clone stopped the worker. That is an exit, not a value that cannot be cloned.
  "process.exit() in a getter of a printable object": `throw { get a() { process.exit(4); } };`,
  "process.exit() in a getter of an unprintable object": `throw { ${unprintable}, get a() { process.exit(4); } };`,
  "process.exit() in the code getter of an Error": `const e = new Error("boom");
    Object.defineProperty(e, "code", { get() { process.exit(4); } });
    throw e;`,
  // The worker in the middle throws what its own worker reported.
  "an object, through a worker with no 'error' listener": `new (require("node:worker_threads").Worker)(${JSON.stringify(`throw { ${unprintable}, fn() {} };`)}, { eval: true });`,
};

const show = err => (err instanceof Error ? { name: err.name, message: err.message, code: err.code } : err);

(async () => {
  const seen = {};
  await Promise.all(
    Object.entries(rows).map(async ([name, source]) => {
      const worker = new Worker(source, { eval: true });
      const events = [];
      worker.on("online", () => events.push("online"));
      worker.on("error", err => events.push(["error", show(err)]));
      const exitCode = await new Promise(resolve => worker.on("exit", resolve));
      seen[name] = JSON.stringify({ events, exitCode });
    }),
  );
  for (const name of Object.keys(rows)) console.log(`${name}: ${seen[name]}`);
})();
