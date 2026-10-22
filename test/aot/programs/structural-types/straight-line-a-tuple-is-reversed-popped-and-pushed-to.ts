const reversed: [number, string] = [1, "a"];
reversed.reverse();
console.log(typeof reversed[0]);
console.log(typeof reversed[1]);
console.log(reversed[0] + 1);
console.log(reversed[0] * 2);
console.log(reversed[1] + "!");
console.log(reversed[1].length);
const [first, second] = reversed;
console.log(typeof first);
console.log(typeof second);
try {
  console.log(reversed[1].toUpperCase());
} catch (error) {
  console.log(error instanceof TypeError);
}

const popped: [number, string] = [1, "a"];
popped.pop();
console.log(popped.length);
console.log(popped.length === 2);
console.log(typeof popped[1]);
console.log(popped[1] + "!");
try {
  console.log(popped[1].length);
} catch (error) {
  console.log(error instanceof TypeError);
}

const pushed: [number, string] = [1, "a"];
pushed.push(2);
console.log(pushed.length);
console.log(pushed.length === 2);
console.log(JSON.stringify(pushed));
console.log([...pushed].length);

const shifted: [number, string] = [1, "a"];
shifted.shift();
console.log(typeof shifted[0]);
console.log(shifted[0] + 1);
console.log(shifted.length);

export {};
