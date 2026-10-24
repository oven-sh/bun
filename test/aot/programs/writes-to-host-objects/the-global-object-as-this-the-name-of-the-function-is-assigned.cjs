// The binding that the test reads is given another function.
function Named(options) {
  if (!(this instanceof Named)) return "not an instance";
  for (var key in options) this[key] = options[key];
  return "written";
}
var original = Named;
Named = Object;
var kept = process;
console.log(original({ process: { pid: "replaced" } }), process.pid);
globalThis.process = kept;
console.log(typeof process.pid);
