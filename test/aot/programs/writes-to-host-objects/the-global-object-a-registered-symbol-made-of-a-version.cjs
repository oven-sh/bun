// The shape of @opentelemetry/api global-utils.js: a store to the global object under a symbol that is made at run time.
var major = "1.9.0".split(".")[0];
var KEY = Symbol.for("witness.api." + major);
var _global = typeof globalThis === "object" ? globalThis : global;
function register(type, instance) {
  var api = (_global[KEY] = _global[KEY] !== undefined ? _global[KEY] : { version: "1.9.0" });
  api[type] = instance;
  return true;
}
register("trace", { id: 1 });
console.log(typeof process.pid, JSON.stringify(_global[KEY]), typeof console.log);
