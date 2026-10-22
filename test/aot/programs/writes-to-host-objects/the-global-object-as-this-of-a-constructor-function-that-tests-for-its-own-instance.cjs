// The shape of graceful-fs/legacy-streams.js: a sloppy constructor function that may be called without `new`.
function ReadStream(path, options) {
  if (!(this instanceof ReadStream)) return new ReadStream(path, options);
  this.path = path;
  options = options || {};
  var keys = Object.keys(options);
  for (var index = 0, length = keys.length; index < length; index++) {
    var key = keys[index];
    this[key] = options[key];
  }
}
var a = ReadStream("a", JSON.parse('{"flags":"r","mode":438}'));
var b = new ReadStream("b", { start: 1 });
console.log(a.path, a.flags, a.mode, b.path, b.start, typeof process.pid, JSON.stringify(Object.keys(a)));
