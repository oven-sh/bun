// Members of a named literal are deleted, and added to, through `as any`.
const first = { count: 1, more: { n: 1, extra: "e" } };
delete (first as any).count;
(first as any).more.n += "x";
delete (first as any).more.extra;
console.log("count" in first, String(first.count), String(first.more.n), String(first.more.extra), JSON.stringify(first));
function change(target: { total: number; label: string }): void {
  (target as any).label = target.label + "!";
}
const second = { total: 2, label: "two" };
change(second);
console.log(String(second.total), second.label, JSON.stringify(second));
