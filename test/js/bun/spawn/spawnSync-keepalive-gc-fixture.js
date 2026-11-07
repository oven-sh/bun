// A GC that ends while Bun.spawnSync() is on the stack schedules the
// FinalizationRegistry's cleanup as deferred work, which takes a keep-alive on
// the event loop. That keep-alive and its release must land on the main loop,
// not the private loop spawnSync installs for the call.
const { getEventLoopStats } = require("bun:internal-for-testing");

const registry = new FinalizationRegistry(() => {});
function makeGarbage() {
  for (let i = 0; i < 5000; i++) registry.register({ i }, i);
}

const { BUN_JSC_collectContinuously, ...childEnv } = process.env;
const cmd = process.platform === "win32" ? ["cmd", "/c", "exit 0"] : ["true"];

const baseline = getEventLoopStats().numPolls;
for (let iter = 0; iter < 8; iter++) {
  makeGarbage();
  Bun.spawnSync(cmd, { env: childEnv });
  // Let the FinalizationRegistry callback run and the loop tick once.
  await new Promise(resolve => setImmediate(resolve));
  await Bun.sleep(1);
  const { numPolls, loopActive } = getEventLoopStats();
  if (numPolls < baseline) {
    console.log("DRIFT " + JSON.stringify({ iter, baseline, numPolls, loopActive }));
    process.exit(1);
  }
}
console.log("OK");
