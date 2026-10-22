const pair: [number, number] = [1, 2];

function lengthOf(): 2 {
  return pair.length;
}
function second(): number {
  return pair[1];
}

console.log(pair.length, lengthOf() === 2, second());
pair.push(3);
console.log(pair.length);
console.log(pair.length === 2);
console.log(lengthOf());
console.log(lengthOf() === 2 ? "two" : "not two");
pair.pop();
pair.pop();
console.log(pair.length);
console.log(pair.length === 2);
console.log(second());
console.log(second() === undefined);
console.log(typeof second() === "number");
console.log(second() + 1);
Reflect.set(pair, "length", 0);
console.log(pair.length === 2, pair[0], pair[0] === undefined);
