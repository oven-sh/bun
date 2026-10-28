// `this` is written before the test, so a call without `new` writes the global object.
function Early(options) {
  for (var key in options) this[key] = options[key];
  if (!(this instanceof Early)) return new Early({});
}
var kept = console;
Early({ console: { log: function () { kept.log("replaced", [].slice.call(arguments).join()); } } });
console.log("a", "b");
globalThis.console = kept;
console.log("back");
