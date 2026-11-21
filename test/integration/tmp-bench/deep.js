// Usage: bun deep.js <old> <new>   How often the child of a test with an endless recursion ends badly.
const file = require("path").join(__dirname, "../../js/node/test/parallel/test-async-hooks-stack-overflow.js"), N = +(process.env.N ?? 240);
const exes = { old: process.argv[2], before: process.env.BEFORE_BUN, new: process.argv[3] };
(async () => {
  for (const [title, env] of [["as shipped", {}], ["as in tests", { BUN_GARBAGE_COLLECTOR_LEVEL: "0", BUN_JSC_randomIntegrityAuditRate: "1.0" }]])
    for (const atOnce of [1, 4, 12]) {
      const bad = { old: 0, before: 0, new: 0 };
      for (let i = 0; i < N; i += atOnce) for (const [name, exe] of Object.entries(exes)) await Promise.all(Array.from({ length: atOnce }, async () => (bad[name] += +!!(await Bun.spawn([exe, file, "child"], { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "ignore"] }).exited))));
      console.log(`cond deep ${title}, ${atOnce} at once, bad of ${N}: ${JSON.stringify(bad)}`);
    }
})();
