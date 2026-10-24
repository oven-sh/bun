// A literal passed as `this`, and one passed in the list of arguments, through `Reflect.apply` of a function of type `any`.
function alter(this: any, other: any): any {
  this.more = { n: 2 };
  this.count = "many";
  other.more = { n: 3 };
  other.count = "some";
  return [this, other];
}
const f: any = { alter };
const made = Reflect.apply(f.alter, { count: 1, more: { n: 1, extra: "e" } }, [{ count: 2, more: { n: 2, extra: "f" } }]) as any[];
for (const o of made) console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
