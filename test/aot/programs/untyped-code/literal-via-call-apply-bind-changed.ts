// A literal passed to a parameter of type `unknown` through `call`, `apply`, `bind` and `Reflect.apply`.
function through(x: unknown): unknown {
  return x;
}
const made = [
  through.call(undefined, { count: 1, more: { n: 1, extra: "e" } }),
  through.apply(undefined, [{ count: 2, more: { n: 2, extra: "f" } }]),
  through.bind(undefined, { count: 3, more: { n: 3, extra: "g" } })(),
  Reflect.apply(through, undefined, [{ count: 4, more: { n: 4, extra: "h" } }]),
] as any[];
for (const o of made) {
  o.more = { n: 10 };
  o.count = "many";
  console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
}
