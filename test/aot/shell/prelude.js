// The globals that the test programs expect and the `jsc` shell lacks.
globalThis.performance = { now: () => preciseTime() * 1000 };
globalThis.console = { log: (...values) => print(values.map(value => Object.is(value, -0) ? "-0" : String(value)).join(" ")) };
// The shell's setTimeout only takes a JSFunction.
{ const original = globalThis.setTimeout; globalThis.setTimeout = (callback, delay) => original(() => callback(), delay); }
// An unhandled promise rejection is reported the way Bun reports it.
setUnhandledRejectionCallback((promise, reason) => print("Unhandled rejection: " + reason));
