const pair: readonly [1, "one"] = [1, "one"];
function first(): 1 {
  return pair[0];
}
function second(): "one" {
  return pair[1];
}
console.log(first(), second(), pair.length);
Reflect.set(pair, 0, 2.5);
Reflect.set(pair, 1, "two");
console.log(first(), first() === 1, first() + 1, second(), second() === "one", second().length);
Reflect.set(pair, "length", 1);
console.log(pair.length, second(), second() === undefined, typeof second());
Reflect.deleteProperty(pair, 0);
console.log(first(), first() === undefined, 0 in pair);
