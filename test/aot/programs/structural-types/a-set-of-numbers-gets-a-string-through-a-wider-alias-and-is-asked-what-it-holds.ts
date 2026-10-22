const set = new Set<number>([1]);
const wide: Set<number | string> = set;
wide.add("text");
console.log("size " + set.size);
let visited = "";
set.forEach(value => {
  visited += typeof value + " ";
});
console.log("forEach " + visited);
console.log("spread " + [...set].map(value => typeof value).join());
console.log("Array.from " + Array.from(set, value => typeof value).join());
console.log("some " + [...set].some(value => value === undefined));
console.log("filter " + [...set].filter(value => typeof value !== "number").length);
let walked = "";
for (const value of set) walked += typeof value + " ";
console.log("for of " + walked);
let sum = 0;
for (const value of set) sum += value;
console.log("sum " + sum);
console.log("JSON " + JSON.stringify([...set]));

export {};
