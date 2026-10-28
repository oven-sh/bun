// An event emitter in ES5 style: listeners in arrays under computed names, `once` wrappers that remove themselves, and calls through `apply` with a slice of `arguments`.
function Emitter() {
  this.listeners = {};
}
Emitter.prototype.on = function (type, listener) {
  (this.listeners[type] || (this.listeners[type] = [])).push(listener);
  return this;
};
Emitter.prototype.off = function (type, listener) {
  var list = this.listeners[type];
  if (!list) return this;
  var at = list.indexOf(listener);
  if (at >= 0) list.splice(at, 1);
  return this;
};
Emitter.prototype.once = function (type, listener) {
  var self = this;
  function wrapper() {
    self.off(type, wrapper);
    listener.apply(this, arguments);
  }
  return this.on(type, wrapper);
};
Emitter.prototype.emit = function (type) {
  var list = this.listeners[type];
  if (!list || list.length === 0) return false;
  var args = Array.prototype.slice.call(arguments, 1);
  var copy = list.slice();
  for (var i = 0; i < copy.length; i++) copy[i].apply(this, args);
  return true;
};

function run(count) {
  var emitter = new Emitter();
  var state = { data: 0, ends: 0, errors: 0, single: 0 };
  emitter.on("data", function (chunk, offset) {
    state.data += chunk.length + offset;
  });
  emitter.on("data", function (chunk) {
    if (chunk.length > 4) state.data++;
  });
  emitter.on("end", function () {
    state.ends++;
  });
  emitter.on("error", function (error) {
    state.errors += error.code;
  });
  var chunks = ["ab", "cdefg", "h", "ijklmnop"];
  for (var i = 0; i < count; i++) {
    emitter.emit("data", chunks[i & 3], i & 7);
    if ((i & 15) === 0) emitter.emit("end");
    if ((i & 63) === 0) emitter.emit("error", { code: 2 });
    if ((i & 31) === 0) {
      emitter.once("tick", function (n) {
        state.single += n;
      });
      emitter.emit("tick", 1);
      emitter.emit("tick", 100);
    }
    emitter.emit("nobody", i);
  }
  return state.data + state.ends + state.errors + state.single;
}

console.log(run(1000000));
