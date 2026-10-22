// The bound function really defines built-in globals: under a name that is spelled out, and under one that nobody knows.
const define = Object.defineProperty.bind(Object);
const kept = process;
const keptConsole = console;
define(globalThis, "process", { value: { pid: "replaced" }, writable: true, configurable: true });
keptConsole.log(process.pid);
define(globalThis, "process", { value: kept, writable: true, configurable: true });
const name = ["console", "other"][kept.argv.length < 100 ? 0 : 1];
define(globalThis, name, { value: { log: (...rest) => keptConsole.log("replaced", ...rest) }, writable: true, configurable: true });
console.log("a");
define(globalThis, name, { value: keptConsole, writable: true, configurable: true });
console.log(typeof process.pid);
