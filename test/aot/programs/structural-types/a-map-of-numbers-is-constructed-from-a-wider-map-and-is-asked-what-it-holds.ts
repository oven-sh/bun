const source = new Map<string, number | string>([
  ["a", 1],
  ["b", 2],
]);
const narrow = new Map<string, number>();
const wide: Map<string, number | string> = narrow;
for (const [key, value] of source) wide.set(key, key === "b" ? String(value) : value);
const map = narrow;
console.log("size " + map.size);
console.log("has " + map.has("b"));
console.log("get " + typeof map.get("b"));
const got = map.get("b");
console.log("get + 1 " + (got === undefined ? "nothing" : got + 1));
let visited = "";
map.forEach(value => {
  visited += typeof value + " ";
});
console.log("forEach " + visited);
console.log("values " + [...map.values()].map(value => typeof value).join());
console.log("Array.from " + Array.from(map.values(), value => typeof value).join());
console.log("some " + [...map.values()].some(value => value === undefined));
console.log("filter " + [...map.values()].filter(value => typeof value !== "number").length);
let walked = "";
for (const [key, value] of map) walked += key + " " + typeof value + " ";
console.log("for of " + walked);
let sum = 0;
for (const value of map.values()) sum += value;
console.log("sum " + sum);
console.log("JSON " + JSON.stringify([...map]));

export {};
