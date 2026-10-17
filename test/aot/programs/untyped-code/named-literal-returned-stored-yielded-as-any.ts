// A named literal that is returned as `any`, assigned to a member of type `any`, and yielded as `any`.
function make(): any {
  const made = { count: 1, more: { n: 1, extra: "e" } };
  return made;
}
const holder: { anything: any } = { anything: 0 };
const assigned = { count: 2, more: { n: 2, extra: "f" } };
holder.anything = assigned;
function* each(): Generator<any> {
  const yielded = { count: 3, more: { n: 3, extra: "g" } };
  yield yielded;
}
for (const o of [make(), holder.anything, ...each()]) {
  o.more = { n: 20 };
  o.count = "many";
  console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
}
console.log(assigned.more.n, assigned.more.extra, String(assigned.count));
