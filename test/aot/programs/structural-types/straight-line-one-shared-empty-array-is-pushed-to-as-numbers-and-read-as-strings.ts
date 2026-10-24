const NONE: never[] = [];

function none<T>(): T[] {
  return NONE;
}

const numbers = none<number>();
const strings = none<string>();
console.log(NONE.length);
numbers.push(1);
numbers.push(0.5);
console.log(NONE.length);
console.log(typeof strings[0]);
console.log(strings[0] + "!");
console.log(strings[1] + "!");
console.log(strings[0].length);
strings.push("text");
console.log(typeof numbers[2]);
console.log(numbers[2] + 1);
console.log(numbers[2] * 2);
console.log(numbers[0] + numbers[1]);
console.log(JSON.stringify(NONE));
let sum = 0;
for (let i = 0; i < numbers.length; i++) sum += numbers[i];
console.log(sum);
try {
  console.log(strings[0].toUpperCase());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
