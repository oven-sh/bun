// The globals that the test programs expect and the `jsc` shell lacks. The image is loaded by now, and it has locked each global that its program never stores to and the shell has: such a store throws, and the shell goes on with what it has.
const provide = (name, value) => { try { globalThis[name] = value; } catch { } };
// Compiled code takes a member of an object of Bun for what Bun puts there and reads through it without a test. A read of a member that the object here lacks ends the run with the words of the engine, which quick.py knows.
const partOf = (name, members) => Object.setPrototypeOf(members, new Proxy({}, { get(target, key) {
    if (typeof key === "symbol")
        return undefined;
    print(`AOT: the program needs the host's ${name}.${key}, and this realm has no host`);
    quit();
} }));
provide("performance", partOf("performance", { now: () => preciseTime() * 1000 }));
provide("console", partOf("console", { log: (...values) => print(values.map(value => Object.is(value, -0) ? "-0" : String(value)).join(" ")) }));
// Compiled code takes a global of Bun that the program never stores to for present, so `typeof process` or `typeof Bun` is no test for the shell: without these the program reads a null pointer.
provide("process", partOf("process", { argv: ["jsc", "program"] }));
// Compiled code calls Bun.gc as the native function that it is in Bun, so it is one here.
provide("Bun", partOf("Bun", { gc }));
// The shell's setTimeout only takes a JSFunction.
{ const original = globalThis.setTimeout; provide("setTimeout", (callback, delay) => original(() => callback(), delay)); }
// An unhandled promise rejection is reported the way Bun reports it.
setUnhandledRejectionCallback((promise, reason) => print("Unhandled rejection: " + reason));
