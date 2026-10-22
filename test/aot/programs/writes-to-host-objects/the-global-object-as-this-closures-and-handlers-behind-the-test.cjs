// Closures that capture `this`, and a handler, all behind the test.
function Guarded(options) {
  if (!(this instanceof Guarded)) return new Guarded(options);
  var self = this;
  try {
    Object.keys(options).forEach((key) => { this[key] = options[key]; });
    if (options.fail) throw new Error("x");
  } catch (error) {
    self[error.message] = "caught";
  }
}
var a = Guarded({ process: 1, fail: true });
console.log(a.process, a.x, typeof process.pid, a instanceof Guarded);
