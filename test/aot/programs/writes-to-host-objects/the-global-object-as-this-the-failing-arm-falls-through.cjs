// The arm that fails goes on into the same code.
var notes = [];
function Falls(options) {
  if (!(this instanceof Falls)) notes.push("called without new");
  for (var key in options) this[key] = options[key];
}
var kept = process;
Falls({ process: { pid: "replaced" } });
console.log(notes.join(), process.pid);
globalThis.process = kept;
console.log(typeof process.pid, new Falls({ a: 1 }).a);
