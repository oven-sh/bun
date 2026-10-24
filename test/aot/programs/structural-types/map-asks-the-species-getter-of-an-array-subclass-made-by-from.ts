class PlainResults extends Array<number> {
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
}

function classOfMap(numbers: number[]): string {
  return numbers.map(number => number).constructor.name;
}

console.log("a plain array", classOfMap([1, 2]));
const numbers: number[] = PlainResults.from([1, 2]);
try {
  console.log("the subclass", numbers.constructor.name, classOfMap(numbers), numbers.slice().constructor.name);
} catch (error) {
  console.log("threw", error instanceof Error ? error.constructor.name : typeof error);
}
