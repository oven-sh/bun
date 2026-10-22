const source = [1, 2, 3];
const value: number = source[3];

class Point {
  x = 1;
  y = 0.5;
  sum(): number {
    return this.x + this.y;
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function orSeven(n: number = 7): number {
  return n;
}

function pass(n: number): number {
  return n;
}

console.log("typeof " + typeof value);
console.log("is undefined " + (value === undefined));
console.log("is zero " + (value === 0));
console.log("+ 1 " + (value + 1));
console.log("| 0 " + (value | 0));
console.log("?? " + (value ?? 9));
console.log("|| " + (value || 9));
console.log("template " + `${value}`);
console.log("parameter " + plusOne(value));
console.log("default " + orSeven(value));
console.log("result " + typeof pass(value) + " " + (pass(value) + 1));
const point = new Point();
point.x = value;
console.log("integer field " + typeof point.x + " " + point.x + " " + (point.x + 1) + " " + point.sum());
point.y = value;
console.log("fraction field " + typeof point.y + " " + point.y + " " + point.y * 2);
console.log("fields " + JSON.stringify(point) + " " + Object.keys(point).join());
const literal = { n: value, m: 1 };
console.log("literal " + typeof literal.n + " " + (literal.n + literal.m) + " " + JSON.stringify(literal) + " " + Object.keys(literal).join());
const numbers = [1, 2];
numbers[0] = value;
numbers.push(value);
console.log("elements " + numbers.map(n => typeof n).join() + " " + (numbers[0] + 1) + " " + JSON.stringify(numbers) + " " + (0 in numbers));
const pair: [number, string] = [value, "a"];
console.log("tuple " + typeof pair[0] + " " + (pair[0] + 1));
const map = new Map<string, number>([["k", value]]);
console.log("map " + typeof map.get("k") + " " + map.has("k") + " " + [...map.values()].map(n => typeof n).join());
const set = new Set<number>([value, 1]);
console.log("set " + set.size + " " + [...set].map(n => typeof n).join());
const later = (): number => value + 1;
console.log("captured " + later());
let local = 5;
local = value;
local += 1;
console.log("local " + local);
const doubles = new Float64Array(1);
doubles[0] = value;
const integers = new Int32Array([5]);
integers[0] = value;
console.log("typed arrays " + doubles[0] + " " + integers[0]);
console.log("Math " + Math.max(value, 1) + " " + Math.floor(value) + " " + Number.isNaN(value) + " " + isNaN(value));
try {
  console.log("method " + value.toFixed(1));
} catch (error) {
  console.log("method threw " + (error instanceof TypeError));
}

export {};
