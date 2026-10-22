const value: string = "no comma".split(",")[1];

class Person {
  name = "ann";
  shout(): string {
    return this.name.toUpperCase();
  }
}

function exclaim(s: string): string {
  return s + "!";
}

function orNone(s: string = "none"): string {
  return s;
}

function pass(s: string): string {
  return s;
}

console.log("typeof " + typeof value);
console.log("is undefined " + (value === undefined));
console.log("is empty " + (value === ""));
console.log("+ '!' " + (value + "!"));
console.log("?? " + (value ?? "nothing"));
console.log("|| " + (value || "nothing"));
console.log("template " + `<${value}>`);
console.log("parameter " + exclaim(value));
console.log("default " + orNone(value));
console.log("result " + typeof pass(value) + " " + pass(value));
const person = new Person();
person.name = value;
console.log("field " + typeof person.name + " " + person.name + " " + JSON.stringify(person) + " " + Object.keys(person).join());
const literal = { s: value, t: "t" };
console.log("literal " + typeof literal.s + " " + (literal.s + literal.t) + " " + JSON.stringify(literal));
const strings = ["a"];
strings[0] = value;
strings.push(value);
console.log("elements " + strings.map(s => typeof s).join() + " " + strings.join("-") + " " + JSON.stringify(strings));
const map = new Map<string, string>([["k", value]]);
console.log("map " + typeof map.get("k") + " " + map.has("k"));
const record: Record<string, number> = { undefined: 1 };
console.log("as a key " + record[value]);
const later = (): string => value + "?";
console.log("captured " + later());
let local = "start";
local = value;
local += "!";
console.log("local " + local);
console.log("compared " + (value < "a") + " " + (value > "a") + " " + (value == null));
try {
  console.log("method of the field " + person.shout());
} catch (error) {
  console.log("method of the field threw " + (error instanceof TypeError));
}
try {
  console.log("length " + value.length);
} catch (error) {
  console.log("length threw " + (error instanceof TypeError));
}

export {};
