// Loads terminate_probe_addon_v{9,10}.node while the parent terminates this worker
// (test_terminate_during_gated_calls in module.js). `frame` says where the addon spins
// through gated calls: its module Init, a method entered from here, or script the
// method enters.
const { workerData } = require("node:worker_threads");
const { version, frame, signal, probe } = workerData;
globalThis.__terminateProbe = { signal, probe, inInit: frame === "init" };
const addon = require(`./build/Debug/terminate_probe_addon_v${version}.node`);
if (frame === "method") addon.spin(signal, probe);
if (frame === "script") {
  addon.spinScript(signal, probe, () => {
    for (;;) {}
  });
}
