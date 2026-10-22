// The key may be a text at run time: the store replaces a built-in global, and every read behind it sees that.
var few = process.argv.length < 100;
var key = few ? "process" : Symbol.for("never");
var kept = process;
globalThis[key] = { pid: "replaced" };
console.log(typeof process.pid, process.pid, kept === process);
globalThis.process = kept;
console.log(typeof process.pid);
