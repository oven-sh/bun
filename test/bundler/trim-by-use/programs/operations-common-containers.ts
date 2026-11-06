const ages = new Map<string, number>();
ages.set("a", 1);
const seen = new Set<string>();
seen.add("x");
const numbers: number[] = [];
for (let i = 0; i < 40; i++) numbers.push(i + 0.5);
ages.clear();
console.log(ages.size, seen.has("x"), new Uint8Array(4).length, numbers.indexOf(3.5), [1, 2, 3].indexOf(2));
