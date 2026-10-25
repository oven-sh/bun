// The bound function really defines built-in globals: under a name that is spelled out, and under one that nobody knows.
const define = Object.defineProperty.bind(Object);
const kept = navigator;
const keptConsole = console;
define(globalThis, "navigator", { value: { hardwareConcurrency: "replaced" }, writable: true, configurable: true });
keptConsole.log(navigator.hardwareConcurrency);
define(globalThis, "navigator", { value: kept, writable: true, configurable: true });
const name = ["console", "other"][process.argv.length < 100 ? 0 : 1];
define(globalThis, name, { value: { log: (...rest) => keptConsole.log("replaced", ...rest) }, writable: true, configurable: true });
console.log("a");
define(globalThis, name, { value: keptConsole, writable: true, configurable: true });
console.log(typeof navigator.hardwareConcurrency);
