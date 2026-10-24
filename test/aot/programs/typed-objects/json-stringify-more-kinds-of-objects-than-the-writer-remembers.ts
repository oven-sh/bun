// The typed writer remembers how to write each kind of object with undeclared keys, up to a number of kinds. An object is being written while the objects below it bring more kinds than that: what the writer stands on may not be thrown away under it.
interface Item { id: number }
interface Holder { first: number; items: Item[]; last: string }
function textOf(count: number, from: number): string {
  const items: string[] = [];
  for (let i = 0; i < count; i++) items.push(`{"id":${i},"k${from + i}":${i}}`);
  return `{"a":"before","first":1,"b":[1,2],"items":[${items.join(",")}],"c":"behind","last":"l","d":{"e":null},"f":"${"x".repeat(40)}"}`;
}
for (const count of [10, 16000, 16383, 16384, 16385, 17000, 40000]) {
  const text = textOf(count, count * 7);
  const holder = JSON.parse<Holder>(text);
  console.log(count, JSON.stringify(holder) === text, JSON.stringify(holder) === text, JSON.stringify([holder, holder]) === `[${text},${text}]`, JSON.stringify(holder.items[count - 1]));
}
