var results = [];
function setLength(target, length) {
  target.length = length;
  return target;
}
function integers(n) { var list = []; for (var i = 0; i < n; ++i) list.push(i + 1); return list; }
for (var warm = 0; warm < 50; ++warm) setLength(integers(4), warm % 5);
results.push(setLength(integers(4), 1), setLength(integers(4), 0), setLength(integers(2), 4).length);
results.push(setLength(Object.freeze(integers(3)), 1).length);
results.push(setLength(Object.defineProperty(integers(3), "length", { writable: false }), 1).length);
results.push(setLength(new Uint8Array(4), 1).length);
results.push(setLength("text", 1).length);
results.push(setLength(function (a, b) {}, 5).length);
try {
  setLength(integers(3), -1);
} catch (error) {
  results.push(error.constructor.name);
}
try {
  setLength(null, 1);
} catch (error) {
  results.push(error.constructor.name);
}
module.exports = results;
