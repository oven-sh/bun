export function look(o) {
  return Object.keys(o).map((key) => key + "=" + o[key]).join(",") + "/" + o.path + "/" + o.depth + "/" + ("note" in o) + "/" + typeof o.strict;
}
export function mangle(o) {
  delete o.path;
  o.added = 1;
  o.depth = "a string now";
  Object.defineProperty(o, "strict", { get() { return "got"; }, enumerable: true, configurable: true });
  const copy = { ...o, last: true };
  Object.freeze(o);
  return [Object.keys(o), o.strict, o.depth, copy, Object.isFrozen(o), Object.assign({}, o)];
}
export function give(n) {
  const made = { id: n, label: "g" + n };
  if (n > 1) made.next = give(n - 2);
  return made;
}
export function giveOdd() {
  const withGetter = { id: 1, get label() { return "got"; } };
  const more = { zero: 0, label: "more", extra: [1], id: 2 };
  const inherits = Object.assign(Object.create({ label: "inherited" }), { id: 3 });
  const frozen = Object.freeze({ id: 4, label: "frozen" });
  return [withGetter, more, inherits, frozen];
}
export function keep(list, o, i) {
  if (i % 100 === 0 || i === 299) list.push(o);
}
export function through(value) {
  return value;
}
export function call(reader) {
  return reader.get() + reader.name.length;
}
