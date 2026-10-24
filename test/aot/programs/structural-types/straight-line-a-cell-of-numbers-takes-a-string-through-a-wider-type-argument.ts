class Cell<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}

const integers = new Cell(1);
const wideIntegers: Cell<number | string> = integers;
wideIntegers.value = "text";
console.log(typeof integers.value);
console.log(integers.value + 1);
console.log(integers.value * 2);
console.log(JSON.stringify(integers));

const fractions = new Cell(0.5);
const wideFractions: Cell<number | null> = fractions;
wideFractions.value = null;
console.log(typeof fractions.value);
console.log(fractions.value + 1);
console.log(JSON.stringify(fractions));

const strings = new Cell("s");
const wideStrings: Cell<string | number> = strings;
wideStrings.value = 7;
console.log(typeof strings.value);
console.log(strings.value + "!");
console.log(strings.value.length);

const functions = new Cell(() => 1);
const wideFunctions: Cell<(() => number) | undefined> = functions;
wideFunctions.value = undefined;
console.log(typeof functions.value);
try {
  console.log(functions.value());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
