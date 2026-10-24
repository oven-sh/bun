const list: string[] = ["a", "b", "c"];
delete list[1];
console.log("length " + list.length);
console.log("findIndex " + list.findIndex(s => s === undefined));
console.log("some " + list.some(s => s === undefined));
console.log("every " + list.every(s => s !== undefined));
console.log("filter " + list.filter(s => s === undefined).length);
console.log("filter by typeof " + list.filter(s => typeof s !== "string").length);
console.log("map " + list.map(s => typeof s).join());
console.log("map + '!' " + list.map(s => s + "!").join());
console.log("reduce " + list.reduce((text, s) => text + typeof s + " ", ""));
console.log("Array.from " + Array.from(list, s => typeof s).join());
let walked = "";
for (const s of list) walked += typeof s + " ";
console.log("for of " + walked);
let indexed = "";
for (let i = 0; i < list.length; i++) indexed += typeof list[i] + " ";
console.log("by index " + indexed);
let glued = "";
for (const s of list) glued += s;
console.log("glued " + glued);
console.log("join " + list.join("-"));
console.log("JSON " + JSON.stringify(list));
console.log("keys " + Object.keys(list).join());
try {
  console.log("widths " + list.map(s => s.length).join());
} catch (error) {
  console.log("widths threw " + (error instanceof TypeError));
}

export {};
