class Box<T> {
  static readonly EMPTY: Box<never> = new Box<never>();
  value: T | undefined = undefined;
  static empty<T>(): Box<T> {
    return Box.EMPTY;
  }
}

const numbers = Box.empty<number>();
const strings = Box.empty<string>();
console.log(typeof numbers.value);
numbers.value = 41;
console.log(typeof strings.value);
console.log(strings.value === undefined ? "nothing" : strings.value + "!");
console.log(strings.value === undefined ? "nothing" : strings.value.length);
console.log(typeof Box.EMPTY.value);
console.log(JSON.stringify(Box.EMPTY));
strings.value = "text";
console.log(typeof numbers.value);
console.log(numbers.value === undefined ? -1 : numbers.value + 1);
console.log(numbers.value === undefined ? -1 : numbers.value * 2);
try {
  console.log(numbers.value === undefined ? "nothing" : numbers.value.toFixed(1));
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
