// The global object is an instance of Object.
function Other(options) {
  if (!(this instanceof Object)) return new Other(options);
  for (var key in options) this[key] = options[key];
}
var kept = process;
Other({ process: { pid: "replaced" } });
console.log(process.pid);
globalThis.process = kept;
console.log(typeof process.pid);
