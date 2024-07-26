function assert(x) {
  if (!x) throw new Error("assertion failed");
}
var obj = { foo: 1 };
with (obj) {
  var foo = 2;
}
assert(foo === undefined);
assert(obj.foo === 2);
