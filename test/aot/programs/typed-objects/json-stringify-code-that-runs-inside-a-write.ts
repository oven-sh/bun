// While a typed object with undeclared keys is being written, a toJSON method or an accessor of a value below it runs code that writes tens of thousands of other kinds of object, parses, collects, and changes the object that is being written.
interface Item { id: number }
interface Holder { first: number; items: Item[]; last: string }
const host: any = globalThis;
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc;
let serial = 0;

function crowd(count: number): Item[] {
  const items: string[] = [];
  for (let at = 0; at < count; at++) items.push('{"id":' + at + ',"k' + ++serial + '":' + at + "}");
  return JSON.parse<Item[]>("[" + items.join(",") + "]");
}
const text = '{"a":"before","first":1,"b":{"inner":1},"items":[{"id":1,"x":1}],"c":"behind","last":"l","d":{"e":null},"f":"' + "x".repeat(40) + '"}';
const expected = (b: string) => text.replace('{"inner":1}', b);

const deeds: [string, (holder: any) => void][] = [
  ["writes 20,000 kinds", () => { for (const item of crowd(20000)) JSON.stringify(item); }],
  ["writes 40,000 kinds in one list", () => { JSON.stringify(crowd(40000)); }],
  ["writes 16,384 kinds, one by one, twice", () => { const items = crowd(16384); for (let round = 0; round < 2; round++) for (const item of items) JSON.stringify(item); }],
  ["writes the holder itself", holder => { if (depth++ < 3) JSON.stringify(holder); depth--; }],
  ["parses 20,000 kinds", () => { crowd(20000); }],
  ["collects", () => { collect(); collect(); }],
  ["writes, drops and collects", () => { for (const item of crowd(20000)) JSON.stringify(item); collect(); }],
];
let depth = 0;
for (const [label, deed] of deeds) {
  const answers: string[] = [];
  {
    const holder: any = JSON.parse<Holder>(text);
    for (let round = 0; round < 3; round++) JSON.stringify(holder);
    holder.b.toJSON = () => { deed(holder); return 7; };
    answers.push(JSON.stringify(holder) === expected("7") ? "same" : "DIFFERENT");
    answers.push(JSON.stringify([holder, holder]) === "[" + expected("7") + "," + expected("7") + "]" ? "same" : "DIFFERENT");
  }
  {
    const holder: any = JSON.parse<Holder>(text);
    for (let round = 0; round < 3; round++) JSON.stringify(holder);
    Object.defineProperty(holder.b, "inner", { get() { deed(holder); return 8; }, enumerable: true });
    answers.push(JSON.stringify(holder) === expected('{"inner":8}') ? "same" : "DIFFERENT");
  }
  {
    const holder: any = JSON.parse<Holder>(text);
    for (let round = 0; round < 3; round++) JSON.stringify(holder);
    holder.items[0].x = { toJSON() { deed(holder); return 9; } };
    answers.push(JSON.stringify(holder) === text.replace('"x":1', '"x":9') ? "same" : "DIFFERENT");
  }
  console.log("code that " + label + ": " + answers.join(", "));
}

const changes: [string, (holder: any) => void][] = [
  ["adds a key", holder => { holder.z = 1; }],
  ["adds a hundred keys", holder => { for (let at = 0; at < 100; at++) holder["z" + at] = at; }],
  ["deletes the keys behind", holder => { delete holder.c; delete holder.d; delete holder.f; }],
  ["deletes a declared member", holder => { delete holder.last; }],
  ["deletes all undeclared keys", holder => { for (const key of ["a", "b", "c", "d", "f"]) delete holder[key]; }],
  ["stores another kind of value", holder => { holder.c = { deep: [1] }; holder.f = 5; }],
  ["empties the list", holder => { holder.items.length = 0; }],
  ["makes a key an accessor", holder => { Object.defineProperty(holder, "f", { get: () => "got", enumerable: true, configurable: true }); }],
  ["freezes it", holder => { Object.freeze(holder); }],
];
for (const [label, change] of changes) {
  const make = (parse: (text: string) => any) => {
    const holder = parse(text);
    for (let round = 0; round < 3; round++) JSON.stringify(holder);
    holder.b.toJSON = () => { change(holder); return 7; };
    return holder;
  };
  const typed = JSON.stringify(make(text => JSON.parse<Holder>(text)));
  const plain = JSON.stringify(make(host.JSON.parse));
  console.log("code that " + label + ": " + (typed === plain ? "same" : "DIFFERENT: " + typed + " | " + plain));
}
