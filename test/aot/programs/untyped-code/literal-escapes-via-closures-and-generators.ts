// Literals that leave typed code as what a closure returns, what a getter returns, a default of a parameter, an initializer of a field, and what a generator yields, each of type `unknown`.
const fromClosure = ((): unknown => ({ count: 1, more: { n: 1, extra: "e" } }))();
const fromGetter = {
  get k(): unknown {
    return { count: 2, more: { n: 2, extra: "f" } };
  },
}.k;
const fromDefault = ((x: unknown = { count: 3, more: { n: 3, extra: "g" } }) => x)();
class Keeper {
  held: unknown = { count: 4, more: { n: 4, extra: "h" } };
}
function* each(): Generator<unknown> {
  yield { count: 5, more: { n: 5, extra: "i" } };
}
for (const o of [fromClosure, fromGetter, fromDefault, new Keeper().held, ...each()] as any[]) {
  o.more = { n: 10 };
  o.count = "many";
  console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
}
