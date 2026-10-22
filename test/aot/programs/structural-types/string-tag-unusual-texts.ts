type Zero = { tag: "0"; a: number };
type One = { tag: "1"; b: number };
type Empty = { tag: ""; c: number };
type Proto = { tag: "__proto__"; d: number };
type Length = { tag: "length"; e: number };
type Own = { tag: "tag"; f: number };
type Built = { tag: "built"; g: number };
type Any = Zero | One | Empty | Proto | Length | Own | Built;

function read(x: Any): number {
  switch (x.tag) {
    case "0": return x.a;
    case "1": return x.b + 10;
    case "": return x.c + 20;
    case "__proto__": return x.d + 30;
    case "length": return x.e + 40;
    case "tag": return x.f + 50;
    case "built": return x.g + 60;
  }
}
const all: Any[] = [
  { tag: "0", a: 1 }, { tag: "1", b: 1 }, { tag: "", c: 1 }, { tag: "__proto__", d: 1 }, { tag: "length", e: 1 }, { tag: "tag", f: 1 }, { tag: "built", g: 1 },
  { tag: ["bu", "ilt"].join("") as "built", g: 2 },
];
let sum = 0;
for (let i = 0; i < 40000; i++) sum += read(all[i & 7]);

const table: Record<string, number> = {};
for (const x of all) table[x.tag] = (table[x.tag] ?? 0) + 1;
const list = [10, 20];
console.log(sum, JSON.stringify(table), Object.keys(table).join("|"), list[all[0].tag as unknown as number], list[all[4].tag as "length"], all.map(x => x[all[5].tag as "tag"]).join("|"));
