function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function inspect(numbers: number[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const value = numbers[i];
    const exact = Object.is(value, undefined) ? "undefined" : Object.is(value, 0) ? "zero" : Object.is(value, -0) ? "minus zero" : Object.is(value, NaN) ? "not a number" : String(value);
    lines.push(i + " " + (i in numbers ? "present" : "absent") + " " + typeof value + " " + exact);
  }
  return lines;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function sumByForOf(numbers: number[]): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

function sumAsIntegers(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total = (total + numbers[i]) | 0;
  return total;
}

function doubled(numbers: number[]): number[] {
  return numbers.map(number => number * 2);
}

function doubledByHand(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i] * 2);
  return result;
}

function report(name: string, make: () => number[]): void {
  attempt(name + ": elements", () => inspect(make()));
  attempt(name + ": length", () => make().length);
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": sum by for-of", () => sumByForOf(make()));
  attempt(name + ": sum as integers", () => sumAsIntegers(make()));
  attempt(name + ": map", () => doubled(make()));
  attempt(name + ": doubled by hand", () => doubledByHand(make()));
  attempt(name + ": the first, fixed", () => make()[0].toFixed(1));
  attempt(name + ": after a push", () => {
    const numbers = make();
    const length = numbers.push(7);
    return [length, inspect(numbers), sum(numbers)];
  });
  attempt(name + ": after a store at 1", () => {
    const numbers = make();
    numbers[1] = 1.5;
    return [inspect(numbers), sum(numbers)];
  });
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": JSON", () => JSON.stringify(make()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  for (const dense of [[i, 2, 3], [i + 0.5, 2.5, 3.5]]) {
    warm += inspect(dense).length + sum(dense) + sumByForOf(dense) + sumAsIntegers(dense) + doubled(dense)[0] + doubledByHand(dense)[1];
  }
}
console.log("after 4000 dense arrays", warm);

function filledPrototype(): number[] {
  const prototype: number[] = Object.create(Array.prototype);
  prototype[1] = 50.5;
  prototype[2] = 60;
  return prototype;
}

function holeyDoubles(): number[] {
  const numbers = new Array<number>(3);
  numbers[0] = 0.5;
  return numbers;
}

function holeyIntegers(): number[] {
  const numbers = new Array<number>(3);
  numbers[0] = 1;
  return numbers;
}

function reparented(numbers: number[]): number[] {
  return Object.setPrototypeOf(numbers, filledPrototype());
}

class Filled extends Array<number> {}
Filled.prototype[1] = 70.5;

function sumWith(numbers: number[], change: (index: number) => void): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    change(i);
    total += numbers[i];
  }
  return total;
}

function productWith(numbers: number[], change: (index: number) => void): number {
  let total = 1;
  for (let i = 0; i < numbers.length; i++) {
    change(i);
    total *= numbers[i];
  }
  return total;
}

for (let i = 0; i < 2000; i++) warm += sumWith([i + 0.5, 1.5], () => {}) + productWith([i + 0.5, 1.5], () => {});
console.log("after 2000 more dense arrays", warm);

report("doubles with holes", holeyDoubles);
report("doubles with holes and a filled prototype", () => reparented(holeyDoubles()));
report("integers with holes and a filled prototype", () => reparented(holeyIntegers()));
report("a dense array with a filled prototype", () => reparented([1.5, 2.5, 3.5]));
report("a subclass whose prototype has an element", () => {
  const numbers = new Filled(3);
  numbers[0] = 0.5;
  return numbers;
});
attempt("own or inherited", () => {
  const numbers = reparented(holeyDoubles());
  return [Object.hasOwn(numbers, 1), 1 in numbers, numbers[1], numbers.indexOf(50.5), numbers.includes(60), Array.isArray(numbers)];
});
attempt("the prototype is changed in the middle of a sum", () => {
  const numbers = holeyDoubles();
  return sumWith(numbers, index => void (index === 1 && reparented(numbers)));
});
attempt("the prototype is changed in the middle of a product", () => {
  const numbers = holeyDoubles();
  return productWith(numbers, index => void (index === 2 && reparented(numbers)));
});
attempt("the prototype gets an element in the middle of a sum", () => {
  const prototype: number[] = Object.create(Array.prototype);
  const numbers: number[] = Object.setPrototypeOf(holeyDoubles(), prototype);
  return sumWith(numbers, index => void (index === 1 && (prototype[2] = 0.25)));
});
attempt("the prototype loses its element in the middle of a sum", () => {
  const prototype = filledPrototype();
  const numbers: number[] = Object.setPrototypeOf(holeyDoubles(), prototype);
  return sumWith(numbers, index => void (index === 2 && delete prototype[2]));
});
attempt("an element is deleted in the middle of a sum over a reparented array", () => {
  const numbers = reparented([1.5, 2.5, 3.5]);
  return sumWith(numbers, index => void (index === 0 && delete numbers[1]));
});
attempt("a getter on the prototype", () => {
  const reads: number[] = [];
  const prototype: number[] = Object.create(Array.prototype);
  Object.defineProperty(prototype, 1, {
    get() {
      reads.push(1);
      return -1.5;
    },
  });
  const numbers: number[] = Object.setPrototypeOf(holeyDoubles(), prototype);
  return [sum(numbers), sumByForOf(numbers), reads.length];
});
attempt("a setter on the prototype takes the store", () => {
  const stores: number[] = [];
  const prototype: number[] = Object.create(Array.prototype);
  Object.defineProperty(prototype, 1, {
    set(value: number) {
      stores.push(value);
    },
  });
  const numbers: number[] = Object.setPrototypeOf(holeyDoubles(), prototype);
  numbers[1] = 9.5;
  return [stores, 1 in numbers, Object.hasOwn(numbers, 1), numbers[1]];
});
attempt("no prototype at all", () => {
  const numbers: number[] = Object.setPrototypeOf([1.5, 2.5], null);
  return [numbers.length, numbers[0] + numbers[1], numbers[2], Array.isArray(numbers), typeof numbers.push];
});
report("doubles with holes again", holeyDoubles);
