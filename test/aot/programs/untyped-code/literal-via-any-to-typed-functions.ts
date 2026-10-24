// Literals passed to typed functions that are called through `any`: as a parameter, as `this`, nested, and read again by typed code.
interface Link { a: number; next: Link | undefined }
function addTo(this: Link, k: number): Link {
  this.a += k;
  return this;
}
function total(link: Link): number {
  return link.a + (link.next ? total(link.next) : 0);
}
function last(link: Link): Link {
  return link.next ? last(link.next) : link;
}
const f: any = { addTo, total, last };
console.log(f.total({ a: 1, next: { a: 2, next: undefined } }));
console.log(f.addTo.call({ a: 1, next: undefined }, 2).a);
console.log(total(f.addTo.call({ a: 1, next: { a: 5, next: undefined } }, 2)));
const end: Link = f.last({ a: 1, next: { a: 7, next: undefined } });
end.next = { a: 8, next: undefined };
console.log(total(end), JSON.stringify(end));
let sum = 0;
for (let i = 0; i < 1000; i++) sum += f.total({ a: i, next: { a: 1, next: undefined } });
console.log(sum);
